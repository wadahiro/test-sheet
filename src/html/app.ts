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

interface TestCase {
  _tcId: string;
  name: string;
  category?: string;
  test_data?: unknown;
  preconditions?: unknown[];
  steps: Step[];
  notes?: string | null;
}

interface GuideHeading {
  id: string;
  text: string;
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

/** Renders a single test case as Markdown (for pasting into a PR/issue comment) */
function testCaseToMarkdown(tc: TestCase): string {
  const lines: string[] = [];
  lines.push(`### ${tc._tcId}`, "", `**${tc.name}**`, "");

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
function categoryToMarkdown(category: string, testCases: TestCase[]): string {
  const lines = [`## Section: ${category}`, ""];
  for (const tc of testCases) {
    lines.push(testCaseToMarkdown(tc), "---", "");
  }
  return lines.join("\n");
}

function allTestCasesToMarkdown(suite: SuitePageData): string {
  const grouped = groupByCategory(suite.testCases);
  const lines = [`# ${suite.idPrefix}: ${suite.typeName} Test Procedure`, "", `> ${suite.testCases.length} test case(s)`, ""];
  for (const [category, cases] of grouped) {
    lines.push(categoryToMarkdown(category, cases));
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
  return html`
    <div class="test-case" id=${testCaseAnchorId(tc._tcId)}>
      <h4 class="test-case-title sticky-header sticky-level-4">${tc._tcId}: ${tc.name}</h4>
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

function CategorySection({ idPrefix, category, testCases }: { idPrefix: string; category: string; testCases: TestCase[] }) {
  return html`
    <section class="category-section" id=${categoryAnchorId(idPrefix, category)}>
      <div class="category-header sticky-header sticky-level-3">
        <h3>${category}</h3>
        <div class="category-header-right">
          <span class="count">${testCases.length}</span>
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
          <span class="suite-title-count">${suite.testCases.length}</span>
          <${CopyButton} title="Copy all test cases as Markdown" getText=${() => allTestCasesToMarkdown(suite)} />
        </span>
      </h1>
      ${suite.guideHtml ? html`<div class="guide" dangerouslySetInnerHTML=${{ __html: suite.guideHtml }} />` : null}
      <main>
        ${grouped.map(([category, cases]) => html`<${CategorySection} key=${category} idPrefix=${suite.idPrefix} category=${category} testCases=${cases} />`)}
      </main>
    </section>
  `;
}

function featureTestCaseCount(group: FeatureGroup): number {
  return group.suites.reduce((sum, suite) => sum + suite.testCases.length, 0);
}

function domainTestCaseCount(group: DomainGroup): number {
  return group.features.reduce((sum, f) => sum + featureTestCaseCount(f), 0);
}

function FeatureSection({ domain, group }: { domain: string; group: FeatureGroup }) {
  return html`
    <div class="feature-section" id=${featureAnchorId(domain, group.feature)}>
      <h2 class="feature-title sticky-header sticky-level-1">
        <span class="suite-title-text">${group.featureLabel}</span>
        <span class="suite-title-count">${featureTestCaseCount(group)}</span>
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
        <span class="suite-title-count">${domainTestCaseCount(group)}</span>
      </h2>
      ${group.features.map((f) => html`<${FeatureSection} key=${f.feature} domain=${group.domain} group=${f} />`)}
    </div>
  `;
}

interface NavEntry {
  kind: "domain" | "feature" | "suite" | "guide" | "category" | "testcase";
  id: string;
  label: string;
  /** Search text. Kept separate from the display label so terms not shown (like idPrefix) still match. */
  searchText: string;
  /** Breadcrumb shown in the command palette (e.g. "web › Login › Basic flow"). Undefined for domains. */
  breadcrumb?: string;
  count?: number;
}

const KIND_LABEL: Record<NavEntry["kind"], string> = {
  domain: "Domain",
  feature: "Feature",
  suite: "Test Suite",
  guide: "Guide",
  category: "Section",
  testcase: "Test Case",
};

/** Flattens every test suite into domain -> feature -> suite -> guide heading -> section -> test case navigation entries */
function buildNavEntries(suites: SuitePageData[]): NavEntry[] {
  const entries: NavEntry[] = [];
  const domains = groupByDomainAndFeature(suites);

  for (const d of domains) {
    entries.push({
      kind: "domain",
      id: domainAnchorId(d.domain),
      label: d.domainLabel,
      searchText: `${d.domain} ${d.domainLabel}`,
    });
    for (const f of d.features) {
      entries.push({
        kind: "feature",
        id: featureAnchorId(d.domain, f.feature),
        label: f.featureLabel,
        searchText: `${f.feature} ${f.featureLabel}`,
        breadcrumb: d.domainLabel,
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
        for (const heading of suite.guideHeadings) {
          entries.push({
            kind: "guide",
            id: heading.id,
            label: heading.text,
            searchText: `${suite.idPrefix} ${heading.text}`,
            breadcrumb: `${d.domainLabel} › ${f.featureLabel} › ${suite.typeName}`,
          });
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
              searchText: `${tc._tcId} ${tc.name}`,
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
function NavOutline({ suites }: { suites: SuitePageData[] }) {
  const entries = buildNavEntries(suites);
  const [currentId, setCurrentId] = useState<string | null>(entries[0]?.id ?? null);
  const [query, setQuery] = useState("");
  const suppressUntil = useRef(0);

  useEffect(() => {
    function compute() {
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
  }, [suites]);

  const onJump = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    setCurrentId(id);
    // Suppress scroll-spy briefly after a jump so it doesn't immediately switch to another entry
    suppressUntil.current = Date.now() + 700;
    el.scrollIntoView({ block: "start" });
  }, []);

  const trimmedQuery = query.trim();
  const visibleEntries = trimmedQuery ? entries.filter((e) => matchesQuery(e, trimmedQuery)) : entries;

  return html`
    <nav class="nav-outline">
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
                class=${"nav-outline-item" + (entry.id === currentId ? " nav-outline-current" : "")}
                onClick=${() => onJump(entry.id)}
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

/** Shared jump-to-ID logic, used by both NavOutline and CommandPalette. */
function jumpToId(id: string, onDone?: () => void) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ block: "start" });
  el.classList.add("jump-flash");
  setTimeout(() => el.classList.remove("jump-flash"), 1200);
  onDone?.();
}

/**
 * Command palette opened with Cmd+K / Ctrl+K. Incremental search filters test
 * suites, sections, and test cases; arrow keys + Enter jump to the selected entry.
 */
function CommandPalette({ entries, onClose }: { entries: NavEntry[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const q = query.trim().toLowerCase();
  const results = (q ? entries.filter((e) => e.searchText.toLowerCase().includes(q)) : entries).slice(0, 50);
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
        if (target) jumpToId(target.id, onClose);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [results, clampedSelected, onClose]
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
                  onClick=${() => jumpToId(entry.id, onClose)}
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

function App() {
  const suites = window.__SUITES__;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const entries = buildNavEntries(suites);

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
    <div class="layout">
      <${NavOutline} suites=${suites} />
      <div class="app">
        ${domains.length === 0
          ? html`<p class="empty">No testcases.yaml files found.</p>`
          : domains.map((d) => html`<${DomainSection} key=${d.domain} group=${d} />`)}
      </div>
      ${paletteOpen ? html`<${CommandPalette} entries=${entries} onClose=${() => setPaletteOpen(false)} />` : null}
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
