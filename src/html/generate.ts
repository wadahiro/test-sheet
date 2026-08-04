// Generates preview HTML from testcases.yaml data.
// Bundles app.ts at runtime via Bun.build() and inlines it into a single self-contained HTML file.

import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { Marked } from "marked";
import type { TestSuiteTestCases } from "../testCases";
import { STYLES } from "./styles";

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
  markdown: string,
  idPrefix: string
): Promise<{ html: string; headings: GuideHeading[] }> {
  const headings: GuideHeading[] = [];
  let h2Index = 0;

  const marked = new Marked({
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

export interface GenerateHtmlOptions {
  /** When true, enables WebSocket auto-reload in the browser (server mode only). Set to false for static output. */
  liveReload?: boolean;
}

export async function generateHtml(suites: TestSuiteTestCases[], options: GenerateHtmlOptions = {}): Promise<string> {
  const { liveReload = false } = options;
  const bundledJs = await bundleApp();

  const pageSuites = await Promise.all(
    suites.map(async (suite) => {
      const idPrefix = suite.metadata.id_prefix;
      const { html: guideHtml, headings: guideHeadings } = suite.guideContent
        ? await renderGuideWithHeadings(suite.guideContent, idPrefix)
        : { html: "", headings: [] };

      return {
        domain: suite.domain,
        domainLabel: suite.domainLabel,
        feature: suite.feature,
        featureLabel: suite.featureLabel,
        typeName: suite.metadata.type_name,
        idPrefix,
        testCases: suite.testCases,
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
<script type="application/json" id="test-case-data">${JSON.stringify(pageSuites)}</script>
<script type="module">
window.__SUITES__ = JSON.parse(document.getElementById("test-case-data").textContent);
window.__LIVE_RELOAD__ = ${liveReload};
${bundledJs}
</script>
</body>
</html>
`;
}
