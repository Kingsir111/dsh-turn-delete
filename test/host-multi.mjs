// Multi-turn deletion: pick several turns at once and verify each is removed,
// that the log still passes the kernel's load admission, and that a second
// attempt is a no-op.
//
//   (ELECTRON_RUN_AS_NODE=1) electron-as-node test/host-multi.mjs <log.json>
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { Session, SessionId } from '@deepseek-ai/dsh-session'

const format = (await import('node:module')).createRequire(path.join(process.env.DSH_INSTALL_DIR, 'index.js'))(
  '@deepseek-ai/dsh-session-format-v3-to-v4',
)
const host = await import('../lib/index.js')
const core = await import('../lib/core.js')

const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const headerRow = rows.find(row => row.type === 'session')
const { type: _ignored, ...header } = headerRow
const events = rows.filter(row => row.type !== 'session')

function admission(session) {
  try {
    format.assertReleasedV4Relationships(
      { events: session.snapshotEvents(), inheritedEventCount: 0, header },
      new Set(session.snapshotEvents().map(event => event.type)),
    )
    return 'admitted'
  } catch (error) {
    return `REJECTED: ${error.message}`
  }
}

const session = Session.create(SessionId(header.id), events, header)
const agent = { id: session.id, session, status: 'idle', model: { current: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) } }
const ctx = {
  sessions: { get: id => (id === session.id ? session : undefined), flush: async () => true },
  agents: { get: id => (id === session.id ? agent : undefined) },
  webServer: { register: () => () => {} },
  effect: factory => factory(),
  on: () => () => {},
}

const lastAssistantByTurn = new Map()
for (const event of session.snapshotEvents()) {
  if (event.type === 'assistant/message' && event.surfaceOp === 'append') {
    lastAssistantByTurn.set(event.data.turn, event.data.message.id)
  }
}
const turns = [...lastAssistantByTurn.keys()].sort((left, right) => left - right)
const picks = turns.slice(-2)
const ids = picks.map(turn => lastAssistantByTurn.get(turn))
const before = session.deriveMessages().length
console.log(`log: ${path.basename(process.argv[2])}  turns=${turns.length}  picking=${picks.join(',')}  messages=${before}`)

const outcome = await host.requestDeletions(ctx, agent, ids)
console.log('results:', JSON.stringify(outcome.results))

const applied = outcome.results.filter(item => item.status === 'applied').map(item => item.turn)
assert.ok(applied.length >= 1, 'at least one turn is applied')
const after = session.deriveMessages().length
assert.ok(after < before, `model history shrank (${before} -> ${after})`)
for (const turn of applied) assert.ok(core.deletedTurns(session).includes(turn), `turn ${turn} reported deleted`)
assert.equal(admission(session), 'admitted', 'log still passes v4 load admission')
console.log(`applied ${JSON.stringify(applied)} · messages ${before} -> ${after} · admission admitted`)

const again = await host.requestDeletions(ctx, agent, ids)
assert.ok(again.results.every(item => item.status === 'already-gone' || item.status === 'refused'), 'second pass changes nothing')
assert.equal(session.deriveMessages().length, after, 'no second tombstone')
assert.equal(admission(session), 'admitted')
console.log(`idempotent: ${JSON.stringify(again.results.map(item => item.status))}`)

const turnsRoute = await new Promise(resolve => {
  const routes = []
  host.apply({ ...ctx, webServer: { register: route => { routes.push(route); return () => {} } } })
  const route = routes.find(item => item.path === host.TURNS_ROUTE)
  const response = {
    status: 0,
    body: '',
    writeHead(status) { this.status = status; return this },
    end(body) { this.body = body; resolve({ status: this.status, body: JSON.parse(body) }) },
  }
  route.handler({ method: 'GET', url: `${host.TURNS_ROUTE}?sessionId=${encodeURIComponent(header.id)}`, headers: {} }, response)
})
const listed = turnsRoute.body.value.turns
assert.equal(turnsRoute.status, 200)
assert.ok(listed.length > 0, 'turns route lists turns')
assert.ok(listed.filter(item => item.deleted).length === applied.length, 'deleted flag matches')
console.log(`GET ${host.TURNS_ROUTE}: ${listed.length} turns, ${listed.filter(item => item.deleted).length} deleted, ${listed.filter(item => !item.deletable).length} not deletable`)

console.log('\nmulti-turn checks passed')
