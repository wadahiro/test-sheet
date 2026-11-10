#!/usr/bin/env bun
// CLI that previews all testcases.yaml files, found across a directory tree, in a browser.
//
// Usage:
//   bun run src/cli.ts [root directory] [--port <port>] [--exclude <glob>]
//   bun run src/cli.ts [root directory] --out <file>
//
// Recursively scans the root directory and renders every testcases.yaml found as a single
// page, grouped by test suite.
// Without --out, starts a local server. Saving a YAML file (or a referenced guide) triggers
// an automatic reload in any open browser tab.
// With --out <file>, skips the server and writes a single self-contained HTML file instead
// (useful as a CI artifact or for static distribution).
// Each section has a "Copy" button that copies all of its test cases as Markdown
// (handy for pasting into a PR or issue comment).

import { watch } from "fs";
import { dirname, resolve } from "path";
import { loadAllTestSuites, loadLayers } from "./testCases";
import { generateHtml } from "./html/generate";
import type { LocaleDefinition } from "./html/i18n";
import { loadLocaleFile, localeTemplate } from "./locales";
import { buildSourceIndex, testRoots } from "./testSources";
import { parseAutolinkRules, type AutolinkRule } from "./autolinks";
import { warn, warningCount } from "./warnings";

interface CliArgs {
  rootDir: string;
  port: number;
  outFile: string | null;
  exclude: string[];
  localeFiles: string[];
  autolinks: AutolinkRule[];
  tests: string[];
  layersFile?: string;
  strict: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let rootDir = resolve(process.cwd());
  let port = 4300;
  let outFile: string | null = null;
  const exclude: string[] = [];
  const localeFiles: string[] = [];
  const autolinks: AutolinkRule[] = [];
  const tests: string[] = [];
  let strict = false;
  let layersFile: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port" || argv[i] === "-p") {
      port = Number(argv[++i]);
    } else if (argv[i] === "--out" || argv[i] === "-o") {
      outFile = argv[++i];
    } else if (argv[i] === "--exclude" || argv[i] === "-e") {
      const pattern = argv[++i];
      if (!pattern) {
        console.error("Error: --exclude requires a glob pattern");
        process.exit(1);
      }
      exclude.push(pattern);
    } else if (argv[i] === "--locale") {
      const file = argv[++i];
      if (!file) {
        console.error("Error: --locale requires a JSON file");
        process.exit(1);
      }
      localeFiles.push(file);
    } else if (argv[i] === "--autolink") {
      const pattern = argv[++i];
      const url = argv[++i];
      if (!pattern || !url) {
        console.error("Error: --autolink requires a pattern and a URL template");
        process.exit(1);
      }
      autolinks.push(...parseAutolinkRules([{ pattern, url }], `--autolink "${pattern}"`));
    } else if (argv[i] === "--tests") {
      const pattern = argv[++i];
      if (!pattern) {
        console.error("Error: --tests requires a directory or glob");
        process.exit(1);
      }
      tests.push(pattern);
    } else if (argv[i] === "--layers") {
      const file = argv[++i];
      if (!file || file.startsWith("--")) throw new Error("--layers requires a YAML file");
      layersFile = resolve(file);
    } else if (argv[i] === "--strict") {
      strict = true;
    } else if (argv[i] === "--print-locale") {
      // Starting point for a translation: every key, in English, as a locale file
      process.stdout.write(localeTemplate(argv[++i] || "xx"));
      process.exit(0);
    } else if (argv[i] === "-h" || argv[i] === "--help") {
      console.log(`
Usage: bun run src/cli.ts [root directory] [options]

If the root directory is omitted, the current directory is scanned.

Options:
  --port, -p <port>      Server port (default: 4300)
  --out, -o <file>       Skip the server and write a single HTML file instead
  --exclude, -e <glob>   Skip testcases.yaml files whose path matches the glob.
                         Matched relative to the root directory; repeatable.
  --locale <file>        Add a UI language (or adjust a built-in one) from a JSON file.
                         Repeatable. English and Japanese are built in.
  --autolink <pattern> <url>
                         Link text matching the regular expression to the URL template, where
                         {0} is the match and {1}… are its capture groups. Applies to every suite,
                         after each suite's own metadata.autolinks; repeatable.
  --tests <dir|glob>     Search these files (relative to the working directory) for each automated
                         case's ID and show the test method around it in the case. Repeatable.
  --layers <file>        Declare project layers in a YAML mapping; suite declarations override fields.
  --strict               With --out: write the file, then exit with status 1 if anything was warned
                         about (a suite that failed to load, automation that disagrees with the test
                         code, a semi case without automation_note, a missing guide, ...), for CI
  --print-locale [code]  Print a locale file with every UI string in English, to translate

Examples:
  bun run src/cli.ts
  bun run src/cli.ts ./tests
  bun run src/cli.ts ./tests --out test-cases.html
  bun run src/cli.ts ./tests --exclude "**/_template/**"
  bun run src/cli.ts ./tests --tests ../app/src/test --out test-cases.html --strict
`);
      process.exit(0);
    } else {
      rootDir = resolve(argv[i]);
    }
  }

  if (strict && !outFile) {
    console.error("Error: --strict needs --out (the server keeps running whatever it warns about)");
    process.exit(1);
  }

  return { rootDir, port, outFile, exclude, localeFiles, autolinks, tests, strict, layersFile };
}

