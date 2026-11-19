# Little Penguin call detector (web)

Detects Little Penguin calls in long WAV/FLAC recordings **entirely in the browser**. It runs the Perch v2 model with
onnxruntime-web, so nothing is uploaded. It streams audio from disk window by window, so detections appear (and can be
played) while the rest of the file is still processing. Results export as Raven selection tables (TSV) or CSV.

The original Python proof of concept is `annotation_tool.py`.

## Getting started

```bash
npm install            # also copies the onnxruntime-web runtime into public/ort (postinstall)
npm run dev            # http://localhost:3000
```

The model (`perch_v2_no_dft.onnx`, about 400 MB) is downloaded on first use and kept in the browser's Cache Storage.
By default it is fetched from Hugging Face. To serve a local copy during development:

```bash
mkdir -p models   # put perch_v2_no_dft.onnx here (git-ignored)
ln -s ../models public/models
echo 'NEXT_PUBLIC_MODEL_URL=/models/perch_v2_no_dft.onnx' > .env.local
```

## Scripts

| Command         | What it does                                                                     |
| --------------- | -------------------------------------------------------------------------------- |
| `npm run dev`   | Dev server (sets the COOP/COEP headers needed for multi-threaded WASM)           |
| `npm run build` | Static export to `out/`; deploy anywhere that serves static files                |
| `npm test`      | Vitest unit tests; also runs the real model through onnxruntime-node if `models/` has it |
| `npm run e2e`   | Playwright end-to-end tests in Chrome (needs `sox` and `flac`, plus the local model setup above) |

### Deploying

`npm run build` produces a static site. For multi-threaded inference the host must send:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`public/_headers` handles this on Netlify and Cloudflare Pages. Without these headers the app still works, but it is
single-threaded and slower. Some hosts limit file size: `public/ort/*.wasm` is about 29 MB.

#### GitHub Pages

`.github/workflows/deploy-pages.yml` runs the tests, then builds and deploys on every push to `main`. It can also be
started manually. One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

The workflow sets two build variables:

- `NEXT_PUBLIC_BASE_PATH`: the repository's Pages path (e.g. `/web-annotator`), taken from `actions/configure-pages`.
- `NEXT_PUBLIC_COI_SERVICE_WORKER=1`: GitHub Pages can't send COOP/COEP headers, so a small service worker
  (`public/coi-sw.js`, registered by `public/coi-register.js`) adds them to same-origin responses. The page reloads once
  on the first visit. Cross-origin requests such as the model download are left alone: their CORS headers already
  satisfy COEP, and Firefox fails when a service worker relays very large cross-origin downloads.

## Layout

| Path | Purpose |
| --- | --- |
| `lib/audio/` | Streaming WAV/FLAC decoding to int16, clipping (wrap-around) fix, mono mixdown, resampling. No DOM dependency. |
| `lib/pipeline/` | Model constants, windowed analysis loop, detection runs, Raven selection table writer/checker. No DOM dependency, so it also runs under Node (see `tests/model.test.ts`). |
| `lib/browser/` | Browser-only helpers: model download and cache, OPFS clip storage, audio playback. |
| `workers/` | Inference Web Worker and its message protocol. |
| `components/` | React UI. |

## How detection works

1. The audio is decoded in chunks. Each channel gets the PoC's overflow fix, then channels are averaged to mono.
2. Every complete 5 s window is resampled to 32 kHz and scored by Perch v2. A trailing partial window is dropped,
   as in the Python script.
3. Score = `sigmoid(logit)` for class 4878 (Little Penguin). This is a detector score, not a calibrated probability.
4. A window counts as a call when Little Penguin is the model's **top class** (the Python script's `argmax == 4878`
   rule) and its score is at or above the threshold (default 0). Both can be changed in the UI. Perch's logits are
   multi-label, so a positive penguin logit alone is common even when another class clearly wins; without the
   top-class rule most windows pass.
5. Consecutive call windows become one detection. Changing the settings regroups the windows instantly, without
   re-running the model.

To play clips: WAV files are read directly from disk. FLAC can't be seeked reliably, so the worker writes decoded mono
audio to the Origin Private File System as it processes, and clips are read back from there.
