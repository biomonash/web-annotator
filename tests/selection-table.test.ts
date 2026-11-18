import { describe, expect, it } from "vitest";
import { checkSelectionTable, formatSelectionTable, toSelectionRows } from "@/lib/pipeline/selection-table";

describe("selection table", () => {
  it("round-trips through the checker without issues", () => {
    const rows = toSelectionRows([
      { begin: 10, end: 15, score: 0.91 },
      { begin: 0, end: 5.1234, score: 0.7 },
    ]);
    expect(rows[0]).toMatchObject({ Selection: "1", "Begin Time (s)": "0", "End Time (s)": "5.123", Channel: "1" });
    const tsv = formatSelectionTable(rows, "\t");
    expect(tsv.split("\n")[0]).toBe(
      "Selection\tView\tChannel\tBegin Time (s)\tEnd Time (s)\tAnnotation\tcall_type\tcondition\tdistance\tcount\tScore",
    );
    const res = checkSelectionTable(tsv);
    expect(res.issues).toEqual([]);
    expect(res.rows).toHaveLength(2);
  });

  it("omits the score column when asked", () => {
    const tsv = formatSelectionTable(toSelectionRows([{ begin: 0, end: 5, score: 0.5 }], { includeScore: false }), "\t");
    expect(tsv).not.toContain("Score");
  });

  it("reports structural and row problems", () => {
    const bad = [
      "Selection\tView\tChannel\tBegin Time (s)\tEnd Time (s)\tAnnotation\tcall_type\tcondition\tdistance\tcount",
      "1\tSpectrogram 1\t1\t10\t5\tpenguin\t\t\t\t",
      "1\tSpectrogram 1\t1\t20\t25\tpenguin\t\t\t\t",
      "3\tSpectrogram 1\tx\t30\t35\tpenguin\t\t\t\t2.5",
    ].join("\n");
    const msgs = checkSelectionTable(bad).issues.map((i) => `${i.row}:${i.message}`);
    expect(msgs).toEqual([
      "1:End Time (s) must be greater than Begin Time (s)",
      "2:Selection 1 is already used on row 1",
      "3:Channel must be a number",
      "3:count must be empty or a non-negative integer",
    ]);
  });

  it("flags missing columns and comma separation", () => {
    const issues = checkSelectionTable("Selection,View\n1,Spectrogram 1\n").issues.map((i) => i.message);
    expect(issues).toContain("Missing column");
    expect(issues).toContain("Raven selection tables are tab-separated; this file is not");
  });
});
