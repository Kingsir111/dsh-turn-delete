// Clone one session log under a fresh Session id.
//
// Written for a repair case: a session whose log is healthy but which the app no
// longer lists. A new identity forces a fresh directory, index entry and cache,
// while every message, tool record and title is carried over byte for byte.
//
//   node tools/clone-session.mjs <session dir> [--apply] [--title "新标题"]
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { randomUUID } from 'node:crypto'

const dir = process.argv[2]
const apply = process.argv.includes('--apply')
const titleIndex = process.argv.indexOf('--title')
const title = titleIndex === -1 ? undefined : process.argv[titleIndex + 1]
if (dir === undefined) throw new Error('usage: clone-session.mjs <session dir> [--apply] [--title "…"]')

const logFile = ['session.v4.jsonl.zstd', 'session.v4.jsonl']
  .map(name => path.join(dir, name))
  .find(candidate => fs.existsSync(candidate))
if (logFile === undefined) throw new Error(`no session log in ${dir}`)

const compressed = logFile.endsWith('.zstd')
const text = compressed
  ? zlib.zstdDecompressSync(fs.readFileSync(logFile)).toString('utf8')
  : fs.readFileSync(logFile, 'utf8')
const rows = text.split('\n').filter(line => line.trim().length > 0).map(line => JSON.parse(line))
const headerRow = rows.find(row => row.type === 'session')
const oldId = headerRow.id
const newId = `session-${randomUUID()}`

let renamed = 0
let retitled = 0
for (const row of rows) {
  if (row.type === 'session') { row.id = newId; continue }
  if (row.data !== null && typeof row.data === 'object' && row.data.sessionId === oldId) {
    row.data.sessionId = newId
    renamed += 1
  }
  if (title !== undefined && row.type === 'session/title') {
    row.data = { ...row.data, title }
    retitled += 1
  }
}

const outDir = path.join(path.dirname(dir), newId)
console.log(`source: ${oldId}`)
console.log(`target: ${newId}`)
console.log(`rows: ${rows.length}  sessionId fields rewritten: ${renamed}  titles rewritten: ${retitled}`)
console.log(`out: ${outDir}`)

if (!apply) {
  console.log('dry run (pass --apply to write)')
  process.exit(0)
}

fs.mkdirSync(outDir, { recursive: true })
const payload = rows.map(row => JSON.stringify(row)).join('\n') + '\n'
const target = path.join(outDir, path.basename(logFile))
if (compressed) fs.writeFileSync(target, zlib.zstdCompressSync(Buffer.from(payload, 'utf8')))
else fs.writeFileSync(target, payload)

// Verify what we just wrote is self-consistent.
const check = compressed
  ? zlib.zstdDecompressSync(fs.readFileSync(target)).toString('utf8')
  : fs.readFileSync(target, 'utf8')
const checkedRows = check.split('\n').filter(line => line.trim().length > 0).map(line => JSON.parse(line))
const checkedHeader = checkedRows.find(row => row.type === 'session')
const checkedEvents = checkedRows.filter(row => row.type !== 'session')
if (checkedHeader.id !== newId) throw new Error('verification failed: header id')
for (const [index, row] of checkedEvents.entries()) {
  if (row.seq !== index) throw new Error(`verification failed: seq ${row.seq} at index ${index}`)
}
console.log(`written: ${target}`)
console.log(`verified: ${checkedEvents.length} events, seq 0..${checkedEvents.length - 1}`)
console.log(`\nadd this id to the workspace list so the sidebar shows it:\n  ${newId}`)
