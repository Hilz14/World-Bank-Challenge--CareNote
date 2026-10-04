import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeHarness } from './ui-state.test.mjs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const h = makeHarness(html);
const clean = x => JSON.parse(JSON.stringify(x));
const flush = () => new Promise(resolve => setImmediate(resolve));
const click = (h, action, extra = {}) => h.listeners.get('click')({ target: {
  closest: selector => selector === '[data-action]' ? { dataset: { action, ...extra }, disabled: false } : null,
} });

// Stable probabilities from the actual chosen token, after suppression. No logits mutation.
h.context.logits = { dims: [1, 2], data: new Float32Array([1000, 999]) };
assert.ok(Math.abs(h.run('tokenProbability(logits, 1)') - 1 / (1 + Math.E)) < 1e-8);
assert.deepEqual([...h.context.logits.data], [1000, 999]);
h.context.logits.data = new Float32Array([0, -Infinity]);
assert.equal(h.run('tokenProbability(logits, 0)'), 1);
h.context.logits.data = new Float32Array([0, NaN]);
assert.equal(h.run('tokenProbability(logits, 0)'), null);
h.context.logits = { dims: [2, 2], data: new Float32Array([0, 1, 2, 3]) };
assert.equal(h.run('tokenProbability(logits, 0)'), null, 'Do not misread batched logits as one word score.');

// Exercise the pinned runtime's generate/streamer/collate contract, including a
// subword, ignored punctuation, repeated words and a later overlapping section.
const names = { 0: '<start>', 1: ' First', 2: ' later', 3: 'word', 4: '.', 11: '<end>' };
class TokenizerFixture {
  timestamp_begin = 12;
  all_special_ids = [0, 11];
  decode(tokens) { return tokens.map(t => names[Number(t)]).join(''); }
  combineTokensIntoWords(tokens) {
    const words = [], groups = [];
    for (let i = 0; i < tokens.length; i += 4) {
      words.push(' First', ' laterword.'); groups.push([i], [i + 1, i + 2, i + 3]);
    }
    return [words, [], groups];
  }
  collateWordTimestamps(tokens, times) {
    const [words, , groups] = this.combineTokensIntoWords(tokens);
    return words.map((text, i) => ({ text, timestamp: [times[groups[i][0]][0], times[groups[i].at(-1)][1]] }));
  }
}
class ModelFixture {
  async generate(options) {
    const tokens = [0n, 1n, 2n, 3n, 4n, 11n];
    options.streamer?.put([[0n]]);
    for (const token of tokens.slice(1)) {
      const data = new Float32Array(12);
      if (token === 1n || token === 3n) data[Number(token)] = 5;
      const logits = { dims: [1, 12], data };
      for (const observer of options.logits_processor || []) assert.equal(observer([[0n]], logits), logits);
      // Whisper applies its begin-token suppression after custom processors.
      // Read probabilities when the token is emitted, after that suppression.
      data[0] = -Infinity;
      options.streamer?.put([[token]]);
    }
    options.streamer?.end();
    return { sequences: { tolist: () => [tokens] }, token_timestamps: { tolist: () => [[0, 0, .5, .7, .8, 1]] } };
  }
}
const tokenizer = new TokenizerFixture(), model = new ModelFixture();
const originalGenerate = model.generate, originalCollate = tokenizer.collateWordTimestamps;
const asr = async (pcm, options) => {
  const count = options.chunk_length_s ? 2 : 1, tokens = [], times = [];
  for (let chunk = 0; chunk < count; chunk++) {
    const output = await asr.model.generate(options);
    const ids = output.sequences.tolist()[0].slice(1, -1);
    const ts = output.token_timestamps.tolist()[0];
    tokens.push(...ids);
    ids.forEach((_, i) => times.push([ts[i + 1] + chunk * 20, ts[i + 2] + chunk * 20]));
  }
  const chunks = asr.tokenizer.collateWordTimestamps(tokens, times, 'english');
  return { text: chunks.map(w => w.text).join(''), chunks };
};
asr.model = model; asr.tokenizer = tokenizer;
h.context.fixtureASR = asr; h.context.pcm = new Float32Array(45 * 16000);
h.run('S.asr = fixtureASR');
const scored = await h.run('runASR(pcm)');
assert.equal(scored.chunks.length, 4);
assert.ok(scored.chunks[0].modelScore > .9);
assert.ok(Math.abs(scored.chunks[1].modelScore - 1 / 11) < 1e-8, 'The weakest speech subword determines the word score; punctuation is excluded.');
assert.equal(scored.chunks[2].start, 20);
assert.equal(scored.chunks[2].modelScore, scored.chunks[0].modelScore, 'A repeated word in a later section keeps its own aligned score.');
assert.equal(model.generate, originalGenerate); assert.equal(tokenizer.collateWordTimestamps, originalCollate);
assert.equal(Object.hasOwn(model, 'generate'), false); assert.equal(Object.hasOwn(tokenizer, 'collateWordTimestamps'), false);

