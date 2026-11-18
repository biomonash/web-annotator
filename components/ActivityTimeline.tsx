"use client";

import type { WindowScore } from "@/lib/pipeline/analyze";
import { formatClock } from "@/lib/format";

export interface TimelineRange {
  id: string;
  begin: number;
  end: number;
}

interface Props {
  windows: readonly WindowScore[];
  totalSec: number;
  processedSec: number;
  threshold: number;
  detections: readonly TimelineRange[];
  selectedId: string | null;
  onSeek(sec: number): void;
}

/** Per-window score bars across the whole recording, with detections and processing progress. */
export function ActivityTimeline({ windows, totalSec, processedSec, threshold, detections, selectedId, onSeek }: Props) {
  const W = 1000;
  const H = 80;
  const x = (t: number) => (totalSec > 0 ? (t / totalSec) * W : 0);

  const ticks: number[] = [];
  if (totalSec > 0) {
    const step = totalSec > 1800 ? 600 : totalSec > 600 ? 300 : totalSec > 120 ? 60 : 10;
    for (let t = 0; t <= totalSec; t += step) ticks.push(t);
  }

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-24 w-full cursor-crosshair rounded-md bg-zinc-100 dark:bg-zinc-900"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onSeek(((e.clientX - r.left) / r.width) * totalSec);
        }}
        role="img"
        aria-label="Penguin call score over time"
      >
        <rect x={x(processedSec)} y={0} width={Math.max(0, W - x(processedSec))} height={H} className="fill-zinc-200 dark:fill-zinc-800" />
        {detections.map((d) => (
          <rect
            key={d.id}
            x={x(d.begin)}
            y={0}
            width={Math.max(1, x(d.end) - x(d.begin))}
            height={H}
            className={d.id === selectedId ? "fill-amber-400/60" : "fill-amber-300/35"}
          />
        ))}
        {windows.map((w) => (
          <rect
            key={w.index}
            x={x(w.begin)}
            y={H - w.score * H}
            width={Math.max(0.6, x(w.end) - x(w.begin) - 0.3)}
            height={w.score * H}
            className={w.score >= threshold ? "fill-sky-600" : "fill-zinc-400 dark:fill-zinc-600"}
          />
        ))}
        <line x1={0} x2={W} y1={H - threshold * H} y2={H - threshold * H} className="stroke-rose-500" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="relative h-4 text-[10px] text-zinc-500">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2" style={{ left: `${(t / totalSec) * 100}%` }}>
            {formatClock(t).slice(0, 8)}
          </span>
        ))}
      </div>
    </div>
  );
}
