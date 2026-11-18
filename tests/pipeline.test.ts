import { describe, expect, it } from "vitest";
import { openAudio } from "@/lib/audio/open";
import { bytesSource } from "@/lib/audio/source";
import { analyze, type WindowScore } from "@/lib/pipeline/analyze";
import { DEFAULT_SETTINGS, PERCH } from "@/lib/pipeline/config";
import { findDetections } from "@/lib/pipeline/detect";
import type { ScoreModel } from "@/lib/pipeline/model";
import { makeWav, sine } from "./helpers";

/** Fake model: "detects" windows whose mean input is high (loud tone in the PoC's [0,1] scaling ≈ 0.5 mean). */
function fakeModel(positives: Set<number>): ScoreModel & { calls: number[] } {
  let next = 0;
  const calls: number[] = [];
  return {
    calls,
    async predict(batch, count) {
      expect(batch.length).toBe(count * PERCH.windowSamples);
      calls.push(count);
      return Array.from({ length: count }, () => {
        const i = next++;
        return { logit: positives.has(i) ? 4 : -4, isTop: positives.has(i) };
      });
    },
  };
}

describe("analyze", () => {
  it("scores every window including a zero-padded partial last one", async () => {
    const rate = 8000;
    const audio = sine(300, rate, 23); // 4 full windows + 3 s
    const stream = await openAudio(bytesSource(makeWav([audio], rate)));
    const model = fakeModel(new Set([1, 2, 4]));
    const seen: WindowScore[] = [];
    const mono: number[] = [];
    const res = await analyze(stream, model, { ...DEFAULT_SETTINGS, batchSize: 2 }, {
      onWindow: (w) => seen.push(w),
      onMono: (m) => mono.push(m.length),
    });

    expect(res.durationSec).toBeCloseTo(23);
    expect(res.windows.map((w) => w.index)).toEqual([0, 1, 2, 3, 4]);
    expect(seen).toEqual(res.windows);
    expect(res.windows[4]).toMatchObject({ begin: 20, end: 23 });
    expect(model.calls).toEqual([2, 2, 1]);
    expect(mono.reduce((a, b) => a + b, 0)).toBe(23 * rate);

    const dets = findDetections(res.windows, 0.5, true);
    expect(dets.map((d) => [d.begin, d.end])).toEqual([
      [5, 15],
      [20, 23],
    ]);
  });
});

describe("findDetections", () => {
  const w = (index: number, score: number): WindowScore => ({
    index,
    begin: index * 5,
    end: index * 5 + 5,
    score,
    logit: 0,
    isTop: false,
  });

  it("marks a run touching the last processed window as open until complete", () => {
    const ws = [w(0, 0.1), w(1, 0.9), w(2, 0.8)];
    expect(findDetections(ws, 0.5, false)).toMatchObject([{ id: "w1", begin: 5, end: 15, open: true, maxScore: 0.9 }]);
    expect(findDetections(ws, 0.5, true)[0].open).toBe(false);
  });

  it("respects the threshold", () => {
    const ws = [w(0, 0.6), w(1, 0.4), w(2, 0.6)];
    expect(findDetections(ws, 0.5, true)).toHaveLength(2);
    expect(findDetections(ws, 0.3, true)).toHaveLength(1);
    expect(findDetections(ws, 0.7, true)).toHaveLength(0);
  });
});
