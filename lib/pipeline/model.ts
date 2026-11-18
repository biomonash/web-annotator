import { PERCH } from "./config";

export interface WindowPrediction {
  /** Raw logit for the penguin class. */
  logit: number;
  /** True if the penguin class has the highest logit (the PoC's decision rule). */
  isTop: boolean;
}

/** Anything that can score batches of 5 s / 32 kHz windows. */
export interface ScoreModel {
  predict(batch: Float32Array, count: number): Promise<WindowPrediction[]>;
}

/**
 * Minimal structural types so the same adapter works with onnxruntime-web and onnxruntime-node
 * without importing either.
 */
export interface OrtModule {
  Tensor: new (type: "float32", data: Float32Array, dims: readonly number[]) => unknown;
}
export interface OrtSession {
  run(feeds: Record<string, unknown>, fetches?: readonly string[]): Promise<Record<string, { data: unknown }>>;
}

export function perchModel(ort: OrtModule, session: OrtSession): ScoreModel {
  return {
    async predict(batch, count) {
      const input = new ort.Tensor("float32", batch, [count, PERCH.windowSamples]);
      const out = await session.run({ [PERCH.inputName]: input }, [PERCH.outputName]);
      const labels = out[PERCH.outputName].data as Float32Array;
      const n = PERCH.numClasses;
      const preds: WindowPrediction[] = [];
      for (let b = 0; b < count; b++) {
        const row = labels.subarray(b * n, (b + 1) * n);
        const logit = row[PERCH.penguinClassIndex];
        let max = -Infinity;
        for (let i = 0; i < n; i++) if (row[i] > max) max = row[i];
        preds.push({ logit, isTop: logit >= max });
      }
      return preds;
    },
  };
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}
