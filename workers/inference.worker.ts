/// <reference lib="webworker" />
import type * as Ort from "onnxruntime-web";
import { openAudio } from "@/lib/audio/open";
import { blobSource } from "@/lib/audio/source";
import { fetchModel } from "@/lib/browser/model-cache";
import { clearPcmStores, createPcmStore, type PcmStore } from "@/lib/browser/pcm-store";
import { analyze, type WindowScore } from "@/lib/pipeline/analyze";
import { perchModel, type OrtModule, type OrtSession, type ScoreModel } from "@/lib/pipeline/model";
import type { BackendPreference, FromWorker, ModelBackend, ToWorker } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

// The app may be served under a base path (e.g. /web-annotator on GitHub Pages); worker chunks live in <base>/_next/.
const BASE_PATH = self.location.pathname.split("/_next/")[0];
const ORT_DIR = `${BASE_PATH}/ort/`;
const ORT_URL = `${ORT_DIR}ort.webgpu.min.mjs`;

let model: ScoreModel | null = null;
let modelLoading: Promise<void> | null = null;
let requestedPreference: BackendPreference | null = null;

interface Job {
  id: number;
  controller: AbortController;
  sampleRate: number;
  store: PcmStore | null;
}
let job: Job | null = null;
let jobRunning = false;

function post(msg: FromWorker, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

async function loadOrt(): Promise<typeof Ort> {
  // Loaded at runtime from <base>/ort (copied by scripts/copy-ort.mjs) so the bundler leaves ORT's wasm loading alone.
  const ort: typeof Ort = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ ORT_URL);
  ort.env.wasm.wasmPaths = ORT_DIR;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  return ort;
}

/** True for a hardware WebGPU adapter. Software fallbacks (e.g. SwiftShader) are far slower than WASM. */
async function hasHardwareWebGpu(): Promise<boolean> {
  type Adapter = { info?: { isFallbackAdapter?: boolean }; isFallbackAdapter?: boolean };
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<Adapter | null> } }).gpu;
  try {
    const adapter = await gpu?.requestAdapter();
    return !!adapter && !(adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter);
  } catch {
    return false;
  }
}

async function loadModel(url: string, preference: BackendPreference) {
  const ort = await loadOrt();
  // Not kept after the session is created: ORT copies it, and holding it would cost ~400 MB.
  const modelBytes = await fetchModel(url, (p) => post({ type: "modelProgress", ...p }));

  // ORT silently drops the WebGPU provider when no adapter exists, so decide ourselves.
  const attempts: ModelBackend[] =
    preference === "wasm" ? ["wasm"] : preference === "webgpu" || (await hasHardwareWebGpu()) ? ["webgpu", "wasm"] : ["wasm"];
  let lastError: unknown;
  for (const backend of attempts) {
    try {
      const session = await ort.InferenceSession.create(modelBytes, {
        executionProviders: [backend],
        graphOptimizationLevel: "all",
      });
      model = perchModel(ort as unknown as OrtModule, session as unknown as OrtSession);
      post({ type: "modelReady", backend, threads: ort.env.wasm.numThreads ?? 1 });
      return;
    } catch (e) {
      lastError = e;
      console.warn(`Could not create ${backend} session`, e);
    }
  }
  throw lastError;
}

async function runJob(id: number, file: File, settings: Parameters<typeof analyze>[2]) {
  if (job) job.controller.abort();
  await job?.store?.close();

  const controller = new AbortController();
  const current: Job = { id, controller, sampleRate: 0, store: null };
  job = current;
  const t0 = performance.now();
  jobRunning = true;

  try {
    if (!model) {
      if (!modelLoading) throw new Error("Model is not loaded");
      await modelLoading;
    }
    const stream = await openAudio(blobSource(file));
    current.sampleRate = stream.info.sampleRate;
    if (stream.info.format !== "wav") current.store = await createPcmStore(`job-${id}-${crypto.randomUUID()}.pcm`);

    // Window scores are sent in small groups to keep message overhead low.
    let pending: WindowScore[] = [];
    const flush = () => {
      if (pending.length) post({ type: "windows", jobId: id, windows: pending });
      pending = [];
    };

    const res = await analyze(stream, model!, settings, {
      signal: controller.signal,
      onStart: (info, totalWindows) => post({ type: "started", jobId: id, info, totalWindows }),
      onWindow: (w) => {
        pending.push(w);
        flush();
      },
      onMono: current.store ? (m) => current.store!.append(m) : undefined,
    });
    flush();
    post({ type: "done", jobId: id, durationSec: res.durationSec, elapsedMs: performance.now() - t0 });
  } catch (e) {
    const cancelled = controller.signal.aborted;
    post({ type: "failed", jobId: id, message: cancelled ? "Cancelled" : String((e as Error)?.message ?? e), cancelled });
  } finally {
    if (job === current) jobRunning = false;
  }
}

function serveClip(reqId: number, jobId: number, startSec: number, endSec: number) {
  if (!job || job.id !== jobId || !job.store) {
    post({ type: "clipError", reqId, message: "Clip audio is not available for this recording" });
    return;
  }
  const rate = job.sampleRate;
  const pcm = job.store.read(startSec * rate, (endSec - startSec) * rate);
  const samples = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i] / 32768;
  post({ type: "clip", reqId, sampleRate: rate, samples }, [samples.buffer]);
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case "loadModel":
      if (modelLoading && requestedPreference === msg.backend) break;
      if (jobRunning) {
        post({ type: "modelError", message: "Cannot switch backend while a recording is being processed" });
        break;
      }
      model = null;
      requestedPreference = msg.backend;
      modelLoading = loadModel(msg.url, msg.backend).catch((e) => {
        modelLoading = null;
        requestedPreference = null;
        post({ type: "modelError", message: String((e as Error)?.message ?? e) });
      });
      break;
    case "analyze":
      void runJob(msg.jobId, msg.file, msg.settings);
      break;
    case "cancel":
      if (job?.id === msg.jobId) job.controller.abort();
      break;
    case "clip":
      serveClip(msg.reqId, msg.jobId, msg.startSec, msg.endSec);
      break;
  }
};

void clearPcmStores();
