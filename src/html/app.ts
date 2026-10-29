// Browser-side UI (Preact + htm). Bundled by src/html/generate.ts via Bun.build()
// and inlined into the generated HTML.

import { h, render, createContext } from "preact";
import { useState, useCallback, useEffect, useRef, useContext } from "preact/hooks";
import htmBind from "htm";
import { formatPreconditions, formatTestData, preconditionText } from "./caseFormat";

const html = htmBind.bind(h);

interface Step {
  action: string;
  expected: string;
  /** Markdown-rendered at generation time; the raw fields stay for copy and search */
  actionHtml: string;
  expectedHtml: string;
}

interface Skip {
  reason: string;
  until?: string;
}

interface TestCase {
  _tcId: string;
  name: string;
  category?: string;
  test_data?: unknown;
  preconditions?: unknown[];
  steps: Step[];
  notes?: string | null;
  /** `notes` rendered as Markdown at generation time; `notes` itself stays raw for copy and search */
  notesHtml?: string;
  /** `test_data` rendered as Markdown at generation time */
  testDataHtml?: string;
  legacy_id?: string;
  status?: "active" | "obsolete" | "superseded";
  reason?: string;
  superseded_by?: string;
  legacy_marker?: string;
  skip?: Skip;
  tags?: string[];
  automation?: "manual" | "idweave" | "semi";
  scenario?: string;
}

/** status(permanent) is orthogonal to skip(temporary) — either one takes the case out of active coverage. */
function isInactive(tc: TestCase): boolean {
  return tc.status === "obsolete" || tc.status === "superseded" || tc.skip != null;
}

interface GuideHeading {
  id: string;
  text: string;
  /** Markdown of this heading's own section, so search matches guide prose, not just titles */
  body: string;
}

interface SuitePageData {
  /** Top-level directory name under the root (e.g. "web", "api"). The domain. */
  domain: string;
  /** Human-readable name from the domain's README.md heading (falls back to domain) */
  domainLabel: string;
  /** Directory name under domain (e.g. "login"). The feature. A feature can have multiple test suites. */
  feature: string;
  /** Human-readable name from the feature's README.md heading (falls back to feature) */
  featureLabel: string;
  typeName: string;
  idPrefix: string;
  testCases: TestCase[];
  guideHtml: string;
  guideHeadings: GuideHeading[];
  /** Raw Markdown of the whole guide, used only for search */
  guideText: string;
}

declare global {
  interface Window {
    __SUITES__: SuitePageData[];
    /** When true, watches for file changes over WebSocket and auto-reloads (server mode only) */
    __LIVE_RELOAD__: boolean;
  }
}

function formatStepsAsMarkdownTable(steps: Step[]): string {
  if (!steps || steps.length === 0) return "";
  const lines = ["| # | Action | Expected |", "|:---:|------|----------|"];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const action = escapeMarkdownCell(step.action || "");
    const expected = escapeMarkdownCell((step.expected || "").replace(/^(\s*)- /gm, "$1• "));
    lines.push(`| ${i + 1} | ${action} | ${expected} |`);
  }
  return lines.join("\n");
}

/**
 * Renders a single test case as Markdown (for pasting into a PR/issue comment).
 * headingLevel is threaded down from whichever level was copied, so a domain-level copy
 * still nests its sections and test cases below the domain heading.
 */
function testCaseToMarkdown(tc: TestCase, headingLevel = 3): string {
  const lines: string[] = [];
  lines.push(`${"#".repeat(headingLevel)} ${tc._tcId}`, "", `**${tc.name}**`, "");

  if (tc.preconditions && tc.preconditions.length > 0) {
    lines.push("**Preconditions:**", formatPreconditions(tc.preconditions), "");
  }

  if (tc.test_data && (Array.isArray(tc.test_data) ? tc.test_data.length > 0 : Object.keys(tc.test_data as object).length > 0)) {
    lines.push("**Test Data:**", "", formatTestData(tc.test_data), "");
  }

  if (tc.tags && tc.tags.length > 0) {
    lines.push(`**Tags:** ${tc.tags.join(", ")}`, "");
  }

  lines.push("**Steps:**", "", formatStepsAsMarkdownTable(tc.steps), "");

  if (tc.notes) {
    const notesLines = tc.notes.split("\n");
    lines.push(`> **Note:** ${notesLines[0]}`);
    for (let i = 1; i < notesLines.length; i++) lines.push(`> ${notesLines[i]}`);
    lines.push("");
  }

  return lines.join("\n");
}

/** Renders every test case in a section as a single Markdown document */
function categoryToMarkdown(category: string, testCases: TestCase[], headingLevel = 2): string {
  const lines = [`${"#".repeat(headingLevel)} Section: ${category}`, ""];
  for (const tc of testCases) {
    lines.push(testCaseToMarkdown(tc, headingLevel + 1), "---", "");
  }
  return lines.join("\n");
}

function allTestCasesToMarkdown(suite: SuitePageData, headingLevel = 1): string {
  const grouped = groupByCategory(suite.testCases);
  const lines = [
    `${"#".repeat(headingLevel)} ${suite.idPrefix}: ${suite.typeName} Test Procedure`,
    "",
    `> ${suite.testCases.length} test case(s)`,
    "",
  ];
  for (const [category, cases] of grouped) {
    lines.push(categoryToMarkdown(category, cases, headingLevel + 1));
  }
  return lines.join("\n");
}

