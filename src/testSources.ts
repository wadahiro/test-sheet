// Finds the automated test code behind a test case: the files named by `--tests` are searched for the
// case's ID, and the test method around each hit is cut out so the page can show it.

import { readFileSync, statSync } from "fs";
import { isAbsolute, relative, resolve } from "path";

export interface SourceSnippet {
  /** Path as shown to the reader: relative to the working directory unless the file lies outside it */
  file: string;
  startLine: number;
  endLine: number;
  code: string;
  /** The method was longer than `MAX_SNIPPET_LINES`, so only its start is kept */
  truncated: boolean;
}

interface SourceFile {
  path: string;
  text: string;
}

export interface SourceIndex {
  snippetsFor(id: string): SourceSnippet[];
}

const MAX_FILE_BYTES = 1_000_000;
const MAX_SNIPPET_LINES = 80;
/** Lines kept around a hit that no method could be found for (a language without braces, an ID in a loose comment) */
const WINDOW_LINES = 12;
/** How far below an ID its method's opening brace may sit (annotations, a long signature) */
const HEADER_LOOKAHEAD_LINES = 8;
const IGNORED_DIRECTORIES = ["node_modules", ".git", "build", "dist", "target", "out"];

const GLOB_CHARS = /[*?[\]{}!]/;

/** The directory a pattern starts from and the glob below it; a plain directory means everything under it */
function splitPattern(pattern: string): { base: string; glob: string } {
  const absolute = resolve(pattern);
  try {
    if (!GLOB_CHARS.test(pattern) && statSync(absolute).isDirectory()) return { base: absolute, glob: "**/*" };
  } catch {
    // Not on disk: treated as a glob below, which then matches nothing
  }
  const segments = pattern.split("/");
  const firstGlob = segments.findIndex((segment) => GLOB_CHARS.test(segment));
  if (firstGlob === -1) return { base: resolve(segments.slice(0, -1).join("/") || "."), glob: segments[segments.length - 1] };
  return { base: resolve(segments.slice(0, firstGlob).join("/") || "."), glob: segments.slice(firstGlob).join("/") };
}

/** The directories the patterns start from, for watching them */
export const testRoots = (patterns: string[]): string[] => [...new Set(patterns.map((pattern) => splitPattern(pattern).base))];

async function readSourceFiles(patterns: string[]): Promise<{ files: SourceFile[] }> {
  const files = new Map<string, SourceFile>();
  for (const pattern of patterns) {
    const { base, glob } = splitPattern(pattern);
    for await (const path of new Bun.Glob(glob).scan({ cwd: base, absolute: true, onlyFiles: true })) {
      if (files.has(path)) continue;
      if (path.split("/").some((segment) => IGNORED_DIRECTORIES.includes(segment))) continue;
      try {
        if (statSync(path).size > MAX_FILE_BYTES) continue;
        const text = readFileSync(path, "utf8");
        // A NUL byte means a binary file, which has no method to show
        if (text.includes("\u0000")) continue;
        files.set(path, { path, text });
      } catch {
        // Unreadable files are as good as absent
      }
    }
  }
  return { files: [...files.values()] };
}

interface BracePair {
  open: number;
  close: number;
}

/**
 * Every `{ }` pair outside strings and comments. Strings are skipped whole, so a Kotlin template such as
 * "${x}" does not count; a nested quote inside a template is rare enough not to be worth parsing.
 */
function bracePairs(text: string): BracePair[] {
  const pairs: BracePair[] = [];
  const stack: number[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
    } else if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
    } else if (ch === '"' && text.startsWith('"""', i)) {
      const end = text.indexOf('"""', i + 3);
      i = end === -1 ? text.length : end + 3;
    } else if (ch === '"' || ch === "`") {
      // A backtick name (Kotlin) ends on its line; a double-quoted string may not span lines either
      let j = i + 1;
      while (j < text.length && text[j] !== ch && !(ch === '"' && text[j] === "\n")) j += text[j] === "\\" ? 2 : 1;
      i = j + 1;
    } else if (ch === "'") {
      // A character literal is short; anything longer is an apostrophe (a lifetime, a comment word), not a string
      const close = text.indexOf("'", i + 1);
      i = close !== -1 && close - i <= 4 && !text.slice(i, close).includes("\n") ? close + 1 : i + 1;
    } else if (ch === "{") {
      stack.push(i);
      i++;
    } else if (ch === "}") {
      const open = stack.pop();
      if (open !== undefined) pairs.push({ open, close: i });
      i++;
    } else {
      i++;
    }
  }
  return pairs.sort((a, b) => a.open - b.open);
}

