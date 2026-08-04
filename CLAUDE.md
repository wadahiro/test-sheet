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

Sticky header stacking (`sticky-level-0` through `sticky-level-4` in `styles.ts`) mirrors this hierarchy — each level's `top` offset is `--header-h + --sticky-h * level`, where `--header-h` clears the global menu bar. If you add a new hierarchy level, add a matching `sticky-level-N` rule and update the math accordingly. Anything else that sticks (`.nav-outline`, the overview's `thead`) must offset by `--header-h` too, and `.app-header`'s height must stay pinned to `--header-h` rather than growing with its contents.

### Views and routing

The page has two views, switched by the toggle at the top of `NavOutline`. Overview is the landing view — anything the hash does not name resolves to it, so opening the file shows what is in it rather than dropping the reader into one suite:

- **Overview** (`#/overview`, filterable via `#/overview?q=<query>`) — one flat table row per test case, hierarchy levels as columns. Being flat, it needs no sticky stacking beyond its own `sticky-level-0` heading plus a sticky `thead`. The command palette offers a "Filter Overview by …" entry that hands its query off through that route; typing in the overview's own box filters locally without touching the hash, so it does not push a history entry per keystroke.
- **Test Cases** (`#/`) — the nested `DomainSection` tree described above. `#/tc/<anchorId>` deep-links to a single test case.

`NavEntry.searchText` is full-text, and deliberately wider than the label an entry displays: a test case carries its steps, preconditions, test data and notes (`testCaseSearchText`), and a guide heading carries its own section's Markdown (`GuideHeading.body`, split at H2 by `splitByH2` in `generate.ts`). Keep new content types indexed there — a search surface that only matches titles reads as broken. The overview's filter is the exception: it matches only the visible columns, since its result is a table the reader is looking at.

Routing is hash-based (`parseRoute` in `app.ts`), **not** the History API: `--out` builds must work over `file://`, where `pushState` throws and a real path would not resolve. Routes are namespaced under `#/` so they can never collide with an element ID and trigger the browser's native anchor jump.

### Guides

`metadata.guides` Markdown renders into a `<details class="guide">` at the top of its test suite, collapsed by default — a guide is prerequisite reading, not the main content. `buildNavEntries` takes a `GuideDetail` argument that splits the two surfaces: the outline (`"collapsed"`) gets one "Guide" entry per suite, while the command palette (`"headings"`) keeps one entry per guide h2, since granularity is what a search surface is for. Guides have no sticky header of their own, so their landing offset comes from `scroll-margin-top` in `styles.ts` rather than `jumpToId`'s offset trick; `jumpToId` opens any ancestor `<details>` before measuring.

`OverviewRow` stores per-level `keys` rather than precomputed "same as the row above" flags: the dimming of repeated hierarchy values is resolved at render time against the previous *visible* row, because filtering changes which row precedes which.

`jumpToId` compensates for the sticky stack by nudging down by the target's own sticky header `top`; without it a jump target lands underneath the stacked headers.

### Theming

Every color is a CSS variable on `:root` — never hardcode a color in a rule. `--bg` must stay in sync with `body`'s background because `.sticky-header` repaints it to cover content scrolling underneath.

The dark values live in `DARK_THEME_VARS` (a plain constant in `styles.ts`) and are interpolated into two rules: `:root[data-theme="dark"]` for an explicit choice, and `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` for the OS default. The `:not()` is what lets an explicit light choice survive an OS dark preference. Add new colors to `DARK_THEME_VARS`, not to either rule directly.

`data-theme` on `<html>` is the single source of truth, set by `ThemeToggle` in `app.ts` and persisted to `localStorage` under `test-sheet-theme`. An inline script in `generate.ts`'s `<head>` re-applies it before first paint; both it and the toggle wrap `localStorage` in `try/catch`, since it can be blocked over `file://`. When the attribute is absent the stylesheet follows the OS, so `currentTheme()` falls back to `matchMedia` rather than assuming light.

## Development commands

```bash
bun install                              # install dependencies
bun run serve [dir] [--port <port>]      # local server with live reload
bun run src/cli.ts [dir] --out <file>    # generate a single static HTML file
bun run src/cli.ts [dir] -e "<glob>"     # skip matching testcases.yaml files (repeatable)
bunx tsc --noEmit -p tsconfig.json       # type-check (there is no separate build/test script)
```

There is no test suite yet — verification is manual: run `bun run serve examples`, load the page, and check the console/network tab. Note that `--serve` watches only the scanned data directory, not `src/` — restart the server after editing source. Check both color schemes, and verify `--out` over `file://` for anything touching routing. When changing layout or CSS, prefer visually verifying in a real browser (`playwright-cli` — `bunx playwright cli open/goto/eval/screenshot` — works well for scripted checks: computed styles, element positions, and DOM structure) over reasoning from CSS alone. Box-model bugs here have repeatedly turned out to require real measurement, not inference.

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