function CopyButton({ getText, title, iconOnly = false }: { getText: () => string; title: string; iconOnly?: boolean }) {
  const [copied, setCopied] = useState(false);

  const onClick = useCallback(() => {
    navigator.clipboard.writeText(getText()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [getText]);

  return html`
    <button
      class=${(iconOnly ? "icon-btn" : "copy-btn") + (copied ? " copy-btn-copied" : "")}
      title=${title}
      aria-label=${title}
      onClick=${onClick}
    >
      ${copied
        ? html`<span>✓</span>`
        : html`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>`}
      ${iconOnly ? null : html`<span>${copied ? "Copied" : "Copy"}</span>`}
    </button>
  `;
}

/** Whether cards show a checklist column; shared by context so it need not be threaded through every list */
const ChecklistContext = createContext(false);

interface StoredChecklist {
  /** Hash of the steps' text, so a case edited since is not shown half-ticked for steps that changed */
  h: string;
  done: number[];
}

function stepsFingerprint(steps: Step[]): string {
  let hash = 5381;
  for (const step of steps) {
    for (const ch of `${step.action}\u0000${step.expected}\u0001`) hash = ((hash << 5) + hash + ch.charCodeAt(0)) | 0;
  }
  return String(hash);
}

function checklistKey(tc: TestCase): string {
  return `test-sheet-checklist:${tc._tcId}`;
}

function readChecklist(tc: TestCase): Set<number> {
  try {
    const raw = localStorage.getItem(checklistKey(tc));
    if (!raw) return new Set();
    const stored = JSON.parse(raw) as StoredChecklist;
    return stored.h === stepsFingerprint(tc.steps) ? new Set(stored.done) : new Set();
  } catch {
    return new Set();
  }
}

function writeChecklist(tc: TestCase, done: Set<number>) {
  try {
    if (done.size === 0) localStorage.removeItem(checklistKey(tc));
    else localStorage.setItem(checklistKey(tc), JSON.stringify({ h: stepsFingerprint(tc.steps), done: [...done] } satisfies StoredChecklist));
  } catch {
    // Blocked storage (e.g. over file://): the ticks last for this visit only
  }
}

interface Checklist {
  done: Set<number>;
  /** The first step not yet ticked, or -1 when all are */
  current: number;
  toggle: (index: number) => void;
  reset: () => void;
}

function useChecklist(tc: TestCase, enabled: boolean): Checklist | null {
  const [done, setDone] = useState<Set<number>>(() => (enabled ? readChecklist(tc) : new Set()));

  useEffect(() => {
    if (enabled) setDone(readChecklist(tc));
  }, [enabled, tc._tcId]);

  if (!enabled) return null;

  const update = (next: Set<number>) => {
    setDone(next);
    writeChecklist(tc, next);
  };
  let current = tc.steps.findIndex((_, i) => !done.has(i));
  if (tc.steps.length === 0) current = -1;
  return {
    done,
    current,
    toggle: (index) => {
      const next = new Set(done);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      update(next);
    },
    reset: () => update(new Set()),
  };
}

/**
 * The explicit roles keep this a table for assistive technology even when the narrow layout
 * turns its cells into blocks, which would otherwise drop the table semantics.
 */
function StepsTable({ steps, checklist }: { steps: Step[]; checklist: Checklist | null }) {
  return html`
    <table class=${"steps-table" + (checklist ? " steps-checklist" : "")} role="table">
      <colgroup>
        ${checklist ? html`<col class="col-step-check" />` : null}
        <col class="col-step-no" />
        <col class="col-step-action" />
        <col />
      </colgroup>
      <thead role="rowgroup">
        <tr role="row">
          ${checklist ? html`<th role="columnheader" class="step-check"><span class="visually-hidden">Done</span></th>` : null}
          <th role="columnheader" class="step-no">#</th>
          <th role="columnheader">Action</th>
          <th role="columnheader">Expected</th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        ${steps.map((step, i) => {
          const done = checklist?.done.has(i) ?? false;
          const current = checklist?.current === i;
          return html`
            <tr key=${i} role="row" class=${(done ? "step-done " : "") + (current ? "step-current" : "")}>
              ${checklist
                ? html`<td role="cell" class="step-check">
                    <input type="checkbox" checked=${done} aria-label=${`Step ${i + 1} done`} onChange=${() => checklist.toggle(i)} />
                  </td>`
                : null}
              <th role="rowheader" scope="row" class="step-no">${i + 1}</th>
              <td role="cell" class="step-cell step-action" dangerouslySetInnerHTML=${{ __html: step.actionHtml }} />
              <td role="cell" class="step-cell step-expected" dangerouslySetInnerHTML=${{ __html: step.expectedHtml }} />
            </tr>
          `;
        })}
      </tbody>
    </table>
  `;
}

/** Why a case is out of active coverage, spelled out; null for an active case */
function inactiveNote(tc: TestCase): string | null {
  const reason = tc.reason ?? tc.skip?.reason;
  if (tc.status === "obsolete") return `Obsolete${reason ? `: ${reason}` : ""}`;
  if (tc.status === "superseded") {
    return `Superseded${tc.superseded_by ? ` by ${tc.superseded_by}` : ""}${reason ? `: ${reason}` : ""}`;
  }
  if (tc.skip) return `Skipped${tc.skip.until ? ` until ${tc.skip.until}` : ""}: ${tc.skip.reason}`;
  return null;
}

/** `level` is the card header's position in the stack of sticky headers above it */
function TestCaseCard({ tc, level }: { tc: TestCase; level: number }) {
  const checklist = useChecklist(tc, useContext(ChecklistContext));
  const inactive = isInactive(tc);
  const note = inactiveNote(tc);
  const hasMeta = !!(tc.tags && tc.tags.length > 0) || !!tc.legacy_marker || !!note;
  const hasPreconditions = !!tc.preconditions && tc.preconditions.length > 0;

  return html`
    <article class=${"test-case" + (inactive ? " test-case-inactive" : "")} id=${testCaseAnchorId(tc._tcId)}>
      <header class=${`test-case-head sticky-header sticky-level-${level}`}>
        <span class="test-case-id">${tc._tcId}</span>
        <h4 class="test-case-name" title=${tc.name}>${tc.name}</h4>
        <span class="test-case-badges">
          ${tc.status === "obsolete" ? html`<span class="badge">obsolete</span>` : null}
          ${tc.status === "superseded" ? html`<span class="badge">superseded${tc.superseded_by ? ` → ${tc.superseded_by}` : ""}</span>` : null}
          ${tc.skip ? html`<span class="badge badge-skip">skip${tc.skip.until ? ` (until ${tc.skip.until})` : ""}</span>` : null}
          ${tc.automation && tc.automation !== "manual"
            ? html`<span class="badge badge-automation" title=${tc.scenario ?? ""}>${tc.automation}</span>`
            : null}
        </span>
        ${checklist && tc.steps.length > 0
          ? html`<span class="checklist-progress">
              ${checklist.done.size}/${tc.steps.length} done
              ${checklist.done.size > 0 ? html`<button class="link-btn" onClick=${checklist.reset}>Reset</button>` : null}
            </span>`
          : null}
        <span class="test-case-actions">
          <a class="icon-btn" href=${testCaseHash(tc._tcId)} title="Link to this test case" aria-label="Link to this test case">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
          </a>
          <${CopyButton} iconOnly=${true} title="Copy this test case as Markdown" getText=${() => testCaseToMarkdown(tc)} />
        </span>
      </header>
      <div class="test-case-body">
        ${hasMeta
          ? html`<div class="test-case-meta">
              ${(tc.tags ?? []).map((tag) => html`<a class="tag-chip" key=${tag} href=${overviewHash(tag)} title="Show test cases matching this tag">${tag}</a>`)}
              ${note ? html`<span class="inactive-note">${note}</span>` : null}
              ${tc.legacy_marker ? html`<span class="legacy-marker">Original marker: ${tc.legacy_marker}</span>` : null}
            </div>`
          : null}
        ${hasPreconditions || tc.testDataHtml
          ? html`<div class="test-case-setup">
              ${hasPreconditions
                ? html`<div class="preconditions">
                    <h5 class="eyebrow">Preconditions</h5>
                    <ul>${tc.preconditions!.map((p, i) => html`<li key=${i}>${preconditionText(p)}</li>`)}</ul>
                  </div>`
                : null}
              ${tc.testDataHtml
                ? html`<div class="test-data">
                    <h5 class="eyebrow">Test data</h5>
                    <div class="test-data-body" dangerouslySetInnerHTML=${{ __html: tc.testDataHtml }} />
                  </div>`
                : null}
            </div>`
          : null}
        <${StepsTable} steps=${tc.steps} checklist=${checklist} />
        ${tc.notesHtml
          ? html`<aside class="notes">
              <h5 class="eyebrow">Note</h5>
              <div class="notes-body" dangerouslySetInnerHTML=${{ __html: tc.notesHtml }} />
            </aside>`
          : null}
      </div>
    </article>
  `;
}

/** Renders a count as "active (total)" when some cases are obsolete/superseded/skipped, otherwise just the total. */
function CountLabel({ testCases }: { testCases: TestCase[] }) {
  const total = testCases.length;
  const activeCount = testCases.filter((tc) => !isInactive(tc)).length;
  return activeCount === total ? html`${total}` : html`${activeCount} <span class="count-total">(${total})</span>`;
}

/** Selecting the current target again fires no hashchange, so jump directly in that case */
function goToTestCase(tcId: string) {
  const next = testCaseHash(tcId);
  if (location.hash === next) jumpToId(testCaseAnchorId(tcId));
  else location.hash = next;
}

/** Why a case is out of active coverage, as a short label; null for an active case */
function statusLabel(tc: TestCase): string | null {
  if (tc.status === "obsolete") return "obsolete";
  if (tc.status === "superseded") return tc.superseded_by ? `superseded \u2192 ${tc.superseded_by}` : "superseded";
  if (tc.skip) return tc.skip.until ? `skip (until ${tc.skip.until})` : "skip";
  return null;
}

/** How the case is run; an unset `automation` means a person runs it by hand */
function testMethod(tc: TestCase): string {
  return tc.automation ?? "manual";
}

interface IndexRowData {
  tcId: string;
  name: string;
  status: string | null;
  statusTitle: string;
  method: string;
  tags: string[];
  inactive: boolean;
}

function indexRowData(tc: TestCase): IndexRowData {
  return {
    tcId: tc._tcId,
    name: tc.name,
    status: statusLabel(tc),
    statusTitle: tc.reason ?? tc.skip?.reason ?? "",
    method: testMethod(tc),
    tags: tc.tags ?? [],
    inactive: isInactive(tc),
  };
}

const INDEX_COLUMNS = ["ID", "Name", "Status", "Method", "Tags"];

/**
 * One case as a table row. With `onTag` a tag chip filters the table it sits in; without it the
 * chip links to the overview filtered by that tag, for tables that have no filter of their own.
 */
function IndexRow({ row, onTag }: { row: IndexRowData; onTag?: (tag: string) => void }) {
  return html`
    <tr class=${"overview-row" + (row.inactive ? " row-inactive" : "")} onClick=${() => goToTestCase(row.tcId)}>
      <td class="overview-id">
        <button
          class="overview-link"
          onClick=${(e: Event) => {
            e.stopPropagation();
            goToTestCase(row.tcId);
          }}
        >${row.tcId}</button>
      </td>
      <td class="overview-name">${row.name}</td>
      <td class="overview-status">${row.status ? html`<span class="status-lozenge" title=${row.statusTitle}>${row.status}</span>` : null}</td>
      <td class="overview-nowrap">${row.method}</td>
      <td>
        ${row.tags.map((tag) =>
          onTag
            ? html`<button class="tag-chip" key=${tag} title="Filter by this tag" onClick=${(e: Event) => { e.stopPropagation(); onTag(tag); }}>${tag}</button>`
            : html`<a class="tag-chip" key=${tag} href=${overviewHash(tag)} onClick=${(e: Event) => e.stopPropagation()}>${tag}</a>`
        )}
      </td>
    </tr>
  `;
}

/** A section's cases ahead of their cards, on the single long page where there is no scope table above */
function SectionIndex({ testCases }: { testCases: TestCase[] }) {
  return html`
    <table class="overview-table section-index">
      <thead>
        <tr>${INDEX_COLUMNS.map((column) => html`<th key=${column}>${column}</th>`)}</tr>
      </thead>
      <tbody>
        ${testCases.map((tc) => html`<${IndexRow} key=${tc._tcId} row=${indexRowData(tc)} />`)}
      </tbody>
    </table>
  `;
}

function CategorySection({
  idPrefix,
  category,
  testCases,
  level,
  showIndex,
}: {
  idPrefix: string;
  category: string;
  testCases: TestCase[];
  level: number;
  showIndex: boolean;
}) {
  return html`
    <section class="category-section" id=${categoryAnchorId(idPrefix, category)}>
      <div class=${`category-header sticky-header sticky-level-${level}`}>
        <h3>${category}</h3>
        <div class="category-header-right">
          <span class="count"><${CountLabel} testCases=${testCases} /></span>
          <${CopyButton} title="Copy this section as Markdown" getText=${() => categoryToMarkdown(category, testCases)} />
        </div>
      </div>
      ${showIndex ? html`<${SectionIndex} testCases=${testCases} />` : null}
      ${testCases.map((tc) => html`<${TestCaseCard} key=${tc._tcId} tc=${tc} level=${level + 1} />`)}
    </section>
  `;
}

/** Derives the anchor/DOM ID for a section name within a test suite (idPrefix keeps IDs unique across suites) */
function categoryAnchorId(idPrefix: string, category: string): string {
  return `suite-${idPrefix}-category-${encodeURIComponent(category)}`;
}

function testCaseAnchorId(tcId: string): string {
  return tcId.toLowerCase();
}

function suiteAnchorId(idPrefix: string): string {
  return `suite-${idPrefix}`;
}

/** The guide block as a whole. Individual guide headings get `suite-<idPrefix>-guide-<n>` from generate.ts. */
function guideAnchorId(idPrefix: string): string {
  return `suite-${idPrefix}-guide`;
}

function groupByCategory(testCases: TestCase[]): Array<[string, TestCase[]]> {
  const grouped = new Map<string, TestCase[]>();
  for (const tc of testCases) {
    const category = tc.category || "Other";
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category)!.push(tc);
  }
  return Array.from(grouped.entries());
}

interface FeatureGroup {
  feature: string;
  featureLabel: string;
  suites: SuitePageData[];
}

interface DomainGroup {
  domain: string;
  domainLabel: string;
  features: FeatureGroup[];
}

/** Groups test suites into domain -> feature -> test suite. Preserves encounter order. */
function groupByDomainAndFeature(suites: SuitePageData[]): DomainGroup[] {
  const domainOrder: string[] = [];
  const domainMap = new Map<string, { domainLabel: string; featureOrder: string[]; featureMap: Map<string, FeatureGroup> }>();

  for (const suite of suites) {
    if (!domainMap.has(suite.domain)) {
      domainMap.set(suite.domain, { domainLabel: suite.domainLabel, featureOrder: [], featureMap: new Map() });
      domainOrder.push(suite.domain);
    }
    const d = domainMap.get(suite.domain)!;
    if (!d.featureMap.has(suite.feature)) {
      d.featureMap.set(suite.feature, { feature: suite.feature, featureLabel: suite.featureLabel, suites: [] });
      d.featureOrder.push(suite.feature);
    }
    d.featureMap.get(suite.feature)!.suites.push(suite);
  }

  return domainOrder.map((domain) => {
    const d = domainMap.get(domain)!;
    return {
      domain,
      domainLabel: d.domainLabel,
      features: d.featureOrder.map((f) => d.featureMap.get(f)!),
    };
  });
}

function domainAnchorId(domain: string): string {
  return `domain-${encodeURIComponent(domain)}`;
}

/** The hierarchy levels shown as their own columns in the overview, outermost first */
const OVERVIEW_LEVELS = ["domain", "feature", "suite", "category"] as const;

type OverviewLevel = (typeof OVERVIEW_LEVELS)[number];

interface OverviewRow {
  tcId: string;
  name: string;
  status: string | null;
  statusTitle: string;
  method: string;
  inactive: boolean;
  tags: string[];
  /** Suite this case belongs to, for linking to its sections */
  idPrefix: string;
  labels: Record<OverviewLevel, string>;
  /**
   * Full-path identity per level. Compared against the previous *visible* row to decide
   * dimming, which is why it is stored rather than resolved up front: filtering changes
   * which row precedes which.
   */
  keys: Record<OverviewLevel, string>;
}

/** Flattens every test suite into one row per test case, in document order. */
function buildOverviewRows(suites: SuitePageData[]): OverviewRow[] {
  const rows: OverviewRow[] = [];

  for (const d of groupByDomainAndFeature(suites)) {
    for (const f of d.features) {
      for (const suite of f.suites) {
        for (const [category, cases] of groupByCategory(suite.testCases)) {
          const labels: Record<OverviewLevel, string> = {
            domain: d.domainLabel,
            feature: f.featureLabel,
            suite: suite.typeName,
            category,
          };
          // Keyed by the full path, so an identically named feature under a different
          // domain still counts as new rather than a repeat
          const keys: Record<OverviewLevel, string> = {
            domain: d.domain,
            feature: `${d.domain}\u0000${f.feature}`,
            suite: `${d.domain}\u0000${f.feature}\u0000${suite.idPrefix}`,
            category: `${d.domain}\u0000${f.feature}\u0000${suite.idPrefix}\u0000${category}`,
          };

          for (const tc of cases) {
            rows.push({
              tcId: tc._tcId,
              name: tc.name,
              status: statusLabel(tc),
              statusTitle: tc.reason ?? tc.skip?.reason ?? "",
              method: testMethod(tc),
              inactive: isInactive(tc),
              tags: tc.tags ?? [],
              idPrefix: suite.idPrefix,
              labels,
              keys,
            });
          }
        }
      }
    }
  }
  return rows;
}

/** Everything shown in the row, so the filter matches exactly what the reader can see */
function overviewRowSearchText(row: OverviewRow): string {
  return [row.tcId, ...OVERVIEW_LEVELS.map((level) => row.labels[level]), row.name, row.status ?? "", row.method, ...row.tags].join(" ");
}

function filterOverviewRows(rows: OverviewRow[], query: string): OverviewRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => overviewRowSearchText(row).toLowerCase().includes(q));
}

