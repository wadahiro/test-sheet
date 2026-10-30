# test-sheet

Renders `testcases.yaml` files into one browsable, self-contained HTML page. Bun + Preact.

## Hard constraints

- **The generated HTML must stay self-contained.** No CDN links, no separate JS/CSS files — `--out` has to work opened straight from disk or attached to a ticket. Inline everything at generation time.
- **Routing is hash-based** (`parseRoute` in `app.ts`), never the History API: `pushState` throws over `file://`. Namespace routes under `#/` so they cannot collide with an element ID and trigger a native anchor jump. The grammar lives in the comment above `parseRoute`; build hashes with the `*Hash` helpers, and keep `#/tc/<id>` and `#/` resolving because people link to them.
- **htm, not JSX.** `app.ts` uses `` html`...` `` tagged templates; JSX would require a build-step change.
- **All CSS lives in `styles.ts`** as one template string. No CSS modules, no `.css` files.
- **UI strings go through `t()`** (`src/html/i18n.ts`), keyed in `src/html/locales/en.ts`; never write a user-visible literal in `app.ts`. English is the source and the fallback, so comments and docs stay English. A new key must also be added to `locales/ja.ts` (it is typed against `en`, so the build says so). Build messages whole, with `{placeholders}`, rather than gluing fragments, because word order differs by language. Anything computed from strings at module load (column lists, labels) must be a function, since the language can change at run time. The category fallback `"Other"` is data, not UI: it also forms route hashes, so it is not translated.

## Hierarchy

domain → feature → test suite → section → test case. Domain and feature are the first two path segments under the scan root; a suite is one `testcases.yaml`; a section is a test case's `category`. A `README.md` in a domain/feature directory supplies its label from the first `# Heading`.

`loadTestCases()` in `testCases.ts` is the single source of truth for the YAML schema — read it there, not from docs.

## Layout invariants

- Sticky `top` is `--stick-top + --sticky-h * level` (`sticky-level-0`..`4`). `--stick-top` is `--header-h` plus `--page-gap`, the constant space under the app header that the level-0 header's shadow paints over; a new hierarchy level needs a matching rule. A scope page (`.app-scope`) has no title band of its own: its title is the breadcrumb in the app header, and `.app-scope` redeclares `--page-gap: 0` and `--stick-top` (a custom property computed at `:root` does not see the override). The first thing to stick there is the `.filter-bar` (fixed `--filter-h`, so its contents cannot wrap: container queries shrink them), with the table `thead` at `--stick-top + --filter-h`, and its sections and cards pass `level` 0 and 1. The single long page (`#/all`) keeps the gap and stacks 3 and 4 (guides follow via `--guide-depth`). Anything else that sticks (`.nav-outline`, a table `thead`) offsets by `--stick-top` too (`.nav-outline` and the guide panel sit beside the page, so they use `--header-h`). `.app-header` must keep a fixed height rather than growing with its contents: its breadcrumb gives up width from the outer levels first and drops them below 700px, and the run button's width is capped for the same reason.
- `jumpToId` nudges a target down by its own sticky header's `top`; elements without one (guides) use `scroll-margin-top` instead. It also opens ancestor `<details>` before measuring.
- A suite's guide opens in `.guide-panel`, a right-hand sticky column beside the cases, and stays open across pages. Its body and the sidebar's list are the only nested scrollers; keep it that way. `jumpToId` scrolls the panel itself for targets inside `.guide-panel-body` (`scrollIntoView` would move the page too), and scroll tracking skips anything in the panel.
- The scope table (`.scope-table-wrap`) switches to a two-line-per-case layout through a container query on the wrap, at the same 600px as `.cards`, because the guide panel and sidebar set the main column's width. Do not give the wrap `overflow-x`: it would stop the filter bar and `thead` sticking to the page.
- A case card's header band is its `.sticky-header` (the deepest level); `jumpToId` reads its `top`, so keep it a descendant of the card. The narrow step layout keys off the cards' own width (`.cards` container query), not the viewport, because the sidebar and guide panel set it.
- `.nav-outline` is a flex column and only its `ul` scrolls. New head elements need `flex: 0 0 auto`; the `ul` keeps `min-height: 0`.

## Theming

- Never hardcode a color; use the `:root` variables. `--bg` must match `body`'s background — `.sticky-header` repaints it to cover content scrolling underneath.
- Add dark values to `DARK_THEME_VARS` only. It is interpolated into both `:root[data-theme="dark"]` and the `prefers-color-scheme` fallback, whose `:not([data-theme="light"])` is what lets an explicit light choice survive an OS dark preference.
- `data-theme` on `<html>` is the source of truth, persisted to `localStorage`. Wrap every `localStorage` access in `try/catch` — it can be blocked over `file://`. With the attribute absent the stylesheet follows the OS, so read the current theme via `matchMedia`; never assume light.

## Search

- `NavEntry.searchText` is full-text and deliberately wider than the label an entry shows: test cases carry their steps, preconditions, test data and notes; guide headings carry their section's Markdown. Index new content types there — a search that only matches titles reads as broken.
- A table's own filter is the exception: it matches only what the table shows (including its section heading rows), because it filters something the reader is looking at. On a suite page the same rule also narrows the cards.
- Guides have no sidebar entry (they are opened from the page they belong to) but each guide heading is a palette entry (`GuideDetail` in `buildNavEntries`) — an outline is a structure map, a palette is a search surface.

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
