window.__ModuleLoader__.load({
  id: 'dsh-turn-delete',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'turn-delete'
    const DELETE_ROUTE = '/dsh-turn-delete'
    const DELETED_ROUTE = '/dsh-turn-delete/deleted'
    const TURNS_ROUTE = '/dsh-turn-delete/turns'
    const REQUEST_TIMEOUT_MS = 20000

    const zh = {
      'action.enter': '选择要删除的轮次',
      'bar.selected': '已选 {count} 轮',
      'bar.hint': '点任意一轮选中，再点取消；可多选',
      'bar.confirm': '确认删除',
      'bar.cancel': '退出',
      'dialog.title': '删除 {count} 轮对话？',
      'dialog.body': '这些轮次会从后续模型上下文中移除，Session、标题与之后的轮次都保留。原始提问、回复与工具记录仍留在日志里，可审计、可回放。',
      'dialog.note': '删除不可撤销 · 只影响上下文，不改写日志',
      'dialog.confirm': '删除 {count} 轮',
      'dialog.cancel': '取消',
      'dialog.working': '正在删除…',
      'mark.deleted': '此轮已从上下文删除',
      'mark.pending': '已登记：下一次提问起生效',
      'pick.disabled': '这一轮无法删除',
      'error.busy': '任务正在运行，请结束后再删。',
      'error.compacted': '这一轮已与其他历史合并压缩，无法单独删除。',
      'error.protected': '这一轮包含当前生效的系统提示，删掉会让后续请求丢失系统提示，已拒绝。',
      'error.missing': '这一轮已变化或不存在，无法删除。',
      'error.failed': '删除失败：',
      'error.network': '请求没有到达 Host（网络或跨域被拦）。',
      'error.timeout': 'Host 超过 20 秒没有响应。',
      'error.noSession': '缺少会话标识，无法定位要删的会话。',
      'error.partial': '{ok} 轮已删，{bad} 轮被拒绝：{code}',
    }
    const en = {
      'action.enter': 'Choose turns to delete',
      'bar.selected': '{count} selected',
      'bar.hint': 'Click a turn to select it, click again to clear',
      'bar.confirm': 'Delete',
      'bar.cancel': 'Exit',
      'dialog.title': 'Delete {count} turns?',
      'dialog.body': 'These turns leave the model context. The Session, its title and its later turns stay. The original prompts, replies and tool records remain in the log, auditable and replayable.',
      'dialog.note': 'Not reversible · context only, the log is untouched',
      'dialog.confirm': 'Delete {count}',
      'dialog.cancel': 'Cancel',
      'dialog.working': 'Deleting…',
      'mark.deleted': 'This turn is out of context',
      'mark.pending': 'Queued: applies from your next message',
      'pick.disabled': 'This turn cannot be deleted',
      'error.busy': 'The task is running. Delete after it finishes.',
      'error.compacted': 'This turn is already folded into other history and cannot be removed alone.',
      'error.protected': 'This turn carries the active system prompt; deleting it would strip the prompt from later requests.',
      'error.missing': 'This turn changed or no longer exists.',
      'error.failed': 'Deletion failed: ',
      'error.network': 'The request did not reach the Host (network or cross-origin block).',
      'error.timeout': 'The Host did not answer within 20 seconds.',
      'error.noSession': 'No session identity, so the target session cannot be resolved.',
      'error.partial': '{ok} deleted, {bad} refused: {code}',
    }

    const styles = {
      button: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 28, height: 28, padding: 6, border: 'none', borderRadius: 28,
        background: 'transparent', color: 'var(--dsw-alias-label-tertiary, #6b7280)', cursor: 'pointer',
      },
      checkbox: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 18, height: 18, marginRight: 8, borderRadius: 6, flex: 'none',
        border: '1.5px solid var(--dsw-alias-border-secondary, #c9d8ff)',
        background: 'var(--dsw-alias-bg-secondary, #fff)', cursor: 'pointer', padding: 0,
      },
      checkboxOn: {
        border: '1.5px solid #4d6bfe', background: '#4d6bfe',
      },
      tick: { width: 8, height: 4, borderLeft: '2px solid #fff', borderBottom: '2px solid #fff', transform: 'rotate(-45deg) translateY(-1px)' },
      chip: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, lineHeight: '14px', color: 'var(--dsw-alias-label-tertiary, #6b7280)' },
      bar: {
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 60,
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px',
        background: 'var(--dsw-alias-bg-elevated, #ffffff)', borderTop: '1px solid var(--dsw-alias-border-secondary, #e3e9f8)',
        boxShadow: '0 -6px 24px rgba(20, 30, 80, .10)', fontSize: 13,
      },
      barCount: { fontWeight: 700, color: 'var(--dsw-alias-label-primary, #16204a)' },
      barHint: { color: 'var(--dsw-alias-label-tertiary, #6b7280)', fontSize: 12 },
      spacer: { flex: 1 },
      btn: {
        fontSize: 12.5, padding: '7px 14px', borderRadius: 10,
        border: '1px solid var(--dsw-alias-border-secondary, #dbe3f7)',
        background: 'var(--dsw-alias-bg-secondary, #fff)', color: 'var(--dsw-alias-label-primary, #3a4674)', cursor: 'pointer',
      },
      btnPrimary: { background: '#4d6bfe', borderColor: '#4d6bfe', color: '#fff' },
      btnGhost: { borderColor: 'transparent', color: 'var(--dsw-alias-label-tertiary, #6b7280)' },
      scrim: {
        position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(16, 24, 60, .28)',
      },
      dialog: {
        width: 430, maxWidth: 'calc(100vw - 40px)', borderRadius: 16, background: '#fff',
        padding: '22px 22px 18px', boxShadow: '0 20px 60px rgba(20, 30, 80, .28)',
        border: '1px solid rgba(77, 107, 254, .28)',
      },
      dTitle: { fontSize: 16, fontWeight: 700, marginBottom: 10, color: 'var(--dsw-alias-label-primary, #16204a)' },
      dBody: { fontSize: 12.8, lineHeight: 1.8, color: 'var(--dsw-alias-label-secondary, #3a4674)', marginBottom: 12 },
      dNote: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary, #6b7280)', marginBottom: 16 },
      dFoot: { display: 'flex', justifyContent: 'flex-end', gap: 10 },
      error: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary, #dc2626)', marginTop: 10 },
      chips: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
      chipTag: { fontSize: 11.5, padding: '3px 10px', borderRadius: 999, background: '#eef3ff', color: '#3b56d6', border: '1px solid #dbe6ff' },
    }

    /** Trash glyph drawn inline so the action row never depends on an icon export. */
    function TrashGlyph() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', focusable: 'false' },
        h('path', { d: 'M2.75 4.25h10.5', stroke: 'currentColor', strokeWidth: 1, strokeLinecap: 'round' }),
        h('path', { d: 'M6.45 6.99v4.14M9.55 6.99v4.14', stroke: 'currentColor', strokeWidth: 1, strokeLinecap: 'round' }),
        h('path', {
          d: 'M4.15 4.25l.5 8.08a1.1 1.1 0 0 0 1.1 1.02h4.5a1.1 1.1 0 0 0 1.1-1.02l.5-8.08',
          stroke: 'currentColor', strokeWidth: 1, strokeLinejoin: 'round',
        }))
    }

    /** Stand-in hook used when the framework does not inject a session snapshot. */
    function NOOP_HOOK() {
      return false
    }

    /** Host origin for our routes; the served web app keeps the relative default. */
    function hostBase() {
      const transport = globalThis.__DSH_TRANSPORT__
      const base = transport === undefined || transport === null ? undefined : transport.streamBaseUrl
      if (typeof base !== 'string' || base.length === 0) return ''
      return base.endsWith('/') ? base.slice(0, -1) : base
    }

    function bases() {
      const base = hostBase()
      return base === '' ? [''] : ['', base]
    }

    /** One JSON request over every candidate base; HTTP answers are returned as-is. */
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

    function fill(template, values) {
      return template.replace(/\{(\w+)\}/gu, (match, key) => (values[key] === undefined ? match : String(values[key])))
    }

    /** Toggle one turn in the current selection. */
    function toggleTurn(sessionId, turn, selectable) {
      if (selectable === false) return
      const store = storeFor(sessionId)
      if (store.selection.has(turn)) store.selection.delete(turn)
      else store.selection.add(turn)
      notify(store)
    }

    // ---- per-session state -------------------------------------------------------

    const stores = new Map()

    function storeFor(sessionId) {
      let store = stores.get(sessionId)
      if (store === undefined) {
        store = {
          selection: new Set(),
          active: false,
          confirming: false,
          busy: false,
          error: null,
          turns: [],
          turnsLoaded: false,
          applied: new Set(),
          pending: new Set(),
          refused: new Map(),
          listeners: new Set(),
          loadingTurns: undefined,
        }
        stores.set(sessionId, store)
      }
      return store
    }

    function notify(store) {
      for (const listener of [...store.listeners]) listener()
    }

    function useStore(sessionId) {
      const store = useMemo(() => storeFor(sessionId ?? ''), [sessionId])
      const [, bump] = useState(0)
      const usable = typeof sessionId === 'string' && sessionId.length > 0
      useEffect(() => {
        if (!usable) return undefined
        const listener = () => bump(value => value + 1)
        store.listeners.add(listener)
        return () => { store.listeners.delete(listener) }
      }, [store, usable])
      return store
    }

    async function loadTurns(sessionId, force) {
      const store = storeFor(sessionId)
      if (store.turnsLoaded && force !== true) return store
      if (store.loadingTurns === undefined) {
        store.loadingTurns = (async () => {
          try {
            const answer = await requestJson(`${TURNS_ROUTE}?sessionId=${encodeURIComponent(sessionId)}`, { method: 'GET' })
            const body = answer.body
            if (body?.ok === true && Array.isArray(body.value?.turns)) {
              store.turns = body.value.turns
              store.turnsLoaded = true
              for (const item of body.value.turns) {
                if (item.deleted === true) store.applied.add(item.turn)
              }
            }
          } catch {
            // A cold Host is not an error the user can act on.
          } finally {
            store.loadingTurns = undefined
            notify(store)
          }
        })()
      }
      await store.loadingTurns
      return store
    }

    async function refreshDeleted(sessionId) {
      const store = storeFor(sessionId)
      try {
        const answer = await requestJson(`${DELETED_ROUTE}?sessionId=${encodeURIComponent(sessionId)}`, { method: 'GET' })
        const body = answer.body
        if (body?.ok === true) {
          store.applied = new Set(body.value?.turns ?? [])
          store.pending = new Set(body.value?.pending ?? [])
          store.refused = new Map((body.value?.refused ?? []).map(item => [item.turn, item.code]))
        }
      } catch {
        // ignore: the deletion itself already succeeded or failed on the Host
      }
      notify(store)
    }

    // ---- row concealment ---------------------------------------------------------

    function turnRows(marker) {
      const tailRow = marker.closest('[data-chat-flow-kind="turn-tail"]') ?? marker.closest('[data-turn-tail]')
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

    // ---- actions -----------------------------------------------------------------

    async function submitDeletion(sessionId) {
      const store = storeFor(sessionId)
      if (store.busy) return
      const chosen = store.turns.filter(item => store.selection.has(item.turn))
      if (chosen.length === 0) return
      store.busy = true
      store.error = null
      notify(store)

      const controller = typeof AbortController === 'function' ? new AbortController() : undefined
      const timer = controller === undefined ? undefined : setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        const answer = await requestJson(DELETE_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, assistantMessageIds: chosen.map(item => item.messageId) }),
          ...(controller === undefined ? {} : { signal: controller.signal }),
        })
        const body = answer.body
        if (body?.ok !== true) {
          store.error = describeFailure(body?.error ?? { code: 'DELETE_FAILED', message: `HTTP ${answer.response.status}` })
        } else {
          const results = body.value?.results ?? []
          const applied = results.filter(item => item.status === 'applied' || item.status === 'deferred' || item.status === 'already-gone')
          const refused = results.filter(item => item.status === 'refused')
          for (const item of applied) {
            store.applied.add(item.turn)
            store.selection.delete(item.turn)
          }
          if (refused.length > 0) {
            store.error = fill(zh['error.partial'], { ok: applied.length, bad: refused.length, code: refused[0].code ?? 'DELETE_FAILED' })
          }
          if (refused.length === 0) store.confirming = false
        }
      } catch (error) {
        const aborted = error instanceof Error && error.name === 'AbortError'
        store.error = describeFailure({ code: aborted ? 'TIMEOUT' : 'NETWORK', message: String(error) })
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        store.busy = false
        notify(store)
      }

      await refreshDeleted(sessionId)
      if (store.selection.size === 0 && store.error === null) store.active = false
      notify(store)
    }

    function describeFailure(error) {
      const code = error?.code
      const detail = String(error?.message ?? '').slice(0, 160)
      if (code === 'AGENT_BUSY') return `${zh['error.busy']} [AGENT_BUSY]`
      if (code === 'TURN_COMPACTED') return `${zh['error.compacted']} [TURN_COMPACTED]`
      if (code === 'TURN_PROTECTED') return `${zh['error.protected']} [TURN_PROTECTED]`
      if (code === 'TARGET_NOT_FOUND' || code === 'TURN_NOT_CLOSED') return `${zh['error.missing']} [${String(code)}]`
      if (code === 'NETWORK') return zh['error.network']
      if (code === 'TIMEOUT') return zh['error.timeout']
      return `${zh['error.failed']}${detail || String(code ?? '')} [${String(code ?? 'UNKNOWN')}]`
    }

    // ---- slot: assistant action -------------------------------------------------

    function TurnDeleteAction(props) {
      const sessionId = props.sessionId
      const store = useStore(sessionId)
      const useSession = typeof props.useSession === 'function' ? props.useSession : NOOP_HOOK
      const running = useSession(snapshot => snapshot?.running === true)
      const tr = typeof props.t === 'function' ? props.t : key => key
      const reachable = typeof sessionId === 'string' && sessionId.length > 0 && typeof props.messageId === 'string'

      const enter = useCallback(() => {
        if (!reachable) return
        store.active = true
        store.error = null
        void loadTurns(sessionId).then(current => {
          const match = current.turns.find(item => item.messageId === props.messageId)
          if (match !== undefined && match.deletable) current.selection.add(match.turn)
          notify(current)
        })
        notify(store)
      }, [props.messageId, reachable, sessionId, store])

      return h('button', {
        type: 'button',
        style: { ...styles.button, opacity: running ? 0.4 : 1, cursor: running ? 'default' : 'pointer' },
        title: running ? tr('error.busy') : tr('action.enter'),
        'aria-label': tr('action.enter'),
        'aria-disabled': running || undefined,
        onClick: running || !reachable ? undefined : enter,
      }, h(TrashGlyph, {}))
    }

    // ---- slot: turn tail (checkbox + deleted marker) -----------------------------

    function DeletedTurnMarker(props) {
      const { turn } = props
      const sessionId = props.sessionId
      const store = useStore(sessionId)
      const markerRef = useRef(null)
      const tr = typeof props.t === 'function' ? props.t : key => key
      const isDeleted = store.applied.has(turn)
      const isPending = store.pending.has(turn)
      const concealed = isDeleted || isPending
      const entry = store.turns.find(item => item.turn === turn)
      const selectable = entry === undefined ? true : entry.deletable !== false
      const picked = store.selection.has(turn)

      useEffect(() => {
        if (!concealed) return undefined
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
      }, [concealed, turn])

      useEffect(() => {
        if (!store.active || concealed) return undefined
        const marker = markerRef.current
        if (marker === null) return undefined
        const interactive = 'a,button,input,textarea,select,[contenteditable="true"],[role="button"]'
        const painted = []

        const paint = () => {
          while (painted.length > 0) painted.pop()()
          for (const row of turnRows(marker)) {
            const previous = {
              cursor: row.style.cursor,
              boxShadow: row.style.boxShadow,
              borderRadius: row.style.borderRadius,
              transition: row.style.transition,
            }
            const onClick = event => {
              if (event.target instanceof Element && event.target.closest(interactive) !== null) return
              toggleTurn(sessionId, turn, selectable)
            }
            row.style.transition = 'box-shadow 140ms ease, border-radius 140ms ease'
            row.style.cursor = selectable ? 'pointer' : 'not-allowed'
            if (picked) {
              row.style.boxShadow = 'inset 0 0 0 2px #4d6bfe, 0 8px 22px rgba(31, 52, 140, .18)'
              row.style.borderRadius = '12px'
            }
            row.addEventListener('click', onClick, true)
            painted.push(() => {
              row.removeEventListener('click', onClick, true)
              row.style.cursor = previous.cursor
              row.style.boxShadow = previous.boxShadow
              row.style.borderRadius = previous.borderRadius
              row.style.transition = previous.transition
            })
          }
        }

        paint()
        const list = marker.closest('[data-chat-flow-kind="turn-tail"]')?.parentElement
        if (list === undefined || list === null) return () => { while (painted.length > 0) painted.pop()() }
        const observer = new MutationObserver(paint)
        observer.observe(list, { childList: true, subtree: true })
        return () => {
          observer.disconnect()
          while (painted.length > 0) painted.pop()()
        }
      }, [concealed, picked, selectable, sessionId, store, turn])

      if (concealed) {
        return h('span', { ref: markerRef, style: styles.chip, 'data-dsh-deleted-turn': turn },
          isDeleted ? tr('mark.deleted') : tr('mark.pending'))
      }

      if (!store.active) return null

      // Selection is the whole turn row: clicking anywhere in the floor toggles it,
      // and a ring + shadow marks the picked floor. The marker itself stays hidden.
      return h('span', { ref: markerRef, style: { display: 'none' }, 'data-dsh-pick-turn': turn })
    }

    // ---- slot: composer overlay (bar + dialog) ----------------------------------

    function TurnDeletePanel(props) {
      const sessionId = props.sessionId
      const store = useStore(sessionId)
      const tr = typeof props.t === 'function' ? props.t : key => key
      const count = store.selection.size
      if (!store.active) return null

      const dialog = store.confirming
        ? h('div', { style: styles.scrim, onClick: event => { if (event.target === event.currentTarget && !store.busy) { store.confirming = false; notify(store) } } },
            h('div', { style: styles.dialog, role: 'dialog', 'aria-modal': 'true' },
              h('div', { style: styles.dTitle }, fill(tr('dialog.title'), { count })),
              h('div', { style: styles.dBody }, tr('dialog.body')),
              store.error === null
                ? null
                : h('div', { style: styles.error, role: 'alert' }, store.error),
              h('div', { style: styles.chips },
                [...store.selection].sort((left, right) => left - right).map(turn =>
                  h('span', { key: turn, style: styles.chipTag }, `第 ${String(turn)} 轮`))),
              h('div', { style: styles.dNote }, tr('dialog.note')),
              h('div', { style: styles.dFoot },
                h('button', {
                  type: 'button',
                  style: { ...styles.btn, opacity: store.busy ? 0.5 : 1 },
                  disabled: store.busy,
                  onClick: () => { store.confirming = false; store.error = null; notify(store) },
                }, tr('dialog.cancel')),
                h('button', {
                  type: 'button',
                  style: { ...styles.btn, ...styles.btnPrimary, opacity: store.busy ? 0.6 : 1 },
                  disabled: store.busy || count === 0,
                  onClick: () => { void submitDeletion(sessionId) },
                }, store.busy ? tr('dialog.working') : fill(tr('dialog.confirm'), { count })))))
        : null

      const bar = h('div', { style: styles.bar },
        h('span', { style: styles.barCount }, fill(tr('bar.selected'), { count })),
        h('span', { style: styles.barHint }, store.error ?? tr('bar.hint')),
        h('span', { style: styles.spacer }),
        h('button', {
          type: 'button',
          style: { ...styles.btn, ...styles.btnGhost },
          onClick: () => {
            store.active = false
            store.confirming = false
            store.error = null
            store.selection.clear()
            notify(store)
          },
        }, tr('bar.cancel')),
        h('button', {
          type: 'button',
          style: { ...styles.btn, ...styles.btnPrimary, opacity: count === 0 ? 0.5 : 1 },
          disabled: count === 0,
          onClick: () => { store.confirming = true; store.error = null; notify(store) },
        }, tr('bar.confirm')))

      return h('div', null, bar, dialog)
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
        inject: (sessionId) => ({ sessionId }),
      }, TurnDeleteAction))

      ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
        name: 'conversation.chat.turnTail',
        id: 'turn-delete-marker',
        order: 50,
        locale: NS,
        inject: (sessionId) => ({ sessionId }),
      }, DeletedTurnMarker))

      ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
        name: 'conversation.input.overlay',
        id: 'turn-delete-panel',
        order: 40,
        locale: NS,
        inject: (sessionId) => ({ sessionId }),
      }, TurnDeletePanel))
    }

    return { inject, apply }
  },
})




