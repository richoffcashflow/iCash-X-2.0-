import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {createAddressSearch} from '../lib/address-autocomplete.ts';

// Exercise the actual component's event sequence without Google requests.
// In particular, touch blur may arrive before a suggestion's click.
const require = createRequire(import.meta.url);
const slots = [], effects = [], listeners = new Map();
let cursor = 0, value = '', tree, selectedCalls = 0, focused = 0;
const hooks = {
  useState(initial) {
    const i = cursor++;
    slots[i] ??= {value: initial};
    return [slots[i].value, next => {slots[i].value = typeof next === 'function' ? next(slots[i].value) : next;}];
  },
  useRef(initial) {const i = cursor++; slots[i] ??= {current: initial}; return slots[i];},
  useEffect(effect, deps) {
    const i = cursor++, old = slots[i];
    if (!old || deps.some((dep, index) => !Object.is(dep, old.deps[index]))) {
      effects.push(() => {old?.cleanup?.(); slots[i] = {deps, cleanup: effect()};});
    }
  },
};
class TestNode {constructor(inside = false) {this.inside = inside;}}
globalThis.Node = TestNode;
globalThis.document = {
  addEventListener(name, listener) {listeners.set(name, listener);},
  removeEventListener(name, listener) {if (listeners.get(name) === listener) listeners.delete(name);},
};
const prediction = {
  placeId: 'synthetic-property', text: {toString: () => '123 Test Street, Austin, TX, USA'},
  toPlace: () => ({formattedAddress: '123 Test St, Austin, TX 78701, USA', async fetchFields() {selectedCalls++;}}),
};
globalThis.window = {google: {maps: {async importLibrary() {return {
  AutocompleteSessionToken: class {},
  AutocompleteSuggestion: {async fetchAutocompleteSuggestions() {return {suggestions: [{placePrediction: prediction}]};}},
};}}}};
process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = 'fixture-public-key';
const compiled = ts.transpileModule(readFileSync(new URL('../components/seller-address-input.tsx', import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX},
}).outputText;
const mod = {exports: {}};
new Function('require', 'module', 'exports', compiled)(name => name === 'react' ? hooks : name === 'next/script' ? {default: 'script-fixture'} : name === '@/lib/address-autocomplete' ? {createAddressSearch} : require(name), mod, mod.exports);
function walk(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(walk);
  return [node, ...walk(node.props?.children)];
}
const one = test => walk(tree).find(test);
const input = () => one(node => node.type === 'input');
const lookup = () => one(node => node.props?.className === 'seller-address-lookup');
const options = () => walk(tree).filter(node => node.props?.role === 'option');
function render() {
  cursor = 0;
  tree = mod.exports.SellerAddressInput({value, onChange(next) {value = next;}});
  input().props.ref.current = {focus() {focused++; input().props.onFocus();}};
  lookup().props.ref.current = {contains(target) {return target?.inside === true;}};
  while (effects.length) effects.shift()();
}
async function suggest(text = '123 Test') {
  input().props.onFocus();
  input().props.onChange({target: {value: text}});
  render();
  await new Promise(resolve => setTimeout(resolve, 320));
  render();
  assert.equal(options().length, 1);
}

render();
const hitbox = one(node => node.props?.className === 'seller-address-bar');
assert.equal(hitbox.type, 'label', 'Icon and padding use native input activation, even before hydration');
assert.equal(hitbox.props.htmlFor, input().props.id);
input().props.onFocus(); render();
one(node => node.type === 'script-fixture').props.onReady();
await Promise.resolve(); render();
await suggest();

const inside = new TestNode(true);
listeners.get('pointerdown')({target: inside});
lookup().props.onBlur({relatedTarget: null, currentTarget: lookup().props.ref.current});
render();
assert.equal(options().length, 1, 'Touch blur with no relatedTarget must not remove the tapped result');
assert.equal(options()[0].type, 'button');
assert.equal(options()[0].props.type, 'button', 'Selecting an address never submits the form');
assert.equal(options()[0].props.onPointerDown, undefined, 'Native touch click and list scrolling are not cancelled');
options()[0].props.onClick();
assert.equal(value, prediction.text.toString(), 'Tap fills a usable address immediately');
await new Promise(setImmediate); render();
assert.equal(value, '123 Test St, Austin, TX 78701, USA');
assert.equal(selectedCalls, 1);
assert(focused > 0);
assert.equal(options().length, 0);

await suggest('456 Test');
lookup().props.onBlur({relatedTarget: inside, currentTarget: lookup().props.ref.current});
render();
assert.equal(options().length, 1, 'Moving focus to an option keeps it available');
lookup().props.onBlur({relatedTarget: new TestNode(), currentTarget: lookup().props.ref.current});
render();
assert.equal(options().length, 0, 'Tabbing out closes the suggestions');

await suggest('789 Test');
listeners.get('pointerdown')({target: new TestNode()}); render();
assert.equal(options().length, 0, 'An outside touch closes the list');
assert.equal(listeners.has('pointerdown'), false, 'Outside listener is cleaned up');

await suggest('999 Test');
input().props.onKeyDown({key: 'ArrowDown', nativeEvent: {}, preventDefault() {}}); render();
assert.equal(options()[0].props['aria-selected'], true);
input().props.onKeyDown({key: 'Enter', nativeEvent: {}, preventDefault() {}});
await new Promise(setImmediate); render();
assert.equal(selectedCalls, 2, 'Keyboard selection still works');
input().props.onChange({target: {value: 'Manual address, Austin, TX 78701'}}); render();
assert.equal(value, 'Manual address, Austin, TX 78701', 'Manual entry remains editable');
for (const slot of slots) slot?.cleanup?.();
console.log('PASS address entry: full-box native focus, touch blur before click, native option selection, outside dismissal, keyboard navigation and manual entry.');
