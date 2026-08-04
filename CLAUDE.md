# test-sheet

A local tool that renders `testcases.yaml` test case files into a single browsable HTML page. Bun + Preact, no build step beyond `bun build`.

## Architecture

```
src/
├── cli.ts           CLI entrypoint: arg parsing, --serve (Bun.serve + fs.watch + WebSocket
│                     reload) and --out (static single-file generation) modes
├── testCases.ts      Pure data layer: reads testcases.yaml, expands parameterized_tests,
│                     assigns test case IDs, discovers domain/feature from directory structure
└── html/
    ├── app.ts         Browser-side UI (Preact + htm, no JSX). Bundled by generate.ts via
    │                  Bun.build() and inlined into the output HTML — this file never runs
    │                  under Node/Bun directly.
    ├── generate.ts    Renders guide Markdown, bundles app.ts, and assembles the final HTML
    │                  document (embeds test case data as JSON + the bundled JS as one <script>)
    └── styles.ts       All CSS as a single exported template-string constant, inlined into
                        the generated HTML's <style> tag
```

Data flow: `cli.ts` → `loadAllTestSuites()` in `testCases.ts` (reads YAML from disk) → `generateHtml()` in `generate.ts` (renders to a self-contained HTML string) → either served over HTTP or written to a file.

The generated HTML has zero external dependencies (no CDN links, no separate JS/CSS files) — everything is inlined at generation time. This is intentional: the `--out` mode must produce a single file that works when opened directly or attached anywhere.

### Hierarchy model

Test cases nest five levels deep: **domain → feature → test suite → section → test case**. Domain and feature come from the first two path segments under the scan root (see `extractDomainAndFeature` in `testCases.ts`); a test suite is one `testcases.yaml` file; a section is the `category` field on a test case. Optional `README.md` files at the domain/feature directory level supply human-readable labels (first `# Heading`) — otherwise the raw directory name is shown.

Sticky header stacking (`sticky-level-0` through `sticky-level-4` in `styles.ts`) mirrors this hierarchy — each level's `top` offset is `--sticky-h * level`. If you add a new hierarchy level, add a matching `sticky-level-N` rule and update `--sticky-h` math accordingly.

## Development commands

```bash
bun install                              # install dependencies
bun run serve [dir] [--port <port>]      # local server with live reload
bun run src/cli.ts [dir] --out <file>    # generate a single static HTML file
bunx tsc --noEmit -p tsconfig.json       # type-check (there is no separate build/test script)
```

There is no test suite yet — verification is manual: run `bun run serve examples`, load the page, and check the console/network tab. When changing layout or CSS, prefer visually verifying in a real browser (`playwright-cli` — `bunx playwright cli open/goto/eval/screenshot` — works well for scripted checks: computed styles, element positions, and DOM structure) over reasoning from CSS alone. Box-model bugs here have repeatedly turned out to require real measurement, not inference.

## Code conventions

- **No comments explaining *what* the code does** — only *why*, for non-obvious constraints (e.g. the `.sticky-header` negative-margin trick in `styles.ts`, which needs a comment because the box-model reasoning isn't visible from the CSS alone).
- **htm, not JSX** — `app.ts` uses `` html`...` `` tagged templates via `htm`, not `.tsx`/JSX syntax. Keep it that way; introducing JSX would require a build-step change.
- TypeScript `strict: true`. Avoid `any`; prefer `unknown` with narrowing for YAML-derived data (see `formatTestData` in `app.ts` for the pattern).
- CSS lives entirely in `styles.ts` as one template string — no CSS modules, no separate `.css` files. Keep new rules there.
- English only in UI strings, code comments, and docs — this is an OSS-facing tool.

## `testcases.yaml` schema

```yaml
metadata:
  type_name: Login       # required, human-readable test suite name
  id_prefix: LOGIN        # required, prefix for auto-generated test case IDs (LOGIN-001, ...)
  guides:                 # optional, Markdown files embedded above the test cases
    - ../common/test-prerequisites.md
  category_order:         # optional, explicit section ordering (unlisted categories sort last)
    - Basic flow
    - Error handling
test_cases:
  - name: string
    category: string               # groups into a section; defaults to "Other"
    preconditions: [string | object]
    steps:
      - action: string
        expected: string
    notes: string | null
parameterized_tests:                # optional, expands a template across `patterns`
  - category: string
    id_prefix: string               # combined with each pattern's `id` to form the test case ID
    patterns:
      - id: string                  # e.g. "01" -> id_prefix + id = the _tcId
        # ...other placeholder values referenced as {{key}} in the template
    template:
      name: string                  # supports {{placeholder}} substitution
      steps: [{ action, expected, when? }]   # `when` supports `key == 'val'`, `&&`, `||`
      postconditions: [{ text, when? }]      # appended to the last step's `expected`
    format:                          # optional, controls how object-valued placeholders render
      key_labels: { field: label }
      value_labels: { rawValue: label }
```

`loadTestCases()` in `testCases.ts` is the single source of truth for this schema — check it (not this file) when the shape changes.

## Git

No branch/commit conventions are enforced yet; write clear, conventional-style commit messages (`feat:`, `fix:`, `docs:`, ...).
