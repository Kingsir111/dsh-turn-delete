// End-to-end Host test for the deferred design, over a real session log.
//
// Verifies the property the first design broke: after a deletion, the whole log
// still passes the v4 *load* admission the app uses on the next start.
//
//   node test/host-flow.mjs ../.testdata/repaired.json
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

// Same module instance the plugin itself loads, so Session private fields work.
import { Session, SessionId } from '@deepseek-ai/dsh-session'

// The v4 load validator lives only in the installed Harness, not in the npm copy.
const format = createRequire(path.join(process.env.DSH_INSTALL_DIR, 'index.js'))('@deepseek-ai/dsh-session-format-v3-to-v4')

const host = await import('../lib/index.js')
const core = await import('../lib/core.js')

const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const headerRow = rows.find(row => row.type === 'session')
const { type: _ignored, ...header } = headerRow
const seed = rows.filter(row => row.type !== 'session')

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

function makeCtx(session) {
  const listeners = []
  const routes = []
  const agent = { id: session.id, session, status: 'idle' }
  const ctx = {
    sessions: { get: id => (id === session.id ? session : undefined), flush: async () => true },
    agents: { get: id => (id === session.id ? agent : undefined) },
    webServer: { register: route => { routes.push(route); return () => {} } },
    effect: factory => factory(),
    on: (name, handler) => { listeners.push({ name, handler }); return () => {} },
  }
  return { ctx, agent, listeners, routes }
}

console.log(`log: ${path.basename(process.argv[2])}  events=${seed.length}`)
const session = Session.create(SessionId(header.id), seed, header)
const { ctx, agent, listeners, routes } = makeCtx(session)

// ---- mount ------------------------------------------------------------------
host.apply(ctx)
assert.deepEqual(routes.map(route => route.path).sort(), [host.DELETE_ROUTE, host.DELETED_ROUTE, host.TURNS_ROUTE, host.HIDDEN_ROUTE, host.IMPORT_ROUTE].sort(), 'all routes mounted')
assert.equal(listeners.length, 1, 'one session/event watcher')
assert.equal(listeners[0].name, 'session/event')
console.log(`1 mount            OK  routes=${routes.length} watcher=${listeners[0].name}`)

// ---- pick the last closed turn ---------------------------------------------
const turnStarts = seed.filter(event => event.type === 'turn/start')
const targetTurn = turnStarts.at(-1).data.turn
const messageId = seed.find(event => event.type === 'assistant/message'
  && event.surfaceOp === 'append'
  && event.data.turn === targetTurn).data.message.id
const before = session.deriveMessages().length
assert.equal(admission(session), 'admitted', 'baseline log is loadable')

// ---- request the deletion ---------------------------------------------------
const receipt = await host.requestDeletion(ctx, agent, messageId)
assert.equal(receipt.turn, targetTurn)
assert.equal(receipt.status, 'deferred', 'an adapter without the empty-drop rule defers')
assert.ok(core.pendingRequests(session).length >= 1, 'the deferred request is recorded')
assert.equal(session.deriveMessages().length, before, 'nothing is removed before a step opens')
assert.deepEqual(core.deletedTurns(session), [], 'not applied yet')
assert.deepEqual(core.pendingRequests(session).map(item => item.turn), [targetTurn], 'request is pending')
console.log(`2 request          OK  turn=${targetTurn} pending, admission=${admission(session)}`)

// ---- next turn opens --------------------------------------------------------
const nextTurn = targetTurn + 1
session.append('turn/start', { turn: nextTurn })
session.append('step/start', { turn: nextTurn, step: 1 })
const openEvent = session.snapshotEvents().at(-1)
listeners[0].handler(session, openEvent)
await new Promise(resolve => setTimeout(resolve, 20))

const after = session.deriveMessages().length
assert.ok(after < before, `turn removed from model history (${before} -> ${after})`)
assert.deepEqual(core.deletedTurns(session), [targetTurn], 'turn reported as deleted')
assert.deepEqual(core.pendingRequests(session), [], 'request settled')
const tombstone = session.snapshotEvents().find(event => event.type === 'system/message'
  && event.surfaceOp !== undefined && event.surfaceOp !== 'append'
  && event.data.turn === nextTurn)
