/**
 * Deletion core: plan a past turn's removal from the model-visible surface and
 * commit it as one empty `system/message` replacement.
 *
 * Two hard constraints drive the shape of this module:
 *
 * 1. Session format v4 admits a `system/message` row only while a turn **and**
 *    step are open (`system/message does not match an open turn and step`), so a
 *    tombstone can never be appended to a finished turn. The deletion therefore
 *    runs inside the next opened step, and the row carries that step's numbers.
 * 2. A replacement must cite every shadowed surface node and may not touch the
 *    protected system-prompt head at node 0.
 *
 * Pure planning + one commit step; the caller owns the kernel imports so the
 * same code runs inside the Host plugin and inside the offline simulators.
 * @module turn-delete/core
 */

/** Failure raised when a turn cannot be removed; `code` is the public contract. */
export class TurnDeleteError extends Error {
  /**
   * @param {string} code - stable error code.
   * @param {string} message - human-readable reason (English; UI localizes by code).
   */
  constructor(code, message) {
    super(message)
    this.name = 'TurnDeleteError'
    this.code = code
  }
}

/** Plugin record type carrying one deletion request. */
export const REQUEST_RECORD = 'plugin:turn-delete/request'

/** Plugin record type carrying the outcome of one deletion request. */
export const RESULT_RECORD = 'plugin:turn-delete/result'

/** Read a Session's event array on either kernel line. */
export function sessionEvents(session) {
  if (typeof session.snapshotEvents === 'function') return session.snapshotEvents()
  return session.events ?? []
}

/** Whether an event is one of this plugin's ignorable records. */
function recordOf(event, type) {
  return event.ignorable === true && event.type === type ? event.data : undefined
}

/** Turn number an event declares, for the event types that carry one. */
function eventTurn(event) {
  if (event.type === 'assistant/message' || event.type === 'tool/result') return event.data.turn
  return undefined
}

/** Walk `sourceEventSeqs` back to the append-origin surface nodes an event derives from. */
function surfaceOrigins(seq, events, memo, visiting = new Set()) {
  const cached = memo.get(seq)
  if (cached !== undefined) return cached
  if (visiting.has(seq)) return new Set()
  visiting.add(seq)
  const event = events[seq]
  const origins = new Set()
  if (event !== undefined) {
    if (event.surfaceOp === 'append') origins.add(seq)
    const sources = event.sourceEventSeqs ?? []
    for (const source of sources) {
      for (const origin of surfaceOrigins(source, events, memo, visiting)) origins.add(origin)
    }
  }
  visiting.delete(seq)
  memo.set(seq, origins)
  return origins
}

/** Closed seq bracket of one turn, or undefined when the turn never closed. */
function turnBracket(events, turn, targetSeq) {
  const start = events.findLast(event => event.seq <= targetSeq && event.type === 'turn/start' && event.data.turn === turn)
  const end = events.find(event => event.seq >= targetSeq && event.type === 'turn/end' && event.data.turn === turn)
  if (start === undefined || end === undefined) return undefined
  return { start: start.seq, end: end.seq }
}

/**
 * Plan the removal of one turn.
 *
 * The plan is a positional replacement over a contiguous span of the current
 * surface, plus the exact source-event citations the kernel demands.
 * @param {object} session - live or reconstructed Session.
 * @param {string} assistantMessageId - id of any assistant message inside the target turn.
 * @returns {{ turn: number, step: number, startSeq: number, endSeq: number, sourceEventSeqs: number[] }} plan.
 * @throws {TurnDeleteError} when the turn cannot be removed as one span.
 */
export function planTurnDeletion(session, assistantMessageId) {
  const events = sessionEvents(session)
  const target = events.find(event => event.type === 'assistant/message'
    && event.surfaceOp === 'append'
    && event.data.message.id === assistantMessageId)
  if (target === undefined) throw new TurnDeleteError('TARGET_NOT_FOUND', `assistant message "${assistantMessageId}" was not found`)
  const turn = target.data.turn
  const bracket = turnBracket(events, turn, target.seq)
  if (bracket === undefined) throw new TurnDeleteError('TURN_NOT_CLOSED', `turn ${turn} is not closed`)
  const nodes = [...session.surface.nodes]
  const head = nodes[0]
  const headIsSystemPrompt = head !== undefined && events[head]?.type === 'system/message'

  // Every append-origin node that belongs to this turn. The protected head is
  // the session's own system prompt: it stays, both because the kernel refuses
  // to shadow it from a multi-node replacement and because the session needs it.
  const originSeqs = new Set()
  for (const event of events) {
    if (event.surfaceOp !== 'append') continue
    const inBracket = event.seq > bracket.start && event.seq < bracket.end
    if (!inBracket && eventTurn(event) !== turn) continue
    if (headIsSystemPrompt && event.seq === head) continue
    originSeqs.add(event.seq)
  }
  if (originSeqs.size === 0) throw new TurnDeleteError('TURN_PROTECTED', `turn ${turn} holds nothing but the session system prompt`)

  // Nothing of this turn is on the surface any more: either this plugin already
  // replaced it, or compaction folded it away. Both are terminal and idempotent.
  if (!nodes.some(seq => originSeqs.has(seq))) {
    return { turn, step: target.data.step, startSeq: undefined, endSeq: undefined, sourceEventSeqs: [], alreadyDeleted: true }
  }

  // The newest system node is the prompt every later request still relies on.
  let lastSystemSeq
  for (let index = nodes.length - 1; index >= 0; index--) {
    if (events[nodes[index]]?.type === 'system/message') { lastSystemSeq = nodes[index]; break }
  }

  const memo = new Map()
  const selected = []
  const covered = new Set()
  for (const seq of nodes) {
    const origins = surfaceOrigins(seq, events, memo)
    const fromTurn = [...origins].filter(origin => originSeqs.has(origin))
    if (fromTurn.length === 0) continue
    if ([...origins].some(origin => !originSeqs.has(origin))) {
      throw new TurnDeleteError('TURN_COMPACTED', `turn ${turn} shares a surface node with other history`)
    }
    const current = events[seq]
    const localReplacement = current !== undefined
      && !originSeqs.has(seq)
      && !(current.type === 'tool/result' && current.data.turn === turn)
    if (localReplacement) throw new TurnDeleteError('TURN_COMPACTED', `turn ${turn} contains a replacement that other history shares`)
    if (seq === lastSystemSeq) {
      throw new TurnDeleteError('TURN_PROTECTED', `turn ${turn} carries the active system prompt; deleting it would strip the system prompt from later requests`)
    }
    selected.push(seq)
    for (const origin of fromTurn) covered.add(origin)
  }
  if (selected.length === 0) throw new TurnDeleteError('TURN_COMPACTED', `turn ${turn} is not present in the current surface`)
  const missing = [...originSeqs].filter(origin => !covered.has(origin))
  if (missing.length > 0) {
    throw new TurnDeleteError('TURN_COMPACTED', `turn ${turn} is partially replaced already; missing ${missing.join(', ')}`)
  }
  const firstPosition = nodes.indexOf(selected[0])
  const contiguous = selected.every((seq, index) => nodes.indexOf(seq) === firstPosition + index)
  if (!contiguous) throw new TurnDeleteError('TURN_COMPACTED', `turn ${turn} is not a contiguous surface span`)
  return {
    turn,
    step: target.data.step,
    startSeq: selected[0],
    endSeq: selected[selected.length - 1],
    sourceEventSeqs: selected,
  }
}

