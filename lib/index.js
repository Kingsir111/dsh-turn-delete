/**
 * Host half of dsh-turn-delete.
 *
 * Deleting a finished turn cannot be a single append: session format v4 admits a
 * `system/message` row only while a turn and step are open, so the tombstone is
 * written at the next opened step. The request itself is durable, stored as an
 * ignorable plugin record that every other reader simply skips.
 *
 * @module dsh-turn-delete
 */

import { createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, appendPluginRecord } from '@deepseek-ai/dsh-session'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import {
  REQUEST_RECORD,
  RESULT_RECORD,
  TurnDeleteError,
  commitDeletion,
  commitImmediate,
  deletedTurns,
  pendingRequests,
  planTurnDeletion,
  refusedTurns,
  sessionEvents,
} from './core.js'

/** Bundle/plugin name. */
export const name = 'turn-delete'

/** Services this plugin needs before it can mount. */
export const inject = ['sessions', 'agents', 'webServer']

/** Route that requests one turn's deletion: `POST { sessionId, assistantMessageId }`. */
export const DELETE_ROUTE = '/dsh-turn-delete'

/** Route listing one session's turns with deletability, for the selection UI. */
export const TURNS_ROUTE = '/dsh-turn-delete/turns'
/** Route listing deletion state for one session. */
export const DELETED_ROUTE = '/dsh-turn-delete/deleted'

/**
 * Rescue route: adopt an unpacked session log as a brand-new live session.
 *
 * A log placed in the sessions directory by hand never reaches the Host's live
 * store, so the sidebar cannot list it. Creating the session through the store
 * announces it like any other new chat.
 */
export const IMPORT_ROUTE = '/dsh-turn-delete/import'

/** Build marker echoed by the state route, so a stale loaded generation is visible. */
export const BUILD = '0.6.0'

/**
 * Providers whose serializer drops an empty user message (`serialize.ts:123` in
 * `@deepseek-ai/dsh-llm-deepseek`): there the immediate carrier costs nothing.
 * Every other adapter sends it as-is, so those sessions fall back to the
 * deferred tombstone inside the next open step.
 */
function dropsEmptyUserMessage(provider) {
  return typeof provider === 'string' && provider.startsWith('deepseek')
}

/** Largest accepted request body, in bytes. */
const MAX_BODY_BYTES = 16 * 1024