/** Column headings, shared by the rendered table and the Markdown export so they cannot drift */
const OVERVIEW_COLUMNS = ["ID", "Domain", "Feature", "Test Suite", "Section", "Name", "Status", "Method", "Tags"];

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

/** Renders the overview as a Markdown table. Repeated values are written out in full, since
 *  the dimming that stands in for them on screen has no Markdown equivalent. */
function overviewToMarkdown(rows: OverviewRow[]): string {
  const lines = [
    "# Overview",
    "",
    `> ${rows.length} test case(s)`,
    "",
    `| ${OVERVIEW_COLUMNS.join(" | ")} |`,
    `|${OVERVIEW_COLUMNS.map(() => "---").join("|")}|`,
  ];
  for (const row of rows) {
    const cells = [
      row.tcId,
      ...OVERVIEW_LEVELS.map((level) => row.labels[level]),
      row.name,
      row.status ?? "",
      row.method,
      row.tags.join(", "),
    ];
    lines.push(`| ${cells.map(escapeMarkdownCell).join(" | ")} |`);
  }
  return lines.join("\n");
}

/** What a scope page covers: its title, where it sits in the tree, and which rows and suites are in it */
interface ResolvedScope {
  title: string;
  /** Labels of the levels above this one, outermost first */
  ancestors: string[];
  /** Element ID of the scope's page, so the sidebar's scroll tracking has an anchor to resolve */
  anchorId: string;
  suites: SuitePageData[];
  count: CaseCount;
  /** Which level of OverviewRow.keys identifies this scope, and the key value; absent for "all" */
  rowKey?: { level: OverviewLevel; value: string };
  /** How many leading levels of the hierarchy this scope already fixes (all=0 … suite=3) */
  depth: number;
  /** Markdown for the Copy button; absent for "all", whose copy follows the filtered table */
  toMarkdown?: () => string;
}

function resolveScope(scope: Scope, suites: SuitePageData[]): ResolvedScope | null {
  const domains = groupByDomainAndFeature(suites);
  const sumCounts = (list: SuitePageData[]) => list.reduce((sum, suite) => addCounts(sum, suiteTestCaseCount(suite)), { active: 0, total: 0 });

  if (scope.kind === "all") {
    return { title: "All test cases", ancestors: [], anchorId: "overview", suites, count: sumCounts(suites), depth: 0 };
  }
  if (scope.kind === "suite") {
    const suite = suites.find((candidate) => candidate.idPrefix === scope.idPrefix);
    if (!suite) return null;
    return {
      title: `${suite.idPrefix}: ${suite.typeName}`,
      ancestors: [suite.domainLabel, suite.featureLabel],
      anchorId: suiteAnchorId(suite.idPrefix),
      suites: [suite],
      count: suiteTestCaseCount(suite),
      rowKey: { level: "suite", value: `${suite.domain}\u0000${suite.feature}\u0000${suite.idPrefix}` },
      depth: 3,
      toMarkdown: () => allTestCasesToMarkdown(suite),
    };
  }
  const domain = domains.find((d) => d.domain === scope.domain);
  if (scope.kind === "domain") {
    if (!domain) return null;
    return {
      title: domain.domainLabel,
      ancestors: [],
      anchorId: domainAnchorId(domain.domain),
      suites: domain.features.flatMap((f) => f.suites),
      count: domainTestCaseCount(domain),
      rowKey: { level: "domain", value: domain.domain },
      depth: 1,
      toMarkdown: () => domainToMarkdown(domain),
    };
  }
  if (scope.kind === "feature") {
    const feature = domain?.features.find((f) => f.feature === scope.feature);
    if (!domain || !feature) return null;
    return {
      title: feature.featureLabel,
      ancestors: [domain.domainLabel],
      anchorId: featureAnchorId(domain.domain, feature.feature),
      suites: feature.suites,
      count: featureTestCaseCount(feature),
      rowKey: { level: "feature", value: `${domain.domain}\u0000${feature.feature}` },
      depth: 2,
      toMarkdown: () => featureToMarkdown(feature),
    };
  }
  return null;
}

