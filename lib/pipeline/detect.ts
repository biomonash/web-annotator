import type { WindowScore } from "./analyze";

export interface Detection {
  /** Stable while the run grows: based on the first window of the run. */
  id: string;
  firstWindow: number;
  lastWindow: number;
  begin: number;
  end: number;
  maxScore: number;
  meanScore: number;
  /** The run touches the most recently processed window, so it may still grow. */
  open: boolean;
}

/**
 * Whether a window counts as a penguin call.
 * With `topOnly`, penguin must also be the highest-scoring class, which is the Python PoC's rule
 * (`argmax == 4878`). Perch's logits are multi-label, so a positive penguin logit alone is common
 * even when another class clearly wins.
 */
export function isHit(w: WindowScore, threshold: number, topOnly: boolean): boolean {
  return w.score >= threshold && (!topOnly || w.isTop);
}

/**
 * Groups consecutive hit windows (see `isHit`) into detections.
 * `windows` must be in index order. Pure, so it can be re-run whenever the threshold changes.
 * `topOnly = true` with `threshold = 0` reproduces the Python PoC exactly.
 */
export function findDetections(
  windows: readonly WindowScore[],
  threshold: number,
  complete: boolean,
  topOnly = true,
): Detection[] {
  const out: Detection[] = [];
  let run: WindowScore[] = [];

  const close = (open: boolean) => {
    if (run.length === 0) return;
    const scores = run.map((w) => w.score);
    out.push({
      id: `w${run[0].index}`,
      firstWindow: run[0].index,
      lastWindow: run[run.length - 1].index,
      begin: run[0].begin,
      end: run[run.length - 1].end,
      maxScore: Math.max(...scores),
      meanScore: scores.reduce((a, b) => a + b, 0) / scores.length,
      open,
    });
    run = [];
  };

  for (const w of windows) {
    const contiguous = run.length === 0 || w.index === run[run.length - 1].index + 1;
    if (!contiguous) close(false);
    if (isHit(w, threshold, topOnly)) run.push(w);
    else close(false);
  }
  close(!complete);
  return out;
}