const depthAt = (pairs: BracePair[], position: number): number => pairs.filter((pair) => pair.open < position && position < pair.close).length;

/** Line numbers (0-based) of every line start, for turning an offset into a line */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineOf(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

const isAnnotationOrComment = (line: string): boolean => /^\s*(@|\/\/|\/\*|\*)/.test(line);

/**
 * The line range of the test method an ID at `offset` belongs to. The ID is expected in what introduces
 * the method (an annotation, its name, a test-name string), so the method is the first brace block that
 * opens below it at the same depth. Anything else gets a window around the hit.
 */
function methodRange(lines: string[], starts: number[], pairs: BracePair[], offset: number): { start: number; end: number } {
  const hitLine = lineOf(starts, offset);
  const depth = depthAt(pairs, offset);
  const lastLookaheadLine = Math.min(lines.length - 1, hitLine + HEADER_LOOKAHEAD_LINES);
  const block = pairs.find((pair) => {
    if (pair.open < offset || lineOf(starts, pair.open) > lastLookaheadLine) return false;
    if (depthAt(pairs, pair.open) !== depth) return false;
    // A statement ending before the brace means the ID belongs to something that has no body here
    return !/;\s*$/m.test(lines.slice(hitLine, lineOf(starts, pair.open)).join("\n"));
  });

  if (!block) return { start: Math.max(0, hitLine - WINDOW_LINES), end: Math.min(lines.length - 1, hitLine + WINDOW_LINES) };

  let start = hitLine;
  while (start > 0 && isAnnotationOrComment(lines[start - 1])) start--;
  // The ID's own line may be the annotation, whose siblings above are already taken; the signature below is covered by the block
  return { start, end: lineOf(starts, block.close) };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const displayPath = (path: string): string => {
  const rel = relative(process.cwd(), path);
  return rel.startsWith("..") || isAbsolute(rel) ? path : rel;
};

function snippetsInFile(file: SourceFile, ids: Set<string>, pattern: RegExp, into: Map<string, SourceSnippet[]>): void {
  const lines = file.text.split("\n");
  const starts = lineStarts(file.text);
  let pairs: BracePair[] | null = null;
  const taken = new Map<string, { start: number; end: number }[]>();

  for (const match of file.text.matchAll(pattern)) {
    const id = match[1];
    if (!ids.has(id)) continue;
    pairs ??= bracePairs(file.text);
    const range = methodRange(lines, starts, pairs, match.index!);
    // Two hits in one method (annotation and name) are one snippet
    const seen = taken.get(id) ?? [];
    if (seen.some((other) => range.start >= other.start && range.end <= other.end)) continue;
    seen.push(range);
    taken.set(id, seen);

    const truncated = range.end - range.start + 1 > MAX_SNIPPET_LINES;
    const end = truncated ? range.start + MAX_SNIPPET_LINES - 1 : range.end;
    const snippet: SourceSnippet = {
      file: displayPath(file.path),
      startLine: range.start + 1,
      endLine: end + 1,
      code: lines.slice(range.start, end + 1).join("\n"),
      truncated,
    };
    into.set(id, [...(into.get(id) ?? []), snippet]);
  }
}

/** Reads the files the patterns name and finds, for each ID, the test code that mentions it */
export async function buildSourceIndex(patterns: string[], ids: string[]): Promise<SourceIndex> {
  const { files } = await readSourceFiles(patterns);
  const found = new Map<string, SourceSnippet[]>();
  if (ids.length > 0) {
    // Longest first, so LOGIN-0020 is not read as LOGIN-002; the lookarounds keep an ID from matching inside a longer one
    const alternatives = [...ids].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
    const pattern = new RegExp(`(?<![\\w-])(${alternatives})(?![\\w-])`, "g");
    const idSet = new Set(ids);
    for (const file of files) snippetsInFile(file, idSet, pattern, found);
  }
  return { snippetsFor: (id) => found.get(id) ?? [] };
}
