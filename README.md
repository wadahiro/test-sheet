# test-sheet

A local tool for managing test cases as `testcases.yaml` files and browsing them in a single page. Built with Bun + Preact.

## Features

- Manage test cases as YAML — no hand-written Markdown
- Navigate a domain → feature → test suite → section → test case hierarchy
- Click a domain, feature or test suite to see a table of every case under it; a suite also lists its cases in full below the table
- Full-text search in a command palette (Cmd+K / Ctrl+K), and a filter on every table that each page remembers for the tab, so going to a case and back finds the list as it was (a link can still carry one, as `#/overview?q=smoke`)
- A suite's guide opens beside its cases from the header's guide button or the `g` key, and stays open from page to page (saying so on a page with no guide)
- Resizable, collapsible side nav; a docked guide panel to read beside the cases
- A Record button in the header turns recording on by choosing a run: its menu lists the saved runs (several can run side by side, say one per theme being tested) to resume, create, rename or delete, plus a "Not recording" entry to go back to just reading. While recording the button shows the run's name and every step gets Pass / Fail buttons: the first unmarked step is highlighted, a failed step takes a note with line breaks and pasted (or dropped, or attached) screenshots, each case gets a PASS / FAIL chip, and copying a case as Markdown includes the results. Each table row gets a Result column and the filter bar shows how many listed cases are done (and failed). Each case opens below its row (click its ID or name; *Expand all* opens every listed case) and is recorded there, on every page; its header has previous / next buttons, and nothing moves on by itself, since cases have no required order. The one-page read (`#/all`) is read-only. Markdown cannot carry an image that issue trackers will show (they drop embedded `data:` images, including from a rich-text paste), so the copy marks where each screenshot goes, and each screenshot has Copy image and Download buttons: copy it and paste it at the mark, and the tracker uploads it. The run in use is shared by every tab, and results stay in this browser only; they are a working record, not a test report
- Plan which cases a run covers: pick a range of tags or parts of the hierarchy, mark cases Run or Exclude with a reason, and copy the whole selection as a Markdown review sheet (see [Planning a run](#planning-a-run))
- Each case shows its preconditions, test data (every value has a copy button, for a login ID or a token), steps and note; obsolete, superseded and skipped cases stay in the tables, marked with their reason
- The interface is in English or Japanese, chosen from the browser's language on the first visit and switchable from the globe icon in the header; more languages can be added with a JSON file (see [Languages](#languages)). Markdown copied from the page follows the language chosen
- Ticket numbers written as plain text become links to your issue tracker from one setting (see [Linking ticket numbers](#linking-ticket-numbers-autolinks))
- Copy any section or test suite as Markdown (for pasting into a PR or issue comment)
- Auto-reloads the browser whenever a `testcases.yaml` is saved
- Can also render to a single self-contained HTML file (for CI artifacts or static distribution)

## Setup

```bash
bun install
```

## Usage

### Run as a local server

```bash
bun run serve [root directory] [--port <port>]
```

If the root directory is omitted, the current directory is scanned recursively. Saving a `testcases.yaml` auto-reloads any open browser tab.

### Generate a single HTML file

```bash
bun run src/cli.ts [root directory] --out <file>
```

### Excluding paths

Use `--exclude` (`-e`) to skip `testcases.yaml` files whose path matches a glob — useful for
template scaffolding that would otherwise show up as a test suite full of placeholders. The
pattern is matched against the path relative to the root directory, and the option may be
repeated.

```bash
bun run src/cli.ts ./tests --exclude "**/_template/**"
bun run src/cli.ts ./tests -e "**/_template/**" -e "**/drafts/**"
```

### Languages

English and Japanese are built in. The page opens in the first language in the browser's preference
list that it has (`ja-JP` matches `ja`, and anything else falls back to English); the globe icon in the
header switches it, and the choice is remembered in the browser. What you write in `testcases.yaml`
is shown as written — only the interface is translated.

To add a language, or to change some wording of a built-in one, pass a JSON file with `--locale`
(repeatable). Start from the full list of strings:

```bash
bun run src/cli.ts --print-locale fr > fr.json   # every key, in English
# edit fr.json: set "code", "label" (shown in the menu) and translate the values
bun run src/cli.ts ./tests --out test-cases.html --locale fr.json
```

```json
{ "code": "fr", "label": "Français", "messages": { "header.search": "Rechercher" } }
```

A key you leave out is shown in English. A file whose `code` is a built-in one (`ja`, say) overrides
just the keys it lists. `{name}` marks a value filled in at run time and must be kept; a count that
changes the wording has `.one` and `.other` variants. A file is read when the command starts, so
restart `bun run serve` after editing one.

## `testcases.yaml` structure

```yaml
metadata:
  type_name: Login
  id_prefix: LOGIN
test_cases:
  - name: Can log in with a valid ID and password
    category: Basic flow
    preconditions:
      - A valid user account exists
    steps:
      - action: Enter ID/password on the login screen
        expected: Redirected to the dashboard
```

See `examples/` for complete samples.

### Markdown in steps and notes

`action`, `expected` and `notes` are rendered as Markdown (lists, nested lists, `**bold**`,
`~~strikethrough~~`, `` `code` ``, links).

- In `action` and `expected`, a newline starts a new line. In `notes`, a single newline is just
  a soft wrap and a blank line starts a paragraph, so hard-wrapped text reflows.
- Raw HTML is shown as text, so `<tenantId>` appears as written. HTML tags such as `<br>` are not
  interpreted; use Markdown instead.
- `**bold**` also works right next to Japanese text, where CommonMark would leave the asterisks.
  Single-asterisk emphasis still follows CommonMark, so footnote-style marks such as `条件*1と条件*2`
  turn into italics; write `\*` for a literal asterisk.
- A line holding only `-` ("nothing to check") is kept as a literal dash instead of becoming an empty
  bullet. Write `- item` or `1. item` for real lists.
- `~x~` is not strikethrough (only `~~x~~` is), so ranges like `1~3` stay intact, and email
  addresses are not turned into links.

### Tags

```yaml
test_cases:
  - name: Can log in with a valid ID and password
    tags: [smoke, db_upgrade]
```

`tags` is a list of non-empty strings (quote values such as `"2024"` that YAML would read as
numbers). Tags are shown under the test case title, included in search and in the Markdown copy,
and shown in the Overview, where clicking one filters the list. The filter is a plain text match,
so a short tag also matches names that contain it.

To tag every case in a suite, put `tags` under `metadata`; each case gets those tags in addition
to its own. In `parameterized_tests`, the entry's own `tags` (next to `category` and `id_prefix`), the template's
`tags` and a pattern's `tags` are all added to each case the pattern expands to, so patterns can differ in tags while sharing one template.

```yaml
metadata:
  type_name: Login
  id_prefix: LOGIN
  tags: [login]
parameterized_tests:
  - id_prefix: LOGIN-ROLE-
    tags: [certification]
    patterns:
      - { id: "01", role: admin, tags: [admin_only] }
      - { id: "02", role: user }
    template:
      name: "Login as {{role}}"
      tags: [per_role]
      steps: []
```

### Test case IDs

Each test case gets an ID (`LOGIN-001`, `LOGIN-002`, ...) built from `metadata.id_prefix` and
its position in the file. Adding, removing, or reordering cases shifts every ID after the
change, which breaks references from outside the file (automated test mappings, per-release
run records, issue links).

To pin a stable ID that survives reordering, set `id` on the test case:

```yaml
test_cases:
  - name: Can log in with a valid ID and password
    id: LOGIN-VALID-01
    category: Basic flow
    steps:
      - action: Enter ID/password on the login screen
        expected: Redirected to the dashboard
```

`id` is used verbatim and takes precedence over the sequential fallback. Cases without `id`
keep counting sequentially, so existing files with no `id` fields behave exactly as before.
IDs must be unique within the file (checked after sequential IDs are assigned, so an explicit
ID can still collide with an auto-numbered one) and may only contain letters, digits, `-`, and
`_` — an ID becomes a DOM element id and a `#/` hash-route fragment, so other characters are
rejected at load time.

An explicit `id` must start with `<metadata.id_prefix>-`, and IDs must be unique across every
`testcases.yaml` under the scan root — a suite whose IDs collide with an earlier one fails to load.

### Automated tests (`automation`, `--tests`)

`automation` says how a case is run: `manual` (the default), `automated`, or `semi`, where an
automated test checks part of the case and a person checks the rest. For a `semi` case,
`automation_note` says what that rest is. It is shown above the case's steps, as a tooltip on its
Method cell, and in Markdown copied from the page. A `semi` case without it, or a note on a case
that is not `semi`, is warned about when the sheet is generated. Any other `automation` value
stops the file from loading.

```yaml
test_cases:
  - name: Can log in with a valid ID and password
    id: LOGIN-001
    automation: semi
    automation_note: "How the dashboard looks after login, and the wording of the notification email"
```

In `parameterized_tests`, `automation` and `automation_note` can be set on the entry, its
`template` or a pattern. Unlike `tags`, which add up, the most specific level that sets one wins
(pattern, then template, then entry). `{{key}}` placeholders work in `automation_note` too.

`--tests <dir|glob>` (repeatable, relative to the working directory) searches test code for each
case's ID. An `automated` or `semi` case shows the test around the ID, headed by its path below
the directory `--tests` names; hovering it shows the path as `--tests` wrote it (`../app/src/test/…`).
No absolute path goes into the page, so the generated file is the same wherever it is built and
does not show your home directory. The ID can be in:

- the test's name or an annotation (`"LOGIN-001: …" { }`, `@DisplayName("LOGIN-001 …")`): that
  test is shown
- data passed straight to a test (`withData(Case("LOGIN-001", …)) { }`, `@CsvSource({"LOGIN-001, …"})`,
  `@ValueSource(strings = ["LOGIN-001"])`): the test it feeds, with the row kept apart (see below)
- data in a variable that a loop in the same file goes over (`val cases = listOf(Case("LOGIN-001", …))`
  and later `cases.forEach { … }`, `withTests(cases) { … }`, `withContexts(cases) { … }` or
  `withData(cases) { … }`): every matching loop, each with the row holding the ID kept apart. Inline
  blocks in expressions such as `ROWS.filter { … }.forEach {` are skipped when locating the
  multiline loop body. When several loops consume the same variable, all are shown for every ID
  because their predicates cannot be evaluated statically. Kotest calls with name functions such as
  `withTests<Row>(::name, ROWS)`, `withTests({ "${it.id}: …" }, ROWS)` and
  `withTests(nameFn = { it.id }, ts = ROWS)` are also supported when the body opens on that line
  and continues on subsequent lines

Anything else, such as data in a different file from its loop, a language without braces, or an
ID built at run time (`"LOGIN-00$n"`), shows the lines around the ID, or nothing when the ID never
appears as written. A case marked `automated` or `semi` that no test code mentions is warned
about, and so is a `manual` case that some test code does mention.

Each snippet starts with what the test checks, as a sentence: the test's `@DisplayName`, or the name it
is declared with (a Kotest string such as `test("LOGIN-001: …")`, a backticked Kotlin function), without
the case ID it starts with.

A test that runs over data shows only the test. The row of data the case is made from is not part of
the code: **View data row** opens the file with the row marked, and **View whole file** opens it on the test
with the row marked as well. Such a test is named from its row where that can be read without running it:
a property (`withTests(Row::title, ROWS)`, `{ it.title }`, `{ row -> row.title }`) or a string template over
properties (`{ "${it.id}: ${it.title} (${it.days} days)" }`) whose values are written in the row as string or
number literals, with the case ID it starts with dropped. Anything else, such as a function (`::leafName`) or a
value that is not a literal, has no name that can be read, so no sentence is made up for it. The Markdown copy of
a case carries the sentence and the code, and nothing else of the snippet.

Finding the code behind a case is matching, so it can miss a helper or what a test calls. Each
snippet has **View whole file**, which opens the file
in full over the page, with the lines the case showed marked and the view opened on them. A menu
in its header jumps to the other cases the file mentions, and Esc closes it.

Names in the code are links to where they are declared: functions, types, and values declared at the
top level or in a class (not locals or parameters, so a name used all over a test is not a link
everywhere). Clicking one opens the declaration, with its comment and body marked, in the same viewer,
and the names in it can be followed in turn; ← goes back. A name is looked for by matching, not by
the compiler's name resolution: the declaration in the same file wins, and when the name is declared
in more than one file the others are offered in a menu in the header. A name declared in more than six
places is not linked, since it would lead nowhere in particular.

The page embeds the files a case shows and every file that declares a name those files use, and so on,
each once, gzipped and base64-encoded and unpacked when opened. Files nothing links to are left out, so
the page grows with what can be reached rather than with the whole test tree. Only files `--tests`
read can be opened; code elsewhere (another module, a page object) is not in the page.

For CI, `--strict` with `--out` writes the file and then exits with status 1 if anything was
warned about, for example a suite that failed to load, a mismatch between `automation` and the
test code, a `semi` case without `automation_note`, a missing guide file or a bad autolink rule.

```bash
bun run src/cli.ts ./tests --tests ../app/src/test --out test-cases.html --strict
```

### Checks a case no longer makes (`covered_by`, `dropped`)

When a case is cut down in a refactor, say where each check you removed is made now, or why it is
not, so a reader can tell a deliberate cut from a gap:

```yaml
- id: LOGIN-003
  name: Logout ends the session
  covered_by:
    - case: E2E-002
      what: The session is revoked at the real server
    - test: DeleteBasicTest.testDeleteExpired
      what: An expired certificate does not call the revoke API
    - elsewhere: Download page tests (another repository)
      what: Days left are shown
  dropped:
    - what: Cookie lifetime in the browser
      reason: Browser behaviour, not something this product decides
```

Each `covered_by` item names exactly one of `case` (an ID in the sheet), `test` (`method`,
`Class.method` or a Kotest name as written) or `elsewhere` (free text), and `what` is required. Each
`dropped` item needs `what` and `reason`. Anything else, such as a `step` number, stops the file from
loading: a number into another case's steps goes stale silently, so name the step in `what` instead.
`{{key}}` placeholders work, and in `parameterized_tests` the most specific level that sets either
wins, as with `automation_note`.

Both appear above the steps as one block, and the case that takes a check over lists what it carries
("Also covers checks cut from other cases"), so changing it shows what rides on it. Warned about when
the sheet is generated:

- a `case` that does not exist, is skipped or obsolete, or is the case itself; a loop between cases
- a `test` that is not in the code `--tests` read (name matching, not compiler resolution; skipped when
  `--tests` is not given)

A `case` that is `manual` is not warned about: a real external environment is run on purpose, not every
time. Instead the plan page and the copied review list the checks that a plan leaves out: cases decided
Run whose `case` target is not in the run. A `test` or `elsewhere` does not depend on the plan.

### Linking ticket numbers (`autolinks`)

Write a ticket number as plain text and let the configuration say where it leads, as GitHub and GitLab
do with autolink references. When the tracker moves, one setting changes instead of every case.

```yaml
metadata:
  autolinks:
    - pattern: "PROJ-\\d+"                       # a regular expression
      url: "https://tracker.example.com/browse/{0}"  # {0} is the match, {1}… its capture groups
    - pattern: "BUG#(\\d+)"
      url: "https://bugs.example.com/show?id={1}"
```

To share rules across many `testcases.yaml` files, give them on the command line instead (repeatable;
a suite's own rules are tried first):

```bash
bun run src/cli.ts ./tests --autolink 'PROJ-\d+' 'https://tracker.example.com/browse/{0}'
```

- Applies to the steps (action and expected), notes, test data and guides, in the page and in `--out` files.
- Left alone inside code spans and code blocks, inside the text or target of a Markdown link, and inside
  a URL. A match must stand alone: `XPROJ-1` and `PROJ-1abc` are not links.
- Preconditions, names and the copied Markdown stay plain text; a tracker autolinks the numbers itself
  when you paste.
- A rule that cannot work (invalid regular expression, a URL that is not `http(s)://`, a `{n}` the pattern
  has no group for) is reported when the file is loaded and left out; the rest still apply.

### Referring to other cases

Write another case's ID as plain text (`see LOGIN-002`) and it becomes a link to that case, in the steps,
notes, test data and guides. Only IDs that exist in the loaded files are linked, from any suite, and an
ID that is part of a longer word (`XLOGIN-002`, `LOGIN-0021`) is left alone, as are code spans and
existing Markdown links. The copied Markdown keeps the plain ID, so it does not carry a link that would
break when pasted into an issue. Where a configured autolink also matches, the case link wins.

### Planning a run

Not every release needs every case. Creating a run (header Record button) takes you straight to its plan; you
can come back any time with the header's **Edit plan** button (or `#/plan`), and leave run mode with the ✕ beside it,
which shows every case again:

1. Add tags, domains, features or suites under **Range**: the cases carrying any of those tags or sitting
   under any of those domains, features or suites are what is being reviewed (nothing chosen means the
   whole sheet). The filter box narrows the list further.
2. Mark each case **Run** or **Exclude** and, if you like, write a reason beside it. To do several at once,
   tick them (the checkbox on a row, on a section heading, or in the table head for everything listed;
   Shift-click ticks a stretch) and use the bar that appears: **Run**, **Exclude**, **Clear decision**, or
   **Reason only**, with one reason for all of them (reasons already used are offered). A reason fills only
   cases that have none, unless *Overwrite reasons* is ticked, and **Undo** takes the last bulk change
   back. The filter box and the decision filter next to it decide what is listed. Obsolete, superseded and
   skipped cases already carry a reason in the YAML and are not asked about.
3. While the run is in use, every page lists only the cases marked Run (within the range, active). A note says
   how many were left out and why (outside the range, excluded, not decided, inactive), with a link back to the
   plan, and the run's progress counts against the listed cases. Starting from a plan where nothing is marked
   Run marks the range's undecided cases Run first ("Start testing with all 29 cases"), so a run never starts with
   nothing to run. Why a case was excluded is for the review sheet below, not for testers.
4. *Copy* on the plan page copies a review sheet in Markdown for someone to check the selection: the range,
   every case in it with its decision and reason, then what needs attention (undecided cases, exclusions with no
   reason), decisions outside the current range, and decisions for cases no longer in the sheet.

While planning, the side nav chooses which part of the sheet is listed (its numbers read in-range/total once a
range is set), a case's ID opens its steps in place, and section headings scroll within the page, so
nothing leaves the plan until **Start testing** in the header (which goes to the cases that run covers) or **Cancel**
(which leaves without keeping what you changed, after asking if you changed anything; a run made just for this
plan is dropped).

A plan belongs to its run and is kept in this browser with it. A case added to the sheet later is undecided.

### Directory hierarchy, domain, and feature

The first two path segments relative to the root directory are treated as "domain" and "feature", respectively.

```
examples/
└── web/            # domain
    └── login/       # feature
        └── testcases.yaml
```

If a directory has a `README.md`, its first `# Heading` is used as the display name in navigation (otherwise the directory name is used as-is).

A feature holding a single `testcases.yaml` is shown as one node, `domain › name`, rather than repeating itself as
`domain › feature › suite`. The name is the feature's README heading, or the suite's `type_name` when there is no
README. The feature's URL (`#/f/<domain>/<feature>`) keeps working, so links survive a second suite being added.

### Embedding a guide (prerequisite knowledge)

```yaml
metadata:
  type_name: Login
  id_prefix: LOGIN
  guides:
    - ../common/test-prerequisites.md
```

Markdown files listed in `guides` are embedded at the top of the test suite, collapsed by
default. A leading `# Title` line is not shown, since the page already labels the guide. Their H2 headings are searchable from the command palette along with the prose under
each one.

### Ordering sections (`category_order`)

Sections are ordered by first appearance unless `category_order` lists them explicitly. Any
category not listed sorts after the listed ones.

```yaml
metadata:
  type_name: Login
  id_prefix: LOGIN
  category_order:
    - Basic flow
    - Error handling
```

### Parameterized tests (`parameterized_tests`)

When you need the same steps with only the input varying, `parameterized_tests` lets you expand a template across a set of patterns.

```yaml
parameterized_tests:
  - category: Error handling
    id_prefix: LOGIN-INVALID-
    patterns:
      - id: "01"
        input: "empty string"
      - id: "02"
        input: "invalid characters"
    template:
      name: "Login fails with password input: {{input}}"
      steps:
        - action: "Enter {{input}} into the password field"
          expected: "An error message is displayed"
```

Each pattern's `id` is appended to `id_prefix` to form the test case's explicit stable ID
(`LOGIN-INVALID-01`) — reordering patterns does not change it. Any other key on a pattern is
substituted wherever `{{key}}` appears in the template.

This `id_prefix` is independent of `metadata.id_prefix`: it is used as written, with nothing
prepended. It must still begin with `<metadata.id_prefix>-` (here `LOGIN-`); a prefix that does
not, such as `""`, is rejected when the file is loaded.

In the template, `{{id}}` is the pattern's own `id` as written (`01`), while `{{tc_id}}` is the
full test case ID (`LOGIN-INVALID-01`). `when` conditions see the same two keys.

Steps and postconditions can be made conditional with `when`, which supports `key == 'value'`
combined with `&&` and `||`. A `postconditions` entry is appended to the last step's expected
result:

```yaml
    template:
      name: "Login as {{role}}"
      steps:
        - action: "Log in"
          expected: "The dashboard is shown"
        - action: "Open the admin menu"
          expected: "Admin settings are listed"
          when: "role == 'admin'"
      postconditions:
        - text: "An audit log entry is recorded"
          when: "role == 'admin' || role == 'auditor'"
```

When a placeholder value is an object, `format` controls how it renders:

```yaml
    format:
      key_labels: { email: "Email address" }
      value_labels: { "true": "Enabled" }
```

## License

MIT

### Test layers and shared preconditions

A case can have one `layer`. Declare the allowed layers per suite:

```yaml
shared_preconditions:
  logged_in: &logged_in Logged in
metadata:
  type_name: Login
  id_prefix: LOGIN
  layers:
    config: { automation: expected }
    connector: {}
    e2e: {}
test_cases:
  - id: LOGIN-001
    name: Invalid configuration
    layer: config
    automation: manual
    automation_reason: Automation is tracked in TEST-42
    preconditions: [*logged_in]
    steps:
      - action: Submit invalid configuration
        expected: A validation error is shown
```

Unknown top-level keys such as `shared_preconditions` are ignored by the loader and can hold YAML anchor definitions. Anchors are local to one YAML file. Keep each case in one layer; split cases whose expected results require different layers.

Without `metadata.layers`, no layer policy is enforced. With a declaration, missing or undeclared layers warn. Active manual cases in a layer declaring `automation: expected` also warn unless `automation_reason` contains text. `semi` is permitted. `--strict --out sheet.html` writes the HTML and exits unsuccessfully when warnings occur. Invalid field types are rejected. Layer names are case sensitive.

Parameterized cases inherit `layer` and `automation_reason` in pattern > template > entry order. Layer filters combine with the other table filters using AND. Plan layers narrow the existing tag/part range using AND; no selected layers means every layer, including unspecified. Older saved plans retain their previous range.

The layer summary lists each suite's totals and automated / semi / manual counts. Cases remain in their original order: within each section, consecutive shared precondition prefixes appear as nested headings, including in Markdown copies. Single-case copies include all preconditions. YAML and execution records stay flat.

With `--tests`, recognized Kotest string containers (`"context" - { ... }`, `context("context") { ... }`, and describe/given/when/and) and JUnit `@Nested` classes with `@DisplayName` appear above source snippets, from outermost to innermost. A dynamic
`withContexts(…)`, `withData(…)` or `withTests(…)` container is shown as what it means, such as
"Each of PLANS, named Plan::name" (the call as written is its tooltip), since its runtime names are not
known without running the tests. When the name function is a reference like `Plan::name` and every element is a
`Plan(…)` call that writes that property as a string literal (up to six elements), the names are listed in the
heading itself ("Each of PLANS, named 無料プラン, 有料プラン"). Which container a row's case ID runs in
depends on code that is not run here, so it is not filtered. The call may span lines.
Unrecognized containers are omitted; names are not automatically compared with preconditions.

### Project layer declarations and display names

Use `--layers layers.yaml` to share declarations across suites. The file is a mapping
of layer keys to definitions (without a `metadata` or `layers` wrapper):

```yaml
component:
  label: Internal integration tests
  description: Only the component under test is real; its dependencies are substitutes
  automation: expected
system:
  label: System integration tests
  description: All our components are real; external services are mocked
external:
  label: End-to-end tests
  description: The external services exercised by the case are real
```

```bash
bun run src/cli.ts examples/platform --layers examples/layers.yaml --out sheet.html --strict
```

Paths are relative to the working directory. Server mode reloads the declarations
on each render and watches their directory, including when it is outside the scan root.
Invalid project declarations fail generation rather than silently disabling the policy.

Cases still use the key, such as `layer: component`. Filters, counts, Plan choices,
and Markdown copies use `label`, falling back to the key. Descriptions appear as
hover titles on layer chips, choices and summary entries. Saved Plan selections
continue to use keys, so changing a label does not change a plan's range.

Suite `metadata.layers` overrides individual fields of the project definitions:

```yaml
metadata:
  type_name: Login
  id_prefix: LOGIN
  layers:
    component: { automation: null }
```

This keeps the shared label and description while clearing only the automation
policy. An empty definition `{}` inherits every field. Suite-only layers are appended
after the project layers; overriding a layer does not move it. Without a project
file, suite declaration order is used. Undeclared values and unspecified layers
appear after declared layers. Summaries include declared layers with zero cases;
filters offer layers present in their scope. Across suites, choices use the first
applicable suite's label and declaration order; suite pages and summaries use each
suite's own overrides.

### Adopting layers one suite at a time

During migration, share display definitions across the project but validate only
suites that explicitly opt in:

```bash
bun run src/cli.ts examples --layers examples/layers.yaml --layers-scope declared --out sheet.html --strict
```

With `--layers-scope declared`, a suite participates when its source YAML contains
`metadata.layers`, including an empty mapping:

```yaml
metadata:
  type_name: Login
  id_prefix: LOGIN
  layers: {}
```

Participating suites are checked for missing layers, undeclared values and manual
cases without an exception reason in automation-expected layers. Field overrides
continue to work, including `automation: null`. Suites without `metadata.layers`
still inherit labels, descriptions and declaration order for display, but do not
receive those three policy warnings. Invalid field types and malformed declarations
remain errors, and other warnings still affect `--strict`.

After migration, remove `--layers-scope declared` or use `--layers-scope all` to
check every suite against the project definitions. `all` is the default, preserving
the existing behavior. Without project definitions, suites with no layer declaration
have no layer policy to check in either mode.

### Definitions beside data-driven test snippets

Data-row snippets include collapsed **View type definition** and **View data declaration**
sections when matching source is available. The data declaration shows the variable's
opening line and its immediately preceding documentation comments. A constructor row
such as `Row(32, …, "LOGIN-001")` also links to a matching `class Row(...)`,
`data class Row(...)` or `record Row(...)` declaration, including its KDoc/Javadoc and
comments on constructor properties. This also applies to inline `withData(Row(...))` data.

Types are looked up in the same file first, then in other files selected by `--tests`.
Only those scanned files are searched; missing types and lowercase helpers such as
`row(...)` add no type definition. This is source matching, not compiler name resolution.
Each declaration is attached once per case, even when the row feeds several loops.
Definitions show relative file paths and line numbers and, like test bodies, are
limited to 80 lines with a truncation indicator. They start collapsed so the data row
and test body remain easy to read.
