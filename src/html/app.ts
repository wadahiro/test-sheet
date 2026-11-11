// Browser-side UI (Preact + htm). Bundled by src/html/generate.ts via Bun.build()
// and inlined into the generated HTML.

import { h, render, createContext, type ComponentChildren } from "preact";
import { useState, useCallback, useEffect, useMemo, useRef, useContext } from "preact/hooks";
import htmBind from "htm";
import { formatPreconditions, formatTestData, preconditionText } from "./caseFormat";
import { caseRunKey, deleteRunData, emptyPlan, planKey, readPlan, readRunIndex, recordedCaseIds, rereadRunIndex, runIndexKey, runImagePrefix, runNamespace, todayStamp, touchRun, withNewRun, withoutRun, withRenamedRun, writePlan, writeRunIndex, type Decision, type Plan, type RunIndex, type RunMeta } from "./runStore";
import { highlightHtml, highlightLines } from "./highlight";
import type { Layers } from "../testCases";
import type { SourceContainer, SourceSnippet } from "../testSources";
import type { CoveredBy, Dropped } from "../coverage";
import { currentLocaleCode, formattingLocale, matchLocale, mergeLocales, setLocale, t, tn, type LocaleDefinition, type MessageKey } from "./i18n";
import { countImagesWithPrefix, blobToPng, loadImages, removeCaseImages, removeImage, saveImage, shrinkImage } from "./runImages";

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
  automation?: "manual" | "automated" | "semi";
  /** semi: what a person still checks by hand */
  automation_note?: string;
  layer?: string;
  layerLabel?: string;
  layerDescription?: string;
  automation_reason?: string;
  covered_by?: CoveredBy[];
  dropped?: Dropped[];
  /** `automation_note` rendered as Markdown at generation time */
  automationNoteHtml?: string;
  /** Test code that mentions the case; only for an automated or semi case, and absent when no code was searched */
  sources?: SourceSnippet[];
  /** Where test code mentions a case declared manual, which suggests the declaration is out of date */
  unexpectedSources?: string[];
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
  layers?: Layers;
  /** Top-level directory name under the root (e.g. "web", "api"). The domain. */
  domain: string;
  /** Human-readable name from the domain's README.md heading (falls back to domain) */
  domainLabel: string;
  /** Directory name under domain (e.g. "login"). The feature. A feature can have multiple test suites. */
  feature: string;
  /** Human-readable name from the feature's README.md heading (falls back to feature) */
  featureLabel: string;
  typeName: string;
  /** The only suite of its feature: the two levels are one node, named by `featureLabel` */
  folded: boolean;
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
    /** Languages supplied with `--locale`, on top of the built-in ones */
    __LOCALES__?: LocaleDefinition[];
    /** Each test file a case shows a piece of, gzipped and base64-encoded, by the path the snippet carries */
    __SOURCE_FILES__?: Record<string, string>;
  }
}

function formatStepsAsMarkdownTable(steps: Step[], run?: (RunState & { images?: Record<number, RunImage[]> }) | null): string {
  if (!steps || steps.length === 0) return "";
  const head = ["#", t("step.action"), t("step.expected"), ...(run ? [t("step.result")] : [])];
  const lines = [`| ${head.join(" | ")} |`, run ? "|:---:|------|----------|--------|" : "|:---:|------|----------|"];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const action = escapeMarkdownCell(step.action || "");
    const expected = escapeMarkdownCell((step.expected || "").replace(/^(\s*)- /gm, "$1• "));
    if (!run) {
      lines.push(`| ${i + 1} | ${action} | ${expected} |`);
      continue;
    }
    const result = run.results[i];
    const note = run.notes[i] ? ` — ${escapeMarkdownCell(run.notes[i])}` : "";
    const cell = result === "p" ? t("result.pass") : result === "f" ? `**${t("result.fail")}**${note}` : t("result.notRun");
    lines.push(`| ${i + 1} | ${action} | ${expected} | ${cell} |`);
  }
  return lines.join("\n");
}

/**
 * Renders a single test case as Markdown (for pasting into a PR/issue comment).
 * headingLevel is threaded down from whichever level was copied, so a domain-level copy
 * still nests its sections and test cases below the domain heading.
 */
function testCaseToMarkdown(tc: TestCase, headingLevel = 3, run: (RunState & { images?: Record<number, RunImage[]>; runName?: string }) | null = null): string {
  const recorded = run && caseOutcome(run.results) !== "none" ? run : null;
  const lines: string[] = [];
  lines.push(`${"#".repeat(headingLevel)} ${tc._tcId}`, "", `**${tc.name}**`, "");

  if (tc.preconditions && tc.preconditions.length > 0) {
    lines.push(`**${t("md.preconditions")}:**`, formatPreconditions(tc.preconditions), "");
  }

  if (tc.test_data && (Array.isArray(tc.test_data) ? tc.test_data.length > 0 : Object.keys(tc.test_data as object).length > 0)) {
    lines.push(`**${t("md.testData")}:**`, "", formatTestData(tc.test_data), "");
  }

  if (tc.tags && tc.tags.length > 0) {
    lines.push(`**${t("md.tags")}:** ${tc.tags.join(", ")}`, "");
  }

  if (tc.layer) lines.push(`**${t("layer.label")}:** ${tc.layerLabel ?? tc.layer}`, "");
  if (tc.automation_reason) lines.push(`**${t("layer.reason")}:** ${tc.automation_reason}`, "");
  if (tc.automation && tc.automation !== "manual") lines.push(`**${t("md.method")}:** ${testMethod(tc)}`, "");
  if (tc.automation_note) {
    const noteLines = tc.automation_note.trim().split("\n");
    lines.push(`**${t("md.automationNote")}:** ${noteLines[0]}`, ...noteLines.slice(1), "");
  }

  for (const source of tc.sources ?? []) {
    lines.push(`**${t("md.source")}:**${source.title ? ` ${source.title}` : ""}`, "", `\`${source.file}:${source.startLine}–${source.endLine}\``, "", "```" + source.file.slice(source.file.lastIndexOf(".") + 1), source.code, "```", "");
  }

  const handoffLines = [
    ...(tc.covered_by ?? []).map((item) => t("md.handoffMoved", { what: item.what, kind: handoffKindLabel(handoffKind(item)), target: handoffTarget(item) })),
    ...(tc.dropped ?? []).map((item) => t("md.handoffDropped", { what: item.what, reason: item.reason })),
  ];
  if (handoffLines.length > 0) lines.push(`**${t("md.handoff")}:**`, "", ...handoffLines.map((line) => `- ${line}`), "");

  if (recorded) {
    const outcome = caseOutcome(recorded.results);
    const label = outcome === "pass" ? t("result.pass") : outcome === "fail" ? t("result.fail") : t("result.inProgress");
    const marked = recorded.results.filter((result) => result !== "").length;
    const when = recorded.recordedAt ? t("md.resultRecorded", { date: recorded.recordedAt.slice(0, 10) }) : "";
    const named = recorded.runName ? t("md.resultNamed", { name: recorded.runName }) : "";
    lines.push(`**${t("md.result")}:** ${t("md.resultLine", { label, marked, total: recorded.results.length, named, when })}`, "");
  }

  lines.push(`**${t("md.steps")}:**`, "", formatStepsAsMarkdownTable(tc.steps, recorded), "");

  // An image cannot travel inside Markdown (trackers drop data: URLs), so each one gets a marked spot
  // to paste it into, after copying it from the sheet
  const shotLines = Object.entries(recorded?.images ?? {}).flatMap(([step, list]) =>
    list.map((_, n) => `- ${t("md.screenshotItem", { step: Number(step) + 1, n: n + 1 })}`)
  );
  if (shotLines.length > 0) lines.push(`**${t("md.screenshots")}:**`, "", ...shotLines, "");

  if (tc.notes) {
    const notesLines = tc.notes.split("\n");
    lines.push(`> **${t("md.note")}:** ${notesLines[0]}`);
    for (let i = 1; i < notesLines.length; i++) lines.push(`> ${notesLines[i]}`);
    lines.push("");
  }

  return lines.join("\n");
}

function premiseHeadings(tc: TestCase, previous?: TestCase): { text: string; depth: number }[] {
  const values = tc.preconditions ?? [];
  const before = previous?.preconditions ?? [];
  let shared = 0;
  while (shared < values.length && shared < before.length && JSON.stringify(values[shared]) === JSON.stringify(before[shared])) shared++;
  if (values.length < before.length && shared === values.length) shared = Math.max(0, shared - 1);
  return values.slice(shared).map((value, i) => ({ text: preconditionText(value), depth: shared + i }));
}

function layerSummary(cases: TestCase[], declarations: Layers = {}): ComponentChildren {
  const keys = [...new Set([...Object.keys(declarations), ...cases.map((tc) => tc.layer ?? "")])];
  return keys.map((key) => {
    const matching = cases.filter((tc) => (tc.layer ?? "") === key);
    const counts = { automated: 0, semi: 0, manual: 0 };
    for (const tc of matching) counts[caseMethodKey(tc)]++;
    return html`<div title=${declarations[key]?.description}><strong>${declarations[key]?.label ?? (key || t("layer.unspecified"))}</strong>: ${matching.length} (${t("method.automated")} ${counts.automated} / ${t("method.semi")} ${counts.semi} / ${t("method.manual")} ${counts.manual})</div>`;
  });
}

/** Renders every test case in a section as a single Markdown document */
function categoryToMarkdown(category: string, testCases: TestCase[], headingLevel = 2): string {
  const lines = [`${"#".repeat(headingLevel)} ${t("md.section", { name: category })}`, ""];
  testCases.forEach((tc, i) => {
    for (const premise of premiseHeadings(tc, testCases[i - 1])) lines.push(`${"#".repeat(Math.min(6, headingLevel + 1 + premise.depth))} ${premise.text}`, "");
    lines.push(testCaseToMarkdown({ ...tc, preconditions: [] }, Math.min(6, headingLevel + 1 + (tc.preconditions?.length ?? 0))), "---", "");
  });
  return lines.join("\n");
}

function allTestCasesToMarkdown(suite: SuitePageData, headingLevel = 1): string {
  const grouped = groupByCategory(suite.testCases);
  const lines = [
    `${"#".repeat(headingLevel)} ${suite.folded ? suite.featureLabel : t("md.suiteTitle", { prefix: suite.idPrefix, type: suite.typeName })}`,
    "",
    `> ${t("md.caseCount", { count: suite.testCases.length })}`,
    "",
  ];
  for (const [category, cases] of grouped) {
    lines.push(categoryToMarkdown(category, cases, headingLevel + 1));
  }
  return lines.join("\n");
}

/** The words of a query: whitespace (full-width too) separates them, and an entry has to contain every one */
function searchTerms(query: string): string[] {
  return query.toLowerCase().split(/[\s\u3000]+/).filter(Boolean);
}

const matchesTerms = (text: string, terms: string[]): boolean => {
  const lower = text.toLowerCase();
  return terms.every((term) => lower.includes(term));
};

/**
 * Where a word's letters fall in `text` when they appear in order but not together ("lgn" in "Login"),
 * as the tightest such run, or null. Words under two letters are left to plain matching, and a run
 * stretched over more than three times the word is not a match ("rate06" still reaches "RATELIMIT-006"): letters scattered through a long label would
 * otherwise make nearly everything match.
 */
function fuzzyPositions(text: string, term: string): number[] | null {
  if (term.length < 2) return null;
  const lower = text.toLowerCase();
  let best: number[] | null = null;
  for (let start = lower.indexOf(term[0]); start >= 0; start = lower.indexOf(term[0], start + 1)) {
    const at = [start];
    for (let i = 1; i < term.length; i++) {
      const next = lower.indexOf(term[i], at[i - 1] + 1);
      if (next < 0) break;
      at.push(next);
    }
    if (at.length < term.length) break;
    if (!best || at[at.length - 1] - at[0] < best[best.length - 1] - best[0]) best = at;
  }
  return best && best[best.length - 1] - best[0] + 1 <= term.length * 3 ? best : null;
}

/**
 * How well a palette entry answers a query, or null when it does not: each word counts most when it is
 * in the shown title, less when only in the searchable text (steps, notes, tags), least when its
 * letters merely occur in order in the title or breadcrumb.
 */
function paletteScore(entry: NavEntry, terms: string[]): number | null {
  const shown = `${entry.breadcrumb ?? ""} ${entry.label}`;
  const shownLower = shown.toLowerCase();
  const fullLower = entry.searchText.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (shownLower.includes(term)) score += 3;
    else if (fullLower.includes(term)) score += 2;
    else if (fuzzyPositions(shown, term)) score += 1;
    else return null;
  }
  return score;
}

/** The query's words as found in `text`, marked, so the reader sees why an entry or row matched */
function Highlight({ text, query, fuzzy = false }: { text: string; query: string; fuzzy?: boolean }) {
  const terms = searchTerms(query);
  if (terms.length === 0) return html`${text}`;
  const lower = text.toLowerCase();
  // Overlapping hits of different words become one mark
  const spans: Array<[number, number]> = [];
  for (const term of terms) {
    if (!lower.includes(term) && fuzzy) {
      for (const at of fuzzyPositions(text, term) ?? []) spans.push([at, at + 1]);
      continue;
    }
    for (let at = lower.indexOf(term); at >= 0; at = lower.indexOf(term, at + term.length)) spans.push([at, at + term.length]);
  }
  spans.sort((x, y) => x[0] - y[0]);
  const merged: Array<[number, number]> = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }
  const parts: Array<string | ReturnType<typeof html>> = [];
  let from = 0;
  for (const [start, end] of merged) {
    if (start > from) parts.push(text.slice(from, start));
    parts.push(html`<mark class="hit">${text.slice(start, end)}</mark>`);
    from = end;
  }
  parts.push(text.slice(from));
  return html`${parts}`;
}

/**
 * `navigator.clipboard` exists only in a secure context, so a page opened over plain http on a name
 * other than localhost (the serve mode's address on a LAN, say) has none and would fail without a
 * word. A hidden textarea and `execCommand` still work there.
 */
async function writeClipboardText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(box);
    box.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      box.remove();
    }
  }
}