/** Rows of the table, with a heading row ahead of each section naming where it sits below the scope */
function ScopeTable({ rows, depth, onTag }: { rows: OverviewRow[]; depth: number; onTag: (tag: string) => void }) {
  const sectionCount = new Set(rows.map((row) => row.keys.category)).size;
  // A suite with a single section would just repeat its own page title
  const showGroups = !(depth === OVERVIEW_LEVELS.length - 1 && sectionCount === 1);

  return html`
    <table class="overview-table scope-table">
      <thead>
        <tr>${INDEX_COLUMNS.map((column) => html`<th key=${column}>${column}</th>`)}</tr>
      </thead>
      <tbody>
        ${rows.map((row, i) => {
          const startsGroup = showGroups && (i === 0 || rows[i - 1].keys.category !== row.keys.category);
          return html`
            ${startsGroup
              ? html`<tr key=${"group:" + row.keys.category} class="scope-group">
                  <th colspan=${INDEX_COLUMNS.length}>
                    <a href=${sectionHash(row.idPrefix, row.labels.category)}>${OVERVIEW_LEVELS.slice(depth).map((level) => row.labels[level]).join(" › ")}</a>
                  </th>
                </tr>`
              : null}
            <${IndexRow} key=${row.tcId} row=${row} onTag=${onTag} />
          `;
        })}
      </tbody>
    </table>
  `;
}

/**
 * The page for one node of the tree: its cases as a table, and for a suite the guide and the
 * case cards below it. The filter narrows the table and, on a suite, the cards with the same rule.
 */
function ScopePage({
  route,
  suites,
  rows,
  query,
  onQueryChange,
  guideOpen,
  onToggleGuide,
  showInactive,
  onToggleInactive,
}: {
  route: Route;
  suites: SuitePageData[];
  rows: OverviewRow[];
  query: string;
  onQueryChange: (query: string) => void;
  guideOpen: boolean;
  onToggleGuide: () => void;
  showInactive: boolean;
  onToggleInactive: () => void;
}) {
  const resolved = resolveScope(route.scope, suites);
  if (!resolved) {
    return html`<p class="empty">Not found. <a href=${OVERVIEW_HASH}>Back to all test cases</a></p>`;
  }
  if (suites.length === 0) {
    return html`<p class="empty">No testcases.yaml files found.</p>`;
  }

  const { rowKey } = resolved;
  const scopeRows = rowKey ? rows.filter((row) => row.keys[rowKey.level] === rowKey.value) : rows;
  const trimmedQuery = query.trim();
  const visibleRows = filterOverviewRows(scopeRows, trimmedQuery);
  const visibleIds = new Set(visibleRows.map((row) => row.tcId));
  const suite = route.scope.kind === "suite" ? resolved.suites[0] : null;
  const hasGuide = !!suite?.guideHtml;
  const hasInactive = !!suite?.testCases.some(isInactive);
  // Inactive cases stay in the table, where coverage is read; their cards are only noise for whoever
  // runs the suite. A case the route points at is always shown, so a table row never opens onto nothing.
  const cardCases = suite
    ? suite.testCases.filter(
        (tc) =>
          visibleIds.has(tc._tcId) &&
          (showInactive || !isInactive(tc) || testCaseAnchorId(tc._tcId) === route.target)
      )
    : [];
  const hiddenCount = suite ? suite.testCases.filter((tc) => visibleIds.has(tc._tcId)).length - cardCases.length : 0;

  return html`
    <section class="overview scope-page" id=${resolved.anchorId}>
      <h2 class="overview-title sticky-header sticky-level-0">
        <span class="suite-title-text">
          ${resolved.ancestors.length > 0 ? html`<span class="scope-crumb">${resolved.ancestors.join(" › ")} › </span>` : null}${resolved.title}
        </span>
        <span class="suite-title-right">
          ${route.scope.kind === "all" ? html`<a class="scope-link" href=${ALL_HASH}>Read as one page</a>` : null}
          <span class="suite-title-count">
            ${trimmedQuery ? `${visibleRows.length} / ${scopeRows.length}` : formatCaseCount(resolved.count)} test case(s)
          </span>
          ${hasGuide
            ? html`<button
                class=${"copy-btn guide-toggle" + (guideOpen ? " guide-toggle-on" : "")}
                aria-pressed=${guideOpen}
                title=${guideOpen ? "Hide the guide" : "Show the guide beside the test cases"}
                onClick=${onToggleGuide}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
                <span>Guide</span>
              </button>`
            : null}
          <${CopyButton}
            title="Copy the listed test cases as Markdown"
            getText=${() => (resolved.toMarkdown && !trimmedQuery ? resolved.toMarkdown() : overviewToMarkdown(visibleRows))}
          />
        </span>
      </h2>
      <div class="scope-table-wrap">
        <div class="filter-bar">
          <input
            class="overview-search"
            type="search"
            placeholder="🔍 Filter by ID, name, section, status, method, or tag"
            value=${query}
            onInput=${(e: Event) => onQueryChange((e.target as HTMLInputElement).value)}
          />
          ${hasInactive
            ? html`<label class="filter-toggle" title="Obsolete, superseded and skipped cases are always listed in the table">
                <input type="checkbox" checked=${showInactive} onChange=${onToggleInactive} />
                Show inactive cards
              </label>`
            : null}
        </div>
        ${visibleRows.length === 0
          ? html`<p class="empty">No matches</p>`
          : html`<${ScopeTable} rows=${visibleRows} depth=${resolved.depth} onTag=${onQueryChange} />`}
      </div>
      ${hiddenCount > 0
        ? html`<p class="hidden-note">
            ${hiddenCount} inactive case${hiddenCount === 1 ? " is" : "s are"} not shown below; ${hiddenCount === 1 ? "it stays" : "they stay"} in the table.${" "}
            <button class="link-btn" onClick=${onToggleInactive}>Show</button>
          </p>`
        : null}
      ${suite && cardCases.length > 0
        ? html`<${SuiteCategories} suite=${suite} testCases=${cardCases} level=${1} showIndex=${false} />`
        : null}
    </section>
  `;
}

function featureAnchorId(domain: string, feature: string): string {
  return `domain-${encodeURIComponent(domain)}-feature-${encodeURIComponent(feature)}`;
}

function SuiteGuide({ suite }: { suite: SuitePageData }) {
  if (!suite.guideHtml) return null;
  return html`<details class="guide" id=${guideAnchorId(suite.idPrefix)}>
    <summary class="guide-summary">📖 Guide</summary>
    <div class="guide-body" dangerouslySetInnerHTML=${{ __html: suite.guideHtml }} />
  </details>`;
}

/**
 * A suite's guide docked beside its cases, so it can be read while working through them. Its body
 * scrolls independently of the page; that and the sidebar's list are the only nested scrollers.
 */
function GuidePanel({
  suite,
  width,
  limit,
  onClose,
  onResize,
  onResetWidth,
}: {
  suite: SuitePageData;
  width: number;
  limit: number;
  onClose: () => void;
  onResize: (width: number) => void;
  onResetWidth: () => void;
}) {
  return html`
    <aside
      class="guide-panel"
      aria-label="Guide"
      onKeyDown=${(e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <${Resizer} edge="start" width=${width} size=${GUIDE_SIZE} limit=${limit} label="Resize guide" onResize=${onResize} onReset=${onResetWidth} />
      <div class="guide-panel-head">
        <span class="guide-panel-title" title=${`${suite.idPrefix}: ${suite.typeName}`}>📖 Guide · ${suite.typeName}</span>
        <button class="header-btn header-btn-icon" title="Close the guide" aria-label="Close the guide" onClick=${onClose}>✕</button>
      </div>
      <div class="guide-panel-body" tabindex="0">
        <div class="guide" id=${guideAnchorId(suite.idPrefix)}>
          <div class="guide-body" dangerouslySetInnerHTML=${{ __html: suite.guideHtml }} />
        </div>
      </div>
    </aside>
  `;
}

/** The suite's sections and their cards. `level` is the sections' own sticky level; cards sit one below. */
function SuiteCategories({
  suite,
  testCases,
  level,
  showIndex,
}: {
  suite: SuitePageData;
  testCases: TestCase[];
  level: number;
  showIndex: boolean;
}) {
  return html`<main class="cards">
    ${groupByCategory(testCases).map(
      ([category, cases]) => html`<${CategorySection} key=${category} idPrefix=${suite.idPrefix} category=${category} testCases=${cases} level=${level} showIndex=${showIndex} />`
    )}
  </main>`;
}

function SuiteSection({ suite }: { suite: SuitePageData }) {
  return html`
    <section class="suite-section" id=${suiteAnchorId(suite.idPrefix)}>
      <h1 class="suite-title sticky-header sticky-level-2">
        <span class="suite-title-text">${suite.idPrefix}: ${suite.typeName}</span>
        <span class="suite-title-right">
          <span class="suite-title-count"><${CountLabel} testCases=${suite.testCases} /></span>
          <${CopyButton} title="Copy all test cases as Markdown" getText=${() => allTestCasesToMarkdown(suite)} />
        </span>
      </h1>
      <${SuiteGuide} suite=${suite} />
      <${SuiteCategories} suite=${suite} testCases=${suite.testCases} level=${3} showIndex=${true} />
    </section>
  `;
}

interface CaseCount {
  active: number;
  total: number;
}

function addCounts(a: CaseCount, b: CaseCount): CaseCount {
  return { active: a.active + b.active, total: a.total + b.total };
}

function suiteTestCaseCount(suite: SuitePageData): CaseCount {
  const total = suite.testCases.length;
  const active = suite.testCases.filter((tc) => !isInactive(tc)).length;
  return { active, total };
}

