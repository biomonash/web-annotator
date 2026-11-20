import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, parseRules } from "@/lib/pipeline/rules";
import {
  checkSelectionTable,
  formatSelectionTable,
  SELECTION_COLUMNS,
  toSelectionRows,
} from "@/lib/pipeline/selection-table";

const HEADER = SELECTION_COLUMNS.join("\t");

/** One data row with the Raven columns filled in validly; only the guideline columns vary. */
const line = (annotation: string, call_type = "", condition = "", distance = "", count = "", selection = "1") =>
  [selection, "Spectrogram 1", "1", "0", "5", "0", "24000", annotation, call_type, condition, distance, count].join("\t");
const table = (...rows: string[]) => [HEADER, ...rows].join("\n");
const messages = (text: string, rules = DEFAULT_RULES) =>
  checkSelectionTable(text, rules).issues.map((i) => `${i.row}:${i.message}`);

describe("selection table export", () => {
  it("writes the guideline's columns and passes the checker once the annotator completes it", () => {
    const rows = toSelectionRows(
      [
        { begin: 10, end: 15, score: 0.91 },
        { begin: 0, end: 5.1234, score: 0.7 },
      ],
      { sampleRate: 48000 },
    );
    expect(rows[0]).toMatchObject({
      Selection: "1",
      View: "Spectrogram 1",
      Annotation: "penguin",
      "Begin Time (s)": "0",
      "End Time (s)": "5.123",
      Channel: "1",
    });
    const tsv = formatSelectionTable(rows, "\t");
    expect(tsv.split("\n")[0]).toBe(
      "Selection\tView\tChannel\tBegin Time (s)\tEnd Time (s)\tLow Freq (Hz)\tHigh Freq (Hz)\tAnnotation\tcall_type\tcondition\tdistance\tcount\tScore",
    );

    // A fresh export is a draft: penguin rows still lack call_type, distance and count, and only those are flagged.
    const draft = checkSelectionTable(tsv);
    expect(draft.rows).toHaveLength(2);
    expect(draft.issues).toHaveLength(6);
    expect(new Set(draft.issues.map((i) => i.column))).toEqual(new Set(["call_type", "distance", "count"]));

    const completed = rows.map((r) => ({ ...r, call_type: "call", distance: "close", count: "1" }));
    expect(checkSelectionTable(formatSelectionTable(completed, "\t")).issues).toEqual([]);
  });

  it.each([
    [48000, "24000"],
    [44100, "22050"],
    [24000, "12000"],
    [22050, "11025"],
  ])("defaults Low Freq to 0 and High Freq to half of %i Hz", (sampleRate, high) => {
    const [row] = toSelectionRows([{ begin: 0, end: 5 }], { sampleRate });
    expect(row["Low Freq (Hz)"]).toBe("0");
    expect(row["High Freq (Hz)"]).toBe(high);
  });

  it("keeps explicit frequencies", () => {
    const [row] = toSelectionRows([{ begin: 0, end: 5, lowFreq: 300, highFreq: 4000 }], { sampleRate: 48000 });
    expect(row).toMatchObject({ "Low Freq (Hz)": "300", "High Freq (Hz)": "4000" });
  });

  it("omits the score column when asked", () => {
    const tsv = formatSelectionTable(
      toSelectionRows([{ begin: 0, end: 5, score: 0.5 }], { sampleRate: 48000, includeScore: false }),
      "\t",
    );
    expect(tsv).not.toContain("Score");
  });
});

