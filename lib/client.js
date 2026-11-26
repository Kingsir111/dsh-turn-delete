window.__ModuleLoader__.load({
  id: 'dsh-turn-delete',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'turn-delete'
    const DELETE_ROUTE = '/dsh-turn-delete'
    const DELETED_ROUTE = '/dsh-turn-delete/deleted'
    const REQUEST_TIMEOUT_MS = 15000

    const zh = {
      'action.delete': '从上下文删除这一轮',
      'action.busy': '任务运行中，结束后才能删除',
      'confirm.title': '删除这一轮？',
      'confirm.body': '本轮提问、回答与工具记录会从后续模型上下文中移除，Session 本身与之后的轮次保留。',
      'confirm.ok': '删除',
      'confirm.cancel': '取消',
      'confirm.working': '删除中…',
      'mark.deleted': '此轮已从上下文删除',
      'mark.pending': '已登记：下一次提问起生效',
      'error.busy': '任务正在运行，请结束后再删。',
      'error.compacted': '这一轮已与其他历史合并压缩，无法单独删除。',
      'error.protected': '这一轮包含当前生效的系统提示，删掉会让后续请求丢失系统提示，已拒绝。',
      'error.missing': '这一轮已变化或不存在，无法删除。',
      'error.failed': '删除失败：',
      'error.network': '请求没有到达 Host（网络或跨域被拦）。',
      'error.timeout': 'Host 超过 15 秒没有响应。',
      'error.noSession': '缺少会话标识，无法定位要删的会话。',
    }
    const en = {
      'action.delete': 'Delete this turn from context',
      'action.busy': 'Wait for the task to finish before deleting',
      'confirm.title': 'Delete this turn?',
      'confirm.body': 'The prompt, response and tool records of this turn leave the model context. The Session and its later turns stay.',
      'confirm.ok': 'Delete',
      'confirm.cancel': 'Cancel',
      'confirm.working': 'Deleting…',
      'mark.deleted': 'This turn is out of context',
      'mark.pending': 'Queued: applies from your next message',
      'error.busy': 'The task is running. Delete after it finishes.',
      'error.compacted': 'This turn is already folded into other history and cannot be removed alone.',
      'error.protected': 'This turn carries the active system prompt; deleting it would strip the prompt from later requests.',
      'error.missing': 'This turn changed or no longer exists.',
      'error.failed': 'Deletion failed: ',
      'error.network': 'The request did not reach the Host (network or cross-origin block).',
      'error.timeout': 'The Host did not answer within 15 seconds.',
      'error.noSession': 'No session identity, so the target session cannot be resolved.',
    }

    const styles = {
      button: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 28, height: 28, padding: 6, border: 'none', borderRadius: 28,
        background: 'transparent', color: 'var(--dsw-alias-label-tertiary, #6b7280)', cursor: 'pointer',
      },
      row: { display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 360 },
      text: { fontSize: 12, lineHeight: '16px', color: 'var(--dsw-alias-label-secondary, #4b5563)' },
      error: {
        fontSize: 12, lineHeight: '16px', color: 'var(--dsw-alias-state-error-primary, #dc2626)',
        maxWidth: 340, whiteSpace: 'normal',
      },
      chip: {
        display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, lineHeight: '14px',
        color: 'var(--dsw-alias-label-tertiary, #6b7280)',
      },
      confirm: {
        display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-secondary, #e5e7eb)',
        background: 'var(--dsw-alias-bg-secondary, #fff)',
      },
      small: {
        border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12, padding: '2px 4px',
        color: 'var(--dsw-alias-label-primary, #111827)',
      },
      smallDanger: {
        border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12, padding: '2px 4px',
        color: 'var(--dsw-alias-state-error-primary, #dc2626)',
      },
    }

    /** Trash glyph drawn inline so the action row never depends on an icon export. */
    function TrashGlyph() {
      return h('svg', {
        width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': 'true', focusable: 'false',
      },
        h('path', { d: 'M2.75 4.25h10.5', stroke: 'currentColor', strokeWidth: 1, strokeLinecap: 'round' }),
        h('path', { d: 'M6.45 6.99v4.14M9.55 6.99v4.14', stroke: 'currentColor', strokeWidth: 1, strokeLinecap: 'round' }),
        h('path', {
          d: 'M4.15 4.25l.5 8.08a1.1 1.1 0 0 0 1.1 1.02h4.5a1.1 1.1 0 0 0 1.1-1.02l.5-8.08',
          stroke: 'currentColor', strokeWidth: 1, strokeLinejoin: 'round',
        }),
      )
    }

    /** Stand-in hook used when the framework does not inject a session snapshot. */
    function NOOP_HOOK() {
      return false
    }

    /**
     * Host origin for our routes.
     *
     * The served web app and this plugin share an origin, so a relative path is
     * enough there. The desktop shell can instead load the page from another
     * origin and hand the Host URL over through `__DSH_TRANSPORT__`; using that
     * base keeps the same request working in both shells.
     */
    function hostBase() {
      const transport = globalThis.__DSH_TRANSPORT__
      const base = transport === undefined || transport === null ? undefined : transport.streamBaseUrl
      if (typeof base !== 'string' || base.length === 0) return ''
      return base.endsWith('/') ? base.slice(0, -1) : base
    }

    /** Base URLs to try, most-native first: same origin, then the desktop Host URL. */
    function bases() {
      const base = hostBase()
      return base === '' ? [''] : ['', base]
    }

    /**
     * One JSON request over every candidate base.
     *
     * Network-level failures fall through to the next base; an HTTP answer of
     * any status is returned as-is so a 409 is never retried.
     */
    async function requestJson(path, init) {
      let lastError
      for (const base of bases()) {
        try {
          const response = await fetch(`${base}${path}`, init)
          const text = await response.text()
          let body
          try {
            body = JSON.parse(text)
          } catch {
            body = undefined
          }
          return { response, text, body }
        } catch (error) {
          lastError = error
        }
      }
      throw lastError ?? new Error('request failed')
    }

    // ---- deleted-turn cache shared by both slots ---------------------------------

    const caches = new Map()

    function cacheFor(sessionId) {
      let cache = caches.get(sessionId)
      if (cache === undefined) {
        cache = {
          applied: new Set(),
          pending: new Set(),
          refused: new Map(),
          listeners: new Set(),
          loading: undefined,
          loaded: false,
        }
        caches.set(sessionId, cache)
      }
      return cache
    }

    function notify(cache) {
      for (const listener of [...cache.listeners]) listener()
    }

    async function loadDeleted(sessionId, force) {
      const cache = cacheFor(sessionId)
      if (cache.loaded && force !== true) return cache
      if (cache.loading === undefined) {
        cache.loading = (async () => {
          try {
            const answer = await requestJson(`${DELETED_ROUTE}?sessionId=${encodeURIComponent(sessionId)}`, { method: 'GET' })
            const body = answer.body
            if (body?.ok === true && Array.isArray(body.value?.turns)) {
              cache.applied = new Set(body.value.turns)
              cache.pending = new Set(Array.isArray(body.value.pending) ? body.value.pending : [])
              cache.refused = new Map((Array.isArray(body.value.refused) ? body.value.refused : [])
                .map(item => [item.turn, item.code]))
              cache.loaded = true
            }
          } catch {
            // A cold Host or a stale page is not an error the user can act on.
          } finally {
            cache.loading = undefined
            notify(cache)
          }
        })()
      }
      await cache.loading
      return cache
    }

    /** Record a queued deletion locally so the row disappears before the next step. */
    function markPending(sessionId, turn) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return
      const cache = cacheFor(sessionId)
      cache.refused.delete(turn)
      cache.pending = new Set([...cache.pending, turn])
      notify(cache)
    }

    /** Record an applied deletion locally. */
    function markApplied(sessionId, turn) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return
      const cache = cacheFor(sessionId)
      cache.refused.delete(turn)
      cache.applied = new Set([...cache.applied, turn])
      cache.pending = new Set([...cache.pending].filter(item => item !== turn))
      notify(cache)
    }

    /** Turn state for one row: 'applied', 'pending' or 'refused'. */
    function stateOf(sessionId, turn) {
      const cache = cacheFor(sessionId)
      if (cache.applied.has(turn)) return 'applied'
      if (cache.pending.has(turn)) return 'pending'
      if (cache.refused.has(turn)) return cache.refused.get(turn)
      return undefined
    }

    function useDeletedTurns(sessionId) {
      const cache = useMemo(() => cacheFor(sessionId ?? ''), [sessionId])
      const [, bump] = useState(0)
      const usable = typeof sessionId === 'string' && sessionId.length > 0
      useEffect(() => {
        if (!usable) return undefined
        const listener = () => bump(value => value + 1)
        cache.listeners.add(listener)
        void loadDeleted(sessionId, false)
        return () => { cache.listeners.delete(listener) }
      }, [cache, sessionId, usable])
      return sessionId
    }

    /**
     * Last outcome per assistant message.
     *
     * The action row can unmount while a request is in flight (hover-revealed
     * rows re-render away), so a result must survive the component instance:
     * otherwise a failure silently disappears and the button just comes back.
     */
    const outcomes = new Map()

    // ---- row concealment ---------------------------------------------------------

    /** Chat rows belonging to the turn whose tail holds `marker`. */
    function turnRows(marker) {
      const tailRow = marker.closest('[data-chat-flow-kind="turn-tail"]')
        ?? marker.closest('[data-turn-tail]')
      if (tailRow === undefined || tailRow === null) return []
      const rows = [tailRow]
      let cursor = tailRow.previousElementSibling
      while (cursor instanceof HTMLElement) {
        if (cursor.querySelector('[data-turn-tail]') !== null) break
        rows.push(cursor)
        cursor = cursor.previousElementSibling
      }
      return rows
    }

    let concealSequence = 0

    function concealFrom(element, turn) {
      if (element === null || element === undefined) return
      const marker = element.closest('[data-turn-tail]') ?? element
      const owner = `${String(turn)}-${String(++concealSequence)}`
      for (const row of turnRows(marker)) {
        row.dataset.dshTurnDeleteOwner = owner
        row.hidden = true
      }
    }

    function concealTurn(marker, turn) {
      const owner = `${String(turn)}-${String(++concealSequence)}`
      const changed = []
      for (const element of turnRows(marker)) {
        changed.push({ element, hidden: element.hidden })
        element.dataset.dshTurnDeleteOwner = owner
        element.hidden = true
      }
      return () => {
        for (const entry of changed) {
          if (entry.element.dataset.dshTurnDeleteOwner !== owner) continue
          delete entry.element.dataset.dshTurnDeleteOwner
          entry.element.hidden = entry.hidden
        }
      }
    }

    // ---- transport ---------------------------------------------------------------

    /** POST one deletion; never throws, always reports a reason. */
    async function requestDelete(sessionId, assistantMessageId) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        return { ok: false, error: { code: 'NO_SESSION', message: 'sessionId is missing' } }
      }
      const controller = typeof AbortController === 'function' ? new AbortController() : undefined
      const timer = controller === undefined
        ? undefined
        : setTimeout(() => { controller.abort() }, REQUEST_TIMEOUT_MS)
      try {
        const answer = await requestJson(DELETE_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, assistantMessageId }),
          ...(controller === undefined ? {} : { signal: controller.signal }),
        })
        const { response, text, body } = answer
        if (body === undefined) {
          return {
            ok: false,
            error: { code: 'DELETE_FAILED', message: `HTTP ${String(response.status)}: ${text.slice(0, 160)}` },
          }
        }
        if (typeof body !== 'object' || body === null || typeof body.ok !== 'boolean') {
          return {
            ok: false,
            error: { code: 'DELETE_FAILED', message: `HTTP ${String(response.status)}: unexpected body` },
          }
        }
        return body
      } catch (error) {
        const aborted = error instanceof Error && error.name === 'AbortError'
        return {
          ok: false,
          error: {
            code: aborted ? 'TIMEOUT' : 'NETWORK',
            message: error instanceof Error ? error.message : String(error),
          },
        }
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    }

    /** Map a Host failure onto one localized line. */
    function messageFor(error, t) {
      const code = error?.code
      const detail = String(error?.message ?? '').slice(0, 180)
      if (code === 'AGENT_BUSY') return `${t('error.busy')} [AGENT_BUSY]`
      if (code === 'TURN_COMPACTED') return `${t('error.compacted')} [TURN_COMPACTED]`
      if (code === 'TURN_PROTECTED') return `${t('error.protected')} [TURN_PROTECTED]`
      if (code === 'TARGET_NOT_FOUND' || code === 'TURN_NOT_CLOSED') return `${t('error.missing')} [${String(code)}]`
      if (code === 'NETWORK') return `${t('error.network')} [NETWORK: ${detail}]`
      if (code === 'TIMEOUT') return `${t('error.timeout')} [TIMEOUT]`
      if (code === 'NO_SESSION') return `${t('error.noSession')} [NO_SESSION]`
      return `${t('error.failed')}${detail || String(code ?? '')} [${String(code ?? 'UNKNOWN')}]`
    }

    // ---- assistant-actions slot: the delete control ------------------------------

    function TurnDeleteAction(props) {
      const { messageId, t, deleteTurn } = props
      const sessionId = props.sessionId
      const initial = outcomes.get(messageId)
      const [stage, setStage] = useState(initial === undefined ? 'idle' : 'failed')
      const [error, setError] = useState(initial === undefined ? null : initial.message)
      // Row element captured at click time: a ref callback would be cleared when
      // this button unmounts to show the confirm step.
      const rowRef = useRef(null)
      // Presence is constant per mount, so the hook count stays stable.
      const useSession = typeof props.useSession === 'function' ? props.useSession : NOOP_HOOK
      const running = useSession(snapshot => snapshot?.running === true)
      const tr = typeof t === 'function' ? t : key => key

      const confirm = useCallback(() => {
        setStage('working')
        setError(null)
        const row = rowRef.current
        const run = typeof deleteTurn === 'function'
          ? deleteTurn(messageId)
          : requestDelete(sessionId, messageId)
        Promise.resolve(run).then(result => {
          if (result !== undefined && typeof result.ok === 'boolean') {
            if (result.ok === true) {
              outcomes.delete(messageId)
              const turn = result.value?.turn
              if (typeof turn === 'number') {
                if (result.value?.applied === true) markApplied(sessionId, turn)
                else markPending(sessionId, turn)
                concealFrom(row, turn)
              }
              setStage('idle')
              return
            }
            const message = messageFor(result.error, tr)
            outcomes.set(messageId, { message })
            if (typeof console !== 'undefined') console.error('[turn-delete]', result.error)
            setStage('failed')
            setError(message)
            return
          }
          const message = messageFor({ code: 'UNKNOWN' }, tr)
          outcomes.set(messageId, { message })
          setStage('failed')
          setError(message)
        }).catch(reason => {
          const message = messageFor({ code: 'NETWORK', message: String(reason) }, tr)
          outcomes.set(messageId, { message })
          setStage('failed')
          setError(message)
        })
      }, [deleteTurn, messageId, sessionId, tr])

      if (stage === 'working') {
        return h('div', { style: styles.row },
          h('span', { style: styles.text }, tr('confirm.working')),
        )
      }

      if (stage === 'failed') {
        return h('div', { style: styles.row, role: 'alert' },
          h('span', { style: styles.error }, error),
          h('button', {
            type: 'button',
            style: styles.small,
            onClick: () => { outcomes.delete(messageId); setError(null); setStage('idle') },
          }, tr('confirm.cancel')),
        )
      }

      if (stage === 'confirm') {
        return h('div', { style: styles.confirm, role: 'group', 'aria-label': tr('confirm.title') },
          h('button', { type: 'button', style: styles.smallDanger, onClick: confirm }, tr('confirm.ok')),
          h('button', { type: 'button', style: styles.small, onClick: () => setStage('idle') }, tr('confirm.cancel')),
        )
      }

      return h('button', {
        type: 'button',
        style: { ...styles.button, opacity: running ? 0.4 : 1, cursor: running ? 'default' : 'pointer' },
        title: running ? tr('action.busy') : tr('action.delete'),
        'aria-label': tr('action.delete'),
        'aria-disabled': running || undefined,
        onClick: running ? undefined : event => {
          rowRef.current = event.currentTarget.closest('[data-turn-tail]') ?? event.currentTarget
          setStage('confirm')
          setError(null)
        },
      }, h(TrashGlyph, {}))
    }

    // ---- turnTail slot: durable "already deleted" marker -------------------------

    function DeletedTurnMarker(props) {
      const { turn, t } = props
      const markerRef = useRef(null)
      const tr = typeof t === 'function' ? t : key => key
      const sessionId = useDeletedTurns(props.sessionId)
      const state = stateOf(sessionId, turn)
      const isDeleted = state === 'applied' || state === 'pending'

      useEffect(() => {
        if (!isDeleted) return undefined
        const marker = markerRef.current
        if (marker === null) return undefined
        const list = marker.closest('[data-chat-flow-kind="turn-tail"]')?.parentElement
        let restore = concealTurn(marker, turn)
        if (list === undefined || list === null) return () => { restore() }
        const observer = new MutationObserver(() => {
          restore()
          restore = concealTurn(marker, turn)
        })
        observer.observe(list, { childList: true, subtree: true })
        return () => {
          observer.disconnect()
          restore()
        }
      }, [isDeleted, turn])

      if (!isDeleted) return null
      return h('span', { ref: markerRef, style: styles.chip, 'data-dsh-deleted-turn': turn },
        state === 'applied' ? tr('mark.deleted') : tr('mark.pending'))
    }

    // ---- plugin export -----------------------------------------------------------

    const inject = ['slots', 'locale', 'uiConversation']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'turn-delete: dictionaries')

      ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
        name: 'conversation.chat.assistant-actions',
        id: 'turn-delete',
        order: 90,
        locale: NS,
        inject: (sessionId) => ({
          sessionId,
          deleteTurn: (assistantMessageId) => requestDelete(sessionId, assistantMessageId),
        }),
      }, TurnDeleteAction))

      ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
        name: 'conversation.chat.turnTail',
        id: 'turn-delete-marker',
        order: 50,
        locale: NS,
        inject: (sessionId) => ({ sessionId }),
      }, DeletedTurnMarker))
    }

    return { inject, apply }
  },
})
