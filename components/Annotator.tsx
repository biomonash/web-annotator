"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { wavClipLoader, type ClipLoader } from "@/lib/browser/clips";
import { isModelCached } from "@/lib/browser/model-cache";
import { playClip, stopClip } from "@/lib/browser/player";
import {
  DEFAULT_SETTINGS,
  DEFAULT_THRESHOLD,
  PERCH,
  type AnalysisSettings,
  type InputScaling,
} from "@/lib/pipeline/config";
import { findDetections } from "@/lib/pipeline/detect";
import {
  formatSelectionTable,
  toSelectionRows,
} from "@/lib/pipeline/selection-table";
import { download, formatBytes, formatClock } from "@/lib/format";
import { ActivityTimeline } from "./ActivityTimeline";
import { DetectionTable, type Row } from "./DetectionTable";
import { TableChecker } from "./TableChecker";
import { useInference } from "./useInference";
import type { BackendPreference } from "@/workers/protocol";

const MODEL_URL =
  process.env.NEXT_PUBLIC_MODEL_URL ??
  "https://huggingface.co/justinchuby/Perch-onnx/resolve/main/perch_v2_no_dft.onnx";

type Edit = { begin?: number; end?: number; deleted?: boolean };

const btn =
  "rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";
const btnSecondary =
  "rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";