describe("selection table checker", () => {
  it("reports structural and row problems", () => {
    const bad = table(
      "1\tSpectrogram 1\t1\t10\t5\t0\t24000\twind\t\t\t\t",
      "1\tSpectrogram 1\t1\t20\t25\t0\t24000\twind\t\t\t\t",
      "3\tSpectrogram 1\tx\t30\t35\t0\t24000\twind\t\t\t\t",
      "4\tSpectrogram 1\t1\t40\t45\t5000\t1000\twind\t\t\t\t",
      "5\tSpectrogram 1\t1\t50\t55\t-1\tabc\twind\t\t\t\t",
    );
    expect(messages(bad)).toEqual([
      "1:End Time (s) must be greater than Begin Time (s)",
      "2:Selection 1 is already used on row 1",
      "3:Channel must be a number",
      "4:High Freq (Hz) must be greater than Low Freq (Hz)",
      "5:Low Freq (Hz) must be ≥ 0",
      "5:High Freq (Hz) must be a number",
    ]);
  });

  it("flags tables without the frequency columns", () => {
    const old = [
      "Selection\tView\tChannel\tBegin Time (s)\tEnd Time (s)\tAnnotation\tcall_type\tcondition\tdistance\tcount",
      "1\tSpectrogram 1\t1\t0\t5\twind\t\t\t\t",
    ].join("\n");
    const missing = checkSelectionTable(old).issues.filter((i) => i.message === "Missing column").map((i) => i.column);
    expect(missing).toEqual(["Low Freq (Hz)", "High Freq (Hz)"]);
  });

  it("flags missing columns and comma separation", () => {
    const issues = checkSelectionTable("Selection,View\n1,Spectrogram 1\n").issues.map((i) => i.message);
    expect(issues).toContain("Missing column");
    expect(issues).toContain("Raven selection tables are tab-separated; this file is not");
  });

  it("hints when a column name differs only in case", () => {
    const text = table(line("wind")).replace("Annotation", "annotation");
    expect(checkSelectionTable(text).issues[0].message).toMatch(/^Missing column \(found "annotation"/);
  });

  it("checks the file extension when the name is known", () => {
    const text = table(line("wind"));
    expect(checkSelectionTable(text, DEFAULT_RULES, { fileName: "x.tsv" }).issues).toEqual([]);
    const [issue] = checkSelectionTable(text, DEFAULT_RULES, { fileName: "x.txt" }).issues;
    expect(issue.message).toContain(".tsv");
  });
});

describe("annotation guideline rules", () => {
  it("accepts complete penguin rows, including combined conditions and count ranges", () => {
    const text = table(
      line("penguin", "call", "", "close", "1", "1"),
      line("penguin", "duet", "other_species+wind", "far", ">2", "2"),
      line("penguin", "begging", "rain", "middle", "3", "3"),
      line("wind", "", "", "", "", "4"),
      line("other_species", "", "", "", "", "5"),
    );
    expect(messages(text)).toEqual([]);
  });

  it("requires call_type, distance and count on penguin rows", () => {
    expect(messages(table(line("penguin")))).toEqual([
      "1:call_type is required when Annotation is penguin",
      "1:distance is required when Annotation is penguin",
      "1:count is required when Annotation is penguin",
    ]);
  });

  it("requires the detail columns to stay empty on non-penguin rows", () => {
    expect(messages(table(line("wind", "call", "rain", "far", "1")))).toEqual([
      "1:call_type must be empty when Annotation is not penguin",
      "1:condition must be empty when Annotation is not penguin",
      "1:distance must be empty when Annotation is not penguin",
      "1:count must be empty when Annotation is not penguin",
    ]);
  });

  it("rejects values outside the allowed lists, case-sensitively, without piling on follow-up errors", () => {
    const msgs = messages(table(line("Penguin", "call", "", "close", "1")));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatch(/^1:Annotation must be one of: penguin, wind, rain/);
  });

  it("validates call_type, distance, condition lists and count", () => {
    const msgs = messages(table(line("penguin", "bray", "wind+wind", "near", "0")));
    expect(msgs).toEqual([
      expect.stringMatching(/^1:call_type must be one of: call, song, duet, begging$/),
      expect.stringMatching(/^1:condition lists "wind" more than once$/),
      expect.stringMatching(/^1:distance must be one of: close, middle, far$/),
      "1:count must be a whole number (1, 2, 3...) or a range such as >1, >2, >3",
    ]);
    expect(messages(table(line("penguin", "call", "wind+", "close", "1")))[0]).toMatch(/^1:condition has an empty value/);
    expect(messages(table(line("penguin", "call", "wind+gale", "close", "1")))[0]).toMatch(
      /^1:condition has unrecognised value\(s\) "gale"/,
    );
  });

  it("reports a non-spectrogram view as a warning, not an error", () => {
    const text = table(line("wind")).replace("Spectrogram 1", "Waveform 1");
    const { issues } = checkSelectionTable(text);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ column: "View", severity: "warning" });
  });

  it("follows the rules it is given, so a guideline change needs no code change", () => {
    const next = structuredClone(DEFAULT_RULES);
    const callType = next.columns.find((c) => c.name === "call_type");
    if (callType?.type !== "enum") throw new Error("call_type should be an enum");
    callType.values = ["bray", "growl"];
    const rules = parseRules(next);

    expect(messages(table(line("penguin", "bray", "", "close", "1")), rules)).toEqual([]);
    expect(messages(table(line("penguin", "call", "", "close", "1")), rules)).toEqual([
      "1:call_type must be one of: bray, growl",
    ]);
    // ...and the bundled guideline is unaffected.
    expect(messages(table(line("penguin", "call", "", "close", "1")))).toEqual([]);
  });

  it("reports the guideline the table was checked against", () => {
    expect(checkSelectionTable(table(line("wind"))).guideline).toEqual(DEFAULT_RULES.guideline);
  });
});

describe("rules file validation", () => {
  const clone = () => structuredClone(DEFAULT_RULES) as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  it("accepts the bundled rules", () => {
    expect(() => parseRules(clone())).not.toThrow();
  });

  it("rejects typos and unknown fields", () => {
    const raw = clone();
    raw.columns[0].allowEmtpy = true;
    expect(() => parseRules(raw)).toThrow(/allowEmtpy/);
  });

  it("rejects references to unknown columns", () => {
    const raw = clone();
    raw.conditionalRules[0].require = ["colour"];
    expect(() => parseRules(raw)).toThrow(/unknown column "colour"/);
  });

  it("rejects invalid regular expressions and duplicate column names", () => {
    const withBadRegex = clone();
    withBadRegex.columns.find((c: { name: string }) => c.name === "count").pattern = "([";
    expect(() => parseRules(withBadRegex)).toThrow(/not a valid regular expression/);

    const withDuplicate = clone();
    withDuplicate.columns.push({ ...withDuplicate.columns[0] });
    expect(() => parseRules(withDuplicate)).toThrow(/duplicate column/);
  });
});