import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { buildSourceIndex } from "./testSources";

async function snippets(code: string, ids = ["LOGIN-001"]) {
  const dir = mkdtempSync(join(tmpdir(), "sheet-sources-"));
  try {
    writeFileSync(join(dir, "Spec.kt"), code);
    const index = await buildSourceIndex([dir], ids);
    return ids.map((id) => index.snippetsFor(id));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("filtered for loops show every multiline consumer for every data row", async () => {
  const [first, second] = await snippets(`private val ROWS = listOf(
    Row(false, "LOGIN-001"),
    Row(true, "LOGIN-002"),
)
class RotationSpec : FunSpec({
    context("before") {
        for (row in ROWS.filter { !it.reissued }) {
            test(row.id) { checkBefore(row) }
        }
    }
    context("after") {
        for (row in ROWS.filter { it.reissued }) {
            test(row.id) { checkAfter(row) }
        }
    }
})`, ["LOGIN-001", "LOGIN-002"]);
  for (const found of [first, second]) {
    expect(found).toHaveLength(3);
    expect(found[1].code).toContain("checkBefore(row)");
    expect(found[2].code).toContain("checkAfter(row)");
    expect(found[1].containers).toEqual(["before"]);
    expect(found[2].containers).toEqual(["after"]);
  }
  expect(first[0].code).toContain("LOGIN-001");
  expect(second[0].code).toContain("LOGIN-002");
});

for (const expression of ["ROWS.filter { it.enabled }.forEach { row ->", "ROWS.sortedBy { it.days }.forEach { row ->"]) {
  test(`selects the loop body after inline lambdas: ${expression}`, async () => {
    const [found] = await snippets(`val ROWS = listOf(Row("LOGIN-001"))

${expression}
    checkRow(row)
}`);
    expect(found).toHaveLength(1);
    expect(found[0].code).toContain("checkRow(row)");
    expect(found[0].truncated).toBe(false);
  });
}

test("derived data and inline-only blocks are not selected as loop bodies", async () => {
  const [found] = await snippets(`val ROWS = listOf(Row("LOGIN-001"))
val byId = ROWS.associateBy { it.id }
ROWS.filter { it.enabled }

ROWS.forEach { row ->
    checkRow(row)
}`);
  expect(found).toHaveLength(2);
  expect(found[1].code).toBe("ROWS.forEach { row ->\n    checkRow(row)\n}");
});

test("multiple references on one loop line do not duplicate the body", async () => {
  const [found] = await snippets(`val ROWS = listOf(Row("LOGIN-001"))
class Spec {
    for (row in ROWS.filter { ROWS.contains(it) }) {
        checkRow(row)
    }
}`);
  expect(found).toHaveLength(2);
  expect(found[1].code).toContain("checkRow(row)");
});

for (const call of [
  'withTests<Row>(::name, ROWS)',
  'withTests({ "${it.id}: name" }, ROWS)',
  'withTests(nameFn = { it.id }, ts = ROWS)',
  'withContexts({ "${it.id}: context" }, ROWS)',
  'withData(ROWS)',
]) {
  test(`variable data feeds the full body of ${call}`, async () => {
    const [found] = await snippets(`private val ROWS = listOf(
    Row("LOGIN-001"),
)
class Spec : FreeSpec({
    ${call} { row ->
        checkRow(row)
    }
})`);
    expect(found).toHaveLength(2);
    expect(found[0].code).toContain('Row("LOGIN-001")');
    expect(found[1].code).toContain(call);
    expect(found[1].code).toContain("checkRow(row)");
  });
}

test("dynamic contexts show their call instead of inventing a runtime name", async () => {
  const [found] = await snippets(`class Spec : FreeSpec({
    context("rotation") {
        withContexts(nameFn = { it.id }, ts = END_DATES) { row ->
            withData(ROWS) { value ->
                test("LOGIN-001: leaf") {
                    checkRow(row)
                }
            }
        }
    }
})`);
  expect(found[0].containers).toEqual([
    "rotation",
    "withContexts(nameFn = { it.id }, ts = END_DATES)",
    "withData(ROWS)",
  ]);
});