async function loadLocales(files: string[]): Promise<LocaleDefinition[]> {
  const locales: LocaleDefinition[] = [];
  for (const file of files) {
    const { locale, unknownKeys } = await loadLocaleFile(file);
    if (unknownKeys.length > 0) warn(`${file}: ignoring unknown keys: ${unknownKeys.join(", ")}`);
    locales.push(locale);
  }
  return locales;
}

interface RenderConfig {
  rootDir: string;
  exclude: string[];
  locales: LocaleDefinition[];
  autolinks: AutolinkRule[];
  tests: string[];
  layersFile?: string;
}

/** Test code is searched afresh on every render, so a saved test file shows up on the next reload */
async function render(config: RenderConfig, liveReload: boolean): Promise<{ html: string }> {
  const suites = await loadAllTestSuites(config.rootDir, config.exclude, config.layersFile ? loadLayers(config.layersFile) : undefined);
  const ids = suites.flatMap((suite) => suite.testCases.map((tc) => tc._tcId ?? "")).filter(Boolean);
  const sources = config.tests.length > 0 ? await buildSourceIndex(config.tests, ids) : undefined;
  const html = await generateHtml(suites, { liveReload, locales: config.locales, autolinks: config.autolinks, sources });
  return { html };
}

/** The file is written even when strict fails, since it shows the cases the warnings are about */
async function generateStatic(config: RenderConfig, outFile: string, strict: boolean) {
  const { html } = await render(config, false);
  await Bun.write(outFile, html);
  console.log(`Generated: ${outFile}`);
  const warnings = warningCount();
  if (strict && warnings > 0) {
    console.error(`Error: ${warnings} warning(s) with --strict`);
    process.exit(1);
  }
}

function serve(config: RenderConfig, port: number) {
  const { rootDir, exclude } = config;
  const sockets = new Set<import("bun").ServerWebSocket<unknown>>();

  const notify = () => {
    for (const ws of sockets) ws.send("reload");
  };

  const server = Bun.serve({
    port,
    async fetch(req, server) {
      const url = new URL(req.url);

      if (url.pathname === "/ws") {
        if (server.upgrade(req)) {
          return undefined as unknown as Response;
        }
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      if (url.pathname === "/" || url.pathname === "/index.html") {
        try {
          const { html } = await render(config, true);
          return new Response(html, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(`<pre>Failed to load: \n${message}</pre>`, {
            status: 500,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      }

      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      open(ws) {
        sockets.add(ws);
      },
      close(ws) {
        sockets.delete(ws);
      },
      message() {
        // Client messages are not used.
      },
    },
  });

  console.log(`test-sheet serving: ${rootDir}`);
  if (exclude.length > 0) {
    console.log(`  excluding: ${exclude.join(", ")}`);
  }
  console.log(`  http://localhost:${server.port}`);

  // Recursively watch the root directory and notify the browser to reload on any change.
  // Watching the whole directory tree (rather than individual files) means new
  // testcases.yaml files and guide changes are picked up automatically.
  try {
    watch(rootDir, { recursive: true }, notify);
  } catch (err) {
    console.error(`Warning: could not watch directory: ${rootDir}`, err);
  }
  // The test code lies outside the scan root, so its directories are watched on their own
  for (const dir of testRoots(config.tests)) {
    try {
      watch(dir, { recursive: true }, notify);
    } catch (err) {
      console.error(`Warning: could not watch directory: ${dir}`, err);
    }
  }

  if (config.layersFile) {
    try {
      watch(dirname(config.layersFile), (_event, filename) => {
        if (!filename || resolve(dirname(config.layersFile!), String(filename)) === config.layersFile) notify();
      });
    } catch (err) {
      console.error(`Warning: could not watch layers file: ${config.layersFile}`, err);
    }
  }

  const open = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  Bun.spawn([open, `http://localhost:${server.port}`], { stdout: "ignore", stderr: "ignore" });
}

async function main() {
  const { rootDir, port, outFile, exclude, localeFiles, autolinks, tests, strict, layersFile } = parseArgs(process.argv.slice(2));
  const config: RenderConfig = { rootDir, exclude, locales: await loadLocales(localeFiles), autolinks, tests, layersFile };

  if (outFile) {
    await generateStatic(config, outFile, strict);
    return;
  }

  serve(config, port);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
