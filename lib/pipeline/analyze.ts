import { mixToMono, OverflowFixer } from "../audio/reconstruct";
import { resample } from "../audio/resample";
import type { AudioInfo, AudioStream } from "../audio/types";
import { PERCH, type AnalysisSettings, type InputScaling } from "./config";
import { sigmoid, type ScoreModel } from "./model";

export interface WindowScore {
  index: number;
  begin: number;
  end: number;
  /** sigmoid(penguin logit), in [0, 1]. A detector score, not a calibrated probability. */
  score: number;
  logit: number;
  isTop: boolean;
}

export interface AnalyzeCallbacks {
  onStart?(info: AudioInfo, totalWindows: number | null): void;
  /** Called once per scored window, in order. */
  onWindow?(w: WindowScore): void;
  /** Mono int16 PCM at the source rate (after the clipping fix), in order. Used for clip playback. */
  onMono?(mono: Int16Array): void;
  signal?: AbortSignal;
}

export interface AnalyzeResult {
  info: AudioInfo;
  durationSec: number;
  windows: WindowScore[];
}

function scaleInPlace(x: Float32Array, mode: InputScaling): void {
  if (mode === "signed") {
    for (let i = 0; i < x.length; i++) x[i] = Math.max(-1, Math.min(1, x[i] / 32768));
  } else {
    // np.interp(x, [-32768, 32767], [0, 1]) — clamps outside the range
    for (let i = 0; i < x.length; i++) x[i] = Math.max(0, Math.min(1, (x[i] + 32768) / 65535));
  }
}

export async function analyze(
  stream: AudioStream,
  model: ScoreModel,
  settings: AnalysisSettings,
  cb: AnalyzeCallbacks = {},
): Promise<AnalyzeResult> {
  const { info } = stream;
  const rate = info.sampleRate;
  const windowFrames = Math.round(PERCH.windowSeconds * rate);
  const totalWindows = info.totalFrames != null ? Math.ceil(info.totalFrames / windowFrames) : null;
  cb.onStart?.(info, totalWindows);

  const fixers = Array.from({ length: info.channels }, () => new OverflowFixer());
  const windows: WindowScore[] = [];
  const pending: { index: number; frames: number }[] = [];
  const batch = new Float32Array(settings.batchSize * PERCH.windowSamples);

  let buf = new Float32Array(windowFrames);
  let filled = 0;
  let windowIndex = 0;
  let totalFrames = 0;

  const flushBatch = async () => {
    if (pending.length === 0) return;
    cb.signal?.throwIfAborted();
    const preds = await model.predict(batch.subarray(0, pending.length * PERCH.windowSamples), pending.length);
    pending.forEach((p, k) => {
      const begin = p.index * PERCH.windowSeconds;
      const w: WindowScore = {
        index: p.index,
        begin,
        end: begin + p.frames / rate,
        score: sigmoid(preds[k].logit),
        logit: preds[k].logit,
        isTop: preds[k].isTop,
      };
      windows.push(w);
      cb.onWindow?.(w);
    });
    pending.length = 0;
  };

  const emitWindow = async (frames: number) => {
    if (frames < windowFrames) buf.fill(0, frames); // zero-pad the trailing partial window
    const x = resample(buf, PERCH.windowSamples);
    scaleInPlace(x, settings.inputScaling);
    batch.set(x, pending.length * PERCH.windowSamples);
    pending.push({ index: windowIndex++, frames });
    if (pending.length === settings.batchSize) await flushBatch();
    buf = new Float32Array(windowFrames);
    filled = 0;
  };

  for await (const chunk of stream.chunks()) {
    cb.signal?.throwIfAborted();
    chunk.forEach((ch, c) => fixers[c].process(ch));
    const mono = mixToMono(chunk);
    totalFrames += mono.length;

    if (cb.onMono) {
      const m16 = new Int16Array(mono.length);
      for (let i = 0; i < mono.length; i++) m16[i] = Math.round(mono[i]);
      cb.onMono(m16);
    }

    let pos = 0;
    while (pos < mono.length) {
      const take = Math.min(windowFrames - filled, mono.length - pos);
      buf.set(mono.subarray(pos, pos + take), filled);
      filled += take;
      pos += take;
      if (filled === windowFrames) await emitWindow(windowFrames);
    }
  }
  if (filled > 0) await emitWindow(filled);
  await flushBatch();

  return { info, durationSec: totalFrames / rate, windows };
}