function CopyButton({ getText, title, iconOnly = false }: { getText: () => string; title: string; iconOnly?: boolean }) {
  const [copied, setCopied] = useState(false);

  const onClick = useCallback(() => {
    writeClipboardText(getText()).then((ok) => {
      if (!ok) return;
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
        ? html`<span aria-hidden="true">✓</span>`
        : html`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>`}
      ${iconOnly ? null : html`<span>${copied ? t("copy.copied") : t("copy.copy")}</span>`}
    </button>
  `;
}

/** The run cards record into, or null when none is chosen, which is when the sheet is just read; shared by context so it need not be threaded through every list */
interface ActiveRun {
  id: string;
  name: string;
}

const RunContext = createContext<ActiveRun | null>(null);

/** Fired after every write of a case's marks, so the table can show progress without the cards being re-rendered for it */
const RUN_CHANGE_EVENT = "test-sheet-run-change";

/**
 * The cases the page lists, in table order, and a way to open one of them and scroll to it. Stepping
 * stays on the page (no hash change), so Previous / Next never carry the tester to another scope.
 */
interface CaseNav {
  order: string[];
  go: (tcId: string) => void;
}

const CaseNavContext = createContext<CaseNav | null>(null);

type StepResult = "" | "p" | "f";

interface StoredRun {
  v: 1;
  /** Hash of the steps' text, so a case edited since is not shown with marks for steps that changed */
  h: string;
  r: StepResult[];
  /** What the tester saw, for failed steps only, keyed by step index */
  n: Record<string, string>;
  t: string;
}

function stepsFingerprint(steps: Step[]): string {
  let hash = 5381;
  for (const step of steps) {
    for (const ch of `${step.action}\u0000${step.expected}\u0001`) hash = ((hash << 5) + hash + ch.charCodeAt(0)) | 0;
  }
  return String(hash);
}

function runKey(runId: string, tc: TestCase): string {
  return caseRunKey(runId, tc._tcId);
}

/** The first version of this feature only ticked steps, under a key without a namespace */
function legacyChecklistKey(tc: TestCase): string {
  return `test-sheet-checklist:${tc._tcId}`;
}

interface RunState {
  results: StepResult[];
  notes: Record<number, string>;
  recordedAt: string | null;
}

function emptyRun(tc: TestCase): RunState {
  return { results: tc.steps.map(() => ""), notes: {}, recordedAt: null };
}

function readRun(runId: string, tc: TestCase): RunState {
  const fingerprint = stepsFingerprint(tc.steps);
  try {
    const raw = localStorage.getItem(runKey(runId, tc));
    if (raw) {
      const stored = JSON.parse(raw) as StoredRun;
      if (stored.h !== fingerprint || stored.r.length !== tc.steps.length) return emptyRun(tc);
      return {
        results: stored.r,
        notes: Object.fromEntries(Object.entries(stored.n ?? {}).map(([i, text]) => [Number(i), text])),
        recordedAt: stored.t ?? null,
      };
    }
    const legacy = localStorage.getItem(legacyChecklistKey(tc));
    if (legacy) {
      const old = JSON.parse(legacy) as { h: string; done: number[] };
      localStorage.removeItem(legacyChecklistKey(tc));
      if (old.h === fingerprint) {
        const migrated: RunState = { ...emptyRun(tc), recordedAt: new Date().toISOString() };
        for (const i of old.done) if (i < migrated.results.length) migrated.results[i] = "p";
        writeRun(runId, tc, migrated);
        return migrated;
      }
    }
  } catch {
    // Unreadable or blocked storage: start from nothing
  }
  return emptyRun(tc);
}

function writeRun(runId: string, tc: TestCase, run: RunState) {
  try {
    if (run.results.every((result) => result === "")) {
      localStorage.removeItem(runKey(runId, tc));
    } else {
      const stored: StoredRun = {
        v: 1,
        h: stepsFingerprint(tc.steps),
        r: run.results,
        n: Object.fromEntries(Object.entries(run.notes).filter(([, text]) => text !== "")),
        t: run.recordedAt ?? new Date().toISOString(),
      };
      localStorage.setItem(runKey(runId, tc), JSON.stringify(stored));
      touchRun(runId);
    }
  } catch {
    // Blocked storage (e.g. over file://): the marks last for this visit only
  }
  window.dispatchEvent(new Event(RUN_CHANGE_EVENT));
}

/** A screenshot attached to a failed step, with an object URL to show it by */
interface RunImage {
  id: string;
  url: string;
  blob: Blob;
}

/** Screenshots a step may carry; a failure rarely needs more, and each costs storage */
const MAX_IMAGES_PER_STEP = 6;

interface CaseRun extends RunState {
  /** The first step not yet marked, or -1 when all are */
  current: number;
  images: Record<number, RunImage[]>;
  set: (index: number, result: Exclude<StepResult, "">) => void;
  setNote: (index: number, text: string) => void;
  addImages: (index: number, files: Blob[]) => void;
  removeImage: (index: number, id: string) => void;
  reset: () => void;
}

type CaseOutcome = "none" | "running" | "pass" | "fail";

/** Derived, never stored: one failed step fails the case, all passed passes it, anything between is under way */
function caseOutcome(results: StepResult[]): CaseOutcome {
  const marked = results.filter((result) => result !== "").length;
  if (marked === 0) return "none";
  if (results.includes("f")) return "fail";
  return marked === results.length ? "pass" : "running";
}

function outcomeText(outcome: CaseOutcome, marked: number, total: number): string {
  if (outcome === "pass") return t("chip.pass");
  if (outcome === "fail") return t("chip.fail");
  return t("chip.progress", { marked, total });
}

function outcomeLabel(outcome: CaseOutcome, results: StepResult[]): string {
  return outcomeText(outcome, results.filter((result) => result !== "").length, results.length);
}

function useCaseRun(tc: TestCase, active: ActiveRun | null): CaseRun | null {
  const runId = active?.id ?? null;
  // Tagged with the run it was read for: after a switch the old run's marks must not show, even
  // for the one render before the new run's are read
  const [loaded, setLoaded] = useState<{ runId: string | null; state: RunState }>(() => ({
    runId,
    state: runId ? readRun(runId, tc) : emptyRun(tc),
  }));
  const run = loaded.runId === runId ? loaded.state : emptyRun(tc);
  const [images, setImages] = useState<Record<number, RunImage[]>>({});
  const urls = useRef<string[]>([]);
  const caseKey = `${runNamespace()}:${runId}:${tc._tcId}`;

  useEffect(() => {
    if (runId) setLoaded({ runId, state: readRun(runId, tc) });
  }, [runId, tc._tcId]);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    loadImages(caseKey, stepsFingerprint(tc.steps)).then((stored) => {
      if (cancelled) return;
      const byStep: Record<number, RunImage[]> = {};
      for (const image of stored) {
        const url = URL.createObjectURL(image.blob);
        urls.current.push(url);
        (byStep[image.step] ??= []).push({ id: image.id, url, blob: image.blob });
      }
      setImages(byStep);
    });
    return () => {
      cancelled = true;
      // The next run's thumbnails must not appear beside this run's, nor its object URLs linger
      urls.current.forEach((url) => URL.revokeObjectURL(url));
      urls.current = [];
      setImages({});
    };
  }, [runId, caseKey]);

  if (!runId) return null;

  const update = (next: RunState) => {
    const stamped = { ...next, recordedAt: new Date().toISOString() };
    setLoaded({ runId, state: stamped });
    writeRun(runId, tc, stamped);
  };
  const dropImages = (steps: number[]) => {
    const gone = steps.flatMap((step) => images[step] ?? []);
    gone.forEach((image) => removeImage(image.id));
    if (gone.length > 0) setImages(Object.fromEntries(Object.entries(images).filter(([step]) => !steps.includes(Number(step)))));
  };

  return {
    ...run,
    images,
    current: tc.steps.length === 0 ? -1 : run.results.findIndex((result) => result === ""),
    set: (index, result) => {
      const results = [...run.results];
      results[index] = results[index] === result ? "" : result;
      const notes = { ...run.notes };
      if (results[index] !== "f") {
        delete notes[index];
        dropImages([index]);
      }
      update({ ...run, results, notes });
    },
    setNote: (index, text) => update({ ...run, notes: { ...run.notes, [index]: text } }),
    addImages: async (index, files) => {
      const room = MAX_IMAGES_PER_STEP - (images[index]?.length ?? 0);
      const added: RunImage[] = [];
      for (const file of files.slice(0, Math.max(0, room))) {
        const blob = await shrinkImage(file);
        const id = `${caseKey}:${index}:${Date.now().toString(36)}${added.length}`;
        const url = URL.createObjectURL(blob);
        urls.current.push(url);
        added.push({ id, url, blob });
        await saveImage({ id, caseKey, run: runId, step: index, fingerprint: stepsFingerprint(tc.steps), blob });
      }
      if (added.length > 0) {
        setImages((current) => ({ ...current, [index]: [...(current[index] ?? []), ...added] }));
      }
    },
    removeImage: (index, id) => {
      removeImage(id);
      setImages((current) => ({ ...current, [index]: (current[index] ?? []).filter((image) => image.id !== id) }));
    },
    reset: () => {
      removeCaseImages(caseKey);
      setImages({});
      update(emptyRun(tc));
    },
  };
}

/** Images found in a paste or drop, in the order given */
function imageFiles(list: FileList | null | undefined): File[] {
  return [...(list ?? [])].filter((file) => file.type.startsWith("image/"));
}

/**
 * A step's screenshots at full size over the page, one at a time with arrows (and the arrow keys)
 * to move between them. It is mounted on <body> rather than inside the card: the cards sit in a
 * container-query box, which would pin a fixed overlay to that box instead of the window.
 */
function useLightbox(index: number | null, images: RunImage[], label: (n: number) => string, onChange: (index: number | null) => void) {
  useEffect(() => {
    if (index === null || !images[index]) return;
    const image = images[index];
    const close = () => onChange(null);
    const go = (to: number) => {
      if (to >= 0 && to < images.length) onChange(to);
    };
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(
      html`<div class="lightbox" role="dialog" aria-modal="true" aria-label=${label(index)} onClick=${close}>
        <div class="lightbox-stage" onClick=${(e: Event) => e.stopPropagation()}>
          ${images.length > 1
            ? html`<button class="lightbox-nav" title=${t("lightbox.prev")} aria-label=${t("lightbox.prevLabel")} disabled=${index === 0} onClick=${() => go(index - 1)}>‹</button>`
            : null}
          <div class="lightbox-frame">
            <div class="lightbox-bar">
              ${images.length > 1 ? html`<span class="lightbox-count">${index + 1} / ${images.length}</span>` : null}
              <a class="lightbox-link" href=${image.url} target="_blank" rel="noopener">${t("lightbox.open")}</a>
              <button class="lightbox-close" title=${t("lightbox.close")} aria-label=${t("lightbox.closeLabel")} onClick=${close}>✕</button>
            </div>
            <img class="lightbox-image" src=${image.url} alt=${label(index)} />
          </div>
          ${images.length > 1
            ? html`<button class="lightbox-nav" title=${t("lightbox.next")} aria-label=${t("lightbox.nextLabel")} disabled=${index === images.length - 1} onClick=${() => go(index + 1)}>›</button>`
            : null}
        </div>
      </div>`,
      host
    );
    host.querySelector<HTMLElement>(".lightbox-close")?.focus();
    // Capture phase: these keys belong to the picture first, not to the guide, the note or the page
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") go(index - 1);
      else if (e.key === "ArrowRight") go(index + 1);
      else return;
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      render(null, host);
      host.remove();
    };
  }, [index, images.length]);
}

/**
 * One screenshot with what can be done with it. Markdown cannot carry the image itself (issue
 * trackers drop data: URLs), so the way into a comment box is to copy the image and paste it there,
 * where the site uploads it and writes its own link; downloading is the drag-and-drop alternative.
 */
function ImageThumb({
  image,
  label,
  fileName,
  onOpen,
  onRemove,
}: {
  image: RunImage;
  label: string;
  fileName: string;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    const png = blobToPng(image.blob);
    navigator.clipboard
      .write([new ClipboardItem({ "image/png": png })])
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };

  return html`<li class="step-image">
    <button class="image-open" title=${t("shot.view")} aria-label=${t("shot.viewLabel", { label })} onClick=${onOpen}>
      <img src=${image.url} alt=${label} />
    </button>
    <span class="image-tools">
      <button class=${"image-tool" + (copied ? " image-tool-done" : "")} title=${t("shot.copy")} aria-label=${t("shot.copyLabel", { label })} onClick=${copy}>
        ${copied ? "✓" : html`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>`}
      </button>
      <a class="image-tool" href=${image.url} download=${fileName} title=${t("shot.download")} aria-label=${t("shot.downloadLabel", { label })}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
      </a>
      <button
        class="image-tool image-tool-remove"
        title=${t("shot.remove")}
        aria-label=${t("shot.removeLabel", { label })}
        onClick=${() => {
          // A removed screenshot cannot be got back, and the button sits right beside Copy and Download
          if (confirm(t("shot.confirmRemove"))) onRemove();
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>
      </button>
    </span>
  </li>`;
}

/**
 * What the tester saw at a failed step: free text with line breaks, plus screenshots that can be
 * pasted straight in (the usual way a screenshot is taken), dropped, or picked from a file.
 */
function StepNote({ tcId, index, run, onNext, onBack }: { tcId: string; index: number; run: CaseRun; onNext: () => void; onBack: () => void }) {
  const images = run.images[index] ?? [];
  const full = images.length >= MAX_IMAGES_PER_STEP;
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  useLightbox(viewing, images, (n) => t("shot.label", { n: n + 1, step: index + 1 }), setViewing);

  // Grows with the text so a few lines never need scrolling inside the box
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  }, [run.notes[index]]);

  const take = (files: File[]) => {
    if (files.length > 0 && !full) run.addImages(index, files);
  };

  return html`
    <div class="step-note-box">
      <textarea
        ref=${areaRef}
        class="step-note"
        rows="2"
        maxlength="2000"
        placeholder=${t("note.placeholder")}
        aria-label=${t("note.label", { step: index + 1 })}
        value=${run.notes[index] ?? ""}
        onInput=${(e: Event) => run.setNote(index, (e.target as HTMLTextAreaElement).value)}
        onPaste=${(e: ClipboardEvent) => {
          const files = imageFiles(e.clipboardData?.files);
          if (files.length === 0) return;
          e.preventDefault();
          take(files);
        }}
        onDragOver=${(e: DragEvent) => {
          if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
        }}
        onDrop=${(e: DragEvent) => {
          const files = imageFiles(e.dataTransfer?.files);
          if (files.length === 0) return;
          e.preventDefault();
          take(files);
        }}
        onKeyDown=${(e: KeyboardEvent) => {
          if (e.isComposing) return;
          // Enter is a line break here; Cmd/Ctrl+Enter is how to move on without leaving the keyboard
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onNext();
          } else if (e.key === "Escape") {
            e.stopPropagation();
            onBack();
          }
        }}
      />
      <div class="step-note-tools">
        <label class=${"link-btn" + (full ? " link-btn-off" : "")}>
          ${t("note.attach")}
          <input
            class="visually-hidden"
            type="file"
            accept="image/*"
            multiple
            disabled=${full}
            onChange=${(e: Event) => {
              const input = e.target as HTMLInputElement;
              take(imageFiles(input.files));
              input.value = "";
            }}
          />
        </label>
        <span class="step-note-hint">${full ? t("note.full", { max: MAX_IMAGES_PER_STEP }) : ""}${t("note.next")}</span>
      </div>
      ${images.length > 0
        ? html`<ul class="step-images">
            ${images.map(
              (image, n) => html`<${ImageThumb}
                key=${image.id}
                image=${image}
                label=${t("shot.label", { n: n + 1, step: index + 1 })}
                fileName=${`${tcId}-step${index + 1}-${n + 1}.${image.blob.type === "image/png" ? "png" : "jpg"}`}
                onOpen=${() => setViewing(n)}
                onRemove=${() => run.removeImage(index, image.id)}
              />`
            )}
          </ul>`
        : null}
    </div>
  `;
}

/**
 * The explicit roles keep this a table for assistive technology even when the narrow layout
 * turns its cells into blocks, which would otherwise drop the table semantics.
 */
const RESULT_LABEL_KEY: Record<Exclude<StepResult, "">, MessageKey> = { p: "result.pass", f: "result.fail" };

/**
 * Two adjacent buttons per step. Pass and Fail keep a fixed order so a hand learns where each is,
 * pressing the selected one again clears it, and the label and glyph carry the meaning as well as
 * the colour. The first unmarked step is where a keyboard run carries on.
 */
function StepResultButtons({
  index,
  result,
  onSet,
}: {
  index: number;
  result: StepResult;
  onSet: (index: number, result: Exclude<StepResult, "">, byKeyboard: boolean) => void;
}) {
  return html`<div class="step-result-group" role="group" aria-label=${t("step.resultGroup", { step: index + 1 })}>
    ${(["p", "f"] as const).map(
      (value) => html`<button
        key=${value}
        class=${`result-btn result-btn-${value === "p" ? "pass" : "fail"}`}
        aria-pressed=${result === value}
        onClick=${(e: MouseEvent) => onSet(index, value, e.detail === 0)}
      >
        <span aria-hidden="true">${value === "p" ? "✓" : "✕"}</span> ${t(RESULT_LABEL_KEY[value])}
      </button>`
    )}
  </div>`;
}

/**
 * The explicit roles keep this a table for assistive technology even when the narrow layout
 * turns its cells into blocks, which would otherwise drop the table semantics.
 */
function StepsTable({ tcId, steps, run }: { tcId: string; steps: Step[]; run: CaseRun | null }) {
  const tableRef = useRef<HTMLTableElement>(null);

  const focusIn = (selector: string) => {
    tableRef.current?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
  };
  const focusNextPass = (after: number, results: StepResult[]) => {
    const next = results.findIndex((result, j) => j > after && result === "");
    if (next >= 0) focusIn(`tr.step-row[data-step="${next}"] .result-btn-pass`);
  };


  const onSet = (index: number, result: Exclude<StepResult, "">, byKeyboard: boolean) => {
    if (!run) return;
    const clearing = run.results[index] === result;
    run.set(index, result);
    if (clearing || !byKeyboard) return;
    // Keyboard runs should not have to Tab back to the next step; mouse and touch users get no focus jump
    if (result === "f") requestAnimationFrame(() => focusIn(`tr.step-note-row[data-step="${index}"] textarea`));
    else focusNextPass(index, [...run.results.slice(0, index), "p", ...run.results.slice(index + 1)]);
  };

  return html`
    <table ref=${tableRef} class=${"steps-table" + (run ? " steps-run" : "")} role="table">
      <colgroup>
        <col class="col-step-no" />
        <col class="col-step-action" />
        <col />
        ${run ? html`<col class="col-step-result" />` : null}
      </colgroup>
      <thead role="rowgroup">
        <tr role="row">
          <th role="columnheader" class="step-no">#</th>
          <th role="columnheader">${t("step.action")}</th>
          <th role="columnheader">${t("step.expected")}</th>
          ${run ? html`<th role="columnheader" class="step-result">${t("step.result")}</th>` : null}
        </tr>
      </thead>
      <tbody role="rowgroup">
        ${steps.map((step, i) => {
          const result = run?.results[i] ?? "";
          const classes = [
            "step-row",
            i % 2 === 1 ? "step-even" : "",
            result === "p" ? "step-done" : "",
            result === "f" ? "step-failed" : "",
            run?.current === i ? "step-current" : "",
          ].filter(Boolean);
          return html`
            <tr key=${i} role="row" data-step=${i} class=${classes.join(" ")}>
              <th role="rowheader" scope="row" class="step-no">${i + 1}</th>
              <td role="cell" class="step-cell step-action" dangerouslySetInnerHTML=${{ __html: step.actionHtml }} />
              <td role="cell" class="step-cell step-expected" data-label=${t("step.expected")} dangerouslySetInnerHTML=${{ __html: step.expectedHtml }} />
              ${run
                ? html`<td role="cell" class="step-result">
                    <${StepResultButtons} index=${i} result=${result} onSet=${onSet} />
                  </td>`
                : null}
            </tr>
            ${run && result === "f"
              ? html`<tr key=${`${i}-note`} role="row" data-step=${i} class=${"step-note-row" + (i % 2 === 1 ? " step-even" : "")}>
                  <td role="cell" colspan="4">
                    <${StepNote} tcId=${tcId} index=${i} run=${run} onNext=${() => focusNextPass(i, run.results)} onBack=${() => focusIn(`tr.step-row[data-step="${i}"] .result-btn-fail`)} />
                  </td>
                </tr>`
              : null}
          `;
        })}
      </tbody>
    </table>
  `;
}

/** Why a case is out of active coverage, spelled out; null for an active case */
function inactiveNote(tc: TestCase): string | null {
  const reason = tc.reason ?? tc.skip?.reason;
  if (tc.status === "obsolete") return reason ? t("inactive.obsoleteReason", { reason }) : t("inactive.obsolete");
  if (tc.status === "superseded") {
    const by = tc.superseded_by;
    if (by && reason) return t("inactive.supersededByReason", { by, reason });
    if (by) return t("inactive.supersededBy", { by });
    return reason ? t("inactive.supersededReason", { reason }) : t("inactive.superseded");
  }
  if (tc.skip) {
    const { until, reason: why } = tc.skip;
    return until ? t("inactive.skippedUntil", { until, reason: why }) : t("inactive.skipped", { reason: why });
  }
  return null;
}

/**
 * Test data as rendered at generation time, each value followed by an empty copy button carrying
 * the raw value. The buttons live in generated HTML, so they are labelled here, where the language is known.
 */
function TestDataBody({ html: markup }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    for (const button of ref.current?.querySelectorAll<HTMLButtonElement>("button.td-copy") ?? []) {
      button.title = t("copy.value");
      button.setAttribute("aria-label", t("copy.value"));
    }
  });
  const onClick = async (e: MouseEvent) => {
    const button = (e.target as Element).closest<HTMLButtonElement>("button.td-copy");
    if (!button) return;
    if (!(await writeClipboardText(decodeURIComponent(button.dataset.copy ?? "")))) return;
    button.classList.add("td-copy-done");
    setTimeout(() => button.classList.remove("td-copy-done"), 1200);
  };
  return html`<div class="test-data-body" ref=${ref} onClick=${onClick} dangerouslySetInnerHTML=${{ __html: markup }} />`;
}

/**
 * The case's own address. A plain click copies it instead of following it: following would swap the page
 * for the case's suite page and take the other open cases off the screen. The href stays so the browser's
 * own "open in new tab" and "copy link" still work.
 */
function CaseLink({ tcId }: { tcId: string }) {
  const [copied, setCopied] = useState(false);
  const hash = testCaseHash(tcId);
  const onClick = (e: MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    writeClipboardText(`${location.href.replace(/#.*$/, "")}${hash}`).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  const title = copied ? t("copy.copied") : t("case.link");
  return html`<a class=${"icon-btn" + (copied ? " copy-btn-copied" : "")} href=${hash} title=${title} aria-label=${title} onClick=${onClick}>
    ${copied
      ? html`<span aria-hidden="true">✓</span>`
      : html`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>`}
  </a>`;
}

/** Previous / Next, the link to the case and its copy button: shared by a card's header and an open row */
function CaseActions({ tc, run }: { tc: TestCase; run: CaseRun | null }) {
  const activeRun = useContext(RunContext);
  const nav = useContext(CaseNavContext);
  const position = run && nav ? nav.order.indexOf(tc._tcId) : -1;
  const prevId = position > 0 && nav ? nav.order[position - 1] : null;
  const nextId = position >= 0 && nav && position < nav.order.length - 1 ? nav.order[position + 1] : null;
  const hasShots = !!run && Object.values(run.images).some((list) => list.length > 0);
  return html`<span class="test-case-actions">
    ${position >= 0
      ? html`<button class="icon-btn" disabled=${prevId === null} title=${t("case.prev")} aria-label=${t("case.prev")} onClick=${() => prevId && nav?.go(prevId)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6" /></svg>
          </button>
          <button class="icon-btn" disabled=${nextId === null} title=${t("case.next")} aria-label=${t("case.next")} onClick=${() => nextId && nav?.go(nextId)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
          </button>`
      : null}
    <${CaseLink} tcId=${tc._tcId} />
    <${CopyButton}
      iconOnly=${true}
      title=${hasShots ? t("copy.caseWithShots") : t("copy.case")}
      getText=${() => testCaseToMarkdown(tc, 3, run && { ...run, runName: activeRun?.name })}
    />
  </span>`;
}

/**
 * Everything of a case below its heading. A row that already shows the tags passes `tags=${false}`
 * so they are not said twice.
 */
type HandoffKind = "case" | "test" | "elsewhere";
const HANDOFF_KINDS: readonly HandoffKind[] = ["case", "test", "elsewhere"];
const handoffKind = (item: CoveredBy): HandoffKind => HANDOFF_KINDS.find((kind) => kind in item)!;
const handoffTarget = (item: CoveredBy): string => (item as Record<string, string>)[handoffKind(item)];
const handoffKindLabel = (kind: HandoffKind): string => t(`handoff.kind.${kind}` as MessageKey);

interface CoverageIndex {
  byId: Map<string, TestCase>;
  /** Cases a case covers, which the covering case cannot see in its own YAML */
  covering: Map<string, { from: TestCase; what: string }[]>;
}

let coverageIndexCache: { suites: SuitePageData[]; index: CoverageIndex } | null = null;

function coverageIndex(): CoverageIndex {
  const suites = window.__SUITES__;
  if (coverageIndexCache?.suites === suites) return coverageIndexCache.index;
  const all = suites.flatMap((suite) => suite.testCases);
  const covering = new Map<string, { from: TestCase; what: string }[]>();
  for (const tc of all) {
    for (const item of tc.covered_by ?? []) {
      if (!("case" in item)) continue;
      covering.set(item.case, [...(covering.get(item.case) ?? []), { from: tc, what: item.what }]);
    }
  }
  const index = { byId: new Map(all.map((tc) => [tc._tcId, tc])), covering };
  coverageIndexCache = { suites, index };
  return index;
}

function HandoffTarget({ tcId, tc }: { tcId: string; tc: TestCase | undefined }) {
  if (!tc) return html`<span class="handoff-target"><code>${tcId}</code> <span class="handoff-missing">${t("handoff.noSuchCase")}</span></span>`;
  const note = inactiveNote(tc);
  return html`<span class="handoff-target"><a href=${testCaseHash(tcId)}>${tcId}</a> ${tc.name}${note ? html` <span class="handoff-missing">${note}</span>` : null}</span>`;
}

/** What this case no longer checks and where that went, and the checks of other cases it carries */
function Handoff({ tc }: { tc: TestCase }) {
  const { byId, covering } = coverageIndex();
  const moved = tc.covered_by ?? [];
  const dropped = tc.dropped ?? [];
  const carried = covering.get(tc._tcId) ?? [];
  return html`
    ${moved.length + dropped.length > 0
      ? html`<aside class="handoff">
          <h5 class="eyebrow">${t("handoff.title")}</h5>
          <ul>
            ${moved.map((item, i) => {
              const kind = handoffKind(item);
              const target = handoffTarget(item);
              return html`<li key=${`m${i}`}>
                <span class="handoff-what">${item.what}</span>
                <span class="handoff-kind">${handoffKindLabel(kind)}</span>
                ${kind === "case" ? html`<${HandoffTarget} tcId=${target} tc=${byId.get(target)} />` : html`<span class="handoff-target"><code>${target}</code></span>`}
              </li>`;
            })}
            ${dropped.map((item, i) => html`<li key=${`d${i}`}>
              <span class="handoff-what">${item.what}</span>
              <span class="handoff-kind">${t("handoff.kind.dropped")}</span>
              <span class="handoff-target">${item.reason}</span>
            </li>`)}
          </ul>
        </aside>`
      : null}
    ${carried.length > 0
      ? html`<aside class="handoff">
          <h5 class="eyebrow">${t("handoff.covers")}</h5>
          <ul>
            ${carried.map((entry, i) => html`<li key=${i}>
              <${HandoffTarget} tcId=${entry.from._tcId} tc=${entry.from} />
              <span class="handoff-what handoff-after">${entry.what}</span>
            </li>`)}
          </ul>
        </aside>`
      : null}
  `;
}

function CaseBody({ tc, run, tags = true }: { tc: TestCase; run: CaseRun | null; tags?: boolean }) {
  const note = inactiveNote(tc);
  const shownTags = tags ? (tc.tags ?? []) : [];
  const hasMeta = shownTags.length > 0 || !!tc.legacy_marker || !!note || !!tc.unexpectedSources;
  const hasPreconditions = !!tc.preconditions && tc.preconditions.length > 0;
  return html`
    <div class="test-case-body">
      ${hasMeta
        ? html`<div class="test-case-meta">
            ${shownTags.map((tag) => html`<a class="tag-chip" key=${tag} href=${overviewTagHash(tag)} title=${t("case.tagLink")}>${tag}</a>`)}
            ${note ? html`<span class="inactive-note">${note}</span>` : null}
            ${tc.unexpectedSources ? html`<span class="inactive-note">${t("case.sourceUnexpected", { where: tc.unexpectedSources.join(", ") })}</span>` : null}
            ${tc.legacy_marker ? html`<span class="legacy-marker">${t("case.legacyMarker", { marker: tc.legacy_marker })}</span>` : null}
          </div>`
        : null}
      ${hasPreconditions || tc.testDataHtml
        ? html`<div class="test-case-setup">
            ${hasPreconditions
              ? html`<div class="preconditions">
                  <h5 class="eyebrow">${t("case.preconditions")}</h5>
                  <ul>${tc.preconditions!.map((p, i) => html`<li key=${i}>${preconditionText(p)}</li>`)}</ul>
                </div>`
              : null}
            ${tc.testDataHtml
              ? html`<div class="test-data">
                  <h5 class="eyebrow">${t("case.testData")}</h5>
                  <${TestDataBody} html=${tc.testDataHtml} />
                </div>`
              : null}
          </div>`
        : null}
      ${tc.automation_reason ? html`<aside class="automation-note"><h5 class="eyebrow">${t("layer.reason")}</h5><p>${tc.automation_reason}</p></aside>` : null}
      ${tc.automationNoteHtml
        ? html`<aside class="automation-note">
            <h5 class="eyebrow">${t("case.automationNote")}</h5>
            <div class="notes-body" dangerouslySetInnerHTML=${{ __html: tc.automationNoteHtml }} />
          </aside>`
        : null}
      <${Handoff} tc=${tc} />
      <${StepsTable} tcId=${tc._tcId} steps=${tc.steps} run=${run} />
      ${tc.sources ? html`<${CaseSources} sources=${tc.sources} />` : null}
      ${tc.notesHtml
        ? html`<aside class="notes">
            <h5 class="eyebrow">${t("case.note")}</h5>
            <div class="notes-body" dangerouslySetInnerHTML=${{ __html: tc.notesHtml }} />
          </aside>`
        : null}
    </div>
  `;
}

function HighlightedCode({ code, file }: { code: string; file: string }) {
  const colored = highlightHtml(code, file);
  return colored === null ? html`<code>${code}</code>` : html`<code dangerouslySetInnerHTML=${{ __html: colored }} />`;
}

const sourceTexts = new Map<string, Promise<string>>();

/** The text of an embedded test file, unpacked on first use; undefined when the page does not hold it */
function readSourceFile(path: string): Promise<string> | undefined {
  const packed = window.__SOURCE_FILES__?.[path];
  if (packed === undefined) return undefined;
  let text = sourceTexts.get(path);
  if (!text) {
    const bytes = Uint8Array.from(atob(packed), (char) => char.charCodeAt(0));
    text = new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    sourceTexts.set(path, text);
  }
  return text;
}

interface SourceView {
  path: string;
  file: string;
  /** The lines the case's snippet covers, which the viewer marks and opens on */
  start: number;
  end: number;
}

/**
 * A test file in full, with the part the case showed marked. Finding the code that belongs to a case
 * is matching, so it can miss helpers and what a test calls; this lets the reader follow them.
 */
function SourceViewer({ view, onClose }: { view: SourceView; onClose: () => void }) {
  // null while unpacking, undefined when the file cannot be shown
  const [text, setText] = useState<string | undefined | null>(null);
  useEffect(() => {
    let current = true;
    setText(null);
    const pending = readSourceFile(view.path);
    if (!pending) setText(undefined);
    else pending.then((value) => current && setText(value), () => current && setText(undefined));
    return () => {
      current = false;
    };
  }, [view.path]);
  const lines = useMemo(() => {
    if (text === undefined || text === null) return [];
    const colored = highlightLines(text, view.file);
    const plain = text.split("\n");
    // A final newline ends the last line rather than starting an empty one
    if (plain.length > 1 && plain[plain.length - 1] === "") plain.pop();
    return plain.map((line, i) => ({ plain: line, colored: colored?.[i] }));
  }, [text, view.file]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<number | null>(null);

  const goTo = (line: number) => {
    const body = bodyRef.current;
    const row = body?.querySelector<HTMLElement>(`[data-line="${line}"]`);
    // Not scrollIntoView: it would move the page behind as well
    if (body && row) body.scrollTop = row.offsetTop - body.clientHeight / 3;
  };
  useEffect(() => goTo(view.start), [text, view.start]);

  const casesHere = useMemo(() => {
    const { byId } = coverageIndex();
    if (byId.size === 0) return [];
    const alternatives = [...byId.keys()].sort((a, b) => b.length - a.length).map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const pattern = new RegExp(`(?<![\\w-])(${alternatives})(?![\\w-])`, "g");
    const first = new Map<string, number>();
    lines.forEach((line, i) => {
      for (const match of line.plain.matchAll(pattern)) if (!first.has(match[1])) first.set(match[1], i + 1);
    });
    return [...first].map(([id, line]) => ({ id, line, name: byId.get(id)?.name ?? "" }));
  }, [lines]);

  return html`<div class="source-viewer" role="dialog" aria-modal="true" aria-label=${view.path} onClick=${onClose}>
    <div class="source-viewer-frame" onClick=${(e: Event) => e.stopPropagation()}>
      <div class="source-viewer-bar">
        <span class="source-path" title=${view.path}>${view.path}</span>
        <span class="source-viewer-count">${t("source.lines", { count: lines.length })}</span>
        ${casesHere.length > 0
          ? html`<select
              class="source-viewer-jump"
              aria-label=${t("source.jumpCase")}
              value=""
              onChange=${(e: Event) => {
                const select = e.target as HTMLSelectElement;
                const line = Number(select.value);
                select.value = "";
                if (line) {
                  goTo(line);
                  setFocused(line);
                }
              }}
            >
              <option value="">${t("source.jumpCase")}</option>
              ${casesHere.map((item) => html`<option key=${item.id} value=${item.line}>${t("source.jumpItem", { id: item.id, name: item.name, line: item.line })}</option>`)}
            </select>`
          : null}
        <button class="source-viewer-close" type="button" title=${t("source.close")} aria-label=${t("source.closeLabel")} onClick=${onClose}>✕</button>
      </div>
      <div class="source-viewer-body" ref=${bodyRef}>
        ${text === null
          ? html`<p class="source-missing">${t("source.loading")}</p>`
          : text === undefined
            ? html`<p class="source-missing">${t("source.fileMissing")}</p>`
            : lines.map((line, i) => {
              const n = i + 1;
              const inRange = n >= view.start && n <= view.end;
              return html`<div key=${n} class=${"src-line" + (inRange ? " src-line-hit" : "") + (focused === n ? " src-line-focus" : "")} data-line=${n}>
                <span class="src-no" aria-hidden="true">${n}</span>
                ${line.colored !== undefined ? html`<code class="src-code" dangerouslySetInnerHTML=${{ __html: line.colored }} />` : html`<code class="src-code">${line.plain}</code>`}
              </div>`;
            })}
      </div>
    </div>
  </div>`;
}

/** Mounted on <body> like the lightbox: a fixed overlay inside a case card would be pinned to the card's container-query box */
function useSourceViewer(view: SourceView | null, onClose: () => void) {
  useEffect(() => {
    if (!view) return;
    const opener = document.activeElement;
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(html`<${SourceViewer} view=${view} onClose=${onClose} />`, host);
    host.querySelector<HTMLElement>(".source-viewer-close")?.focus();
    // Capture phase: the page's own shortcuts (g for the guide, ⌘K for search) must not act behind the viewer
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (!(e.key === "g" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k"))) return;
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      render(null, host);
      host.remove();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [view]);
}

/** A container as its meaning; the call as written stays in the tooltip, since the code below shows it anyway */
function containerText(container: SourceContainer): string {
  if ("name" in container) return container.name;
  if (!container.each) return container.call;
  const named = container.names ? container.names.join(t("source.nameJoin")) : container.by;
  return named ? t("source.eachOfNamed", { data: container.each, named }) : t("source.eachOf", { data: container.each });
}

/** The test code behind an automated case, or a note that none was found where it was searched */
function CaseSources({ sources }: { sources: SourceSnippet[] }) {
  const [viewing, setViewing] = useState<SourceView | null>(null);
  useSourceViewer(viewing, () => setViewing(null));
  const viewButton = (path: string, file: string, start: number, end: number) =>
    window.__SOURCE_FILES__?.[path] === undefined || typeof DecompressionStream === "undefined"
      ? null
      : html`<button class="link-btn source-view" type="button" onClick=${() => setViewing({ path, file, start, end })}>${t("source.viewFile")}</button>`;
  return html`<section class="case-sources">
    <h5 class="eyebrow">${t("case.source")}</h5>
    ${sources.length === 0
      ? html`<p class="source-missing">${t("case.sourceMissing")}</p>`
      : sources.map(
          (source) => html`<figure class="source-snippet" key=${`${source.file}:${source.startLine}`}>
            ${source.title ? html`<p class="source-title"><span class="source-title-label">${t("source.checks")}</span>${source.title}</p>` : null}
            <figcaption>
              <span class="source-path" title=${source.path}>${source.file}:${source.startLine}${source.endLine > source.startLine ? `–${source.endLine}` : ""}</span>
              ${source.truncated ? html`<span class="source-truncated">${t("case.sourceTruncated")}</span>` : null}
              ${viewButton(source.path, source.file, source.startLine, source.endLine)}
            </figcaption>
            ${source.containers?.length ? html`<div class="source-containers">${source.containers.flatMap((container, i) => [i > 0 ? " › " : null, html`<span key=${i} title=${"call" in container ? container.call : undefined}>${containerText(container)}</span>`])}</div>` : null}
            <pre><${HighlightedCode} code=${source.code} file=${source.file} /></pre>
          </figure>`
        )}
  </section>`;
}

/**
 * A case with its own heading band, for the one-page read where no table row stands above it.
 * `level` is the band's position in the stack of sticky headers above it.
 */
function TestCaseCard({ tc, level }: { tc: TestCase; level: number }) {
  const activeRun = useContext(RunContext);
  const run = useCaseRun(tc, activeRun);
  const outcome = run ? caseOutcome(run.results) : "none";
  const inactive = isInactive(tc);

  return html`
    <article class=${"test-case" + (inactive ? " test-case-inactive" : "")} id=${testCaseAnchorId(tc._tcId)}>
      <header class=${`test-case-head sticky-header sticky-level-${level}`}>
        <span class="test-case-id">${tc._tcId}</span>
        <h4 class="test-case-name" title=${tc.name}>${tc.name}</h4>
        <span class="test-case-badges">
          ${tc.status === "obsolete" ? html`<span class="badge">${t("badge.obsolete")}</span>` : null}
          ${tc.status === "superseded" ? html`<span class="badge">${statusLabel(tc)}</span>` : null}
          ${tc.skip ? html`<span class="badge badge-skip">${statusLabel(tc)}</span>` : null}
          ${tc.automation && tc.automation !== "manual"
            ? html`<span class="badge badge-automation">${testMethod(tc)}</span>`
            : null}
        </span>
        ${run && outcome !== "none"
          ? html`<span class="run-status">
              <span class=${`run-chip run-chip-${outcome}`} title=${t("chip.title", { name: activeRun?.name ?? "" })}>${outcomeLabel(outcome, run.results)}</span>
              <button class="link-btn" onClick=${run.reset}>${t("chip.reset")}</button>
            </span>`
          : null}
        <${CaseActions} tc=${tc} run=${run} />
      </header>
      <${CaseBody} tc=${tc} run=${run} />
    </article>
  `;
}

function GuideIcon() {
  return html`<svg class="guide-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>`;
}

/** The cases a heading lists, with a unit: a bare number beside a title does not say what it counts */
function caseCountText(n: number | string, plural: number = Number(n)): string {
  return tn("scope.count", plural, { count: n });
}

function CountLabel({ testCases }: { testCases: TestCase[] }) {
  return html`${caseCountText(testCases.length)}`;
}

/** Selecting the current target again fires no hashchange, so jump directly in that case */
function goToTestCase(tcId: string) {
  const next = testCaseHash(tcId);
  if (location.hash === next) jumpToId(testCaseAnchorId(tcId));
  else followHash(next);
}

/** Why a case is out of active coverage, as a short label; null for an active case */
function statusLabel(tc: TestCase): string | null {
  if (tc.status === "obsolete") return t("badge.obsolete");
  if (tc.status === "superseded") return tc.superseded_by ? t("badge.supersededBy", { by: tc.superseded_by }) : t("badge.superseded");
  if (tc.skip) return tc.skip.until ? t("badge.skipUntil", { until: tc.skip.until }) : t("badge.skip");
  return null;
}

/** How the case is run; an unset `automation` means a person runs it by hand */
function testMethod(tc: TestCase): string {
  return t(METHOD_LABEL_KEY[caseMethodKey(tc)]);
}

type CaseMethod = NonNullable<TestCase["automation"]>;
type CaseStatus = "active" | "obsolete" | "superseded" | "skip";

const METHOD_LABEL_KEY: Record<CaseMethod, MessageKey> = { manual: "method.manual", automated: "method.automated", semi: "method.semi" };
const STATUS_LABEL_KEY: Record<CaseStatus, MessageKey> = { active: "status.active", obsolete: "badge.obsolete", superseded: "badge.superseded", skip: "badge.skip" };

const caseMethodKey = (tc: TestCase): CaseMethod => tc.automation ?? "manual";

/** Mirrors `isInactive`: a permanent status wins over a temporary skip */
function caseStatusKey(tc: TestCase): CaseStatus {
  if (tc.status === "obsolete" || tc.status === "superseded") return tc.status;
  return tc.skip ? "skip" : "active";
}

interface IndexRowData {
  layer?: string;
  layerLabel?: string;
  layerDescription?: string;
  tcId: string;
  name: string;
  status: string | null;
  statusTitle: string;
  method: string;
  /** A semi case's automation note, so the method cell says what is left to a person */
  methodTitle: string;
  tags: string[];
  inactive: boolean;
}

function indexRowData(tc: TestCase): IndexRowData {
  return {
    layer: tc.layer,
    layerLabel: tc.layerLabel,
    layerDescription: tc.layerDescription,
    tcId: tc._tcId,
    name: tc.name,
    status: statusLabel(tc),
    statusTitle: tc.reason ?? tc.skip?.reason ?? "",
    method: testMethod(tc),
    methodTitle: tc.automation_note ?? "",
    tags: tc.tags ?? [],
    inactive: isInactive(tc),
  };
}

const indexColumns = (): string[] => [t("col.id"), t("col.name"), t("col.status"), t("col.method"), t("col.tags")];

/**
 * One case as a table row. With `onTag` a tag chip filters the table it sits in; without it the
 * chip links to the overview filtered by that tag, for tables that have no filter of their own.
 */
/** What the plan page adds to a row: the case's decision and reason, and how to change them */
interface PlanCells {
  decision: Decision | undefined;
  reason: string;
  onDecide: (decision: Decision | undefined) => void;
  onReason: (reason: string) => void;
  /** Whether the case's steps are shown below its row; an ID opens them here instead of leaving the plan */
  open: boolean;
  onToggleOpen: () => void;
  /** Ticked for a bulk action; `shift` extends the choice from the last row ticked */
  selected: boolean;
  onSelect: (shift: boolean) => void;
}

/** What the table needs to tick rows in bulk: the ticked set, and a way to tick or clear several at once */
interface PlanSelect {
  selected: Set<string>;
  /** Cases that can be ticked in the table as listed (inactive ones cannot) */
  listedIds: string[];
  onMany: (ids: string[], on: boolean) => void;
}

/** A checkbox that can show "some", which the DOM only allows as a property */
function TriCheck({ checked, some, label, onChange }: { checked: boolean; some: boolean; label: string; onChange: (on: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some;
  }, [some]);
  return html`<input ref=${ref} type="checkbox" class="plan-select" checked=${checked} aria-label=${label} onChange=${(e: Event) => onChange((e.target as HTMLInputElement).checked)} />`;
}

/** Committed when focus leaves, not per keystroke, so typing (an IME's composition included) is never rewritten under the cursor */
function ReasonInput({ id, reason, onReason }: { id: string; reason: string; onReason: (reason: string) => void }) {
  const [text, setText] = useState(reason);
  useEffect(() => setText(reason), [reason]);
  return html`<input
    class="plan-reason"
    value=${text}
    maxlength="300"
    placeholder=${t("plan.reasonPlaceholder")}
    aria-label=${t("plan.reasonLabel", { id })}
    onInput=${(e: Event) => setText((e.target as HTMLInputElement).value)}
    onChange=${(e: Event) => onReason((e.target as HTMLInputElement).value)}
  />`;
}

/** A row whose case opens below it, read-only, on pages that have no cards of their own */
interface RowExpand {
  open: boolean;
  onToggle: () => void;
}

/** How far a case is through the active run; the table shows it so progress can be read without scrolling the cards */
interface CaseProgress {
  outcome: CaseOutcome;
  marked: number;
  total: number;
}

function IndexRow({
  row,
  onTag,
  query = "",
  plan,
  expand,
  result,
  anchorId,
  actions,
  onReset,
  sticky,
}: {
  row: IndexRowData;
  onTag?: (tag: string) => void;
  query?: string;
  plan?: PlanCells;
  expand?: RowExpand;
  /** Present (even as null, for a case with no marks) when the table has a result column */
  result?: CaseProgress | null;
  /** Makes the row a jump target while its case is closed; an open case's card carries the id instead */
  anchorId?: string;
  /** Buttons shown at the right of the tags cell; given for an open case, so a closed row has none */
  actions?: ComponentChildren;
  /** Offered beside the chip of the open case, whose marks it clears */
  onReset?: () => void;
  /** Lets the row stay in view as the heading of an open case below it; a closed case's row is alone in its tbody, so it never moves */
  sticky?: boolean;
}) {
  const toggle: RowExpand | undefined = plan ? { open: plan.open, onToggle: plan.onToggleOpen } : expand;
  const decisionButton = (decision: Decision, label: string) => html`<button
    class=${"decision-btn decision-" + decision + (plan?.decision === decision ? " decision-on" : "")}
    aria-pressed=${plan?.decision === decision}
    onClick=${() => plan?.onDecide(plan.decision === decision ? undefined : decision)}
  >${label}</button>`;
  return html`
    <tr
      id=${anchorId}
      class=${"overview-row" + (sticky ? " sticky-row" : "") + (row.inactive ? " row-inactive" : "") + (plan && !row.inactive && !plan.decision ? " plan-undecided" : "") + (result !== undefined ? " has-result" : "")}
      onClick=${toggle ? undefined : () => goToTestCase(row.tcId)}
    >
      ${plan
        ? html`<td class="plan-select-cell">
            ${row.inactive
              ? null
              : html`<input
                  type="checkbox"
                  class="plan-select"
                  checked=${plan.selected}
                  aria-label=${t("plan.selectCase", { id: row.tcId })}
                  onClick=${(e: MouseEvent) => plan.onSelect(e.shiftKey)}
                />`}
          </td>`
        : null}
      <td class="overview-id">
        <button
          class="overview-link"
          aria-expanded=${toggle?.open}
          title=${toggle ? t("plan.toggleCase", { id: row.tcId }) : undefined}
          onClick=${(e: Event) => {
            e.stopPropagation();
            if (toggle) toggle.onToggle();
            else goToTestCase(row.tcId);
          }}
        >${toggle ? html`<span class="expand-caret" aria-hidden="true">${toggle.open ? "▾" : "▸"}</span>` : null}<${Highlight} text=${row.tcId} query=${query} /></button>
      </td>
      <td
        class=${"overview-name" + (toggle ? " expand-name" : "")}
        onClick=${toggle
          ? () => {
              // Not while the name is being selected to copy
              if (!window.getSelection()?.toString()) toggle.onToggle();
            }
          : undefined}
      ><${Highlight} text=${row.name} query=${query} /></td>
      <td class="overview-status">${row.status ? html`<span class="status-lozenge" title=${row.statusTitle}><${Highlight} text=${row.status} query=${query} /></span>` : null}</td>
      <td class="overview-method overview-nowrap" data-label=${t("col.method")} title=${row.methodTitle || undefined}><${Highlight} text=${row.method} query=${query} /></td>
      <td class="overview-tags">
        <div class="tags-cell">
          <div class="tag-list">
            ${row.layer ? html`<span class="tag-chip" title=${row.layerDescription ?? row.layer}>${row.layerLabel ?? row.layer}</span>` : null}
            ${row.tags.map((tag) =>
              onTag
                ? html`<button class="tag-chip" key=${tag} title=${t("filter.byTag")} onClick=${(e: Event) => { e.stopPropagation(); onTag(tag); }}><${Highlight} text=${tag} query=${query} /></button>`
                : html`<a class="tag-chip" key=${tag} href=${overviewTagHash(tag)} onClick=${(e: Event) => e.stopPropagation()}><${Highlight} text=${tag} query=${query} /></a>`
            )}
          </div>
          ${actions ? html`<span class="row-actions" onClick=${(e: Event) => e.stopPropagation()}>${actions}</span>` : null}
        </div>
      </td>
      ${result !== undefined
        ? html`<td class="overview-result" data-label=${t("col.result")}>
            ${result && result.outcome !== "none"
              ? html`<span class="run-status"
                  ><span class=${`run-chip run-chip-${result.outcome}`}>${outcomeText(result.outcome, result.marked, result.total)}</span
                  >${onReset ? html`<button class="link-btn" onClick=${onReset}>${t("chip.reset")}</button>` : null}</span
                >`
              : null}
          </td>`
        : null}
      ${plan
        ? html`<td class="overview-decision">
              ${row.inactive
                ? html`<span class="plan-yaml">—</span>`
                : html`<div class="decision-group" role="group" aria-label=${t("plan.decisionLabel", { id: row.tcId })}>${decisionButton("r", t("plan.run"))}${decisionButton("s", t("plan.skip"))}</div>`}
            </td>
            <td class="overview-reason">
              ${row.inactive
                ? html`<span class="plan-yaml">${row.statusTitle}</span>`
                : html`<${ReasonInput} id=${row.tcId} reason=${plan.reason} onReason=${plan.onReason} />`}
            </td>`
        : null}
    </tr>
  `;
}

/** A section's cases ahead of their cards, on the single long page where there is no scope table above */
function SectionIndex({ testCases }: { testCases: TestCase[] }) {
  return html`
    <table class="overview-table section-index">
      <thead>
        <tr>${indexColumns().map((column) => html`<th key=${column}>${column}</th>`)}</tr>
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
          <${CopyButton} title=${t("copy.section")} getText=${() => categoryToMarkdown(category, testCases)} />
        </div>
      </div>
      ${showIndex ? html`<${SectionIndex} testCases=${testCases} />` : null}
      ${testCases.map((tc, i) => html`${premiseHeadings(tc, testCases[i - 1]).map((premise) => html`<div class="premise-heading" role="heading" aria-level=${Math.min(6, premise.depth + 4)} style=${`padding-inline-start: ${premise.depth + 1}rem`}>${premise.text}</div>`)}<${TestCaseCard} key=${tc._tcId} tc=${tc} level=${level + 1} />`)}
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
  layer?: string;
  layerLabel?: string;
  layerDescription?: string;
  tcId: string;
  name: string;
  status: string | null;
  statusTitle: string;
  method: string;
  methodTitle: string;
  statusKey: CaseStatus;
  methodKey: CaseMethod;
  inactive: boolean;
  tags: string[];
  /** Suite this case belongs to, for linking to its sections */
  idPrefix: string;
  /** Its feature holds only this suite, so the two are one node and the suite is not offered apart from the feature */
  folded: boolean;
  /** The case itself, for the plan page to show it in place */
  tc: TestCase;
  labels: Record<OverviewLevel, string>;
  /**
   * Full-path identity per level. Compared against the previous *visible* row to decide
   * dimming, which is why it is stored rather than resolved up front: filtering changes
   * which row precedes which.
   */
  keys: Record<OverviewLevel, string>;
}

/** The row's labels from `depth` down, without repeating a name a folded feature and suite share */
function labelPath(row: OverviewRow, depth: number): string {
  return OVERVIEW_LEVELS.slice(depth)
    .map((level) => row.labels[level])
    .filter((label, i, all) => i === 0 || label !== all[i - 1])
    .join(" › ");
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
            suite: suite.folded ? f.featureLabel : suite.typeName,
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
              layer: tc.layer,
              layerLabel: tc.layerLabel,
              layerDescription: tc.layerDescription,
              tcId: tc._tcId,
              name: tc.name,
              status: statusLabel(tc),
              statusTitle: tc.reason ?? tc.skip?.reason ?? "",
              method: testMethod(tc),
              methodTitle: tc.automation_note ?? "",
              statusKey: caseStatusKey(tc),
              methodKey: caseMethodKey(tc),
              inactive: isInactive(tc),
              tags: tc.tags ?? [],
              idPrefix: suite.idPrefix,
              folded: suite.folded,
              tc,
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
  return [row.tcId, ...OVERVIEW_LEVELS.map((level) => row.labels[level]), row.name, row.status ?? "", row.method, row.tc.layerLabel ?? row.tc.layer ?? "", ...row.tags].join(" ");
}

/** One choice in a `MultiPicker` */
interface PickerItem {
  description?: string;
  key: string;
  label: string;
  /** Indents the choice the way the side nav indents its level */
  depth?: number;
  count?: number;
}

/**
 * A button opening a checklist of choices, any number of which can be on. Tags and the parts of the
 * hierarchy are picked the same way on a scope page's filter and in a plan's range, so the two look
 * and behave alike. The choices are checkboxes in a popover rather than a native <select>, which
 * can only take one choice per opening.
 */
function MultiPicker({
  label,
  items,
  selected,
  onToggle,
  searchable = true,
}: {
  label: string;
  items: PickerItem[];
  selected: string[];
  onToggle: (key: string) => void;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const anchorRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    anchorRef.current?.querySelector<HTMLElement>(".picker-search, .picker-item")?.focus();
    const onDown = (e: MouseEvent) => {
      if (!anchorRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Kept in place and disabled rather than removed, so the row does not change shape from one page to the next
  const empty = items.length === 0;

  const needle = text.trim().toLowerCase();
  // A hierarchy is shown whole until someone searches it, since its indentation only means something with its parents
  const shown = needle ? items.filter((item) => matchesTerms(`${item.label} ${item.key} ${item.description ?? ""}`, searchTerms(needle))) : items;

  return html`
    <div class="picker-anchor" ref=${anchorRef}>
      <button
        ref=${buttonRef}
        class=${"picker-btn" + (selected.length > 0 ? " picker-btn-on" : "")}
        aria-haspopup="listbox"
        aria-expanded=${open && !empty}
        disabled=${empty}
        onClick=${() => {
          setOpen(!open);
          setText("");
        }}
      >
        <span>${label}</span>
        ${selected.length > 0 ? html`<span class="picker-badge">${selected.length}</span>` : null}
        <span aria-hidden="true">▾</span>
      </button>
      ${open && !empty
        ? html`<div class="picker-menu" role="listbox" aria-multiselectable="true" aria-label=${label}>
            ${searchable
              ? html`<input
                  class="picker-search"
                  type="search"
                  placeholder=${t("picker.search")}
                  value=${text}
                  onInput=${(e: Event) => setText((e.target as HTMLInputElement).value)}
                />`
              : null}
            <div class="picker-list">
              ${shown.length === 0
                ? html`<p class="picker-none">${t("picker.none")}</p>`
                : shown.map((item) => {
                    const on = selected.includes(item.key);
                    return html`<button
                      key=${item.key}
                      class=${"picker-item" + (on ? " picker-item-on" : "")}
                      title=${item.description}
                      role="option"
                      aria-selected=${on}
                      style=${{ paddingLeft: `${10 + (needle ? 0 : (item.depth ?? 0) * 14)}px` }}
                      onClick=${() => onToggle(item.key)}
                    >
                      <span class="picker-check" aria-hidden="true">${on ? "✓" : ""}</span>
                      <span class="picker-label">${item.label}</span>
                      ${item.count !== undefined ? html`<span class="picker-count">${item.count}</span>` : null}
                    </button>`;
                  })}
            </div>
          </div>`
        : null}
    </div>
  `;
}

/** Chosen tags as removable chips, the same in a plan's range and above a scope page's filter */
const tagChips = (tags: string[], onRemove: (tag: string) => void) =>
  tags.map(
    (tag) => html`<span class="tag-chip plan-range-chip" key=${tag}>
      ${tag}
      <button class="plan-chip-x" aria-label=${t("plan.removeTag", { tag })} title=${t("plan.removeTag", { tag })} onClick=${() => onRemove(tag)}>×</button>
    </span>`
  );

/** Chosen hierarchy parts as removable chips; `parts` are the choices on offer, for naming a key */
const partChips = (keys: string[], parts: RangePart[], onRemove: (key: string) => void) =>
  keys.map((key) => {
    const label = rangePartLabel(parts, key);
    return html`<span class="tag-chip plan-range-chip plan-range-part" key=${key}>
      ${label}
      <button class="plan-chip-x" aria-label=${t("plan.removePart", { name: label })} title=${t("plan.removePart", { name: label })} onClick=${() => onRemove(key)}>×</button>
    </span>`;
  });

/**
 * Puts the word that combines the chips between them. The range and the filter combine the same chips
 * differently (the range takes any of them, the filter any part and any tag), and the words are what
 * tells a reader which, so they are drawn rather than left to be remembered.
 */
function joinChips(chips: ReturnType<typeof html>[], word: string) {
  return chips.flatMap((chip, i) => (i === 0 ? [chip] : [html`<span class="chip-join" key=${`join-${i}`}>${word}</span>`, chip]));
}

/** Cases under any of the chosen parts; every case when none is chosen */
function filterByParts(rows: OverviewRow[], keys: string[]): OverviewRow[] {
  if (keys.length === 0) return rows;
  const chosen = new Set(keys);
  return rows.filter((row) => OVERVIEW_LEVELS.some((level) => chosen.has(rangeKeyOf(level, row.keys[level]))));
}

/**
 * The parts worth offering inside a scope: those that split its cases. The scope itself and its
 * parents hold every case, so choosing them would filter nothing.
 */
function scopePartsOf(rows: OverviewRow[]): RangePart[] {
  const all = rangePartsOf(rows);
  const splitting = all.filter((part) => filterByParts(rows, [part.key]).length < rows.length);
  const base = Math.min(...splitting.map((part) => part.depth));
  return splitting.map((part) => ({ ...part, depth: part.depth - base }));
}

/** The tags of these rows with how many cases carry each, in name order */
function layerItemsOf(rows: OverviewRow[], declarations: Layers[] = window.__SUITES__.map((suite) => suite.layers ?? {})): PickerItem[] {
  const counts = new Map<string, number>();
  for (const row of rows) { const key = row.tc.layer ?? ""; counts.set(key, (counts.get(key) ?? 0) + 1); }
  const keys = [...new Set([...declarations.flatMap((layers) => Object.keys(layers)), ...counts.keys()])];
  return keys.filter((key) => counts.has(key)).map((key) => {
    const row = rows.find((row) => (row.tc.layer ?? "") === key);
    return { key, label: row?.tc.layerLabel ?? (key || t("layer.unspecified")), description: row?.tc.layerDescription, count: counts.get(key) ?? 0 };
  });
}

function tagItemsOf(rows: OverviewRow[]): PickerItem[] {
  const counts = new Map<string, number>();
  for (const row of rows) for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => ({ key, label: key, count }));
}

/** Cases carrying any of the tags (as a plan's range does); every case when none is chosen */
const filterByTags = (rows: OverviewRow[], tags: string[]): OverviewRow[] => (tags.length === 0 ? rows : rows.filter((row) => row.tags.some((tag) => tags.includes(tag))));

/** Cases whose value (status or method) is any of the chosen ones; every case when none is chosen */
const filterByValue = <K extends string>(rows: OverviewRow[], chosen: string[], pick: (row: OverviewRow) => K): OverviewRow[] =>
  chosen.length === 0 ? rows : rows.filter((row) => chosen.includes(pick(row)));

/** The values present in these rows, in the order `labels` lists them, with how many cases hold each */
function valueItemsOf<K extends string>(rows: OverviewRow[], labels: Record<K, MessageKey>, pick: (row: OverviewRow) => K): PickerItem[] {
  const counts = new Map<K, number>();
  for (const row of rows) counts.set(pick(row), (counts.get(pick(row)) ?? 0) + 1);
  return (Object.keys(labels) as K[]).filter((key) => counts.has(key)).map((key) => ({ key, label: t(labels[key]), count: counts.get(key) }));
}

/** Chosen statuses or methods as removable chips */
const valueChips = (keys: string[], items: PickerItem[], onRemove: (key: string) => void) =>
  keys.map((key) => {
    const label = items.find((item) => item.key === key)?.label ?? key;
    return html`<span class="tag-chip plan-range-chip" key=${key}>
      ${label}
      <button class="plan-chip-x" aria-label=${t("plan.removePart", { name: label })} title=${t("plan.removePart", { name: label })} onClick=${() => onRemove(key)}>×</button>
    </span>`;
  });

const toggled = (list: string[], key: string): string[] => (list.includes(key) ? list.filter((other) => other !== key) : [...list, key]);

function filterOverviewRows(rows: OverviewRow[], query: string): OverviewRow[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return rows;
  return rows.filter((row) => matchesTerms(overviewRowSearchText(row), terms));
}

/** Column headings, shared by the rendered table and the Markdown export so they cannot drift */
const overviewColumns = (): string[] => [t("col.id"), t("col.domain"), t("col.feature"), t("col.suite"), t("col.section"), t("col.name"), t("col.status"), t("col.method"), t("col.tags")];

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

/** Renders the overview as a Markdown table. Repeated values are written out in full, since
 *  the dimming that stands in for them on screen has no Markdown equivalent. */
function overviewToMarkdown(rows: OverviewRow[], title: string): string {
  const groups = new Map<string, OverviewRow[]>();
  for (const row of rows) { const key = row.keys.category; groups.set(key, [...(groups.get(key) ?? []), row]); }
  return [`# ${title}`, "", ...[...groups.values()].map((group) => categoryToMarkdown(labelPath(group[0], 0), group.map((row) => row.tc), 2))].join("\n");

}

/** One step of the path shown in the app header; the last is the page itself and has no link */
interface Crumb {
  label: string;
  hash?: string;
}

/** What a scope page covers: its title, where it sits in the tree, and which rows and suites are in it */
interface ResolvedScope {
  title: string;
  /** The levels above this one, outermost first, each a link to its own page */
  ancestors: Crumb[];
  /** Element ID of the scope's page, so the sidebar's scroll tracking has an anchor to resolve */
  anchorId: string;
  suites: SuitePageData[];
  count: CaseCount;
  /** Which level of OverviewRow.keys identifies this scope, and the key value; absent for "all" */
  rowKey?: { level: OverviewLevel; value: string };
  /** How many leading levels of the hierarchy this scope already fixes (all=0 … suite=3) */
  depth: number;
}

function resolveScope(scope: Scope, suites: SuitePageData[]): ResolvedScope | null {
  const domains = groupByDomainAndFeature(suites);
  const sumCounts = (list: SuitePageData[]) => list.reduce((sum, suite) => addCounts(sum, suiteTestCaseCount(suite)), { active: 0, total: 0 });

  if (scope.kind === "all") {
    return { title: t("view.all"), ancestors: [], anchorId: "overview", suites, count: sumCounts(suites), depth: 0 };
  }
  if (scope.kind === "suite") {
    const suite = suites.find((candidate) => candidate.idPrefix === scope.idPrefix);
    if (!suite) return null;
    return {
      title: suite.folded ? suite.featureLabel : `${suite.idPrefix}: ${suite.typeName}`,
      ancestors: suite.folded
        ? [{ label: suite.domainLabel, hash: domainHash(suite.domain) }]
        : [
            { label: suite.domainLabel, hash: domainHash(suite.domain) },
            { label: suite.featureLabel, hash: featureHash(suite.domain, suite.feature) },
          ],
      anchorId: suiteAnchorId(suite.idPrefix),
      suites: [suite],
      count: suiteTestCaseCount(suite),
      rowKey: { level: "suite", value: `${suite.domain}\u0000${suite.feature}\u0000${suite.idPrefix}` },
      depth: 3,
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
    };
  }
  if (scope.kind === "feature") {
    const feature = domain?.features.find((f) => f.feature === scope.feature);
    if (!domain || !feature) return null;
    return {
      title: feature.featureLabel,
      ancestors: [{ label: domain.domainLabel, hash: domainHash(domain.domain) }],
      anchorId: featureAnchorId(domain.domain, feature.feature),
      suites: feature.suites,
      count: featureTestCaseCount(feature),
      rowKey: { level: "feature", value: `${domain.domain}\u0000${feature.feature}` },
      depth: 2,
    };
  }
  return null;
}

/** Rows of the table, with a heading row ahead of each section naming where it sits below the scope */
function useRunChanges(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const onChange = () => setVersion((n) => n + 1);
    window.addEventListener(RUN_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(RUN_CHANGE_EVENT, onChange);
  }, []);
  return version;
}

/**
 * Where each listed case stands in the active run, read from storage rather than from the cards: a
 * case's card owns its marks, and the table must follow them without owning a second copy.
 */
function useRunProgress(rows: OverviewRow[], enabled: boolean): Map<string, CaseProgress> | null {
  const runId = useContext(RunContext)?.id ?? null;
  const version = useRunChanges();
  return useMemo(() => {
    if (!enabled || !runId) return null;
    const progress = new Map<string, CaseProgress>();
    for (const row of rows) {
      if (row.inactive) continue;
      const { results } = readRun(runId, row.tc);
      progress.set(row.tcId, { outcome: caseOutcome(results), marked: results.filter((result) => result !== "").length, total: results.length });
    }
    return progress;
  }, [enabled, runId, rows, version]);
}

/**
 * Track sizes for the scope table's grid layout, one per column of `indexColumns()` and then the
 * optional Result column. Name takes what the others leave.
 */
function scopeColumnSizes(result: boolean): string {
  return ["max-content", "minmax(12rem, 1fr)", "fit-content(9rem)", "max-content", "fit-content(16rem)", ...(result ? ["max-content"] : [])].join(" ");
}

function ScopeTable({
  rows,
  depth,
  onTag,
  query,
  plan,
  planSelect,
  expand,
}: {
  rows: OverviewRow[];
  depth: number;
  onTag: (tag: string) => void;
  query: string;
  plan?: (row: OverviewRow) => PlanCells;
  planSelect?: PlanSelect;
  /** Which cases are open below their rows, held by the page so its filter bar can open or close them all */
  expand?: { isOpen: (tcId: string) => boolean; toggle: (tcId: string) => void };
}) {
  const progress = useRunProgress(rows, !plan);
  const columns = plan ? [...indexColumns(), t("col.decision"), t("col.reason")] : progress ? [...indexColumns(), t("col.result")] : indexColumns();
  const span = columns.length + (plan ? 1 : 0);
  const tickState = (ids: string[]) => {
    const ticked = ids.filter((id) => planSelect?.selected.has(id)).length;
    return { all: ids.length > 0 && ticked === ids.length, some: ticked > 0 && ticked < ids.length };
  };
  const headerState = tickState(planSelect?.listedIds ?? []);
  const sectionCount = new Set(rows.map((row) => row.keys.category)).size;
  // A suite with a single section would just repeat its own page title
  const showGroups = !(depth === OVERVIEW_LEVELS.length - 1 && sectionCount === 1);

  return html`
    <table class=${"overview-table scope-table" + (plan ? " plan-table" : "")} style=${plan ? undefined : `--scope-cols: ${scopeColumnSizes(!!progress)}`}>
      <thead>
        <tr>
          ${plan && planSelect
            ? html`<th class="plan-select-cell"><${TriCheck} checked=${headerState.all} some=${headerState.some} label=${t("plan.selectListed")} onChange=${(on: boolean) => planSelect.onMany(planSelect.listedIds, on)} /></th>`
            : plan
              ? html`<th></th>`
              : null}
          ${columns.map((column) => html`<th key=${column}>${column}</th>`)}
        </tr>
      </thead>
      ${rows.map((row, i) => {
          const startsGroup = showGroups && (i === 0 || rows[i - 1].keys.category !== row.keys.category);
          const cells = plan?.(row);
          // Planning stays on the plan page: its section headings are targets here, as on a suite page
          const groupHref = plan ? PLAN_HASH + sectionHash(row.idPrefix, row.labels.category).replace(/^#/, "") : sectionHash(row.idPrefix, row.labels.category);
          const open = !!(cells?.open || expand?.isOpen(row.tcId));
          const rowProps = {
            row,
            onTag,
            query,
            plan: cells,
            expand: expand ? { open, onToggle: () => expand.toggle(row.tcId) } : undefined,
          };
          return html`
            ${startsGroup
              ? html`<tbody key=${"group:" + row.keys.category}>
                  <tr class="scope-group" id=${categoryAnchorId(row.idPrefix, row.labels.category)}>
                    <th colspan=${span}>
                      ${plan && planSelect
                        ? (() => {
                            const ids = rows.filter((other) => other.keys.category === row.keys.category && !other.inactive).map((other) => other.tcId);
                            const state = tickState(ids);
                            return html`<${TriCheck} checked=${state.all} some=${state.some} label=${t("plan.selectSection", { name: row.labels.category })} onChange=${(on: boolean) => planSelect.onMany(ids, on)} />`;
                          })()
                        : null}
                      <a href=${groupHref}><${Highlight} text=${labelPath(row, depth)} query=${query} /></a>
                      ${plan
                        ? null
                        : html`<span class="scope-group-copy"
                            ><${CopyButton}
                              iconOnly=${true}
                              title=${t("copy.section")}
                              getText=${() => categoryToMarkdown(row.labels.category, rows.filter((other) => other.keys.category === row.keys.category).map((other) => other.tc))}
                          /></span>`}
                    </th>
                  </tr>
                </tbody>`
              : null}
            ${premiseHeadings(row.tc, i > 0 && rows[i - 1].keys.category === row.keys.category ? rows[i - 1].tc : undefined).map((premise) => html`<tbody><tr class="scope-group"><th colspan=${span}><div class="premise-heading" role="heading" aria-level=${Math.min(6, premise.depth + 4)} style=${`padding-inline-start: ${premise.depth + 1}rem`}>${premise.text}</div></th></tr></tbody>`)}
            ${plan
              ? html`<tbody key=${row.tcId} class=${"case" + (open ? " case-open" : "")}>
                  <${IndexRow} ...${rowProps} result=${undefined} />
                  ${open
                    ? html`<tr class="row-detail">
                        <td colspan=${span}>
                          <div class="cards">
                            <div class="test-case"><${CaseBody} tc=${row.tc} run=${null} /></div>
                          </div>
                        </td>
                      </tr>`
                    : null}
                </tbody>`
              : open
                ? html`<${OpenCase} key=${row.tcId} ...${rowProps} span=${span} fallback=${progress ? (progress.get(row.tcId) ?? null) : undefined} />`
                : html`<tbody key=${row.tcId} class="case" id=${testCaseAnchorId(row.tcId)}>
                    <${IndexRow} ...${rowProps} result=${progress ? (progress.get(row.tcId) ?? null) : undefined} sticky=${true} />
                  </tbody>`}
          `;
        })}
    </table>
  `;
}

/**
 * A case opened below its row. The row is the case's heading, so it carries what the card's header
 * used to (marks, Reset, Previous / Next) and the detail below repeats none of it. The two share one
 * tbody so the sticky row lets go when the case has scrolled past.
 */
function OpenCase({
  row,
  onTag,
  query,
  expand,
  span,
  fallback,
}: {
  row: OverviewRow;
  onTag: (tag: string) => void;
  query: string;
  plan: undefined;
  expand?: RowExpand;
  span: number;
  /** The row's mark as the table read it, for a table whose run has nothing open to read from */
  fallback: CaseProgress | null | undefined;
}) {
  const activeRun = useContext(RunContext);
  const run = useCaseRun(row.tc, activeRun);
  const live: CaseProgress | null | undefined = run
    ? { outcome: caseOutcome(run.results), marked: run.results.filter((result) => result !== "").length, total: run.results.length }
    : fallback;
  return html`
    <tbody class="case case-open" id=${testCaseAnchorId(row.tc._tcId)}>
      <${IndexRow}
        row=${row}
        onTag=${onTag}
        query=${query}
        expand=${expand}
        result=${live}
        onReset=${run?.reset}
        sticky=${true}
        actions=${html`<${CaseActions} tc=${row.tc} run=${run} />`}
      />
      <tr class="row-detail">
        <td colspan=${span}>
          <div class="cards">
            <div class=${"test-case" + (isInactive(row.tc) ? " test-case-inactive" : "")}><${CaseBody} tc=${row.tc} run=${run} tags=${false} /></div>
          </div>
        </td>
      </tr>
    </tbody>
  `;
}

/** How far the listed cases are through the active run */
function RunProgress({ rows }: { rows: OverviewRow[] }) {
  const progress = useRunProgress(rows, true);
  if (!progress) return null;
  const live = rows.filter((row) => !row.inactive);
  const outcomeOf = (row: OverviewRow): CaseOutcome => progress.get(row.tcId)?.outcome ?? "none";
  const done = live.filter((row) => outcomeOf(row) === "pass" || outcomeOf(row) === "fail").length;
  const failed = live.filter((row) => outcomeOf(row) === "fail").length;
  if (live.length === 0) return null;
  return html`<span class="run-progress">
    <span class="filter-count run-progress-text">${failed > 0 ? t("scope.progressFail", { done, total: live.length, failed }) : t("scope.progress", { done, total: live.length })}</span>
  </span>`;
}

/** How many cases the table lists; while filtering, "matching / all in this scope" */
function CaseCountLabel({ shown, total, filtered }: { shown: number; total: number; filtered: boolean }) {
  return html`<span class="filter-count">${caseCountText(filtered ? `${shown} / ${total}` : shown, shown)}</span>`;
}

/** What the run's plan keeps off a page, and why, so a short list is not mistaken for a missing case */
function ScopeNote({ hiddenRows, plan, editHref }: { hiddenRows: OverviewRow[]; plan: Plan; editHref: string }) {
  if (hiddenRows.length === 0) return null;
  const inRange = new Set(planRange(hiddenRows, plan).map((row) => row.tcId));
  const inactive = hiddenRows.filter((row) => row.inactive).length;
  const outside = hiddenRows.filter((row) => !row.inactive && !inRange.has(row.tcId)).length;
  const excluded = hiddenRows.filter((row) => !row.inactive && inRange.has(row.tcId) && plan.d[row.tcId] === "s").length;
  const undecided = hiddenRows.length - inactive - outside - excluded;
  const parts = [
    outside > 0 ? t("plan.hiddenOutside", { n: outside }) : "",
    excluded > 0 ? t("plan.hiddenExcluded", { n: excluded }) : "",
    undecided > 0 ? t("plan.hiddenUndecided", { n: undecided }) : "",
    inactive > 0 ? t("plan.hiddenInactive", { n: inactive }) : "",
  ].filter(Boolean);
  return html`<p class="hidden-note">
    ${t("plan.hidden", { parts: parts.join(t("plan.hiddenJoin")) })}${" "}
    <a class="scope-link" href=${editHref}>${t("plan.edit")}</a>
  </p>`;
}

/**
 * The page for one node of the tree: its cases as a table, where each case opens below its row and
 * is recorded in place. The filter narrows the table with the same rule that decides what is shown.
 */
function ScopePage({
  route,
  resolved,
  rows,
  query,
  onQueryChange,
  plan,
  scoped,
}: {
  route: Route;
  resolved: ResolvedScope | null;
  rows: OverviewRow[];
  query: string;
  onQueryChange: (query: string) => void;
  plan: Plan;
  /** A run is in use, so the page lists what its plan covers; without one the whole sheet is listed */
  scoped: boolean;
}) {
  // What the reader opened or closed by hand; a case with no entry is open only if the route points at it
  const [opened, setOpened] = useState<Map<string, boolean>>(new Map());
  const pendingJump = useRef<string | null>(null);
  const [layerFilter, setLayerFilter] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [partFilter, setPartFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [methodFilter, setMethodFilter] = useState<string[]>([]);
  const scopeHash = scopeHashFor(route.scope);
  // The parts on offer belong to the page, so a choice made on another one would only hide everything here
  useEffect(() => setPartFilter([]), [scopeHash]);
  // A link naming tags (a tag chip, the palette) opens the page filtered by them
  useEffect(() => {
    if (route.tags.length > 0) setTagFilter(route.tags);
  }, [route.hash]);
  const target = route.target;
  const isOpen = (tcId: string) => opened.get(tcId) ?? (target !== null && testCaseAnchorId(tcId) === target);
  const toggleCase = (tcId: string) => setOpened((current) => new Map(current).set(tcId, !isOpen(tcId)));
  // A link to a case the reader had closed opens it again
  useEffect(() => {
    if (!target) return;
    setOpened((current) => {
      const next = new Map(current);
      for (const id of current.keys()) if (testCaseAnchorId(id) === target) next.delete(id);
      return next;
    });
  }, [route.hash]);
  // Runs once the opened case is in the DOM, where jumping to it can measure its sticky header
  useEffect(() => {
    if (!pendingJump.current) return;
    jumpToId(testCaseAnchorId(pendingJump.current));
    pendingJump.current = null;
  });

  if (!resolved) {
    return html`<p class="empty">${t("scope.notFound")} <a href=${OVERVIEW_HASH}>${t("scope.backToAll")}</a></p>`;
  }
  if (window.__SUITES__.length === 0) {
    return html`<p class="empty">${t("scope.noFiles")}</p>`;
  }

  const { rowKey } = resolved;
  const pageRows = rowKey ? rows.filter((row) => row.keys[rowKey.level] === rowKey.value) : rows;
  // The case the route points at stays, so a link to a case outside the plan still lands on it
  const scopeIds = scoped ? planScopeIds(rows, plan) : null;
  const scopeRows = scopeIds ? pageRows.filter((row) => scopeIds.has(row.tcId) || testCaseAnchorId(row.tcId) === route.target) : pageRows;
  const shownIds = new Set(scopeRows.map((row) => row.tcId));
  const trimmedQuery = query.trim();
  const methodRows = filterByValue(
    filterByValue(filterByTags(filterByParts(filterOverviewRows(scopeRows, trimmedQuery), partFilter), tagFilter), statusFilter, (row) => row.statusKey),
    methodFilter,
    (row) => row.methodKey
  );
  const visibleRows = methodRows.filter((row) => !layerFilter.length || layerFilter.includes(row.tc.layer ?? ""));
  const statusItems = valueItemsOf(scopeRows, STATUS_LABEL_KEY, (row) => row.statusKey);
  const methodItems = valueItemsOf(scopeRows, METHOD_LABEL_KEY, (row) => row.methodKey);
  const partItems = scopePartsOf(scopeRows);
  const tagItems = tagItemsOf(scopeRows);
  const partChipList = partChips(partFilter, partItems, (key) => setPartFilter((current) => current.filter((other) => other !== key)));
  const tagChipList = tagChips(tagFilter, (tag) => setTagFilter((current) => current.filter((other) => other !== tag)));
  const statusChipList = valueChips(statusFilter, statusItems, (key) => setStatusFilter((current) => current.filter((other) => other !== key)));
  const methodChipList = valueChips(methodFilter, methodItems, (key) => setMethodFilter((current) => current.filter((other) => other !== key)));
  // Any of the chosen within a group, every group at once; no frame around each group, which only added another outline to every chip
  const chipGroups = [partChipList, tagChipList, statusChipList, methodChipList].filter((chips) => chips.length > 0);
  const filterChips = html`${chipGroups.flatMap((chips, i) => [
    ...(i > 0 ? [html`<span class="chip-join" key=${`and-${i}`}>${t("chips.and")}</span>`] : []),
    html`<span class="chip-group" key=${`group-${i}`}>${joinChips(chips, t("chips.or"))}</span>`,
  ])}`;
  const allOpen = visibleRows.length > 0 && visibleRows.every((row) => isOpen(row.tcId));
  const setAll = (open: boolean) => setOpened(new Map(visibleRows.map((row) => [row.tcId, open])));
  const nav: CaseNav = {
    order: visibleRows.map((row) => row.tcId),
    go: (tcId) => {
      pendingJump.current = tcId;
      setOpened((current) => new Map(current).set(tcId, true));
    },
  };

  return html`
    <section class="overview scope-page" id=${resolved.anchorId}>
      <details class="layer-summary"><summary>${t("layer.summary")}</summary><table><thead><tr><th>${t("col.suite")}</th><th>${t("layer.summary")}</th></tr></thead><tbody>${resolved.suites.map((suite) => html`<tr><th>${suite.typeName}</th><td>${layerSummary(scopeRows.filter((row) => row.idPrefix === suite.idPrefix).map((row) => row.tc), suite.layers)}</td></tr>`)}</tbody></table></details>
      <div class="scope-table-wrap">
        ${html`<div class="plan-range filter-chips">
              <span class="plan-label" title=${t("filter.byHelp")}>${t("filter.by")}</span>
              <${MultiPicker}
                label=${t("picker.parts")}
                items=${partItems.map((part) => ({ key: part.key, label: part.label.split(" › ").pop() ?? part.label, depth: part.depth }))}
                selected=${partFilter}
                onToggle=${(key: string) => setPartFilter((current) => toggled(current, key))}
              />
              <${MultiPicker} label=${t("layer.label")} items=${layerItemsOf(scopeRows, resolved.suites.map((suite) => suite.layers ?? {}))} selected=${layerFilter} onToggle=${(key: string) => setLayerFilter((current) => toggled(current, key))} />
              <${MultiPicker} label=${t("picker.tags")} items=${tagItems} selected=${tagFilter} onToggle=${(tag: string) => setTagFilter((current) => toggled(current, tag))} />
              <${MultiPicker} label=${t("picker.status")} items=${statusItems} selected=${statusFilter} onToggle=${(key: string) => setStatusFilter((current) => toggled(current, key))} searchable=${false} />
              <${MultiPicker} label=${t("picker.method")} items=${methodItems} selected=${methodFilter} onToggle=${(key: string) => setMethodFilter((current) => toggled(current, key))} searchable=${false} />
              ${filterChips}
            </div>`}
        <div class="filter-bar">
          <input
            class="overview-search"
            type="search"
            placeholder=${t("filter.placeholder")}
            value=${query}
            onInput=${(e: Event) => onQueryChange((e.target as HTMLInputElement).value)}
          />
          <div class="filter-actions">
            ${route.scope.kind === "all" ? html`<a class="scope-link" href=${ALL_HASH}>${t("scope.readAsOne")}</a>` : null}
            <${RunProgress} rows=${visibleRows} />
            <${CaseCountLabel} shown=${visibleRows.length} total=${scopeRows.length} filtered=${layerFilter.length > 0 || trimmedQuery !== "" || tagFilter.length > 0 || partFilter.length > 0 || statusFilter.length > 0 || methodFilter.length > 0} />
            ${visibleRows.length > 0
              ? html`<button class="copy-btn" title=${allOpen ? t("scope.collapseAll") : t("scope.expandAll")} onClick=${() => setAll(!allOpen)}>
                  <span aria-hidden="true">${allOpen ? "▾" : "▸"}</span>
                  <span>${allOpen ? t("scope.collapseAll") : t("scope.expandAll")}</span>
                </button>`
              : null}
            <${CopyButton}
              title=${t("copy.listed")}
              getText=${() => overviewToMarkdown(visibleRows, resolved.title)}
            />
          </div>
        </div>
        ${visibleRows.length === 0
          ? html`<p class="empty">${t("filter.none")}</p>`
          : html`<${CaseNavContext.Provider} value=${nav}>
              <${ScopeTable} rows=${visibleRows} depth=${resolved.depth} onTag=${(tag: string) => setTagFilter((current) => toggled(current, tag))} query=${trimmedQuery} expand=${{ isOpen, toggle: toggleCase }} />
            </${CaseNavContext.Provider}>`}
      </div>
      ${scopeIds ? html`<${ScopeNote} hiddenRows=${pageRows.filter((row) => !shownIds.has(row.tcId))} plan=${plan} editHref=${planHashForScope(route.scope)} />` : null}
    </section>
  `;
}

const planHasRange = (plan: Plan): boolean => plan.layers.length > 0 || plan.tags.length > 0 || plan.parts.length > 0;

/**
 * The cases a run's plan covers: those carrying one of its tags or sitting under one of its domains,
 * features or suites (any of them, as with tags), or all of them when it names none
 */
function planRange(rows: OverviewRow[], plan: Plan): OverviewRow[] {
  rows = rows.filter((row) => !plan.layers.length || plan.layers.includes(row.tc.layer ?? ""));
  if (!plan.tags.length && !plan.parts.length) return rows;
  const parts = new Set(plan.parts);
  return rows.filter((row) => row.tags.some((tag) => plan.tags.includes(tag)) || OVERVIEW_LEVELS.some((level) => parts.has(rangeKeyOf(level, row.keys[level]))));
}

/**
 * The cases a run covers: those the plan decided Run, within its range and active. Excluded and
 * undecided cases are left out (the review sheet is where an exclusion is explained). Null when no
 * case is decided Run: such a plan has not been made yet, and the run covers the whole sheet.
 */
function planScopeIds(rows: OverviewRow[], plan: Plan): Set<string> | null {
  const rangeIds = new Set(planRange(rows, plan).map((row) => row.tcId));
  const covered = rows.filter((row) => rangeIds.has(row.tcId) && !row.inactive && plan.d[row.tcId] === "r");
  return covered.length === 0 ? null : new Set(covered.map((row) => row.tcId));
}

interface PlanGap {
  row: OverviewRow;
  targetId: string;
  what: string;
  why: MessageKey;
}

/**
 * Checks a case in the run leaves to another case that is not in it. Only case targets count: a test in
 * the code or a check elsewhere does not depend on what this plan runs. Empty while the plan has made no
 * Run decision, since the run then covers the whole sheet.
 */
function planGaps(rows: OverviewRow[], plan: Plan): PlanGap[] {
  const scope = planScopeIds(rows, plan);
  if (!scope) return [];
  const byId = new Map(rows.map((row) => [row.tcId, row]));
  return rows
    .filter((row) => scope.has(row.tcId))
    .flatMap((row) =>
      (row.tc.covered_by ?? []).flatMap((item): PlanGap[] => {
        if (!("case" in item) || scope.has(item.case)) return [];
        const target = byId.get(item.case);
        const why: MessageKey = !target ? "plan.gaps.why.missing" : target.inactive ? "plan.gaps.why.inactive" : "plan.gaps.why.notRun";
        return [{ row, targetId: item.case, what: item.what, why }];
      })
    );
}

/** What starting testing would mark Run: the range's active cases nobody has decided yet */
function undecidedCandidates(rows: OverviewRow[], plan: Plan): OverviewRow[] {
  return planRange(rows, plan).filter((row) => !row.inactive && !plan.d[row.tcId]);
}

/** Hierarchy levels a range can name; sections are not a unit anyone releases by */
const RANGE_PART_LEVELS = ["domain", "feature", "suite"] as const;

interface RangePart {
  key: string;
  /** Position in the hierarchy, which indents the picker the way the side nav does */
  depth: number;
  /** Enough of the path to tell two same-named features apart */
  label: string;
}

/** Every domain, feature and suite in the sheet, in document order with parents first */
function rangePartsOf(rows: OverviewRow[]): RangePart[] {
  const parts = new Map<string, RangePart>();
  for (const row of rows) {
    RANGE_PART_LEVELS.forEach((level, depth) => {
      if (level === "suite" && row.folded) return;
      const key = rangeKeyOf(level, row.keys[level]);
      if (!parts.has(key)) parts.set(key, { key, depth, label: RANGE_PART_LEVELS.slice(0, depth + 1).map((l) => row.labels[l]).join(" › ") });
    });
  }
  return [...parts.values()];
}

/** A part the sheet no longer has still shows, so it can be removed rather than silently shaping the range */
const rangePartLabel = (parts: RangePart[], key: string): string => parts.find((part) => part.key === key)?.label ?? key.slice(key.indexOf(":") + 1).split("\u0000").pop() ?? key;

/** An inactive case has its reason in the YAML already, so it is not asked to be decided */
function tallyPlan(rows: OverviewRow[], plan: Plan) {
  const live = rows.filter((row) => !row.inactive);
  return {
    run: live.filter((row) => plan.d[row.tcId] === "r").length,
    skip: live.filter((row) => plan.d[row.tcId] === "s").length,
    undecided: live.filter((row) => !plan.d[row.tcId]).length,
    inactive: rows.length - live.length,
  };
}

/**
 * Sets a decision and/or a reason on several cases. A decision of `null` clears it; `undefined` leaves
 * it. A reason fills only cases that have none, unless told to overwrite, so what was written case by
 * case is not lost to a bulk edit by accident.
 */
function applyPlan(plan: Plan, ids: string[], change: { decision?: Decision | null; reason?: string; overwrite: boolean }): { plan: Plan; reasonsWritten: number } {
  const d = { ...plan.d };
  const why = { ...plan.why };
  let reasonsWritten = 0;
  for (const id of ids) {
    if (change.decision === null) delete d[id];
    else if (change.decision) d[id] = change.decision;
    if (change.reason && (change.overwrite || !why[id]?.trim())) {
      why[id] = change.reason;
      reasonsWritten++;
    }
  }
  return { plan: { ...plan, d, why }, reasonsWritten };
}

/** A reviewer reads this to judge the selection, so it lists the whole range and says what is missing */
function planReviewToMarkdown(runName: string, plan: Plan, rows: OverviewRow[], sheetIds: Set<string>): string {
  const inRange = planRange(rows, plan);
  const rangeIds = new Set(inRange.map((row) => row.tcId));
  const tally = tallyPlan(inRange, plan);
  const decisionText = (row: OverviewRow) =>
    row.inactive
      ? t("plan.inactiveWith", { status: row.status ?? "" })
      : plan.d[row.tcId] === "r"
        ? t("plan.run")
        : plan.d[row.tcId] === "s"
          ? t("plan.skip")
          : `**${t("plan.undecided")}**`;
  const tableRows = (list: OverviewRow[]) =>
    list.map((row) => {
      const cells = [
        row.tcId,
        labelPath(row, 0),
        row.name,
        decisionText(row),
        row.inactive ? row.statusTitle : (plan.why[row.tcId] ?? ""),
      ];
      return `| ${cells.map(escapeMarkdownCell).join(" | ")} |`;
    });
  const columns = [t("col.id"), t("col.location"), t("col.name"), t("col.decision"), t("col.reason")];
  const header = [`| ${columns.join(" | ")} |`, `|${columns.map(() => "---").join("|")}|`];

  const undecided = inRange.filter((row) => !row.inactive && !plan.d[row.tcId]).map((row) => row.tcId);
  const skippedBare = inRange.filter((row) => plan.d[row.tcId] === "s" && !plan.why[row.tcId]?.trim()).map((row) => row.tcId);
  const outside = rows.filter((row) => plan.d[row.tcId] && !rangeIds.has(row.tcId));
  const gone = Object.keys(plan.d).filter((id) => !sheetIds.has(id));

  const lines = [
    `# ${t("plan.review.title", { name: runName })}`,
    "",
    `> ${t("plan.review.summary", {
      range: !planHasRange(plan)
        ? t("plan.review.allTags")
        : [
            [...plan.parts.map((key) => rangePartLabel(rangePartsOf(rows), key)), ...plan.tags.map((tag) => `\`${tag}\``)].join(` ${t("chips.or")} `),
            plan.layers.length ? `${t("layer.label")}: ${plan.layers.map((layer) => layerItemsOf(rows).find((item) => item.key === layer)?.label ?? (layer || t("layer.unspecified"))).join(` ${t("chips.or")} `)}` : "",
          ].filter(Boolean).map((part) => `(${part})`).join(` ${t("chips.and")} `),
      total: inRange.length,
      run: tally.run,
      skip: tally.skip,
      inactive: tally.inactive,
      undecided: tally.undecided,
    })}`,
    "",
    ...header,
    ...tableRows(inRange),
  ];
  if (undecided.length > 0 || skippedBare.length > 0) {
    lines.push("", `## ${t("plan.review.attention")}`, "");
    if (undecided.length > 0) lines.push(`- ${t("plan.review.undecidedList", { n: undecided.length, ids: undecided.join(", ") })}`);
    if (skippedBare.length > 0) lines.push(`- ${t("plan.review.skipNoReason", { n: skippedBare.length, ids: skippedBare.join(", ") })}`);
  }
  const gaps = planGaps(rows, plan);
  if (gaps.length > 0) {
    const gapColumns = [t("col.id"), t("col.check"), t("col.coveredBy"), t("col.reason")];
    lines.push(
      "",
      `## ${t("plan.review.gaps", { n: gaps.length })}`,
      "",
      `| ${gapColumns.join(" | ")} |`,
      `|${gapColumns.map(() => "---").join("|")}|`,
      ...gaps.map((gap) => `| ${[gap.row.tcId, gap.what, gap.targetId, t(gap.why)].map(escapeMarkdownCell).join(" | ")} |`)
    );
  }
  if (outside.length > 0) {
    lines.push("", `## ${t("plan.review.outside", { n: outside.length })}`, "", ...header, ...tableRows(outside));
  }
  if (gone.length > 0) lines.push("", `> ${t("plan.review.gone", { n: gone.length, ids: gone.join(", ") })}`);
  return lines.join("\n");
}

/**
 * Where the person planning a run chooses what it covers. The range is a set of exact tags and
 * hierarchy keys rather than the filter's text: that text also matches names and translated labels, so it could not name
 * the same cases twice. Decisions are kept per case, so a case added to the sheet later is undecided.
 */
function PlanPage({
  run,
  resolved,
  target,
  plan,
  rows,
  sheetIds,
  query,
  onQueryChange,
  onPlan,
}: {
  run: ActiveRun | null;
  /** The part of the sheet being planned, chosen in the outline; the whole sheet when it is "all" */
  resolved: ResolvedScope | null;
  /** A case the route points at, shown open so the jump lands on its card */
  target: string | null;
  plan: Plan;
  rows: OverviewRow[];
  sheetIds: Set<string>;
  query: string;
  onQueryChange: (query: string) => void;
  onPlan: (change: (current: Plan) => Plan) => void;
}) {
  // What the reader opened or closed by hand; a case with no entry is open only if the route points at it
  const [opened, setOpened] = useState<Map<string, boolean>>(new Map());
  // Ticked for a bulk action. Held here, not in the plan: it is a moment's working set, not a decision.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastTicked = useRef<number | null>(null);
  const [bulkReason, setBulkReason] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [decisionFilter, setDecisionFilter] = useState<"" | Decision | "none" | "decided">("");
  /** What the last bulk action did, with the plan before it; valid only while the plan is as that action left it */
  const [outcome, setOutcome] = useState<{ text: string; before: Plan; after: Plan } | null>(null);
  useEffect(() => {
    setOpened(new Map());
    setSelected(new Set());
    lastTicked.current = null;
    setOutcome(null);
  }, [resolved?.anchorId, run?.id]);
  // The controls stay in view while the table scrolls, but how tall they are depends on how the range
  // chips wrap, so the table head's offset (--filter-h) follows the measured height
  const barRef = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(0);
  const hasBar = !!run && !!resolved;
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const measure = () => setBarHeight(bar.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [hasBar]);
  if (!run) return html`<p class="empty">${t("plan.needRun")}</p>`;
  if (!resolved) return html`<p class="empty">${t("scope.notFound")} <a href=${PLAN_HASH}>${t("scope.backToAll")}</a></p>`;

  const allTags = tagItemsOf(rows);
  const allParts = rangePartsOf(rows);
  const rangeRows = planRange(rows, plan);
  const { rowKey } = resolved;
  const partRows = rowKey ? rangeRows.filter((row) => row.keys[rowKey.level] === rowKey.value) : rangeRows;
  const trimmedQuery = query.trim();
  const decisionOf = (row: OverviewRow) => (row.inactive ? undefined : (plan.d[row.tcId] ?? "none"));
  const listed = filterOverviewRows(partRows, trimmedQuery).filter((row) => decisionFilter === "" || (decisionFilter === "decided" ? decisionOf(row) === "r" || decisionOf(row) === "s" : decisionOf(row) === decisionFilter));
  const listedIds = listed.filter((row) => !row.inactive).map((row) => row.tcId);
  const tally = tallyPlan(rangeRows, plan);
  const gaps = planGaps(rows, plan);

  const tick = (ids: string[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const tickRow = (id: string, shift: boolean) => {
    const index = listedIds.indexOf(id);
    const on = !selected.has(id);
    const from = lastTicked.current;
    if (shift && from !== null && index >= 0) tick(listedIds.slice(Math.min(from, index), Math.max(from, index) + 1), on);
    else tick([id], on);
    if (index >= 0) lastTicked.current = index;
  };

  const selectedIds = [...selected];
  const hiddenSelected = selectedIds.filter((id) => !listedIds.includes(id)).length;
  const reasonChoices = (() => {
    const counts = new Map<string, number>();
    for (const reason of Object.values(plan.why)) if (reason.trim()) counts.set(reason, (counts.get(reason) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).map(([reason]) => reason);
  })();
  const outcomeShown = outcome && plan.d === outcome.after.d && plan.why === outcome.after.why ? outcome : null;

  const apply = (decision: Decision | null | undefined, text: (n: number, reasons: number) => string) => {
    const reason = bulkReason.trim();
    const result = applyPlan(plan, selectedIds, { decision, reason: reason || undefined, overwrite });
    onPlan(() => result.plan);
    setOutcome({ text: text(selectedIds.length, result.reasonsWritten), before: plan, after: result.plan });
  };
  const decisionName = (decision: Decision) => (decision === "r" ? t("plan.run") : t("plan.skip"));

  const isOpen = (row: OverviewRow) => opened.get(row.tcId) ?? (target !== null && testCaseAnchorId(row.tcId) === target);
  const cellsFor = (row: OverviewRow): PlanCells => ({
    decision: plan.d[row.tcId],
    reason: plan.why[row.tcId] ?? "",
    onDecide: (decision) => onPlan((current) => applyPlan(current, [row.tcId], { decision: decision ?? null, overwrite: true }).plan),
    onReason: (reason) =>
      onPlan((current) => {
        const why = { ...current.why };
        if (reason.trim()) why[row.tcId] = reason.trim();
        else delete why[row.tcId];
        return { ...current, why };
      }),
    open: isOpen(row),
    onToggleOpen: () => setOpened((current) => new Map(current).set(row.tcId, !isOpen(row))),
    selected: selected.has(row.tcId),
    onSelect: (shift) => tickRow(row.tcId, shift),
  });

  return html`
    <section
      class="overview scope-page plan-page"
      id="plan"
      style=${{ "--filter-h": barHeight > 0 ? `${barHeight}px` : undefined }}
      onKeyDown=${(e: KeyboardEvent) => {
        if (e.key === "Escape" && !e.isComposing && selected.size > 0) setSelected(new Set());
      }}
    >
      <div class="plan-bar" ref=${barRef}>
        <div class="plan-head">
          <div class="plan-range">
            <span class="plan-label" title=${t("plan.rangeHelp")}>${t("plan.range")}</span>
            <${MultiPicker}
              label=${t("plan.addPart")}
              items=${allParts.map((part) => ({ key: part.key, label: part.label.split(" › ").pop() ?? part.label, depth: part.depth }))}
              selected=${plan.parts}
              onToggle=${(key: string) => onPlan((current) => ({ ...current, parts: toggled(current.parts, key) }))}
            />
            <${MultiPicker}
              label=${t("plan.addTag")}
              items=${allTags}
              selected=${plan.tags}
              onToggle=${(tag: string) => onPlan((current) => ({ ...current, tags: toggled(current.tags, tag) }))}
            />
            <${MultiPicker} label=${t("layer.label")} items=${layerItemsOf(rows)} selected=${plan.layers} onToggle=${(key: string) => onPlan((current) => ({ ...current, layers: toggled(current.layers, key) }))} />
            ${joinChips(
              [
                ...partChips(plan.parts, allParts, (key) => onPlan((current) => ({ ...current, parts: current.parts.filter((other) => other !== key) }))),
                ...tagChips(plan.tags, (tag) => onPlan((current) => ({ ...current, tags: current.tags.filter((other) => other !== tag) }))),
              ],
              t("chips.or")
            )}
            ${planHasRange(plan) ? html`<span class="plan-note">${t("plan.inRange", { count: caseCountText(rangeRows.length) })}</span>` : html`<span class="plan-note">${t("plan.rangeAll")}</span>`}
          </div>
          <div class="plan-summary">${t("plan.summary", { ...tally })}</div>
        </div>
        <div class="filter-bar">
          <input
            class="overview-search"
            type="search"
            placeholder=${t("filter.placeholder")}
            value=${query}
            onInput=${(e: Event) => onQueryChange((e.target as HTMLInputElement).value)}
          />
          <select
            class="plan-decision-filter"
            aria-label=${t("plan.decisionFilter")}
            value=${decisionFilter}
            onChange=${(e: Event) => setDecisionFilter((e.target as HTMLSelectElement).value as "" | Decision | "none" | "decided")}
          >
            <option value="">${t("plan.filterAny")}</option>
            <option value="decided">${t("plan.filterDecided")}</option>
            <option value="r">${t("plan.run")}</option>
            <option value="s">${t("plan.skip")}</option>
            <option value="none">${t("plan.undecided")}</option>
          </select>
          <div class="filter-actions">
            <${CaseCountLabel} shown=${listed.length} total=${partRows.length} filtered=${trimmedQuery !== "" || decisionFilter !== ""} />
            <${CopyButton} title=${t("plan.copyReviewTitle")} getText=${() => planReviewToMarkdown(run.name, plan, rows, sheetIds)} />
          </div>
        </div>
        ${selected.size > 0 || outcomeShown
          ? html`<div class="plan-selection" role="region" aria-label=${t("plan.selectionRegion")}>
              <div class="plan-selection-line">
                <span role="status" aria-live="polite" class="plan-selected-count">
                  ${outcomeShown
                    ? outcomeShown.text
                    : hiddenSelected > 0
                      ? t("plan.selectedHidden", { n: selected.size, hidden: hiddenSelected })
                      : t("plan.selected", { n: selected.size })}
                </span>
                ${outcomeShown ? html`<button class="link-btn" onClick=${() => { onPlan(() => outcomeShown.before); setOutcome(null); }}>${t("plan.undo")}</button>` : null}
                ${selected.size > 0 ? html`<button class="link-btn" onClick=${() => setSelected(new Set())}>${t("plan.deselect")}</button>` : null}
              </div>
              ${selected.size > 0
                ? html`<div class="plan-selection-line">
                    <input
                      class="plan-bulk-reason"
                      list="plan-reasons"
                      value=${bulkReason}
                      maxlength="300"
                      placeholder=${t("plan.reasonPlaceholder")}
                      aria-label=${t("plan.bulkReason")}
                      onInput=${(e: Event) => setBulkReason((e.target as HTMLInputElement).value)}
                    />
                    <datalist id="plan-reasons">${reasonChoices.map((reason) => html`<option key=${reason} value=${reason}></option>`)}</datalist>
                    <label class="filter-toggle plan-overwrite">
                      <input type="checkbox" checked=${overwrite} onChange=${(e: Event) => setOverwrite((e.target as HTMLInputElement).checked)} />
                      <span>${t("plan.overwriteReasons")}</span>
                    </label>
                    <div class="plan-actions">
                      <button class="copy-btn" onClick=${() => apply("r", (n, reasons) => t("plan.applied", { decision: decisionName("r"), n, reasons }))}>${t("plan.run")}</button>
                      <button class="copy-btn" onClick=${() => apply("s", (n, reasons) => t("plan.applied", { decision: decisionName("s"), n, reasons }))}>${t("plan.skip")}</button>
                      <button class="copy-btn" onClick=${() => apply(null, (n) => t("plan.appliedClear", { n }))}>${t("plan.clearDecision")}</button>
                      <button class="copy-btn" disabled=${bulkReason.trim() === ""} onClick=${() => apply(undefined, (_n, reasons) => t("plan.appliedReason", { n: reasons }))}>${t("plan.reasonOnly")}</button>
                    </div>
                  </div>`
                : null}
            </div>`
          : null}
      </div>

      ${gaps.length > 0
        ? html`<details class="plan-gaps">
            <summary>${t("plan.gaps.title", { n: gaps.length })}</summary>
            <p class="plan-gaps-help">${t("plan.gaps.help")}</p>
            <ul>
              ${gaps.map((gap, i) => html`<li key=${i}>${t("plan.gaps.line", { what: gap.what, from: gap.row.tcId, to: gap.targetId, why: t(gap.why) })}</li>`)}
            </ul>
          </details>`
        : null}
      <div class="scope-table-wrap">
        ${listed.length === 0
          ? html`<p class="empty">${t("filter.none")}</p>`
          : html`<${ScopeTable}
              rows=${listed}
              depth=${resolved.depth}
              onTag=${(tag: string) => onPlan((current) => ({ ...current, tags: toggled(current.tags, tag) }))}
              query=${trimmedQuery}
              plan=${cellsFor}
              planSelect=${{ selected, listedIds, onMany: tick }}
            />`}
      </div>
    </section>
  `;
}

function featureAnchorId(domain: string, feature: string): string {
  return `domain-${encodeURIComponent(domain)}-feature-${encodeURIComponent(feature)}`;
}

function SuiteGuide({ suite }: { suite: SuitePageData }) {
  if (!suite.guideHtml) return null;
  return html`<details class="guide" id=${guideAnchorId(suite.idPrefix)}>
    <summary class="guide-summary">${t("guide.summary")}</summary>
    <div class="guide-body" dangerouslySetInnerHTML=${{ __html: suite.guideHtml }} />
  </details>`;
}

/**
 * A suite's guide docked beside its cases, so it can be read while working through them. Its body
 * scrolls independently of the page; that and the sidebar's list are the only nested scrollers.
 */
function GuidePanel({
  suite,
  onSuite,
  width,
  limit,
  onClose,
  onResize,
  onResetWidth,
}: {
  /** The page's suite when it has a guide; absent on a page that has none */
  suite: SuitePageData | undefined;
  /** The page is a suite's, so a missing guide means that suite has none rather than that the page is not a suite */
  onSuite: boolean;
  width: number;
  limit: number;
  onClose: () => void;
  onResize: (width: number) => void;
  onResetWidth: () => void;
}) {
  return html`
    <aside
      class="guide-panel"
      aria-label=${t("guide.label")}
      onKeyDown=${(e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <${Resizer} edge="start" width=${width} size=${GUIDE_SIZE} limit=${limit} label=${t("guide.resize")} onResize=${onResize} onReset=${onResetWidth} />
      <div class="guide-panel-head">
        <span class="guide-panel-title" title=${suite ? `${suite.idPrefix}: ${suite.typeName}` : undefined}>${suite ? t("guide.panelTitle", { name: suite.typeName }) : t("guide.panelNone")}</span>
        <button class="header-btn header-btn-icon" title=${t("guide.close")} aria-label=${t("guide.close")} onClick=${onClose}>✕</button>
      </div>
      <div class="guide-panel-body" tabindex="0">
        ${suite
          ? html`<div class="guide" id=${guideAnchorId(suite.idPrefix)}>
              <div class="guide-body" dangerouslySetInnerHTML=${{ __html: suite.guideHtml }} />
            </div>`
          : html`<p class="guide-empty">${onSuite ? t("guide.none") : t("guide.noneHere")}</p>`}
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
  // A folded suite has no heading of its own: the feature's heading above it is the same node
  return html`
    <section class="suite-section" id=${suiteAnchorId(suite.idPrefix)} style=${suite.folded ? "--guide-depth: 2" : undefined}>
      ${suite.folded
        ? null
        : html`<h1 class="suite-title sticky-header sticky-level-2">
            <span class="suite-title-text">${suite.idPrefix}: ${suite.typeName}</span>
            <span class="suite-title-right">
              <span class="suite-title-count"><${CountLabel} testCases=${suite.testCases} /></span>
              <${CopyButton} title=${t("copy.suite")} getText=${() => allTestCasesToMarkdown(suite)} />
            </span>
          </h1>`}
      <${SuiteGuide} suite=${suite} />
      <${SuiteCategories} suite=${suite} testCases=${suite.testCases} level=${suite.folded ? 2 : 3} showIndex=${true} />
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
  // Its suite's heading already carries the feature's name
  if (group.suites.length === 1 && group.suites[0].folded) return allTestCasesToMarkdown(group.suites[0], headingLevel);
  const lines = [`${"#".repeat(headingLevel)} ${group.featureLabel}`, "", `> ${t("md.caseCount", { count: formatCaseCount(featureTestCaseCount(group)) })}`, ""];
  for (const suite of group.suites) {
    lines.push(allTestCasesToMarkdown(suite, headingLevel + 1));
  }
  return lines.join("\n");
}

function domainToMarkdown(group: DomainGroup): string {
  const lines = [`# ${group.domainLabel}`, "", `> ${t("md.caseCount", { count: formatCaseCount(domainTestCaseCount(group)) })}`, ""];
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
          <span class="suite-title-count">${caseCountText(featureTestCaseCount(group).total)}</span>
          <${CopyButton} title=${t("copy.feature")} getText=${() => featureToMarkdown(group)} />
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
          <span class="suite-title-count">${caseCountText(domainTestCaseCount(group).total)}</span>
          <${CopyButton} title=${t("copy.domain")} getText=${() => domainToMarkdown(group)} />
        </span>
      </h2>
      ${group.features.map((f) => html`<${FeatureSection} key=${f.feature} domain=${group.domain} group=${f} />`)}
    </div>
  `;
}

const OVERVIEW_HASH = "#/overview";
const ALL_HASH = "#/all";
const PLAN_HASH = "#/plan";

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

/** The overview filtered to exactly this tag, which a text query cannot say: it also matches names */
function overviewTagHash(tag: string): string {
  return `${OVERVIEW_HASH}?tag=${encodeURIComponent(tag)}`;
}

interface NavEntry {
  kind: "view" | "tag" | "domain" | "feature" | "suite" | "guide" | "category" | "testcase";
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
  /** A suite that has a guide, so the outline can say so without opening it */
  hasGuide?: boolean;
  /** Which cases the entry covers, as a key of `planRangeCounts`; absent for entries that cover none */
  rangeKey?: string;
  /** Anchor of the suite this guide/section/case belongs to, so the outline can open just the active suite */
  suiteId?: string;
  /** Belongs to a folded suite, whose node sits one level higher than a suite's, so its children indent one less */
  folded?: boolean;
}

const KIND_LABEL_KEY: Record<NavEntry["kind"], MessageKey> = {
  view: "kind.view",
  tag: "kind.tag",
  domain: "kind.domain",
  feature: "kind.feature",
  suite: "kind.suite",
  guide: "kind.guide",
  category: "kind.section",
  testcase: "kind.testcase",
};

/** Everything inside a case, so searching matches step and precondition wording too */
function testCaseSearchText(tc: TestCase): string {
  const parts = [tc._tcId, tc.name];
  if (tc.category) parts.push(tc.category);
  if (tc.preconditions) parts.push(formatPreconditions(tc.preconditions));
  if (tc.test_data) parts.push(formatTestData(tc.test_data));
  for (const step of tc.steps ?? []) parts.push(step.action, step.expected);
  if (tc.notes) parts.push(tc.notes);
  if (tc.automation_note) parts.push(tc.automation_note);
  for (const item of tc.covered_by ?? []) parts.push(item.what, handoffTarget(item));
  for (const item of tc.dropped ?? []) parts.push(item.what, item.reason);
  if (tc.layer) parts.push(tc.layer, tc.layerLabel ?? "", tc.layerDescription ?? "");
  if (tc.automation_reason) parts.push(tc.automation_reason);
  if (tc.tags) parts.push(...tc.tags);
  for (const source of tc.sources ?? []) parts.push(source.file, source.title ?? "", source.code);
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
      rangeKey: rangeKeyOf("domain", d.domain),
    });
    for (const f of d.features) {
      const folded = f.suites.length === 1 && f.suites[0].folded;
      if (!folded) {
        entries.push({
          kind: "feature",
          id: featureAnchorId(d.domain, f.feature),
          hash: featureHash(d.domain, f.feature),
          label: f.featureLabel,
          searchText: `${f.feature} ${f.featureLabel}`,
          breadcrumb: d.domainLabel,
          count: featureTestCaseCount(f).active,
          rangeKey: rangeKeyOf("feature", `${d.domain}\u0000${f.feature}`),
        });
      }
      for (const suite of f.suites) {
        if (folded) {
          // Takes the suite's anchor so the suite page's route and scroll tracking land on it, but keeps the feature's hash so the link survives a second suite
          entries.push({
            kind: "feature",
            id: suiteAnchorId(suite.idPrefix),
            hash: featureHash(d.domain, f.feature),
            label: f.featureLabel,
            searchText: `${f.feature} ${f.featureLabel} ${suite.idPrefix} ${suite.typeName}`,
            breadcrumb: d.domainLabel,
            count: suiteTestCaseCount(suite).active,
            hasGuide: !!suite.guideHtml,
            rangeKey: rangeKeyOf("feature", `${d.domain}\u0000${f.feature}`),
          });
        } else {
          entries.push({
            kind: "suite",
            id: suiteAnchorId(suite.idPrefix),
            hash: suiteHash(suite.idPrefix),
            label: suite.typeName,
            // Not part of the display label, but lets searching by idPrefix (e.g. "CR") match the suite itself
            searchText: `${suite.idPrefix} ${suite.typeName}`,
            breadcrumb: `${d.domainLabel} › ${f.featureLabel}`,
            count: suiteTestCaseCount(suite).active,
            hasGuide: !!suite.guideHtml,
            rangeKey: rangeKeyOf("suite", `${d.domain}\u0000${f.feature}\u0000${suite.idPrefix}`),
          });
        }
        const suiteId = suiteAnchorId(suite.idPrefix);
        const suitePath = folded ? `${d.domainLabel} › ${f.featureLabel}` : `${d.domainLabel} › ${f.featureLabel} › ${suite.typeName}`;
        const guideBreadcrumb = suitePath;
        if (guideDetail === "none") {
          // The sidebar leaves guides out: a guide is opened from the page it belongs to, and found by search
        } else if (guideDetail === "collapsed") {
          // Keyed off guideHtml, not guideHeadings: a guide with no h2 still needs an entry
          if (suite.guideHtml) {
            entries.push({
              kind: "guide",
              id: guideAnchorId(suite.idPrefix),
              hash: guideHash(suite.idPrefix),
              label: t("guide.label"),
              searchText: `${suite.idPrefix} guide ${t("guide.label")} ${suite.guideText}`,
              breadcrumb: guideBreadcrumb,
              suiteId,
              folded,
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
              folded,
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
            breadcrumb: suitePath,
            count: cases.filter((tc) => !isInactive(tc)).length,
            suiteId,
            folded,
            rangeKey: rangeKeyOf("category", `${d.domain}\u0000${f.feature}\u0000${suite.idPrefix}\u0000${category}`),
          });
          if (!includeTestCases) continue;
          for (const tc of cases) {
            entries.push({
              kind: "testcase",
              id: testCaseAnchorId(tc._tcId),
              hash: testCaseHash(tc._tcId),
              label: `${tc._tcId}: ${tc.name}`,
              searchText: testCaseSearchText(tc),
              breadcrumb: `${suitePath} › ${category}`,
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
  if (kind === "view" || kind === "tag") return "nav-outline-view";
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
const ALL_RANGE_KEY = "all";
const rangeKeyOf = (level: OverviewLevel, key: string): string => `${level}:${key}`;

/** Active cases of the plan's range per outline entry, in one pass over the rows */
function planRangeCountsOf(rows: OverviewRow[], plan: Plan): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const row of planRange(rows, plan)) {
    if (row.inactive) continue;
    bump(ALL_RANGE_KEY);
    for (const level of OVERVIEW_LEVELS) bump(rangeKeyOf(level, row.keys[level]));
  }
  return counts;
}

/**
 * While planning, the outline picks which part of the sheet is being planned rather than leaving for
 * that part's page. Cases and guides are not parts of the plan, so they still open as they are.
 */
function planHashFor(entry: NavEntry, suites: SuitePageData[]): string {
  // A guide is a reading surface tied to the browsing pages, so it still opens there
  if (entry.kind === "guide") return entry.hash;
  // A tag filters the browsing pages; the plan has its own tag picker, so a tag here just stays on the plan
  if (entry.kind === "tag") return PLAN_HASH;
  const target = parseRoute(entry.hash, suites);
  if (target.mode !== "table") return entry.hash;
  // A section or a case is a target within its suite's page, here as there
  if (entry.kind === "category" || entry.kind === "testcase") return PLAN_HASH + entry.hash.replace(/^#/, "");
  return planHashForScope(target.scope);
}

/** The browsing page of a scope: where planning ends up, and the inverse of planHashForScope */
function scopeHashFor(scope: Scope): string {
  return scope.kind === "domain" ? domainHash(scope.domain) : scope.kind === "feature" ? featureHash(scope.domain, scope.feature) : scope.kind === "suite" ? suiteHash(scope.idPrefix) : OVERVIEW_HASH;
}

/** The plan page for the same part of the sheet as a scope page */
function planHashForScope(scope: Scope): string {
  return PLAN_HASH + (scope.kind === "all" ? "" : scopeHashFor(scope).replace(/^#/, ""));
}

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
  planRangeCounts,
}: {
  suites: SuitePageData[];
  route: Route;
  /** While planning with a range, how many active cases of each entry fall in it; null otherwise */
  planRangeCounts: Map<string, number> | null;
  onNavigate: (entry: NavEntry) => void;
  width: number;
  onResize: (width: number) => void;
}) {
  const allEntry: NavEntry = {
    kind: "view",
    id: OVERVIEW_HASH,
    hash: OVERVIEW_HASH,
    label: t("view.all"),
    searchText: "",
    count: suites.reduce((sum, suite) => sum + suiteTestCaseCount(suite).active, 0),
    rangeKey: ALL_RANGE_KEY,
  };
  const entries = [allEntry, ...buildNavEntries(suites, "none", false)];
  const inRange = (entry: NavEntry): number | undefined => (planRangeCounts && entry.rangeKey ? (planRangeCounts.get(entry.rangeKey) ?? 0) : undefined);
  // A section picked in the outline stays selected on the page that opens, where the page may be too short to scroll it to the top and scroll tracking would never fire
  const selectedId = route.target && entries.some((entry) => entry.id === route.target) ? route.target : scopeEntryId(route.scope);
  const tracksScroll = route.mode === "full" || (route.mode === "table" && route.scope.kind === "suite");
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
        ? currentEntry && (currentEntry.kind === "suite" || suites.some((suite) => suiteAnchorId(suite.idPrefix) === currentEntry.id))
          ? currentEntry.id
          : (currentEntry?.suiteId ?? null)
        : null;
  const visibleEntries = entries.filter((e) => isEntryVisible(e, activeSuiteId));

  return html`
    <nav class="nav-outline">
      <ul ref=${listRef}>
        ${visibleEntries.map(
          (entry) => html`
            <li key=${entry.id} class=${entryKindClass(entry.kind) + (entry.folded ? " nav-outline-folded" : "")}>
              <button
                class=${"nav-outline-item" + (entry.id === highlightId ? " nav-outline-current" : "") + (inRange(entry) === 0 ? " nav-outline-empty" : "")}
                title=${entry.label}
                onClick=${() => onJump(entry)}
              >
                <span class="nav-label">${entry.label}</span>${entry.hasGuide ? html`<span class="nav-guide" title=${t("guide.label")}><${GuideIcon} /></span>` : null}${entry.count !== undefined ? html`<span class="count">(${inRange(entry) === undefined ? entry.count : `${inRange(entry)}/${entry.count}`})</span>` : null}
              </button>
            </li>
          `
        )}
      </ul>
      <${Resizer} edge="end" width=${width} size=${NAV_SIZE} label=${t("nav.resize")} onResize=${onResize} />
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
  /** `table` lists the scope's cases; `full` is the single long page of everything (`#/all`); `plan` is where a run's cases are chosen */
  mode: "table" | "full" | "plan";
  /** Element to scroll to once the page has rendered; null scrolls to the top */
  target: string | null;
  /** Filter seeded from `?q=<query>`; empty when unfiltered */
  query: string;
  /** Tags the page opens filtered by, from `?tag=<tag>` (repeatable); exact tags, unlike `query` */
  tags: string[];
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
 *   #/overview[?q=][&tag=]             all test cases, table only (the landing page)
 *   #/all  (and #/)                    everything on one page
 *   #/plan[/d/…|/f/…|/s/…[/section/<name>]|/tc/<id>]
 *                                      choose which cases the active run covers, for all or one part of the sheet
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
  const tags = queryString
    .split("&")
    .filter((pair) => pair.startsWith("tag="))
    .map((pair) => safeDecode(pair.slice(4)))
    .filter(Boolean);
  const landing: Route = { scope: ALL_SCOPE, mode: "table", target: null, query, tags, hash };
  const segments = path.split("/").slice(1).map(safeDecode);

  if (path === "/" || segments[0] === "all") return { ...landing, mode: "full", query: "", tags: [] };
  if (segments[0] === "plan") {
    // What follows is the part of the sheet being planned, in the same grammar as the pages it narrows
    const inner = segments.length > 1 ? parseRoute(`#/${segments.slice(1).map(encodeURIComponent).join("/")}`, suites) : null;
    const part = inner?.mode === "table" ? inner : null;
    return { ...landing, mode: "plan", scope: part?.scope ?? ALL_SCOPE, target: part?.target ?? null, query: "", tags: [] };
  }

  if (segments[0] === "d" && segments.length === 2) {
    return { ...landing, scope: { kind: "domain", domain: segments[1] } };
  }
  if (segments[0] === "f" && segments.length === 3) {
    // A feature with one suite is that suite's page; its own hash stays valid so links survive a second suite being added
    const only = suites.filter((suite) => suite.domain === segments[1] && suite.feature === segments[2]);
    if (only.length === 1) return { ...landing, scope: { kind: "suite", idPrefix: only[0].idPrefix } };
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
    return { ...landing, scope: { kind: "suite", idPrefix: suite.idPrefix }, target: anchor };
  }
  return landing;
}

/** Breathing room kept above a heading when the guide panel scrolls to it */
const GUIDE_PANEL_GAP = 12;

/** Whether keys typed here belong to a field, so a single-letter shortcut must stand aside */
function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

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
  const header = el.querySelector(".sticky-header, .sticky-row");
  if (header) {
    const offset = parseFloat(getComputedStyle(header).top);
    if (offset > 0) window.scrollBy(0, -offset);
  }
  // A heading-level target (section, suite, feature…) wraps everything below it, so flashing the
  // whole element would light up its contents; its own header is what the reader asked for. A case
  // card is the leaf, and is flashed whole.
  const flashed = el.matches(".test-case") ? el : (el.querySelector<HTMLElement>(":scope > .sticky-header, :scope > .overview-row") ?? el);
  flashed.classList.add("jump-flash");
  setTimeout(() => flashed.classList.remove("jump-flash"), 1200);
  onDone?.();
}

function scrollToRoute(route: Route) {
  if (route.target) jumpToId(route.target);
  else window.scrollTo(0, 0);
}

/**
 * Where the page was scrolled on each hash. Back and forward land there instead of at the top (or at the
 * route's target): the browser cannot do it, since the page is redrawn by script after the hash changes,
 * so scroll restoration is switched to manual and kept here.
 */
const scrollMemory = new Map<string, number>();
/** The hash the page on screen was drawn for; null from the moment the hash changes until its page is drawn, so the old page's position is not overwritten */
let shownHash: string | null = null;
/** The next route came from back/forward or the address bar, not from the reader choosing a link */
let arrivedByHistory = false;
let followedAt = -Infinity;
const FOLLOW_WINDOW_MS = 1000;

/** Moving to a page the reader chose, as opposed to going back to one: a chosen page starts at its own place */
function followHash(hash: string) {
  followedAt = performance.now();
  location.hash = hash;
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
  const terms = searchTerms(trimmed);
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
            label: t("palette.filterAll", { query: trimmed }),
            searchText: "",
            count: matched,
          },
        ]
      : [];
  // Best answers first; the sort is stable, so equals keep the sheet's order
  const rankedEntries =
    terms.length > 0
      ? entries
          .map((entry) => ({ entry, score: paletteScore(entry, terms) }))
          .filter((scored): scored is { entry: NavEntry; score: number } => scored.score !== null)
          .sort((a, b) => b.score - a.score)
          .map((scored) => scored.entry)
      : [];
  const tagEntries: NavEntry[] =
    terms.length > 0
      ? tagItemsOf(overviewRows)
          .map((tag): NavEntry => ({ kind: "tag", id: overviewTagHash(tag.key), hash: overviewTagHash(tag.key), label: tag.label, searchText: tag.label, count: tag.count }))
          .filter((entry) => paletteScore(entry, terms) !== null)
      : [];
  const results = [
    ...overviewEntry,
    ...tagEntries,
    ...(terms.length > 0 ? rankedEntries : entries),
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
          placeholder=${t("palette.placeholder")}
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
                  <span class="palette-kind-badge">${t(KIND_LABEL_KEY[entry.kind])}</span>
                  <span class="palette-item-body">
                    ${entry.breadcrumb ? html`<span class="palette-breadcrumb"><${Highlight} text=${entry.breadcrumb} query=${query} fuzzy=${true} /></span>` : null}
                    <span class="palette-label">
                      <${Highlight} text=${entry.label} query=${query} fuzzy=${true} />${entry.count !== undefined ? html` <span class="count">(${entry.count})</span>` : null}
                    </span>
                  </span>
                </button>
              </li>
            `
          )}
          ${results.length === 0 ? html`<li class="nav-empty">${t("palette.none")}</li>` : null}
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
      title=${theme === "dark" ? t("theme.toLight") : t("theme.toDark")}
      aria-label=${theme === "dark" ? t("theme.toLight") : t("theme.toDark")}
      onClick=${onClick}
    >
      ${theme === "dark"
        ? html`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" /></svg>`
        : html`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>`}
    </button>
  `;
}

const LANG_STORAGE_KEY = "test-sheet-lang";

const LOCALES = mergeLocales(window.__LOCALES__ ?? []);

function readStoredLang(): string | null {
  try {
    return localStorage.getItem(LANG_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredLang(code: string) {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, code);
  } catch {
    // Blocked storage (e.g. over file://): the choice lasts for this visit only
  }
}

function findLocale(code: string): LocaleDefinition {
  return LOCALES.find((locale) => locale.code === code) ?? LOCALES[0];
}

/** A language the reader picked wins; otherwise the browser's own preference, so a first visit needs no setup */
function initialLocale(): LocaleDefinition {
  const stored = readStoredLang();
  if (stored && LOCALES.some((locale) => locale.code === stored)) return findLocale(stored);
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
  return findLocale(matchLocale(LOCALES, preferred));
}

function applyLocale(locale: LocaleDefinition) {
  setLocale(locale);
  document.documentElement.lang = locale.code;
}

applyLocale(initialLocale());

function LanguageMenu({ current, onChange }: { current: string; onChange: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    anchorRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!anchorRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return html`
    <div class="lang-anchor" ref=${anchorRef}>
      <button
        ref=${buttonRef}
        class="header-btn header-btn-icon"
        title=${t("lang.title")}
        aria-label=${t("lang.title")}
        aria-haspopup="menu"
        aria-expanded=${open}
        onClick=${() => setOpen(!open)}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
      </button>
      ${open
        ? html`<div class="lang-menu" role="menu" aria-label=${t("lang.title")}>
            ${LOCALES.map(
              (locale) => html`<button
                key=${locale.code}
                class=${"lang-item" + (locale.code === current ? " lang-item-current" : "")}
                role="menuitemradio"
                aria-checked=${locale.code === current}
                lang=${locale.code}
                onClick=${() => {
                  onChange(locale.code);
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
              >
                <span class="lang-mark" aria-hidden="true">${locale.code === current ? "✓" : ""}</span>${locale.label}
              </button>`
            )}
          </div>`
        : null}
    </div>
  `;
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
    title=${t("resizer.hint")}
    onPointerDown=${onPointerDown}
    onPointerMove=${onPointerMove}
    onPointerUp=${onPointerUp}
    onPointerCancel=${onPointerUp}
    onKeyDown=${onKeyDown}
    onDblClick=${onReset ?? (() => onResize(size.defaultWidth))}
  />`;
}

const defaultName = (): string => t("runs.defaultName", { date: todayStamp() });

function formatRunTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(formattingLocale(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * The saved runs of this sheet: pick one to resume, start a new one, rename or delete. Runs are
 * shared by every tab, so the one chosen here is the one recorded into everywhere.
 */
function RunMenu({
  index,
  totalCases,
  rows,
  onSelect,
  onStop,
  onCreate,
  onRename,
  onDelete,
  onClose,
}: {
  index: RunIndex;
  totalCases: number;
  rows: OverviewRow[];
  onSelect: (id: string) => void;
  onStop: () => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => Promise<void>;
  /** `byKeyboard` is true for Esc, where focus should return to the button that opened the menu */
  onClose: (byKeyboard: boolean) => void;
}) {
  const [recorded] = useState(recordedCaseIds);
  const [newName, setNewName] = useState(() => (index.runs.length === 0 ? defaultName() : ""));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const newRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // With no run yet the thing to do is name one; otherwise start on the run in use
    if (index.runs.length === 0) newRef.current?.select();
    else menuRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.focus();
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // The pill that opens this menu closes it itself; counting that click as "outside" would reopen it
      if (!menuRef.current?.contains(target) && !(target as HTMLElement).closest?.(".run-btn")) onClose(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing) onClose(true);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const askDelete = async (run: RunMeta) => {
    setBusy(run.id);
    const screenshots = await countImagesWithPrefix(runImagePrefix(run.id));
    setBusy(null);
    const cases = recorded[run.id]?.size ?? 0;
    // A deleted run cannot be got back, screenshots included
    const stops = run.id === index.last ? t("runs.stops") : "";
    if (confirm(t("runs.confirmDelete", { name: run.name, cases: tn("unit.case", cases), shots: tn("unit.screenshot", screenshots), stops }))) {
      await onDelete(run.id);
    }
  };

  return html`
    <div class="run-menu" ref=${menuRef} role="dialog" aria-label=${t("runs.title")}>
      <div class="run-menu-head">
        <span>${t("runs.title")}</span>
        <span class="run-menu-note">${t("runs.savedNote")}</span>
      </div>
      ${index.runs.length === 0
        ? html`<p class="run-menu-empty">${t("runs.empty")}</p>`
        : html`<ul class="run-menu-list">
            <li class=${"run-row run-row-off" + (index.last === null ? " run-row-active" : "")}>
              <button class="run-pick" aria-current=${index.last === null} onClick=${onStop}>
                <span class="run-mark" aria-hidden="true">${index.last === null ? "●" : "○"}</span>
                <span class="run-text">
                  <span class="run-name">${t("runs.notRecording")}</span>
                  <span class="run-meta">${t("runs.readOnly")}</span>
                </span>
              </button>
            </li>
            ${[...index.runs]
              .sort((a, b) => b.u.localeCompare(a.u))
              .map((run) => {
                const isActive = run.id === index.last;
                const marked = recorded[run.id] ?? new Set<string>();
                const runPlan = readPlan(run.id);
                const planned = planScopeIds(rows, runPlan);
                const meta =
                  planned
                    ? t("runs.metaPlan", { done: [...planned].filter((id) => marked.has(id)).length, total: planned.size, time: formatRunTime(run.u) })
                    : t("runs.meta", { done: marked.size, total: totalCases, time: formatRunTime(run.u) });
                return html`<li key=${run.id} class=${"run-row" + (isActive ? " run-row-active" : "")}>
                  ${renaming === run.id
                    ? html`<input
                        class="run-rename"
                        value=${renameText}
                        maxlength="80"
                        aria-label=${t("runs.nameLabel")}
                        onInput=${(e: Event) => setRenameText((e.target as HTMLInputElement).value)}
                        onKeyDown=${(e: KeyboardEvent) => {
                          if (e.isComposing) return;
                          if (e.key === "Enter") {
                            onRename(run.id, renameText);
                            setRenaming(null);
                          } else if (e.key === "Escape") {
                            e.stopPropagation();
                            setRenaming(null);
                          }
                        }}
                        ref=${(el: HTMLInputElement | null) => el?.focus()}
                      />`
                    : html`<button class="run-pick" aria-current=${isActive} onClick=${() => onSelect(run.id)}>
                        <span class="run-mark" aria-hidden="true">${isActive ? "●" : "○"}</span>
                        <span class="run-text">
                          <span class="run-name" title=${run.name}>${run.name}</span>
                          <span class="run-meta">${meta}</span>
                        </span>
                      </button>`}
                  <span class="run-actions">
                    ${isActive ? html`<a class="link-btn" href=${PLAN_HASH} onClick=${() => onClose(false)}>${t("plan.edit")}</a>` : null}
                    <button class="link-btn" onClick=${() => { setRenaming(run.id); setRenameText(run.name); }}>${t("runs.rename")}</button>
                    <button class="link-btn link-btn-danger" disabled=${busy === run.id} onClick=${() => askDelete(run)}>${t("runs.delete")}</button>
                  </span>
                </li>`;
              })}
          </ul>`}
      <form
        class="run-new"
        onSubmit=${(e: Event) => {
          e.preventDefault();
          onCreate(newName);
        }}
      >
        <input
          ref=${newRef}
          class="run-new-input"
          value=${newName}
          maxlength="80"
          placeholder=${t("runs.newPlaceholder")}
          aria-label=${t("runs.newLabel")}
          onInput=${(e: Event) => setNewName((e.target as HTMLInputElement).value)}
        />
        <button type="submit" class="copy-btn">${t("runs.create")}</button>
      </form>
    </div>
  `;
}

function AppHeader({
  crumbs,
  pageHeading,
  planExitHash,
  planHash,
  onCancelPlan,
  startAll,
  onStart,
  onOpenPalette,
  navCollapsed,
  onToggleNav,
  runIndex,
  activeRun,
  totalCases,
  rows,
  runMenuOpen,
  onRunMenuOpen,
  onSelectRun,
  onStopRecording,
  onCreateRun,
  onRenameRun,
  onDeleteRun,
  lang,
  onChangeLang,
  guideOpen,
  guideAvailable,
  onToggleGuide,
}: {
  /** Where the reader is, outermost first; the last is the page and is not a link */
  crumbs: Crumb[];
  /** Whether the page's own title is the document's heading (the single long page has headings of its own) */
  pageHeading: boolean;
  /** Where "Done planning" leads while the plan page is shown; null elsewhere */
  planExitHash: string | null;
  /** Where planning the run in use for the page shown starts */
  planHash: string;
  /** Leaves planning without keeping what was changed; absent when there is no run to plan */
  onCancelPlan: (() => void) | null;
  /** With no case decided Run, starting marks this many undecided ones Run first; `ranged` says whether a range chose them */
  startAll: { n: number; ranged: boolean } | null;
  onStart: () => void;
  lang: string;
  onChangeLang: (code: string) => void;
  onOpenPalette: () => void;
  /** The guide panel is shown; it exists only beside a table page, where the button is otherwise disabled */
  guideOpen: boolean;
  guideAvailable: boolean;
  onToggleGuide: () => void;
  navCollapsed: boolean;
  onToggleNav: () => void;
  runIndex: RunIndex;
  activeRun: ActiveRun | null;
  totalCases: number;
  rows: OverviewRow[];
  runMenuOpen: boolean;
  onRunMenuOpen: (open: boolean) => void;
  onSelectRun: (id: string) => void;
  onStopRecording: () => void;
  onCreateRun: (name: string) => void;
  onRenameRun: (id: string, name: string) => void;
  onDeleteRun: (id: string) => Promise<void>;
}) {
  const shortcut = navigator.userAgent.includes("Mac") ? "⌘K" : "Ctrl+K";
  const runButtonRef = useRef<HTMLButtonElement>(null);
  const current = crumbs[crumbs.length - 1];
  // The plan is the run's, and the title already names it; the button's room goes to the way out. Without a run it stays: it is how one is chosen.
  const hideRecord = planExitHash !== null && activeRun !== null;
  const Heading = pageHeading ? "h1" : "span";

  return html`
    <header class="app-header">
      <div class="app-header-lead">
        <button
          class="header-btn header-btn-icon"
          title=${navCollapsed ? t("nav.show") : t("nav.hide")}
          aria-pressed=${navCollapsed}
          onClick=${onToggleNav}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></svg>
        </button>
        <nav class="app-crumbs" aria-label=${t("nav.breadcrumb")} title=${crumbs.map((crumb) => crumb.label).join(" › ")}>
          <ol>
            ${crumbs.slice(0, -1).map((crumb) => html`<li key=${crumb.label} class="crumb crumb-ancestor"><a href=${crumb.hash}>${crumb.label}</a></li>`)}
            <li class="crumb crumb-current" aria-current="page"><${Heading} class="app-header-title">${current.label}</${Heading}></li>
          </ol>
        </nav>
      </div>
      <div class="app-header-actions">
        ${planExitHash !== null && onCancelPlan
          ? html`<button class="header-btn plan-cancel" title=${t("plan.cancelTitle")} onClick=${onCancelPlan}><span aria-hidden="true">✕</span><span class="plan-done-text">${t("plan.cancel")}</span></button>`
          : null}
        ${planExitHash
          ? html`<a class="header-btn header-btn-on plan-done" href=${planExitHash} title=${startAll ? t("plan.startAllTitle") : t("plan.doneTitle")} onClick=${onStart}><span aria-hidden="true">✓</span><span class="plan-done-text">${startAll ? t(startAll.ranged ? "plan.startRange" : "plan.startAll", { n: startAll.n }) : t("plan.done")}</span></a>`
          : null}
        ${hideRecord
          ? null
          : html`<div class="run-anchor">
          <button
            ref=${runButtonRef}
            class=${"header-btn run-btn" + (activeRun ? " header-btn-on" : "")}
            aria-haspopup="dialog"
            aria-expanded=${runMenuOpen}
            title=${activeRun ? t("header.runTitleOn", { name: activeRun.name }) : t("header.runTitleOff")}
            onClick=${() => onRunMenuOpen(!runMenuOpen)}
          >
            ${activeRun
              ? html`<span class="run-dot" aria-hidden="true">●</span><span class="visually-hidden">${t("header.recordingInto")}</span><span class="run-btn-name">${activeRun.name}</span>`
              : html`<span class="run-btn-name">${t("header.record")}</span>`}
            <span aria-hidden="true">▾</span>
          </button>
          ${runMenuOpen
            ? html`<${RunMenu}
                index=${runIndex}
                totalCases=${totalCases}
                rows=${rows}
                onSelect=${onSelectRun}
                onStop=${onStopRecording}
                onCreate=${onCreateRun}
                onRename=${onRenameRun}
                onDelete=${onDeleteRun}
                onClose=${(byKeyboard: boolean) => {
                  onRunMenuOpen(false);
                  if (byKeyboard) runButtonRef.current?.focus();
                }}
              />`
            : null}
        </div>`}
        ${activeRun && planExitHash === null
          ? html`<a class="header-btn run-plan" href=${planHash} title=${t("plan.openTitle")}>${t("plan.edit")}</a>
              <button class="header-btn header-btn-icon run-exit" title=${t("header.exitRun")} aria-label=${t("header.exitRun")} onClick=${onStopRecording}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>`
          : null}
        <button
          class=${"header-btn guide-toggle" + (guideOpen ? " header-btn-on" : "")}
          aria-pressed=${guideOpen}
          disabled=${!guideAvailable}
          title=${!guideAvailable ? t("guide.unavailable") : `${guideOpen ? t("guide.hide") : t("guide.show")} (G)`}
          aria-label=${t("guide.label")}
          aria-keyshortcuts="g"
          onClick=${onToggleGuide}
        >
          <${GuideIcon} />
          <span class="guide-toggle-text">${t("guide.label")}</span>
        </button>
        <button class="header-btn" title=${t("header.searchTitle")} onClick=${onOpenPalette}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
          <span>${t("header.search")}</span>
          <kbd class="header-kbd">${shortcut}</kbd>
        </button>
        <${LanguageMenu} current=${lang} onChange=${onChangeLang} />
        <${ThemeToggle} />
      </div>
    </header>
  `;
}

const FILTERS_STORAGE_KEY = "test-sheet-filters";

/** sessionStorage: a filter should outlast a reload of the tab, not the tab itself */
function readFilters(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(FILTERS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeFilters(filters: Record<string, string>) {
  try {
    sessionStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Blocked storage (e.g. over file://): filters last until the page is reloaded
  }
}

/** Which page's filter a route uses: pages are told apart by scope, not by case or section within one */
function scopeKey(route: Route): string {
  return `${route.mode}:${JSON.stringify(route.scope)}`;
}

/** Command-palette entries for the two page-wide views, which have no outline entry of their own */
const allTestCasesEntry = (): NavEntry => ({
  kind: "view",
  id: OVERVIEW_HASH,
  hash: OVERVIEW_HASH,
  label: t("view.all"),
  searchText: `${t("view.all")} overview index list table all test cases`,
});

const planEntry = (): NavEntry => ({
  kind: "view",
  id: PLAN_HASH,
  hash: PLAN_HASH,
  label: t("plan.title"),
  searchText: `${t("plan.title")} plan tailoring scope select skip review`,
});

const onePageEntry = (): NavEntry => ({
  kind: "view",
  id: ALL_HASH,
  hash: ALL_HASH,
  label: t("view.onePage"),
  searchText: `${t("view.onePage")} all one page everything single long print`,
});

function App() {
  const suites = window.__SUITES__;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(readNavCollapsed);
  const [navWidth, setNavWidth] = useState(() => readPanelWidth(NAV_SIZE));
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash, suites));
  const planning = route.mode === "plan";
  const entries = buildNavEntries(suites, "headings", true);
  const overviewRows = buildOverviewRows(suites);
  /**
   * Local so typing in the filter box does not push a history entry per keystroke.
   * The route only seeds it — see the effect below.
   */
  /**
   * Each page keeps the filter typed on it, so coming back to a list after opening a case, or
   * pressing Back, finds it as it was. The address is left alone: rewriting it while typing is what
   * made a filter follow the reader to pages it was never typed on. Kept for this tab, and across a
   * reload of it.
   */
  const [filters, setFilters] = useState<Record<string, string>>(readFilters);
  const pageKey = scopeKey(route);
  /** The route whose `?q=` (from a link, say) has been taken into the filters, so typing can then change it */
  const [queryTakenFrom, setQueryTakenFrom] = useState<string | null>(null);
  const routeQueryPending = route.query !== "" && queryTakenFrom !== route.hash;
  // Derived rather than set in an effect, so a page never renders once with another page's filter
  const query = routeQueryPending ? route.query : (filters[pageKey] ?? "");
  const setQuery = useCallback(
    (text: string) =>
      setFilters((current) => {
        const next = { ...current };
        if (text === "") delete next[pageKey];
        else next[pageKey] = text;
        return next;
      }),
    [pageKey]
  );
  useEffect(() => writeFilters(filters), [filters]);
  const [guideOpen, setGuideOpen] = useState(readGuideOpen);
  const [runIndex, setRunIndex] = useState(readRunIndex);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const activeRun = useMemo<ActiveRun | null>(() => {
    const run = runIndex.runs.find((candidate) => candidate.id === runIndex.last);
    return run ? { id: run.id, name: run.name } : null;
  }, [runIndex.last, runIndex.runs]);
  const activeRunId = activeRun?.id ?? null;
  const sheetIds = useMemo(() => new Set(suites.flatMap((suite) => suite.testCases.map((tc) => tc._tcId))), [suites]);
  const [planStore, setPlanStore] = useState<{ runId: string | null; plan: Plan }>(() => ({ runId: activeRunId, plan: activeRunId ? readPlan(activeRunId) : emptyPlan() }));
  // Read afresh when the run in use changes, so a plan is never shown against another run
  const plan = planStore.runId === activeRunId ? planStore.plan : activeRunId ? readPlan(activeRunId) : emptyPlan();
  const planRef = useRef(plan);
  planRef.current = plan;
  const updatePlan = useCallback(
    (change: (current: Plan) => Plan) => {
      if (!activeRunId) return;
      const next = { ...change(planRef.current), u: new Date().toISOString() };
      planRef.current = next;
      writePlan(activeRunId, next, sheetIds);
      setPlanStore({ runId: activeRunId, plan: next });
    },
    [activeRunId, sheetIds]
  );
  const [lang, setLang] = useState(currentLocaleCode);
  const changeLang = useCallback((code: string) => {
    applyLocale(findLocale(code));
    writeStoredLang(code);
    setLang(code);
  }, []);
  // The tab's own title says when recording, so a run left on in a background tab is not forgotten
  useEffect(() => {
    document.title = activeRun ? `● ${activeRun.name} · ${t("app.title")}` : t("app.title");
  }, [activeRun?.name, lang]);
  const totalCases = useMemo(() => suites.reduce((sum, suite) => sum + suite.testCases.length, 0), [suites]);
  const [guideWidth, setGuideWidth] = useState<number | null>(() => readStoredPanelWidth(GUIDE_SIZE));
  /** The route the reader closed the guide on, so a route that points into it does not hold it open */
  const [guideDismissedOn, setGuideDismissedOn] = useState<string | null>(null);
  const viewportWidth = useViewportWidth();

  // The suite whose guide this page offers, if any
  const pageGuideSuite =
    route.mode === "table" && route.scope.kind === "suite"
      ? suites.find((suite) => suite.idPrefix === (route.scope as { idPrefix: string }).idPrefix && suite.guideHtml)
      : undefined;
  // Only the page's own suite's guide is ever shown. The panel itself stays while it is wanted, saying so on a page without a guide, so moving about does not make it come and go
  const guideSuite = pageGuideSuite;
  const routeTargetsGuide = !!pageGuideSuite && !!route.target?.startsWith(`suite-${pageGuideSuite.idPrefix}-guide`);
  const guideAvailable = route.mode === "table";
  // Derived rather than set in an effect, so the panel is already in the DOM when the route's scroll runs
  const guidePanelOpen = guideAvailable && (guideOpen || (routeTargetsGuide && guideDismissedOn !== route.hash));
  const spaceBesideNav = viewportWidth - (navCollapsed ? 0 : navWidth);
  const guideLimit = Math.max(GUIDE_SIZE.min, spaceBesideNav - MAIN_MIN_WIDTH);
  const guideShownWidth = clampWidth(GUIDE_SIZE, guideWidth ?? Math.round(spaceBesideNav / 2), guideLimit);

  useEffect(() => {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    function onHashChange() {
      shownHash = null;
      arrivedByHistory = performance.now() - followedAt > FOLLOW_WINDOW_MS;
      setRoute(parseRoute(location.hash, suites));
    }
    function onScroll() {
      if (shownHash !== null) scrollMemory.set(shownHash, window.scrollY);
    }
    // A link in a case, a guide or a note is a plain anchor, so the choice is noticed where every click passes
    function onClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest('a[href^="#/"]')) followedAt = performance.now();
    }
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onClick, true);
    };
  }, [suites]);

  // Runs after the new page is in the DOM, so the scroll target exists
  const jumpAfterRender = useRef<Route | null>(null);
  useEffect(() => {
    const remembered = arrivedByHistory ? scrollMemory.get(route.hash) : undefined;
    arrivedByHistory = false;
    shownHash = route.hash;
    if (routeTargetsGuide) {
      setGuideOpen(true);
      writeGuideOpen(true);
    } else if (route.query) {
      setQuery(route.query);
      setQueryTakenFrom(route.hash);
    }
    // A target the page's filter has hidden (say, from the palette) is not in the DOM: clear the filter
    // and jump once the full list is there
    if (route.target && !document.getElementById(route.target) && !routeTargetsGuide && query.trim() !== "") {
      jumpAfterRender.current = route;
      setQuery("");
      return;
    }
    if (remembered !== undefined) window.scrollTo(0, remembered);
    else scrollToRoute(route);
  }, [route.hash]);

  useEffect(() => {
    if (jumpAfterRender.current) {
      scrollToRoute(jumpAfterRender.current);
      jumpAfterRender.current = null;
    }
  }, [query]);

  const planRangeCounts = useMemo(() => (planning && planHasRange(plan) ? planRangeCountsOf(overviewRows, plan) : null), [planning, plan, overviewRows]);
  const navigate = useCallback(
    (entry: NavEntry) => {
      const hash = planning ? planHashFor(entry, suites) : entry.hash;
      // Selecting the page already shown fires no hashchange, so apply its effects directly
      if (location.hash === hash) {
        const same = parseRoute(hash, suites);
        if (same.query) setQuery(same.query);
        scrollToRoute(same);
      } else {
        followHash(hash);
      }
    },
    [suites, setQuery, planning]
  );

  const setGuide = useCallback(
    (open: boolean) => {
      setGuideOpen(open);
      writeGuideOpen(open);
      setGuideDismissedOn(open ? null : route.hash);
    },
    [route.hash]
  );

  // Null where there is no guide panel to toggle, so the key is left alone there
  const toggleGuideRef = useRef<(() => void) | null>(null);
  toggleGuideRef.current = guideAvailable && !paletteOpen ? () => setGuide(!guidePanelOpen) : null;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
      } else if (e.key === "g" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.isComposing && !isTypingTarget(e.target) && toggleGuideRef.current) {
        e.preventDefault();
        toggleGuideRef.current();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const resizeGuide = useCallback((width: number) => {
    setGuideWidth(width);
    writePanelWidth(GUIDE_SIZE, width);
  }, []);

  const commitRunIndex = useCallback((next: RunIndex) => {
    writeRunIndex(next);
    setRunIndex(next);
  }, []);
  const stopRecording = useCallback(() => {
    commitRunIndex({ ...runIndex, last: null });
    setRunMenuOpen(false);
  }, [runIndex, commitRunIndex]);
  const selectRun = useCallback(
    (id: string) => {
      commitRunIndex({ ...runIndex, last: id });
      setRunMenuOpen(false);
    },
    [runIndex, commitRunIndex]
  );
  // What the plan was when planning began, so leaving by Cancel can put it back; a run made just now is dropped instead
  const freshRunId = useRef<string | null>(null);
  const planSnapshot = useRef<{ runId: string; plan: Plan; fresh: boolean } | null>(null);
  const createRun = useCallback(
    (name: string) => {
      const next = withNewRun(runIndex, name.trim() || defaultName());
      freshRunId.current = next.last;
      commitRunIndex(next);
      setRunMenuOpen(false);
      // A run begins with deciding what it covers; planning is a way out of this page, so it is not forced again from the plan page itself
      if (route.mode !== "plan") {
        followHash(planHashForScope(route.scope));
        // hashchange arrives after the next paint: waiting for it would show the header once as if the plan were not open
        setRoute(parseRoute(location.hash, suites));
      }
    },
    [runIndex, commitRunIndex, route.mode, route.scope, suites]
  );
  const renameRun = useCallback((id: string, name: string) => commitRunIndex(withRenamedRun(runIndex, id, name)), [runIndex, commitRunIndex]);
  const deleteRun = useCallback(
    async (id: string) => {
      await deleteRunData(id);
      commitRunIndex(withoutRun(rereadRunIndex(), id));
    },
    [commitRunIndex]
  );

  useEffect(() => {
    if (!planning || !activeRunId) {
      planSnapshot.current = null;
      if (!planning) freshRunId.current = null;
    } else if (planSnapshot.current?.runId !== activeRunId) {
      planSnapshot.current = { runId: activeRunId, plan: planRef.current, fresh: freshRunId.current === activeRunId };
    }
  }, [planning, activeRunId]);
  const cancelPlanning = useCallback(async () => {
    const snapshot = planSnapshot.current;
    if (!snapshot) return;
    const decisions = (value: Plan) => JSON.stringify([value.layers, value.tags, value.parts, value.d, value.why]);
    const edited = decisions(snapshot.plan) !== decisions(planRef.current);
    if (edited && !confirm(t(snapshot.fresh ? "plan.cancelConfirmNew" : "plan.cancelConfirm"))) return;
    if (snapshot.fresh) {
      await deleteRunData(snapshot.runId);
      commitRunIndex(withoutRun(rereadRunIndex(), snapshot.runId));
    } else {
      writePlan(snapshot.runId, snapshot.plan, sheetIds);
      setPlanStore({ runId: snapshot.runId, plan: snapshot.plan });
    }
    followHash(scopeHashFor(route.scope));
    setRoute(parseRoute(location.hash, suites));
  }, [commitRunIndex, sheetIds, route.scope, suites]);

  const noRunDecided = planScopeIds(overviewRows, plan) === null;
  const candidates = planning && noRunDecided ? undecidedCandidates(overviewRows, plan) : [];
  const startAll = candidates.length > 0 ? { n: candidates.length, ranged: planHasRange(plan) } : null;
  // Nothing marked Run would leave a run with nothing to run, so starting from an untouched plan marks its candidates
  const startTesting = useCallback(() => {
    if (startAll) updatePlan((current) => applyPlan(current, candidates.map((row) => row.tcId), { decision: "r", overwrite: false }).plan);
  }, [startAll, candidates, updatePlan]);

  // The runs are shared by every tab: a run chosen, created or deleted in another one reaches this one
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === runIndexKey()) setRunIndex(rereadRunIndex());
      if (activeRunId && e.key === planKey(activeRunId)) setPlanStore({ runId: activeRunId, plan: readPlan(activeRunId) });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [activeRunId]);


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

  // The one-page read follows the plan like the tables do: while a run is in use it lists only what the run covers
  const fullScopeIds = route.mode === "full" && activeRun ? planScopeIds(overviewRows, plan) : null;
  const domains = groupByDomainAndFeature(
    fullScopeIds ? suites.map((suite) => ({ ...suite, testCases: suite.testCases.filter((tc) => fullScopeIds.has(tc._tcId)) })).filter((suite) => suite.testCases.length > 0) : suites
  );
  const resolvedScope = route.mode !== "full" ? resolveScope(route.scope, suites) : null;
  const crumbs: Crumb[] =
    route.mode === "full"
      ? [{ label: t("view.onePage") }]
      : route.mode === "plan"
        ? [
            { label: activeRun ? t("plan.pageTitle", { name: activeRun.name }) : t("plan.title"), hash: resolvedScope && route.scope.kind !== "all" ? PLAN_HASH : undefined },
            ...(resolvedScope && route.scope.kind !== "all" ? [{ label: resolvedScope.title }] : []),
          ]
        : resolvedScope
        ? [...resolvedScope.ancestors, { label: resolvedScope.title }]
        : [{ label: t("app.title") }];

  return html`
    <div>
      <${AppHeader} crumbs=${crumbs} pageHeading=${route.mode !== "full"} planExitHash=${planning ? scopeHashFor(route.scope) : null} planHash=${planHashForScope(route.scope)} onCancelPlan=${planning && activeRun ? cancelPlanning : null} startAll=${startAll} onStart=${startTesting} lang=${lang} onChangeLang=${changeLang} onOpenPalette=${() => setPaletteOpen(true)} guideOpen=${guidePanelOpen} guideAvailable=${guideAvailable} onToggleGuide=${() => setGuide(!guidePanelOpen)} navCollapsed=${navCollapsed} onToggleNav=${toggleNav} runIndex=${runIndex} activeRun=${activeRun} totalCases=${totalCases} rows=${overviewRows} runMenuOpen=${runMenuOpen} onRunMenuOpen=${setRunMenuOpen} onSelectRun=${selectRun} onStopRecording=${stopRecording} onCreateRun=${createRun} onRenameRun=${renameRun} onDeleteRun=${deleteRun} />
      <${RunContext.Provider} value=${activeRun}>
      <div
        class=${"layout" + (navCollapsed ? " layout-nav-collapsed" : "")}
        style=${{ "--nav-w": `${navWidth}px`, "--guide-w": `${guideShownWidth}px` }}
      >
        <${NavOutline} suites=${suites} route=${route} onNavigate=${navigate} width=${navWidth} onResize=${resizeNav} planRangeCounts=${planRangeCounts} />
        <div class=${"app" + (route.mode !== "full" ? " app-scope" : "")}>
          ${route.mode === "full"
            ? html`${fullScopeIds
                  ? html`<div class="full-scope-bar"><${ScopeNote} hiddenRows=${overviewRows.filter((row) => !fullScopeIds.has(row.tcId))} plan=${plan} editHref=${PLAN_HASH} /></div>`
                  : null}
                <${RunContext.Provider} value=${null}>
                  ${domains.length === 0
                    ? html`<p class="empty">${fullScopeIds ? t("filter.none") : t("scope.noFiles")}</p>`
                    : domains.map((d) => html`<${DomainSection} key=${d.domain} group=${d} />`)}
                </${RunContext.Provider}>`
            : route.mode === "plan"
              ? html`<${PlanPage}
                  run=${activeRun}
                  resolved=${resolvedScope}
                  target=${route.target}
                  plan=${plan}
                  rows=${overviewRows}
                  sheetIds=${sheetIds}
                  query=${query}
                  onQueryChange=${setQuery}
                  onPlan=${updatePlan}
                />`
              : html`<${ScopePage}
                route=${route}
                resolved=${resolvedScope}
                rows=${overviewRows}
                query=${query}
                onQueryChange=${setQuery}
                plan=${plan}
                scoped=${activeRun !== null}
              />`}
        </div>
        ${guidePanelOpen
          ? html`<${GuidePanel}
              suite=${guideSuite}
              onSuite=${route.scope.kind === "suite"}
              width=${guideShownWidth}
              limit=${guideLimit}
              onClose=${() => setGuide(false)}
              onResize=${resizeGuide}
              onResetWidth=${resetGuideWidth}
            />`
          : null}
      </div>
      </${RunContext.Provider}>
      ${paletteOpen
        ? html`<${CommandPalette}
            entries=${[allTestCasesEntry(), onePageEntry(), planEntry(), ...entries]}
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
