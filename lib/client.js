window.__ModuleLoader__.load({
  id: 'dsh-turn-delete',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'turn-delete'
    const DELETE_ROUTE = '/dsh-turn-delete'
    const TURNS_ROUTE = '/dsh-turn-delete/turns'
    const REQUEST_TIMEOUT_MS = 20000

    const zh = {
      'action.enter': '选择要删除的轮次',
      'bar.count': '已选 {count} 轮',
      'bar.confirm': '确认删除',
      'bar.exit': '退出',
      'bar.noFloor': '找不到可选的楼层：皮肤可能改动了聊天 DOM（缺少 data-chat-turn / data-turn-tail）',
      'bar.hint': '点击任意一轮选中，再点一次取消',
      'dialog.title': '删除 {count} 轮对话？',
      'dialog.body': '这些轮次会从后续模型上下文中移除，Session、标题与之后的轮次都保留。原始提问、回复与工具记录仍留在日志里。',
      'dialog.note': '不可撤销 · 只影响上下文，不改写日志',
      'dialog.confirm': '删除 {count} 轮',
      'dialog.cancel': '取消',
      'dialog.working': '正在删除…',
      'error.busy': '任务正在运行，请结束后再删。',
      'error.compacted': '这一轮已与其他历史合并压缩，无法单独删除。',
      'error.protected': '这一轮包含当前生效的系统提示，删除会让后续请求丢失系统提示，已拒绝。',
      'error.missing': '这一轮已变化或不存在，无法删除。',
      'error.failed': '删除失败：',
      'error.network': '请求没有到达 Host。',
      'error.timeout': 'Host 超过 20 秒没有响应。',
      'error.partial': '{ok} 轮已删，{bad} 轮被拒：{code}',
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

    async function requestJson(path, init) {
      const candidates = hostBase() === '' ? [''] : ['', hostBase()]
      let lastError
      for (const base of candidates) {
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

    // ---- selection state ---------------------------------------------------------

    const state = {
      active: false,
      sessionId: undefined,
      selection: new Set(),
      turns: [],
      bar: undefined,
      dialog: undefined,
      busy: false,
      error: undefined,
      detached: false,
    }

    const SELECTED_SHADOW = 'inset 0 0 0 2px #4d6bfe, 0 8px 22px rgba(31, 52, 140, .18)'

    /** Rows that belong to one turn, using whichever attribute the skin emits. */
    function rowsForTurn(turn) {
      const byAttribute = [...document.querySelectorAll(`[data-chat-turn="${String(turn)}"]`)]
      if (byAttribute.length > 0) return byAttribute
      const tail = [...document.querySelectorAll('[data-turn-tail]')]
        .find(element => Number(element.getAttribute('data-turn-tail')) === turn)
      if (tail === undefined) return []
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

    function anyFloor() {
      return document.querySelector('[data-chat-turn], [data-turn-tail]') !== null
    }

    function paint() {
      for (const element of document.querySelectorAll('[data-chat-turn], [data-turn-tail]')) {
        element.style.boxShadow = ''
        element.style.borderRadius = ''
        element.style.transition = ''
      }
      for (const turn of state.selection) {
        for (const row of rowsForTurn(turn)) {
          row.style.transition = 'box-shadow 140ms ease, border-radius 140ms ease'
          row.style.boxShadow = SELECTED_SHADOW
          row.style.borderRadius = '12px'
        }
      }
    }

    function clearPaint() {
      for (const element of document.querySelectorAll('[data-chat-turn], [data-turn-tail]')) {
        element.style.boxShadow = ''
        element.style.borderRadius = ''
        element.style.transition = ''
      }
    }

    // ---- bar (plain DOM, no React, no slot) --------------------------------------

    function element(tag, style, text) {
      const node = document.createElement(tag)
      if (style !== undefined) Object.assign(node.style, style)
      if (text !== undefined) node.textContent = text
      return node
    }

    const BAR_STYLE = {
      position: 'fixed', left: '50%', bottom: '18px', transform: 'translateX(-50%)',
      zIndex: '2147483000', display: 'flex', alignItems: 'center', gap: '10px',
      padding: '10px 16px', borderRadius: '12px', fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
      fontSize: '13px', color: '#16204a', background: '#ffffff',
      border: '1px solid #dbe3f7', boxShadow: '0 16px 40px rgba(20, 30, 80, .22)',
    }

    function buttonStyle(primary) {
      return {
        fontSize: '12.5px', padding: '7px 14px', borderRadius: '10px', cursor: 'pointer',
        fontFamily: 'inherit', border: '1px solid ' + (primary ? '#4d6bfe' : '#dbe3f7'),
        background: primary ? '#4d6bfe' : '#fff', color: primary ? '#fff' : '#3a4674',
      }
    }

    function ensureBar() {
      if (state.bar !== undefined && state.bar.isConnected) return state.bar
      const bar = element('div', BAR_STYLE)
      bar.setAttribute('data-dsh-turn-delete-ui', '')

      const count = element('span', { fontWeight: '700', color: '#4d6bfe' }, '')
      count.dataset.role = 'count'
      const hint = element('span', { color: '#6b7699', fontSize: '12px', maxWidth: '360px' }, '')
      hint.dataset.role = 'hint'
      const exit = element('button', buttonStyle(false), zh['bar.exit'])
      exit.type = 'button'
      exit.addEventListener('click', event => { event.stopPropagation(); stop() })
      const confirm = element('button', buttonStyle(true), zh['bar.confirm'])
      confirm.type = 'button'
      confirm.addEventListener('click', event => { event.stopPropagation(); openDialog() })

      const spacer = element('span', { flex: '1' })
      bar.append(count, hint, spacer, exit, confirm)
      document.body.append(bar)
      state.bar = bar
      refreshBar()
      return bar
    }

    function refreshBar() {
      const bar = state.bar
      if (bar === undefined || !bar.isConnected) return
      const count = bar.querySelector('[data-role="count"]')
      const hint = bar.querySelector('[data-role="hint"]')
      if (count !== null) count.textContent = fill(zh['bar.count'], { count: state.selection.size })
      if (hint !== null) {
        hint.textContent = state.error ?? (anyFloor() ? zh['bar.hint'] : zh['bar.noFloor'])
        hint.style.color = state.error === undefined ? '#6b7699' : '#dc2626'
      }
    }

    // ---- dialog ------------------------------------------------------------------

    const DIALOG_STYLE = {
      position: 'fixed', inset: '0', zIndex: '2147483001', display: 'flex',
      alignItems: 'center', justifyContent: 'center', background: 'rgba(16, 24, 60, .28)',
      fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
    }

    function openDialog() {
      if (state.selection.size === 0) return
      closeDialog()
      const overlay = element('div', DIALOG_STYLE)
      overlay.setAttribute('data-dsh-turn-delete-ui', '')
      overlay.addEventListener('click', event => {
        if (event.target === overlay && !state.busy) closeDialog()
      })

      const card = element('div', {
        width: '420px', maxWidth: 'calc(100vw - 40px)', borderRadius: '16px', background: '#fff',
        padding: '22px 22px 18px', boxShadow: '0 20px 60px rgba(20, 30, 80, .28)',
        border: '1px solid rgba(77, 107, 254, .28)', color: '#16204a', fontSize: '13px',
      })

      const title = element('div', { fontSize: '16px', fontWeight: '700', marginBottom: '10px' },
        fill(zh['dialog.title'], { count: state.selection.size }))
      const body = element('div', { fontSize: '12.8px', lineHeight: '1.8', color: '#3a4674', marginBottom: '12px' },
        zh['dialog.body'])
      const chips = element('div', { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' })
      for (const turn of [...state.selection].sort((left, right) => left - right)) {
        chips.append(element('span', {
          fontSize: '11.5px', padding: '3px 10px', borderRadius: '999px',
          background: '#eef3ff', color: '#3b56d6', border: '1px solid #dbe6ff',
        }, `第 ${String(turn)} 轮`))
      }
      const note = element('div', { fontSize: '11.5px', color: '#6b7699', marginBottom: '16px' }, zh['dialog.note'])
      const error = element('div', { fontSize: '12px', color: '#dc2626', marginBottom: '10px', display: 'none' }, '')
      error.dataset.role = 'error'

      const foot = element('div', { display: 'flex', justifyContent: 'flex-end', gap: '10px' })
      const cancel = element('button', buttonStyle(false), zh['dialog.cancel'])
      cancel.type = 'button'
      cancel.addEventListener('click', () => closeDialog())
      const confirm = element('button', buttonStyle(true), fill(zh['dialog.confirm'], { count: state.selection.size }))
      confirm.type = 'button'
      confirm.dataset.role = 'confirm'
      confirm.addEventListener('click', () => { void submit() })
      foot.append(cancel, confirm)

      card.append(title, body, chips, error, note, foot)
      overlay.append(card)
      document.body.append(overlay)
      state.dialog = overlay
    }

    function closeDialog() {
      if (state.dialog !== undefined) {
        state.dialog.remove()
        state.dialog = undefined
      }
    }

    function showDialogError(message) {
      const error = state.dialog?.querySelector('[data-role="error"]')
      if (error === null || error === undefined) return
      error.textContent = message
      error.style.display = 'block'
    }

    // ---- deletion ----------------------------------------------------------------

    function describeFailure(failure) {
      const code = failure?.code
      if (code === 'AGENT_BUSY') return zh['error.busy']
      if (code === 'TURN_COMPACTED') return zh['error.compacted']
      if (code === 'TURN_PROTECTED') return zh['error.protected']
      if (code === 'TARGET_NOT_FOUND' || code === 'TURN_NOT_CLOSED') return zh['error.missing']
      if (code === 'NETWORK') return zh['error.network']
      if (code === 'TIMEOUT') return zh['error.timeout']
      return `${zh['error.failed']}${String(failure?.message ?? code ?? '')}`
    }

    async function submit() {
      if (state.busy) return
      const chosen = state.turns.filter(item => state.selection.has(item.turn))
      const ids = chosen.map(item => item.messageId).filter(id => typeof id === 'string')
      if (ids.length === 0) {
        showDialogError(zh['error.missing'])
        return
      }
      state.busy = true
      const confirm = state.dialog?.querySelector('[data-role="confirm"]')
      if (confirm !== null && confirm !== undefined) {
        confirm.textContent = zh['dialog.working']
        confirm.disabled = true
      }

      const controller = typeof AbortController === 'function' ? new AbortController() : undefined
      const timer = controller === undefined ? undefined : setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        const answer = await requestJson(DELETE_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: state.sessionId, assistantMessageIds: ids }),
          ...(controller === undefined ? {} : { signal: controller.signal }),
        })
        const body = answer.body
        if (body?.ok !== true) {
          state.error = describeFailure(body?.error ?? { code: 'DELETE_FAILED', message: `HTTP ${answer.response.status}` })
          showDialogError(state.error)
          refreshBar()
          return
        }
        const results = body.value?.results ?? []
        const applied = results.filter(item => item.status === 'applied' || item.status === 'deferred' || item.status === 'already-gone')
        const refused = results.filter(item => item.status === 'refused')
        for (const item of applied) {
          state.selection.delete(item.turn)
          for (const row of rowsForTurn(item.turn)) row.hidden = true
        }
        if (refused.length > 0) {
          state.error = fill(zh['error.partial'], { ok: applied.length, bad: refused.length, code: refused[0].code ?? 'DELETE_FAILED' })
          showDialogError(state.error)
          refreshBar()
          return
        }
        closeDialog()
        paint()
        if (state.selection.size === 0) stop()
      } catch (error) {
        const aborted = error instanceof Error && error.name === 'AbortError'
        state.error = describeFailure({ code: aborted ? 'TIMEOUT' : 'NETWORK', message: String(error) })
        showDialogError(state.error)
        refreshBar()
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        state.busy = false
      }
    }

    // ---- lifecycle ---------------------------------------------------------------

    async function loadTurns() {
      try {
        const answer = await requestJson(`${TURNS_ROUTE}?sessionId=${encodeURIComponent(state.sessionId)}`, { method: 'GET' })
        const turns = answer.body?.value?.turns
        if (Array.isArray(turns)) state.turns = turns
      } catch {
        state.turns = []
      }
      refreshBar()
    }

    function onClick(event) {
      if (!state.active) return
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('[data-dsh-turn-delete-ui]') !== null) return
      if (target.closest('a,input,textarea,select,[contenteditable="true"]') !== null) return
      const holder = target.closest('[data-chat-turn], [data-turn-tail]')
      if (holder === null) return
      const raw = holder.getAttribute('data-chat-turn') ?? holder.getAttribute('data-turn-tail')
      const turn = Number(raw)
      if (!Number.isSafeInteger(turn)) return
      const entry = state.turns.find(item => item.turn === turn)
      if (entry !== undefined && (entry.dead === true || entry.deletable === false)) return
      if (state.selection.has(turn)) state.selection.delete(turn)
      else state.selection.add(turn)
      state.error = undefined
      paint()
      refreshBar()
    }

    function onKey(event) {
      if (event.key === 'Escape' && state.active) {
        if (state.dialog !== undefined) closeDialog()
        else stop()
      }
    }

    function start(sessionId) {
      if (state.active && state.sessionId === sessionId) return
      stop()
      state.sessionId = sessionId
      state.active = true
      state.selection.clear()
      state.error = undefined
      ensureBar()
      document.addEventListener('click', onClick, true)
      document.addEventListener('keydown', onKey, true)
      void loadTurns()
    }

    function stop() {
      state.active = false
      state.selection.clear()
      state.error = undefined
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKey, true)
      closeDialog()
      if (state.bar !== undefined) {
        state.bar.remove()
        state.bar = undefined
      }
      clearPaint()
    }

    // ---- slot: the way in --------------------------------------------------------

    function NOOP_HOOK() {
      return false
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

    function TurnDeleteAction(props) {
      const sessionId = props.sessionId
      const useSession = typeof props.useSession === 'function' ? props.useSession : NOOP_HOOK
      const running = useSession(snapshot => snapshot?.running === true)
      const reachable = typeof sessionId === 'string' && sessionId.length > 0
      return h('button', {
        type: 'button',
        style: {
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28, padding: 6, border: 'none', borderRadius: 28,
          background: 'transparent', color: 'var(--dsw-alias-label-tertiary, #6b7280)',
          cursor: running ? 'default' : 'pointer', opacity: running ? 0.4 : 1,
        },
        title: running ? zh['error.busy'] : zh['action.enter'],
        'aria-label': zh['action.enter'],
        'aria-disabled': running || undefined,
        onClick: running || !reachable
          ? undefined
          : () => { start(sessionId) },
      }, h(TrashGlyph, {}))
    }

    const inject = ['slots', 'locale', 'uiConversation']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh }), 'turn-delete: dictionaries')
      ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
        name: 'conversation.chat.assistant-actions',
        id: 'turn-delete',
        order: 90,
        locale: NS,
        inject: (sessionId) => ({ sessionId }),
      }, TurnDeleteAction))
      ctx.effect(() => () => stop(), 'turn-delete: teardown')
    }

    return { inject, apply }
  },
})
