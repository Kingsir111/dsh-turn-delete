// Insert this plugin's line into a local clone of beancookie/awesome-dsh-plugin,
// at the alphabetically correct position inside the "sessions" category, in both
// README.md (zh) and README.en.md (en).
//
//   node tools/market-entry.mjs <path-to-clone>            # dry run, prints the plan
//   node tools/market-entry.mjs <path-to-clone> --apply     # writes both READMEs
//
// The repository's own scripts/check-order.mjs sorts by owner/repo, case
// insensitive; this script uses the same comparison so CI passes.
import fs from 'node:fs'
import path from 'node:path'

const OWNER_REPO = 'Kingsir111/dsh-turn-delete'
const URL = `https://github.com/${OWNER_REPO}`
const LINE = {
  'README.md': `- [${OWNER_REPO}](${URL}) — 从会话的模型上下文中删除任意轮次，可多选；日志保持追加、可审计。`,
  'README.en.md': `- [${OWNER_REPO}](${URL}) - Remove any turn from a session's model context, several at once; the append-only log stays intact.`,
}
const HEADING = {
  'README.md': '会话与消息',
  'README.en.md': 'Sessions & Messages',
}

const clone = process.argv[2]
const apply = process.argv.includes('--apply')
if (clone === undefined) {
  console.error('usage: node tools/market-entry.mjs <path-to-clone> [--apply]')
  process.exit(2)
}

const urlOf = line => line.match(/https:\/\/github\.com\/[^)\s]+/)?.[0] ?? ''
const keyOf = line => {
  const url = urlOf(line).replace('https://github.com/', '').split('/tree/')[0]
  const [owner, repo] = url.split('/')
  return `${owner ?? ''}/${repo ?? ''}`.toLowerCase()
}
const isEntry = line => /^- \[.+\]\(https:\/\/github\.com\/[^)]+\) [—-] .+/.test(line)

let failures = 0
for (const file of Object.keys(LINE)) {
  const target = path.join(clone, file)
  if (!fs.existsSync(target)) {
    console.error(`missing: ${target}`)
    failures += 1
    continue
  }
  const lines = fs.readFileSync(target, 'utf8').split('\n')
  if (lines.some(line => line.includes(`${OWNER_REPO}](`) || line.includes(`${URL}](`))) {
    console.log(`${file}: already listed, nothing to do`)
    continue
  }

  const headingIndex = lines.findIndex(line => /^#{2,3} /.test(line) && line.includes(HEADING[file]))
  if (headingIndex === -1) {
    console.error(`${file}: heading "${HEADING[file]}" not found`)
    failures += 1
    continue
  }

  // The category block runs until the next heading of the same or higher level.
  let end = lines.length
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^#{2,3} /.test(lines[index])) {
      end = index
      break
    }
  }

  const key = keyOf(LINE[file])
  let insertAt = -1
  for (let index = headingIndex + 1; index < end; index += 1) {
    if (!isEntry(lines[index])) continue
    if (keyOf(lines[index]) > key) {
      insertAt = index
      break
    }
  }
  if (insertAt === -1) {
    // Append at the end of the category, before trailing blank lines.
    insertAt = end
    while (insertAt > headingIndex + 1 && lines[insertAt - 1].trim() === '') insertAt -= 1
  }

  const previous = insertAt > headingIndex + 1 ? lines[insertAt - 1] : '(start of category)'
  const next = insertAt < end ? lines[insertAt] : '(end of category)'
  console.log(`${file}: insert at line ${String(insertAt + 1)}`)
  console.log(`  after : ${previous.slice(0, 120)}`)
  console.log(`  line  : ${LINE[file]}`)
  console.log(`  before: ${next.slice(0, 120)}`)

  if (apply) {
    lines.splice(insertAt, 0, LINE[file])
    fs.writeFileSync(target, lines.join('\n'))
    console.log(`  written`)
  }
}

if (failures > 0) process.exit(1)
if (!apply) console.log('\ndry run: pass --apply to write, then run `node scripts/check-order.mjs` in the clone')
