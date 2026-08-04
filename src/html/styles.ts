/**
 * Interpolated into two rules below — the explicit opt-in and the OS-preference fallback.
 * Kept as one constant so the two copies cannot drift apart.
 */
const DARK_THEME_VARS = `
  --fg: #e6edf3;
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
  --header-h: 48px;
  --sticky-h: 44px;
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

.app-header-title {
  font-size: 0.95rem;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

.nav-outline {
  position: sticky;
  top: var(--header-h);
  flex: 0 0 240px;
  width: 240px;
  height: calc(100vh - var(--header-h));
  overflow-y: auto;
  border-right: 1px solid var(--border);
  padding: 20px 12px;
  background: var(--bg-subtle);
}

.view-toggle {
  display: flex;
  gap: 3px;
  margin-bottom: 14px;
  padding: 3px;
  background: var(--bg-hover);
  border-radius: 6px;
}

.view-toggle-btn {
  flex: 1;
  border: none;
  background: none;
  padding: 5px 8px;
  border-radius: 4px;
  font-size: 0.8rem;
  font-family: inherit;
  cursor: pointer;
  color: var(--fg-muted);
}

.view-toggle-btn:hover {
  color: var(--fg);
}

.view-toggle-btn.view-toggle-active {
  background: var(--bg);
  color: var(--accent);
  font-weight: 600;
}

.nav-outline-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0 8px 8px;
}

.nav-search {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px;
  margin-bottom: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.85rem;
  background: var(--bg);
  color: var(--fg);
}

.nav-search:focus {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
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
}

.nav-outline-item {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: none;
  padding: 6px 8px;
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

.nav-outline-item .count {
  color: var(--fg-muted);
  font-weight: normal;
}

.nav-outline-domain {
  margin-top: 16px;
}

.nav-outline-domain:first-child {
  margin-top: 0;
}

.nav-outline-domain .nav-outline-item {
  font-weight: 800;
  font-size: 0.95rem;
}

.nav-outline-feature {
  margin-top: 8px;
}

.nav-outline-feature .nav-outline-item {
  padding-left: 12px;
  font-weight: 700;
  font-size: 0.9rem;
}

.nav-outline-suite .nav-outline-item {
  padding-left: 24px;
  font-weight: 600;
  font-size: 0.85rem;
}

.nav-outline-guide .nav-outline-item {
  padding-left: 36px;
  font-style: italic;
  color: var(--fg-muted);
}

.nav-outline-category .nav-outline-item {
  padding-left: 36px;
  font-weight: 600;
}

.nav-outline-testcase .nav-outline-item {
  padding-left: 48px;
  font-size: 0.8rem;
  color: var(--fg-muted);
}

.app {
  flex: 1;
  min-width: 0;
  padding: 24px 32px 80px;
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

.sticky-level-0 { top: calc(var(--header-h) + var(--sticky-h) * 0); z-index: 14; }
.sticky-level-1 { top: calc(var(--header-h) + var(--sticky-h) * 1); z-index: 13; }
.sticky-level-2 { top: calc(var(--header-h) + var(--sticky-h) * 2); z-index: 12; }
.sticky-level-3 { top: calc(var(--header-h) + var(--sticky-h) * 3); z-index: 11; }
.sticky-level-4 { top: calc(var(--header-h) + var(--sticky-h) * 4); z-index: 10; }

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

.overview-title {
  font-size: 1.6rem;
  border-bottom: 4px solid var(--accent);
  margin: 0 0 24px;
  padding-left: 0;
  padding-right: 0;
  justify-content: space-between;
  gap: 12px;
}

.overview-search {
  width: 100%;
  padding: 8px 12px;
  margin-bottom: 16px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.9rem;
  background: var(--bg);
  color: var(--fg);
}

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
  font-size: 0.9rem;
}

.overview-table th,
.overview-table td {
  border-bottom: 1px solid var(--border);
  padding: 6px 10px;
  text-align: left;
  vertical-align: top;
}

.overview-table th + th,
.overview-table td + td {
  border-left: 1px solid var(--border);
}

.overview-table tbody tr:last-child td {
  border-bottom: none;
}

.overview-table thead th {
  position: sticky;
  top: calc(var(--header-h) + var(--sticky-h));
  z-index: 9;
  background: var(--bg-subtle);
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

.overview-hier {
  white-space: nowrap;
}

/* Repeated hierarchy values are kept (not merged) so each row reads standalone, but dimmed
   far enough that the eye still picks out where a group starts */
.overview-repeat {
  color: var(--fg-faint);
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
  padding: 16px 20px;
  margin-bottom: 24px;
}

.guide h2 { font-size: 1.2rem; }
.guide h3 { font-size: 1.05rem; }

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

.test-case {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 16px;
  margin-bottom: 16px;
  /* Establishes the positioning context so .test-case-title's sticky header can paint its own background */
  position: relative;
}

.test-case-title {
  /* Cancels against .test-case's 16px padding, not .sticky-header's generic 32px */
  margin-left: -16px;
  margin-right: -16px;
  margin-bottom: 12px;
  padding-left: 16px;
  padding-right: 16px;
  font-size: 1rem;
  border-radius: 6px 6px 0 0;
}

.preconditions {
  margin-bottom: 12px;
  font-size: 0.9rem;
}

.preconditions ul {
  margin: 4px 0 0;
  padding-left: 20px;
}

.steps-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.steps-table th,
.steps-table td {
  border: 1px solid var(--border);
  padding: 8px;
  text-align: left;
  vertical-align: top;
}

.steps-table th {
  background: var(--bg-subtle);
}

.notes {
  margin-top: 12px;
  font-size: 0.85rem;
  color: var(--fg-muted);
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

.palette-kind-badge {
  flex: 0 0 auto;
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-subtle);
  color: var(--fg-muted);
  white-space: nowrap;
}

.palette-item.palette-sel .palette-kind-badge {
  background: var(--bg);
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
`;