export function Annotator() {
  const { model, job, loadModel, start, cancel, workerClip } = useInference();
  const [settings, setSettings] = useState<AnalysisSettings>(DEFAULT_SETTINGS);
  const [backend, setBackend] = useState<BackendPreference>("auto");
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [topOnly, setTopOnly] = useState(true);
  const [padSec, setPadSec] = useState(0);
  const [includeScore, setIncludeScore] = useState(true);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const wavLoader = useRef<{ file: File; loader: Promise<ClipLoader> } | null>(
    null,
  );

  // Load the model automatically when it is already in the browser cache.
  useEffect(() => {
    isModelCached(MODEL_URL)
      .then((hit) => hit && loadModel(MODEL_URL, "auto"))
      .catch(() => {});
  }, [loadModel]);

  useEffect(() => () => stopClip(), []);

  const active = job.status !== "none" ? job : null;
  const windows = useMemo(() => active?.windows ?? [], [active]);
  const complete = active?.status === "done";
  const totalSec =
    active?.durationSec ??
    (active?.info?.totalFrames != null
      ? active.info.totalFrames / active.info.sampleRate
      : (windows.at(-1)?.end ?? 0));
  const processedSec = windows.at(-1)?.end ?? 0;

  const detections = useMemo(
    () => findDetections(windows, threshold, complete, topOnly),
    [windows, threshold, complete, topOnly],
  );
  const rows: Row[] = useMemo(
    () =>
      detections.map((d) => {
        const e = edits[d.id];
        return {
          id: d.id,
          begin: e?.begin ?? d.begin,
          end: e?.end ?? d.end,
          maxScore: d.maxScore,
          open: d.open,
          deleted: !!e?.deleted,
          edited: e?.begin != null || e?.end != null,
        };
      }),
    [detections, edits],
  );
  const kept = rows.filter((r) => !r.deleted);

  const reset = () => {
    stopClip();
    setPlayingId(null);
    setSelectedId(null);
    setEdits({});
    setNotice(null);
  };

  const analyzeFile = (file: File, s = settings) => {
    reset();
    wavLoader.current = null;
    if (model.status === "idle" || model.status === "error")
      loadModel(MODEL_URL, backend);
    start(file, s);
  };

  const getClip = async (startSec: number, endSec: number) => {
    if (!active) throw new Error("No recording");
    if (active.info?.format === "wav") {
      if (wavLoader.current?.file !== active.file) {
        wavLoader.current = {
          file: active.file,
          loader: wavClipLoader(active.file),
        };
      }
      return (await wavLoader.current.loader)(startSec, endSec);
    }
    return workerClip(active.jobId, startSec, endSec);
  };

  const play = async (id: string, begin: number, end: number) => {
    if (playingId === id) {
      stopClip();
      setPlayingId(null);
      return;
    }
    setSelectedId(id);
    setPlayingId(id);
    try {
      const clip = await getClip(
        Math.max(0, begin),
        Math.min(totalSec || end, end),
      );
      playClip(clip, () => setPlayingId((p) => (p === id ? null : p)));
    } catch (e) {
      setPlayingId(null);
      setNotice(`Could not play clip: ${(e as Error).message}`);
    }
  };

  const stem = active?.file.name.replace(/\.[^.]+$/, "") ?? "recording";
  const exportTable = (delimiter: "\t" | ",") => {
    const table = formatSelectionTable(
      toSelectionRows(
        kept.map((r) => ({ begin: r.begin, end: r.end, score: r.maxScore })),
        // Low Freq defaults to 0 Hz and High Freq to the Nyquist frequency of the recording.
        { includeScore, sampleRate: active?.info?.sampleRate ?? PERCH.sampleRate },
      ),
      delimiter,
    );
    const ext = delimiter === "\t" ? "tsv" : "csv";
    download(
      `${stem}.Table.1.selections.${ext}`,
      table,
      delimiter === "\t" ? "text/tab-separated-values" : "text/csv",
    );
  };
  const exportProvenance = () => {
    if (!active) return;
    const info = {
      tool: "web-annotator",
      exportedAt: new Date().toISOString(),
      processedAt: active.startedAt,
      model: {
        id: PERCH.modelId,
        url: MODEL_URL,
        classIndex: PERCH.penguinClassIndex,
        windowSeconds: PERCH.windowSeconds,
      },
      backend: model.status === "ready" ? model.backend : null,
      settings: active.settings,
      threshold,
      topOnly,
      recording: {
        name: active.file.name,
        size: active.file.size,
        ...active.info,
        durationSec: totalSec,
      },
      windows: active.windows.map((w) => ({
        index: w.index,
        begin: w.begin,
        end: w.end,
        score: Number(w.score.toFixed(5)),
        logit: Number(w.logit.toFixed(4)),
        isTop: w.isTop,
      })),
    };
    download(
      `${stem}.provenance.json`,
      JSON.stringify(info, null, 2),
      "application/json",
    );
  };

  const pct = active?.totalWindows
    ? Math.min(100, (windows.length / active.totalWindows) * 100)
    : 0;
  const settingsChanged =
    active != null &&
    (active.settings.inputScaling !== settings.inputScaling ||
      active.settings.batchSize !== settings.batchSize);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Little Penguin call detector
        </h1>
        <p className="text-sm text-zinc-500">
          Runs the Perch v2 model in your browser. Recordings never leave your
          computer.
        </p>
      </header>

      {/* Model */}
      <section className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <span className="font-medium">Model</span>
        {model.status === "idle" && (
          <>
            <span className="text-zinc-500">
              Not loaded (about 400 MB, downloaded once and cached).
            </span>
            <button
              className={btn}
              onClick={() => loadModel(MODEL_URL, backend)}
            >
              Load model
            </button>
          </>
        )}
        {model.status === "loading" && (
          <span className="text-zinc-500">
            {model.cached
              ? "Loading from cache…"
              : `Downloading ${formatBytes(model.loaded)}`}
            {!model.cached && model.total
              ? ` / ${formatBytes(model.total)}`
              : ""}
            {model.total && model.loaded >= model.total
              ? " — initialising…"
              : ""}
          </span>
        )}
        {model.status === "ready" && (
          <span className="text-emerald-600">
            Ready (
            {model.backend === "webgpu"
              ? "WebGPU"
              : `WASM, ${model.threads} thread${model.threads > 1 ? "s" : ""}`}
            )
          </span>
        )}
        <label className="ml-auto flex items-center gap-2 text-zinc-500">
          Backend
          <select
            value={backend}
            disabled={
              model.status === "loading" || active?.status === "running"
            }
            onChange={(e) => {
              const b = e.target.value as BackendPreference;
              setBackend(b);
              if (model.status === "ready") loadModel(MODEL_URL, b);
            }}
            className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
          >
            <option value="auto">Auto</option>
            <option value="webgpu">WebGPU</option>
            <option value="wasm">WASM (CPU)</option>
          </select>
        </label>
        {model.status === "error" && (
          <>
            <span className="text-rose-600">Failed: {model.message}</span>
            <button
              className={btnSecondary}
              onClick={() => loadModel(MODEL_URL, backend)}
            >
              Retry
            </button>
          </>
        )}
      </section>

      {/* Input */}
      <section className="space-y-3">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f) analyzeFile(f);
          }}
          onClick={() => fileInput.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
            dragOver
              ? "border-sky-500 bg-sky-50 dark:bg-sky-950/30"
              : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700"
          }`}
        >
          <p className="font-medium">
            Drop a WAV or FLAC recording here, or click to choose
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Processing starts as soon as the model is ready; detections appear
            while the file is analysed.
          </p>
          <input
            ref={fileInput}
            type="file"
            accept=".wav,.flac,audio/wav,audio/x-wav,audio/flac"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) analyzeFile(f);
              e.target.value = "";
            }}
          />
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-500">
            Analysis settings
          </summary>
          <div className="mt-3 flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2">
              Input scaling
              <select
                value={settings.inputScaling}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    inputScaling: e.target.value as InputScaling,
                  })
                }
                className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
              >
                <option value="poc">[0, 1] (same as Python PoC)</option>
                <option value="signed">[-1, 1]</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              Batch size
              <input
                type="number"
                min={1}
                max={32}
                value={settings.batchSize}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    batchSize: Math.max(
                      1,
                      Math.min(32, Number(e.target.value) || 1),
                    ),
                  })
                }
                className="w-16 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
              />
            </label>
            {settingsChanged && active && active.status !== "running" && (
              <button
                className={btnSecondary}
                onClick={() => analyzeFile(active.file)}
              >
                Re-run with these settings
              </button>
            )}
          </div>
        </details>
      </section>

      {active && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">{active.file.name}</h2>
              <p className="text-xs text-zinc-500">
                {active.info
                  ? `${active.info.format.toUpperCase()} · ${active.info.sampleRate} Hz · ${active.info.channels} ch · ${active.info.bitsPerSample}-bit · ${formatClock(totalSec)}`
                  : "Reading file…"}
              </p>
            </div>
            <div className="flex items-center gap-3 text-sm">
              {active.status === "running" && (
                <>
                  <span className="tabular-nums text-zinc-500">
                    {model.status !== "ready"
                      ? "Waiting for model…"
                      : `${windows.length}${active.totalWindows ? ` / ${active.totalWindows}` : ""} windows`}
                  </span>
                  <button className={btnSecondary} onClick={cancel}>
                    Cancel
                  </button>
                </>
              )}
              {active.status === "done" && (
                <span className="text-emerald-600">
                  Done in {((active.elapsedMs ?? 0) / 1000).toFixed(1)} s
                </span>
              )}
              {active.status === "cancelled" && (
                <span className="text-zinc-500">Cancelled</span>
              )}
              {active.status === "failed" && (
                <span className="text-rose-600">Failed: {active.error}</span>
              )}
            </div>
          </div>

          {active.status === "running" && (
            <div className="h-1.5 w-full overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800">
              <div
                className="h-full bg-sky-600 transition-[width]"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}

          <ActivityTimeline
            windows={windows}
            totalSec={totalSec}
            processedSec={processedSec}
            threshold={threshold}
            topOnly={topOnly}
            detections={kept}
            selectedId={selectedId}
            onSeek={(t) => {
              const hit = kept.find((r) => t >= r.begin && t <= r.end);
              if (hit) void play(hit.id, hit.begin - padSec, hit.end + padSec);
              else void play(`t${Math.round(t)}`, t - 1, t + 4);
            }}
          />

          <div className="flex flex-wrap items-center gap-6 text-sm">
            <label className="flex items-center gap-2">
              Score threshold
              <input
                type="range"
                min={0}
                max={0.95}
                step={0.01}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
              <span className="w-10 font-mono tabular-nums">
                {threshold.toFixed(2)}
              </span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={topOnly}
                onChange={(e) => setTopOnly(e.target.checked)}
              />
              Penguin must be top class
            </label>
            <label className="flex items-center gap-2">
              Play padding
              <input
                type="number"
                min={0}
                max={30}
                step={0.5}
                value={padSec}
                onChange={(e) =>
                  setPadSec(Math.max(0, Number(e.target.value) || 0))
                }
                className="w-16 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
              />
              s
            </label>
            <span className="text-zinc-500">
              {kept.length} detection{kept.length === 1 ? "" : "s"}
            </span>
          </div>
          <p className="text-xs text-zinc-500">
            A window counts as a call when its score is at or above the
            threshold and, if &quot;top class&quot; is ticked, Little Penguin is
            the model&apos;s highest-scoring class (the Python script&apos;s
            rule; threshold 0 matches it exactly). Score is sigmoid(model
            logit): a detector score, not a calibrated probability. Each window
            is {PERCH.windowSeconds} s, so boundaries are approximate.
          </p>

          {notice && <p className="text-sm text-rose-600">{notice}</p>}

          <DetectionTable
            rows={rows}
            playingId={playingId}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onPlay={(r) => void play(r.id, r.begin - padSec, r.end + padSec)}
            onEdit={(id, patch) =>
              setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }))
            }
            onReset={(id) =>
              setEdits((e) => {
                const { [id]: cur, ...rest } = e;
                return cur?.deleted
                  ? { ...rest, [id]: { deleted: true } }
                  : rest;
              })
            }
          />

          <div className="flex flex-wrap items-center gap-3">
            <button
              className={btn}
              disabled={kept.length === 0}
              onClick={() => exportTable("\t")}
            >
              Download TSV (Raven)
            </button>
            <button
              className={btnSecondary}
              disabled={kept.length === 0}
              onClick={() => exportTable(",")}
            >
              Download CSV
            </button>
            <button
              className={btnSecondary}
              disabled={windows.length === 0}
              onClick={exportProvenance}
            >
              Download run info (JSON)
            </button>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeScore}
                onChange={(e) => setIncludeScore(e.target.checked)}
              />
              Include Score column
            </label>
            {active.status === "running" && (
              <span className="text-xs text-zinc-500">
                Exports include only what has been processed so far.
              </span>
            )}
          </div>
        </section>
      )}

      <hr className="border-zinc-200 dark:border-zinc-800" />
      <TableChecker />
    </div>
  );
}
