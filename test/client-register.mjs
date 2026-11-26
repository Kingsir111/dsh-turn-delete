// Register the browser half against stub Client services and a stub DOM.
// Verifies the module-loader contract, the action slot, the locale dictionaries
// and that the panel root mounts into the document.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8')

const appended = []
const stubElement = () => ({
  style: {},
  dataset: {},
  hidden: false,
  attributes: {},
  setAttribute(name, value) { this.attributes[name] = value },
  removeAttribute(name) { delete this.attributes[name] },
  append(child) { appended.push(child) },
  remove() {},
  addEventListener() {},
  removeEventListener() {},
  querySelectorAll: () => [],
  closest: () => null,
  children: [],
})

const body = stubElement()
globalThis.document = {
  body,
  createElement: stubElement,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
}
globalThis.MutationObserver = class { observe() {} disconnect() {} }
globalThis.requestAnimationFrame = fn => { fn(); return 0 }
globalThis.cancelAnimationFrame = () => {}

let registration
globalThis.window = {
  __ModuleLoader__: {
    load(value) { registration = value },
  },
}
vm.runInThisContext(source, { filename: 'client.js' })
assert.ok(registration !== undefined, 'client.js registers a module factory')
assert.equal(registration.id, 'dsh-turn-delete', 'factory id is the package name')

const react = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: 'Fragment',
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: factory => factory(),
  useRef: () => ({ current: null }),
  useCallback: fn => fn,
}
const reactDom = {
  roots: 0,
  createRoot() { reactDom.roots += 1; return { render() { reactDom.rendered = (reactDom.rendered ?? 0) + 1 }, unmount() {} } },
}
const requireStub = specifier => {
  if (specifier === 'react') return react
  if (specifier === 'react-dom/client') return reactDom
  throw new Error(`unexpected require("${specifier}")`)
}

const exportsObject = registration.factory(requireStub)
assert.equal(typeof exportsObject.apply, 'function', 'factory returns apply')
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

assert.equal(dictionaries.length, 1, 'registers one locale namespace')
assert.equal(dictionaries[0].ns, 'turn-delete')
assert.deepEqual(Object.keys(dictionaries[0].dicts).sort(), ['en', 'zh'])
assert.equal(registrations.length, 1, 'registers the action slot only')
assert.equal(reactDom.roots, 1, 'mounts its own panel root')
assert.equal(reactDom.rendered, 1, 'renders the panel host')
assert.equal(appended.length, 1, 'appends the panel host to the document')
assert.equal(appended[0].attributes['data-dsh-turn-delete-root'], '')

const actions = registrations[0]
assert.equal(actions.options.name, 'conversation.chat.assistant-actions')
assert.equal(actions.options.id, 'turn-delete', 'list slot carries a stable id')
assert.equal(actions.options.order, 90)
assert.equal(actions.options.locale, 'turn-delete')
assert.deepEqual(actions.options.inject('session-abc'), { sessionId: 'session-abc' })
assert.equal(typeof actions.component, 'function')

// The action component must render without a live framework hook face.
const element = actions.component({ messageId: 'm1', sessionId: 's1', t: key => key })
assert.equal(element.type, 'button', 'renders the trash button')
assert.equal(element.props['aria-label'], 'action.enter')
const glyphElement = element.children[0]
assert.equal(typeof glyphElement.type, 'function', 'glyph is a local component')
assert.equal(glyphElement.type({}).type, 'svg', 'inline glyph needs no icon export')

console.log('client registration OK')
console.log('  slot:', `${actions.options.name}#${actions.options.id}`)
console.log('  panel root mounted:', appended.length === 1)
console.log('  locales:', Object.keys(dictionaries[0].dicts).join(','))
console.log('  button label:', element.props['aria-label'])
