import type { AudioInfo } from "@/lib/audio/types";
import type { WindowScore } from "@/lib/pipeline/analyze";
import type { AnalysisSettings } from "@/lib/pipeline/config";

export type ToWorker =
  | { type: "loadModel"; url: string; backend: BackendPreference }
  | { type: "analyze"; jobId: number; file: File; settings: AnalysisSettings }
  | { type: "cancel"; jobId: number }
  | { type: "clip"; reqId: number; jobId: number; startSec: number; endSec: number };

export type ModelBackend = "webgpu" | "wasm";
export type BackendPreference = "auto" | ModelBackend;

export type FromWorker =
  | { type: "modelProgress"; loaded: number; total: number | null; cached: boolean }
  | { type: "modelReady"; backend: ModelBackend; threads: number }
  | { type: "modelError"; message: string }
  | { type: "started"; jobId: number; info: AudioInfo; totalWindows: number | null }
  | { type: "windows"; jobId: number; windows: WindowScore[] }
  | { type: "done"; jobId: number; durationSec: number; elapsedMs: number }
  | { type: "failed"; jobId: number; message: string; cancelled: boolean }
  | { type: "clip"; reqId: number; sampleRate: number; samples: Float32Array }
  | { type: "clipError"; reqId: number; message: string };
