import Papa from "papaparse";
import { z } from "zod";

/** Columns of the Raven selection table produced by the PoC. */
export const SELECTION_COLUMNS = [
  "Selection",
  "View",
  "Channel",
  "Begin Time (s)",
  "End Time (s)",
  "Annotation",
  "call_type",
  "condition",
  "distance",
  "count",
] as const;

export const SCORE_COLUMN = "Score";

export type SelectionRow = Record<string, string>;

export interface SelectionInput {
  begin: number;
  end: number;
  score?: number;
  annotation?: string;
}

export interface TableOptions {
  includeScore?: boolean;
  /** Raven channel index (1-based) the selections refer to. */
  channel?: number;
  annotation?: string;
}

const fmtTime = (t: number) => String(Number(t.toFixed(3)));

export function toSelectionRows(items: readonly SelectionInput[], opts: TableOptions = {}): SelectionRow[] {
  const { includeScore = true, channel = 1, annotation = "penguin" } = opts;
  return [...items]
    .sort((a, b) => a.begin - b.begin)
    .map((d, i) => {
      const row: SelectionRow = {
        Selection: String(i + 1),
        View: "Spectrogram 1",
        Channel: String(channel),
        "Begin Time (s)": fmtTime(d.begin),
        "End Time (s)": fmtTime(d.end),
        Annotation: d.annotation ?? annotation,
        call_type: "",
        condition: "",
        distance: "",
        count: "",
      };
      if (includeScore && d.score != null) row[SCORE_COLUMN] = d.score.toFixed(4);
      return row;
    });
}

export function formatSelectionTable(rows: readonly SelectionRow[], delimiter: "\t" | ","): string {
  const columns: string[] = [...SELECTION_COLUMNS];
  if (rows.some((r) => SCORE_COLUMN in r)) columns.push(SCORE_COLUMN);
  return Papa.unparse({ fields: columns, data: rows.map((r) => columns.map((c) => r[c] ?? "")) }, {
    delimiter,
    newline: "\n",
    quotes: false,
  }) + "\n";
}

// ---------- format checking ----------

export interface TableIssue {
  /** 1-based data row number (header is row 0); null for file-level issues. */
  row: number | null;
  column: string | null;
  message: string;
}

export interface CheckResult {
  delimiter: string;
  columns: string[];
  rows: SelectionRow[];
  issues: TableIssue[];
}

const numeric = (msg: string) =>
  z
    .string()
    .trim()
    .min(1, "is required")
    .refine((s) => Number.isFinite(Number(s)), msg)
    .transform(Number);

const rowSchema = z
  .object({
    Selection: numeric("must be a number").refine((n) => Number.isInteger(n) && n >= 1, "must be a positive integer"),
    View: z.string().trim().min(1, "is required"),
    Channel: numeric("must be a number").refine((n) => Number.isInteger(n) && n >= 1, "must be a positive integer"),
    "Begin Time (s)": numeric("must be a number").refine((n) => n >= 0, "must be ≥ 0"),
    "End Time (s)": numeric("must be a number").refine((n) => n >= 0, "must be ≥ 0"),
    Annotation: z.string(),
    count: z
      .string()
      .trim()
      .refine((s) => s === "" || (Number.isInteger(Number(s)) && Number(s) >= 0), "must be empty or a non-negative integer"),
  })
  .loose()
  .refine((r) => r["End Time (s)"] > r["Begin Time (s)"], {
    message: "must be greater than Begin Time (s)",
    path: ["End Time (s)"],
  });

export function checkSelectionTable(text: string): CheckResult {
  const parsed = Papa.parse<SelectionRow>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    delimitersToGuess: ["\t", ","],
  });
  const columns = parsed.meta.fields ?? [];
  const issues: TableIssue[] = [];

  for (const e of parsed.errors) {
    issues.push({ row: e.row != null ? e.row + 1 : null, column: null, message: e.message });
  }

  const missing = SELECTION_COLUMNS.filter((c) => !columns.includes(c));
  for (const c of missing) issues.push({ row: null, column: c, message: "Missing column" });
  const dupes = columns.filter((c, i) => columns.indexOf(c) !== i);
  for (const c of new Set(dupes)) issues.push({ row: null, column: c, message: "Duplicate column" });
  if (parsed.meta.delimiter !== "\t") {
    issues.push({ row: null, column: null, message: "Raven selection tables are tab-separated; this file is not" });
  }

  const rows = parsed.data;
  if (missing.length === 0) {
    const seen = new Map<number, number>();
    rows.forEach((r, i) => {
      const res = rowSchema.safeParse(r);
      if (!res.success) {
        for (const issue of res.error.issues) {
          const column = String(issue.path[0] ?? "");
          issues.push({ row: i + 1, column: column || null, message: `${column} ${issue.message}`.trim() });
        }
      }
      const sel = Number(r.Selection);
      if (!Number.isFinite(sel)) return;
      const prev = seen.get(sel);
      if (prev != null) {
        issues.push({ row: i + 1, column: "Selection", message: `Selection ${sel} is already used on row ${prev}` });
      } else {
        seen.set(sel, i + 1);
      }
    });
  }

  return { delimiter: parsed.meta.delimiter, columns, rows, issues };
}
