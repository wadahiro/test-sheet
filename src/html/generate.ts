// Generates preview HTML from testcases.yaml data.
// Bundles app.ts at runtime via Bun.build() and inlines it into a single self-contained HTML file.

import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { Marked } from "marked";
import type { TestSuiteTestCases } from "../testCases";
import { STYLES } from "./styles";
import { createCaseMarkdown } from "./caseMarkdown";
import { formatTestData } from "./caseFormat";
import type { LocaleDefinition } from "./i18n";
import { autolinkExtension, caseReferenceRule, type AutolinkRule } from "../autolinks";

const __dirname = dirname(fileURLToPath(import.meta.url));

let cachedBundle: string | null = null;

async function bundleApp(): Promise<string> {
  if (cachedBundle) return cachedBundle;

  const result = await Bun.build({
    entrypoints: [resolve(__dirname, "app.ts")],
    target: "browser",
    format: "esm",
  });

  if (!result.success) {
    const messages = result.logs.map((log) => log.message).join("\n");
    throw new Error(`Failed to build app.ts:\n${messages}`);
  }

  const output = result.outputs[0];
  cachedBundle = await output.text();
  return cachedBundle;
}

export interface GuideHeading {
  id: string;
  text: string;
  /** Markdown of this heading's own section, so search can match guide prose, not just titles */
  body: string;
}

/**
 * Splits Markdown at its H2 headings, returning one entry per heading in document order.
 * Goes through the lexer rather than a regex so a `##` line inside a fenced code block is
 * not mistaken for a heading.
 */
function splitByH2(markdown: string, marked: Marked): string[] {
  const sections: string[] = [];
  let current: string | null = null;

  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth === 2) {
      if (current !== null) sections.push(current);
      current = "";
    } else if (current !== null) {
      current += token.raw;
    }
  }
  if (current !== null) sections.push(current);
  return sections;
}

/**
 * Renders guide Markdown to HTML, embedding an anchor ID on each H2 heading.
 * Also returns the list of embedded headings (used to build a table of contents).
 */
