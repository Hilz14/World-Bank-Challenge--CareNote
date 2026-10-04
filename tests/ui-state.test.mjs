import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

// State and markup tests with mocked audio and model calls. No real microphone or patient data.
export function makeHarness(html) {
  const nodes = new Map(), listeners = new Map(), values = new Map(), intervals = new Map(), timeouts = new Map();
  let clockMs = 0, nextInterval = 1, nextTimeout = 1;
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      innerHTML: '', textContent: '', value: '', checked: false, hidden: false,
      open: false, dataset: {}, className: '',
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute(name, value) { this[name] = value; },
      removeAttribute(name) { delete this[name]; },
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
    addEventListener() {},
    setTimeout: (callback, delay) => { const id = nextTimeout++; timeouts.set(id, { callback, delay }); return id; },
    clearTimeout: id => timeouts.delete(id),
    setInterval: callback => { const id = nextInterval++; intervals.set(id, callback); return id; },
    clearInterval: id => intervals.delete(id),
    performance: { now: () => clockMs }, console, Uint8Array, Blob,
  });
  const module = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const source = module.replace(/^import .*?;\s*$/m, '').split('/* ---------- start ---------- */')[0];
  vm.runInContext(source, context);
  return { context, node, nodes, listeners, intervals, timeouts, setTime: value => { clockMs = value; }, run: source => vm.runInContext(source, context) };
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
assert.equal(h.node('#workflow-state').textContent, '1 section to review');
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
assert.equal(h.node('#workflow-state').textContent, '1 section to review');
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
assert.equal(h.node('#consent-box').hidden, true);
assert.equal(h.node('#review-step-number').textContent, '02');
assert.equal(h.node('#review-panel').open, true);
h.run('navigator.onLine = false; updateNet()');
assert.equal(h.node('#chip-net').textContent, 'Offline');
assert.equal(h.node('#chip-net').className, 'chip');
assert.equal(h.node('#connection-banner').className, 'connection-banner offline');
assert.match(h.node('#connection-detail').textContent, /Speech unavailable/);
h.run("S.modelState = 'loading'; updateNet()");
assert.match(h.node('#connection-detail').textContent, /Connect once to load speech/);
h.run('S.asr = {}; updateNet()');
assert.match(h.node('#connection-detail').textContent, /Speech model loaded on this device/);

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
recording.run('newConsult(); S.key = {}; S.asr = {}; S.consult.consent = true; armIdle(); renderAll()');
assert.ok([...recording.timeouts.values()].some(timer => timer.delay === 180000));
const clickRecordingAction = (action, field) => recording.listeners.get('click')({ target: {
  closest: selector => selector === '[data-action]' ? { dataset: { action, f: field }, disabled: false } : null,
} });
await clickRecordingAction('rec-patient');
assert.equal(recording.timeouts.size, 0, 'Active recording must not schedule a duration cap or inactivity lock');
assert.equal(recording.intervals.size, 1);
assert.match(recording.node('#patient').innerHTML, /id="record-elapsed"[^>]*>00:00/);
assert.ok(recording.node('#patient').innerHTML.indexOf('data-action="mark-twi"') < recording.node('#patient').innerHTML.indexOf('data-action="rec-patient"'));
assert.doesNotMatch(recording.node('#patient').innerHTML, /Ready when you are|consent box/);
recording.setTime(6500);
for (const callback of recording.intervals.values()) callback();
assert.equal(recording.node('#record-elapsed').textContent, '00:06');
recording.listeners.get('keydown')({ key: 'T', target: { matches: () => false }, preventDefault() {} });
assert.equal(recording.run('R.markers.length'), 1);
recording.setTime(198000);
for (const callback of recording.intervals.values()) callback();
assert.equal(recording.node('#record-elapsed').textContent, '03:18');
assert.equal(recording.run('R.target'), 'patient');
assert.ok(recording.run('R.rec'), 'The recording must continue beyond both 45 seconds and three minutes');
assert.equal(recording.timeouts.size, 0);
const capture = await recording.run('recStop()');
assert.equal(capture.markers[0], 6.5);
assert.equal(tracksStopped, 1);
assert.equal(recording.intervals.size, 0);
assert.equal(recording.run('R.clock'), null);
assert.ok([...recording.timeouts.values()].some(timer => timer.delay === 180000), 'Stopping must restart the normal inactivity lock');
recording.run('renderAll()');
assert.doesNotMatch(recording.node('#patient').innerHTML, /id="record-elapsed"|data-action="mark-twi"/);
assert.match(recording.node('#patient').innerHTML, /Start recording/);

