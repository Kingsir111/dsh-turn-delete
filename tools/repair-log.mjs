// Repair a v4 session log whose tail carries surface replacements appended
// outside an open turn/step (v4 relationships require system/developer messages
// to match an open turn and step, so such rows make the whole log unloadable).
//
//   node tools/repair-log.mjs <session.v4.jsonl.zstd> [--apply]
//
// Without --apply it only reports. With --apply it copies the original to
// <file>.bak-<timestamp>, drops every violating row, re-numbers nothing (only
// trailing rows are dropped), rewrites the log atomically and verifies that the
// result re-parses and keeps contiguous seqs.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const file = process.argv[2]
const apply = process.argv.includes('--apply')
if (file === undefined) throw new Error('usage: repair-log.mjs <log.zstd> [--apply]')

const rows = zlib.zstdDecompressSync(fs.readFileSync(file))
  .toString('utf8').split('\n').filter(line => line.trim().length > 0).map(line => JSON.parse(line))

const header = rows.find(row => row.type === 'session')
const events = rows.filter(row => row.type !== 'session')

let turn = null
let step = null
const violations = []
for (const event of events) {
  if (event.type === 'turn/start') turn = event.data.turn
  else if (event.type === 'turn/end') turn = null
  else if (event.type === 'step/start') step = event.data.step
  else if (event.type === 'step/end') step = null
  if (event.type !== 'system/message' && event.type !== 'developer/message') continue
  const matches = turn !== null && step !== null
    && event.data?.turn === turn && event.data?.step === step
  if (matches) continue
  violations.push({ event, turn, step })
}

console.log(`log: ${path.basename(file)}`)
console.log(`header: id=${header.id} version=${header.version} cwd=${header.cwd ?? '-'}`)
console.log(`events: ${events.length}  violations: ${violations.length}`)
for (const item of violations) {
  const event = item.event
  console.log(`  seq=${event.seq} type=${event.type} turn=${event.data?.turn} step=${event.data?.step}`
    + ` openTurn=${String(item.turn)} openStep=${String(item.step)}`
    + ` op=${event.surfaceOp === undefined ? 'none' : JSON.stringify(event.surfaceOp)}`
    + ` blocks=${(event.data?.message?.content ?? []).length}`)
}

if (violations.length === 0) {
  console.log('nothing to repair')
  process.exit(0)
}

const dropSeqs = new Set(violations.map(item => item.event.seq))
const lastKept = Math.max(...events.filter(event => !dropSeqs.has(event.seq)).map(event => event.seq))
const nonTrailing = violations.filter(item => item.event.seq < lastKept)
if (nonTrailing.length > 0) {
  console.log(`REFUSING: ${nonTrailing.length} violating row(s) sit before later events; dropping them would break the seq contract`)
  process.exit(2)
}

const kept = rows.filter(row => row.type === 'session' || !dropSeqs.has(row.seq))
const keptEvents = kept.filter(row => row.type !== 'session')
for (const [index, event] of keptEvents.entries()) {
  if (event.seq !== index) throw new Error(`contiguity broken at index ${index}: seq ${event.seq}`)
}
console.log(`plan: drop ${dropSeqs.size} trailing row(s) -> ${keptEvents.length} events, contiguous 0..${keptEvents.length - 1}`)

if (!apply) {
  console.log('dry run (pass --apply to write)')
  process.exit(0)
}

const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/gu, '-')}`
fs.copyFileSync(file, backup)
const text = kept.map(row => JSON.stringify(row)).join('\n') + '\n'
const compressed = zlib.zstdCompressSync(Buffer.from(text, 'utf8'))
const temp = `${file}.tmp`
fs.writeFileSync(temp, compressed)

// Verify the bytes we are about to publish before replacing the original.
const check = zlib.zstdDecompressSync(fs.readFileSync(temp)).toString('utf8')
  .split('\n').filter(line => line.trim().length > 0).map(line => JSON.parse(line))
const checkEvents = check.filter(row => row.type !== 'session')
if (checkEvents.length !== keptEvents.length) throw new Error('verification failed: event count changed')
for (const [index, event] of checkEvents.entries()) {
  if (event.seq !== index) throw new Error(`verification failed: seq ${event.seq} at index ${index}`)
}
fs.renameSync(temp, file)
console.log(`repaired: ${file}`)
console.log(`backup:   ${backup}`)
