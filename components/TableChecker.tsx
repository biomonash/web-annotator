"use client";

import { useState } from "react";
import { checkSelectionTable, type CheckResult } from "@/lib/pipeline/selection-table";

/** Upload an existing selection table and report format problems. */
export function TableChecker() {
  const [result, setResult] = useState<{ name: string; res: CheckResult } | null>(null);

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Check a selection table</h2>
      <p className="text-sm text-zinc-500">
        Validates Raven selection tables (TSV) against the expected columns: unique selection numbers, numeric times,
        and End &gt; Begin.
      </p>
      <input
        type="file"
        accept=".txt,.tsv,.csv,text/plain,text/tab-separated-values,text/csv"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) setResult({ name: f.name, res: checkSelectionTable(await f.text()) });
        }}
        className="text-sm file:mr-3 file:rounded file:border-0 file:bg-zinc-200 file:px-3 file:py-1.5 dark:file:bg-zinc-800 dark:file:text-zinc-100"
      />
      {result && (
        <div className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <p className="font-medium">
            {result.name}: {result.res.rows.length} rows,{" "}
            {result.res.issues.length === 0 ? (
              <span className="text-emerald-600">no problems found ✓</span>
            ) : (
              <span className="text-rose-600">{result.res.issues.length} problem(s)</span>
            )}
          </p>
          {result.res.issues.length > 0 && (
            <ul className="mt-2 max-h-60 list-disc space-y-0.5 overflow-auto pl-5 text-zinc-600 dark:text-zinc-300">
              {result.res.issues.slice(0, 200).map((i, k) => (
                <li key={k}>
                  {i.row != null ? `Row ${i.row}: ` : ""}
                  {i.column && i.row == null ? `${i.column}: ` : ""}
                  {i.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
