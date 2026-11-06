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

A feature with exactly one suite is folded (`SuitePageData.folded`, set in `generate.ts`): navigation, breadcrumb, search and Markdown show one `domain › name` node, named by the README heading or else the suite's `type_name`. The node's page is the suite scope, and `#/f/<domain>/<feature>` resolves to it in `parseRoute`, so the feature hash survives a second suite arriving.

`loadTestCases()` in `testCases.ts` is the single source of truth for the YAML schema — read it there, not from docs.

## Layout invariants

- Sticky `top` is `--stick-top + --sticky-h * level` (`sticky-level-0`..`4`). `--stick-top` is `--header-h` plus `--page-gap`, the constant space under the app header that the level-0 header's shadow paints over; a new hierarchy level needs a matching rule. A scope page (`.app-scope`) has no title band of its own: its title is the breadcrumb in the app header, and `.app-scope` redeclares `--page-gap: 0` and `--stick-top` (a custom property computed at `:root` does not see the override). The first thing to stick there is the `.filter-bar` (fixed `--filter-h`, so its contents cannot wrap: container queries shrink them), with the table `thead` at `--stick-top + --filter-h`. Each case is its own `<tbody class="case">` (anchor id on the tbody) holding its row and, when open, its `.row-detail`; in the wide layout the table is a CSS grid with each tbody and row a subgrid (`--scope-cols`), because a sticky `<tr>` in a real table is held by the whole table and would stay pinned after its case scrolled past; the row is `.sticky-row` and sticks under that `thead` (`--scope-thead-h`, 0 where the narrow layout hides it) so it is the open case's heading, and lets go when the tbody scrolls past. Section rows carry `scroll-margin-top` for `jumpToId`; case rows must not, because `jumpToId` already nudges by the sticky row's `top` and a margin would count it twice. There are no section or card level headers on a scope page. The single long page (`#/all`) keeps the gap and stacks 3 and 4 (guides follow via `--guide-depth`). Anything else that sticks (`.nav-outline`, a table `thead`) offsets by `--stick-top` too (`.nav-outline` and the guide panel sit beside the page, so they use `--header-h`). `.app-header` must keep a fixed height rather than growing with its contents: its breadcrumb gives up width from the outer levels first and drops them below 700px, and the run button's width is capped for the same reason.
- Tags, and the domains/features/suites of a plan's range, are chosen with one `MultiPicker` (checklist popover with counts and search), on a scope page's filter bar and in the plan alike; a tag chip in a row toggles the same filter. On a scope page the filter takes any chosen part AND any chosen tag (OR inside each group), ANDed with the text filter; a plan's range takes a case with any chosen tag OR under any chosen part, because missing a case from a run is the worse mistake. The two read differently on purpose, so the chips are joined by drawn or/and words (`joinChips`). The filter bar's height is fixed, so the picker shows a count badge instead of chips.
- `jumpToId` nudges a target down by its own sticky header's `top`; elements without one (guides) use `scroll-margin-top` instead. It also opens ancestor `<details>` before measuring.
- A suite's guide opens in `.guide-panel`, a right-hand sticky column beside the cases, and only ever shows the guide of the suite whose page it sits on: the open/closed preference carries across pages and the panel stays open with it (saying so on a page without a guide, rather than coming and going as the reader moves), and a page with a guide shows its own, never a previous page's. The toggle lives in the app header (and the `g` key, ignored while typing), disabled where no table page, so no panel, is shown. Its body and the sidebar's list are the only nested scrollers; keep it that way. `jumpToId` scrolls the panel itself for targets inside `.guide-panel-body` (`scrollIntoView` would move the page too), and scroll tracking skips anything in the panel.
- The scope table (`.scope-table-wrap`) switches to a two-line-per-case layout through a container query on the wrap, at the same 600px as `.cards`, because the guide panel and sidebar set the main column's width. Do not give the wrap `overflow-x`: it would stop the filter bar and `thead` sticking to the page.
- On the one-page read a case card's header band is its `.sticky-header` (the deepest level); on a scope page the case's `.sticky-row` plays that part. `jumpToId` reads the `top` of either, so keep it a descendant of the jump target. The narrow step layout keys off the cards' own width (`.cards` container query), not the viewport, because the sidebar and guide panel set it.
- `.nav-outline` is a flex column and only its `ul` scrolls. New head elements need `flex: 0 0 auto`; the `ul` keeps `min-height: 0`.

