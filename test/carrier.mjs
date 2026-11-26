// Find a legal carrier for a past-turn surface replacement on session format v4.
//
// v4 relationships require message events to match an open turn/step, and a
// finished turn has none. This script replays a real log, appends a candidate
// replacement row, and runs the *persistence* validator the loader uses, then
// reports what the kernel derives from the result.
//
//   node test/carrier.mjs ../.testdata/repaired.json
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const matrixRoot = path.resolve(import.meta.dirname, '..', '..', 'compat-matrix')
const req = process.env.DSH_INSTALL_DIR === undefined
  ? createRequire(path.join(matrixRoot, 'v-0.2.2-rc.3', 'index.js'))
  : createRequire(path.join(process.env.DSH_INSTALL_DIR, 'index.js'))
const sessionPkg = req('@deepseek-ai/dsh-session')
const llm = req('@deepseek-ai/dsh-llm')
const format = req('@deepseek-ai/dsh-session-format-v3-to-v4')

const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const headerRow = rows.find(row => row.type === 'session')
const { type: _ignored, ...header } = headerRow
const seed = rows.filter(row => row.type !== 'session')

console.log('format exports:', Object.keys(format).join(', '))

function load(events) {
  return sessionPkg.Session.create(sessionPkg.SessionId(header.id), events, header)
}

function admission(events) {
  // The loader validates the whole released v4 relationship set over the artifact.
  try {
    const artifact = { events, inheritedEventCount: 0, header }
    format.assertReleasedV4Relationships(artifact, new Set(events.map(event => event.type)))
    return 'admitted'
  } catch (error) {
    return `REJECTED: ${error.message}`
  }
}

const base = load(seed)
console.log('base: events', seed.length, 'nodes', base.surface.nodes.length, 'derived', base.deriveMessages().length)
console.log('base admission:', admission(seed))

// Target: the last closed turn.
const turnStarts = seed.filter(event => event.type === 'turn/start')
const target = turnStarts.at(-1).data.turn
const targetEnd = [...seed].reverse().find(event => event.type === 'turn/end' && event.data.turn === target)
const nodes = [...base.surface.nodes]

// Surface span of the target turn: append-origin nodes between its last turn/start and its turn/end.
const startSeq = [...seed].reverse().find(event => event.type === 'turn/start' && event.data.turn === target).seq
const inTurn = nodes.filter(seq => seq > startSeq && seq < targetEnd.seq)
const firstSeq = inTurn[0]
const lastSeq = inTurn.at(-1)
console.log(`target turn ${target}: span ${firstSeq}..${lastSeq} (${inTurn.length} nodes)`)

const lastSystem = [...nodes].reverse().find(seq => seed[seq]?.type === 'system/message')
const lastOpen = seed.filter(event => event.type === 'step/start').at(-1)

const candidates = [
  {
    name: 'system/message after turn/end (current design)',
    row: () => ({
      type: 'system/message',
      seq: seed.length,
      time: Date.now(),
      data: { turn: target, step: 1, message: llm.createSystemMessage('') },
      surfaceOp: { op: 'replace', startSeq: firstSeq, endSeq: lastSeq },
      sourceEventSeqs: inTurn,
    }),
  },
  {
    name: 'system/message carrying the last open turn/step',
    row: () => ({
      type: 'system/message',
      seq: seed.length,
      time: Date.now(),
      data: { turn: lastOpen.data.turn, step: lastOpen.data.step, message: llm.createSystemMessage('') },
      surfaceOp: { op: 'replace', startSeq: firstSeq, endSeq: lastSeq },
      sourceEventSeqs: inTurn,
    }),
  },
  {
    name: 'user/message after turn/end (empty content, user source)',
    row: () => ({
      type: 'user/message',
      seq: seed.length,
      time: Date.now(),
      data: llm.createUserMessage({ content: [], source: { kind: 'user' } }),
      surfaceOp: { op: 'replace', startSeq: firstSeq, endSeq: lastSeq },
      sourceEventSeqs: inTurn,
    }),
  },
  {
    name: 'developer/message after turn/end (empty content)',
    row: () => ({
      type: 'developer/message',
      seq: seed.length,
      time: Date.now(),
      data: { message: llm.createDeveloperMessage([]) },
      surfaceOp: { op: 'replace', startSeq: firstSeq, endSeq: lastSeq },
      sourceEventSeqs: inTurn,
    }),
  },
]

for (const candidate of candidates) {
  console.log(`\n--- ${candidate.name} ---`)
  let row
  try {
    row = candidate.row()
  } catch (error) {
    console.log('  cannot build row:', error.message)
    continue
  }
  const events = [...seed, row]
  const verdict = admission(events)
  console.log('  admission:', verdict)
  try {
    const loaded = load(events)
    const messages = loaded.deriveMessages()
    const after = messages.length
    console.log(`  replay: nodes ${loaded.surface.nodes.length}, derived ${base.deriveMessages().length} -> ${after}`)
    const tail = messages.slice(-2).map(message => message.role)
    console.log('  tail roles:', tail.join(','))
  } catch (error) {
    console.log('  replay REJECTED:', error.message)
  }
}
