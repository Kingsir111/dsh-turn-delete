// Materialize an unpacked session log onto disk for a *specific* Session id.
//
// Written for the rescue path: the Host created a live session from a seed, but
// nothing persisted it, so `resume` fails with SessionPersistenceNotFoundError.
// This writes the generation file the persistence backend expects, with every
// session-scoped field rewritten to that id.
//
//   node tools/write-session-log.mjs <log.json> <sessionId> <outDir> [--title "…"] [--apply]
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const [jsonPath, sessionId, outDir] = process.argv.slice(2)
if (jsonPath === undefined || sessionId === undefined || outDir === undefined) {
  throw new Error('usage: write-session-log.mjs <log.json> <sessionId> <outDir> [--title "…"] [--apply]')
}
const apply = process.argv.includes('--apply')
const titleIndex = process.argv.indexOf('--title')
const title = titleIndex === -1 ? undefined : process.argv[titleIndex + 1]

const rows = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
if (!Array.isArray(rows)) throw new Error('log json must be an array')

const headerRow = rows.find(row => row.type === 'session')
if (headerRow === undefined) throw new Error('log json has no header row')
const oldId = headerRow.id
headerRow.id = sessionId

let rewritten = 0
let retitled = 0
for (const row of rows) {
  if (row.type === 'session') continue
  if (row.data !== null && typeof row.data === 'object' && typeof row.data.sessionId === 'string') {
    row.data.sessionId = sessionId
    rewritten += 1
  }
  if (title !== undefined && row.type === 'session/title') {
    row.data = { ...row.data, title }
    retitled += 1
  }
}

const events = rows.filter(row => row.type !== 'session')
for (const [index, row] of events.entries()) {
  if (row.seq !== index) throw new Error(`source is not contiguous: seq ${row.seq} at index ${index}`)
}

console.log(`source id:  ${oldId}`)
console.log(`target id:  ${sessionId}`)
console.log(`events:     ${events.length}`)
console.log(`rewritten:  ${rewritten} sessionId fields, ${retitled} titles`)
console.log(`out:        ${path.join(outDir, 'session.v4.jsonl.zstd')}`)

if (!apply) {
  console.log('dry run (pass --apply to write)')
  process.exit(0)
}

fs.mkdirSync(outDir, { recursive: true })
const target = path.join(outDir, 'session.v4.jsonl.zstd')
const text = rows.map(row => JSON.stringify(row)).join('\n') + '\n'
fs.writeFileSync(target, zlib.zstdCompressSync(Buffer.from(text, 'utf8')))

const check = zlib.zstdDecompressSync(fs.readFileSync(target)).toString('utf8')
  .split('\n').filter(line => line.trim().length > 0).map(line => JSON.parse(line))
const checkHeader = check.find(row => row.type === 'session')
const checkEvents = check.filter(row => row.type !== 'session')
if (checkHeader.id !== sessionId) throw new Error('verification failed: header id')
for (const [index, row] of checkEvents.entries()) {
  if (row.seq !== index) throw new Error(`verification failed: seq ${row.seq} at index ${index}`)
}
const stray = checkEvents.filter(row => row.data !== null && typeof row.data === 'object'
  && typeof row.data.sessionId === 'string' && row.data.sessionId !== sessionId)
if (stray.length > 0) throw new Error(`verification failed: ${stray.length} stale sessionId fields`)
console.log(`written and verified: ${checkEvents.length} events, seq 0..${checkEvents.length - 1}`)
