// Show, for one real session log, what the model currently sees and what the
// deletion records shadow. Works on the log as it stands — no reconstruction.
//
//   (ELECTRON_RUN_AS_NODE=1) electron-as-node test/what-model-sees.mjs <log.json> [phrase]
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const req = createRequire(path.join(process.env.DSH_INSTALL_DIR, 'index.js'))
const { Session, SessionId } = req('@deepseek-ai/dsh-session')

const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const phrase = process.argv[3] ?? '小明'
const headerRow = rows.find(row => row.type === 'session')
const { type: _ignored, ...header } = headerRow
const events = rows.filter(row => row.type !== 'session')

const textOf = message => (message.content ?? []).map(block => block.text ?? '').join(' ')
const flatten = value => JSON.stringify(value ?? '')

const session = Session.create(SessionId(header.id), events, header)
const derived = session.deriveMessages()

console.log(`session ${header.id}`)
console.log(`日志 ${events.length} 条事件 · 当前表面节点 ${session.surface.nodes.length} 个 · 模型可❌见消息 ${derived.length} 条`)
console.log('')

const replacements = events.filter(event => event.surfaceOp !== undefined && event.surfaceOp !== 'append')
console.log(`删除记录 ${replacements.length} 条：`)
for (const replacement of replacements) {
  const { startSeq, endSeq } = replacement.surfaceOp
  const carrier = replacement.data?.message?.content?.length ?? replacement.data?.content?.length ?? 0
  const shadowed = events.filter(event => event.seq >= startSeq && event.seq <= endSeq)
  console.log(`  seq=${replacement.seq} 载体=${replacement.type} 内容块=${carrier}`
    + ` 遮蔽 seq [${startSeq}..${endSeq}] = ${shadowed.length} 个事件`)
  console.log(`    被遮蔽内容：${shadowed.map(event => event.type).join(', ')}`)
  const snippet = shadowed.map(event => textOf(event.data?.message ?? event.data ?? {}) || flatten(event.data))
    .join(' ').replace(/\s+/gu, ' ')
  if (snippet.trim().length > 0) console.log(`    其中文字：${snippet.slice(0, 120)}`)
}
console.log('')

const inLog = events.filter(event => flatten(event.data).includes(phrase))
const visible = derived.filter(message => textOf(message).includes(phrase))
console.log(`含「${phrase}」的事件：日志里 ${inLog.length} 条（历史保留）`)
console.log(`含「${phrase}」的模型可❌见消息：${visible.length} 条`)
for (const message of visible) {
  console.log(`  仍在：${message.role} · ${textOf(message).replace(/\s+/gu, ' ').slice(0, 70)}`)
}
console.log('')
console.log('模型消息末尾 4 条：')
for (const message of derived.slice(-4)) {
  console.log(`  ${message.role.padEnd(9)} ${textOf(message).replace(/\s+/gu, ' ').slice(0, 64)}`)
}
