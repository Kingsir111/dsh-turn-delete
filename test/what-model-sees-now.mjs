// Report what the model actually receives for one session log: derived messages,
// and whether text from a deleted turn still appears anywhere.
import fs from 'node:fs'
import path from 'node:path'
import { Session, SessionId } from '@deepseek-ai/dsh-session'

const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const headerRow = rows.find(row => row.type === 'session')
const { type: _ignored, ...header } = headerRow
const events = rows.filter(row => row.type !== 'session')
const session = Session.create(SessionId(header.id), events, header)

const messages = session.deriveMessages()
const all = messages.map(message => (message.content ?? []).map(block => block.text ?? '').join(' ')).join(' \n ')
console.log(`derived messages: ${String(messages.length)}  chars: ${String(all.length)}`)
for (const needle of process.argv.slice(3)) {
  const hits = all.split(needle).length - 1
  console.log(`  "${needle}" -> ${String(hits)} hit(s) in model context`)
}
console.log('surface events:', String(session.snapshotEvents().filter(event => event.surfaceOp !== 'append').length), 'replacements')
