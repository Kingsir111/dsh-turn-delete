// Register the browser half against stub Client services.
// Verifies the module-loader contract, the slot registrations (ids, order,
// locale, injected face) and that both components are real functions.
//
//   node test/client-register.mjs
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8')

let registration
globalThis.window = {
  __ModuleLoader__: {
    load(value) { registration = value },
  },
}
vm.runInThisContext(source, { filename: 'client.js' })
assert.ok(registration !== undefined, 'client.js registers a module factory')
assert.equal(registration.id, 'dsh-turn-delete', 'factory id is the package name')
assert.equal(typeof registration.factory, 'function')

const react = {
  createElement: (type, props, ...children) => ({ type, props, children }),
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
assert.equal(registrations.length, 3, 'registers three slots')

const [actions, marker, panel] = registrations
assert.equal(panel.options.name, 'conversation.input.overlay')
assert.equal(panel.options.id, 'turn-delete-panel')
assert.equal(actions.options.name, 'conversation.chat.assistant-actions')
assert.equal(actions.options.id, 'turn-delete', 'list slot carries a stable id')
assert.equal(actions.options.order, 90)
assert.equal(actions.options.locale, 'turn-delete')
assert.equal(typeof actions.options.inject, 'function', 'actions slot injects a face')
assert.deepEqual(actions.options.inject('session-abc'), { sessionId: 'session-abc' })
assert.equal(typeof actions.component, 'function')

assert.equal(marker.options.name, 'conversation.chat.turnTail')
assert.equal(marker.options.id, 'turn-delete-marker')
assert.deepEqual(marker.options.inject('session-abc'), { sessionId: 'session-abc' })
assert.equal(typeof marker.component, 'function')

// The action component must render without a live framework hook face.
const element = actions.component({ messageId: 'm1', sessionId: 's1', t: key => key, deleteTurn: async () => ({ ok: true }) })
assert.equal(element.type, 'button', 'idle state renders the trash button')
assert.equal(element.props['aria-label'], 'action.enter')
const glyphElement = element.children[0]
assert.equal(typeof glyphElement.type, 'function', 'glyph is a local component')
assert.equal(glyphElement.type({}).type, 'svg', 'inline glyph needs no icon export')

const markerElement = marker.component({ turn: 3, sessionId: 's1', t: key => key })
assert.equal(markerElement, null, 'outside selection mode a healthy turn renders nothing')
assert.equal(typeof panel.component, 'function', 'panel component is a function')

console.log('client registration OK')
console.log('  slots:', registrations.map(entry => `${entry.options.name}#${entry.options.id}`).join(' | '))
console.log('  locales:', Object.keys(dictionaries[0].dicts).join(','))
console.log('  idle button:', element.props['aria-label'])
console.log('  slots:', registrations.map(entry => entry.options.name + '#' + entry.options.id).join(' | '))



