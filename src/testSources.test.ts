import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { buildSourceIndex } from "./testSources";

async function indexed(code: string, ids: string[], name = "Spec.kt") {
  const dir = mkdtempSync(join(tmpdir(), "sheet-sources-"));
  try {
    writeFileSync(join(dir, name), code);
    const index = await buildSourceIndex([dir], ids);
    return ids.map((id) => ({ snippets: index.snippetsFor(id), mentions: index.mentionsOf(id) }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function snippets(code: string, ids = ["LOGIN-001"]) {
  return (await indexed(code, ids)).map((found) => found.snippets);
}

test("an ID in a comment is a mention, not a test, even inside or above another case's test", async () => {
  const [locked, unlock, shared, boundary] = await indexed(
    `class Spec : FunSpec({
    "LOGIN-001: a locked account cannot log in" {
        // The unlock path (LOGIN-002) is checked by hand: it needs the help desk's approval mail.
        check()
    }

    // Same rule as LOGIN-005, so this only checks the boundary.
    "LOGIN-006: the 6th failed attempt locks the account" { check() }
})`,
    ["LOGIN-001", "LOGIN-002", "LOGIN-005", "LOGIN-006"]
  );
  expect(locked.snippets).toHaveLength(1);
  expect(unlock).toEqual({ snippets: [], mentions: [{ file: "Spec.kt", path: expect.any(String), line: 3 }] });
  expect(shared.snippets).toEqual([]);
  expect(shared.mentions.map((mention) => mention.line)).toEqual([7]);
  expect(boundary.snippets.map((snippet) => snippet.title)).toEqual(["the 6th failed attempt locks the account"]);
  expect(boundary.mentions).toEqual([]);
});

test("a comment opener inside a single-quoted string does not hide the tests below it", async () => {
  const [first, second] = await indexed(
    `describe('login', () => {
  beforeEach(() => cy.intercept('/api/*'))
  it('LOGIN-001: logs in', () => { check() })
  it('opens http://host/x (LOGIN-002)', () => { check() })
})`,
    ["LOGIN-001", "LOGIN-002"],
    "login.spec.ts"
  );
  for (const found of [first, second]) {
    expect(found.snippets).toHaveLength(1);
    expect(found.mentions).toEqual([]);
  }
});

test("a block or doc comment above a test does not make it the case's test", async () => {
  const [found] = await indexed(
    `class J {
    /**
     * See LOGIN-001 for the rule.
     */
    @Test
    fun other() { check() }
    /* LOGIN-001 */ @Test fun another() { }
}`,
    ["LOGIN-001"]
  );
  expect(found.snippets).toEqual([]);
  expect(found.mentions.map((mention) => mention.line)).toEqual([3, 7]);
});

test("an ID in both a test's name and a comment is one test, and the comment is still noted", async () => {
  const [found] = await indexed(
    `class Spec : FunSpec({
    test("LOGIN-001: logs in at https://example.com//login") {
        // LOGIN-001 needs a fresh account
        check()
    }
})`,
    ["LOGIN-001"]
  );
  expect(found.snippets).toHaveLength(1);
  expect(found.snippets[0].title).toBe("logs in at https://example.com//login");
  expect(found.mentions.map((mention) => mention.line)).toEqual([3]);
});

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
    expect(found).toHaveLength(2);
    expect(found[0].code).toContain("checkBefore(row)");
    expect(found[1].code).toContain("checkAfter(row)");
    expect(found[0].containers).toEqual([{ name: "before" }]);
    expect(found[1].containers).toEqual([{ name: "after" }]);
  }
  // The row is not part of the code: it is where the viewer opens the data, one row per case
  expect(first[0].rows).toEqual([{ startLine: 2, endLine: 2 }]);
  expect(second[1].rows).toEqual([{ startLine: 3, endLine: 3 }]);
  expect(first.every((snippet) => !snippet.code.includes("LOGIN-001"))).toBe(true);
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
  expect(found).toHaveLength(1);
  expect(found[0].code).toBe("ROWS.forEach { row ->\n    checkRow(row)\n}");
  expect(found[0].rows).toEqual([{ startLine: 1, endLine: 1 }]);
});

test("multiple references on one loop line do not duplicate the body", async () => {
  const [found] = await snippets(`val ROWS = listOf(Row("LOGIN-001"))
class Spec {
    for (row in ROWS.filter { ROWS.contains(it) }) {
        checkRow(row)
    }
}`);
  expect(found).toHaveLength(1);
  expect(found[0].code).toContain("checkRow(row)");
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
    expect(found).toHaveLength(1);
    expect(found[0].code).not.toContain('Row("LOGIN-001")');
    expect(found[0].rows).toEqual([{ startLine: 2, endLine: 2 }]);
    expect(found[0].code).toContain(call);
    expect(found[0].code).toContain("checkRow(row)");
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
  // LOGIN-003 is only in a comment, so it names no test
  expect(found.map((list) => list[0]?.title)).toEqual(['can log in "fast"', "session issued", undefined, "backticked name", undefined]);
  expect(found[2]).toEqual([]);
});

test("a data row has no name of its own, so no sentence is made up for it", async () => {
  const [found] = await snippets(`withData(Row("LOGIN-001", "expired")) { checkRow(it) }`);
  expect(found.every((snippet) => snippet.title === undefined)).toBe(true);
});

async function withTree(files: Record<string, string>, run: (index: Awaited<ReturnType<typeof buildSourceIndex>>) => void) {
  const dir = mkdtempSync(join(tmpdir(), "sheet-symbols-"));
  try {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(dir, name, ".."), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    run(await buildSourceIndex([dir], ["LOGIN-001"]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SPEC = `class Spec : FunSpec({
    test("LOGIN-001: mail body") {
        val mail = fetchMail("demo")
        assertMailBody(mail, EXPECTED_BODY)
    }
})`;
const MAIL = `package support

/** Compares a mail with the body the spec expects. */
fun assertMailBody(mail: Mail, expected: String) {
    val local = mail.body
    helperOfHelper(local)
}
fun fetchMail(user: String): Mail = Mail(user)
val EXPECTED_BODY = listOf(
    "Hello",
    "World",
)
data class Mail(val body: String)
fun helperOfHelper(text: String) = Unit
`;

test("names in a test lead to the files that declare them, and on to the files those use", async () => {
  await withTree({ "Spec.kt": SPEC, "support/Mail.kt": MAIL, "Unrelated.kt": "fun neverReached() { }" }, (index) => {
    const reached = index.reachable(index.snippetsFor("LOGIN-001").map((snippet) => snippet.path));
    expect(Object.keys(reached.files).sort()).toEqual(["Spec.kt", "support/Mail.kt"]);
    expect(reached.symbols.neverReached).toBeUndefined();
    // From the doc comment to the closing brace
    expect(reached.symbols.assertMailBody).toEqual([{ path: "support/Mail.kt", start: 3, end: 7, line: 4 }]);
    expect(reached.symbols.EXPECTED_BODY).toEqual([{ path: "support/Mail.kt", start: 9, end: 12, line: 9 }]);
    expect(reached.symbols.fetchMail[0]).toMatchObject({ start: 8, end: 8 });
  });
});

test("locals, parameters and constructor properties are not names to follow", async () => {
  await withTree({ "Spec.kt": SPEC, "support/Mail.kt": MAIL }, (index) => {
    const reached = index.reachable(["Spec.kt"]);
    for (const name of ["local", "mail", "expected", "user", "body", "text"]) expect(reached.symbols[name]).toBeUndefined();
  });
});

test("a name declared in several files lists them all, the reader's own file being the client's to prefer", async () => {
  await withTree({ "Spec.kt": SPEC, "support/Mail.kt": MAIL, "support/Other.kt": "fun helperOfHelper() { println(1) }" }, (index) => {
    const reached = index.reachable(["Spec.kt"]);
    expect(reached.symbols.helperOfHelper.map((place) => place.path).sort()).toEqual(["support/Mail.kt", "support/Other.kt"]);
  });
});

test("a name declared in too many places is dropped rather than linked everywhere", async () => {
  const many = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`F${i}.kt`, "fun commonName() { }"]));
  await withTree({ "Spec.kt": `${SPEC}\nval x = commonName()`, ...many }, (index) => {
    expect(index.reachable(["Spec.kt"]).symbols.commonName).toBeUndefined();
  });
});

const DATA_SPEC = (nameFn: string, row = 'Row("LOGIN-001", "expired certificate", 30)') => `private data class Row(val id: String, val title: String, val days: Int)
private val ROWS = listOf(
    ${row},
)
class Spec : FunSpec({
    withTests<Row>(${nameFn}, ROWS) { row ->
        checkRow(row)
    }
})`;

for (const [form, nameFn, expected] of [
  ["a property reference", "Row::title", "expired certificate"],
  ["a lambda returning a property", "{ it.title }", "expired certificate"],
  ["a lambda with its own parameter", "{ row -> row.title }", "expired certificate"],
  ["a template over properties, without the ID it starts with", '{ "${it.id}: ${it.title} (${it.days} days)" }', "expired certificate (30 days)"],
  ["a function it cannot read", "::leafName", undefined],
  ["a template calling something", '{ "${describe(it)}" }', undefined],
] as const) {
  test(`a leaf test over data is named from its row: ${form}`, async () => {
    const [found] = await snippets(DATA_SPEC(nameFn));
    expect(found).toHaveLength(1);
    expect(found[0].title).toBe(expected);
  });
}

test("a name that is not a literal in the row is not made up", async () => {
  const [found] = await snippets(DATA_SPEC("Row::title", 'Row("LOGIN-001", titleFor(1), 30)'));
  expect(found[0].title).toBeUndefined();
});

test("a test that is named by the ID is its own test, not a row of data", async () => {
  const [found] = await snippets(`class Spec : FunSpec({
    test("LOGIN-001: can log in") { check() }
})`);
  expect(found).toHaveLength(1);
  expect(found[0].rows).toBeUndefined();
  expect(found[0].title).toBe("can log in");
});

test("a multi-line string name that heads several IDs is the test's name, not a row of data", async () => {
  for (const lead of ["test\n", ""]) {
    const [first, middle] = await snippets(
      `class S : FunSpec({\n    ${lead}    ("""AAA-019, AAA-065, AAA-066: shows the total\n            |on two lines""".trimMargin()) {\n        check()\n    }\n})\n`,
      ["AAA-019", "AAA-065"],
    );
    for (const found of [first[0], middle[0]]) {
      expect(found.rows).toBeUndefined();
      expect(found.title).toBe("shows the total on two lines");
      expect(found.code).toContain("check()");
    }
  }
});
