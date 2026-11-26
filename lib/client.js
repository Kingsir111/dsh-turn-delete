window.__ModuleLoader__.load({
  id: 'dsh-turn-delete',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom/client')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const NS = 'turn-delete'
    const DELETE_ROUTE = '/dsh-turn-delete'
    const DELETED_ROUTE = '/dsh-turn-delete/deleted'
    const TURNS_ROUTE = '/dsh-turn-delete/turns'
    const REQUEST_TIMEOUT_MS = 20000

    const zh = {
      'action.enter': '选择要删除的轮次',
      'panel.title': '选择要删除的轮次',
      'panel.selected': '已选 {count} 轮',
      'panel.empty': '这个会话还没有可删除的轮次',
      'panel.loading': '正在读取轮次…',
      'panel.exit': '退出',
      'panel.confirm': '确认删除',
      'panel.deleted': '已删除',
      'panel.notDeletable': '不可删除 · {code}',
      'dialog.title': '删除 {count} 轮对话？',
      'dialog.body': '这些轮次会从后续模型上下文中移除，Session、标题与之后的轮次都保留。原始提问、回复与工具记录仍留在日志里，可审计、可回放。',
      'dialog.note': '删除不可撤销 · 只影响上下文，不改写日志',
      'dialog.confirm': '删除 {count} 轮',
      'dialog.cancel': '取消',
      'dialog.working': '正在删除…',
      'error.busy': '任务正在运行，请结束后再删。',
      'error.compacted': '这一轮已与其他历史合并压缩，无法单独删除。',
      'error.protected': '这一轮包含当前生效的系统提示，删掉会让后续请求丢失系统提示，已拒绝。',
      'error.missing': '这一轮已变化或不存在，无法删除。',
      'error.failed': '删除失败：',
      'error.network': '请求没有到达 Host（网络或跨域被拦）。',
      'error.timeout': 'Host 超过 20 秒没有响应。',
      'error.partial': '{ok} 轮已删，{bad} 轮被拒绝：{code}',
    }
    const en = {
      'action.enter': 'Choose turns to delete',
      'panel.title': 'Choose turns to delete',
      'panel.selected': '{count} selected',
      'panel.empty': 'This session has no deletable turns',
      'panel.loading': 'Reading turns…',
      'panel.exit': 'Exit',
      'panel.confirm': 'Delete',
      'panel.deleted': 'deleted',
      'panel.notDeletable': 'not deletable · {code}',
      'dialog.title': 'Delete {count} turns?',
      'dialog.body': 'These turns leave the model context. The Session, its title and its later turns stay. The original prompts, replies and tool records remain in the log, auditable and replayable.',
      'dialog.note': 'Not reversible · context only, the log is untouched',
      'dialog.confirm': 'Delete {count}',
      'dialog.cancel': 'Cancel',
      'dialog.working': 'Deleting…',
      'error.busy': 'The task is running. Delete after it finishes.',
      'error.compacted': 'This turn is already folded into other history and cannot be removed alone.',
      'error.protected': 'This turn carries the active system prompt; deleting it would strip the prompt from later requests.',
      'error.missing': 'This turn changed or no longer exists.',
      'error.failed': 'Deletion failed: ',
      'error.network': 'The request did not reach the Host (network or cross-origin block).',
      'error.timeout': 'The Host did not answer within 20 seconds.',
      'error.partial': '{ok} deleted, {bad} refused: {code}',
    }

    const PANEL_WIDTH = 560

    const styles = {
      button: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 28, height: 28, padding: 6, border: 'none', borderRadius: 28,
        background: 'transparent', color: 'var(--dsw-alias-label-tertiary, #6b7280)', cursor: 'pointer',
      },
      layer: { position: 'fixed', inset: 0, zIndex: 2147483000, pointerEvents: 'none' },
      panel: {
        position: 'fixed', left: '50%', bottom: 16, transform: 'translateX(-50%)',
        width: `min(${String(PANEL_WIDTH)}px, 94vw)`, pointerEvents: 'auto',
        background: 'var(--dsw-alias-bg-elevated, #ffffff)', color: 'var(--dsw-alias-label-primary, #16204a)',
        border: '1px solid var(--dsw-alias-border-secondary, #dbe3f7)', borderRadius: 14,
        boxShadow: '0 18px 48px rgba(20, 30, 80, .24)', fontFamily: 'inherit', fontSize: 13,
        overflow: 'hidden',
      },
      head: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid rgba(120, 140, 200, .18)' },
      title: { fontWeight: 700, fontSize: 13 },
      count: { color: '#4d6bfe', fontWeight: 700 },
      list: { maxHeight: '42vh', overflowY: 'auto', padding: '6px 8px' },
      row: {
        display: 'flex', alignItems: 'baseline', gap: 10, width: '100%', textAlign: 'left',
        padding: '7px 10px', borderRadius: 10, border: '1px solid transparent', background: 'transparent',
        cursor: 'pointer', color: 'inherit', font: 'inherit',
      },
      rowPicked: { borderColor: '#4d6bfe', background: 'rgba(77, 107, 254, .08)', boxShadow: '0 6px 18px rgba(31, 52, 140, .12)' },
      rowDisabled: { opacity: 0.4, cursor: 'default' },
      rowTurn: { flex: 'none', fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary, #6b7280)', minWidth: 52 },
      rowText: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      foot: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderTop: '1px solid rgba(120, 140, 200, .18)' },
      spacer: { flex: 1 },
      btn: {
        fontSize: 12.5, padding: '7px 14px', borderRadius: 10, cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-secondary, #dbe3f7)',
        background: 'var(--dsw-alias-bg-secondary, #fff)', color: 'var(--dsw-alias-label-primary, #3a4674)',
        fontFamily: 'inherit',
      },
      btnPrimary: { background: '#4d6bfe', borderColor: '#4d6bfe', color: '#fff' },
      btnGhost: { borderColor: 'transparent', color: 'var(--dsw-alias-label-tertiary, #6b7280)' },
      scrim: {
        position: 'fixed', inset: 0, zIndex: 2147483001, pointerEvents: 'auto',
        display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(16, 24, 60, .28)',
      },
      dialog: {
        width: 430, maxWidth: 'calc(100vw - 40px)', borderRadius: 16, background: '#fff',
        padding: '22px 22px 18px', boxShadow: '0 20px 60px rgba(20, 30, 80, .28)',
        border: '1px solid rgba(77, 107, 254, .28)', color: '#16204a', fontSize: 13,
      },
      dTitle: { fontSize: 16, fontWeight: 700, marginBottom: 10 },
      dBody: { fontSize: 12.8, lineHeight: 1.8, color: '#3a4674', marginBottom: 12 },
      dNote: { fontSize: 11.5, color: '#6b7699', marginBottom: 16 },
      dFoot: { display: 'flex', justifyContent: 'flex-end', gap: 10 },
      chips: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
      chipTag: { fontSize: 11.5, padding: '3px 10px', borderRadius: 999, background: '#eef3ff', color: '#3b56d6', border: '1px solid #dbe6ff' },
      error: { fontSize: 12, color: '#dc2626', marginBottom: 10 },
    }

    function TrashGlyph() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', focusable: 'false' },
        h('path', { d: 'M2.75 4.25h10.5', stroke: 'currentColor', strokeWidth: 1, strokeLinecap: 'round' }),
        h('path', { d: 'M6.45 6.99v4.14M9.55 6.99v4.14', stroke: 'currentColor', strokeWidth: 1, strokeLinecap: 'round' }),
        h('path', {
          d: 'M4.15 4.25l.5 8.08a1.1 1.1 0 0 0 1.1 1.02h4.5a1.1 1.1 0 0 0 1.1-1.02l.5-8.08',
          stroke: 'currentColor', strokeWidth: 1, strokeLinejoin: 'round',
        }))
    }

    function NOOP_HOOK() {
      return false
    }

    function fill(template, values) {
      return template.replace(/\{(\w+)\}/gu, (match, key) => (values[key] === undefined ? match : String(values[key])))
    }

    // ---- transport ---------------------------------------------------------------

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

    // ---- state -------------------------------------------------------------------

    const stores = new Map()

    function storeFor(sessionId) {
      let store = stores.get(sessionId)
      if (store === undefined) {
        store = {
          sessionId,
          active: false,
          confirming: false,
          busy: false,
          error: null,
          selection: new Set(),
          turns: [],
          turnsLoaded: false,
          loadingTurns: false,
          applied: new Set(),
          pending: new Set(),
          listeners: new Set(),
          rev: 0,
        }
        stores.set(sessionId, store)
      }
      return store
    }

    function notify(store) {
      store.rev += 1
      for (const listener of [...store.listeners]) listener()
    }

    /** The session whose panel is on screen; the host root renders from this. */
    const root = { sessionId: undefined, store: undefined, listeners: new Set() }

    function subscribeRoot(listener) {
      root.listeners.add(listener)
      return () => { root.listeners.delete(listener) }
    }

    function notifyRoot() {
      for (const listener of [...root.listeners]) listener()
    }

    async function loadTurns(sessionId) {
      const store = storeFor(sessionId)
      if (store.turnsLoaded || store.loadingTurns) return store
      store.loadingTurns = true
      try {
        const answer = await requestJson(`${TURNS_ROUTE}?sessionId=${encodeURIComponent(sessionId)}`, { method: 'GET' })
        const body = answer.body
        if (body?.ok === true && Array.isArray(body.value?.turns)) {
          store.turns = body.value.turns
          store.turnsLoaded = true
          for (const item of body.value.turns) if (item.deleted === true) store.applied.add(item.turn)
        }
      } catch {
        // a cold Host is not something the user can act on
      } finally {
        store.loadingTurns = false
        notify(store)
      }
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
        }
      } catch {
        // ignore
      }
      notify(store)
    }

    function openPanel(sessionId) {
      const store = storeFor(sessionId)
      root.sessionId = sessionId
      root.store = store
      store.active = true
      store.error = null
      void loadTurns(sessionId).then(() => notifyRoot())
      notify(store)
      notifyRoot()
    }

    function closePanel() {
      const store = root.store
      if (store === undefined) return
      store.active = false
      store.confirming = false
      store.error = null
      store.selection.clear()
      root.sessionId = undefined
      root.store = undefined
      notify(store)
      notifyRoot()
    }

    function toggleTurn(sessionId, turn) {
      const store = storeFor(sessionId)
      const entry = store.turns.find(item => item.turn === turn)
      if (entry !== undefined && entry.deletable === false) return
      if (store.selection.has(turn)) store.selection.delete(turn)
      else store.selection.add(turn)
      notify(store)
    }

    // ---- chat DOM (best effort: highlighting only) -------------------------------

    function rowsOf(tail) {
      const row = tail.closest('[data-chat-flow-kind="turn-tail"]') ?? tail
      const rows = [row]
      let cursor = row.previousElementSibling
      while (cursor instanceof HTMLElement) {
        if (cursor.querySelector('[data-turn-tail]') !== null) break
        rows.push(cursor)
        cursor = cursor.previousElementSibling
      }
      return rows
    }

    function paintChat(store) {
      const tails = document.querySelectorAll('[data-turn-tail]')
      if (tails.length === 0) return
      const hidden = new Set([...store.applied, ...store.pending])
      for (const tail of tails) {
        const turn = Number(tail.getAttribute('data-turn-tail'))
        if (!Number.isSafeInteger(turn)) continue
        const picked = store.selection.has(turn)
        const concealed = hidden.has(turn)
        for (const row of rowsOf(tail)) {
          row.hidden = concealed
          row.style.transition = 'box-shadow 140ms ease, border-radius 140ms ease'
          row.style.boxShadow = picked ? 'inset 0 0 0 2px #4d6bfe, 0 8px 22px rgba(31, 52, 140, .18)' : ''
          row.style.borderRadius = picked ? '12px' : ''
        }
      }
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

    async function submitDeletion() {
      const store = root.store
      if (store === undefined || store.busy) return
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
          body: JSON.stringify({ sessionId: store.sessionId, assistantMessageIds: chosen.map(item => item.messageId) }),
          ...(controller === undefined ? {} : { signal: controller.signal }),
        })
        const body = answer.body
        if (body?.ok !== true) {
          store.error = describeFailure(body?.error ?? { code: 'DELETE_FAILED', message: `HTTP ${answer.response.status}` })
        } else {
          const results = body.value?.results ?? []
          const ok = results.filter(item => item.status === 'applied' || item.status === 'deferred' || item.status === 'already-gone')
          const refused = results.filter(item => item.status === 'refused')
          for (const item of ok) {
            store.applied.add(item.turn)
            store.selection.delete(item.turn)
          }
          if (refused.length > 0) {
            store.error = fill(zh['error.partial'], { ok: ok.length, bad: refused.length, code: refused[0].code ?? 'DELETE_FAILED' })
          } else {
            store.confirming = false
          }
        }
      } catch (error) {
        const aborted = error instanceof Error && error.name === 'AbortError'
        store.error = describeFailure({ code: aborted ? 'TIMEOUT' : 'NETWORK', message: String(error) })
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        store.busy = false
        notify(store)
      }

      await refreshDeleted(store.sessionId)
      if (store.selection.size === 0 && store.error === null) closePanel()
      else notifyRoot()
    }

    // ---- components ---------------------------------------------------------------

    /** Trash button inside each finished turn's action row: the way in. */
    function TurnDeleteAction(props) {
      const sessionId = props.sessionId
      const useSession = typeof props.useSession === 'function' ? props.useSession : NOOP_HOOK
      const running = useSession(snapshot => snapshot?.running === true)
      const tr = typeof props.t === 'function' ? props.t : key => key
      const reachable = typeof sessionId === 'string' && sessionId.length > 0

      const enter = useCallback(() => {
        if (!reachable) return
        openPanel(sessionId)
      }, [reachable, sessionId])

      return h('button', {
        type: 'button',
        style: { ...styles.button, opacity: running ? 0.4 : 1, cursor: running ? 'default' : 'pointer' },
        title: running ? tr('error.busy') : tr('action.enter'),
        'aria-label': tr('action.enter'),
        'aria-disabled': running || undefined,
        onClick: running || !reachable ? undefined : enter,
      }, h(TrashGlyph, {}))
    }

    /** Bar + list + dialog, rendered into our own root so no chat slot is required. */
    function PanelHost() {
      const [, bump] = useState(0)
      useEffect(() => subscribeRoot(() => bump(value => value + 1)), [])

      const store = root.store
      const rev = store?.rev ?? 0

      useEffect(() => {
        if (store === undefined || !store.active) return undefined
        paintChat(store)
        const interactive = 'a,input,textarea,select,[contenteditable="true"]'
        const own = '[data-dsh-turn-delete-ui]'
        const onClick = event => {
          const target = event.target
          if (!(target instanceof Element) || target.closest(own) !== null) return
          if (target.closest(interactive) !== null) return
          const tail = target.closest('[data-turn-tail]')
          if (tail === null) return
          const turn = Number(tail.getAttribute('data-turn-tail'))
          if (!Number.isSafeInteger(turn)) return
          toggleTurn(store.sessionId, turn)
        }
        document.addEventListener('click', onClick, true)
        let frame
        const observer = new MutationObserver(() => {
          if (frame !== undefined) return
          frame = requestAnimationFrame(() => {
            frame = undefined
            paintChat(store)
          })
        })
        observer.observe(document.body, { childList: true, subtree: true })
        return () => {
          document.removeEventListener('click', onClick, true)
          observer.disconnect()
          if (frame !== undefined) cancelAnimationFrame(frame)
          for (const tail of document.querySelectorAll('[data-turn-tail]')) {
            for (const row of rowsOf(tail)) {
              row.hidden = false
              row.style.boxShadow = ''
              row.style.borderRadius = ''
            }
          }
        }
      }, [rev, store])

      if (store === undefined || !store.active) return null

      const tr = key => zh[key] ?? key
      const count = store.selection.size
      const rows = store.turns.map(item => {
        const picked = store.selection.has(item.turn)
        const disabled = item.deleted || item.deletable === false
        const label = item.deleted
          ? tr('panel.deleted')
          : item.deletable === false
            ? fill(tr('panel.notDeletable'), { code: item.code ?? 'DELETE_FAILED' })
            : ''
        return h('button', {
          key: item.turn,
          type: 'button',
          disabled,
          style: { ...styles.row, ...(picked ? styles.rowPicked : {}), ...(disabled ? styles.rowDisabled : {}) },
          onClick: disabled ? undefined : () => toggleTurn(store.sessionId, item.turn),
        },
          h('span', { style: styles.rowTurn }, `第 ${String(item.turn)} 轮`),
          h('span', { style: styles.rowText }, label.length > 0 ? label : (item.preview || `第 ${String(item.turn)} 轮`)),
          picked ? h('span', { style: { color: '#4d6bfe', fontWeight: 700 } }, '✓') : null)
      })

      const panel = h('div', { style: styles.layer },
        h('div', { style: styles.panel, 'data-dsh-turn-delete-ui': '' },
          h('div', { style: styles.head },
            h('span', { style: styles.title }, tr('panel.title')),
            h('span', { style: styles.spacer }),
            h('span', { style: styles.count }, fill(tr('panel.selected'), { count }))),
          h('div', { style: styles.list },
            store.turns.length === 0
              ? h('div', { style: { padding: '14px 10px', color: '#6b7699' } },
                  store.loadingTurns ? tr('panel.loading') : tr('panel.empty'))
              : rows),
          store.error === null ? null : h('div', { style: { ...styles.error, padding: '0 14px 8px' }, role: 'alert' }, store.error),
          h('div', { style: styles.foot },
            h('span', { style: styles.spacer }),
            h('button', { type: 'button', style: { ...styles.btn, ...styles.btnGhost }, onClick: closePanel }, tr('panel.exit')),
            h('button', {
              type: 'button',
              style: { ...styles.btn, ...styles.btnPrimary, opacity: count === 0 ? 0.5 : 1 },
              disabled: count === 0,
              onClick: () => { store.confirming = true; store.error = null; notify(store) },
            }, tr('panel.confirm')))))

      const dialog = store.confirming
        ? h('div', { style: styles.scrim, 'data-dsh-turn-delete-ui': '', onClick: event => {
            if (event.target === event.currentTarget && !store.busy) {
              store.confirming = false
              notify(store)
            }
          } },
            h('div', { style: styles.dialog, role: 'dialog', 'aria-modal': 'true' },
              h('div', { style: styles.dTitle }, fill(tr('dialog.title'), { count })),
              h('div', { style: styles.dBody }, tr('dialog.body')),
              store.error === null ? null : h('div', { style: styles.error, role: 'alert' }, store.error),
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
                  onClick: () => { void submitDeletion() },
                }, store.busy ? tr('dialog.working') : fill(tr('dialog.confirm'), { count })))))
        : null

      return h(React.Fragment, null, panel, dialog)
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

      // Our own root: the panel must not depend on any chat or composer slot, since
      // a client skin can replace either of them.
      ctx.effect(() => {
        const host = document.createElement('div')
        host.setAttribute('data-dsh-turn-delete-root', '')
        document.body.append(host)
        const reactRoot = ReactDOM.createRoot(host)
        reactRoot.render(h(PanelHost, null))
        return () => {
          reactRoot.unmount()
          host.remove()
        }
      }, 'turn-delete: panel root')
    }

    return { inject, apply }
  },
})