assert.ok(tombstone !== undefined, 'tombstone lives inside the new turn')
assert.equal(tombstone.data.step, 1)
assert.equal(tombstone.data.message.content.length, 0, 'tombstone sends no wire content')
assert.equal(tombstone.data.message.source.kind, 'system-prompt')
console.log(`3 apply            OK  ${before} -> ${after} messages, tombstone at seq ${tombstone.seq}`)

// ---- the property the first design broke ------------------------------------
assert.equal(admission(session), 'admitted', 'repaired log must still load after a deletion')
console.log('4 load admission   OK  v4 relationships accept the whole log')

// ---- idempotency -------------------------------------------------------------
session.append('step/end', { turn: nextTurn, step: 1 })
session.append('turn/end', { turn: nextTurn })
session.append('turn/start', { turn: nextTurn + 1 })
session.append('step/start', { turn: nextTurn + 1, step: 1 })
listeners[0].handler(session, session.snapshotEvents().at(-1))
await new Promise(resolve => setTimeout(resolve, 20))
assert.equal(session.deriveMessages().length, after, 'a second step does not delete anything again')
assert.equal(admission(session), 'admitted')
console.log('5 idempotent        OK  no second tombstone')

// ---- refusal is immediate ----------------------------------------------------
const refused = await host.requestDeletion(ctx, agent, 'no-such-message')
assert.equal(refused.status, 'refused')
assert.equal(refused.code, 'TARGET_NOT_FOUND')
console.log('6 refusal           OK  TARGET_NOT_FOUND before anything is recorded')

// ---- routing through the HTTP handler ---------------------------------------
const url = new URL(`http://localhost${host.DELETED_ROUTE}?sessionId=${encodeURIComponent(header.id)}`)
const answer = await new Promise((resolve) => {
  const response = {
    status: 0,
    body: '',
    writeHead(status) { this.status = status; return this },
    end(body) { this.body = body; resolve({ status: this.status, body: JSON.parse(body) }) },
  }
  routes.find(route => route.path === host.DELETED_ROUTE).handler({ method: 'GET', url: url.pathname + url.search, headers: {} }, response)
})
assert.equal(answer.status, 200)
assert.deepEqual(answer.body.value.turns, [targetTurn])
console.log('7 GET route         OK  turns=' + JSON.stringify(answer.body.value.turns))

console.log('\n--- immediate mode (DeepSeek provider drops empty user messages) ---')
{
  const direct = Session.create(SessionId(header.id), seed, header)
  const ctx2 = makeCtx(direct)
  const agent2 = { id: direct.id, session: direct, status: 'idle', model: { current: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) } }
  ctx2.ctx.agents.get = id => (id === direct.id ? agent2 : undefined)
  const beforeDirect = direct.deriveMessages().length
  const receipt2 = await host.requestDeletion(ctx2.ctx, agent2, messageId)
  assert.equal(receipt2.status, 'applied', 'immediate providers delete in the same call')
  assert.equal(receipt2.immediate, true)
  const carrierSeq = direct.snapshotEvents().filter(event => event.surfaceOp !== undefined && event.surfaceOp !== 'append').at(-1).seq
  const afterDirect = direct.deriveMessages().length
  assert.ok(afterDirect < beforeDirect, `turn gone immediately (${beforeDirect} -> ${afterDirect})`)
  assert.deepEqual(core.deletedTurns(direct), [targetTurn])
  const carrier = direct.eventAt(carrierSeq)
  assert.equal(carrier.type, 'user/message', 'immediate carrier is a user/message replacement')
  assert.equal(carrier.data.content.length, 0, 'carrier content is empty')
  assert.equal(carrier.data.source.kind, 'user')
  assert.equal(admission(direct), 'admitted', 'immediate deletion still loads')
  const emptyTail = direct.deriveMessages().filter(message => message.role === 'user' && message.content.length === 0)
  assert.equal(emptyTail.length, 1, 'derived history holds exactly one empty user node')
  console.log(`8 immediate        OK  ${beforeDirect} -> ${afterDirect}, carrier=user/message(empty), admission=admitted`)
  console.log('                   note: DeepSeek serializer drops empty user messages (serialize.ts:123)')
}

console.log('\nall host flow checks passed')