async function renderGuideWithHeadings(
  source: string,
  idPrefix: string,
  autolinks: AutolinkRule[]
): Promise<{ html: string; headings: GuideHeading[] }> {
  // The suite already names its guide (panel title, "Guide" summary), so a file's own leading H1 would
  // only repeat it in the largest type on the page. Only that first line goes; a later H1 is content.
  const markdown = source.replace(/^\s*#[ \t]+[^\n]*(?:\n|$)/, "");
  const headings: GuideHeading[] = [];
  let h2Index = 0;

  const marked = new Marked(autolinkExtension(autolinks), {
    renderer: {
      heading(token) {
        const text = this.parser.parseInline(token.tokens);
        if (token.depth === 2) {
          const id = `suite-${idPrefix}-guide-${h2Index++}`;
          headings.push({ id, text: token.text, body: "" });
          return `<h2 id="${id}">${text}</h2>\n`;
        }
        return `<h${token.depth}>${text}</h${token.depth}>\n`;
      },
    },
  });

  const html = await marked.parse(markdown);
  // Both walks visit H2s in document order, so the nth section belongs to the nth heading
  const sections = splitByH2(markdown, marked);
  headings.forEach((heading, i) => {
    heading.body = sections[i] ?? "";
  });

  return { html, headings };
}

interface CaseRenderers {
  /** Notes are often hard-wrapped in the YAML source; Markdown turns a single newline into a soft wrap
   *  and a blank line into a paragraph, so the text reflows to the page instead of keeping the source width. */
  notes: Marked;
  /** Step cells are short, and a newline there has always meant a new line, so it stays one */
  step: Marked;
}

function caseRenderers(autolinks: AutolinkRule[]): CaseRenderers {
  return {
    notes: createCaseMarkdown({ breaks: false, autolinks }),
    step: createCaseMarkdown({ breaks: true, autolinks }),
  };
}

// Private-use characters carry the copy buttons through Markdown, which shows raw HTML as text: they
// are plain text to it, and are turned into the span and button once the HTML is out.
const VALUE_OPEN = "\uE000";
const VALUE_CLOSE = "\uE001";
const VALUE_END = "\uE002";

/** Test data as HTML with a copy button after each value, so a login ID or a token can be taken without selecting it */
async function renderTestData(testData: unknown, marked: Marked): Promise<string> {
  const copied: string[] = [];
  const mark = (raw: string, shown = raw) => {
    // A multi-line value would break the list item or table cell it sits in
    if (raw.trim() === "" || raw.includes("\n")) return shown;
    return `${VALUE_OPEN}${shown}${VALUE_CLOSE}${copied.push(raw) - 1}${VALUE_END}`;
  };
  const markdown = formatTestData(testData, mark);
  if (!markdown) return "";
  const rendered = await marked.parse(markdown);
  return rendered
    .replaceAll(VALUE_OPEN, '<span class="td-val">')
    .replace(new RegExp(`${VALUE_CLOSE}(\\d+)${VALUE_END}`, "g"), (_, index: string) => `<button class="td-copy" type="button" data-copy="${encodeURIComponent(copied[Number(index)])}"></button></span>`);
}

async function renderTestCase(tc: TestSuiteTestCases["testCases"][number], { notes: notesMarked, step: stepMarked }: CaseRenderers) {
  const testDataHtml = await renderTestData(tc.test_data, notesMarked);
  return {
    ...tc,
    steps: await Promise.all(
      (tc.steps ?? []).map(async (step) => ({
        ...step,
        actionHtml: await stepMarked.parse(step.action ?? ""),
        expectedHtml: await stepMarked.parse(step.expected ?? ""),
      }))
    ),
    ...(tc.notes ? { notesHtml: await notesMarked.parse(tc.notes) } : {}),
    ...(testDataHtml ? { testDataHtml } : {}),
  };
}

export interface GenerateHtmlOptions {
  /** When true, enables WebSocket auto-reload in the browser (server mode only). Set to false for static output. */
  liveReload?: boolean;
  /** Languages offered besides the built-in ones; see src/locales.ts */
  locales?: LocaleDefinition[];
  /** Autolink rules for every suite, after each suite's own (`metadata.autolinks`) */
  autolinks?: AutolinkRule[];
}

/** JSON inside a <script> block ends at the first "</script>", whatever string it sits in */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export async function generateHtml(suites: TestSuiteTestCases[], options: GenerateHtmlOptions = {}): Promise<string> {
  const { liveReload = false, locales = [], autolinks: globalAutolinks = [] } = options;
  const bundledJs = await bundleApp();
  // Across every suite, since a case may point at one in another suite
  const caseReferences = caseReferenceRule(suites.flatMap((suite) => suite.testCases.map((tc) => tc._tcId ?? "")).filter(Boolean));

  // A feature holding one suite would show the same thing twice (feature, then suite), so the two fold into one node
  const suitesPerFeature = new Map<string, number>();
  for (const suite of suites) {
    const key = `${suite.domain}\u0000${suite.feature}`;
    suitesPerFeature.set(key, (suitesPerFeature.get(key) ?? 0) + 1);
  }

  const pageSuites = await Promise.all(
    suites.map(async (suite) => {
      const folded = suitesPerFeature.get(`${suite.domain}\u0000${suite.feature}`) === 1;
      const idPrefix = suite.metadata.id_prefix;
      // The suite's own rules come first, so where two match the same text its more specific one wins
      const autolinks = [...caseReferences, ...suite.autolinks, ...globalAutolinks];
      const renderers = caseRenderers(autolinks);
      const { html: guideHtml, headings: guideHeadings } = suite.guideContent
        ? await renderGuideWithHeadings(suite.guideContent, idPrefix, autolinks)
        : { html: "", headings: [] };

      return {
        domain: suite.domain,
        domainLabel: suite.domainLabel,
        feature: suite.feature,
        // Without a README heading the label is just the directory name, which the suite's own name describes better
        featureLabel: folded && suite.featureLabel === suite.feature ? suite.metadata.type_name : suite.featureLabel,
        folded,
        typeName: suite.metadata.type_name,
        idPrefix,
        testCases: await Promise.all(suite.testCases.map((tc) => renderTestCase(tc, renderers))),
        guideHtml,
        guideHeadings,
        /** Raw Markdown, carried alongside the rendered HTML purely so search can match it */
        guideText: suite.guideContent,
      };
    })
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Test Cases</title>
<style>${STYLES}</style>
<script>
// Applies the stored theme before first paint, so a dark-theme reader never sees a white flash.
// Left unset when nothing is stored (or localStorage is blocked, as it can be over file://),
// which is what makes the stylesheet fall back to the OS preference.
(function () {
  try {
    var t = localStorage.getItem("test-sheet-theme");
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  } catch (e) {}
})();
</script>
</head>
<body>
<div id="app"></div>
<script type="application/json" id="test-case-data">${jsonForScript(pageSuites)}</script>
<script type="application/json" id="locale-data">${jsonForScript(locales)}</script>
<script type="module">
window.__SUITES__ = JSON.parse(document.getElementById("test-case-data").textContent);
window.__LOCALES__ = JSON.parse(document.getElementById("locale-data").textContent);
window.__LIVE_RELOAD__ = ${liveReload};
${bundledJs}
</script>
</body>
</html>
`;
}
