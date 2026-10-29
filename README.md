# test-sheet

A local tool for managing test cases as `testcases.yaml` files and browsing them in a single page. Built with Bun + Preact.

## Features

- Manage test cases as YAML — no hand-written Markdown
- Navigate a domain → feature → test suite → section → test case hierarchy
- Click a domain, feature or test suite to see a table of every case under it; a suite also lists its cases in full below the table
- Full-text search in a command palette (Cmd+K / Ctrl+K), and a filter on every table
- Resizable, collapsible side nav; a docked guide panel to read beside the cases
- A Run mode toggle in the header adds Pass / Fail buttons to every step: the first unmarked step is highlighted, a failed step takes a short note, each case gets a PASS / FAIL chip, and copying a case as Markdown includes the results. Results stay in this browser only; they are a working record, not a test report
- Each case shows its preconditions, test data, steps and note; a suite page hides the cards of obsolete, superseded and skipped cases by default (they stay in the table)
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
to its own. In `parameterized_tests`, a template's `tags` and a pattern's `tags` are both added to
each case the pattern expands to, so patterns can differ in tags while sharing one template.

```yaml
metadata:
  type_name: Login
  id_prefix: LOGIN
  tags: [login]
parameterized_tests:
  - id_prefix: LOGIN-ROLE-
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

### Directory hierarchy, domain, and feature

The first two path segments relative to the root directory are treated as "domain" and "feature", respectively.

```
examples/
└── web/            # domain
    └── login/       # feature
        └── testcases.yaml
```

If a directory has a `README.md`, its first `# Heading` is used as the display name in navigation (otherwise the directory name is used as-is).

### Embedding a guide (prerequisite knowledge)

```yaml
metadata:
  type_name: Login
  id_prefix: LOGIN
  guides:
    - ../common/test-prerequisites.md
```

Markdown files listed in `guides` are embedded at the top of the test suite, collapsed by
default. Their H2 headings are searchable from the command palette along with the prose under
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