/** Read a JSON request body with a hard size bound. */
function readJson(request) {
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder()
    let text = ''
    let bytes = 0
    let settled = false
    request.on('data', (chunk) => {
      if (settled) return
      bytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength
      if (bytes > MAX_BODY_BYTES) {
        settled = true
        reject(new TypeError('request body is too large'))
        return
      }
      text += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    })
    request.on('end', () => {
      if (settled) return
      settled = true
      try {
        text += decoder.decode()
        resolve(text.length === 0 ? {} : JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
  })
}

/** Write one JSON response with caching disabled. */
function respond(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(body))
}

/** Failure response shape shared by both routes. */
function respondError(response, status, code, message) {
  respond(response, status, { ok: false, error: { code, message } })
}

/** Map one failure code onto its HTTP status. */
function failureStatus(code) {
  if (code === 'TARGET_NOT_FOUND') return 404
  if (code === 'DELETE_FAILED') return 500
  return 409
}

/** Record one outcome on the session log; a failed record must not mask the delete. */
function recordOutcome(session, requestSeq, turn, outcome) {
  try {
    appendPluginRecord(session, RESULT_RECORD, { requestSeq, turn, requestedAt: Date.now(), ...outcome })
  } catch {
    // The tombstone is already committed; losing the receipt only affects the badge.
  }
}

/** Sessions whose pending requests are being applied right now. */
const applying = new WeakSet()

/**
 * Apply every pending request for one session inside the step that just opened.
 * @param {object} ctx - plugin context with `sessions`.
 * @param {object} session - session whose step started.
 * @param {{ turn: number, step: number }} open - the open step.
 */
export async function applyPending(ctx, session, open) {
  if (applying.has(session)) return
  if (ctx.sessions.get(session.id) !== session) return
  const pending = pendingRequests(session).sort((left, right) => right.turn - left.turn)
  if (pending.length === 0) return
  applying.add(session)
  try {
    for (const request of pending) {
      try {
        const plan = planTurnDeletion(session, request.assistantMessageId)
        if (plan.alreadyDeleted === true) {
          // Nothing of that turn is on the surface any more; settle the request
          // without writing a second tombstone.
          recordOutcome(session, request.seq, plan.turn, { status: 'applied', tombstoneSeq: null })
          continue
        }
        const receipt = commitDeletion(session, plan, createSystemMessage, open)
        recordOutcome(session, request.seq, plan.turn, { status: 'applied', tombstoneSeq: receipt.seq })
      } catch (error) {
        if (error instanceof TurnDeleteError) {
          recordOutcome(session, request.seq, request.turn, { status: 'refused', code: error.code, message: error.message })
          continue
        }
        recordOutcome(session, request.seq, request.turn, {
          status: 'failed',
          code: 'DELETE_FAILED',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    await ctx.sessions.flush(session)
  } finally {
    applying.delete(session)
  }
}

/**
 * Remove one or more turns, in one pass.
 *
 * Turns are resolved first and then committed from the highest turn down: each
 * commit rewrites the surface, so deleting the later turn first keeps every
 * earlier span valid. A turn that cannot be removed is reported instead of
 * aborting the rest.
 * @param {object} ctx - plugin context with `sessions`.
 * @param {object} agent - live agent handle.
 * @param {readonly string[]} assistantMessageIds - one assistant message per turn.
 * @returns {Promise<{ results: Array<{ turn: number, status: string, code?: string }>, immediate: boolean }>} per-turn outcome.
 */
export async function requestDeletions(ctx, agent, assistantMessageIds) {
  const session = agent.session
  if (ctx.sessions.get(session.id) !== session) {
    throw new TurnDeleteError('TARGET_NOT_FOUND', `session "${session.id}" is no longer live`)
  }
  const results = []
  const targets = new Map()
  for (const assistantMessageId of assistantMessageIds) {
    try {
      const plan = planTurnDeletion(session, assistantMessageId)
      if (plan.alreadyDeleted === true) {
        results.push({ turn: plan.turn, status: 'already-gone' })
        continue
      }
      targets.set(plan.turn, { assistantMessageId, turn: plan.turn })
    } catch (error) {
      if (!(error instanceof TurnDeleteError)) throw error
      results.push({ turn: -1, status: 'refused', code: error.code, message: error.message })
    }
  }

  const provider = agent.model?.current?.()?.provider
  const immediate = dropsEmptyUserMessage(provider)
  const ordered = [...targets.values()].sort((left, right) => right.turn - left.turn)

  for (const target of ordered) {
    try {
      // Re-plan against the surface as it is now: earlier commits moved spans.
      const plan = planTurnDeletion(session, target.assistantMessageId)
      if (plan.alreadyDeleted === true) {
        results.push({ turn: target.turn, status: 'already-gone' })
        continue
      }
      if (immediate) {
        const receipt = commitImmediate(session, plan, createUserMessage)
        recordOutcome(session, -1, plan.turn, { status: 'applied', tombstoneSeq: receipt.seq, mode: 'immediate' })
        results.push({ turn: target.turn, status: 'applied' })
      } else {
        appendPluginRecord(session, REQUEST_RECORD, {
          turn: plan.turn,
          assistantMessageId: target.assistantMessageId,
          requestedAt: Date.now(),
        })
        results.push({ turn: target.turn, status: 'deferred' })
      }
    } catch (error) {
      if (!(error instanceof TurnDeleteError)) throw error
      results.push({ turn: target.turn, status: 'refused', code: error.code, message: error.message })
    }
  }

  await ctx.sessions.flush(session)
  results.sort((left, right) => left.turn - right.turn)
  return { results, immediate }
}

/**
 * Remove a single turn.
 * @param {object} ctx - plugin context with `sessions`.
 * @param {object} agent - live agent handle.
 * @param {string} assistantMessageId - assistant message inside the target turn.
 * @returns {Promise<{ turn: number, status: string, immediate: boolean }>} the one outcome.
 */
export async function requestDeletion(ctx, agent, assistantMessageId) {
  const { results, immediate } = await requestDeletions(ctx, agent, [assistantMessageId])
  const first = results[0] ?? { turn: -1, status: 'refused', code: 'DELETE_FAILED' }
  return { ...first, immediate }
}

/** `POST /dsh-turn-delete`. */
async function handleDelete(ctx, request, response) {
  if (request.method !== 'POST') {
    response.writeHead(405, { allow: 'POST' })
    response.end()
    return
  }
  const contentType = request.headers?.['content-type']
  if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) {
    respondError(response, 415, 'INVALID_REQUEST', 'application/json required')
    return
  }
  try {
    const input = await readJson(request)
    if (typeof input.sessionId !== 'string' || input.sessionId.length === 0) {
      throw new TypeError('sessionId must be a non-empty string')
    }
    const ids = Array.isArray(input.assistantMessageIds)
      ? input.assistantMessageIds
      : [input.assistantMessageId]
    if (ids.length === 0 || ids.length > 64
      || ids.some(id => typeof id !== 'string' || id.length === 0)) {
      throw new TypeError('assistantMessageIds must hold 1..64 non-empty strings')
    }
    const agent = ctx.agents.get(SessionId(input.sessionId))
    if (agent === undefined) {
      throw new TurnDeleteError('TARGET_NOT_FOUND', `session "${input.sessionId}" is not active`)
    }
    respond(response, 202, { ok: true, value: await requestDeletions(ctx, agent, ids) })
  } catch (error) {
    if (error instanceof TurnDeleteError) {
      respondError(response, failureStatus(error.code), error.code, error.message)
      return
    }
    respondError(response, 400, 'INVALID_REQUEST', error instanceof Error ? error.message : String(error))
  }
}

/**
 * `POST /dsh-turn-delete/import` with `{ jsonPath, title? }`.
 *
 * Reads an unpacked session log (`<log>.json`, produced by
 * `test/unpack.mjs`), renames it to a fresh Session id and asks the store to
 * create and announce it. Used to recover a session the sidebar no longer lists.
 */
async function handleImport(ctx, request, response) {
  if (request.method !== 'POST') {
    response.writeHead(405, { allow: 'POST' })
    response.end()
    return
  }
  try {
    const input = await readJson(request)
    const jsonPath = input.jsonPath
    if (typeof jsonPath !== 'string' || !isAbsolute(jsonPath) || !jsonPath.endsWith('.json')) {
      throw new TypeError('jsonPath must be an absolute path to an unpacked .json log')
    }
    const rows = JSON.parse(await readFile(jsonPath, 'utf8'))
    if (!Array.isArray(rows)) throw new TypeError('log json must be an array of rows')
    const headerRow = rows.find(row => row.type === 'session')
    if (headerRow === undefined) throw new TypeError('log json has no session header row')
    const seed = rows.filter(row => row.type !== 'session')
    const sessionId = SessionId(`session-${randomUUID()}`)
    for (const event of seed) {
      if (event.data !== null && typeof event.data === 'object' && typeof event.data.sessionId === 'string') {
        event.data.sessionId = sessionId
      }
    }
    const title = typeof input.title === 'string' && input.title.length > 0 ? input.title : undefined
    if (title !== undefined) {
      for (const event of seed) {
        if (event.type === 'session/title') event.data = { ...event.data, title }
      }
    }
    const session = ctx.sessions.create(sessionId, {
      seed,
      inheritedEventCount: 0,
      meta: {
        ...(typeof headerRow.cwd === 'string' ? { cwd: headerRow.cwd } : {}),
        ...(typeof headerRow.createdAt === 'number' ? { createdAt: headerRow.createdAt } : {}),
        ...(typeof headerRow.agentPreset === 'string' ? { agentPreset: headerRow.agentPreset } : {}),
        isSeeded: false,
      },
    })
    await ctx.sessions.flush(session)
    respond(response, 200, { ok: true, value: { sessionId, events: seed.length, title: title ?? null } })
  } catch (error) {
    respondError(response, 400, 'IMPORT_FAILED', error instanceof Error ? error.message : String(error))
  }
}

/** `GET /dsh-turn-delete/turns?sessionId=…` — every turn with its last assistant message. */
async function handleTurns(ctx, request, response) {
  if (request.method !== 'GET') {
    response.writeHead(405, { allow: 'GET' })
    response.end()
    return
  }
  try {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const sessionId = url.searchParams.get('sessionId')
    if (sessionId === null || sessionId.length === 0) throw new TypeError('sessionId is required')
    const agent = ctx.agents.get(SessionId(sessionId))
    const session = agent?.session ?? ctx.sessions.get(SessionId(sessionId))
    if (session === undefined) {
      respond(response, 200, { ok: true, value: { turns: [], live: false } })
      return
    }
    const events = sessionEvents(session)
    const lastAssistant = new Map()
    const brackets = new Map()
    const previews = new Map()
    for (const event of events) {
      if (event.type === 'turn/start') brackets.set(event.data.turn, { start: event.seq, end: undefined })
      else if (event.type === 'turn/end') {
        const bracket = brackets.get(event.data.turn)
        if (bracket !== undefined) bracket.end = event.seq
      }
      if (event.type !== 'assistant/message' || event.surfaceOp !== 'append') continue
      lastAssistant.set(event.data.turn, event.data.message.id)
    }
    const textOf = message => (message?.content ?? []).map(block => block.text ?? '').join(' ').replace(/\s+/gu, ' ').trim()
    for (const event of events) {
      if (event.type !== 'user/message') continue
      const bracket = [...brackets.entries()].find(([, value]) => value.end !== undefined
        && event.seq > value.start && event.seq < value.end)
      if (bracket === undefined) continue
      const text = textOf(event.data)
      if (text.length === 0) continue
      const current = previews.get(bracket[0])
      if (current === undefined || text.length < current.length) previews.set(bracket[0], text)
    }
    const deleted = new Set(deletedTurns(session))
    const turns = []
    for (const turn of [...lastAssistant.keys()].sort((left, right) => left - right)) {
      const messageId = lastAssistant.get(turn)
      let deletable = !deleted.has(turn)
      let code
      if (deletable) {
        try {
          const plan = planTurnDeletion(session, messageId)
          if (plan.alreadyDeleted === true) deletable = false
        } catch (error) {
          deletable = false
          code = error instanceof TurnDeleteError ? error.code : 'DELETE_FAILED'
        }
      }
      const preview = previews.get(turn) ?? ''
      turns.push({
        turn,
        messageId,
        deleted: deleted.has(turn),
        deletable,
        preview: preview.length > 90 ? `${preview.slice(0, 90)}…` : preview,
        ...code === undefined ? {} : { code },
      })
    }
    respond(response, 200, { ok: true, value: { turns, live: true } })
  } catch (error) {
    respondError(response, 400, 'INVALID_REQUEST', error instanceof Error ? error.message : String(error))
  }
}

/** GET /dsh-turn-delete/deleted?sessionId=…. */
async function handleDeleted(ctx, request, response) {
  if (request.method !== 'GET') {
    response.writeHead(405, { allow: 'GET' })
    response.end()
    return
  }
  try {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const sessionId = url.searchParams.get('sessionId')
    if (sessionId === null || sessionId.length === 0) throw new TypeError('sessionId is required')
    const agent = ctx.agents.get(SessionId(sessionId))
    const session = agent?.session ?? ctx.sessions.get(SessionId(sessionId))
    respond(response, 200, {
      ok: true,
      value: session === undefined
        ? { turns: [], pending: [], refused: [], live: false, build: BUILD }
        : {
            turns: deletedTurns(session),
            pending: pendingRequests(session).map(item => item.turn),
            refused: refusedTurns(session).map(item => ({ turn: item.turn, code: item.code ?? 'DELETE_FAILED' })),
            live: true,
            build: BUILD,
          },
    })
  } catch (error) {
    respondError(response, 400, 'INVALID_REQUEST', error instanceof Error ? error.message : String(error))
  }
}

/**
 * Mount both routes and the step watcher.
 * @param {object} ctx - plugin context; needs `sessions`, `agents` and `webServer`.
 */
export function apply(ctx) {
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'step/start') return
    const open = { turn: event.data.turn, step: event.data.step }
    // A synchronous append inside this notification is rejected by the Session's
    // publication boundary, so the tombstone lands one microtask later — still
    // before the step's request is assembled.
    queueMicrotask(() => {
      void applyPending(ctx, session, open).catch(() => {})
    })
  })

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: DELETE_ROUTE,
      handler: (request, response) => handleDelete(ctx, request, response),
    }),
    'turn-delete: delete route',
  )
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: DELETED_ROUTE,
      handler: (request, response) => handleDeleted(ctx, request, response),
    }),
    'turn-delete: deleted-turns route',
  )
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: TURNS_ROUTE,
      handler: (request, response) => handleTurns(ctx, request, response),
    }),
    'turn-delete: turns route',
  )
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: IMPORT_ROUTE,
      handler: (request, response) => handleImport(ctx, request, response),
    }),
    'turn-delete: session rescue route',
  )
}

/** Re-export the record types so the client bundle and tests agree on names. */
export { REQUEST_RECORD, RESULT_RECORD, sessionEvents }








