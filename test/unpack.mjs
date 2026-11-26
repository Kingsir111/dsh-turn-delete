// Unpack a (multi-frame) v4 jsonl.zstd log into a plain JSON events array.
// Run with the SYSTEM node (v26 concatenates zstd frames; Electron's node 24
// stops after the first frame). usage: node unpack.mjs <log.zstd> <out.json>
import fs from 'node:fs'
import zlib from 'node:zlib'

const [input, output] = process.argv.slice(2)
const raw = zlib.zstdDecompressSync(fs.readFileSync(input)).toString('utf8')
const rows = raw.split('\n').filter(line => line.trim().length > 0).map(line => JSON.parse(line))
fs.writeFileSync(output, JSON.stringify(rows))
console.log(`events: ${rows.length - 1} -> ${output}`)
