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
          headings.push({ id, text: token.text });
          return `<h2 id="${id}">${text}</h2>\n`;
        }
        return `<h${token.depth}>${text}</h${token.depth}>\n`;
      },
    },
  });

  const html = await marked.parse(markdown);
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
      };
    })
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Test Cases</title>
<style>${STYLES}</style>
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
