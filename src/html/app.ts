// Browser-side UI (Preact + htm). Bundled by src/html/generate.ts via Bun.build()
// and inlined into the generated HTML.

import { h, render } from "preact";
import { useState, useCallback, useEffect, useRef } from "preact/hooks";
import htmBind from "htm";

const html = htmBind.bind(h);

interface Step {
  action: string;
  expected: string;
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

function formatPreconditions(preconditions: unknown[] | undefined): string {
  if (!preconditions || preconditions.length === 0) return "";
  return preconditions
    .map((p) => {
      if (typeof p === "object" && p !== null) {
        return Object.entries(p as Record<string, unknown>)
          .map(([k, v]) => `${k}: ${v}`)
          .join("");
      }
      return String(p);
    })
    .map((p) => `- ${p}`)
    .join("\n");
}

function isObjectArray(arr: unknown[]): boolean {
  return arr.some((item) => typeof item === "object" && item !== null);
}

function formatArrayAsTable(dataArray: Array<Record<string, unknown>>): string {
  if (!dataArray || dataArray.length === 0) return "";
  const allKeys = new Set<string>();
  for (const item of dataArray) {
    for (const key of Object.keys(item)) allKeys.add(key);
  }
  const keys = Array.from(allKeys);
  if (keys.length === 0) return "";

  const headerRow = `| ${keys.join(" | ")} |`;
  const separatorRow = `|${keys.map(() => "---").join("|")}|`;
  const dataRows = dataArray.map((item) => {
    const values = keys.map((key) => {
      const value = item[key];
      if (value === undefined || value === null) return "";
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    });
    return `| ${values.join(" | ")} |`;
  });
  return [headerRow, separatorRow, ...dataRows].join("\n");
}

function formatTestData(testData: unknown): string {
  if (!testData) return "";
  const lines: string[] = [];

  if (Array.isArray(testData)) {
    if (isObjectArray(testData)) {
      return formatArrayAsTable(testData as Array<Record<string, unknown>>);
    }
    return testData.join(", ");
  }

  for (const [key, value] of Object.entries(testData as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      if (isObjectArray(value)) {
        lines.push(`- **${key}:**`, "", formatArrayAsTable(value as Array<Record<string, unknown>>), "");
      } else {
        lines.push(`- **${key}:** ${value.join(", ")}`);
      }
    } else if (typeof value === "object" && value !== null) {
      const entries = Object.entries(value as Record<string, unknown>);
      const allScalar = entries.every(([, v]) => typeof v !== "object" || v === null);
      if (allScalar) {
        lines.push(`- **${key}:**`);
        for (const [k, v] of entries) lines.push(`  - ${k}: ${v}`);
      } else {
        lines.push(`- **${key}:** \`${JSON.stringify(value)}\``);
      }
    } else {
      lines.push(`- **${key}:** ${value}`);
    }
  }

  return lines.join("\n");
}

function formatStepsAsMarkdownTable(steps: Step[]): string {
  if (!steps || steps.length === 0) return "";
  const lines = ["| # | Action | Expected |", "|:---:|------|----------|"];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const action = (step.action || "").replace(/\n/g, "<br>");
    const expected = (step.expected || "").replace(/\n/g, "<br>").replace(/- /g, "• ");
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

function CopyButton({ getText, title }: { getText: () => string; title: string }) {
  const [copied, setCopied] = useState(false);

  const onClick = useCallback(() => {
    navigator.clipboard.writeText(getText()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [getText]);

  return html`
    <button class="copy-btn ${copied ? "copy-btn-copied" : ""}" title=${title} onClick=${onClick}>
      ${copied
        ? html`<span>✓</span>`
        : html`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>`}
      <span>${copied ? "Copied" : "Copy"}</span>
    </button>
  `;
}

function StepsTable({ steps }: { steps: Step[] }) {
  return html`
    <table class="steps-table">
      <thead>
        <tr><th>#</th><th>Action</th><th>Expected</th></tr>
      </thead>
      <tbody>
        ${steps.map(
          (step, i) => html`
            <tr key=${i}>
              <td>${i + 1}</td>
              <td>${step.action}</td>
              <td dangerouslySetInnerHTML=${{ __html: (step.expected || "").replace(/\n/g, "<br>") }} />
            </tr>
          `
        )}
      </tbody>
    </table>
  `;
}

function TestCaseCard({ tc }: { tc: TestCase; idPrefix: string }) {
  const inactive = isInactive(tc);
  return html`
    <div class="test-case ${inactive ? "test-case-inactive" : ""}" id=${testCaseAnchorId(tc._tcId)}>
      <h4 class="test-case-title sticky-header sticky-level-4">
        ${tc._tcId}: ${tc.name}
        ${tc.status === "obsolete"
          ? html`<span class="badge badge-status" title=${tc.reason ?? ""}>obsolete</span>`
          : null}
        ${tc.status === "superseded"
          ? html`<span class="badge badge-status" title=${tc.reason ?? ""}>superseded${tc.superseded_by ? ` → ${tc.superseded_by}` : ""}</span>`
          : null}
        ${tc.skip
          ? html`<span class="badge badge-skip" title=${tc.skip.reason}>skip${tc.skip.until ? ` (until ${tc.skip.until})` : ""}</span>`
          : null}
        ${tc.automation && tc.automation !== "manual"
          ? html`<span class="badge badge-automation" title=${tc.scenario ?? ""}>${tc.automation}</span>`
          : null}
      </h4>
      ${tc.legacy_marker ? html`<div class="legacy-marker">元の表記: ${tc.legacy_marker}</div>` : null}
      ${tc.preconditions && tc.preconditions.length > 0
        ? html`<div class="preconditions">
            <strong>Preconditions:</strong>
            <ul>
              ${tc.preconditions.map((p, i) => html`<li key=${i}>${typeof p === "object" ? JSON.stringify(p) : String(p)}</li>`)}
            </ul>
          </div>`
        : null}
      <${StepsTable} steps=${tc.steps} />
      ${tc.notes ? html`<div class="notes">📝 ${tc.notes}</div>` : null}
    </div>
  `;
}

/** Renders a count as "active (total)" when some cases are obsolete/superseded/skipped, otherwise just the total. */
function CountLabel({ testCases }: { testCases: TestCase[] }) {
  const total = testCases.length;
  const activeCount = testCases.filter((tc) => !isInactive(tc)).length;
  return activeCount === total ? html`${total}` : html`${activeCount} <span class="count-total">(${total})</span>`;
}

function CategorySection({ idPrefix, category, testCases }: { idPrefix: string; category: string; testCases: TestCase[] }) {
  return html`
    <section class="category-section" id=${categoryAnchorId(idPrefix, category)}>
      <div class="category-header sticky-header sticky-level-3">
        <h3>${category}</h3>
        <div class="category-header-right">
          <span class="count"><${CountLabel} testCases=${testCases} /></span>
          <${CopyButton} title="Copy this section as Markdown" getText=${() => categoryToMarkdown(category, testCases)} />
        </div>
      </div>
      ${testCases.map((tc) => html`<${TestCaseCard} key=${tc._tcId} tc=${tc} idPrefix=${idPrefix} />`)}
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
  anchorId: string;
  name: string;
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
              anchorId: testCaseAnchorId(tc._tcId),
              name: tc.name,
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
  return [row.tcId, ...OVERVIEW_LEVELS.map((level) => row.labels[level]), row.name].join(" ");
}

function filterOverviewRows(rows: OverviewRow[], query: string): OverviewRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => overviewRowSearchText(row).toLowerCase().includes(q));
}

/** Column headings, shared by the rendered table and the Markdown export so they cannot drift */
const OVERVIEW_COLUMNS = ["ID", "Domain", "Feature", "Test Suite", "Section", "Name"];

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
    const cells = [row.tcId, ...OVERVIEW_LEVELS.map((level) => row.labels[level]), row.name];
    lines.push(`| ${cells.map(escapeMarkdownCell).join(" | ")} |`);
  }
  return lines.join("\n");
}

/**
 * Flat table of every test case across all suites. Selecting a row jumps to it in the detail view.
 * The filter is seeded from `#/overview?q=…` so the command palette can hand off a query.
 */
function OverviewTable({
  rows,
  query,
  onQueryChange,
  onSelect,
}: {
  rows: OverviewRow[];
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (anchorId: string) => void;
}) {
  if (rows.length === 0) {
    return html`<p class="empty">No testcases.yaml files found.</p>`;
  }

  const trimmedQuery = query.trim();
  const visibleRows = filterOverviewRows(rows, trimmedQuery);

  return html`
    <section class="overview">
      <h2 class="overview-title sticky-header sticky-level-0">
        <span class="suite-title-text">Overview</span>
        <span class="suite-title-right">
          <span class="suite-title-count">
            ${trimmedQuery ? `${visibleRows.length} / ${rows.length}` : rows.length} test case(s)
          </span>
          <${CopyButton}
            title="Copy the listed test cases as Markdown"
            getText=${() => overviewToMarkdown(visibleRows)}
          />
        </span>
      </h2>
      <input
        class="overview-search"
        type="search"
        placeholder="🔍 Filter by ID, name, domain, feature, test suite, or section"
        value=${query}
        onInput=${(e: Event) => onQueryChange((e.target as HTMLInputElement).value)}
      />
      ${visibleRows.length === 0
        ? html`<p class="empty">No matches</p>`
        : html`<table class="overview-table">
        <thead>
          <tr>
            ${OVERVIEW_COLUMNS.map((column) => html`<th key=${column}>${column}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${visibleRows.map(
            (row, i) => html`
              <tr key=${row.tcId} class="overview-row" onClick=${() => onSelect(row.anchorId)}>
                <td class="overview-id">
                  <button
                    class="overview-link"
                    onClick=${(e: Event) => {
                      e.stopPropagation();
                      onSelect(row.anchorId);
                    }}
                  >
                    ${row.tcId}
                  </button>
                </td>
                ${OVERVIEW_LEVELS.map((level) => {
                  // Compared against the previous *visible* row, so filtering never leaves a
                  // dimmed value with nothing above it to repeat
                  const repeated = i > 0 && visibleRows[i - 1].keys[level] === row.keys[level];
                  return html`
                    <td key=${level} class=${"overview-hier" + (repeated ? " overview-repeat" : "")}>
                      ${row.labels[level]}
                    </td>
                  `;
                })}
                <td>${row.name}</td>
              </tr>
            `
          )}
        </tbody>
      </table>`}
    </section>
  `;
}

function featureAnchorId(domain: string, feature: string): string {
  return `domain-${encodeURIComponent(domain)}-feature-${encodeURIComponent(feature)}`;
}

function SuiteSection({ suite }: { suite: SuitePageData }) {
  const grouped = groupByCategory(suite.testCases);

  return html`
    <section class="suite-section" id=${suiteAnchorId(suite.idPrefix)}>
      <h1 class="suite-title sticky-header sticky-level-2">
        <span class="suite-title-text">${suite.idPrefix}: ${suite.typeName}</span>
        <span class="suite-title-right">
          <span class="suite-title-count"><${CountLabel} testCases=${suite.testCases} /></span>
          <${CopyButton} title="Copy all test cases as Markdown" getText=${() => allTestCasesToMarkdown(suite)} />
        </span>
      </h1>
      ${suite.guideHtml
        ? html`<details class="guide" id=${guideAnchorId(suite.idPrefix)}>
            <summary class="guide-summary">📖 Guide</summary>
            <div class="guide-body" dangerouslySetInnerHTML=${{ __html: suite.guideHtml }} />
          </details>`
        : null}
      <main>
        ${grouped.map(([category, cases]) => html`<${CategorySection} key=${category} idPrefix=${suite.idPrefix} category=${category} testCases=${cases} />`)}
      </main>
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
          <span class="suite-title-count">${domainTestCaseCount(group)}</span>
          <${CopyButton} title="Copy this domain as Markdown" getText=${() => domainToMarkdown(group)} />
        </span>
      </h2>
      ${group.features.map((f) => html`<${FeatureSection} key=${f.feature} domain=${group.domain} group=${f} />`)}
    </div>
  `;
}

interface NavEntry {
  kind: "view" | "domain" | "feature" | "suite" | "guide" | "category" | "testcase";
  /** An element ID to scroll to — except for `view` entries, where it is the route hash */
  id: string;
  label: string;
  /** Search text. Kept separate from the display label so terms not shown (like idPrefix) still match. */
  searchText: string;
  /** Breadcrumb shown in the command palette (e.g. "web › Login › Basic flow"). Undefined for domains. */
  breadcrumb?: string;
  count?: number;
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
  return parts.join(" ");
}

/**
 * How guides are represented, which differs by surface: the outline is a structure map, where
 * one entry per guide heading buries the test cases it is supposed to introduce, while the
 * palette is a search surface, where that same granularity is the point.
 */
type GuideDetail = "collapsed" | "headings";

/** Flattens every test suite into domain -> feature -> suite -> guide -> section -> test case navigation entries */
function buildNavEntries(suites: SuitePageData[], guideDetail: GuideDetail): NavEntry[] {
  const entries: NavEntry[] = [];
  const domains = groupByDomainAndFeature(suites);

  for (const d of domains) {
    entries.push({
      kind: "domain",
      id: domainAnchorId(d.domain),
      label: d.domainLabel,
      searchText: `${d.domain} ${d.domainLabel}`,
      count: domainTestCaseCount(d).active,
    });
    for (const f of d.features) {
      entries.push({
        kind: "feature",
        id: featureAnchorId(d.domain, f.feature),
        label: f.featureLabel,
        searchText: `${f.feature} ${f.featureLabel}`,
        breadcrumb: d.domainLabel,
        count: featureTestCaseCount(f).active,
      });
      for (const suite of f.suites) {
        entries.push({
          kind: "suite",
          id: suiteAnchorId(suite.idPrefix),
          label: suite.typeName,
          // Not part of the display label, but lets searching by idPrefix (e.g. "CR") match the suite itself
          searchText: `${suite.idPrefix} ${suite.typeName}`,
          breadcrumb: `${d.domainLabel} › ${f.featureLabel}`,
          count: suite.testCases.length,
        });
        const guideBreadcrumb = `${d.domainLabel} › ${f.featureLabel} › ${suite.typeName}`;
        if (guideDetail === "collapsed") {
          // Keyed off guideHtml, not guideHeadings: a guide with no h2 still needs an entry
          if (suite.guideHtml) {
            entries.push({
              kind: "guide",
              id: guideAnchorId(suite.idPrefix),
              label: "Guide",
              searchText: `${suite.idPrefix} guide ${suite.guideText}`,
              breadcrumb: guideBreadcrumb,
            });
          }
        } else {
          for (const heading of suite.guideHeadings) {
            entries.push({
              kind: "guide",
              id: heading.id,
              label: heading.text,
              searchText: `${suite.idPrefix} ${heading.text} ${heading.body}`,
              breadcrumb: guideBreadcrumb,
            });
          }
        }
        const grouped = groupByCategory(suite.testCases);
        for (const [category, cases] of grouped) {
          entries.push({
            kind: "category",
            id: categoryAnchorId(suite.idPrefix, category),
            label: category,
            searchText: `${suite.idPrefix} ${category}`,
            breadcrumb: `${d.domainLabel} › ${f.featureLabel} › ${suite.typeName}`,
            count: cases.length,
          });
          for (const tc of cases) {
            entries.push({
              kind: "testcase",
              id: testCaseAnchorId(tc._tcId),
              label: `${tc._tcId}: ${tc.name}`,
              searchText: testCaseSearchText(tc),
              breadcrumb: `${d.domainLabel} › ${f.featureLabel} › ${suite.typeName} › ${category}`,
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

function matchesQuery(entry: NavEntry, query: string): boolean {
  return entry.searchText.toLowerCase().includes(query.toLowerCase());
}

/**
 * Left-side navigation spanning every test suite.
 * - Click to jump; the current position is highlighted based on scroll position.
 * - Typing in the search box filters to matching entries (suite/section/test case).
 */
function NavOutline({
  suites,
  view,
  onNavigate,
  onSetView,
}: {
  suites: SuitePageData[];
  view: RouteView;
  onNavigate: (id: string, kind: NavEntry["kind"]) => void;
  onSetView: (view: RouteView) => void;
}) {
  const entries = buildNavEntries(suites, "collapsed");
  const [currentId, setCurrentId] = useState<string | null>(entries[0]?.id ?? null);
  const [query, setQuery] = useState("");
  const suppressUntil = useRef(0);

  useEffect(() => {
    function compute() {
      // The overview view has none of these anchors, so there is nothing to track
      if (view !== "detail") return;
      if (Date.now() < suppressUntil.current) return;
      const threshold = window.innerHeight * 0.25;
      let current: string | null = null;
      for (const entry of entries) {
        const el = document.getElementById(entry.id);
        if (!el) continue;
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
  }, [suites, view]);

  const onJump = useCallback(
    (entry: NavEntry) => {
      setCurrentId(entry.id);
      // Suppress scroll-spy briefly after a jump so it doesn't immediately switch to another entry
      suppressUntil.current = Date.now() + 700;
      onNavigate(entry.id, entry.kind);
    },
    [onNavigate]
  );

  const trimmedQuery = query.trim();
  const visibleEntries = trimmedQuery ? entries.filter((e) => matchesQuery(e, trimmedQuery)) : entries;

  return html`
    <nav class="nav-outline">
      <div class="view-toggle">
        <button
          class=${"view-toggle-btn" + (view === "overview" ? " view-toggle-active" : "")}
          onClick=${() => onSetView("overview")}
        >
          Overview
        </button>
        <button
          class=${"view-toggle-btn" + (view === "detail" ? " view-toggle-active" : "")}
          onClick=${() => onSetView("detail")}
        >
          Test Cases
        </button>
      </div>
      <div class="nav-outline-title">Test Cases</div>
      <input
        class="nav-search"
        type="search"
        placeholder="🔍 Search test suites, sections, test cases"
        value=${query}
        onInput=${(e: Event) => setQuery((e.target as HTMLInputElement).value)}
      />
      <ul>
        ${visibleEntries.map(
          (entry) => html`
            <li key=${entry.id} class=${entryKindClass(entry.kind)}>
              <button
                class=${"nav-outline-item" + (view === "detail" && entry.id === currentId ? " nav-outline-current" : "")}
                onClick=${() => onJump(entry)}
              >
                ${entry.label}${entry.count !== undefined ? html` <span class="count">(${entry.count})</span>` : null}
              </button>
            </li>
          `
        )}
        ${trimmedQuery && visibleEntries.length === 0 ? html`<li class="nav-empty">No matches</li>` : null}
      </ul>
    </nav>
  `;
}

type RouteView = "overview" | "detail";

interface Route {
  view: RouteView;
  /** Deep-link target from `#/tc/<id>`; null when the hash names no test case */
  testCaseId: string | null;
  /** Overview filter seeded from `#/overview?q=<query>`; empty when unfiltered */
  query: string;
}

const OVERVIEW_HASH = "#/overview";
const DETAIL_HASH = "#/";

/**
 * Command-palette-only entry, so the overview is reachable without going for the sidebar
 * toggle. The sidebar itself has that toggle, so this is not part of buildNavEntries.
 */
const OVERVIEW_ENTRY: NavEntry = {
  kind: "view",
  id: OVERVIEW_HASH,
  label: "Overview",
  searchText: "overview index list table all test cases",
};

/**
 * Hash routing, not the History API: the `--out` build has to work when opened over
 * file://, where pushState throws and a real path would not resolve at all.
 * Routes are namespaced under `#/` so they can never collide with an element ID and
 * trigger the browser's own anchor jump.
 */
function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "");
  if (path === DETAIL_HASH.slice(1)) return { view: "detail", testCaseId: null, query: "" };

  const testCase = /^\/tc\/(.+)$/.exec(path);
  if (testCase) return { view: "detail", testCaseId: decodeURIComponent(testCase[1]), query: "" };

  // Overview is the landing view: opening the file with no hash should show what is in it
  // before dropping the reader into one suite's test cases.
  const overview = /^\/overview(?:\?q=(.*))?$/.exec(path);
  return {
    view: "overview",
    testCaseId: null,
    query: overview?.[1] ? decodeURIComponent(overview[1]) : "",
  };
}

function overviewHash(query: string): string {
  const trimmed = query.trim();
  return trimmed ? `${OVERVIEW_HASH}?q=${encodeURIComponent(trimmed)}` : OVERVIEW_HASH;
}

/** Shared jump-to-ID logic, used by both NavOutline and CommandPalette. */
function jumpToId(id: string, onDone?: () => void) {
  const el = document.getElementById(id);
  if (!el) return;
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
  onJump: (id: string, kind: NavEntry["kind"]) => void;
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
            label: `Filter Overview by "${trimmed}"`,
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
          onJump(target.id, target.kind);
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
                    onJump(entry.id, entry.kind);
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

function AppHeader({ onOpenPalette }: { onOpenPalette: () => void }) {
  const shortcut = navigator.userAgent.includes("Mac") ? "⌘K" : "Ctrl+K";

  return html`
    <header class="app-header">
      <span class="app-header-title">Test Cases</span>
      <div class="app-header-actions">
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

function App() {
  const suites = window.__SUITES__;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  const entries = buildNavEntries(suites, "headings");
  const overviewRows = buildOverviewRows(suites);
  /**
   * Local so typing in the overview's filter box does not push a history entry per keystroke.
   * The route only seeds it — see the effect below.
   */
  const [overviewQuery, setOverviewQuery] = useState(route.query);
  /** Anchor to scroll to once the detail view has rendered (set when jumping out of the overview) */
  const pendingScroll = useRef<string | null>(null);

  useEffect(() => {
    setOverviewQuery(route.query);
  }, [route.query]);

  useEffect(() => {
    function onHashChange() {
      setRoute(parseRoute(location.hash));
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Runs after the detail view is in the DOM, so the target element exists
  useEffect(() => {
    if (route.view !== "detail") return;
    const target = pendingScroll.current ?? route.testCaseId;
    pendingScroll.current = null;
    if (target) jumpToId(target);
  }, [route]);

  const navigate = useCallback(
    (id: string, kind: NavEntry["kind"]) => {
      if (kind === "view") {
        // Same hash fires no hashchange, so apply the query the entry carries directly
        if (location.hash === id) setOverviewQuery(parseRoute(id).query);
        else location.hash = id;
        return;
      }
      if (kind === "testcase") {
        const next = `#/tc/${id}`;
        // Re-selecting the current target fires no hashchange, so jump directly
        if (location.hash === next) jumpToId(id);
        else location.hash = next;
        return;
      }
      // Only test cases get their own route; other anchors just scroll, switching views first if needed
      if (route.view === "detail") {
        jumpToId(id);
      } else {
        pendingScroll.current = id;
        location.hash = DETAIL_HASH;
      }
    },
    [route.view]
  );

  const setView = useCallback((view: RouteView) => {
    location.hash = view === "overview" ? OVERVIEW_HASH : DETAIL_HASH;
  }, []);

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

  const domains = groupByDomainAndFeature(suites);

  return html`
    <div>
      <${AppHeader} onOpenPalette=${() => setPaletteOpen(true)} />
      <div class="layout">
        <${NavOutline} suites=${suites} view=${route.view} onNavigate=${navigate} onSetView=${setView} />
        <div class="app">
          ${route.view === "overview"
            ? html`<${OverviewTable}
                rows=${overviewRows}
                query=${overviewQuery}
                onQueryChange=${setOverviewQuery}
                onSelect=${(id: string) => navigate(id, "testcase")}
              />`
            : domains.length === 0
              ? html`<p class="empty">No testcases.yaml files found.</p>`
              : domains.map((d) => html`<${DomainSection} key=${d.domain} group=${d} />`)}
        </div>
      </div>
      ${paletteOpen
        ? html`<${CommandPalette}
            entries=${route.view === "overview" ? entries : [OVERVIEW_ENTRY, ...entries]}
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