function featureTestCaseCount(group: FeatureGroup): CaseCount {
  return group.suites.reduce((sum, suite) => addCounts(sum, suiteTestCaseCount(suite)), { active: 0, total: 0 });
}

function domainTestCaseCount(group: DomainGroup): CaseCount {
  return group.features.reduce((sum, f) => addCounts(sum, featureTestCaseCount(f)), { active: 0, total: 0 });
}

function formatCaseCount({ active, total }: CaseCount): string {
  return active === total ? `${total}` : `${active} (${total})`;
}

function featureToMarkdown(group: FeatureGroup, headingLevel = 1): string {
  const lines = [`${"#".repeat(headingLevel)} ${group.featureLabel}`, "", `> ${formatCaseCount(featureTestCaseCount(group))} test case(s)`, ""];
  for (const suite of group.suites) {
    lines.push(allTestCasesToMarkdown(suite, headingLevel + 1));
  }
  return lines.join("\n");
}

function domainToMarkdown(group: DomainGroup): string {
  const lines = [`# ${group.domainLabel}`, "", `> ${formatCaseCount(domainTestCaseCount(group))} test case(s)`, ""];
  for (const feature of group.features) {
    lines.push(featureToMarkdown(feature, 2));
  }
  return lines.join("\n");
}

function FeatureSection({ domain, group }: { domain: string; group: FeatureGroup }) {
  return html`
    <div class="feature-section" id=${featureAnchorId(domain, group.feature)}>
      <h2 class="feature-title sticky-header sticky-level-1">
        <span class="suite-title-text">${group.featureLabel}</span>
        <span class="suite-title-right">
          <span class="suite-title-count">${formatCaseCount(featureTestCaseCount(group))}</span>
          <${CopyButton} title="Copy this feature as Markdown" getText=${() => featureToMarkdown(group)} />
        </span>
      </h2>
      ${group.suites.map((suite) => html`<${SuiteSection} key=${suite.idPrefix} suite=${suite} />`)}
    </div>
  `;
}

function DomainSection({ group }: { group: DomainGroup }) {
  return html`
    <div class="domain-section" id=${domainAnchorId(group.domain)}>
      <h2 class="domain-title sticky-header sticky-level-0">
        <span class="suite-title-text">${group.domainLabel}</span>
        <span class="suite-title-right">
          <span class="suite-title-count">${formatCaseCount(domainTestCaseCount(group))}</span>
          <${CopyButton} title="Copy this domain as Markdown" getText=${() => domainToMarkdown(group)} />
        </span>
      </h2>
      ${group.features.map((f) => html`<${FeatureSection} key=${f.feature} domain=${group.domain} group=${f} />`)}
    </div>
  `;
}

const OVERVIEW_HASH = "#/overview";
const ALL_HASH = "#/all";

function domainHash(domain: string): string {
  return `#/d/${encodeURIComponent(domain)}`;
}

function featureHash(domain: string, feature: string): string {
  return `#/f/${encodeURIComponent(domain)}/${encodeURIComponent(feature)}`;
}

function suiteHash(idPrefix: string): string {
  return `#/s/${encodeURIComponent(idPrefix)}`;
}

function sectionHash(idPrefix: string, category: string): string {
  return `${suiteHash(idPrefix)}/section/${encodeURIComponent(category)}`;
}

function guideHash(idPrefix: string, headingIndex?: number): string {
  return `${suiteHash(idPrefix)}/guide${headingIndex === undefined ? "" : `/${headingIndex}`}`;
}

function testCaseHash(tcId: string): string {
  return `#/tc/${encodeURIComponent(tcId)}`;
}

function overviewHash(query: string): string {
  const trimmed = query.trim();
  return trimmed ? `${OVERVIEW_HASH}?q=${encodeURIComponent(trimmed)}` : OVERVIEW_HASH;
}

interface NavEntry {
  kind: "view" | "domain" | "feature" | "suite" | "guide" | "category" | "testcase";
  /** An element ID to scroll to — except for `view` entries, where it is the route hash */
  id: string;
  /** The route that shows this entry; selecting it sets location.hash to this */
  hash: string;
  label: string;
  /** Search text. Kept separate from the display label so terms not shown (like idPrefix) still match. */
  searchText: string;
  /** Breadcrumb shown in the command palette (e.g. "web › Login › Basic flow"). Undefined for domains. */
  breadcrumb?: string;
  count?: number;
  /** Anchor of the suite this guide/section/case belongs to, so the outline can open just the active suite */
  suiteId?: string;
}

const KIND_LABEL: Record<NavEntry["kind"], string> = {
  view: "View",
  domain: "Domain",
  feature: "Feature",
  suite: "Test Suite",
  guide: "Guide",
  category: "Section",
  testcase: "Test Case",
};

/** Everything inside a case, so searching matches step and precondition wording too */
function testCaseSearchText(tc: TestCase): string {
  const parts = [tc._tcId, tc.name];
  if (tc.category) parts.push(tc.category);
  if (tc.preconditions) parts.push(formatPreconditions(tc.preconditions));
  if (tc.test_data) parts.push(formatTestData(tc.test_data));
  for (const step of tc.steps ?? []) parts.push(step.action, step.expected);
  if (tc.notes) parts.push(tc.notes);
  if (tc.tags) parts.push(...tc.tags);
  return parts.join(" ");
}

/**
 * How guides are represented, which differs by surface: the outline is a structure map, where
 * one entry per guide heading buries the test cases it is supposed to introduce, while the
 * palette is a search surface, where that same granularity is the point.
 */
type GuideDetail = "none" | "collapsed" | "headings";

/** Flattens every test suite into domain -> feature -> suite -> guide -> section -> test case navigation entries */
function buildNavEntries(suites: SuitePageData[], guideDetail: GuideDetail, includeTestCases: boolean): NavEntry[] {
  const entries: NavEntry[] = [];
  const domains = groupByDomainAndFeature(suites);

  for (const d of domains) {
    entries.push({
      kind: "domain",
      id: domainAnchorId(d.domain),
      hash: domainHash(d.domain),
      label: d.domainLabel,
      searchText: `${d.domain} ${d.domainLabel}`,
      count: domainTestCaseCount(d).active,
    });
    for (const f of d.features) {
      entries.push({
        kind: "feature",
        id: featureAnchorId(d.domain, f.feature),
        hash: featureHash(d.domain, f.feature),
        label: f.featureLabel,
        searchText: `${f.feature} ${f.featureLabel}`,
        breadcrumb: d.domainLabel,
        count: featureTestCaseCount(f).active,
      });
      for (const suite of f.suites) {
        entries.push({
          kind: "suite",
          id: suiteAnchorId(suite.idPrefix),
          hash: suiteHash(suite.idPrefix),
          label: suite.typeName,
          // Not part of the display label, but lets searching by idPrefix (e.g. "CR") match the suite itself
          searchText: `${suite.idPrefix} ${suite.typeName}`,
          breadcrumb: `${d.domainLabel} › ${f.featureLabel}`,
          count: suite.testCases.length,
        });
        const suiteId = suiteAnchorId(suite.idPrefix);
        const guideBreadcrumb = `${d.domainLabel} › ${f.featureLabel} › ${suite.typeName}`;
        if (guideDetail === "none") {
          // The sidebar leaves guides out: a guide is opened from the page it belongs to, and found by search
        } else if (guideDetail === "collapsed") {
          // Keyed off guideHtml, not guideHeadings: a guide with no h2 still needs an entry
          if (suite.guideHtml) {
            entries.push({
              kind: "guide",
              id: guideAnchorId(suite.idPrefix),
              hash: guideHash(suite.idPrefix),
              label: "Guide",
              searchText: `${suite.idPrefix} guide ${suite.guideText}`,
              breadcrumb: guideBreadcrumb,
              suiteId,
            });
          }
        } else {
          suite.guideHeadings.forEach((heading, headingIndex) => {
            entries.push({
              kind: "guide",
              id: heading.id,
              hash: guideHash(suite.idPrefix, headingIndex),
              label: heading.text,
              searchText: `${suite.idPrefix} ${heading.text} ${heading.body}`,
              breadcrumb: guideBreadcrumb,
              suiteId,
            });
          });
        }
        const grouped = groupByCategory(suite.testCases);
        for (const [category, cases] of grouped) {
          entries.push({
            kind: "category",
            id: categoryAnchorId(suite.idPrefix, category),
            hash: sectionHash(suite.idPrefix, category),
            label: category,
            searchText: `${suite.idPrefix} ${category}`,
            breadcrumb: `${d.domainLabel} › ${f.featureLabel} › ${suite.typeName}`,
            count: cases.length,
            suiteId,
          });
          if (!includeTestCases) continue;
          for (const tc of cases) {
            entries.push({
              kind: "testcase",
              id: testCaseAnchorId(tc._tcId),
              hash: testCaseHash(tc._tcId),
              label: `${tc._tcId}: ${tc.name}`,
              searchText: testCaseSearchText(tc),
              breadcrumb: `${d.domainLabel} › ${f.featureLabel} › ${suite.typeName} › ${category}`,
              suiteId,
            });
          }
        }
      }
    }
  }
  return entries;
}

function entryKindClass(kind: NavEntry["kind"]): string {
  if (kind === "view") return "nav-outline-view";
  if (kind === "domain") return "nav-outline-domain";
  if (kind === "feature") return "nav-outline-feature";
  if (kind === "suite") return "nav-outline-suite";
  if (kind === "guide") return "nav-outline-guide";
  if (kind === "category") return "nav-outline-category";
  return "nav-outline-testcase";
}

