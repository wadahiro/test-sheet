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

Markdown files listed in `guides` are embedded at the top of the test suite, and their H2 headings also appear as navigation entries.

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

## License

MIT
