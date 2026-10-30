// Browser-side UI (Preact + htm). Bundled by src/html/generate.ts via Bun.build()
// and inlined into the generated HTML.

import { h, render, createContext } from "preact";
import { useState, useCallback, useEffect, useMemo, useRef, useContext } from "preact/hooks";
import htmBind from "htm";
import { formatPreconditions, formatTestData, preconditionText } from "./caseFormat";
import { caseRunKey, countCasesPerRun, deleteRunData, readRunIndex, rereadRunIndex, runIndexKey, runImagePrefix, runNamespace, todayStamp, touchRun, withNewRun, withoutRun, withRenamedRun, writeRunIndex, type RunIndex, type RunMeta } from "./runStore";
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
    /** Languages supplied with `--locale`, on top of the built-in ones */
    __LOCALES__?: LocaleDefinition[];
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

/** Renders every test case in a section as a single Markdown document */
function categoryToMarkdown(category: string, testCases: TestCase[], headingLevel = 2): string {
  const lines = [`${"#".repeat(headingLevel)} ${t("md.section", { name: category })}`, ""];
  for (const tc of testCases) {
    lines.push(testCaseToMarkdown(tc, headingLevel + 1), "---", "");
  }
  return lines.join("\n");
}

function allTestCasesToMarkdown(suite: SuitePageData, headingLevel = 1): string {
  const grouped = groupByCategory(suite.testCases);
  const lines = [
    `${"#".repeat(headingLevel)} ${t("md.suiteTitle", { prefix: suite.idPrefix, type: suite.typeName })}`,
    "",
    `> ${t("md.caseCount", { count: suite.testCases.length })}`,
    "",
  ];
  for (const [category, cases] of grouped) {
    lines.push(categoryToMarkdown(category, cases, headingLevel + 1));
  }
  return lines.join("\n");
}

/** The query's occurrences in `text`, marked, so the reader sees why an entry or row matched */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  if (!q) return html`${text}`;
  const lower = text.toLowerCase();
  const parts: Array<string | ReturnType<typeof html>> = [];
  let from = 0;
  for (let at = lower.indexOf(q); at >= 0; at = lower.indexOf(q, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(html`<mark class="hit">${text.slice(at, at + q.length)}</mark>`);
    from = at + q.length;
  }
  parts.push(text.slice(from));
  return html`${parts}`;
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
      return;
    }
    const stored: StoredRun = {
      v: 1,
      h: stepsFingerprint(tc.steps),
      r: run.results,
      n: Object.fromEntries(Object.entries(run.notes).filter(([, text]) => text !== "")),
      t: run.recordedAt ?? new Date().toISOString(),
    };
    localStorage.setItem(runKey(runId, tc), JSON.stringify(stored));
    touchRun(runId);
  } catch {
    // Blocked storage (e.g. over file://): the marks last for this visit only
  }
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

