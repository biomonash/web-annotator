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
2. Every 5 s window is resampled to 32 kHz and scored by Perch v2. The last partial window is zero-padded.
3. Score = `sigmoid(logit)` for class 4878 (Little Penguin). This is a detector score, not a calibrated probability.
4. Consecutive windows with score ≥ threshold become one detection. Changing the threshold regroups the windows
   instantly, without re-running the model.

To play clips: WAV files are read directly from disk. FLAC can't be seeked reliably, so the worker writes decoded mono
audio to the Origin Private File System as it processes, and clips are read back from there.
