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
    expect(found[1].containers).toEqual([{ name: "before" }]);
    expect(found[2].containers).toEqual([{ name: "after" }]);
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
    { name: "rotation" },
    { call: "withContexts(nameFn = { it.id }, ts = END_DATES)", each: "END_DATES" },
    { call: "withData(ROWS)", each: "ROWS" },
  ]);
});

test("hasTest finds a test by method, by class and method, or by a Kotest name", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sheet-sources-"));
  try {
    writeFileSync(join(dir, "DeleteBasicTest.kt"), `class DeleteBasicTest : FunSpec({\n    test("expired certificates are revoked") { }\n})\nfun testDeleteExpired() {}\n`);
    const index = await buildSourceIndex([dir], []);
    expect(index.hasTest("testDeleteExpired")).toBe(true);
    expect(index.hasTest("DeleteBasicTest.testDeleteExpired")).toBe(true);
    expect(index.hasTest("DeleteBasicTest#testDeleteExpired")).toBe(true);
    expect(index.hasTest("OtherTest.testDeleteExpired")).toBe(false);
    expect(index.hasTest("DeleteBasicTest.testDeleteExp")).toBe(false);
    expect(index.hasTest("expired certificates are revoked")).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const PLANS_SPEC = `private data class Plan(val name: String, val seats: Int)
private val PLANS = listOf(
    Plan("無料プラン", 1),
    Plan(name = "有料プラン", seats = 10),
)
private val ROWS = listOf(
    Row("LOGIN-001"),
)
class ContractSpec : FunSpec({
    "契約がある" - {
        withContexts<Plan>(Plan::name, PLANS) { plan ->
            withTests<Row>(::leafName, ROWS) { row ->
                checkRow(plan, row)
            }
        }
    }
})`;

test("a data-driven container says what it goes over, how it is named and what the names are", async () => {
  const [all] = await snippets(PLANS_SPEC);
  // The row and the loop that consumes it are separate snippets here; the container belongs to the loop
  const found = all.filter((snippet) => snippet.containers?.length);
  expect(found).toHaveLength(1);
  expect(found[0].containers).toEqual([
    { name: "契約がある" },
    { call: "withContexts<Plan>(Plan::name, PLANS)", each: "PLANS", by: "Plan::name", names: ["無料プラン", "有料プラン"] },
  ]);
});

test("a call spread over lines is read the same, and unreadable names are left out as a whole", async () => {
  const [found] = await snippets(`private data class Plan(val name: String)
private val PLANS = listOf(Plan("無料プラン"), Plan(planName()))
class ContractSpec : FunSpec({
    withContexts<Plan>(
        Plan::name,
        PLANS,
    ) { plan ->
        test("LOGIN-001") { check(plan) }
    }
})`);
  expect(found[0].containers).toEqual([{ call: "withContexts<Plan>(Plan::name, PLANS)", each: "PLANS", by: "Plan::name" }]);
});

test("a test's own name becomes the sentence for what it checks, without the case ID it starts with", async () => {
  const ids = ["LOGIN-001", "LOGIN-002", "LOGIN-003", "LOGIN-004", "LOGIN-005"];
  const found = await snippets(
    `class Spec : FunSpec({
    test("LOGIN-001: can log in \\"fast\\"") { check() }
    "LOGIN-002 session issued" { check() }
})
class J {
    @Test
    @DisplayName("a session is issued after login")
    fun sessionIsIssued() { } // LOGIN-003
    @Test
    fun \`LOGIN-004: backticked name\`() { }
    @CsvSource("LOGIN-005, expired")
    fun rows() { }
}`,
    ids
  );
  expect(found.map((list) => list[0]?.title)).toEqual(['can log in "fast"', "session issued", "a session is issued after login", "backticked name", undefined]);
});

test("a data row has no name of its own, so no sentence is made up for it", async () => {
  const [found] = await snippets(`withData(Row("LOGIN-001", "expired")) { checkRow(it) }`);
  expect(found.every((snippet) => snippet.title === undefined)).toBe(true);
});
