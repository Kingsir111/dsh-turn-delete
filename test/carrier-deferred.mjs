// Prove the deferred design: a `system/message` tombstone appended inside a
// freshly opened turn/step — legal for v4 load admission — plus the ignorable
// intent record that survives the idle period.
//
//   (ELECTRON_RUN_AS_NODE=1) electron-as-node test/carrier-deferred.mjs ../.testdata/repaired.json
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const req = createRequire(path.join(process.env.DSH_INSTALL_DIR, 'index.js'))
const sessionPkg = req('@deepseek-ai/dsh-session')
const llm = req('@deepseek-ai/dsh-llm')
const format = req('@deepseek-ai/dsh-session-format-v3-to-v4')

const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const headerRow = rows.find(row => row.type === 'session')
const { type: _ignored, ...header } = headerRow
const seed = rows.filter(row => row.type !== 'session')

function load(events) {
  return sessionPkg.Session.create(sessionPkg.SessionId(header.id), events, header)
}
function admission(events) {
  try {
    format.assertReleasedV4Relationships(
      { events, inheritedEventCount: 0, header },
      new Set(events.map(event => event.type)),
    )
    return 'admitted'
  } catch (error) {
    return `REJECTED: ${error.message}`
  }
}
function rowAdmission(event) {
  try {
    format.assertV4RowAdmission(event, new Set([...seed.map(item => item.type), event.type]))
    return 'admitted'
  } catch (error) {
    return `REJECTED: ${error.message}`
  }
}

const base = load(seed)
const baseDerived = base.deriveMessages().length
const nodes = [...base.surface.nodes]
const turnStarts = seed.filter(event => event.type === 'turn/start')
const target = turnStarts.at(-1).data.turn
const targetStart = [...seed].reverse().find(event => event.type === 'turn/start' && event.data.turn === target).seq
const targetEnd = [...seed].reverse().find(event => event.type === 'turn/end' && event.data.turn === target).seq
const span = nodes.filter(seq => seq > targetStart && seq < targetEnd)
console.log(`base: events=${seed.length} nodes=${nodes.length} derived=${baseDerived}`)
console.log(`target turn ${target}: span ${span[0]}..${span.at(-1)} (${span.length} nodes)`)

// ---- 1. intent record: ignorable plugin event, no surface metadata -----------
const nextSeq = seed.length
const intent = {
  type: 'plugin:turn-delete',
  seq: nextSeq,
  time: Date.now(),
  ignorable: true,
  data: { turn: target, requestedAt: Date.now() },
}
console.log('\n--- intent record (`plugin:turn-delete`, ignorable) ---')
console.log('  row admission:', rowAdmission(intent))
const withIntent = [...seed, intent]
console.log('  artifact admission:', admission(withIntent))
try {
  const loaded = load(withIntent)
  console.log(`  replay: nodes ${loaded.surface.nodes.length} derived ${loaded.deriveMessages().length} (unchanged: ${loaded.deriveMessages().length === baseDerived})`)
} catch (error) {
  console.log('  replay REJECTED:', error.message)
}

// ---- 2. tombstone inside a freshly opened turn/step -------------------------
console.log('\n--- tombstone inside a new open turn/step ---')
const turn = target + 1
const events = [...withIntent]
let seq = events.length
events.push({ type: 'turn/start', seq: seq++, time: Date.now(), data: { turn } })
events.push({ type: 'step/start', seq: seq++, time: Date.now(), data: { turn, step: 1 } })
const tombstone = {
  type: 'system/message',
  seq: seq++,
  time: Date.now(),
  data: { turn, step: 1, message: llm.createSystemMessage('') },
  surfaceOp: { op: 'replace', startSeq: span[0], endSeq: span.at(-1) },
  sourceEventSeqs: span,
}
events.push(tombstone)
events.push({ type: 'step/end', seq: seq++, time: Date.now(), data: { turn, step: 1 } })
events.push({ type: 'turn/end', seq: seq++, time: Date.now(), data: { turn } })

console.log('  tombstone row admission:', rowAdmission(tombstone))
console.log('  artifact admission:', admission(events))
try {
  const loaded = load(events)
  const derived = loaded.deriveMessages().length
  console.log(`  replay: nodes ${loaded.surface.nodes.length} derived ${baseDerived} -> ${derived}`)
  const roles = loaded.deriveMessages().slice(-3).map(message => message.role).join(',')
  console.log('  tail roles:', roles)
  console.log(`  target turn removed: ${derived < baseDerived}`)
  // idempotency: a second identical tombstone must not be needed; the log keeps one.
  console.log('  tombstone source:', JSON.stringify(tombstone.data.message.source))
} catch (error) {
  console.log('  replay REJECTED:', error.message)
}