// A second dictation starts from zero and stops its own clock.
await clickRecordingAction('field-dictate', 'plan');
assert.equal(recording.timeouts.size, 0);
recording.run('renderFields()');
assert.match(recording.node('#fields').innerHTML, /id="field-elapsed-plan"[^>]*>00:00/);
recording.setTime(264000);
recording.run('renderFields()');
for (const callback of recording.intervals.values()) callback();
assert.equal(recording.node('#field-elapsed-plan').textContent, '01:06');
assert.doesNotMatch(recording.node('#fields').innerHTML, /00:45/);
await recording.run('recStop()');
assert.equal(recording.intervals.size, 0);
assert.equal(tracksStopped, 2);
const resumedIdle = [...recording.timeouts.values()].find(timer => timer.delay === 180000);
assert.ok(resumedIdle);
await resumedIdle.callback();
assert.equal(recording.run('S.key'), null);
assert.equal(recording.node('#app').inert, true, 'The normal inactivity lock must still protect the workspace');

// A pending transcription counts as active use and restores the lock timer on completion.
const transcribing = makeHarness(html);
transcribing.context.navigator.mediaDevices = recording.context.navigator.mediaDevices;
transcribing.context.MediaRecorder = recording.context.MediaRecorder;
let completeTranscription;
transcribing.context.captureWork = new Promise(resolve => { completeTranscription = resolve; });
transcribing.run('newConsult(); S.key = {}; processCapture = () => captureWork');
await transcribing.run('recStart("patient")');
const pendingTranscription = transcribing.run('finishPatient()');
await Promise.resolve();
assert.equal(transcribing.run('S.busy'), 'patient');
assert.equal(transcribing.timeouts.size, 0);
completeTranscription({ rejected: 'Fictional no-speech fixture.' });
await pendingTranscription;
assert.equal(transcribing.run('S.busy'), null);
assert.ok([...transcribing.timeouts.values()].some(timer => timer.delay === 180000));
await transcribing.run('recStart("field:plan")');
await transcribing.run('lockNow()');
assert.equal(transcribing.run('R.rec'), null, 'Lock must still stop an active recording immediately');
assert.equal(transcribing.run('S.key'), null);
assert.equal(transcribing.intervals.size, 0);
assert.equal(transcribing.node('#app').inert, true);

// Longer audio uses the existing overlapping chunks and keeps later word timings for Twi marks.
const speech = makeHarness(html), asrCalls = [];
speech.context.audioFixture = new Float32Array(95 * 16000);
speech.context.asrFixture = async (pcm, options) => {
  asrCalls.push({ pcm, options });
  return { text: 'First Later', chunks: [{ text: 'First', timestamp: [0, 0.8] }, { text: 'Later', timestamp: [70, 70.6] }] };
};
speech.run('S.asr = asrFixture');
const longResult = await speech.run('runASR(audioFixture)');
assert.equal(asrCalls[0].pcm, speech.context.audioFixture);
assert.deepEqual(JSON.parse(JSON.stringify(asrCalls[0].options)), { chunk_length_s: 30, stride_length_s: 5, return_timestamps: 'word' });
assert.equal(longResult.chunks[1].start, 70);
speech.context.longResult = longResult;
const laterClip = speech.run('buildClip({ ...longResult, pcm: audioFixture, duration: 95, markers: [70.7], suspect: false })');
assert.equal(laterClip.markers[0].attached, false);
assert.equal(laterClip.words[1].flag, null, 'An audio mark must not replace nearby English.');
assert.match(speech.run('transcriptHTML(buildClip({ ...longResult, pcm: audioFixture, duration: 95, markers: [70.7], suspect: false }), 0, false)'), /Twi audio marked: enter wording and meaning/);

// The visible section cues must remain compatible with the existing routing.
recording.run(`newConsult(); S.consult.patientRef = 'FICTIONAL-ROUTING';
  const routedClip = { id: 'fixture', duration: 8, pcm: null, markers: [], suspect: false, ack: false, inserted: false, discarded: false,
    words: 'Complaint Headache. Account OriginalWord. Findings Fictional. Plan Fictional. Medicines Fictional. Follow-up Fictional.'.split(' ').map(text => ({ text, start: null, end: null, flag: text === 'OriginalWord.' ? 'manual' : null, twi: text === 'OriginalWord.' ? 'Test source term' : '', en: text === 'OriginalWord.' ? 'Checked meaning.' : '' })) };
  S.consult.clips.push(routedClip); insertClip(routedClip);`);
for (const id of ['complaint', 'account', 'findings', 'plan', 'medicines', 'followup']) assert.ok(recording.run(`S.consult.fields.${id}.text`).length);
assert.match(recording.run('S.consult.fields.account.text'), /Checked meaning.*Twi: Test source term/);
assert.equal(recording.node('#review-panel').open, true);
assert.match(recording.node('#save').innerHTML, /disabled/);
assert.match(recording.node('#patient').innerHTML, /class="added-clip"/);
assert.doesNotMatch(recording.node('#patient').innerHTML, /data-input="word-edit"/);

