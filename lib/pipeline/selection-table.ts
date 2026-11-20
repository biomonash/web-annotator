import Papa from "papaparse";
import { DEFAULT_RULES, requiredColumns, type ColumnRule, type Rules, type Severity } from "./rules";

/** Columns of the selection table, in order, as defined by the bundled guideline (selection-table-rules.json). */
export const SELECTION_COLUMNS: readonly string[] = requiredColumns(DEFAULT_RULES).map((c) => c.name);

export const SCORE_COLUMN = "Score";

export type SelectionRow = Record<string, string>;

export interface SelectionInput {
  begin: number;
  end: number;
  /** Defaults to 0 Hz. */
  lowFreq?: number;
  /** Defaults to the Nyquist frequency (half the recording's sample rate). */
  highFreq?: number;
  score?: number;
  annotation?: string;
}

export interface TableOptions {
  /** Sample rate of the analysed recording; the default High Freq is half of it. */
  sampleRate: number;
  includeScore?: boolean;
  /** Raven channel index (1-based) the selections refer to. */
  channel?: number;
  /** Overrides the guideline's default Annotation (`exportDefault` in the rules, "penguin"). */
  annotation?: string;
}

const fmtNum = (t: number) => String(Number(t.toFixed(3)));

/**
 * Builds the rows to export. Which columns exist, their order and the default View / Annotation values
 * come from the rules; only the values this tool measures (times, frequencies, ...) are computed here.
 * The annotator completes the guideline columns (call_type, distance, count, ...) afterwards in Raven.
 */
export function toSelectionRows(
  items: readonly SelectionInput[],
  opts: TableOptions,
  rules: Rules = DEFAULT_RULES,
): SelectionRow[] {
  const { sampleRate, includeScore = true, channel = 1 } = opts;
  const nyquist = sampleRate / 2;
  const columns = requiredColumns(rules);
  return [...items]
    .sort((a, b) => a.begin - b.begin)
    .map((d, i) => {
      const computed: Record<string, string | undefined> = {
        Selection: String(i + 1),
        Channel: String(channel),
        "Begin Time (s)": fmtNum(d.begin),
        "End Time (s)": fmtNum(d.end),
        "Low Freq (Hz)": fmtNum(d.lowFreq ?? 0),
        "High Freq (Hz)": fmtNum(d.highFreq ?? nyquist),
        Annotation: d.annotation ?? opts.annotation,
      };
      const row: SelectionRow = {};
      for (const c of columns) row[c.name] = computed[c.name] ?? c.exportDefault ?? "";
      if (includeScore && d.score != null) row[SCORE_COLUMN] = d.score.toFixed(4);
      return row;
    });
}

export function formatSelectionTable(
  rows: readonly SelectionRow[],
  delimiter: "\t" | ",",
  rules: Rules = DEFAULT_RULES,
): string {
  // Required columns always; optional ones (e.g. Score) only when some row has a value for them.
  const columns = rules.columns.filter((c) => c.headerRequired || rows.some((r) => c.name in r)).map((c) => c.name);
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
  severity: Severity;
}

export interface CheckResult {
  delimiter: string;
  columns: string[];
  rows: SelectionRow[];
  issues: TableIssue[];
  /** The guideline the table was checked against. */
  guideline: Rules["guideline"];
}

export interface CheckOptions {
  /** When given, the file extension is checked against the rules. */
  fileName?: string;
}

const DELIMITER_NAMES: Record<string, string> = { "\t": "tab", ",": "comma", ";": "semicolon" };

const OPERATOR_TEXT = {
  ">": "greater than",
  ">=": "greater than or equal to",
  "<": "less than",
  "<=": "less than or equal to",
} as const;

const compare = (a: number, op: keyof typeof OPERATOR_TEXT, b: number) =>
  op === ">" ? a > b : op === ">=" ? a >= b : op === "<" ? a < b : a <= b;

/** Why a (trimmed) cell value breaks its column's rule, phrased to follow the column name; null if it is fine. */
function valueProblem(c: ColumnRule, v: string, norm: (s: string) => string, pattern?: RegExp): string | null {
  if (v === "") return c.allowEmpty ? null : "is required";
  switch (c.type) {
    case "integer":
    case "number": {
      const n = Number(v);
      if (!Number.isFinite(n)) return "must be a number";
      const positiveInt = c.type === "integer" && c.min === 1;
      if (c.type === "integer" && !Number.isInteger(n)) return positiveInt ? "must be a positive integer" : "must be a whole number";
      if (c.min != null && n < c.min) return positiveInt ? "must be a positive integer" : `must be ≥ ${c.min}`;
      if (c.max != null && n > c.max) return `must be ≤ ${c.max}`;
      return null;
    }
    case "text":
      return pattern && !pattern.test(v) ? (c.message ?? "has an invalid format") : null;
    case "enum":
      return c.values.some((x) => norm(x) === norm(v)) ? null : `must be one of: ${c.values.join(", ")}`;
    case "enumList": {
      const parts = v.split(c.separator);
      if (parts.some((p) => p === "")) return `has an empty value (separate values with "${c.separator}", without spaces)`;
      const allowed = new Set(c.values.map(norm));
      const bad = parts.filter((p) => !allowed.has(norm(p)));
      if (bad.length > 0) return `has unrecognised value(s) ${bad.map((b) => `"${b}"`).join(", ")}; allowed: ${c.values.join(", ")}`;
      if (!c.allowDuplicates) {
        const dup = parts.find((p, i) => parts.findIndex((q) => norm(q) === norm(p)) !== i);
        if (dup) return `lists "${dup}" more than once`;
      }
      return null;
    }
  }
}

