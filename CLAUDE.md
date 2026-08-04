# test-sheet

Renders `testcases.yaml` files into one browsable, self-contained HTML page. Bun + Preact.

## Hard constraints

- **The generated HTML must stay self-contained.** No CDN links, no separate JS/CSS files — `--out` has to work opened straight from disk or attached to a ticket. Inline everything at generation time.
- **Routing is hash-based** (`parseRoute` in `app.ts`), never the History API: `pushState` throws over `file://`. Namespace routes under `#/` so they cannot collide with an element ID and trigger a native anchor jump.
- **htm, not JSX.** `app.ts` uses `` html`...` `` tagged templates; JSX would require a build-step change.
- **All CSS lives in `styles.ts`** as one template string. No CSS modules, no `.css` files.
- **English only** in UI strings, comments and docs — this is OSS-facing.

## Hierarchy

domain → feature → test suite → section → test case. Domain and feature are the first two path segments under the scan root; a suite is one `testcases.yaml`; a section is a test case's `category`. A `README.md` in a domain/feature directory supplies its label from the first `# Heading`.

`loadTestCases()` in `testCases.ts` is the single source of truth for the YAML schema — read it there, not from docs.

## Layout invariants

- Sticky `top` is `--header-h + --sticky-h * level` (`sticky-level-0`..`4`). A new hierarchy level needs a matching rule. Anything else that sticks (`.nav-outline`, the overview `thead`) offsets by `--header-h` too, and `.app-header` must keep a fixed height rather than growing with its contents.
- `jumpToId` nudges a target down by its own sticky header's `top`; elements without one (guides) use `scroll-margin-top` instead. It also opens ancestor `<details>` before measuring.
- `.nav-outline` is a flex column and only its `ul` scrolls. New head elements need `flex: 0 0 auto`; the `ul` keeps `min-height: 0`.

## Theming

- Never hardcode a color; use the `:root` variables. `--bg` must match `body`'s background — `.sticky-header` repaints it to cover content scrolling underneath.
- Add dark values to `DARK_THEME_VARS` only. It is interpolated into both `:root[data-theme="dark"]` and the `prefers-color-scheme` fallback, whose `:not([data-theme="light"])` is what lets an explicit light choice survive an OS dark preference.
- `data-theme` on `<html>` is the source of truth, persisted to `localStorage`. Wrap every `localStorage` access in `try/catch` — it can be blocked over `file://`. With the attribute absent the stylesheet follows the OS, so read the current theme via `matchMedia`; never assume light.

## Search

- `NavEntry.searchText` is full-text and deliberately wider than the label an entry shows: test cases carry their steps, preconditions, test data and notes; guide headings carry their section's Markdown. Index new content types there — a search that only matches titles reads as broken.
- The overview's own filter is the exception: it matches only the visible columns, because it filters a table the reader is looking at.
- Guides render collapsed, with one outline entry per suite but per-heading entries in the palette (`GuideDetail` in `buildNavEntries`) — an outline is a structure map, a palette is a search surface.

## Code conventions

- **No comments explaining *what* the code does** — only *why*, for non-obvious constraints (e.g. the `.sticky-header` negative-margin trick, where the box-model reasoning is invisible from the CSS alone).
- TypeScript `strict: true`. Avoid `any`; prefer `unknown` with narrowing for YAML-derived data (`formatTestData` in `app.ts` shows the pattern).

## Development commands

```bash
bun install                              # install dependencies
bun run serve [dir] [--port <port>]      # local server with live reload
bun run src/cli.ts [dir] --out <file>    # generate a single static HTML file
bun run src/cli.ts [dir] -e "<glob>"     # skip matching testcases.yaml files (repeatable)
bunx tsc --noEmit -p tsconfig.json       # type-check (there is no build or test script)
```

## Verifying changes

There is no test suite — verification is manual against `bun run serve examples`.

- `--serve` watches only the scanned data directory, not `src/`. Restart it after editing source.
- Check both color schemes, and re-check `--out` over `file://` for anything touching routing or `localStorage`.
- For layout and CSS, measure in a real browser rather than reasoning from the stylesheet — `bunx playwright cli open/goto/eval/screenshot` handles computed styles, element positions and DOM structure. Box-model bugs here have repeatedly needed real measurement.

## Git

Write conventional-style commit messages (`feat:`, `fix:`, `docs:`, …). No branch conventions are enforced.