// Spoken headings must work when ASR drops sentence punctuation.
const headings = makeHarness(html);
headings.run("const unpunctuated = {words: 'Complaint The patient reports headache Account My headache started Tuesday Findings The patient is alert Plan The clinician will review Medicines The patient took paracetamol Follow up Followup arrangements are pending'.split(' ').map(text => ({text,start:null,end:null})),markers:[]};");
assert.deepEqual(JSON.parse(JSON.stringify(headings.run('clipRouting(unpunctuated, false).map(r => r.field)'))), ['complaint','account','findings','plan','medicines','followup']);
assert.equal(headings.run("splitSections('I plan to return and check my account tomorrow'.split(' ').map(text => ({text})))[0].field"), 'account');
assert.equal(headings.run("splitSections([{text:'headache',start:0,end:1},{text:'Medicines',start:2,end:2.5},{text:'paracetamol',start:2.5,end:3}])[1].field"), 'medicines');
headings.run("unpunctuated.routeField = 'plan'");
assert.deepEqual(JSON.parse(JSON.stringify(headings.run('clipRouting(unpunctuated, false).map(r => r.field)'))), ['plan']);

// First-time clinicians can start directly; existing accounts lead with PIN sign-in.
const navigation = makeHarness(html);
navigation.run('newConsult(); renderLock()');
assert.match(navigation.node('#lock-body').innerHTML, /Create clinician account/);
assert.doesNotMatch(navigation.node('#lock-body').innerHTML, /data-action="lock-signin"/);
navigation.run("LS.set('os.profiles', [{id:'fictional',name:'Fictional clinician'}]); renderLock()");
assert.match(navigation.node('#lock-body').innerHTML, /Sign in with PIN/);
const navNames = ['consult', 'records', 'glossary', 'tests', 'about'];
const navButtons = navNames.map(name => { const n = navigation.node('#nav-' + name); n.dataset.tab = name; return n; });
const panels = navNames.map(name => { const n = navigation.node('#tab-' + name); n.id = 'tab-' + name; return n; });
navigation.context.document.querySelectorAll = selector => selector === '[data-tab]' ? navButtons : selector === '.panel' ? panels : [];
navigation.node('#side-menu').showModal = function () { this.open = true; };
navigation.node('#side-menu').close = function () { this.open = false; };
navigation.run('S.key = {}; openMenu()');
assert.equal(navigation.node('#side-menu').open, true);
assert.equal(navigation.node('#menu-toggle')['aria-expanded'], 'true');
navigation.run("showTab('tests')");
assert.equal(navigation.node('#side-menu').open, false);
assert.equal(navigation.node('#menu-toggle')['aria-expanded'], 'false');
assert.equal(navigation.node('#nav-tests')['aria-current'], 'page');
assert.deepEqual(panels.filter(p => !p.hidden).map(p => p.id), ['tab-tests']);
navigation.run("showTab('consult')");
assert.equal(navigation.node('#nav-tests')['aria-current'], undefined);
assert.equal(navigation.node('#nav-consult')['aria-current'], 'page');
assert.deepEqual(panels.filter(p => !p.hidden).map(p => p.id), ['tab-consult']);
navigation.run('openMenu()');
navigation.listeners.get('keydown')({ key: 'Escape', preventDefault() {} });
assert.equal(navigation.node('#side-menu').open, false);
navigation.run('openMenu(); setLocked(true)');
assert.equal(navigation.node('#side-menu').open, false, 'Locking must close the modal so PIN entry is accessible.');

assert.match(html, /AI drafts English/);
assert.match(html, /Turn speech into clinical notes/);
assert.match(html, /Record speech, check the draft and save a reviewed patient record/);
assert.match(html, /id="side-menu"/);
assert.doesNotMatch(html, /<details class="status-menu"|id="more-menu"/);
assert.doesNotMatch(html, /MAX_CLIP_MS|R\.auto|00:45/);
assert.match(html, /not AI detection or transcription accuracy/);
assert.doesNotMatch(html, /https:\/\/fonts\./);
// Empty ASR output must retain recording-time audio markers.
const omitted = makeHarness(html);
omitted.run("const noText = buildClip({ text: '', chunks: [], duration: 5, markers: [1, 2], suspect: true });");
assert.equal((omitted.run('transcriptHTML(noText, 0, false)').match(/data-action="review-mark"/g) || []).length, 2);
assert.match(omitted.run('clipRouting(noText, true)[0].text'), /Twi audio marked/);
omitted.run('noText.markers[0].dismissed = true');
assert.equal((omitted.run('transcriptHTML(noText, 0, false)').match(/data-action="review-mark"/g) || []).length, 1);

console.log('PASS: review/save guards, edit reset, optional fields, typing mode, model failure, uncapped recording clocks, active-use and inactivity lock, longer-audio chunking, markers, six-section routing and retained Twi wording.');
