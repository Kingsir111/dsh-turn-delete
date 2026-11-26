// Cross-version matrix: run the shipped deletion core against every kernel copy
// installed under compat-matrix/, and report what each one does with the same
// real v4 session log.
//
//   node test/matrix.mjs test/fixture.json [test/sample-main.json]
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { planTurnDeletion, commitDeletion, TurnDeleteError, sessionEvents } from '../lib/core.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const matrixRoot = path.resolve(here, '..', '..', 'compat-matrix')
const logs = process.argv.slice(2).filter(arg => arg.endsWith('.json'))

function kernelOf(version) {
  const req = createRequire(path.join(matrixRoot, `v-${version}`, 'index.js'))
  return { session: req('@deepseek-ai/dsh-session'), llm: req('@deepseek-ai/dsh-llm') }
}

function build(kernel, rows) {
  const headerRow = rows.find(row => row.type === 'session')
  const { type: _ignored, ...header } = headerRow
  const seed = rows.filter(row => row.type !== 'session')
  return kernel.session.Session.create(kernel.session.SessionId(header.id), seed, header)
}

const versions = fs.readdirSync(matrixRoot)
  .filter(name => name.startsWith('v-'))
  .map(name => name.slice(2))
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))

const logName = process.argv[2]
const rows = JSON.parse(fs.readFileSync(logName, 'utf8'))
const seed = rows.filter(row => row.type !== 'session')
const target = seed.find(event => event.type === 'assistant/message' && event.surfaceOp === 'append')

console.log(`log: ${path.basename(logName)}  events=${seed.length}  target turn=${target?.data?.turn ?? '-'}`)
console.log('')

for (const version of versions) {
  let kernel
  try {
    kernel = kernelOf(version)
  } catch (error) {
    console.log(`${version.padEnd(14)} SKIP  cannot load kernel: ${error.message.split('\n')[0]}`)
    continue
  }
  let session
  try {
    session = build(kernel, rows)
  } catch (error) {
    console.log(`${version.padEnd(14)} NO-REPLAY  ${error.message.split('\n')[0].slice(0, 130)}`)
    continue
  }
  const before = session.deriveMessages?.()?.length ?? -1
  try {
    const plan = planTurnDeletion(session, target.data.message.id)
    if (plan.alreadyDeleted) { console.log(`${version.padEnd(14)} ALREADY-DELETED`); continue }
    // v4 admits a tombstone only inside an open turn and step.
    const nextTurn = plan.turn + 1
    session.append('turn/start', { turn: nextTurn })
    session.append('step/start', { turn: nextTurn, step: 1 })
    const receipt = commitDeletion(session, plan, text => kernel.llm.createSystemMessage(text), { turn: nextTurn, step: 1 })
    const after = session.deriveMessages?.()?.length ?? -1
    const tombstone = session.eventAt(receipt.seq)
    const source = JSON.stringify(tombstone?.data?.message?.source)
    const op = JSON.stringify(tombstone?.surfaceOp)
    const again = planTurnDeletion(session, target.data.message.id)
    console.log(`${version.padEnd(14)} OK  span=[${plan.startSeq}..${plan.endSeq}] nodes=${plan.sourceEventSeqs.length} derived ${before}->${after} idempotent=${again.alreadyDeleted === true}`)
    console.log(`${' '.repeat(15)}tombstone source=${source} op=${op}`)
  } catch (error) {
    const code = error instanceof TurnDeleteError ? error.code : error.name
    console.log(`${version.padEnd(14)} FAIL  ${code}: ${String(error.message).split('\n')[0].slice(0, 150)}`)
  }
}

console.log('')
console.log(`logs available for a fuller run: ${logs.length}`)
