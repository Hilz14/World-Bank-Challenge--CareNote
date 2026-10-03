import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

// State and markup tests only. No microphone, model, authentication or patient data.
export function makeHarness(html) {
  const nodes = new Map(), listeners = new Map(), values = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      innerHTML: '', textContent: '', value: '', checked: false, hidden: false,
      open: false, dataset: {}, className: '',
      classList: { add() {}, remove() {}, toggle() {} },
      focus() {},
    });
    return nodes.get(selector);
  };
  const modes = [{ value: 'dictation' }, { value: 'typing' }];
  const document = {
    body: node('body'),
    querySelector: node,
    querySelectorAll: selector => selector === 'input[name=mode]' ? modes : [],
    addEventListener: (name, callback) => listeners.set(name, callback),
  };
  const context = vm.createContext({
    document, env: {}, crypto: webcrypto, TextEncoder, TextDecoder,
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    indexedDB: { open: () => ({}) }, navigator: { onLine: true },
    addEventListener() {}, setTimeout: () => 0, clearTimeout() {},
    performance, console, Uint8Array, Blob,
  });
  const module = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const source = module.replace(/^import .*?;\s*$/m, '').split('/* ---------- start ---------- */')[0];
  vm.runInContext(source, context);
  return { context, node, nodes, listeners, run: source => vm.runInContext(source, context) };
}

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const h = makeHarness(html);
h.run('newConsult()');
assert.match(h.node('#save').innerHTML, /disabled aria-disabled="true"/);
assert.match(h.node('#patient').innerHTML, /Start recording/);
assert.match(h.node('#patient').innerHTML, /consent box/);
assert.match(h.node('#fields').innerHTML, /Additional clinician notes/);
assert.doesNotMatch(h.node('#fields').innerHTML, /id="additional-fields" open/);

h.run("S.consult.patientRef = 'FICTIONAL-001'; S.consult.fields.complaint.text = 'Headache since yesterday'; renderAll()");
assert.match(h.node('#review-summary').innerHTML, /1 awaiting review/);
assert.equal(h.node('#workflow-state').textContent, '1 field to review');
assert.match(h.node('#save').innerHTML, /disabled aria-disabled="true"/);

h.run('S.consult.fields.complaint.confirmed = true; renderAll()');
assert.equal(h.node('#workflow-state').textContent, 'Ready to save');
assert.doesNotMatch(h.node('#save').innerHTML, /disabled/);

// Editing a reviewed field must reset approval without overwriting the input.
const input = h.node('#ta-complaint');
input.dataset = { input: 'field', f: 'complaint' };
input.value = 'No headache today';
input.id = 'ta-complaint';
h.listeners.get('input')({ target: input });
assert.equal(h.run('S.consult.fields.complaint.confirmed'), false);
assert.equal(h.node('#workflow-state').textContent, '1 field to review');
assert.match(h.node('#save').innerHTML, /disabled aria-disabled="true"/);

h.run("S.consult.fields.plan.text = 'Fictional clinician note'; renderFields()");
assert.match(h.node('#fields').innerHTML, /id="additional-fields" open/);
for (const id of ['complaint', 'account', 'findings', 'plan', 'medicines', 'followup']) {
  assert.match(h.node('#fields').innerHTML, new RegExp(`id="ta-${id}"`));
}

h.run("S.modelState = 'error'; S.consult.consent = true; renderPatient()");
assert.match(h.node('#patient').innerHTML, /unavailable/);
assert.doesNotMatch(h.node('#patient').innerHTML, /still loading/);
h.run('S.consult.mode = "typing"; renderAll()');
assert.match(h.node('#patient').innerHTML, /Typing-only mode/);
assert.doesNotMatch(h.node('#fields').innerHTML, /data-action="field-dictate"/);
h.run('navigator.onLine = false; updateNet()');
assert.equal(h.node('#chip-net').textContent, 'Network: offline');
assert.equal(h.node('#chip-net').className, 'chip');

assert.match(html, /Twi transcription is not automatic/);
assert.match(html, /not AI detection or transcription accuracy/);
assert.doesNotMatch(html, /https:\/\/fonts\./);
console.log('PASS: review states, edit reset, save gating, optional fields, model failure, typing mode, network wording and local fonts.');