/** Suites are always listed; a suite's guide and sections only while it is the one being read */
function isEntryVisible(entry: NavEntry, activeSuiteId: string | null): boolean {
  return entry.suiteId === undefined || entry.suiteId === activeSuiteId;
}

/** The sidebar entry that stands for the page a route shows */
function scopeEntryId(scope: Scope): string {
  if (scope.kind === "domain") return domainAnchorId(scope.domain);
  if (scope.kind === "feature") return featureAnchorId(scope.domain, scope.feature);
  if (scope.kind === "suite") return suiteAnchorId(scope.idPrefix);
  return OVERVIEW_HASH;
}

/**
 * Left-side navigation: the structure map (domain -> feature -> suite, plus the sections of the
 * suite being read). Individual test cases are deliberately absent — hundreds of them made the
 * outline unreadable. Selecting a node opens its page, which lists its cases; the command
 * palette searches them.
 * - The selected node follows the route. On a suite page, and on the single long page, the
 *   highlight instead follows the scroll position.
 */
function NavOutline({
  suites,
  route,
  onNavigate,
  width,
  onResize,
}: {
  suites: SuitePageData[];
  route: Route;
  onNavigate: (entry: NavEntry) => void;
  width: number;
  onResize: (width: number) => void;
}) {
  const allEntry: NavEntry = {
    kind: "view",
    id: OVERVIEW_HASH,
    hash: OVERVIEW_HASH,
    label: "All test cases",
    searchText: "",
    count: suites.reduce((sum, suite) => sum + suiteTestCaseCount(suite).active, 0),
  };
  const entries = [allEntry, ...buildNavEntries(suites, "none", false)];
  const selectedId = scopeEntryId(route.scope);
  const tracksScroll = route.mode === "full" || route.scope.kind === "suite";
  const [currentId, setCurrentId] = useState<string>(selectedId);
  const suppressUntil = useRef(0);
  const listRef = useRef<HTMLUListElement>(null);

  // A new route starts from its own node; scroll tracking then takes over where it applies
  useEffect(() => {
    setCurrentId(selectedId);
  }, [route.hash]);

  useEffect(() => {
    if (!tracksScroll) return;
    function compute() {
      if (Date.now() < suppressUntil.current) return;
      const threshold = window.innerHeight * 0.25;
      let current: string | null = null;
      for (const entry of entries) {
        const el = document.getElementById(entry.id);
        // The guide panel scrolls apart from the page, so its position says nothing about where the reader is
        if (!el || el.closest(".guide-panel")) continue;
        if (el.getBoundingClientRect().top <= threshold) {
          current = entry.id;
        }
      }
      if (current) setCurrentId(current);
    }

    compute();
    window.addEventListener("scroll", compute, { capture: true, passive: true });
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", compute);
    };
  }, [suites, tracksScroll, route.hash]);

  const highlightId = tracksScroll ? currentId : selectedId;

  // Scrolls the list itself, not the page: scrollIntoView would also move the window
  useEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>(".nav-outline-current");
    if (!list || !current) return;
    const listBox = list.getBoundingClientRect();
    const box = current.getBoundingClientRect();
    if (box.top < listBox.top) list.scrollTop -= listBox.top - box.top;
    else if (box.bottom > listBox.bottom) list.scrollTop += box.bottom - listBox.bottom;
  }, [highlightId, route.hash]);

  const onJump = useCallback(
    (entry: NavEntry) => {
      setCurrentId(entry.id);
      // Suppress scroll-spy briefly after a jump so it doesn't immediately switch to another entry
      suppressUntil.current = Date.now() + 700;
      onNavigate(entry);
    },
    [onNavigate]
  );

  const currentEntry = entries.find((e) => e.id === highlightId);
  const activeSuiteId =
    route.scope.kind === "suite"
      ? suiteAnchorId(route.scope.idPrefix)
      : route.mode === "full"
        ? currentEntry?.kind === "suite"
          ? currentEntry.id
          : (currentEntry?.suiteId ?? null)
        : null;
  const visibleEntries = entries.filter((e) => isEntryVisible(e, activeSuiteId));

  return html`
    <nav class="nav-outline">
      <ul ref=${listRef}>
        ${visibleEntries.map(
          (entry) => html`
            <li key=${entry.id} class=${entryKindClass(entry.kind)}>
              <button
                class=${"nav-outline-item" + (entry.id === highlightId ? " nav-outline-current" : "")}
                title=${entry.label}
                onClick=${() => onJump(entry)}
              >
                <span class="nav-label">${entry.label}</span>${entry.count !== undefined ? html`<span class="count">(${entry.count})</span>` : null}
              </button>
            </li>
          `
        )}
      </ul>
      <${Resizer} edge="end" width=${width} size=${NAV_SIZE} label="Resize navigation" onResize=${onResize} />
    </nav>
  `;
}

type Scope =
  | { kind: "all" }
  | { kind: "domain"; domain: string }
  | { kind: "feature"; domain: string; feature: string }
  | { kind: "suite"; idPrefix: string };

interface Route {
  scope: Scope;
  /** `table` lists the scope's cases; `full` is the single long page of everything (`#/all`) */
  mode: "table" | "full";
  /** Element to scroll to once the page has rendered; null scrolls to the top */
  target: string | null;
  /** Filter seeded from `?q=<query>`; empty when unfiltered */
  query: string;
  /** The hash this route was parsed from, so a changed hash can be told from a re-render */
  hash: string;
}

const ALL_SCOPE: Scope = { kind: "all" };

/**
 * Hash routing, not the History API: the `--out` build has to work when opened over
 * file://, where pushState throws and a real path would not resolve at all.
 * Routes are namespaced under `#/` so they can never collide with an element ID and
 * trigger the browser's own anchor jump.
 *
 *   #/overview[?q=]                    all test cases, table only (the landing page)
 *   #/all  (and #/)                    everything on one page
 *   #/d/<domain>   #/f/<domain>/<feature>   #/s/<idPrefix>
 *   #/s/<idPrefix>/section/<name>      a suite page scrolled to one section
 *   #/s/<idPrefix>/guide[/<n>]         a suite page scrolled to its guide (or the nth guide heading)
 *   #/tc/<id>                          the owning suite's page scrolled to the case
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseRoute(hash: string, suites: SuitePageData[]): Route {
  const [path, queryString = ""] = hash.replace(/^#/, "").split("?", 2);
  const queryMatch = /(?:^|&)q=([^&]*)/.exec(queryString);
  const query = queryMatch ? safeDecode(queryMatch[1]) : "";
  const landing: Route = { scope: ALL_SCOPE, mode: "table", target: null, query, hash };
  const segments = path.split("/").slice(1).map(safeDecode);

  if (path === "/" || segments[0] === "all") return { ...landing, mode: "full", query: "" };

  if (segments[0] === "d" && segments.length === 2) {
    return { ...landing, scope: { kind: "domain", domain: segments[1] } };
  }
  if (segments[0] === "f" && segments.length === 3) {
    return { ...landing, scope: { kind: "feature", domain: segments[1], feature: segments[2] } };
  }
  if (segments[0] === "s" && segments.length >= 2) {
    const idPrefix = segments[1];
    const scope: Scope = { kind: "suite", idPrefix };
    if (segments[2] === "section" && segments[3] !== undefined) {
      return { ...landing, scope, target: categoryAnchorId(idPrefix, segments[3]) };
    }
    if (segments[2] === "guide") {
      const target = segments[3] === undefined ? guideAnchorId(idPrefix) : `suite-${idPrefix}-guide-${segments[3]}`;
      return { ...landing, scope, target };
    }
    return { ...landing, scope };
  }
  if (segments[0] === "tc" && segments[1] !== undefined) {
    const anchor = testCaseAnchorId(segments[1]);
    const suite = suites.find((candidate) => candidate.testCases.some((tc) => testCaseAnchorId(tc._tcId) === anchor));
    // An unknown id falls back to searching for it rather than to a blank page
    if (!suite) return { ...landing, query: segments[1] };
    return { ...landing, scope: { kind: "suite", idPrefix: suite.idPrefix }, target: anchor, query: "" };
  }
  return landing;
}

/** Breathing room kept above a heading when the guide panel scrolls to it */
const GUIDE_PANEL_GAP = 12;

/** Shared jump-to-ID logic, used by both NavOutline and CommandPalette. */
function jumpToId(id: string, onDone?: () => void) {
  const el = document.getElementById(id);
  if (!el) return;
  // The guide panel scrolls on its own, and scrollIntoView would also move the page of cases
  // beside it, which is exactly what reading the guide next to a case must not do
  const panelBody = el.closest<HTMLElement>(".guide-panel-body");
  if (panelBody) {
    panelBody.scrollTop += el.getBoundingClientRect().top - panelBody.getBoundingClientRect().top - GUIDE_PANEL_GAP;
    el.classList.add("jump-flash");
    setTimeout(() => el.classList.remove("jump-flash"), 1200);
    onDone?.();
    return;
  }
  // Before measuring: a target inside a collapsed guide has no layout box of its own, and
  // `closest` includes the element itself, so jumping to the guide also opens it
  for (let details = el.closest("details"); details; details = details.parentElement?.closest("details") ?? null) {
    details.open = true;
  }
  el.scrollIntoView({ block: "start" });
  // scrollIntoView aligns the target with the viewport top, where the stacked sticky headers
  // would cover it. The target's own sticky header already knows where that stack ends, so
  // nudge back down by exactly its `top`.
  const header = el.querySelector(".sticky-header");
  if (header) {
    const offset = parseFloat(getComputedStyle(header).top);
    if (offset > 0) window.scrollBy(0, -offset);
  }
  el.classList.add("jump-flash");
  setTimeout(() => el.classList.remove("jump-flash"), 1200);
  onDone?.();
}