/** Build one empty system message: it occupies a surface node and sends no wire content. */
function tombstoneMessage(createSystemMessage) {
  const message = createSystemMessage('')
  return { ...message, source: { kind: 'system-prompt' } }
}

/** Build one empty user message: a legal out-of-turn carrier that sends no wire content. */
function emptyUserMessage(createUserMessage) {
  return createUserMessage({ content: [], source: { kind: 'user' } })
}

/**
 * Remove one turn immediately, outside any turn.
 *
 * A `user/message` replacement is the only surface carrier that session format v4
 * admits outside an open turn/step (the kernel's own compaction shadows ranges the
 * same way). Its empty content is dropped by the DeepSeek serializer, so it costs
 * nothing in the request; adapters that would send it instead use
 * {@link commitDeletion} inside the next open step.
 * @param {object} session - Session that produced the plan.
 * @param {object} plan - result of {@link planTurnDeletion}.
 * @param {(input: object) => object} createUserMessage - kernel message factory.
 * @returns {{ turn: number, seq: number, immediate: true }} receipt.
 */
export function commitImmediate(session, plan, createUserMessage) {
  const event = session.append('user/message', emptyUserMessage(createUserMessage), {
    surfaceOp: { op: 'replace', startSeq: plan.startSeq, endSeq: plan.endSeq },
    sourceEventSeqs: plan.sourceEventSeqs,
  })
  return { turn: plan.turn, seq: event.seq, immediate: true }
}

/**
 * Append the tombstone for one plan inside the currently open turn/step.
 * @param {object} session - Session that produced the plan.
 * @param {object} plan - result of {@link planTurnDeletion}.
 * @param {(text: string) => object} createSystemMessage - kernel message factory.
 * @param {{ turn: number, step: number }} open - currently open turn and step.
 * @returns {{ turn: number, seq: number }} receipt.
 */
export function commitDeletion(session, plan, createSystemMessage, open) {
  const event = session.append('system/message', {
    turn: open.turn,
    step: open.step,
    message: tombstoneMessage(createSystemMessage),
  }, {
    surfaceOp: { op: 'replace', startSeq: plan.startSeq, endSeq: plan.endSeq },
    sourceEventSeqs: plan.sourceEventSeqs,
  })
  return { turn: plan.turn, seq: event.seq }
}

/** Deletion requests still waiting for an open step, in log order. */
export function pendingRequests(session) {
  const done = new Set()
  const requests = []
  for (const event of sessionEvents(session)) {
    const result = recordOf(event, RESULT_RECORD)
    if (result !== undefined) { done.add(result.requestSeq); continue }
    const request = recordOf(event, REQUEST_RECORD)
    if (request === undefined) continue
    requests.push({ seq: event.seq, ...request })
  }
  return requests.filter(request => !done.has(request.seq))
}

/** Turns whose deletion landed, newest request per turn winning. */
export function deletedTurns(session) {
  const byTurn = new Map()
  for (const event of sessionEvents(session)) {
    const result = recordOf(event, RESULT_RECORD)
    if (result !== undefined && typeof result.turn === 'number') byTurn.set(result.turn, result.status)
  }
  return [...byTurn.entries()].filter(([, status]) => status === 'applied').map(([turn]) => turn).sort((a, b) => a - b)
}

/** Turns whose deletion was refused, with the reason code. */
export function refusedTurns(session) {
  const byTurn = new Map()
  for (const event of sessionEvents(session)) {
    const result = recordOf(event, RESULT_RECORD)
    if (result !== undefined && typeof result.turn === 'number') byTurn.set(result.turn, result)
  }
  return [...byTurn.values()].filter(result => result.status !== 'applied')
}
