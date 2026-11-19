import { describe, expect, it } from "vitest";
import {
  checkSelectionTable,
  formatSelectionTable,
  SELECTION_COLUMNS,
  toSelectionRows,
} from "@/lib/pipeline/selection-table";

const HEADER = SELECTION_COLUMNS.join("\t");

describe("selection table", () => {
  it("round-trips through the checker without issues", () => {
    const rows = toSelectionRows(
      [
        { begin: 10, end: 15, score: 0.91 },
        { begin: 0, end: 5.1234, score: 0.7 },
      ],
      { sampleRate: 48000 },
    );
    expect(rows[0]).toMatchObject({ Selection: "1", "Begin Time (s)": "0", "End Time (s)": "5.123", Channel: "1" });
    const tsv = formatSelectionTable(rows, "\t");
    expect(tsv.split("\n")[0]).toBe(
      "Selection\tView\tChannel\tBegin Time (s)\tEnd Time (s)\tLow Freq (Hz)\tHigh Freq (Hz)\tAnnotation\tcall_type\tcondition\tdistance\tcount\tScore",
    );
    const res = checkSelectionTable(tsv);
    expect(res.issues).toEqual([]);
    expect(res.rows).toHaveLength(2);
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

  it("reports structural and row problems", () => {
    const bad = [
      HEADER,
      "1\tSpectrogram 1\t1\t10\t5\t0\t24000\tpenguin\t\t\t\t",
      "1\tSpectrogram 1\t1\t20\t25\t0\t24000\tpenguin\t\t\t\t",
      "3\tSpectrogram 1\tx\t30\t35\t0\t24000\tpenguin\t\t\t\t2.5",
      "4\tSpectrogram 1\t1\t40\t45\t5000\t1000\tpenguin\t\t\t\t",
      "5\tSpectrogram 1\t1\t50\t55\t-1\tabc\tpenguin\t\t\t\t",
    ].join("\n");
    const msgs = checkSelectionTable(bad).issues.map((i) => `${i.row}:${i.message}`);
    expect(msgs).toEqual([
      "1:End Time (s) must be greater than Begin Time (s)",
      "2:Selection 1 is already used on row 1",
      "3:Channel must be a number",
      "3:count must be empty or a non-negative integer",
      "4:High Freq (Hz) must be greater than Low Freq (Hz)",
      "5:Low Freq (Hz) must be ≥ 0",
      "5:High Freq (Hz) must be a number",
    ]);
  });

  it("flags tables without the frequency columns", () => {
    const old = [
      "Selection\tView\tChannel\tBegin Time (s)\tEnd Time (s)\tAnnotation\tcall_type\tcondition\tdistance\tcount",
      "1\tSpectrogram 1\t1\t0\t5\tpenguin\t\t\t\t",
    ].join("\n");
    const missing = checkSelectionTable(old).issues.filter((i) => i.message === "Missing column").map((i) => i.column);
    expect(missing).toEqual(["Low Freq (Hz)", "High Freq (Hz)"]);
  });

  it("flags missing columns and comma separation", () => {
    const issues = checkSelectionTable("Selection,View\n1,Spectrogram 1\n").issues.map((i) => i.message);
    expect(issues).toContain("Missing column");
    expect(issues).toContain("Raven selection tables are tab-separated; this file is not");
  });
});
