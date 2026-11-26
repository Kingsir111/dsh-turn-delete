// Check one real session log against the exact admission rules the Harness runs
// when it loads a session on startup. This is the check that a deletion either
// survives or breaks — the 0.3.0 failure only appeared here, never at write time.
//
//   (ELECTRON_RUN_AS_NODE=1) electron-as-node test/load-check.mjs <log.json>
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const req = createRequire(path.join(process.env.DSH_INSTALL_DIR, 'index.js'))
const format = req('@deepseek-ai/dsh-session-format-v3-to-v4')
const { Session, SessionId } = req('@deepseek-ai/dsh-session')

const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const headerRow = rows.find(row => row.type === 'session')
const { type: _ignored, ...header } = headerRow
const events = rows.filter(row => row.type !== 'session')
const known = new Set(events.map(event => event.type))

let failures = 0

try {
  format.assertReleasedV4Header(header)
  console.log('  OK    header 准入')
} catch (error) {
  failures += 1
  console.log(`  FAIL  header：${error.message}`)
}

let rowFailures = 0
for (const event of events) {
  try {
    format.assertV4RowAdmission(event, known)
  } catch (error) {
    rowFailures += 1
    if (rowFailures <= 5) console.log(`  FAIL  row ${event.seq} (${event.type})：${error.message}`)
  }
}
failures += rowFailures
console.log(`  ${rowFailures === 0 ? 'OK   ' : 'FAIL '} 逐行准入（${events.length} 行，失败 ${rowFailures}）`)

try {
  format.assertReleasedV4Relationships({ events, inheritedEventCount: 0, header }, known)
  console.log('  OK    v4 关系（turn/step/替换/引用）')
} catch (error) {
  failures += 1
  console.log(`  FAIL  v4 关系：${error.message}`)
}

let session
try {
  session = Session.create(SessionId(header.id), events, header)
  console.log(`  OK    内核重建：${session.surface.nodes.length} 个表面节点 / ${session.deriveMessages().length} 条模型消息`)
} catch (error) {
  failures += 1
  console.log(`  FAIL  内核重建：${error.message}`)
}

if (session !== undefined) {
  const replacements = events.filter(event => event.surfaceOp !== undefined && event.surfaceOp !== 'append')
  console.log(`  INFO  删除记录 ${replacements.length} 条`)
  for (const replacement of replacements) {
    const { startSeq, endSeq } = replacement.surfaceOp
    console.log(`        seq ${replacement.seq} 载体 ${replacement.type} 遮蔽 [${startSeq}..${endSeq}]`)
  }
}

console.log('')
console.log(failures === 0 ? '结论：这条日志可以正常加载 ✓' : `结论：加载会失败（${failures} 项） ✗`)
process.exit(failures === 0 ? 0 : 1)
