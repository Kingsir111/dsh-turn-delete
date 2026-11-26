// The hidden route must hand the client text fragments of every removed turn, and
// those fragments must actually be absent from the model context.
//
//   (ELECTRON_RUN_AS_NODE=1) electron-as-node test/hidden-route.mjs <log.json>
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { Session, SessionId } from '@deepseek-ai/dsh-session'

const host = await import('../lib/index.js')

const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const headerRow = rows.find(row => row.type === 'session')
const { type: _ignored, ...header } = headerRow
const events = rows.filter(row => row.type !== 'session')
const session = Session.create(SessionId(header.id), events, header)

const agent = { id: session.id, session, status: 'idle', model: { current: () => ({ provider: 'deepseek-account' }) } }
const routes = []
const ctx = {
  sessions: { get: id => (id === session.id ? session : undefined), flush: async () => true },
  agents: { get: id => (id === session.id ? agent : undefined) },
  webServer: { register: route => { routes.push(route); return () => {} } },
  effect: factory => factory(),
  on: () => () => {},
}
host.apply(ctx)

const hiddenRoute = routes.find(route => route.path === host.HIDDEN_ROUTE)
assert.ok(hiddenRoute !== undefined, 'hidden route is mounted')

const answer = await new Promise(resolve => {
  const response = {
    status: 0,
    writeHead(status) { this.status = status; return this },
    end(body) { resolve({ status: this.status, body: JSON.parse(body) }) },
  }
  hiddenRoute.handler({ method: 'GET', url: `${host.HIDDEN_ROUTE}?sessionId=${encodeURIComponent(header.id)}`, headers: {} }, response)
})

const turns = answer.body.value.turns
console.log(`hidden route: ${String(turns.length)} turn(s) with text fragments`)
for (const item of turns) console.log(`  turn ${String(item.turn)}: ${String(item.snippets.length)} snippet(s) — ${item.snippets[0] ?? ''}`)

const deleted = new Set(session.snapshotEvents()
  .filter(event => typeof event.surfaceOp === 'object' && event.surfaceOp !== null)
  .flatMap(event => event.sourceEventSeqs ?? []))
assert.ok(deleted.size > 0, 'this log carries tombstones')

const context = session.deriveMessages()
  .map(message => (message.content ?? []).map(block => block.text ?? '').join(' ')).join('\n')
for (const item of turns) {
  for (const snippet of item.snippets) {
    assert.equal(context.includes(snippet), false, `"${snippet.slice(0, 24)}…" must be absent from the model context`)
  }
}

console.log(`  ${String(turns.length)} turn(s) verified absent from model context`)
console.log('\nhidden route checks passed')
