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
 * Groups consecutive windows with score ≥ threshold into detections.
 * `windows` must be in index order. Pure, so it can be re-run whenever the threshold changes.
 */
export function findDetections(windows: readonly WindowScore[], threshold: number, complete: boolean): Detection[] {
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
    if (w.score >= threshold) run.push(w);
    else close(false);
  }
  close(!complete);
  return out;
}