// Scoring errors must restore the original methods and produce an explicit
// full-recording review fallback, never a fabricated confidence value.
const failing = makeHarness(html);
let calls = 0;
const fallbackASR = async (pcm, opts) => {
  if (++calls === 1) throw new Error('Fictional scoring incompatibility');
  return { text: 'Unscored draft', chunks: [{ text: 'Unscored', timestamp: [0, .5] }, { text: 'draft', timestamp: [.5, 1] }] };
};
fallbackASR.model = new ModelFixture(); fallbackASR.tokenizer = new TokenizerFixture();
const fallbackGenerate = fallbackASR.model.generate;
failing.context.fixtureASR = fallbackASR; failing.context.pcm = new Float32Array(16000);
failing.context.console = { ...console, warn() {} };
failing.run('S.asr = fixtureASR');
const fallback = await failing.run('runASR(pcm)');
assert.equal(calls, 2); assert.equal(fallbackASR.model.generate, fallbackGenerate);
assert.ok(fallback.chunks.every(w => w.modelScore === null));
failing.context.result = fallback;
failing.run('newConsult(); const unscored = buildClip({ ...result, pcm, duration: 1, markers: [], suspect: false }); S.consult.clips.push(unscored);');
assert.equal(failing.run('unscored.fullReviewRequired'), true);
assert.match(failing.run('clipBlockers(unscored)'), /scores are unavailable/);
failing.run('unscored.ack = true');
assert.match(failing.run('clipBlockers(unscored)'), /Replay the full recording/);
failing.run('unscored.replayed = true');
assert.equal(failing.run('clipBlockers(unscored)'), null);

// Lower scores and missing scores are review flags, not Twi flags. Correction,
// playback and confirmation must gate insertion, with approval reset on edits.
const review = makeHarness(html);
review.context.pcm = new Float32Array(2 * 16000);
review.run(`newConsult(); S.key = {}; S.consult.patientRef = 'FICTIONAL-REVIEW';
  const cl = buildClip({ text: 'Complaint fifteen days', pcm, duration: 2, markers: [], suspect: false,
    chunks: [{text:'Complaint',start:0,end:.4,modelScore:.9},{text:'fifteen',start:.4,end:1,modelScore:.2},{text:'days',start:1,end:1.5,modelScore:null}] });
  S.consult.clips.push(cl); renderAll();`);
assert.deepEqual(clean(review.run('cl.words.map(w => w.needsReview)')), [false, true, true]);
assert.deepEqual(clean(review.run('cl.words.map(w => w.flag)')), [null, null, null]);
assert.match(review.node('#patient').innerHTML, /2 words need review/);
assert.match(review.node('#patient').innerHTML, /Score unavailable/);
assert.match(review.node('#patient').innerHTML, /data-action="review-word"/);
await click(review, 'review-word', { clip: '0', w: '1' });
assert.equal(review.run('cl.words[1].flag'), null, 'Opening an automatic flag must not accidentally mark the word as Twi.');
assert.match(review.node('#patient').innerHTML, /Mark as Twi/);
assert.match(review.run('clipBlockers(cl)'), /2 flagged words/);
await click(review, 'word-check', { clip: '0', idx: '1' });
assert.equal(review.run('cl.words[1].checked'), false);
assert.match(review.node('#toast').textContent, /Replay this word/);

// Real playback lifecycle with a fake audio device: starting or interrupting
// playback is insufficient. The completed audio event enables confirmation.
const players = [], revoked = [];
class AudioFixture {
  constructor(src) { this.src = src; this.events = new Map(); this.ended = false; players.push(this); }
  addEventListener(name, fn) { this.events.set(name, fn); }
  async play() {}
  pause() { this.events.get('pause')?.(); }
  end() { this.ended = true; this.events.get('ended')?.(); }
}
review.context.Audio = AudioFixture;
review.context.URL = { createObjectURL: () => 'blob:fictional-' + players.length, revokeObjectURL: value => revoked.push(value) };
const interrupted = click(review, 'word-replay', { clip: '0', idx: '1' });
await flush();
assert.equal(review.run('cl.words[1].replayed'), false);
assert.equal(review.run('playbackActive'), true);
assert.equal([...review.timeouts.values()].some(t => t.delay === 180000), false, 'Full audio review must not be interrupted by the inactivity lock.');
players.at(-1).pause(); await interrupted;
assert.equal(review.run('cl.words[1].replayed'), false);
assert.equal(review.run('playbackActive'), false);
assert.ok([...review.timeouts.values()].some(t => t.delay === 180000), 'Interrupted audio review restores the inactivity timer.');
const completed = click(review, 'word-replay', { clip: '0', idx: '1' });
await flush(); players.at(-1).end(); await completed;
assert.equal(review.run('cl.words[1].replayed'), true);
await click(review, 'word-check', { clip: '0', idx: '1' });
assert.equal(review.run('cl.words[1].checked'), true);
const edit = review.node('#fictional-word-edit');
edit.dataset = { input: 'word-edit', clip: '0', idx: '1' }; edit.value = 'five';
review.listeners.get('input')({ target: edit });
assert.equal(review.run('cl.words[1].checked'), false);
assert.equal(review.run('cl.words[1].text'), 'five');
assert.equal(review.node('#word-check-0-1')['aria-pressed'], 'false');
await click(review, 'word-check', { clip: '0', idx: '1' });