/**
 * Checks a selection table against the rules (the bundled guideline by default).
 * This is a generic interpreter: it knows the rule types, not the guideline's columns or values.
 */
export function checkSelectionTable(text: string, rules: Rules = DEFAULT_RULES, opts: CheckOptions = {}): CheckResult {
  const cs = rules.file.caseSensitive;
  const norm = (s: string) => (cs ? s : s.toLowerCase());
  const delimiter = rules.file.delimiter;

  const parsed = Papa.parse<SelectionRow>(text.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    delimitersToGuess: [...new Set([delimiter, "\t", ","])],
  });
  const columns = parsed.meta.fields ?? [];
  const issues: TableIssue[] = [];
  const add = (row: number | null, column: string | null, message: string, severity?: Severity) =>
    issues.push({ row, column, message, severity: severity ?? rules.defaultSeverity });

  for (const e of parsed.errors) add(e.row != null ? e.row + 1 : null, null, e.message);

  const ext = rules.file.extension;
  if (opts.fileName && ext && !opts.fileName.toLowerCase().endsWith(ext.toLowerCase())) {
    add(null, null, `File name should end with ${ext} (this one is "${opts.fileName}")`);
  }

  // Which header column implements each rule column (differs only in case when matching is case-insensitive).
  const actual = new Map<string, string>();
  for (const c of rules.columns) {
    const h = columns.find((f) => norm(f) === norm(c.name));
    if (h !== undefined) actual.set(c.name, h);
  }

  const missing = rules.columns.filter((c) => c.headerRequired && !actual.has(c.name));
  for (const c of missing) {
    const nearMiss = columns.find((f) => f.toLowerCase() === c.name.toLowerCase());
    add(null, c.name, nearMiss ? `Missing column (found "${nearMiss}"; column names are case-sensitive)` : "Missing column");
  }
  const dupes = columns.filter((c, i) => columns.indexOf(c) !== i);
  for (const c of new Set(dupes)) add(null, c, "Duplicate column");
  if (rules.file.extraColumns !== "allow") {
    const known = new Set(rules.columns.map((c) => norm(c.name)));
    for (const f of new Set(columns)) {
      if (!known.has(norm(f))) add(null, f, "Unexpected column", rules.file.extraColumns === "warn" ? "warning" : "error");
    }
  }
  if (parsed.meta.delimiter !== delimiter) {
    add(null, null, `Raven selection tables are ${DELIMITER_NAMES[delimiter]}-separated; this file is not`);
  }

  const rows = parsed.data;
  // Row checks need every required column; otherwise the header problems above are the useful output.
  if (missing.length === 0) {
    const patterns = new Map<string, RegExp>();
    for (const c of rules.columns) if (c.type === "text" && c.pattern) patterns.set(c.name, new RegExp(c.pattern, cs ? "" : "i"));
    const present = rules.columns.filter((c) => actual.has(c.name));
    const seen = new Map<string, Map<string, number>>(); // column -> value -> first row using it
    const cell = (r: SelectionRow, name: string) => (r[actual.get(name)!] ?? "").trim();

    rows.forEach((r, i) => {
      const rowNo = i + 1;
      const invalid = new Set<string>(); // columns whose value already failed its own rule on this row

      for (const c of present) {
        const v = cell(r, c.name);
        const problem = valueProblem(c, v, norm, patterns.get(c.name));
        if (problem) {
          invalid.add(c.name);
          add(rowNo, c.name, `${c.name} ${problem}`, c.severity);
          continue;
        }
        if (c.unique && v !== "") {
          const key = c.type === "integer" || c.type === "number" ? String(Number(v)) : norm(v);
          const used = seen.get(c.name) ?? new Map<string, number>();
          seen.set(c.name, used);
          const prev = used.get(key);
          if (prev != null) add(rowNo, c.name, `${c.name} ${v} is already used on row ${prev}`, c.severity);
          else used.set(key, rowNo);
        }
      }

      // Cross-column comparisons apply once both values are valid numbers (avoids duplicate messages).
      for (const cmp of rules.comparisons) {
        if (!actual.has(cmp.column) || !actual.has(cmp.otherColumn)) continue;
        const a = cell(r, cmp.column);
        const b = cell(r, cmp.otherColumn);
        if (a === "" || b === "") continue;
        const x = Number(a);
        const y = Number(b);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (!compare(x, cmp.operator, y)) {
          add(rowNo, cmp.column, `${cmp.column} ${cmp.message ?? `must be ${OPERATOR_TEXT[cmp.operator]} ${cmp.otherColumn}`}`, cmp.severity);
        }
      }

      for (const rule of rules.conditionalRules) {
        const w = rule.when.column;
        if (!actual.has(w) || invalid.has(w)) continue; // an invalid value was already reported; don't pile on
        const value = cell(r, w);
        if (value === "") continue;
        const list = (rule.when.in ?? rule.when.notIn ?? []).map(norm);
        if (rule.when.in ? !list.includes(norm(value)) : list.includes(norm(value))) continue;
        const cond = `${w} is ${rule.when.in ? "" : "not "}${(rule.when.in ?? rule.when.notIn ?? []).join(" or ")}`;
        for (const name of rule.require ?? []) {
          if (actual.has(name) && cell(r, name) === "") add(rowNo, name, `${name} ${rule.message ?? `is required when ${cond}`}`, rule.severity);
        }
        for (const name of rule.mustBeEmpty ?? []) {
          if (actual.has(name) && cell(r, name) !== "") add(rowNo, name, `${name} ${rule.message ?? `must be empty when ${cond}`}`, rule.severity);
        }
      }
    });
  }

  return { delimiter: parsed.meta.delimiter, columns, rows, issues, guideline: rules.guideline };
}