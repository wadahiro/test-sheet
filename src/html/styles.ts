export const STYLES = `
:root {
  color-scheme: light dark;
  --border: #d0d7de;
  --bg-subtle: #f6f8fa;
  --accent: #0969da;
  --sticky-h: 44px;
}

* { box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", sans-serif;
  line-height: 1.6;
  margin: 0;
  padding: 0;
  color: #1f2328;
}

.layout {
  display: flex;
  align-items: flex-start;
}

.nav-outline {
  position: sticky;
  top: 0;
  flex: 0 0 240px;
  width: 240px;
  height: 100vh;
  overflow-y: auto;
  border-right: 1px solid var(--border);
  padding: 20px 12px;
  background: var(--bg-subtle);
}

.nav-outline-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: #57606a;
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
}

.nav-search:focus {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}

.nav-empty {
  color: #57606a;
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
  color: #1f2328;
}

.nav-outline-item:hover {
  background: #eaeef2;
}

.nav-outline-item.nav-outline-current {
  background: #ddebfa;
  color: var(--accent);
  font-weight: 600;
}

.nav-outline-item .count {
  color: #57606a;
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
  color: #57606a;
}

.nav-outline-category .nav-outline-item {
  padding-left: 36px;
  font-weight: 600;
}

.nav-outline-testcase .nav-outline-item {
  padding-left: 48px;
  font-size: 0.8rem;
  color: #57606a;
}

.app {
  flex: 1;
  min-width: 0;
  padding: 24px 32px 80px;
}

/*
 * Stacked sticky headers for the hierarchy (domain -> feature -> test suite -> section).
 * Each level shares the same height (--sticky-h); top is offset by the level index so
 * headers stack instead of overlapping.
 * .app's left/right padding would otherwise show through, so sticky-header cancels it
 * out itself and paints its own background.
 */
.sticky-header {
  position: sticky;
  z-index: 10;
  height: var(--sticky-h);
  display: flex;
  align-items: center;
  background: Canvas;
  margin-left: -32px;
  margin-right: -32px;
  padding-left: 32px;
  padding-right: 32px;
}

.sticky-level-0 { top: calc(var(--sticky-h) * 0); z-index: 14; }
.sticky-level-1 { top: calc(var(--sticky-h) * 1); z-index: 13; }
.sticky-level-2 { top: calc(var(--sticky-h) * 2); z-index: 12; }
.sticky-level-3 { top: calc(var(--sticky-h) * 3); z-index: 11; }
.sticky-level-4 { top: calc(var(--sticky-h) * 4); z-index: 10; }

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
  color: #57606a;
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
  color: #57606a;
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
  color: #57606a;
  padding: 24px;
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
  background: #eaeef2;
}

.guide code {
  background: #eaeef2;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 0.9em;
}

.guide pre {
  background: #eaeef2;
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
  color: #57606a;
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
  color: #57606a;
  white-space: nowrap;
}

.copy-btn:hover {
  background: #eaeef2;
  color: #1f2328;
}

.copy-btn-copied {
  color: #1a7f37;
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
  color: #57606a;
}

/* Command palette (Cmd+K / Ctrl+K) */

.palette-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  z-index: 1100;
  display: flex;
  justify-content: center;
  padding-top: 12vh;
}

.palette {
  width: min(40rem, 92vw);
  max-height: 70vh;
  background: Canvas;
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
  color: #1f2328;
}

.palette-item.palette-sel {
  background: #ddebfa;
  color: var(--accent);
}

.palette-item .count {
  color: #57606a;
  font-weight: normal;
}

.palette-kind-badge {
  flex: 0 0 auto;
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-subtle);
  color: #57606a;
  white-space: nowrap;
}

.palette-item.palette-sel .palette-kind-badge {
  background: rgba(255, 255, 255, 0.6);
}

.palette-item-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.palette-breadcrumb {
  font-size: 0.72rem;
  color: #57606a;
}

.palette-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Temporary highlight when landing on a jump target */
@keyframes jump-flash {
  0% { background: #fff2ba; }
  100% { background: transparent; }
}

.jump-flash {
  animation: jump-flash 1.2s ease-out;
}
`;