// A low-scoring Twi item keeps separate source/meaning and review requirements.
await click(review, 'word', { clip: '0', w: '2' });
assert.equal(review.run('cl.words[2].flag'), 'manual');
review.run("cl.words[2].replayed = true; cl.words[2].twi = 'fictional source'; cl.words[2].en = 'checked meaning';");
await click(review, 'word-check', { clip: '0', idx: '2' });
assert.equal(review.run('clipBlockers(cl)'), null);
const meaning = review.node('#fictional-twi-meaning');
meaning.dataset = { input: 'flag', kind: 'w', key: 'en', clip: '0', idx: '2' }; meaning.value = 'revised meaning';
review.listeners.get('input')({ target: meaning });
assert.equal(review.run('cl.words[2].checked'), false);
assert.match(review.run('clipBlockers(cl)'), /1 flagged word/);
await click(review, 'word-check', { clip: '0', idx: '2' });
review.run('insertClip(cl)');
assert.match(review.run('S.consult.fields.complaint.text'), /Five revised meaning \[Twi: fictional source\]/);
assert.equal(review.run('S.consult.fields.complaint.confirmed'), false);
assert.equal(review.run('getGloss().length'), 1, 'Only a clinician-marked Twi entry enters the glossary.');
review.run('wipeAudio()');
assert.equal(review.run('cl.pcm'), null);
assert.equal(review.run('currentAudio'), null);
assert.ok(revoked.length > 0, 'Discard/save cleanup revokes playback audio URLs as well as clearing PCM.');
const locking = click(review, 'word-replay', { clip: '0', idx: '1' });
await locking; // audio was wiped; it cannot be played or newly confirmed
review.run('cl.pcm = new Float32Array(32000)');
const beforeLock = click(review, 'clip-replay', { clip: '0' });
await flush();
await review.run('lockNow()');
await beforeLock;
assert.equal(review.run('currentAudio'), null);
assert.equal(review.run('playbackActive'), false);
assert.equal(review.run('S.key'), null);
let startAudio;
review.context.Audio = class extends AudioFixture {
  play() { return new Promise(resolve => { startAudio = resolve; }); }
};
review.run('S.key = {}');
const starting = click(review, 'clip-replay', { clip: '0' });
await flush();
await review.run('lockNow()');
startAudio(); await starting;
assert.equal(review.run('playbackActive'), false, 'A late audio-start resolution after Lock must not resume playback state.');

// Field dictation now uses the same guarded clip flow, retaining its destination
// and leaving the existing record unchanged until the clip has been reviewed.
const field = makeHarness(html);
field.context.fieldFixture = { text: 'Five days', pcm: new Float32Array(2 * 16000), duration: 2, markers: [], suspect: false,
  chunks: [{text:'Five',start:0,end:.5,modelScore:.2},{text:'days',start:.5,end:1,modelScore:.9}] };
field.run("newConsult(); S.key = {}; S.consult.fields.medicines.text = 'Existing note.'; recStop = async () => ({}); processCapture = async () => fieldFixture;");
await field.run("finishField('medicines')");
assert.equal(field.run('S.consult.fields.medicines.text'), 'Existing note.');
assert.equal(field.run('S.consult.clips[0].targetField'), 'medicines');
assert.match(field.node('#patient').innerHTML, /Medicines and doses dictation/);
assert.match(field.run('clipBlockers(S.consult.clips[0])'), /flagged word/);
field.run('const fc = S.consult.clips[0]; fc.words[0].replayed = true; fc.words[0].checked = true; insertClip(fc);');
assert.equal(field.run('S.consult.fields.medicines.text'), 'Existing note.\nFive days');
assert.equal(field.run('S.consult.fields.account.text'), '');
assert.equal(field.run('S.consult.fields.medicines.confirmed'), false);

assert.doesNotMatch(html, /It does not score its own confidence word by word/);
console.log('PASS: actual-token probabilities, subword and later-section alignment, unchanged decoding hooks, missing-score fallback, replay completion, correction approval reset, separate Twi review, audio cleanup and guarded field dictation. These are controlled fixtures, not clinical-accuracy or phone tests.');
