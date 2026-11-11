import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { checkCoverage, parseCoverage, type CoverageCase } from "./coverage";

let warned: string[] = [];
beforeEach(() => {
  warned = [];
  spyOn(console, "error").mockImplementation((message: string) => void warned.push(message));
});
afterEach(() => {
  (console.error as unknown as { mockRestore(): void }).mockRestore();
});

const parse = (covered_by: unknown, dropped?: unknown) => parseCoverage({ covered_by, dropped }, "LOGIN-001", "t.yaml");

test("each item names one destination and says what moved", () => {
  expect(parse([{ case: " E2E-002 ", what: "revoked at the real server" }, { test: "DeleteBasicTest.testDeleteExpired", what: "no revoke call when expired" }, { elsewhere: "download page tests", what: "days left" }])).toEqual({
    covered_by: [
      { case: "E2E-002", what: "revoked at the real server" },
      { test: "DeleteBasicTest.testDeleteExpired", what: "no revoke call when expired" },
      { elsewhere: "download page tests", what: "days left" },
    ],
    dropped: undefined,
  });
  expect(parse(undefined, [{ what: "retry interval", reason: "product behaviour" }]).dropped).toEqual([{ what: "retry interval", reason: "product behaviour" }]);
});

test("a malformed item stops the file rather than hiding a cut check", () => {
  expect(() => parse([{ case: "E2E-002" }])).toThrow(/what is required/);
  expect(() => parse([{ case: "E2E-002", test: "A.b", what: "x" }])).toThrow(/exactly one/);
  expect(() => parse([{ what: "x" }])).toThrow(/exactly one/);
  expect(() => parse([{ case: "E2E-002", step: 2, what: "x" }])).toThrow(/unknown key "step"/);
  expect(() => parse("E2E-002")).toThrow(/expected a list/);
  expect(() => parse(undefined, [{ what: "x" }])).toThrow(/reason is required/);
});

const kase = (id: string, extra: Partial<CoverageCase> = {}): CoverageCase => ({ _tcId: id, ...extra });

test("a covering case that is manual is fine; one that is gone, skipped, obsolete or itself is not", () => {
  checkCoverage(
    [
      kase("A-1", { covered_by: [{ case: "E2E-1", what: "a" }, { case: "NOPE-1", what: "b" }, { case: "SKIP-1", what: "c" }, { case: "OLD-1", what: "d" }, { case: "A-1", what: "e" }] }),
      kase("E2E-1"),
      kase("SKIP-1", { skip: { reason: "later" } }),
      kase("OLD-1", { status: "obsolete" }),
    ],
    undefined
  );
  expect(warned.join("\n")).toMatch(/no such case/);
  expect(warned.join("\n")).toMatch(/SKIP-1 is skipped/);
  expect(warned.join("\n")).toMatch(/OLD-1 is obsolete/);
  expect(warned.join("\n")).toMatch(/covered_by itself/);
  expect(warned).toHaveLength(4);
});

test("a loop is reported once", () => {
  checkCoverage([kase("A-1", { covered_by: [{ case: "B-1", what: "x" }] }), kase("B-1", { covered_by: [{ case: "A-1", what: "y" }] })], undefined);
  expect(warned).toHaveLength(1);
  expect(warned[0]).toMatch(/A-1 → B-1 → A-1|B-1 → A-1 → B-1/);
});

test("a test is checked only when test code was read", () => {
  const cases = [kase("A-1", { covered_by: [{ test: "Spec.gone", what: "x" }] })];
  checkCoverage(cases, undefined);
  expect(warned).toHaveLength(0);
  checkCoverage(cases, { hasTest: () => false });
  expect(warned).toHaveLength(1);
  checkCoverage(cases, { hasTest: () => true });
  expect(warned).toHaveLength(1);
});
