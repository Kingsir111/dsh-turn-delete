// Offline simulator: replay a real v4 session log into the installed kernel's
// Session and exercise the shipped deletion core against it.
// usage: (ELECTRON_RUN_AS_NODE=1) electron-as-node simulate.mjs <log.zstd> [turns...]
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import { planTurnDeletion, commitDeletion, TurnDeleteError, sessionEvents } from '../lib/core.js'

const anchor = path.join(process.env.DSH_INSTALL_DIR, 'index.js')
const req = createRequire(anchor)
const sessionPkg = req('@deepseek-ai/dsh-session')
const llmPkg = req('@deepseek-ai/dsh-llm')
const { Session, SessionId } = sessionPkg
const { createSystemMessage } = llmPkg

const file = process.argv[2]
const wanted = process.argv.slice(3).filter(arg => /^\d+$/.test(arg)).map(Number)
// Accept an unpacked .json (preferred: `node unpack.mjs log.zstd log.json`) or a
// single-frame .zstd. Electron's node 24 decodes only the first zstd frame.
const rows = file.endsWith('.json')
  ? JSON.parse(fs.readFileSync(file, 'utf8'))
  : zlib.zstdDecompressSync(fs.readFileSync(file)).toString('utf8')
      .split('\n').filter(line => line.trim().length > 0).map(line => JSON.parse(line))
const headerRow = rows.find(row => row.type === 'session')
const { type: _ignored, ...header } = headerRow
const events = rows.filter(row => row.type !== 'session')

function build() {
  return Session.create(SessionId(header.id), events, header)
}

function summarise(session) {
  const messages = session.deriveMessages()
  const roles = messages.map(m => m.role)
  const counts = roles.reduce((acc, role) => { acc[role] = (acc[role] ?? 0) + 1; return acc }, {})
  return { total: messages.length, roles: JSON.stringify(counts), first: (messages[0]?.content?.[0]?.text ?? '').slice(0, 40) }
}

function assistantIdOfTurn(session, turn) {
  const found = sessionEvents(session).find(event => event.type === 'assistant/message'
    && event.surfaceOp === 'append'
    && event.data.turn === turn)
  return found?.data.message.id
}

console.log('log:', path.basename(file))
console.log('header:', JSON.stringify({ version: header.version, isSeeded: header.isSeeded, agentPreset: header.agentPreset }))
console.log('events:', events.length)

const base = build()
console.log('surface nodes:', base.surface.nodes.length)
console.log('derived before:', JSON.stringify(summarise(base)))

const turns = wanted.length > 0 ? wanted : [...new Set(events.filter(e => e.type === 'turn/start').map(e => e.data.turn))]
if (process.argv.includes('--ids')) {
  for (const turn of turns) {
    const session = build()
    console.log(`${turn}\t${assistantIdOfTurn(session, turn) ?? '-'}`)
  }
  process.exit(0)
}
for (const turn of turns) {
  const session = build()
  const messageId = assistantIdOfTurn(session, turn)
  if (messageId === undefined) { console.log(`\nturn ${turn}: SKIP (no assistant message)`); continue }
  const before = summarise(session)
  try {
    const plan = planTurnDeletion(session, messageId)
    if (plan.alreadyDeleted) { console.log(`\nturn ${turn}: ALREADY ABSENT from the surface`); continue }
    const nextTurn = plan.turn + 1
    session.append('turn/start', { turn: nextTurn })
    session.append('step/start', { turn: nextTurn, step: 1 })
    const receipt = commitDeletion(session, plan, createSystemMessage, { turn: nextTurn, step: 1 })
    const after = summarise(session)
    const again = planTurnDeletion(session, messageId)
    console.log(`\nturn ${turn}: OK  span=[${plan.startSeq}..${plan.endSeq}] nodes=${plan.sourceEventSeqs.length} receipt=${JSON.stringify(receipt)}`)
    console.log(`  derived: ${before.total}->${after.total}  ${before.roles} -> ${after.roles}`)
    console.log(`  idempotent: ${again.alreadyDeleted === true}`)
    if (receipt.seq >= 0) {
      const tombstone = session.eventAt(receipt.seq)
      console.log(`  tombstone: type=${tombstone.type} turn=${tombstone.data.turn} step=${tombstone.data.step} source=${JSON.stringify(tombstone.data.message.source)} op=${JSON.stringify(tombstone.surfaceOp)}`)
    }
  } catch (error) {
    if (error instanceof TurnDeleteError) console.log(`\nturn ${turn}: REFUSED ${error.code} — ${error.message}`)
    else console.log(`\nturn ${turn}: THREW ${error?.name}: ${error?.message}`)
  }
}
