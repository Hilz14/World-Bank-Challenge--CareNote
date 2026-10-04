import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

// State and markup tests only. No microphone, model, authentication or patient data.
export function makeHarness(html) {
  const nodes = new Map(), listeners = new Map(), values = new Map(), intervals = new Map();
  let clockMs = 0, nextInterval = 1;
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
    setInterval: callback => { const id = nextInterval++; intervals.set(id, callback); return id; },
    clearInterval: id => intervals.delete(id),
    performance: { now: () => clockMs }, console, Uint8Array, Blob,
  });
  const module = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const source = module.replace(/^import .*?;\s*$/m, '').split('/* ---------- start ---------- */')[0];
  vm.runInContext(source, context);
  return { context, node, nodes, listeners, intervals, setTime: value => { clockMs = value; }, run: source => vm.runInContext(source, context) };
}

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const h = makeHarness(html);
h.run('newConsult()');
assert.match(h.node('#save').innerHTML, /disabled aria-disabled="true"/);
assert.match(h.node('#patient').innerHTML, /Start recording/);
assert.match(h.node('#patient').innerHTML, /consent box/);
assert.equal(h.node('#review-panel').open, false);
assert.equal(h.node('#review-summary').hidden, true);
assert.equal(h.node('#review-summary').innerHTML, '');
assert.match(h.node('#fields').innerHTML, /Additional clinician notes/);
assert.doesNotMatch(h.node('#fields').innerHTML, /id="additional-fields" open/);

h.run("S.consult.patientRef = 'FICTIONAL-001'; S.consult.fields.complaint.text = 'Headache since yesterday'; renderAll()");
assert.match(h.node('#review-summary').innerHTML, /1 awaiting review/);
assert.equal(h.node('#review-panel').open, true);
assert.equal(h.node('#review-summary').hidden, false);
assert.equal(h.node('#workflow-state').textContent, '1 field to review');
assert.match(h.node('#save').innerHTML, /disabled aria-disabled="true"/);

h.run('S.consult.fields.complaint.confirmed = true; renderAll()');
assert.equal(h.node('#workflow-state').textContent, 'Ready to save');
assert.doesNotMatch(h.node('#save').innerHTML, /disabled/);

// A clinician can collapse a populated record while capturing another clip.
h.node('#review-panel').open = false;
h.run('renderAll()');
assert.equal(h.node('#review-panel').open, false);

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
assert.equal(h.node('#capture-step').hidden, true);
assert.equal(h.node('#review-panel').open, true);
h.run('navigator.onLine = false; updateNet()');
assert.equal(h.node('#chip-net').textContent, 'Network: offline');
assert.equal(h.node('#chip-net').className, 'chip');

// Mock recorder lifecycle: check the UI clock and marker controls without a microphone.
const recording = makeHarness(html);
let tracksStopped = 0;
recording.context.navigator.mediaDevices = {
  getUserMedia: async () => ({ getTracks: () => [{ stop: () => tracksStopped++ }] }),
};
recording.context.MediaRecorder = class {
  mimeType = 'audio/webm';
  start() {}
  stop() { this.ondataavailable({ data: new Blob(['fictional audio fixture']) }); this.onstop(); }
};
recording.run('newConsult(); S.asr = {}; S.consult.consent = true; renderAll()');
assert.equal(await recording.run('recStart("patient")'), true);
recording.run('renderAll()');
assert.equal(recording.intervals.size, 1);
assert.match(recording.node('#patient').innerHTML, /id="record-elapsed"[^>]*>00:00/);
assert.ok(recording.node('#patient').innerHTML.indexOf('data-action="mark-twi"') < recording.node('#patient').innerHTML.indexOf('data-action="rec-patient"'));
assert.doesNotMatch(recording.node('#patient').innerHTML, /Ready when you are|consent box/);
recording.setTime(6500);
for (const callback of recording.intervals.values()) callback();
assert.equal(recording.node('#record-elapsed').textContent, '00:06');
recording.listeners.get('keydown')({ key: 'T', target: { matches: () => false }, preventDefault() {} });
assert.equal(recording.run('R.markers.length'), 1);
const capture = await recording.run('recStop()');
assert.equal(capture.markers[0], 6.5);
assert.equal(tracksStopped, 1);
assert.equal(recording.intervals.size, 0);
assert.equal(recording.run('R.clock'), null);
recording.run('renderAll()');
assert.doesNotMatch(recording.node('#patient').innerHTML, /id="record-elapsed"|data-action="mark-twi"/);
assert.match(recording.node('#patient').innerHTML, /Start recording/);

// A second dictation starts from zero and stops its own clock.
assert.equal(await recording.run('recStart("field:plan")'), true);
recording.setTime(9500);
recording.run('renderFields()');
for (const callback of recording.intervals.values()) callback();
assert.equal(recording.node('#field-elapsed-plan').textContent, '00:03');
await recording.run('recStop()');
assert.equal(recording.intervals.size, 0);
assert.equal(tracksStopped, 2);

// The visible section cues must remain compatible with the existing routing.
recording.run(`newConsult(); S.consult.patientRef = 'FICTIONAL-ROUTING';
  const routedClip = { id: 'fixture', duration: 8, pcm: null, markers: [], suspect: false, ack: false, inserted: false, discarded: false,
    words: 'Complaint Headache. Account OriginalWord. Findings Fictional. Plan Fictional. Medicines Fictional. Follow-up Fictional.'.split(' ').map(text => ({ text, start: null, end: null, flag: text === 'OriginalWord.' ? 'manual' : null, twi: text === 'OriginalWord.' ? 'Test source term' : '', en: text === 'OriginalWord.' ? 'Checked meaning.' : '' })) };
  S.consult.clips.push(routedClip); insertClip(routedClip);`);
for (const id of ['complaint', 'account', 'findings', 'plan', 'medicines', 'followup']) assert.ok(recording.run(`S.consult.fields.${id}.text`).length);
assert.match(recording.run('S.consult.fields.account.text'), /Checked meaning.*Twi: Test source term/);
assert.equal(recording.node('#review-panel').open, true);
assert.match(recording.node('#save').innerHTML, /disabled/);

assert.match(html, /AI drafts English/);
assert.match(html, /not AI detection or transcription accuracy/);
assert.doesNotMatch(html, /https:\/\/fonts\./);
console.log('PASS: review and save states, edit reset, optional fields, typing mode, model failure, recording clocks, marker controls, six-section routing and retained Twi wording.');
