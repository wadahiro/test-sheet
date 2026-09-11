# test-sheet

A local tool for managing test cases as `testcases.yaml` files and browsing them in a single page. Built with Bun + Preact.

## Features

- Manage test cases as YAML — no hand-written Markdown
- Navigate a domain → feature → test suite → section → test case hierarchy
- Incremental search via the side nav and a command palette (Cmd+K / Ctrl+K)
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

Uniqueness is only checked per file, not across the whole scan root, so an explicit `id` must
also be unique across every `testcases.yaml` under the root — conventionally give it the
suite's own `id_prefix` to keep that true.

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
