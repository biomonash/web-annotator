"use client";

import { useMemo, useState } from "react";
import { DEFAULT_RULES, parseRules, type Rules } from "@/lib/pipeline/rules";
import { checkSelectionTable } from "@/lib/pipeline/selection-table";

const FILE_INPUT_CLASS =
  "text-sm file:mr-3 file:rounded file:border-0 file:bg-zinc-200 file:px-3 file:py-1.5 dark:file:bg-zinc-800 dark:file:text-zinc-100";

/** Upload an existing selection table and check it against the annotation guideline (selection-table-rules.json). */
export function TableChecker() {
  const [table, setTable] = useState<{ name: string; text: string } | null>(null);
  // A rules file loaded by the user for testing a draft guideline. Lives in this page session only.
  const [custom, setCustom] = useState<{ name: string; rules: Rules } | null>(null);
  const [rulesError, setRulesError] = useState<string | null>(null);

  const rules = custom?.rules ?? DEFAULT_RULES;
  const res = useMemo(
    () => (table ? checkSelectionTable(table.text, rules, { fileName: table.name }) : null),
    [table, rules],
  );
  const errors = res?.issues.filter((i) => i.severity === "error").length ?? 0;
  const warnings = res?.issues.filter((i) => i.severity === "warning").length ?? 0;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Check a selection table</h2>
      <p className="text-sm text-zinc-500">
        Checks a Raven selection table against the annotation guideline: the required columns, the values each column may
        take, and the time and frequency ranges. Guideline: {rules.guideline.name}, version {rules.guideline.version}
        {rules.guideline.lastUpdated ? ` (${rules.guideline.lastUpdated})` : ""}
        {custom ? ` — custom rules from ${custom.name}` : ""}.
      </p>
      <input
        type="file"
        accept=".txt,.tsv,.csv,text/plain,text/tab-separated-values,text/csv"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) setTable({ name: f.name, text: await f.text() });
        }}
        className={FILE_INPUT_CLASS}
      />

      <details className="text-sm">
        <summary className="cursor-pointer text-zinc-500">Try a different guideline (rules file, this session only)</summary>
        <div className="mt-2 space-y-2">
          <input
            type="file"
            accept=".json,application/json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                setCustom({ name: f.name, rules: parseRules(JSON.parse(await f.text())) });
                setRulesError(null);
              } catch (err) {
                setRulesError(`${f.name} is not a valid rules file:\n${(err as Error).message}`);
              }
            }}
            className={FILE_INPUT_CLASS}
          />
          {custom && (
            <button
              type="button"
              onClick={() => {
                setCustom(null);
                setRulesError(null);
              }}
              className="text-xs text-zinc-500 hover:underline"
            >
              Use the built-in guideline again
            </button>
          )}
          {rulesError && <pre className="whitespace-pre-wrap text-xs text-rose-600">{rulesError}</pre>}
        </div>
      </details>

      {table && res && (
        <div className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <p className="font-medium">
            {table.name}: {res.rows.length} rows,{" "}
            {res.issues.length === 0 ? (
              <span className="text-emerald-600">no problems found ✓</span>
            ) : (
              <>
                {errors > 0 && <span className="text-rose-600">{errors} error(s)</span>}
                {errors > 0 && warnings > 0 && ", "}
                {warnings > 0 && <span className="text-amber-600">{warnings} warning(s)</span>}
              </>
            )}
          </p>
          {res.issues.length > 0 && (
            <ul className="mt-2 max-h-60 list-disc space-y-0.5 overflow-auto pl-5 text-zinc-600 dark:text-zinc-300">
              {res.issues.slice(0, 200).map((i, k) => (
                <li key={k}>
                  {i.severity === "warning" && <span className="mr-1 font-medium text-amber-600">Warning:</span>}
                  {i.row != null ? `Row ${i.row}: ` : ""}
                  {i.column && i.row == null ? `${i.column}: ` : ""}
                  {i.message}
                </li>
              ))}
            </ul>
          )}
          {res.issues.length > 200 && (
            <p className="mt-1 text-xs text-zinc-500">Showing the first 200 of {res.issues.length} problems.</p>
          )}
        </div>
      )}
    </section>
  );
}