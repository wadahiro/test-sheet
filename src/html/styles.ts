/**
 * Interpolated into two rules below — the explicit opt-in and the OS-preference fallback.
 * Kept as one constant so the two copies cannot drift apart.
 */
const DARK_THEME_VARS = `
  --fg: #c9d1d9;
  --fg-muted: #9198a1;
  --fg-faint: #4a525c;
  --bg: #0d1117;
  --bg-subtle: #161b22;
  --bg-hover: #21262d;
  --border: #3d444d;
  --accent: #4493f8;
  --accent-bg: #1f3a5f;
  --success: #3fb950;
  --overlay: rgba(1, 4, 9, 0.7);
  --flash: #4d3800;
  --inactive-bg: #262c36;
  --warn: #d29922;
  --warn-bg: #3a2d00;
  --success-bg: #1a3d26;
  --danger: #f85149;
  --danger-bg: #3d1a1c;
`;

export const STYLES = `
:root {
  color-scheme: light dark;
  --fg: #1f2328;
  --fg-muted: #57606a;
  --fg-faint: #b6bec7;
  /* Sticky headers repaint the page background to cover the content scrolling under them,
     so --bg must match body's background exactly rather than relying on the Canvas keyword */
  --bg: #ffffff;
  --bg-subtle: #f6f8fa;
  --bg-hover: #eaeef2;
  --border: #d0d7de;
  --accent: #0969da;
  --accent-bg: #ddebfa;
  --success: #1a7f37;
  --overlay: rgba(15, 23, 42, 0.45);
  --flash: #fff2ba;
  --inactive-bg: #eceff2;
  --warn: #9a6700;
  --warn-bg: #fff8c5;
  --success-bg: #dafbe1;
  --danger: #cf222e;
  --danger-bg: #ffebe9;
  --header-h: 48px;
  /* Breathing room between the app header and the first sticky header; sticky tops start below it */
  --page-gap: 16px;
  --stick-top: calc(var(--header-h) + var(--page-gap));
  --nav-w: 240px;
  --guide-w: 380px;
  --sticky-h: 44px;
  --filter-h: 56px;
}

:root[data-theme="light"] { color-scheme: light; }

:root[data-theme="dark"] {
  color-scheme: dark;${DARK_THEME_VARS}}

/*
 * With no explicit choice, follow the OS. The :not() is what makes an explicit "light"
 * survive an OS dark preference; without it the media query would always win.
 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {${DARK_THEME_VARS}}
}

* { box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", sans-serif;
  line-height: 1.6;
  margin: 0;
  padding: 0;
  color: var(--fg);
  background: var(--bg);
}

/*
 * Global menu bar. Everything else that sticks is offset below it by --header-h, so its
 * height must stay fixed rather than growing with its contents.
 */
.app-header {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: var(--header-h);
  padding: 0 16px;
  background: var(--bg-subtle);
  border-bottom: 1px solid var(--border);
}

.app-header-lead {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.app-crumbs {
  flex: 1 1 auto;
  min-width: 0;
}

.app-crumbs ol {
  display: flex;
  align-items: baseline;
  margin: 0;
  padding: 0;
  list-style: none;
}

/*
 * The path is cut from its outer end: the page's own title is what the reader came for, so the levels
 * above give up width first (their shrink factor dwarfs the title's) and drop out below 700px. Cutting
 * the joined string at its end instead would remove exactly that title.
 */
.crumb {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.crumb-ancestor {
  flex: 0 100 auto;
  color: var(--fg-muted);
  font-size: 0.85rem;
}

.crumb-ancestor::after {
  content: "›";
  margin: 0 8px;
  color: var(--fg-faint);
}

.crumb-ancestor a {
  color: inherit;
  text-decoration: none;
}

.crumb-ancestor a:hover {
  color: var(--accent);
  text-decoration: underline;
}

.crumb-current {
  flex: 0 1 auto;
}

.app-header-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 700px) {
  .crumb-ancestor { display: none; }
}

.app-header-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--fg-muted);
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 0.8rem;
  font-family: inherit;
  line-height: 1;
  cursor: pointer;
}

.header-btn:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.header-btn-icon {
  padding: 6px;
}

.header-kbd {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 0.72rem;
  font-family: inherit;
  color: var(--fg-faint);
}

.layout {
  display: flex;
  align-items: flex-start;
}

.panel-resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  /* Pointer drags would otherwise scroll the page or select text on touch/trackpad gestures */
  touch-action: none;
  z-index: 20;
}

.panel-resizer-end { right: 0; }
.panel-resizer-start { left: 0; }

.panel-resizer:hover,
.panel-resizer.panel-resizer-active,
.panel-resizer:focus-visible {
  background: var(--accent);
  opacity: 0.5;
  outline: none;
}

.layout-nav-collapsed .nav-outline {
  display: none;
}

/*
 * A column that stays put while only the entry list scrolls.
 */
.nav-outline {
  position: sticky;
  top: var(--header-h);
  flex: 0 0 var(--nav-w);
  width: var(--nav-w);
  height: calc(100vh - var(--header-h));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid var(--border);
  padding: 20px 12px;
  background: var(--bg-subtle);
}

.nav-empty {
  color: var(--fg-muted);
  font-size: 0.85rem;
  padding: 6px 8px;
}

.nav-outline ul {
  list-style: none;
  margin: 0;
  padding: 0;
  /* min-height:0 lets this flex item shrink below its content height, which is what makes
     it — rather than the whole sidebar — the thing that scrolls */
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.nav-outline-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  width: 100%;
  text-align: left;
  border: none;
  background: none;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 0.85rem;
  cursor: pointer;
  color: var(--fg);
}

.nav-outline-item:hover {
  background: var(--bg-hover);
}

.nav-outline-item.nav-outline-current {
  background: var(--accent-bg);
  color: var(--accent);
  font-weight: 600;
}

/* One line per entry: the label gives way (ellipsis, full text in the title) before the count does */
.nav-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The item aligns its text on the baseline, which would leave the icon riding above the numbers */
/* Nothing in the planned range under it: still reachable, but plainly not where to look */
.nav-outline-empty { opacity: 0.45; }

.nav-guide {
  flex: 0 0 auto;
  align-self: center;
  display: flex;
  color: var(--fg-muted);
}

.nav-outline-item .count {
  flex: 0 0 auto;
  color: var(--fg-muted);
  font-weight: normal;
}

.nav-outline-view .nav-outline-item {
  font-weight: 500;
  font-size: 0.95rem;
}

.nav-outline-domain {
  margin-top: 10px;
}

.nav-outline-domain:first-child {
  margin-top: 0;
}

.nav-outline-domain .nav-outline-item {
  font-weight: 500;
  font-size: 0.95rem;
}

.nav-outline-feature {
  margin-top: 4px;
}

.nav-outline-feature .nav-outline-item {
  padding-left: 20px;
  font-weight: 500;
  font-size: 0.9rem;
}

.nav-outline-suite .nav-outline-item {
  padding-left: 32px;
  font-weight: 400;
  font-size: 0.85rem;
}

.nav-outline-guide .nav-outline-item {
  padding-left: 44px;
  font-style: italic;
  color: var(--fg-muted);
}

.nav-outline-category .nav-outline-item {
  padding-left: 44px;
  font-weight: 400;
}

/*
 * Vertical rules show what hangs under what: one per ancestor level, at the ancestor's text indent
 * plus a small step, painted behind the buttons so hover and current backgrounds cover them.
 */
.nav-outline li {
  --rule: linear-gradient(var(--border), var(--border));
}

.nav-outline-feature {
  background: var(--rule) 14px 0 / 1px 100% no-repeat;
}

.nav-outline-suite,
.nav-outline-folded.nav-outline-guide,
.nav-outline-folded.nav-outline-category {
  background: var(--rule) 14px 0 / 1px 100% no-repeat, var(--rule) 26px 0 / 1px 100% no-repeat;
}

.nav-outline-guide:not(.nav-outline-folded),
.nav-outline-category:not(.nav-outline-folded) {
  background: var(--rule) 14px 0 / 1px 100% no-repeat, var(--rule) 26px 0 / 1px 100% no-repeat, var(--rule) 38px 0 / 1px 100% no-repeat;
}

/* A folded suite's node is a feature-level row, so what hangs under it sits one step in from it, not two */
.nav-outline-folded.nav-outline-guide .nav-outline-item,
.nav-outline-folded.nav-outline-category .nav-outline-item {
  padding-left: 32px;
}

.app {
  flex: 1;
  min-width: 0;
  padding: var(--page-gap) 32px 80px;
}

/*
 * A scope page has no title band of its own to keep clear of the app header, and its filter bar
 * already pads the input by 9px, so the gap is dropped there. --stick-top is restated because a
 * custom property computed at :root does not see this override of --page-gap.
 */
.app-scope {
  --page-gap: 0px;
  --stick-top: var(--header-h);
}

/*
 * Stacked sticky headers for the hierarchy (domain -> feature -> test suite -> section).
 * Each level shares the same height (--sticky-h); top is offset by the level index so
 * headers stack instead of overlapping, starting below the global menu bar (--header-h).
 * .app's left/right padding would otherwise show through, so sticky-header cancels it
 * out itself and paints its own background.
 */
.sticky-header {
  position: sticky;
  z-index: 10;
  height: var(--sticky-h);
  display: flex;
  align-items: center;
  background: var(--bg);
  margin-left: -32px;
  margin-right: -32px;
  padding-left: 32px;
  padding-right: 32px;
}

.sticky-level-0 {
  top: calc(var(--stick-top) + var(--sticky-h) * 0);
  z-index: 14;
  /* The gap above the first header stays open when scrolled, so it is painted over: otherwise cases
     would scroll through it, visible between the app header and this one */
  box-shadow: 0 calc(-1 * var(--page-gap)) 0 var(--bg);
}
.sticky-level-1 { top: calc(var(--stick-top) + var(--sticky-h) * 1); z-index: 13; }
.sticky-level-2 { top: calc(var(--stick-top) + var(--sticky-h) * 2); z-index: 12; }
.sticky-level-3 { top: calc(var(--stick-top) + var(--sticky-h) * 3); z-index: 11; }
.sticky-level-4 { top: calc(var(--stick-top) + var(--sticky-h) * 4); z-index: 10; }

.domain-section {
  margin-bottom: 40px;
}

.domain-title {
  font-size: 1.6rem;
  border-bottom: 4px solid var(--accent);
  margin: 0 0 24px;
  /* .sticky-header's padding-left/right exist only to extend the background; cancel
     them here so the text itself lines back up with .app's padding */
  padding-left: 0;
  padding-right: 0;
  justify-content: space-between;
  gap: 12px;
}

.feature-section {
  margin-bottom: 32px;
}

.feature-title {
  font-size: 1.3rem;
  color: var(--fg-muted);
  border-bottom: 2px solid var(--border);
  margin: 0 0 16px;
  padding-left: 0;
  padding-right: 0;
  justify-content: space-between;
  gap: 12px;
}

.suite-title {
  font-size: 1.1rem;
  border-bottom: 1px solid var(--border);
  margin: 0 0 24px;
  padding-left: 0;
  padding-right: 0;
  justify-content: space-between;
  gap: 12px;
}

.suite-title-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.suite-title-right {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
}

.suite-title-count {
  color: var(--fg-muted);
  font-weight: normal;
  font-size: 0.85rem;
  white-space: nowrap;
}

.suite-section {
  margin-bottom: 48px;
  padding-bottom: 24px;
  border-bottom: 4px solid var(--border);
}

.suite-section:last-child {
  border-bottom: none;
}

.empty {
  color: var(--fg-muted);
  padding: 24px;
}

/* Overview: a flat table of every test case, so it needs no sticky stacking beyond its own header */

/*
 * The first thing to stick on a scope page (the page's title lives in the app header), with the table
 * header below it. It sits in a wrapper that ends with the table, so on a suite page it scrolls away
 * before the section headers (which stick at the same height) arrive. Like .sticky-header it repaints
 * the page background across .app's side padding. Its height is fixed, so its contents cannot wrap:
 * the container queries below shrink them instead.
 */
.filter-bar {
  position: sticky;
  top: var(--stick-top);
  z-index: 11;
  height: var(--filter-h);
  display: flex;
  align-items: center;
  margin: 0 -32px;
  padding: 0 32px;
  background: var(--bg);
}

.overview-search {
  flex: 1 1 auto;
  min-width: 0;
  height: 38px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.9rem;
  background: var(--bg);
  color: var(--fg);
}

/* In the narrow table layout the toggles' labels give way (full text in the title) before the input does */
@container scope-table (max-width: 600px) {
  .filter-toggle-text {
    max-width: 5.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.filter-toggle {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  margin-left: 12px;
  font-size: 0.8rem;
  color: var(--fg-muted);
  white-space: nowrap;
  cursor: pointer;
}

/* The plan page: what a run covers, chosen per case, with the reason beside each choice */
/*
 * Everything that controls the plan sticks together, so it stays in view however far the table scrolls.
 * Its height varies with how the range chips and buttons wrap, so the page measures it into --filter-h
 * (which the table head's offset is built from) rather than fixing it. It is its own container, as the
 * wrap is for the other scope pages, so the filter row's actions shrink by its width.
 */
.plan-bar {
  position: sticky;
  top: var(--stick-top);
  z-index: 12;
  container: scope-table / inline-size;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 -32px;
  padding: 12px 32px 0;
  background: var(--bg);
}

.plan-bar .filter-bar {
  position: static;
  height: auto;
  min-height: var(--filter-h-min, 56px);
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 9px 0;
}

.plan-bar .overview-search { flex: 1 1 14rem; }

.plan-bar .filter-actions { margin-left: 4px; }

.plan-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 16px;
}

.plan-range {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.plan-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--fg-muted);
}

.plan-range-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: default;
}

.plan-chip-x {
  border: none;
  background: none;
  padding: 0 2px;
  font: inherit;
  line-height: 1;
  color: inherit;
  cursor: pointer;
}

.plan-chip-x:hover { color: var(--danger); }

.plan-tag-add {
  max-width: 14rem;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg-muted);
  font: inherit;
  font-size: 0.8rem;
}

.plan-note {
  font-size: 0.8rem;
  color: var(--fg-faint);
}

.plan-summary {
  font-size: 0.85rem;
  color: var(--fg-muted);
}

.plan-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.plan-actions .copy-btn:disabled { opacity: 0.5; cursor: default; }

.decision-group {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.decision-btn {
  border: none;
  background: var(--bg);
  padding: 3px 10px;
  font: inherit;
  font-size: 0.78rem;
  color: var(--fg-muted);
  cursor: pointer;
}

.decision-btn + .decision-btn { border-left: 1px solid var(--border); }
.decision-btn:hover { background: var(--bg-hover); }
.decision-r.decision-on { background: var(--success-bg); color: var(--success); font-weight: 600; }
.decision-s.decision-on { background: var(--warn-bg); color: var(--warn); font-weight: 600; }

/* A case still to be decided is marked at the row's edge, so it stands out in a long list */
.plan-undecided td:first-child { box-shadow: inset 3px 0 0 var(--warn); }

.plan-reason {
  width: 100%;
  min-width: 10rem;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
  font: inherit;
  font-size: 0.85rem;
}

/* Ticking several cases to give them a decision or a reason together */
.plan-select-cell { width: 1%; text-align: center; }
.plan-select { cursor: pointer; }
.scope-group .plan-select { margin-right: 8px; vertical-align: middle; }

.plan-decision-filter {
  flex: 0 0 auto;
  padding: 6px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg-muted);
  font: inherit;
  font-size: 0.8rem;
}

.plan-selection {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  margin-bottom: 8px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--accent-bg);
}

.plan-selection-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.plan-selected-count { font-size: 0.85rem; font-weight: 600; color: var(--accent); }

.plan-bulk-reason {
  flex: 1 1 14rem;
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
  font: inherit;
  font-size: 0.85rem;
}

.plan-overwrite { margin-left: 0; }

.plan-done {
  white-space: nowrap;
  text-decoration: none;
}

@media (max-width: 700px) {
  .plan-done-text { display: none; }
}

.run-plan { white-space: nowrap; text-decoration: none; }

/* The header cannot wrap, so the plan link gives its room to the run's name first; the run menu still has it */
@media (max-width: 900px) {
  .run-plan { display: none; }
}

/* The name opens the case as the ID does, for the mouse; the ID button stays the one keyboard and assistive technology use */
.expand-name { cursor: pointer; }

.expand-caret {
  display: inline-block;
  width: 1em;
  margin-right: 2px;
  color: var(--fg-muted);
}

/* A case opened in place: its card sits in a table cell, so its header must not join the sticky stack */
.row-detail > td { padding: 0 8px 8px; border-top: none; }
.row-detail .test-case { margin-bottom: 0; }
.row-detail .test-case-head { position: static; }
/* Planning stays on the plan page, so the card's link to its own page is not offered, and a plan has nothing to copy per case */
.plan-table .row-detail .test-case-actions { display: none; }
.plan-table .row-detail .test-case-head { position: static; }

/*
 * On a scope page a case opens below its row and is recorded there, so a long case keeps its header
 * (result chip, Previous / Next) in view. It sticks under the filter bar and the table head, and is
 * not on the level stack: its top is that of the table, not of a section header.
 */
.scope-table:not(.plan-table) { --scope-thead-h: 38px; }
.scope-table:not(.plan-table) .row-detail .test-case-head.sticky-header {
  position: sticky;
  top: calc(var(--stick-top) + var(--filter-h) + var(--scope-thead-h));
  z-index: 10;
}
/* Jump targets (a section's heading row, a closed case's row) clear the same stack */
.scope-table:not(.plan-table) .scope-group,
.scope-table:not(.plan-table) .overview-row {
  scroll-margin-top: calc(var(--stick-top) + var(--filter-h) + var(--scope-thead-h));
}
.scope-group-copy { float: right; margin: -3px 0; }

.full-scope-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin-bottom: 12px;
}
.full-scope-bar .hidden-note { margin: 0; }

/* A section heading row has no sticky header of its own for jumpToId to nudge by, so it clears the stack here */
.plan-table .scope-group { scroll-margin-top: calc(var(--stick-top) + var(--filter-h) + var(--plan-thead-h, 38px)); }

.plan-yaml {
  font-size: 0.8rem;
  color: var(--fg-muted);
}

.hidden-note {
  margin: 0 0 16px;
  font-size: 0.85rem;
  color: var(--fg-muted);
}

.link-btn {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  color: var(--accent);
  cursor: pointer;
}

a.link-btn { text-decoration: none; }
.link-btn:hover { text-decoration: underline; }
.link-btn:disabled { opacity: 0.5; cursor: default; text-decoration: none; }
.link-btn-danger:hover { color: var(--danger); }

/* Language picker: a short list under the header icon, opened like the run menu */
.lang-anchor { position: relative; }

.lang-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 200;
  min-width: 10rem;
  max-height: calc(100vh - var(--header-h) - 24px);
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  box-shadow: 0 8px 24px var(--overlay);
}

.lang-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--fg);
  font: inherit;
  font-size: 0.85rem;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}

.lang-item:hover { background: var(--bg-subtle); }
.lang-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.lang-item-current { font-weight: 600; }
.lang-mark { display: inline-block; width: 1em; color: var(--accent); }

/* The run being recorded into, always named in the header so results never go to the wrong one */
.run-anchor { position: relative; }

.run-btn {
  max-width: clamp(7rem, 30vw, 12rem);
  gap: 6px;
}

.run-btn-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-dot { font-size: 0.6rem; line-height: 1; }

.run-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 200;
  width: min(26rem, 92vw);
  max-height: calc(100vh - var(--header-h) - 24px);
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  box-shadow: 0 8px 24px var(--overlay);
}

.run-menu-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  font-size: 0.85rem;
  font-weight: 600;
}

.run-menu-note { font-size: 0.72rem; font-weight: 400; color: var(--fg-muted); }
.run-menu-empty { margin: 0; padding: 14px; font-size: 0.85rem; color: var(--fg-muted); }
.run-menu-list { margin: 0; padding: 4px; list-style: none; }

.run-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 6px 2px 2px;
  border-radius: 6px;
}

.run-row:hover { background: var(--bg-subtle); }
.run-row-off .run-name { color: var(--fg-muted); font-weight: 500; }
.run-row-active { background: var(--accent-bg); }
.run-row-active:hover { background: var(--accent-bg); }

.run-pick {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  border: none;
  background: none;
  color: var(--fg);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.run-pick:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 6px; }
.run-mark { flex: 0 0 auto; color: var(--accent); font-size: 0.7rem; line-height: 1.7; }
.run-text { display: flex; min-width: 0; flex-direction: column; }
.run-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.88rem; font-weight: 600; }
.run-meta { font-size: 0.72rem; color: var(--fg-muted); }

.run-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
  font-size: 0.75rem;
}

.run-rename {
  flex: 1 1 auto;
  min-width: 0;
  height: 30px;
  margin: 4px;
  padding: 0 8px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
  font: inherit;
  font-size: 0.85rem;
}

.run-new {
  display: flex;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--border);
}

.run-new-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
  font: inherit;
  font-size: 0.85rem;
}

.run-new-input:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }

.overview-search:focus {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}

.overview-table {
  width: 100%;
  /* Not \`collapse\`: collapsed borders are painted by the table, so they scroll away from a sticky thead */
  border-collapse: separate;
  border-spacing: 0;
  border: 1px solid var(--border);
  /* The top edge belongs to the sticky thead instead, so it stays when the table scrolls under the header */
  border-top: none;
  font-size: 0.9rem;
}

.overview-table > thead > tr > th,
.overview-table > tbody > tr > th,
.overview-table > tbody > tr > td {
  border-bottom: 1px solid var(--border);
  padding: 6px 10px;
  text-align: left;
  vertical-align: top;
}

.overview-table > thead > tr > th + th,
.overview-table > tbody > tr > td + td {
  border-left: 1px solid var(--border);
}

.overview-table > tbody > tr:last-child > td {
  border-bottom: none;
}

/* The child combinators matter: a case opened in a row holds tables of its own (steps, test data) whose heads must not stick to the page */
.overview-table > thead > tr > th {
  position: sticky;
  top: calc(var(--stick-top) + var(--sticky-h));
  z-index: 9;
  background: var(--bg-subtle);
  border-top: 1px solid var(--border);
}

.scope-table > thead > tr > th {
  top: calc(var(--stick-top) + var(--filter-h));
}

.overview-row {
  cursor: pointer;
}

.overview-row:hover {
  background: var(--bg-subtle);
}

.overview-id {
  white-space: nowrap;
}

.overview-name {
  min-width: 12rem;
}

.overview-status {
  max-width: 9rem;
}

.overview-nowrap {
  white-space: nowrap;
}

.section-index {
  margin: 0 0 16px;
}

/* A filled row rather than reduced opacity, so struck-off cases stay as legible as active ones */
.row-inactive td {
  background: var(--inactive-bg);
}

.status-lozenge {
  display: inline-block;
  padding: 1px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--fg-muted);
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.scope-table {
  margin-bottom: 24px;
}

.filter-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: 12px;
}

.filter-count {
  color: var(--fg-muted);
  font-size: 0.85rem;
  white-space: nowrap;
}


.scope-link {
  font-size: 0.8rem;
  color: var(--accent);
  text-decoration: none;
  white-space: nowrap;
}

.scope-link:hover {
  text-decoration: underline;
}

/* A heading row ahead of each section: it names where the rows below sit, in place of the
   hierarchy columns the table used to repeat on every row */
.scope-table .scope-group th {
  padding: 6px 10px;
  background: var(--bg-subtle);
  color: var(--fg-muted);
  font-size: 0.8rem;
  font-weight: 600;
  text-align: left;
}

.scope-table .scope-group a {
  color: inherit;
  text-decoration: none;
}

.scope-table .scope-group a:hover {
  color: var(--accent);
  text-decoration: underline;
}

/*
 * The suite page's main column is what is left after the sidebar and the guide panel, so the table
 * switches layout on the wrap's own width, not the viewport's. Horizontal scroll was rejected: it
 * would make the wrap the scroll container, so the filter bar and thead would stop sticking to the
 * page, and it would add a nested scroller. Same breakpoint as .cards, so both change together.
 */
.scope-table-wrap { container: scope-table / inline-size; }

/* The actions beside the filter input shrink to icons before the input is squeezed */
@container scope-table (max-width: 760px) {
  .filter-actions { gap: 8px; margin-left: 8px; }
  /* The filter bar has a fixed height and cannot wrap, so the run count gives way to the input */
  .run-progress-text { display: none; }
  .filter-actions .scope-link { display: none; }
  .filter-actions .copy-btn > span:last-child {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
}

@container scope-table (max-width: 600px) {
  .scope-table:not(.plan-table) { --scope-thead-h: 0px; }
  .scope-table,
  .scope-table > tbody,
  .scope-table > tbody > tr,
  .scope-table > tbody > tr > td,
  .scope-table > tbody > tr > th { display: block; }
  /* Kept for assistive technology, hidden visually */
  .scope-table { border-top: 1px solid var(--border); }
  .scope-table > thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .scope-table .overview-row {
    display: grid;
    grid-template-columns: max-content auto auto 1fr;
    grid-template-areas: "id name name name" "id status method tags";
    column-gap: 10px;
    row-gap: 2px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
  }
  .scope-table > tbody > tr:last-child { border-bottom: none; }
  .scope-table .overview-row > td { padding: 0; border: 0; }
  .scope-table .overview-id { grid-area: id; }
  .scope-table .overview-name { grid-area: name; min-width: 0; }
  .scope-table .overview-status { grid-area: status; max-width: none; }
  .scope-table .overview-method { grid-area: method; font-size: 0.8rem; color: var(--fg-muted); }
  .scope-table .overview-method::before { content: attr(data-label) ": "; }
  .scope-table .overview-tags { grid-area: tags; }
  .scope-table .overview-row.has-result { grid-template-areas: "id name name result" "id status method tags"; }
  .scope-table .overview-result { grid-area: result; justify-self: end; }
  .plan-table .overview-row {
    grid-template-columns: max-content max-content auto auto 1fr;
    grid-template-areas: "sel id name name name" "sel id status method tags" "sel id decision reason reason";
  }
  .plan-table .plan-select-cell { grid-area: sel; }
  .plan-table .overview-decision { grid-area: decision; }
  .plan-table .overview-reason { grid-area: reason; }
  /* The row carries the inactive fill now that its cells have no box of their own */
  .scope-table .row-inactive { background: var(--inactive-bg); }
  .scope-table .row-inactive td { background: none; }
  .scope-table .scope-group th { border-bottom: 1px solid var(--border); }
}

.overview-link {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  font-weight: 600;
  color: var(--accent);
  cursor: pointer;
}

.overview-link:hover {
  text-decoration: underline;
}

.guide {
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px 20px;
  margin-bottom: 24px;
}

/*
 * Guides carry no sticky header of their own, so jumpToId's offset trick does not apply to
 * them. scroll-margin-top does the same job declaratively: clear the menu bar plus the levels
 * that stay stuck above a guide on the long page (domain, feature, test suite). A suite page's
 * guide lives in a side panel instead.
 */
.guide,
.guide h2 {
  scroll-margin-top: calc(var(--stick-top) + var(--sticky-h) * var(--guide-depth, 3));
}

/*
 * The guide docked beside the cases. Like .nav-outline it is a sticky column with its own scroll,
 * mirrored on the right; overscroll-behavior stops a flick at the end of the guide from carrying
 * on into the page of cases.
 */
.guide-panel {
  position: sticky;
  top: var(--header-h);
  flex: 0 0 var(--guide-w);
  width: var(--guide-w);
  height: calc(100vh - var(--header-h));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid var(--border);
  background: var(--bg-subtle);
  /* Above every sticky header and table head (up to 14) that the page's cases can slide under it */
  z-index: 15;
}

.guide-panel-head {
  flex: 0 0 auto;
  height: var(--sticky-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px 0 20px;
  border-bottom: 1px solid var(--border);
}

.guide-panel-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--fg-muted);
}

.guide-panel-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 12px 20px 40px;
}

.guide-panel-body:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.guide-panel .guide {
  background: none;
  border: none;
  border-radius: 0;
  padding: 0;
  margin: 0;
}

.header-btn-on,
.guide-toggle-on,
.header-btn-on:hover,
.guide-toggle-on:hover {
  background: var(--accent-bg);
  color: var(--accent);
  border-color: var(--accent);
}

/*
 * Too narrow to share the row with the cases: float over them instead of squeezing them. It starts
 * below the filter bar, whose Guide and Copy buttons sit at the right edge, exactly where it lands.
 */
@media (max-width: 1100px) {
  .guide-panel {
    position: fixed;
    top: calc(var(--header-h) + var(--filter-h));
    right: 0;
    bottom: 0;
    width: min(var(--guide-w), 90vw);
    height: auto;
    z-index: 50;
    box-shadow: -8px 0 24px var(--overlay);
  }
}

@media print {
  .guide-panel,
  .nav-outline,
  .filter-bar,
  .app-header-actions,
  .app-header-lead .header-btn,
  .test-case-actions {
    display: none;
  }

  .sticky-header {
    position: static;
  }

  .test-case,
  .steps-table tr {
    break-inside: avoid;
  }
}

.guide-summary {
  cursor: pointer;
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--fg-muted);
  list-style-position: outside;
}

.guide-summary:hover {
  color: var(--fg);
}

.guide[open] .guide-summary {
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.guide h2 { font-size: 1.2rem; }
.guide h3 { font-size: 1.05rem; }
.guide-body > :first-child { margin-top: 0; }
.guide-body > :last-child { margin-bottom: 0; }

.guide table {
  border-collapse: collapse;
  width: 100%;
  margin: 12px 0;
  font-size: 0.9rem;
}

.guide th,
.guide td {
  border: 1px solid var(--border);
  padding: 6px 10px;
  text-align: left;
}

.guide th {
  background: var(--bg-hover);
}

.guide code {
  background: var(--bg-hover);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 0.9em;
}

.guide pre {
  background: var(--bg-hover);
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
}

.guide pre code {
  background: none;
  padding: 0;
}

.guide ul, .guide ol {
  padding-left: 24px;
}

.category-section {
  margin-bottom: 32px;
}

.category-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.category-header h3 {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-header-right {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
}

.category-header .count {
  color: var(--fg-muted);
  font-weight: normal;
  font-size: 0.85rem;
  white-space: nowrap;
}

.copy-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--border);
  background: var(--bg-subtle);
  border-radius: 6px;
  padding: 5px 10px;
  cursor: pointer;
  font-size: 0.8rem;
  color: var(--fg-muted);
  white-space: nowrap;
}

.copy-btn:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.copy-btn-copied {
  color: var(--success);
}

/*
 * A test case: a header band (sticky, so the ID stays in view while stepping through a long case)
 * over a body. The band is opaque because it repaints over the body scrolling beneath it, and the
 * card itself has no padding so the band can reach its edges.
 */
.test-case {
  border: 1px solid var(--border);
  border-radius: 6px;
  margin-bottom: 16px;
  background: var(--bg);
}

.test-case-head {
  /* .sticky-header assumes it sits in .app's padding; here it fills the card instead */
  margin: 0;
  padding: 0 8px 0 16px;
  gap: 10px;
  background: var(--bg-subtle);
  border-bottom: 1px solid var(--border);
  border-radius: 6px 6px 0 0;
}

.test-case-id {
  flex: 0 0 auto;
  font: 600 0.8rem ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--fg-muted);
  white-space: nowrap;
}

.test-case-name {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.test-case-badges,
.test-case-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
}

.test-case-actions { gap: 2px; }

.icon-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid transparent;
  background: none;
  border-radius: 6px;
  padding: 5px 7px;
  font: inherit;
  font-size: 0.8rem;
  color: var(--fg-muted);
  text-decoration: none;
  cursor: pointer;
}

.icon-btn:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.icon-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.icon-btn.copy-btn-copied { color: var(--success); }

.test-case-body {
  display: grid;
  gap: 14px;
  padding: 14px 16px 16px;
}

.test-case-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  font-size: 0.8rem;
  color: var(--fg-muted);
}

/* Spelled out rather than left to a tooltip, which touch and keyboard readers never see */
.inactive-note { color: var(--fg-muted); }

.eyebrow {
  margin: 0 0 4px;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--fg-muted);
}

/* auto-fit rather than a media query: the card's width follows the sidebar and guide panel, not the window */
.test-case-setup {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  gap: 10px 24px;
  font-size: 0.9rem;
}

.preconditions ul {
  margin: 0;
  padding-left: 1.2em;
}

.test-data-body { font-size: 0.85rem; }
.test-data-body > :first-child { margin-top: 0; }
.test-data-body > :last-child { margin-bottom: 0; }
.test-data-body ul { margin: 0; padding-left: 1.2em; }
.test-data-body table { display: block; overflow-x: auto; border-collapse: collapse; margin: 4px 0; }
.test-data-body th,
.test-data-body td { border: 1px solid var(--border); padding: 3px 10px; text-align: left; }
.test-data-body th { background: var(--bg-subtle); }
/*
 * The icon is a mask so the generated HTML needs no markup inside the button, and it takes the text
 * color. The mask is a variable so the confirmation can swap the glyph for a check, as the other
 * copy buttons do, rather than only recolouring a small icon.
 */
.td-copy {
  --td-copy-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='9' y='9' width='13' height='13' rx='2'/%3E%3Cpath d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'/%3E%3C/svg%3E");
  display: inline-block;
  width: 16px;
  height: 16px;
  margin: 0 0 -3px 6px;
  padding: 0;
  border: none;
  background-color: var(--fg-muted);
  -webkit-mask: var(--td-copy-icon) center / contain no-repeat;
  mask: var(--td-copy-icon) center / contain no-repeat;
  cursor: pointer;
}
.td-val:hover > .td-copy,
.td-copy:focus-visible { background-color: var(--fg); }
.td-copy:hover { background-color: var(--accent); }
.td-copy.td-copy-done,
.td-val:hover > .td-copy.td-copy-done {
  --td-copy-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E");
  background-color: var(--success);
}

.test-data-body code { font: 0.85em ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--bg-hover); padding: 1px 5px; border-radius: 4px; }

/* Fixed layout so every case's table shares the same column edges as they stack down the page;
   with auto layout each table sized itself to its own content, and the grid jumped between cases */
.steps-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.steps-table .col-step-no { width: 2.5rem; }
.steps-table .col-step-action { width: 45%; }

.steps-table th,
.steps-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
  overflow-wrap: break-word;
}

.steps-table thead th {
  border-bottom: 2px solid var(--border);
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--fg-muted);
}

.steps-table tbody tr.step-even > * { background: var(--bg-subtle); }

.steps-table .step-no {
  text-align: right;
  font-size: 0.8rem;
  font-weight: 400;
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.step-expected { border-left: 1px solid var(--border); }

/* Rendered Markdown in narrow cells: block margins would pad every cell, and the default list indent wastes width */
.step-cell > :first-child { margin-top: 0; }
.step-cell > :last-child { margin-bottom: 0; }
.step-cell p { margin: 0 0 6px; }
.step-cell ul, .step-cell ol { margin: 0 0 6px; padding-left: 1.3em; }
.step-cell code { font: 0.85em ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--bg-hover); padding: 1px 5px; border-radius: 4px; }
.step-cell pre { overflow-x: auto; margin: 6px 0; padding: 8px; background: var(--bg-hover); border-radius: 4px; font-size: 0.85em; }
.step-cell pre code { background: none; padding: 0; }
.step-cell table { display: block; overflow-x: auto; border-collapse: collapse; margin: 6px 0; font-size: 0.85em; }
.step-cell table th, .step-cell table td { border: 1px solid var(--border); padding: 3px 8px; }
.step-cell img { max-width: 100%; }

/*
 * Narrow cards stack Expected under Action. Keyed to the cards' own width rather than the
 * viewport, because the sidebar and the guide panel decide how much room the cards get.
 */
.cards { container: cards / inline-size; }

@container cards (max-width: 600px) {
  .steps-table,
  .steps-table tbody,
  .steps-table tr,
  .steps-table td,
  .steps-table th { display: block; }
  /* Kept for assistive technology, hidden visually */
  .steps-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .steps-table tr {
    display: grid;
    grid-template-columns: 2.2rem 1fr;
    grid-template-areas: "no action" "no expected";
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }
  .steps-table tbody tr.step-even { background: var(--bg-subtle); }
  .steps-table tr > * { padding: 0 8px; border: 0; background: none !important; }
  .steps-table.steps-run tr.step-row {
    grid-template-areas: "no action" "no expected" "no result";
  }
  .steps-table tr.step-note-row { display: block; padding: 0 8px 8px; }
  .steps-table tr.step-note-row > td { padding: 0; }
  .steps-table tbody tr.step-current { background: var(--accent-bg); }
  .steps-table tbody tr.step-current > :first-child { box-shadow: none; }
  .steps-table .step-result { grid-area: result; padding-top: 6px; }
  .steps-table .step-result-group { display: flex; gap: 8px; }
  .steps-table .result-btn { flex: 1; height: 40px; }
  .steps-table .step-no { grid-area: no; }
  .steps-table .step-action { grid-area: action; font-weight: 600; }
  .steps-table .step-expected { grid-area: expected; padding-top: 4px; }
  .steps-table .step-expected::before {
    content: attr(data-label);
    display: block;
    font-size: 0.68rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-muted);
  }
  .test-case-badges { display: none; }
}

/*
 * Run mode: a Result column of two real buttons (32px tall, against a 13px checkbox), finished
 * steps muted, the first unmarked step marked as where to go next, a failed step flagged on its
 * edge and followed by a row for what the tester saw.
 */
.steps-table .col-step-result { width: 9rem; }
/* "不合格" is wider than "Fail"; the column is fixed-width, so a language with longer labels asks for more */
:lang(ja) .steps-table .col-step-result { width: 11.5rem; }
.steps-table.steps-run .col-step-action { width: 38%; }
.steps-table .step-result { vertical-align: top; }
.steps-table .step-result-group { display: flex; gap: 4px; }

.result-btn {
  flex: 1 1 0;
  white-space: nowrap;
  min-width: 3.5rem;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg-muted);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.result-btn:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.result-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.result-btn-pass[aria-pressed="true"],
.result-btn-pass[aria-pressed="true"]:hover {
  background: var(--success-bg);
  border-color: var(--success);
  color: var(--success);
}

.result-btn-fail[aria-pressed="true"],
.result-btn-fail[aria-pressed="true"]:hover {
  background: var(--danger-bg);
  border-color: var(--danger);
  color: var(--danger);
}

.steps-table .step-done > :not(.step-result) { color: var(--fg-muted); }
.steps-table tbody tr.step-current > * { background: var(--accent-bg); }
.steps-table tbody tr.step-current > :first-child { box-shadow: inset 3px 0 0 var(--accent); }
.steps-table tbody tr.step-failed > :first-child { box-shadow: inset 3px 0 0 var(--danger); }

.steps-table .step-note-row > td { background: var(--danger-bg); }
.steps-table .step-note-row.step-even > td { background: var(--danger-bg); }

.step-note-box { display: grid; gap: 6px; }

.step-note {
  width: 100%;
  min-height: 3.2rem;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
  font: inherit;
  font-size: 0.85rem;
  line-height: 1.45;
  resize: vertical;
}

.step-note:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}

.step-note-tools {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.75rem;
  color: var(--fg-muted);
}

.link-btn-off { opacity: 0.5; cursor: default; }

.step-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.step-image { position: relative; }

.step-images img {
  display: block;
  max-width: 14rem;
  max-height: 9rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
}

.image-open {
  display: block;
  padding: 0;
  border: 0;
  background: none;
  cursor: zoom-in;
}

.lightbox {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px;
  background: var(--overlay);
}

/* The controls sit on the image's own top edge rather than the window's corner, where they
   would be a long way from what is being looked at */
.lightbox-frame {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.lightbox-bar {
  display: flex;
  align-items: center;
  gap: 10px;
}

.lightbox-count { margin-right: auto; }

.lightbox-count {
  padding: 4px 10px;
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg-muted);
  font-size: 0.8rem;
}

.lightbox-stage {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 0;
  max-width: 100%;
}

.lightbox-nav {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--bg);
  color: var(--fg);
  font-size: 1.6rem;
  line-height: 1;
  cursor: pointer;
}

.lightbox-nav:disabled { opacity: 0.35; cursor: default; }
.lightbox-nav:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.lightbox-link {
  padding: 4px 10px;
  border-radius: 6px;
  background: var(--bg);
  color: var(--accent);
  font-size: 0.8rem;
  text-decoration: none;
}

.lightbox-close {
  width: 32px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--bg);
  color: var(--fg);
  font-size: 0.9rem;
  cursor: pointer;
}

.lightbox-close:focus-visible,
.lightbox-link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.lightbox-image {
  max-width: calc(100vw - 150px);
  max-height: calc(100vh - 100px);
  object-fit: contain;
  border-radius: 4px;
  background: var(--bg);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  cursor: default;
}

.image-tools {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  gap: 4px;
}

.image-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--bg);
  color: var(--fg-muted);
  font-size: 0.7rem;
  line-height: 1;
  cursor: pointer;
}

.image-tool:hover { color: var(--accent); border-color: var(--accent); }
.image-tool-remove:hover { color: var(--danger); border-color: var(--danger); }
.image-tool-done { color: var(--success); border-color: var(--success); }

.run-status {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  white-space: nowrap;
}

.overview-result { white-space: nowrap; }

.run-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}


.icon-btn:disabled {
  opacity: 0.35;
  cursor: default;
  background: none;
}

.run-chip {
  padding: 1px 8px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-hover);
  color: var(--fg-muted);
  font-size: 0.7rem;
  font-weight: 700;
}

.run-chip-pass {
  background: var(--success-bg);
  border-color: var(--success);
  color: var(--success);
}

.run-chip-fail {
  background: var(--danger-bg);
  border-color: var(--danger);
  color: var(--danger);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

/* A caveat for whoever runs the case, so it gets a callout rather than muted small print. Amber,
   not the accent blue: run mode marks the current step with a blue edge, and the two must not read alike */
.notes {
  padding: 8px 12px;
  border-left: 3px solid var(--warn);
  border-radius: 0 4px 4px 0;
  background: var(--bg-subtle);
  font-size: 0.875rem;
}

.notes .eyebrow { margin-bottom: 2px; color: var(--warn); }
.notes-body { min-width: 0; }
.notes-body > :first-child { margin-top: 0; }
.notes-body > :last-child { margin-bottom: 0; }
.notes-body p { margin: 0 0 8px; }
.notes-body ul, .notes-body ol { margin: 0 0 8px; padding-left: 1.3em; }
.notes-body code { font: 0.85em ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--bg-hover); padding: 1px 5px; border-radius: 4px; }
.notes-body pre { overflow-x: auto; margin: 8px 0; padding: 8px; background: var(--bg-hover); border-radius: 4px; font-size: 0.85em; }
.notes-body pre code { background: none; padding: 0; }
.notes-body table { display: block; overflow-x: auto; border-collapse: collapse; margin: 8px 0; font-size: 0.85rem; }
.notes-body th, .notes-body td { border: 1px solid var(--border); padding: 4px 10px; text-align: left; }
.notes-body th { background: var(--bg-hover); }
.notes-body blockquote { margin: 8px 0; padding: 0 12px; border-left: 3px solid var(--border); color: var(--fg-muted); }

/* A filled band rather than a faded card, so an inactive case's steps stay as legible as an active one's */
.test-case-inactive .test-case-head { background: var(--inactive-bg); }
.test-case-inactive .test-case-name { color: var(--fg-muted); text-decoration: line-through; }

.badge {
  display: inline-block;
  padding: 1px 8px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-hover);
  color: var(--fg-muted);
  font-size: 0.7rem;
  font-weight: 600;
  white-space: nowrap;
}

.badge-skip {
  background: var(--warn-bg);
  color: var(--warn);
  border-color: var(--warn);
}

.badge-automation {
  background: var(--accent-bg);
  color: var(--accent);
  border-color: transparent;
  cursor: help;
}

/* Flex with a gap, not a margin on the next chip: when the chips wrap onto a second line a margin would leave no space between the lines */
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
}

.tag-chip {
  padding: 1px 8px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-hover);
  color: var(--fg-muted);
  font: inherit;
  font-size: 0.7rem;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}

.tag-chip:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.legacy-marker {
  font-size: 0.8rem;
  color: var(--fg-faint);
  font-family: monospace;
}

/* Command palette (Cmd+K / Ctrl+K) */

.palette-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  z-index: 1100;
  display: flex;
  justify-content: center;
  padding-top: 12vh;
}

.palette {
  width: min(40rem, 92vw);
  max-height: 70vh;
  background: var(--bg);
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.palette-input {
  border: none;
  border-bottom: 1px solid var(--border);
  padding: 14px 16px;
  font-size: 1rem;
  outline: none;
  background: var(--bg);
  color: var(--fg);
}

.palette-results {
  list-style: none;
  margin: 0;
  padding: 8px;
  overflow-y: auto;
}

.palette-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  border: none;
  background: none;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 0.9rem;
  cursor: pointer;
  color: var(--fg);
}

.palette-item.palette-sel {
  background: var(--accent-bg);
  color: var(--accent);
}

.palette-item .count {
  color: var(--fg-muted);
  font-weight: normal;
}

/* The same tint as a jump target's flash: both say "this is what you were looking for" */
.hit {
  padding: 0 1px;
  border-radius: 2px;
  background: var(--flash);
  color: inherit;
}

.palette-kind-badge {
  flex: 0 0 auto;
  font-size: 0.7rem;
  padding: 1px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-subtle);
  color: var(--fg-muted);
  white-space: nowrap;
}

/* The row's own highlight is a pale tint, so the badge needs its outline (and the page background) to stay a distinct shape */
.palette-item.palette-sel .palette-kind-badge {
  background: var(--bg);
  color: var(--fg);
}

.palette-item-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.palette-breadcrumb {
  font-size: 0.72rem;
  color: var(--fg-muted);
}

.palette-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Temporary highlight when landing on a jump target */
@keyframes jump-flash {
  0% { background: var(--flash); }
  100% { background: transparent; }
}

.jump-flash {
  animation: jump-flash 1.2s ease-out;
}

/* A sticky header is painted with --bg, so it must fade back to that rather than to nothing */
@keyframes jump-flash-header {
  0% { background: var(--flash); }
  100% { background: var(--bg); }
}

.sticky-header.jump-flash {
  animation-name: jump-flash-header;
}
`;