function outcomeLabel(outcome: CaseOutcome, results: StepResult[]): string {
  if (outcome === "pass") return t("chip.pass");
  if (outcome === "fail") return t("chip.fail");
  return t("chip.progress", { marked: results.filter((result) => result !== "").length, total: results.length });
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
    if (result === "f") requestAnimationFrame(() => focusIn(`tr.step-note-row[data-step="${index}"] input`));
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

/** `level` is the card header's position in the stack of sticky headers above it */
function TestCaseCard({ tc, level }: { tc: TestCase; level: number }) {
  const activeRun = useContext(RunContext);
  const run = useCaseRun(tc, activeRun);
  const outcome = run ? caseOutcome(run.results) : "none";
  const hasShots = !!run && Object.values(run.images).some((list) => list.length > 0);
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
          ${tc.status === "obsolete" ? html`<span class="badge">${t("badge.obsolete")}</span>` : null}
          ${tc.status === "superseded" ? html`<span class="badge">${statusLabel(tc)}</span>` : null}
          ${tc.skip ? html`<span class="badge badge-skip">${statusLabel(tc)}</span>` : null}
          ${tc.automation && tc.automation !== "manual"
            ? html`<span class="badge badge-automation" title=${tc.scenario ?? ""}>${tc.automation}</span>`
            : null}
        </span>
        ${run && outcome !== "none"
          ? html`<span class="run-status">
              <span class=${`run-chip run-chip-${outcome}`} title=${t("chip.title", { name: activeRun?.name ?? "" })}>${outcomeLabel(outcome, run.results)}</span>
              <button class="link-btn" onClick=${run.reset}>${t("chip.reset")}</button>
            </span>`
          : null}
        <span class="test-case-actions">
          <a class="icon-btn" href=${testCaseHash(tc._tcId)} title=${t("case.link")} aria-label=${t("case.link")}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
          </a>
          <${CopyButton}
            iconOnly=${true}
            title=${hasShots ? t("copy.caseWithShots") : t("copy.case")}
            getText=${() => testCaseToMarkdown(tc, 3, run && { ...run, runName: activeRun?.name })}
          />
        </span>
      </header>
      <div class="test-case-body">
        ${hasMeta
          ? html`<div class="test-case-meta">
              ${(tc.tags ?? []).map((tag) => html`<a class="tag-chip" key=${tag} href=${overviewHash(tag)} title=${t("case.tagLink")}>${tag}</a>`)}
              ${note ? html`<span class="inactive-note">${note}</span>` : null}
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
                    <div class="test-data-body" dangerouslySetInnerHTML=${{ __html: tc.testDataHtml }} />
                  </div>`
                : null}
            </div>`
          : null}
        <${StepsTable} tcId=${tc._tcId} steps=${tc.steps} run=${run} />
        ${tc.notesHtml
          ? html`<aside class="notes">
              <h5 class="eyebrow">${t("case.note")}</h5>
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
  if (tc.status === "obsolete") return t("badge.obsolete");
  if (tc.status === "superseded") return tc.superseded_by ? t("badge.supersededBy", { by: tc.superseded_by }) : t("badge.superseded");
  if (tc.skip) return tc.skip.until ? t("badge.skipUntil", { until: tc.skip.until }) : t("badge.skip");
  return null;
}

/** How the case is run; an unset `automation` means a person runs it by hand */
function testMethod(tc: TestCase): string {
  return !tc.automation || tc.automation === "manual" ? t("method.manual") : tc.automation;
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

const indexColumns = (): string[] => [t("col.id"), t("col.name"), t("col.status"), t("col.method"), t("col.tags")];

/**
 * One case as a table row. With `onTag` a tag chip filters the table it sits in; without it the
 * chip links to the overview filtered by that tag, for tables that have no filter of their own.
 */
function IndexRow({ row, onTag, query = "" }: { row: IndexRowData; onTag?: (tag: string) => void; query?: string }) {
  return html`
    <tr class=${"overview-row" + (row.inactive ? " row-inactive" : "")} onClick=${() => goToTestCase(row.tcId)}>
      <td class="overview-id">
        <button
          class="overview-link"
          onClick=${(e: Event) => {
            e.stopPropagation();
            goToTestCase(row.tcId);
          }}
        ><${Highlight} text=${row.tcId} query=${query} /></button>
      </td>
      <td class="overview-name"><${Highlight} text=${row.name} query=${query} /></td>
      <td class="overview-status">${row.status ? html`<span class="status-lozenge" title=${row.statusTitle}><${Highlight} text=${row.status} query=${query} /></span>` : null}</td>
      <td class="overview-method overview-nowrap" data-label=${t("col.method")}><${Highlight} text=${row.method} query=${query} /></td>
      <td class="overview-tags">
        <div class="tag-list">
          ${row.tags.map((tag) =>
            onTag
              ? html`<button class="tag-chip" key=${tag} title=${t("filter.byTag")} onClick=${(e: Event) => { e.stopPropagation(); onTag(tag); }}><${Highlight} text=${tag} query=${query} /></button>`
              : html`<a class="tag-chip" key=${tag} href=${overviewHash(tag)} onClick=${(e: Event) => e.stopPropagation()}><${Highlight} text=${tag} query=${query} /></a>`
          )}
        </div>
      </td>
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
const overviewColumns = (): string[] => [t("col.id"), t("col.domain"), t("col.feature"), t("col.suite"), t("col.section"), t("col.name"), t("col.status"), t("col.method"), t("col.tags")];

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

/** Renders the overview as a Markdown table. Repeated values are written out in full, since
 *  the dimming that stands in for them on screen has no Markdown equivalent. */
function overviewToMarkdown(rows: OverviewRow[]): string {
  const columns = overviewColumns();
  const lines = [
    `# ${t("md.overview")}`,
    "",
    `> ${t("md.caseCount", { count: rows.length })}`,
    "",
    `| ${columns.join(" | ")} |`,
    `|${columns.map(() => "---").join("|")}|`,
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
  /** Markdown for the Copy button; absent for "all", whose copy follows the filtered table */
  toMarkdown?: () => string;
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
      title: `${suite.idPrefix}: ${suite.typeName}`,
      ancestors: [
        { label: suite.domainLabel, hash: domainHash(suite.domain) },
        { label: suite.featureLabel, hash: featureHash(suite.domain, suite.feature) },
      ],
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
      ancestors: [{ label: domain.domainLabel, hash: domainHash(domain.domain) }],
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
function ScopeTable({ rows, depth, onTag, query }: { rows: OverviewRow[]; depth: number; onTag: (tag: string) => void; query: string }) {
  const sectionCount = new Set(rows.map((row) => row.keys.category)).size;
  // A suite with a single section would just repeat its own page title
  const showGroups = !(depth === OVERVIEW_LEVELS.length - 1 && sectionCount === 1);

  return html`
    <table class="overview-table scope-table">
      <thead>
        <tr>${indexColumns().map((column) => html`<th key=${column}>${column}</th>`)}</tr>
      </thead>
      <tbody>
        ${rows.map((row, i) => {
          const startsGroup = showGroups && (i === 0 || rows[i - 1].keys.category !== row.keys.category);
          return html`
            ${startsGroup
              ? html`<tr key=${"group:" + row.keys.category} class="scope-group">
                  <th colspan=${indexColumns().length}>
                    <a href=${sectionHash(row.idPrefix, row.labels.category)}><${Highlight} text=${OVERVIEW_LEVELS.slice(depth).map((level) => row.labels[level]).join(" › ")} query=${query} /></a>
                  </th>
                </tr>`
              : null}
            <${IndexRow} key=${row.tcId} row=${row} onTag=${onTag} query=${query} />
          `;
        })}
      </tbody>
    </table>
  `;
}

/** A bare number: the sentence it stands for is its tooltip and label, because the bar has no room to spell it out */
function CaseCountLabel({ shown }: { shown: string }) {
  const full = t("scope.count", { count: shown });
  return html`<span class="filter-count" title=${full} aria-label=${full}>${shown}</span>`;
}

/**
 * The page for one node of the tree: its cases as a table, and for a suite the guide and the
 * case cards below it. The filter narrows the table and, on a suite, the cards with the same rule.
 */
function ScopePage({
  route,
  resolved,
  rows,
  query,
  onQueryChange,
  guideOpen,
  onToggleGuide,
  showInactive,
  onToggleInactive,
}: {
  route: Route;
  resolved: ResolvedScope | null;
  rows: OverviewRow[];
  query: string;
  onQueryChange: (query: string) => void;
  guideOpen: boolean;
  onToggleGuide: () => void;
  showInactive: boolean;
  onToggleInactive: () => void;
}) {
  if (!resolved) {
    return html`<p class="empty">${t("scope.notFound")} <a href=${OVERVIEW_HASH}>${t("scope.backToAll")}</a></p>`;
  }
  if (window.__SUITES__.length === 0) {
    return html`<p class="empty">${t("scope.noFiles")}</p>`;
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
      <div class="scope-table-wrap">
        <div class="filter-bar">
          <input
            class="overview-search"
            type="search"
            placeholder=${t("filter.placeholder")}
            value=${query}
            onInput=${(e: Event) => onQueryChange((e.target as HTMLInputElement).value)}
          />
          ${hasInactive
            ? html`<label class="filter-toggle" title=${t("filter.showInactiveTitle")}>
                <input type="checkbox" checked=${showInactive} onChange=${onToggleInactive} />
                ${t("filter.showInactive")}
              </label>`
            : null}
          <div class="filter-actions">
            ${route.scope.kind === "all" ? html`<a class="scope-link" href=${ALL_HASH}>${t("scope.readAsOne")}</a>` : null}
            <${CaseCountLabel} shown=${trimmedQuery ? `${visibleRows.length} / ${scopeRows.length}` : formatCaseCount(resolved.count)} />
            ${hasGuide
              ? html`<button
                  class=${"copy-btn guide-toggle" + (guideOpen ? " guide-toggle-on" : "")}
                  aria-pressed=${guideOpen}
                  title=${guideOpen ? t("guide.hide") : t("guide.show")}
                  onClick=${onToggleGuide}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
                  <span>${t("guide.label")}</span>
                </button>`
              : null}
            <${CopyButton}
              title=${t("copy.listed")}
              getText=${() => (resolved.toMarkdown && !trimmedQuery ? resolved.toMarkdown() : overviewToMarkdown(visibleRows))}
            />
          </div>
        </div>
        ${visibleRows.length === 0
          ? html`<p class="empty">${t("filter.none")}</p>`
          : html`<${ScopeTable} rows=${visibleRows} depth=${resolved.depth} onTag=${onQueryChange} query=${trimmedQuery} />`}
      </div>
      ${hiddenCount > 0
        ? html`<p class="hidden-note">
            ${tn("hidden", hiddenCount)}${" "}
            <button class="link-btn" onClick=${onToggleInactive}>${t("hidden.show")}</button>
          </p>`
        : null}
      ${suite && cardCases.length > 0
        ? html`<${SuiteCategories} suite=${suite} testCases=${cardCases} level=${0} showIndex=${false} />`
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
      aria-label=${t("guide.label")}
      onKeyDown=${(e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <${Resizer} edge="start" width=${width} size=${GUIDE_SIZE} limit=${limit} label=${t("guide.resize")} onResize=${onResize} onReset=${onResetWidth} />
      <div class="guide-panel-head">
        <span class="guide-panel-title" title=${`${suite.idPrefix}: ${suite.typeName}`}>${t("guide.panelTitle", { name: suite.typeName })}</span>
        <button class="header-btn header-btn-icon" title=${t("guide.close")} aria-label=${t("guide.close")} onClick=${onClose}>✕</button>
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
          <${CopyButton} title=${t("copy.suite")} getText=${() => allTestCasesToMarkdown(suite)} />
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
          <span class="suite-title-count">${formatCaseCount(featureTestCaseCount(group))}</span>
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
          <span class="suite-title-count">${formatCaseCount(domainTestCaseCount(group))}</span>
          <${CopyButton} title=${t("copy.domain")} getText=${() => domainToMarkdown(group)} />
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

const KIND_LABEL_KEY: Record<NavEntry["kind"], MessageKey> = {
  view: "kind.view",
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
          count: suiteTestCaseCount(suite).active,
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
              label: t("guide.label"),
              searchText: `${suite.idPrefix} guide ${t("guide.label")} ${suite.guideText}`,
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
            count: cases.filter((tc) => !isInactive(tc)).length,
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
    label: t("view.all"),
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
    return { ...landing, scope: { kind: "suite", idPrefix: suite.idPrefix }, target: anchor };
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
  // A heading-level target (section, suite, feature…) wraps everything below it, so flashing the
  // whole element would light up its contents; its own header is what the reader asked for. A case
  // card is the leaf, and is flashed whole.
  const flashed = el.matches(".test-case") ? el : (el.querySelector<HTMLElement>(":scope > .sticky-header") ?? el);
  flashed.classList.add("jump-flash");
  setTimeout(() => flashed.classList.remove("jump-flash"), 1200);
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
            label: t("palette.filterAll", { query: trimmed }),
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
                    ${entry.breadcrumb ? html`<span class="palette-breadcrumb"><${Highlight} text=${entry.breadcrumb} query=${query} /></span>` : null}
                    <span class="palette-label">
                      <${Highlight} text=${entry.label} query=${query} />${entry.count !== undefined ? html` <span class="count">(${entry.count})</span>` : null}
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
  onSelect,
  onStop,
  onCreate,
  onRename,
  onDelete,
  onClose,
}: {
  index: RunIndex;
  totalCases: number;
  onSelect: (id: string) => void;
  onStop: () => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => Promise<void>;
  /** `byKeyboard` is true for Esc, where focus should return to the button that opened the menu */
  onClose: (byKeyboard: boolean) => void;
}) {
  const [counts] = useState(countCasesPerRun);
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
    const cases = counts[run.id] ?? 0;
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
                          <span class="run-meta">${t("runs.meta", { done: counts[run.id] ?? 0, total: totalCases, time: formatRunTime(run.u) })}</span>
                        </span>
                      </button>`}
                  <span class="run-actions">
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
  onOpenPalette,
  navCollapsed,
  onToggleNav,
  runIndex,
  activeRun,
  totalCases,
  runMenuOpen,
  onRunMenuOpen,
  onSelectRun,
  onStopRecording,
  onCreateRun,
  onRenameRun,
  onDeleteRun,
  lang,
  onChangeLang,
}: {
  /** Where the reader is, outermost first; the last is the page and is not a link */
  crumbs: Crumb[];
  /** Whether the page's own title is the document's heading (the single long page has headings of its own) */
  pageHeading: boolean;
  lang: string;
  onChangeLang: (code: string) => void;
  onOpenPalette: () => void;
  navCollapsed: boolean;
  onToggleNav: () => void;
  runIndex: RunIndex;
  activeRun: ActiveRun | null;
  totalCases: number;
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
        <div class="run-anchor">
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
        </div>
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
  const [showInactive, setShowInactive] = useState(readShowInactive);
  const [runIndex, setRunIndex] = useState(readRunIndex);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const activeRun = useMemo<ActiveRun | null>(() => {
    const run = runIndex.runs.find((candidate) => candidate.id === runIndex.last);
    return run ? { id: run.id, name: run.name } : null;
  }, [runIndex.last, runIndex.runs]);
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

  // Runs after the new page is in the DOM, so the scroll target exists
  const jumpAfterRender = useRef<Route | null>(null);
  useEffect(() => {
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
    scrollToRoute(route);
  }, [route.hash]);

  useEffect(() => {
    if (jumpAfterRender.current) {
      scrollToRoute(jumpAfterRender.current);
      jumpAfterRender.current = null;
    }
  }, [query]);

  const navigate = useCallback(
    (entry: NavEntry) => {
      // Selecting the page already shown fires no hashchange, so apply its effects directly
      if (location.hash === entry.hash) {
        const same = parseRoute(entry.hash, suites);
        if (same.query) setQuery(same.query);
        scrollToRoute(same);
      } else {
        location.hash = entry.hash;
      }
    },
    [suites, setQuery]
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
  const createRun = useCallback(
    (name: string) => {
      commitRunIndex(withNewRun(runIndex, name.trim() || defaultName()));
      setRunMenuOpen(false);
    },
    [runIndex, commitRunIndex]
  );
  const renameRun = useCallback((id: string, name: string) => commitRunIndex(withRenamedRun(runIndex, id, name)), [runIndex, commitRunIndex]);
  const deleteRun = useCallback(
    async (id: string) => {
      await deleteRunData(id);
      commitRunIndex(withoutRun(rereadRunIndex(), id));
    },
    [commitRunIndex]
  );

  // The runs are shared by every tab: a run chosen, created or deleted in another one reaches this one
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === runIndexKey()) setRunIndex(rereadRunIndex());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
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
  const resolvedScope = route.mode === "table" ? resolveScope(route.scope, suites) : null;
  const crumbs: Crumb[] =
    route.mode === "full"
      ? [{ label: t("view.onePage") }]
      : resolvedScope
        ? [...resolvedScope.ancestors, { label: resolvedScope.title }]
        : [{ label: t("app.title") }];

  return html`
    <div>
      <${AppHeader} crumbs=${crumbs} pageHeading=${route.mode === "table"} lang=${lang} onChangeLang=${changeLang} onOpenPalette=${() => setPaletteOpen(true)} navCollapsed=${navCollapsed} onToggleNav=${toggleNav} runIndex=${runIndex} activeRun=${activeRun} totalCases=${totalCases} runMenuOpen=${runMenuOpen} onRunMenuOpen=${setRunMenuOpen} onSelectRun=${selectRun} onStopRecording=${stopRecording} onCreateRun=${createRun} onRenameRun=${renameRun} onDeleteRun=${deleteRun} />
      <${RunContext.Provider} value=${activeRun}>
      <div
        class=${"layout" + (navCollapsed ? " layout-nav-collapsed" : "")}
        style=${{ "--nav-w": `${navWidth}px`, "--guide-w": `${guideShownWidth}px` }}
      >
        <${NavOutline} suites=${suites} route=${route} onNavigate=${navigate} width=${navWidth} onResize=${resizeNav} />
        <div class=${"app" + (route.mode === "table" ? " app-scope" : "")}>
          ${route.mode === "full"
            ? domains.length === 0
              ? html`<p class="empty">${t("scope.noFiles")}</p>`
              : domains.map((d) => html`<${DomainSection} key=${d.domain} group=${d} />`)
            : html`<${ScopePage}
                route=${route}
                resolved=${resolvedScope}
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
      </${RunContext.Provider}>
      ${paletteOpen
        ? html`<${CommandPalette}
            entries=${[allTestCasesEntry(), onePageEntry(), ...entries]}
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
