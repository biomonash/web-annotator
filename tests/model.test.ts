import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PERCH } from "@/lib/pipeline/config";
import { perchModel, type OrtModule, type OrtSession } from "@/lib/pipeline/model";

const MODEL_PATH = "models/perch_v2_no_dft.onnx";

// Smoke test with the real model through onnxruntime-node, proving the pipeline code is portable.
describe.skipIf(!existsSync(MODEL_PATH))("Perch model (onnxruntime-node)", () => {
  it("scores a batch of windows", async () => {
    const ort = await import("onnxruntime-node");
    const session = await ort.InferenceSession.create(MODEL_PATH);
    const model = perchModel(ort as unknown as OrtModule, session as unknown as OrtSession);
    const batch = new Float32Array(2 * PERCH.windowSamples).fill(0.5);
    for (let i = 0; i < PERCH.windowSamples; i++) batch[PERCH.windowSamples + i] = 0.5 + 0.2 * Math.sin(i / 10);
    const preds = await model.predict(batch, 2);
    expect(preds).toHaveLength(2);
    for (const p of preds) expect(Number.isFinite(p.logit)).toBe(true);
  });
});
