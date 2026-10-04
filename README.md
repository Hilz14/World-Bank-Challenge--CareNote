# CareNote

A clinician-controlled documentation tool by GOLDNexus Health for the World Bank Small AI health track. A local speech model creates an English draft; the clinician replays, edits, reviews and saves the record. Twi wording and meaning are entered and checked by the clinician. This release does not automatically transcribe or translate Twi.

Use fictional consultations while testing. Clinical validation has not been completed.

## Open and use it

Live app: https://hilz14.github.io/World-Bank-Challenge--CareNote/

1. Open the HTTPS address in a normal browser tab on your phone. Connect to the internet for the first installation.
2. Choose **Set up a new account**, enter a clinician name and choose a PIN. Use at least six digits. Keep the PIN: there is no reset that can recover the encrypted notes.
3. Wait for **Speech ready**. Reload once while online so the service worker can control the page. Open the speech status control to see network and clinician details.
4. In **Consult**, add a fictional patient reference and obtain simulated recording consent. The main recording control remains disabled without consent.
5. Choose **Start recording**. The six spoken section names stay visible beside the controls. During recording, **Mark Twi word** is the large control, elapsed time is shown, and **Stop and transcribe** sits underneath. There is no automatic recording duration limit, for either consultation recordings or field dictation. Stop the recording yourself when finished. Longer audio is transcribed in overlapping 30 second sections. Available device memory and browser behaviour still determine how much audio can be processed. The T shortcut hint appears only on larger screens with a fine pointer.
6. Replay the complete clip, check the draft and enter checked Twi wording and English meaning where applicable. The marks are clinician annotations, not an AI language detector.
7. Choose **Add to record** to open **Review the record**, edit each completed field and choose **Mark as reviewed**. The review panel also opens when you choose **Typing only**, or can be opened manually. Optional findings, plan, medicines and follow-up are under **Additional clinician notes**. These are clinician notes; the app does not generate medical recommendations.
8. Choose **Save reviewed record**. Save remains disabled while required information or review is missing. Editing a reviewed field resets its approval.
9. Find the saved record under **Records**. Use **Lock** when finished. The automatic lock remains three minutes of inactivity. Recording and transcription count as active use, so the inactivity timer restarts when they finish. Choosing Lock yourself still ends an active recording immediately.

The consultation uses a single column on desktop and phone. Empty review forms are collapsed, and review counts appear only after a field contains text. Consultation controls and secondary text use at least 14 px; text-entry controls use 16 px. The welcome screen keeps its existing layout, with consistent CareNote naming and without repeated release-status labels. Use **CareNote, by GOLDNexus Health** in the submission video.

For section routing, the clinician can say a section label such as “Complaint”, “Account” or “Medicines”. This uses simple rules. It is not AI summarisation or clinical reasoning.

## Run locally or deploy

The app consists of `index.html` and `sw.js`; there is no build step or backend. Serve the folder from localhost for development, or HTTPS for a real phone. Microphone access and browser cryptography need a secure context. Opening the HTML directly as a local file is insufficient.

For GitHub Pages, publish the root of `main`. Keep `index.html` and `sw.js` together. After an update, reconnect, reload and confirm the new interface. The UI refresh uses cache `goldnexus-carenote-v3`. Updating that app cache does not deliberately delete the speech model cache or the records database.

## Model, language and installation limits

- Model: [`Xenova/whisper-tiny.en`](https://huggingface.co/Xenova/whisper-tiny.en), an ONNX conversion of OpenAI Whisper Tiny English. Its model card declares Apache 2.0; check upstream assets and distribution terms separately.
- Runtime: `@huggingface/transformers@3.0.2`, imported from jsDelivr. Inference requests `dtype: 'q8'` and uses browser caching.
- No exact model commit is pinned yet. The repository does not contain a complete offline asset manifest or a measured full installation bundle size. Add those before claiming reproducibility or a tested weak-network distribution route.
- The download size displayed in **About** comes from runtime progress events and is shown in MiB (bytes divided by 1,048,576). It is not a measurement of every app, runtime and worker asset; measure the complete install separately for submission evidence.
- The service worker caches the app and fetched CDN resources. Transformers.js manages model caching. A registered worker or an Offline network badge does not prove that fresh inference works after closing the app.
- Twi and mixed speech can be omitted or misheard by the English model. The clinician must replay the full clip and manually preserve the source meaning. Test Ghanaian English and correction burden directly.

## Data and privacy

Saved notes are encrypted in IndexedDB using AES-GCM. A per-profile key is derived from the PIN with PBKDF2, 200,000 iterations and a random salt. Encryption keys are not saved alongside notes. Profiles contain clinician names, salts and encrypted verifier values in local storage.

Short numeric PINs remain guessable if storage is copied; the interface delay does not prevent offline guessing. Locking hides the app and removes the active key, but is not a claim of complete browser-memory erasure. Use fictional material and describe these limits accurately.

Consultation audio is temporary in memory and is cleared on save or discard. Closing the page before saving can lose unfinished work. The glossary and evaluation logs are unencrypted. Readable record exports are also unencrypted and have a prominent warning. Backup files keep note contents encrypted but include profile metadata, glossary and test logs. A lost device can lose local records unless an accessible backup exists.

## Checks completed for the interface refresh

Run the state checks with an installed Node.js runtime:

```sh
node tests/ui-state.test.mjs
```

These checks cover review counts, resetting approval after edits, save gating, optional-field visibility, typing mode, model-failure wording, network wording, recording-clock cleanup, recording beyond the former 45 second limit, active-use handling and resumption of the inactivity lock, longer-audio chunking options, keyboard markers, six-section routing and retention of checked Twi wording. They execute state and markup logic with a small test harness and a mock recorder. They do not exercise a real microphone, speech model, actual authentication, browser storage or offline inference.

## Submission evidence checklist

The builder has reported successful offline operation and Twi selection/playback, plus an approximately 50% time saving against historical writing data. Those reports should be accompanied by the tested device/version, results and historical source. They are not independently verified by the code checks below.

1. Three cold offline runs on the actual phone: initial installation online, then airplane mode, WiFi off, USB disconnected and laptop off. Close and reopen the app, record fresh English speech, review and save. Keep the failures too.
2. Ten independently checked fictional accounts, including English, Twi and mixed input for the actual speaker workflow. Count preserved facts, unsupported additions and critical errors in both the raw draft and reviewed record. Mark manual Twi and English work explicitly.
3. Paired full documentation timings using the same cases, template and final-quality standard. Include capture, model waiting, playback, corrections, manual translation, approval and save. Alternate which method goes first.
4. Consent, silence/noise, unreviewed save, edit-after-review, interrupted recording, wrong PIN, lock/reload, storage inspection and export checks on the final version.
5. The exact phone/browser, model revision, required files, byte totals and real installation measurements. A backup of patient notes is not a side-loaded model installation.
6. Country-and-year problem evidence, source and model/dataset terms, actual evaluation-set size and its limitations. The repository currently includes no measured product evaluation or country-level problem statistic.
7. The required 2 to 5 minute video showing the real end-to-end workflow, AI value, guardrails, localisation and honest limits. Follow the participant portal’s actual submission instructions and save its confirmation receipt.

The in-app Twi highlighting log measures manual marking coverage, not model recognition accuracy. Its timing averages are a helpful exploratory log; they are not a substitute for paired cases with equal final quality.
