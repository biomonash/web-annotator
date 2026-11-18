"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { AudioInfo } from "@/lib/audio/types";
import type { Clip } from "@/lib/browser/clips";
import type { WindowScore } from "@/lib/pipeline/analyze";
import type { AnalysisSettings } from "@/lib/pipeline/config";
import type { BackendPreference, FromWorker, ModelBackend, ToWorker } from "@/workers/protocol";

export type ModelState =
  | { status: "idle" }
  | { status: "loading"; loaded: number; total: number | null; cached: boolean }
  | { status: "ready"; backend: ModelBackend; threads: number }
  | { status: "error"; message: string };

export type JobState =
  | { status: "none" }
  | {
      status: "running" | "done" | "failed" | "cancelled";
      jobId: number;
      file: File;
      settings: AnalysisSettings;
      info: AudioInfo | null;
      totalWindows: number | null;
      windows: WindowScore[];
      durationSec: number | null;
      elapsedMs: number | null;
      startedAt: string;
      error?: string;
    };

interface State {
  model: ModelState;
  job: JobState;
}

type Action =
  | { type: "msg"; msg: FromWorker }
  | { type: "modelLoading" }
  | { type: "start"; jobId: number; file: File; settings: AnalysisSettings };

function reducer(state: State, action: Action): State {
  if (action.type === "modelLoading") {
    return { ...state, model: { status: "loading", loaded: 0, total: null, cached: false } };
  }
  if (action.type === "start") {
    return {
      ...state,
      job: {
        status: "running",
        jobId: action.jobId,
        file: action.file,
        settings: action.settings,
        info: null,
        totalWindows: null,
        windows: [],
        durationSec: null,
        elapsedMs: null,
        startedAt: new Date().toISOString(),
      },
    };
  }

  const msg = action.msg;
  switch (msg.type) {
    case "modelProgress":
      return { ...state, model: { status: "loading", loaded: msg.loaded, total: msg.total, cached: msg.cached } };
    case "modelReady":
      return { ...state, model: { status: "ready", backend: msg.backend, threads: msg.threads } };
    case "modelError":
      return { ...state, model: { status: "error", message: msg.message } };
  }

  const job = state.job;
  if (job.status === "none" || !("jobId" in msg) || msg.jobId !== job.jobId) return state;
  switch (msg.type) {
    case "started":
      return { ...state, job: { ...job, info: msg.info, totalWindows: msg.totalWindows } };
    case "windows":
      return { ...state, job: { ...job, windows: [...job.windows, ...msg.windows] } };
    case "done":
      return { ...state, job: { ...job, status: "done", durationSec: msg.durationSec, elapsedMs: msg.elapsedMs } };
    case "failed":
      return { ...state, job: { ...job, status: msg.cancelled ? "cancelled" : "failed", error: msg.message } };
  }
  return state;
}

export function useInference() {
  const [state, dispatch] = useReducer(reducer, { model: { status: "idle" }, job: { status: "none" } });
  const workerRef = useRef<Worker | null>(null);
  const nextJob = useRef(1);
  const nextReq = useRef(1);
  const clipWaiters = useRef(new Map<number, { resolve: (c: Clip) => void; reject: (e: Error) => void }>());

  useEffect(() => {
    const worker = new Worker(new URL("../workers/inference.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    const waiters = clipWaiters.current;
    worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      const msg = ev.data;
      if (msg.type === "clip" || msg.type === "clipError") {
        const w = waiters.get(msg.reqId);
        waiters.delete(msg.reqId);
        if (msg.type === "clip") w?.resolve({ sampleRate: msg.sampleRate, samples: msg.samples });
        else w?.reject(new Error(msg.message));
        return;
      }
      dispatch({ type: "msg", msg });
    };
    worker.onerror = (e) => dispatch({ type: "msg", msg: { type: "modelError", message: e.message || "Worker crashed" } });
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const send = useCallback((msg: ToWorker) => workerRef.current?.postMessage(msg), []);

  const loadModel = useCallback(
    (url: string, backend: BackendPreference) => {
      dispatch({ type: "modelLoading" });
      send({ type: "loadModel", url, backend });
    },
    [send],
  );

  const start = useCallback(
    (file: File, settings: AnalysisSettings) => {
      const jobId = nextJob.current++;
      dispatch({ type: "start", jobId, file, settings });
      send({ type: "analyze", jobId, file, settings });
    },
    [send],
  );

  const cancel = useCallback(() => {
    if (state.job.status === "running") send({ type: "cancel", jobId: state.job.jobId });
  }, [send, state.job]);

  /** Fetches a clip from the worker's PCM store (used for non-seekable formats). */
  const workerClip = useCallback(
    (jobId: number, startSec: number, endSec: number) =>
      new Promise<Clip>((resolve, reject) => {
        const reqId = nextReq.current++;
        clipWaiters.current.set(reqId, { resolve, reject });
        send({ type: "clip", reqId, jobId, startSec, endSec });
      }),
    [send],
  );

  return { ...state, loadModel, start, cancel, workerClip };
}
