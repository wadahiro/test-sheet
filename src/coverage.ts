// A case that lost checks in a refactor says where they went (`covered_by`) or why they were let go
// (`dropped`), so a reader can tell a deliberate cut from a gap. Where they went is a claim, so the
// pieces that can be checked are: the case exists and still runs, the test is in the code that was read.

import { warn } from "./warnings";

export type CoveredBy = { case: string; what: string } | { test: string; what: string } | { elsewhere: string; what: string };

export interface Dropped {
  what: string;
  reason: string;
}

export const COVERED_BY_KINDS = ["case", "test", "elsewhere"] as const;
export type CoveredByKind = (typeof COVERED_BY_KINDS)[number];

export const coveredByKind = (item: CoveredBy): CoveredByKind => COVERED_BY_KINDS.find((kind) => kind in item)!;
export const coveredByTarget = (item: CoveredBy): string => (item as Record<string, string>)[coveredByKind(item)];

const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

// `step` is refused rather than ignored: a number into another case's steps goes stale silently when
// steps are added, so a reader who wrote one should say it in `what` instead
function checkKeys(item: Record<string, unknown>, allowed: readonly string[], where: string): void {
  const stray = Object.keys(item).filter((key) => !allowed.includes(key));
  if (stray.length > 0) throw new Error(`${where}: unknown ${stray.length === 1 ? "key" : "keys"} ${stray.map((key) => `"${key}"`).join(", ")}; use ${allowed.join(", ")}.`);
}

/** Checks the shape of `covered_by` and `dropped` as written. A wrong one stops the file: silently dropping it would hide a cut check. */
export function parseCoverage(tc: { covered_by?: unknown; dropped?: unknown }, label: string, sourceFile: string): { covered_by?: CoveredBy[]; dropped?: Dropped[] } {
  const out: { covered_by?: CoveredBy[]; dropped?: Dropped[] } = {};

  if (tc.covered_by !== undefined && tc.covered_by !== null) {
    if (!Array.isArray(tc.covered_by)) throw new Error(`Invalid covered_by on test case "${label}" in ${sourceFile}: expected a list.`);
    out.covered_by = tc.covered_by.map((raw: unknown, i) => {
      const where = `Invalid covered_by[${i}] on test case "${label}" in ${sourceFile}`;
      if (!isRecord(raw)) throw new Error(`${where}: expected a mapping with one of ${COVERED_BY_KINDS.join(", ")} and what.`);
      checkKeys(raw, [...COVERED_BY_KINDS, "what"], where);
      const kinds = COVERED_BY_KINDS.filter((kind) => kind in raw);
      if (kinds.length !== 1) throw new Error(`${where}: name exactly one of ${COVERED_BY_KINDS.join(", ")}.`);
      const target = raw[kinds[0]];
      if (!isText(target)) throw new Error(`${where}: ${kinds[0]} must be non-empty text.`);
      if (!isText(raw.what)) throw new Error(`${where}: what is required: say which check moved.`);
      return { [kinds[0]]: target.trim(), what: raw.what.trim() } as CoveredBy;
    });
  }

  if (tc.dropped !== undefined && tc.dropped !== null) {
    if (!Array.isArray(tc.dropped)) throw new Error(`Invalid dropped on test case "${label}" in ${sourceFile}: expected a list.`);
    out.dropped = tc.dropped.map((raw: unknown, i) => {
      const where = `Invalid dropped[${i}] on test case "${label}" in ${sourceFile}`;
      if (!isRecord(raw)) throw new Error(`${where}: expected a mapping with what and reason.`);
      checkKeys(raw, ["what", "reason"], where);
      if (!isText(raw.what)) throw new Error(`${where}: what is required: say which check was let go.`);
      if (!isText(raw.reason)) throw new Error(`${where}: reason is required: say why it is not checked anywhere.`);
      return { what: raw.what.trim(), reason: raw.reason.trim() };
    });
  }
  return out;
}

export interface CoverageCase {
  _tcId?: string;
  status?: "active" | "obsolete" | "superseded";
  skip?: unknown;
  covered_by?: CoveredBy[];
}

/** Whether the test code that was read holds a test of this name; absent when no code was searched */
export interface TestFinder {
  hasTest(name: string): boolean;
}

/**
 * Cross-checks every `covered_by` against the sheet. A target that is `manual` is not a problem: a real
 * external environment is run on purpose and not every time. A target that is gone, skipped or obsolete
 * is, since the check then happens nowhere. `test` is checked only when test code was read.
 */
export function checkCoverage(cases: CoverageCase[], tests: TestFinder | undefined): void {
  const byId = new Map(cases.flatMap((tc) => (tc._tcId ? [[tc._tcId, tc] as const] : [])));

  for (const tc of cases) {
    for (const item of tc.covered_by ?? []) {
      if ("test" in item) {
        if (tests && !tests.hasTest(item.test)) warn(`${tc._tcId} says ${item.test} covers "${item.what}", but no such test was found in the test code`);
        continue;
      }
      if (!("case" in item)) continue;
      if (item.case === tc._tcId) {
        warn(`${tc._tcId} is covered_by itself`);
        continue;
      }
      const target = byId.get(item.case);
      if (!target) warn(`${tc._tcId} says ${item.case} covers "${item.what}", but there is no such case`);
      else if (target.status === "obsolete" || target.status === "superseded" || target.skip != null) {
        warn(`${tc._tcId} says ${item.case} covers "${item.what}", but ${item.case} is ${target.skip != null ? "skipped" : target.status}, so the check happens nowhere`);
      }
    }
  }

  const reported = new Set<string>();
  const targetsOf = (id: string): string[] => (byId.get(id)?.covered_by ?? []).flatMap((item) => ("case" in item && item.case !== id && byId.has(item.case) ? [item.case] : []));
  for (const start of byId.keys()) {
    const walk = (id: string, path: string[]): void => {
      for (const next of targetsOf(id)) {
        if (next === start) {
          const key = [...path].sort().join("\u0000");
          if (reported.has(key)) continue;
          reported.add(key);
          warn(`covered_by loops back: ${[...path, start].join(" → ")}; each only points at the next, so the check is not done anywhere`);
        } else if (!path.includes(next)) walk(next, [...path, next]);
      }
    };
    walk(start, [start]);
  }
}
