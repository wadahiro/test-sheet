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
import { resolve } from "path";
import { loadAllTestSuites } from "./testCases";
import { generateHtml } from "./html/generate";

interface CliArgs {
  rootDir: string;
  port: number;
  outFile: string | null;
  exclude: string[];
}

function parseArgs(argv: string[]): CliArgs {
  let rootDir = resolve(process.cwd());
  let port = 4300;
  let outFile: string | null = null;
  const exclude: string[] = [];

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
    } else if (argv[i] === "-h" || argv[i] === "--help") {
      console.log(`
Usage: bun run src/cli.ts [root directory] [options]

If the root directory is omitted, the current directory is scanned.

Options:
  --port, -p <port>      Server port (default: 4300)
  --out, -o <file>       Skip the server and write a single HTML file instead
  --exclude, -e <glob>   Skip testcases.yaml files whose path matches the glob.
                         Matched relative to the root directory; repeatable.

Examples:
  bun run src/cli.ts
  bun run src/cli.ts ./tests
  bun run src/cli.ts ./tests --out test-cases.html
  bun run src/cli.ts ./tests --exclude "**/_template/**"
`);
      process.exit(0);
    } else {
      rootDir = resolve(argv[i]);
    }
  }

  return { rootDir, port, outFile, exclude };
}

async function generateStatic(rootDir: string, outFile: string, exclude: string[]) {
  const suites = await loadAllTestSuites(rootDir, exclude);
  const html = await generateHtml(suites, { liveReload: false });
  await Bun.write(outFile, html);
  console.log(`Generated: ${outFile}`);
}

function serve(rootDir: string, port: number, exclude: string[]) {
  const sockets = new Set<import("bun").ServerWebSocket<unknown>>();

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
          const suites = await loadAllTestSuites(rootDir, exclude);
          const html = await generateHtml(suites, { liveReload: true });
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
    watch(rootDir, { recursive: true }, () => {
      for (const ws of sockets) {
        ws.send("reload");
      }
    });
  } catch (err) {
    console.error(`Warning: could not watch directory: ${rootDir}`, err);
  }

  const open = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  Bun.spawn([open, `http://localhost:${server.port}`], { stdout: "ignore", stderr: "ignore" });
}

async function main() {
  const { rootDir, port, outFile, exclude } = parseArgs(process.argv.slice(2));

  if (outFile) {
    await generateStatic(rootDir, outFile, exclude);
    return;
  }

  serve(rootDir, port, exclude);
}

main();
