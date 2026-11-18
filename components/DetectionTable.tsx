"use client";

import { formatClock } from "@/lib/format";

export interface Row {
  id: string;
  begin: number;
  end: number;
  maxScore: number;
  open: boolean;
  deleted: boolean;
  edited: boolean;
}

interface Props {
  rows: readonly Row[];
  playingId: string | null;
  selectedId: string | null;
  onPlay(row: Row): void;
  onSelect(id: string): void;
  onEdit(id: string, patch: { begin?: number; end?: number; deleted?: boolean }): void;
  onReset(id: string): void;
}

function TimeInput({ value, onChange, disabled }: { value: number; onChange(v: number): void; disabled: boolean }) {
  return (
    <input
      type="number"
      step={0.1}
      min={0}
      value={Number(value.toFixed(3))}
      disabled={disabled}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (e.target.value !== "" && Number.isFinite(v)) onChange(v);
      }}
      className="w-24 rounded border border-zinc-300 bg-transparent px-1.5 py-0.5 text-right font-mono tabular-nums disabled:opacity-60 dark:border-zinc-700"
    />
  );
}

export function DetectionTable({ rows, playingId, selectedId, onPlay, onSelect, onEdit, onReset }: Props) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-zinc-500">No detections above the threshold yet.</p>;
  }
  let n = 0;
  return (
    <div className="max-h-[28rem] overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
          <tr>
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2"></th>
            <th className="px-3 py-2">Begin (s)</th>
            <th className="px-3 py-2">End (s)</th>
            <th className="px-3 py-2">Time</th>
            <th className="px-3 py-2 text-right">Score</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            if (!r.deleted) n++;
            return (
              <tr
                key={r.id}
                onClick={() => onSelect(r.id)}
                className={`border-t border-zinc-100 dark:border-zinc-800 ${r.id === selectedId ? "bg-amber-50 dark:bg-amber-950/30" : ""} ${r.deleted ? "text-zinc-400 line-through" : ""}`}
              >
                <td className="px-3 py-1.5 tabular-nums">{r.deleted ? "–" : n}</td>
                <td className="px-3 py-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlay(r);
                    }}
                    className="w-16 rounded bg-sky-600 px-2 py-0.5 text-xs font-medium text-white no-underline hover:bg-sky-700"
                  >
                    {playingId === r.id ? "■ Stop" : "▶ Play"}
                  </button>
                </td>
                <td className="px-3 py-1.5">
                  <TimeInput value={r.begin} disabled={r.deleted} onChange={(v) => onEdit(r.id, { begin: v })} />
                </td>
                <td className="px-3 py-1.5">
                  <TimeInput value={r.end} disabled={r.deleted} onChange={(v) => onEdit(r.id, { end: v })} />
                </td>
                <td className="px-3 py-1.5 font-mono text-xs text-zinc-500">
                  {formatClock(r.begin)}
                  {r.open && <span className="ml-2 rounded bg-sky-100 px-1 text-sky-700 dark:bg-sky-900 dark:text-sky-200">growing…</span>}
                  {r.edited && <span className="ml-2 rounded bg-zinc-200 px-1 dark:bg-zinc-700">edited</span>}
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.maxScore.toFixed(3)}</td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  {r.edited && !r.deleted && (
                    <button onClick={() => onReset(r.id)} className="mr-2 text-xs text-zinc-500 hover:underline">
                      reset
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(r.id, { deleted: !r.deleted });
                    }}
                    className="text-xs text-rose-600 no-underline hover:underline"
                  >
                    {r.deleted ? "restore" : "remove"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
