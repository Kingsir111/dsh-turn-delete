// Dump the live surface and the derived model messages side by side.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const req = createRequire(path.join(process.env.DSH_INSTALL_DIR, 'index.js'))
const { Session, SessionId } = req('@deepseek-ai/dsh-session')

const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const headerRow = rows.find(row => row.type === 'session')
const { type: _ignored, ...header } = headerRow
const events = rows.filter(row => row.type !== 'session')
const session = Session.create(SessionId(header.id), events, header)

const textOf = message => (message.content ?? [])
  .map(block => block.text ?? (block.type === 'reasoning' ? `[reasoning] ${block.text ?? ''}` : `[${block.type}]`))
  .join(' ')
  .replace(/\s+/gu, ' ')

console.log('=== 表面节点（模型可见的事件） ===')
for (const seq of session.surface.nodes) {
  const event = events[seq]
  const isReplacement = event?.surfaceOp !== undefined && event.surfaceOp !== 'append'
  const content = event?.data?.message ?? event?.data ?? {}
  const preview = textOf(content) || (isReplacement ? '(空替换载体)' : '')
  console.log(`${String(seq).padStart(4)} ${String(event?.type ?? '?').padEnd(14)}${isReplacement ? 'R' : ' '} ${preview.slice(0, 70)}`)
}

console.log('\n=== 派生消息（实际发给模型） ===')
for (const [index, message] of session.deriveMessages().entries()) {
  console.log(`${String(index + 1).padStart(3)} ${message.role.padEnd(9)} ${textOf(message).slice(0, 74)}`)
}

console.log('\n=== 被替换事件（历史里仍在，但已不在表面） ===')
for (const event of events) {
  if (event.surfaceOp === undefined || event.surfaceOp === 'append') continue
  const { startSeq, endSeq } = event.surfaceOp
  console.log(`seq ${event.seq}: 遮蔽 [${startSeq}..${endSeq}]`)
  for (const shadowed of events.filter(item => item.seq >= startSeq && item.seq <= endSeq)) {
    const preview = textOf(shadowed.data?.message ?? shadowed.data ?? {}) || JSON.stringify(shadowed.data).slice(0, 60)
    console.log(`    ${String(shadowed.seq).padStart(4)} ${String(shadowed.type).padEnd(14)} ${preview.slice(0, 64)}`)
  }
}
