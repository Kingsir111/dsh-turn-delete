window.__ModuleLoader__.load({
  id: 'dsh-turn-delete',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'turn-delete'
    const DELETE_ROUTE = '/dsh-turn-delete'
    const TURNS_ROUTE = '/dsh-turn-delete/turns'
    const HIDDEN_ROUTE = '/dsh-turn-delete/hidden'
    const DEBUG_ROUTE = '/dsh-turn-delete/debug'
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

    /** Closest ancestor that looks like one chat row, without relying on attributes. */
    function rowForText(node) {
      const viewport = typeof window === 'undefined' ? 800 : (window.innerHeight || 800)
      let element = node.parentElement
      let fallback = null
      for (let depth = 0; element !== null && element !== undefined && element !== document.body && depth < 8; depth += 1) {
        const parent = element.parentElement
        const height = typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect().height : 0
        if (height >= 28 && height <= viewport * 0.4 && parent !== null && parent.childElementCount >= 2) return element
        if (fallback === null && height >= 24) fallback = element
        element = parent
      }
      return fallback
    }

    /**
     * Hide the row whose text carries this fragment. A short fragment is only
     * trusted when it is unambiguous, so a repeated word never hides the wrong floor.
     */
    function hideByText(snippet) {
      if (typeof document.createTreeWalker !== 'function' || snippet.length < 3) return false
      const ambiguous = snippet.length < 12
      const walker = document.createTreeWalker(document.body, 4)
      const rows = []
      let node = walker.nextNode()
      while (node !== null) {
        const text = node.nodeValue
        if (typeof text === 'string' && text.includes(snippet)) {
          const host = node.parentElement
          if (host !== null && host !== undefined && host.closest('[data-dsh-turn-delete-ui]') === null) {
            const row = rowForText(node)
            if (row !== null && row !== undefined && !rows.includes(row)) {
              rows.push(row)
              if (ambiguous) break
            }
          }
        }
        node = walker.nextNode()
      }
      if (rows.length === 0) return false
      if (ambiguous && rows.length > 1) return false
      for (const row of rows) {
        row.hidden = true
        row.setAttribute('data-dsh-turn-deleted', '')
      }
      return true
    }
    // ---- anchored floors (plugin-owned anchors, no skin attributes) --------------

    const turnOfMessage = new Map()

    /** Cache messageId -> turn for this session, once. */
    async function resolveTurns(sessionId) {
      if (turnOfMessage.has(`#${sessionId}`)) return turnOfMessage
      try {
        const answer = await requestJson(`${TURNS_ROUTE}?sessionId=${encodeURIComponent(sessionId)}`, { method: 'GET' })
        const turns = answer.body?.value?.turns
        if (Array.isArray(turns)) {
          for (const item of turns) if (typeof item.messageId === 'string') turnOfMessage.set(item.messageId, item.turn)
        }
      } catch {
        // leave unresolved; the anchor simply reports turn 0
      }
      turnOfMessage.set(`#${sessionId}`, true)
      return turnOfMessage
    }

    function anchors() {
      return [...document.querySelectorAll('[data-dsh-turn-delete-anchor]')]
        .map(element => ({ element, turn: Number(element.getAttribute('data-dsh-turn-delete-anchor')) }))
        .filter(item => Number.isSafeInteger(item.turn) && item.turn > 0)
    }

    /** Top-most element that still sits below the shared container of both anchors. */
    function boundaryOf(element, other) {
      let node = element
      while (node.parentElement !== null && node.parentElement !== document.body
        && (other === null || !node.parentElement.contains(other))) {
        node = node.parentElement
      }
      return node
    }

    /** Every element of the floor that ends at `anchor`, stopping at the previous floor. */
    function floorElements(anchor, previous) {
      const top = boundaryOf(anchor, previous === null ? null : previous.element)
      if (top === document.body) return []
      const previousTop = previous === null ? null : boundaryOf(previous.element, null)
      const rows = [top]
      let cursor = top.previousElementSibling
      while (cursor !== null && cursor !== previousTop) {
        rows.push(cursor)
        cursor = cursor.previousElementSibling
      }
      return rows
    }

    function hideAnchoredFloors(deleted) {
      const list = anchors()
      let hidden = 0
      for (let index = 0; index < list.length; index += 1) {
        if (!deleted.has(list[index].turn)) continue
        const rows = floorElements(list[index], index === 0 ? null : list[index - 1])
        for (const row of rows) {
          row.hidden = true
          row.setAttribute('data-dsh-turn-deleted', '')
          hidden += 1
        }
      }
      return hidden
    }
    // ---- DOM report --------------------------------------------------------------

    /**
     * Report the live DOM outline to the Host once per page load. This is how the
     * plugin learns what a client skin actually renders, instead of guessing.
     */
    let reported = false

    function outlineOf(root) {
      const out = []
      const walk = (element, depth) => {
        if (depth > 14 || out.length > 5000) return
        const entry = { d: depth, tag: element.tagName, kids: element.childElementCount }
        for (const attribute of [...(element.attributes ?? [])]) {
          if (attribute.name === 'class' || attribute.name === 'id' || attribute.name === 'role') {
            entry[attribute.name] = attribute.value.slice(0, 160)
          } else if (attribute.name.startsWith('data-')) {
            entry[attribute.name] = attribute.value.slice(0, 120)
          }
        }
        const text = (element.textContent ?? '').trim()
        entry.chars = text.length
        out.push(entry)
        for (const child of [...element.children]) walk(child, depth + 1)
      }
      walk(root, 0)
      return out
    }

    async function reportDom(sessionId) {
      if (reported) return
      reported = true
      try {
        const outline = outlineOf(document.body)
        await requestJson(DEBUG_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'dom-outline',
            sessionId: sessionId ?? null,
            url: String(globalThis.location?.href ?? ''),
            viewport: { width: globalThis.innerWidth ?? 0, height: globalThis.innerHeight ?? 0 },
            nodes: outline,
            counts: {
              chatTurn: document.querySelectorAll('[data-chat-turn]').length,
              turnTail: document.querySelectorAll('[data-turn-tail]').length,
            },
          }),
        })
      } catch {
        reported = false
      }
    }
    // ---- persistent concealment --------------------------------------------------

    /**
     * Deleted turns stay hidden after a re-render (archive, unarchive, reload of the
     * chat). This watcher belongs to the session, not to the selection UI, and is
     * started from the first action row that mounts.
     */
    const watchers = new Map()

    function hideFloor(turn) {
      for (const row of rowsForTurn(turn)) {
        row.hidden = true
        row.setAttribute('data-dsh-turn-deleted', '')
      }
    }

    function ensureWatcher(sessionId) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return () => {}
      const existing = watchers.get(sessionId)
      if (existing !== undefined) return existing.dispose

      const watcher = {
        deleted: new Set(),
        snippets: [],
        refreshTimer: undefined,
        observer: undefined,
        frame: undefined,
        dispose: undefined,
      }

      const apply = () => {
        const anchored = hideAnchoredFloors(watcher.deleted)
        if (anchored === 0) {
          for (const turn of watcher.deleted) hideFloor(turn)
          for (const snippet of watcher.snippets) hideByText(snippet)
        }
      }

      const refresh = async () => {
        try {
          const answer = await requestJson(`${DELETED_ROUTE}?sessionId=${encodeURIComponent(sessionId)}`, { method: 'GET' })
          const body = answer.body
          if (body?.ok === true) {
            watcher.deleted = new Set([...(body.value?.turns ?? []), ...(body.value?.pending ?? [])])
            apply()
          }
        } catch {
          // keep the previous set
        }
        try {
          const answer = await requestJson(`${HIDDEN_ROUTE}?sessionId=${encodeURIComponent(sessionId)}`, { method: 'GET' })
          const turns = answer.body?.value?.turns
          if (Array.isArray(turns)) {
            watcher.snippets = turns.flatMap(item => Array.isArray(item.snippets) ? item.snippets : [])
            apply()
          }
        } catch {
          // text fallback is best effort
        }
      }

      watcher.refresh = refresh
      apply()
      void refresh()
      watcher.observer = new MutationObserver(() => {
        if (watcher.frame !== undefined) return
        watcher.frame = setTimeout(() => {
          watcher.frame = undefined
          apply()
        }, 350)
      })
      watcher.observer.observe(document.body, { childList: true, subtree: true })
      watcher.refreshTimer = setInterval(() => { void refresh() }, 4000)

      watcher.dispose = () => {
        watcher.observer?.disconnect()
        if (watcher.refreshTimer !== undefined) clearInterval(watcher.refreshTimer)
        if (watcher.frame !== undefined) clearTimeout(watcher.frame)
        watchers.delete(sessionId)
      }
      watchers.set(sessionId, watcher)
      return watcher.dispose
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
        const watcher = watchers.get(state.sessionId)
        for (const item of applied) {
          state.selection.delete(item.turn)
          watcher?.deleted.add(item.turn)
          hideFloor(item.turn)
        }
        if (refused.length > 0) {
          state.error = fill(zh['error.partial'], { ok: applied.length, bad: refused.length, code: refused[0].code ?? 'DELETE_FAILED' })
          showDialogError(state.error)
          refreshBar()
          return
        }
        closeDialog()
        paint()
        if (watchers.get(state.sessionId) !== undefined) {
          for (const item of applied) watchers.get(state.sessionId).deleted.add(item.turn)
        }
        hideAnchoredFloors(new Set(applied.map(item => item.turn)))
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
      void reportDom(sessionId)
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
      React.useEffect(() => ensureWatcher(sessionId), [sessionId])
      const anchorRef = React.useRef(null)
      React.useEffect(() => {
        const node = anchorRef.current
        if (node === null || node === undefined) return
        node.setAttribute('data-dsh-turn-delete-anchor', '0')
        void resolveTurns(sessionId).then(map => {
          const turn = map.get(props.messageId)
          if (Number.isSafeInteger(turn)) node.setAttribute('data-dsh-turn-delete-anchor', String(turn))
        })
      }, [props.messageId, sessionId])
      const reachable = typeof sessionId === 'string' && sessionId.length > 0
      return h('button', {
        ref: anchorRef,
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










