// Register the browser half against a stub DOM: one slot (the way in), no panel
// root, and a self-check that the selection layer builds its bar in plain DOM.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8')

function node(tag) {
  return {
    tagName: tag,
    style: {},
    dataset: {},
    attributes: {},
    children: [],
    textContent: '',
    hidden: false,
    isConnected: true,
    setAttribute(name, value) { this.attributes[name] = value },
    getAttribute(name) { return this.attributes[name] ?? null },
    removeAttribute(name) { delete this.attributes[name] },
    append(...items) { this.children.push(...items) },
    remove() { this.isConnected = false },
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll: () => [],
    querySelector: () => null,
    closest: () => null,
  }
}

const appended = []
const body = node('body')
body.append = (...items) => { appended.push(...items); body.children.push(...items) }

globalThis.document = {
  body,
  createElement: node,
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener() {},
  removeEventListener() {},
}

let registration
globalThis.window = { __ModuleLoader__: { load(value) { registration = value } } }
vm.runInThisContext(source, { filename: 'client.js' })
assert.ok(registration !== undefined, 'client.js registers a module factory')
assert.equal(registration.id, 'dsh-turn-delete')

const react = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: 'Fragment',
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: factory => factory(),
  useRef: () => ({ current: null }),
  useCallback: fn => fn,
}
const requireStub = specifier => {
  if (specifier === 'react') return react
  throw new Error(`unexpected require("${specifier}")`)
}

const exportsObject = registration.factory(requireStub)
assert.equal(typeof exportsObject.apply, 'function')
assert.deepEqual(exportsObject.inject, ['slots', 'locale', 'uiConversation'])

const registrations = []
const dictionaries = []
const ctx = {
  effect: factory => factory(),
  locale: { register: (ns, dicts) => { dictionaries.push({ ns, dicts }); return () => {} } },
  slots: {
    inject: (_name, factory) => factory(),
    register: (options, component) => { registrations.push({ options, component }); return () => {} },
  },
}
exportsObject.apply(ctx)

assert.equal(dictionaries.length, 1, 'one locale namespace')
assert.deepEqual(Object.keys(dictionaries[0].dicts).sort(), ['zh'])
assert.equal(registrations.length, 1, 'only the entry slot is registered')
assert.equal(registrations[0].options.name, 'conversation.chat.assistant-actions')
assert.equal(registrations[0].options.id, 'turn-delete')
assert.equal(registrations[0].options.order, 90)
assert.deepEqual(registrations[0].options.inject('session-abc'), { sessionId: 'session-abc' })
assert.equal(appended.length, 0, 'nothing is mounted until the user enters selection mode')

const element = registrations[0].component({ messageId: 'm1', sessionId: 's1' })
assert.equal(element.type, 'button')
assert.equal(element.props['aria-label'], '选择要删除的轮次')

// Entering selection mode must build its own bar in plain DOM.
element.props.onClick()
const bar = appended.find(item => item.attributes['data-dsh-turn-delete-ui'] === '')
assert.ok(bar !== undefined, 'entering selection mounts a plain-DOM bar')
assert.ok(bar.children.length >= 4, 'the bar holds a count, hint and buttons')

console.log('client registration OK')
console.log('  slot:', registrations[0].options.name + '#' + registrations[0].options.id)
console.log('  plain-DOM bar on enter:', bar !== undefined)
console.log('  locale namespaces:', dictionaries[0].ns)