function scrollToRoute(route: Route) {
  if (route.target) jumpToId(route.target);
  else window.scrollTo(0, 0);
}

/**
 * Command palette opened with Cmd+K / Ctrl+K. Incremental search filters test
 * suites, sections, and test cases; arrow keys + Enter jump to the selected entry.
 */
function CommandPalette({
  entries,
  overviewRows,
  onClose,
  onJump,
}: {
  entries: NavEntry[];
  overviewRows: OverviewRow[];
  onClose: () => void;
  onJump: (entry: NavEntry) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = query.trim();
  const q = trimmed.toLowerCase();
  const matched = trimmed ? filterOverviewRows(overviewRows, trimmed).length : 0;
  // Offered first, so the same typing that finds a single test case can instead open the
  // overview narrowed to everything that matched
  const overviewEntry: NavEntry[] =
    matched > 0
      ? [
          {
            kind: "view",
            id: overviewHash(trimmed),
            hash: overviewHash(trimmed),
            label: `Filter all test cases by "${trimmed}"`,
            searchText: "",
            count: matched,
          },
        ]
      : [];
  const results = [
    ...overviewEntry,
    ...(q ? entries.filter((e) => e.searchText.toLowerCase().includes(q)) : entries),
  ].slice(0, 50);
  const clampedSelected = Math.min(selected, Math.max(0, results.length - 1));

  const onInput = useCallback((e: Event) => {
    setQuery((e.target as HTMLInputElement).value);
    setSelected(0);
  }, []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const target = results[clampedSelected];
        if (target) {
          onJump(target);
          onClose();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [results, clampedSelected, onClose, onJump]
  );

  return html`
    <div class="palette-overlay" onClick=${onClose}>
      <div class="palette" onClick=${(e: Event) => e.stopPropagation()}>
        <input
          ref=${inputRef}
          class="palette-input"
          type="text"
          placeholder="🔍 Search test suites, sections, test cases (Esc to close)"
          value=${query}
          onInput=${onInput}
          onKeyDown=${onKeyDown}
        />
        <ul class="palette-results">
          ${results.map(
            (entry, i) => html`
              <li key=${entry.id}>
                <button
                  class=${"palette-item " + entryKindClass(entry.kind) + (i === clampedSelected ? " palette-sel" : "")}
                  onMouseEnter=${() => setSelected(i)}
                  onClick=${() => {
                    onJump(entry);
                    onClose();
                  }}
                >
                  <span class="palette-kind-badge">${KIND_LABEL[entry.kind]}</span>
                  <span class="palette-item-body">
                    ${entry.breadcrumb ? html`<span class="palette-breadcrumb">${entry.breadcrumb}</span>` : null}
                    <span class="palette-label">
                      ${entry.label}${entry.count !== undefined ? html` <span class="count">(${entry.count})</span>` : null}
                    </span>
                  </span>
                </button>
              </li>
            `
          )}
          ${results.length === 0 ? html`<li class="nav-empty">No matches</li>` : null}
        </ul>
      </div>
    </div>
  `;
}

type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "test-sheet-theme";

/**
 * `data-theme` on <html> is the single source of truth. It is absent until the reader picks
 * a theme (or when localStorage is unreadable, as it can be over file://), in which case the
 * stylesheet follows the OS — so fall back to the same signal the stylesheet uses.
 */
function currentTheme(): Theme {
  const attr = document.documentElement.dataset.theme;
  if (attr === "dark" || attr === "light") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  const onClick = useCallback(() => {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Blocked over file:// in some browsers; the choice still applies for this session
    }
    setTheme(next);
  }, []);

  return html`
    <button
      class="header-btn header-btn-icon"
      title=${theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      aria-label=${theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      onClick=${onClick}
    >
      ${theme === "dark"
        ? html`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" /></svg>`
        : html`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>`}
    </button>
  `;
}

const CHECKLIST_MODE_STORAGE_KEY = "test-sheet-checklist-mode";

function readChecklistMode(): boolean {
  try {
    return localStorage.getItem(CHECKLIST_MODE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeChecklistMode(on: boolean) {
  try {
    localStorage.setItem(CHECKLIST_MODE_STORAGE_KEY, on ? "1" : "0");
  } catch {
    // Blocked storage (e.g. over file://) just means the choice is not remembered
  }
}

const SHOW_INACTIVE_STORAGE_KEY = "test-sheet-show-inactive";

function readShowInactive(): boolean {
  try {
    return localStorage.getItem(SHOW_INACTIVE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeShowInactive(show: boolean) {
  try {
    localStorage.setItem(SHOW_INACTIVE_STORAGE_KEY, show ? "1" : "0");
  } catch {
    // Blocked storage (e.g. over file://) just means the choice is not remembered
  }
}

const GUIDE_OPEN_STORAGE_KEY = "test-sheet-guide-open";

function readGuideOpen(): boolean {
  try {
    return localStorage.getItem(GUIDE_OPEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeGuideOpen(open: boolean) {
  try {
    localStorage.setItem(GUIDE_OPEN_STORAGE_KEY, open ? "1" : "0");
  } catch {
    // Blocked storage (e.g. over file://) just means the choice is not remembered
  }
}

function useViewportWidth(): number {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

const NAV_COLLAPSED_STORAGE_KEY = "test-sheet-nav-collapsed";

function readNavCollapsed(): boolean {
  try {
    return localStorage.getItem(NAV_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeNavCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(NAV_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // Blocked storage (e.g. over file://) just means the choice is not remembered
  }
}

interface PanelSize {
  storageKey: string;
  defaultWidth: number;
  min: number;
  max: number;
}

const NAV_SIZE: PanelSize = { storageKey: "test-sheet-nav-width", defaultWidth: 240, min: 200, max: 640 };
// No fixed default: until the reader drags it, the guide takes half of what the sidebar leaves
const GUIDE_SIZE: PanelSize = { storageKey: "test-sheet-guide-width", defaultWidth: 0, min: 280, max: 1200 };
const PANEL_KEY_STEP = 16;
/** What the cases keep when both side panels are open, so the steps table never collapses */
const MAIN_MIN_WIDTH = 480;

function clampWidth(size: PanelSize, width: number, limit = size.max): number {
  return Math.min(Math.max(size.min, limit), Math.max(size.min, Math.round(width)));
}

function readPanelWidth(size: PanelSize): number {
  try {
    const stored = Number(localStorage.getItem(size.storageKey));
    return stored > 0 ? clampWidth(size, stored) : size.defaultWidth;
  } catch {
    return size.defaultWidth;
  }
}

/** The width the reader chose, or null when they never did and the default applies */
function readStoredPanelWidth(size: PanelSize): number | null {
  try {
    const stored = Number(localStorage.getItem(size.storageKey));
    return stored > 0 ? clampWidth(size, stored) : null;
  } catch {
    return null;
  }
}

function clearPanelWidth(size: PanelSize) {
  try {
    localStorage.removeItem(size.storageKey);
  } catch {
    // Blocked storage: nothing was remembered to forget
  }
}

function writePanelWidth(size: PanelSize, width: number) {
  try {
    localStorage.setItem(size.storageKey, String(width));
  } catch {
    // Blocked storage (e.g. over file://) just means the width is not remembered
  }
}

/**
 * Drag handle on a side panel's inner edge. `edge` is the side of the panel the handle sits on:
 * "end" for the left sidebar (its right edge), "start" for the right-hand guide (its left edge).
 * Arrow keys resize too, and a double click restores the default.
 */
function Resizer({
  edge,
  width,
  size,
  limit,
  label,
  onResize,
  onReset,
}: {
  edge: "start" | "end";
  width: number;
  size: PanelSize;
  /** Upper bound tighter than the size's own max, e.g. what is left of the window */
  limit?: number;
  label: string;
  onResize: (width: number) => void;
  /** Double click; defaults to resizing to the size's own default width */
  onReset?: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const clamp = (value: number) => clampWidth(size, value, limit);

  const onPointerDown = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    // The sidebar starts at the window's left edge and the guide ends at its right edge, so the
    // pointer's distance from that edge is the new width
    onResize(clamp(edge === "end" ? e.clientX : window.innerWidth - e.clientX));
  };
  const onPointerUp = () => setDragging(false);
  const onKeyDown = (e: KeyboardEvent) => {
    const widen = edge === "end" ? "ArrowRight" : "ArrowLeft";
    const narrow = edge === "end" ? "ArrowLeft" : "ArrowRight";
    if (e.key === widen) onResize(clamp(width + PANEL_KEY_STEP));
    else if (e.key === narrow) onResize(clamp(width - PANEL_KEY_STEP));
    else return;
    e.preventDefault();
  };

  return html`<div
    class=${`panel-resizer panel-resizer-${edge}` + (dragging ? " panel-resizer-active" : "")}
    role="separator"
    aria-orientation="vertical"
    aria-label=${label}
    aria-valuemin=${size.min}
    aria-valuemax=${limit ?? size.max}
    aria-valuenow=${width}
    tabindex="0"
    title="Drag to resize (double-click to reset)"
    onPointerDown=${onPointerDown}
    onPointerMove=${onPointerMove}
    onPointerUp=${onPointerUp}
    onPointerCancel=${onPointerUp}
    onKeyDown=${onKeyDown}
    onDblClick=${onReset ?? (() => onResize(size.defaultWidth))}
  />`;
}

function AppHeader({
  onOpenPalette,
  navCollapsed,
  onToggleNav,
  checklistOn,
  onToggleChecklist,
}: {
  onOpenPalette: () => void;
  navCollapsed: boolean;
  onToggleNav: () => void;
  checklistOn: boolean;
  onToggleChecklist: () => void;
}) {
  const shortcut = navigator.userAgent.includes("Mac") ? "⌘K" : "Ctrl+K";

  return html`
    <header class="app-header">
      <div class="app-header-lead">
        <button
          class="header-btn header-btn-icon"
          title=${navCollapsed ? "Show navigation" : "Hide navigation"}
          aria-pressed=${navCollapsed}
          onClick=${onToggleNav}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></svg>
        </button>
        <span class="app-header-title">Test Cases</span>
      </div>
      <div class="app-header-actions">
        <button
          class=${"header-btn" + (checklistOn ? " header-btn-on" : "")}
          aria-pressed=${checklistOn}
          title="Tick off steps as you run a case (remembered in this browser)"
          onClick=${onToggleChecklist}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
          <span>Checklist</span>
        </button>
        <button class="header-btn" title="Search test suites, sections, test cases" onClick=${onOpenPalette}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
          <span>Search</span>
          <kbd class="header-kbd">${shortcut}</kbd>
        </button>
        <${ThemeToggle} />
      </div>
    </header>
  `;
}

/** Command-palette entries for the two page-wide views, which have no outline entry of their own */
const ALL_TEST_CASES_ENTRY: NavEntry = {
  kind: "view",
  id: OVERVIEW_HASH,
  hash: OVERVIEW_HASH,
  label: "All test cases",
  searchText: "overview index list table all test cases",
};

const ONE_PAGE_ENTRY: NavEntry = {
  kind: "view",
  id: ALL_HASH,
  hash: ALL_HASH,
  label: "Everything on one page",
  searchText: "all one page everything single long print",
};

function App() {
  const suites = window.__SUITES__;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(readNavCollapsed);
  const [navWidth, setNavWidth] = useState(() => readPanelWidth(NAV_SIZE));
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash, suites));
  const entries = buildNavEntries(suites, "headings", true);
  const overviewRows = buildOverviewRows(suites);
  /**
   * Local so typing in the filter box does not push a history entry per keystroke.
   * The route only seeds it — see the effect below.
   */
  const [query, setQuery] = useState(route.query);
  const [guideOpen, setGuideOpen] = useState(readGuideOpen);
  const [showInactive, setShowInactive] = useState(readShowInactive);
  const [checklistOn, setChecklistOn] = useState(readChecklistMode);
  const [guideWidth, setGuideWidth] = useState<number | null>(() => readStoredPanelWidth(GUIDE_SIZE));
  /** The route the reader closed the guide on, so a route that points into it does not hold it open */
  const [guideDismissedOn, setGuideDismissedOn] = useState<string | null>(null);
  const viewportWidth = useViewportWidth();

  // The suite whose guide this page offers, if any
  const pageGuideSuite =
    route.mode === "table" && route.scope.kind === "suite"
      ? suites.find((suite) => suite.idPrefix === (route.scope as { idPrefix: string }).idPrefix && suite.guideHtml)
      : undefined;
  /**
   * The guide stays on screen when the reader moves to a page that has none, so it can be read
   * while going on to other cases or suites. It switches when another page brings its own.
   */
  const [lastGuideId, setLastGuideId] = useState<string | null>(null);
  const guideSuite = pageGuideSuite ?? suites.find((suite) => suite.idPrefix === lastGuideId);
  const routeTargetsGuide = !!pageGuideSuite && !!route.target?.startsWith(`suite-${pageGuideSuite.idPrefix}-guide`);
  // Derived rather than set in an effect, so the panel is already in the DOM when the route's scroll runs
  const guidePanelOpen = !!guideSuite && (guideOpen || (routeTargetsGuide && guideDismissedOn !== route.hash));
  const spaceBesideNav = viewportWidth - (navCollapsed ? 0 : navWidth);
  const guideLimit = Math.max(GUIDE_SIZE.min, spaceBesideNav - MAIN_MIN_WIDTH);
  const guideShownWidth = clampWidth(GUIDE_SIZE, guideWidth ?? Math.round(spaceBesideNav / 2), guideLimit);

  useEffect(() => {
    function onHashChange() {
      setRoute(parseRoute(location.hash, suites));
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [suites]);

  useEffect(() => {
    if (pageGuideSuite) setLastGuideId(pageGuideSuite.idPrefix);
  }, [pageGuideSuite?.idPrefix]);

  // Runs after the new page is in the DOM, so the scroll target exists. A new route also drops
  // the previous page's filter in favour of its own — except when it only opens the guide, which
  // says nothing about which cases the reader is filtering.
  useEffect(() => {
    if (routeTargetsGuide) {
      setGuideOpen(true);
      writeGuideOpen(true);
    } else {
      setQuery(route.query);
    }
    scrollToRoute(route);
  }, [route.hash]);

  const navigate = useCallback(
    (entry: NavEntry) => {
      // Selecting the page already shown fires no hashchange, so apply its effects directly
      if (location.hash === entry.hash) {
        const same = parseRoute(entry.hash, suites);
        if (!same.target?.includes("-guide")) setQuery(same.query);
        scrollToRoute(same);
      } else {
        location.hash = entry.hash;
      }
    },
    [suites]
  );

  const setGuide = useCallback(
    (open: boolean) => {
      setGuideOpen(open);
      writeGuideOpen(open);
      setGuideDismissedOn(open ? null : route.hash);
    },
    [route.hash]
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const resizeGuide = useCallback((width: number) => {
    setGuideWidth(width);
    writePanelWidth(GUIDE_SIZE, width);
  }, []);

  const toggleChecklist = useCallback(() => {
    setChecklistOn((on) => {
      writeChecklistMode(!on);
      return !on;
    });
  }, []);

  const toggleInactive = useCallback(() => {
    setShowInactive((show) => {
      writeShowInactive(!show);
      return !show;
    });
  }, []);

  const resetGuideWidth = useCallback(() => {
    setGuideWidth(null);
    clearPanelWidth(GUIDE_SIZE);
  }, []);

  const resizeNav = useCallback((width: number) => {
    setNavWidth(width);
    writePanelWidth(NAV_SIZE, width);
  }, []);

  const toggleNav = useCallback(() => {
    setNavCollapsed((collapsed) => {
      writeNavCollapsed(!collapsed);
      return !collapsed;
    });
  }, []);

  const domains = groupByDomainAndFeature(suites);

  return html`
    <div>
      <${AppHeader} onOpenPalette=${() => setPaletteOpen(true)} navCollapsed=${navCollapsed} onToggleNav=${toggleNav} checklistOn=${checklistOn} onToggleChecklist=${toggleChecklist} />
      <${ChecklistContext.Provider} value=${checklistOn}>
      <div
        class=${"layout" + (navCollapsed ? " layout-nav-collapsed" : "")}
        style=${{ "--nav-w": `${navWidth}px`, "--guide-w": `${guideShownWidth}px` }}
      >
        <${NavOutline} suites=${suites} route=${route} onNavigate=${navigate} width=${navWidth} onResize=${resizeNav} />
        <div class="app">
          ${route.mode === "full"
            ? domains.length === 0
              ? html`<p class="empty">No testcases.yaml files found.</p>`
              : domains.map((d) => html`<${DomainSection} key=${d.domain} group=${d} />`)
            : html`<${ScopePage}
                route=${route}
                suites=${suites}
                rows=${overviewRows}
                query=${query}
                onQueryChange=${setQuery}
                guideOpen=${guidePanelOpen}
                onToggleGuide=${() => setGuide(!guidePanelOpen)}
                showInactive=${showInactive}
                onToggleInactive=${toggleInactive}
              />`}
        </div>
        ${guidePanelOpen && guideSuite
          ? html`<${GuidePanel}
              suite=${guideSuite}
              width=${guideShownWidth}
              limit=${guideLimit}
              onClose=${() => setGuide(false)}
              onResize=${resizeGuide}
              onResetWidth=${resetGuideWidth}
            />`
          : null}
      </div>
      </${ChecklistContext.Provider}>
      ${paletteOpen
        ? html`<${CommandPalette}
            entries=${[ALL_TEST_CASES_ENTRY, ONE_PAGE_ENTRY, ...entries]}
            overviewRows=${overviewRows}
            onClose=${() => setPaletteOpen(false)}
            onJump=${navigate}
          />`
        : null}
    </div>
  `;
}

function connectAutoReload() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.onmessage = (event) => {
    if (event.data === "reload") {
      location.reload();
    }
  };
  ws.onclose = () => {
    // Reconnect if the connection drops (e.g. the server restarted)
    setTimeout(connectAutoReload, 1000);
  };
}

const root = document.getElementById("app");
if (root) {
  render(html`<${App} />`, root);
}
if (window.__LIVE_RELOAD__) {
  connectAutoReload();
}
