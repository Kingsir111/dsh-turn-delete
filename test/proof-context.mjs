// Proof that a deletion changes the model-visible history, not just the view:
// pick a turn, show that its words are present in deriveMessages(), delete it,
// and show the words are gone.
//
//   (ELECTRON_RUN_AS_NODE=1) electron-as-node test/proof-context.mjs log.json [turn]
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const req = createRequire(path.join(process.env.DSH_INSTALL_DIR, 'index.js'))
const { Session, SessionId } = req('@deepseek-ai/dsh-session')
const { createUserMessage } = req('@deepseek-ai/dsh-llm')
const format = req('@deepseek-ai/dsh-session-format-v3-to-v4')
const { planTurnDeletion, commitImmediate } = await import('../lib/core.js')

const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const headerRow = rows.find(row => row.type === 'session')
const { type: _ignored, ...header } = headerRow
const seed = rows.filter(row => row.type !== 'session')
const session = Session.create(SessionId(header.id), seed, header)

const wantedTurn = process.argv[3] === undefined ? undefined : Number(process.argv[3])
const events = session.snapshotEvents()
const assistantTurns = [...new Set(events.filter(e => e.type === 'assistant/message' && e.surfaceOp === 'append').map(e => e.data.turn))]
const turn = wantedTurn ?? assistantTurns.at(-1)

function textOf(message) {
  return (message.content ?? []).map(block => block.text ?? '').join(' ')
}
function transcript(needle) {
  return session.deriveMessages().filter(message => textOf(message).includes(needle))
}

// Pick a distinctive needle from that turn's own user text.
const start = events.findLast(e => e.type === 'turn/start' && e.data.turn === turn)
const end = events.find(e => e.type === 'turn/end' && e.data.turn === turn)
const turnUser = events.filter(e => e.type === 'user/message' && e.seq > start.seq && e.seq < end.seq)
const raw = turnUser.map(e => textOf(e.data)).join(' ')
const words = raw.replace(/\s+/gu, ' ').trim().split(' ').filter(word => word.length >= 6)
const needle = words.slice(0, 3).join(' ')
console.log(`session: ${header.id}`)
console.log(`turn ${turn}: ${turnUser.length} user message(s)`)
console.log(`needle: ${JSON.stringify(needle.slice(0, 90))}`)
console.log(`derived messages: ${session.deriveMessages().length}`)
console.log(`messages containing the needle BEFORE: ${transcript(needle.split(' ')[0]).length}`)

const messageId = events.find(e => e.type === 'assistant/message' && e.surfaceOp === 'append' && e.data.turn === turn).data.message.id
const plan = planTurnDeletion(session, messageId)
const receipt = commitImmediate(session, plan, createUserMessage)
const after = session.deriveMessages()
console.log(`\napplied: turn ${receipt.turn}, carrier seq ${receipt.seq}, span [${plan.startSeq}..${plan.endSeq}]`)
console.log(`derived messages: ${after.length}`)
const word = needle.split(' ')[0]
console.log(`messages containing ${JSON.stringify(word)} AFTER: ${after.filter(message => textOf(message).includes(word)).length}`)

let admitted = 'admitted'
try {
  format.assertReleasedV4Relationships(
    { events: session.snapshotEvents(), inheritedEventCount: 0, header },
    new Set(session.snapshotEvents().map(event => event.type)),
  )
} catch (error) {
  admitted = `REJECTED: ${error.message}`
}
console.log(`v4 load admission: ${admitted}`)

const roles = after.map(message => message.role)
console.log(`roles: ${roles.slice(0, 12).join(',')} … ${roles.slice(-6).join(',')}`)
const empties = after.filter(message => (message.content ?? []).length === 0).length
console.log(`empty carrier nodes in derived history: ${empties} (dropped by the DeepSeek serializer)`)
