import { z } from "zod";
import rawDefaultRules from "./selection-table-rules.json";

/**
 * Selection-table rules: the machine-readable form of the team's annotation guideline.
 * The checker and the exporter (selection-table.ts) are generic interpreters of this data, so a guideline
 * change is an edit to selection-table-rules.json, not to code. The format is pure data on purpose:
 * only the rule types below exist, and a rules file can never contain executable code.
 *
 * Every object is strict, so a typo in the rules file (e.g. "allowEmtpy") is rejected on load instead of
 * being silently ignored.
 */

const severity = z.enum(["error", "warning"]);
const names = z.array(z.string().min(1));

const columnBase = {
  name: z.string().min(1),
  /** Free-form label for grouping in documentation or UI; not interpreted. */
  group: z.string().optional(),
  /** The column must exist in the header. */
  headerRequired: z.boolean(),
  /** A blank cell is acceptable (other rules, e.g. conditionalRules, may still require a value). */
  allowEmpty: z.boolean(),
  /** No two rows may share a value. */
  unique: z.boolean().optional(),
  /** Severity of this column's value problems. Defaults to `defaultSeverity`. */
  severity: severity.optional(),
  description: z.string().optional(),
  /** Value written by the exporter when it has nothing better (e.g. "Spectrogram 1", "penguin"). */
  exportDefault: z.string().optional(),
};

const columnSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...columnBase,
    type: z.literal("integer"),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  z.strictObject({
    ...columnBase,
    type: z.literal("number"),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  z.strictObject({
    ...columnBase,
    type: z.literal("text"),
    /** Regular expression the whole value must match. */
    pattern: z.string().optional(),
    /** Shown after the column name when the pattern does not match. */
    message: z.string().optional(),
  }),
  z.strictObject({
    ...columnBase,
    type: z.literal("enum"),
    values: z.array(z.string().min(1)).min(1),
  }),
  z.strictObject({
    ...columnBase,
    type: z.literal("enumList"),
    values: z.array(z.string().min(1)).min(1),
    /** Joins several values in one cell, e.g. "+" in other_species+wind. */
    separator: z.string().min(1),
    allowDuplicates: z.boolean(),
  }),
]);

const comparisonSchema = z.strictObject({
  id: z.string().min(1),
  column: z.string().min(1),
  operator: z.enum([">", ">=", "<", "<="]),
  otherColumn: z.string().min(1),
  severity: severity.optional(),
  /** Shown after the column name; a default is generated when omitted. */
  message: z.string().optional(),
});

const conditionalRuleSchema = z
  .strictObject({
    id: z.string().min(1),
    /** The rule applies to rows where `column`'s value is in `in` (or, with `notIn`, not in it). */
    when: z
      .strictObject({
        column: z.string().min(1),
        in: names.optional(),
        notIn: names.optional(),
      })
      .refine((w) => (w.in != null) !== (w.notIn != null), { message: 'use exactly one of "in" or "notIn"' }),
    /** Columns that must have a value on matching rows. */
    require: names.optional(),
    /** Columns that must be blank on matching rows. */
    mustBeEmpty: names.optional(),
    /** Shown after the column name; a default is generated when omitted. */
    message: z.string().optional(),
    severity: severity.optional(),
  })
  .refine((r) => (r.require?.length ?? 0) + (r.mustBeEmpty?.length ?? 0) > 0, {
    message: 'needs "require" and/or "mustBeEmpty"',
  });

export const rulesSchema = z.strictObject({
  /** Version of this rules-file format (not of the guideline). */
  schemaVersion: z.literal(1),
  guideline: z.strictObject({
    name: z.string().min(1),
    version: z.string().min(1),
    lastUpdated: z.string().optional(),
  }),
  file: z.strictObject({
    delimiter: z.enum(["\t", ",", ";"]),
    /** Expected file extension, checked when the file name is known. */
    extension: z.string().regex(/^\./, 'must start with "."').optional(),
    /** Whether column names and enum values are matched case-sensitively. */
    caseSensitive: z.boolean(),
    /** What to do with header columns that the rules do not describe. */
    extraColumns: z.enum(["allow", "warn", "error"]),
  }),
  defaultSeverity: severity,
  columns: z.array(columnSchema).min(1),
  comparisons: z.array(comparisonSchema).default([]),
  conditionalRules: z.array(conditionalRuleSchema).default([]),
});

export type Rules = z.output<typeof rulesSchema>;
export type ColumnRule = Rules["columns"][number];
export type Severity = z.infer<typeof severity>;

/** Problems that the schema cannot express: duplicate names, dangling column references, bad regexes. */
function semanticProblems(rules: Rules): string[] {
  const problems: string[] = [];
  const names = new Set<string>();
  for (const c of rules.columns) {
    if (names.has(c.name)) problems.push(`columns: duplicate column "${c.name}"`);
    names.add(c.name);
    if (c.type === "text" && c.pattern) {
      try {
        new RegExp(c.pattern);
      } catch {
        problems.push(`columns.${c.name}.pattern: not a valid regular expression`);
      }
    }
    if ((c.type === "integer" || c.type === "number") && c.min != null && c.max != null && c.min > c.max) {
      problems.push(`columns.${c.name}: min is greater than max`);
    }
    if (c.type === "enum" || c.type === "enumList") {
      if (new Set(c.values).size !== c.values.length) problems.push(`columns.${c.name}.values: contains duplicates`);
      if (c.type === "enumList" && c.values.some((v) => v.includes(c.separator))) {
        problems.push(`columns.${c.name}.values: a value contains the separator "${c.separator}"`);
      }
    }
  }
  const ref = (where: string, col: string) => {
    if (!names.has(col)) problems.push(`${where}: unknown column "${col}"`);
  };
  rules.comparisons.forEach((c) => {
    ref(`comparisons.${c.id}.column`, c.column);
    ref(`comparisons.${c.id}.otherColumn`, c.otherColumn);
  });
  rules.conditionalRules.forEach((r) => {
    ref(`conditionalRules.${r.id}.when.column`, r.when.column);
    r.require?.forEach((c) => ref(`conditionalRules.${r.id}.require`, c));
    r.mustBeEmpty?.forEach((c) => ref(`conditionalRules.${r.id}.mustBeEmpty`, c));
  });
  return problems;
}

/** Validates an untrusted rules object. Throws an Error listing every problem found. */
export function parseRules(raw: unknown): Rules {
  const res = rulesSchema.safeParse(raw);
  if (!res.success) {
    throw new Error(res.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("\n"));
  }
  const problems = semanticProblems(res.data);
  if (problems.length > 0) throw new Error(problems.join("\n"));
  return res.data;
}

/**
 * The guideline bundled with the app. Parsed at import time, so a broken rules file fails the build and the
 * tests instead of surfacing at runtime.
 */
export const DEFAULT_RULES: Rules = parseRules(rawDefaultRules);

/** Columns that every table must contain, in header order (also the exporter's columns). */
export const requiredColumns = (rules: Rules): ColumnRule[] => rules.columns.filter((c) => c.headerRequired);