## Runs and plans

- On every scope page a case opens below its row (`ScopePage` holds the open state; the route's target opens its case) and is recorded there; the stacked card list is gone. The one-page read (`#/all`, `#/`) is read-only (`RunContext` null) and follows the plan's scope like the tables. The row's Result chip and the filter bar's progress follow the marks through `RUN_CHANGE_EVENT` (fired by `writeRun`) and `useRunProgress`, which reads storage itself. Previous / Next go through `CaseNavContext`, which opens the neighbour in place without touching the hash, so they never leave the scope. The row of an open case shows the ID, name, tags, Result chip with Reset, and, at the right of the tags cell, the actions (Previous / Next, link, copy; no column of their own); the detail below (`CaseBody`) repeats none of it. `useCaseRun` lives in `OpenCase`, so closed rows hold no hooks. The standalone `TestCaseCard` (one-page read) keeps its own header.
- A run's per-case results live under `test-sheet-run:<ns>:<run>:`, and `recordedCaseIds` counts every key there as a recorded case. Anything else a run stores (its plan: `test-sheet-plan:<ns>:<run>`) needs its own prefix, and `deleteRunData` must remove it.
- A plan's range is a set of exact tags, never the filter's text: that text also matches names and translated labels, so it could not name the same cases twice. A case with no decision is undecided, so one added to the sheet later is seen as new rather than silently in or out. Inactive cases carry their reason in the YAML and are not decided. A run in use shows only the cases decided Run that are in the range and active (`planScopeIds`); excluded and undecided ones are left out, and why is the review sheet's job. A plan with no case decided Run has not been made, so it covers the whole sheet; starting from the plan page marks the range's undecided cases Run in that situation, so a run does not begin with nothing in it. There is no switch to widen it — leaving run mode (header ✕) is how the whole sheet is read again. The plan's Exclude and the YAML's `skip` are different things; keep the words apart in the UI.

## Theming

- Each surface variable has one meaning, so a state is not told by the same grey as a structure: `--bg-chrome` (app header, side nav), `--bg-subtle` (table header and section rows), `--accent-bg` (open or selected), `--bg-hover` (pointer), `--bg-chip` (labels, code), `--zebra` (every other step row). An inactive case has no flat fill: `--inactive-fill` is a hatch over `--bg`, with a struck-through ID and name, so it never reads as a header row and does not rest on colour. Control edges use `--border-strong` (3:1); `--border` is for rules only. Pass/Fail keep their glyph and text, never colour alone. There is no `--fg-faint`: text uses `--fg-muted` (4.5:1).
- Never hardcode a color; use the `:root` variables. `--bg` must match `body`'s background — `.sticky-header` repaints it to cover content scrolling underneath.
- Add dark values to `DARK_THEME_VARS` only. It is interpolated into both `:root[data-theme="dark"]` and the `prefers-color-scheme` fallback, whose `:not([data-theme="light"])` is what lets an explicit light choice survive an OS dark preference.
- `data-theme` on `<html>` is the source of truth, persisted to `localStorage`. Wrap every `localStorage` access in `try/catch` — it can be blocked over `file://`. With the attribute absent the stylesheet follows the OS, so read the current theme via `matchMedia`; never assume light.

## Search

- A query is split on whitespace and an entry must contain every word (`searchTerms`/`matchesTerms`), in the palette and the table filters alike; `Highlight` marks each word. The palette alone is also fuzzy (`paletteScore`): a word whose letters occur in order within the shown title or breadcrumb matches ("rate06" finds RATELIMIT-006) and ranks below a plain hit; the tables stay substring, since fuzzy over a long cell would match nearly every row.
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
