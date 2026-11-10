// Finds the automated test code behind a test case: the files named by `--tests` are searched for the
// case's ID, and the test method around each hit is cut out so the page can show it.

import { readFileSync, statSync } from "fs";
import { relative, resolve } from "path";

export interface SourceSnippet {
  /** Path as shown to the reader: relative to the directory `--tests` named, so a deep checkout does not put its own location in front */
  file: string;
  /** Where the file really is, for a tooltip */
  path: string;
  startLine: number;
  endLine: number;
  code: string;
  /** The method was longer than `MAX_SNIPPET_LINES`, so only its start is kept */
  truncated: boolean;
}

interface SourceFile {
  path: string;
  /** The directory the pattern that found the file starts from */
  base: string;
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
        files.set(path, { path, base, text });
      } catch {
        // Unreadable files are as good as absent
      }
    }
  }
  return { files: [...files.values()] };
}

interface BracketPair {
  open: number;
  close: number;
  /** `{` for a block, `(` or `[` for an argument list, an annotation's arguments or a literal */
  kind: "{" | "(" | "[";
}

const CLOSERS: Record<string, BracketPair["kind"]> = { "}": "{", ")": "(", "]": "[" };

/**
 * Every bracket pair outside strings and comments. Strings are skipped whole, so a Kotlin template such
 * as "${x}" does not count; a nested quote inside a template is rare enough not to be worth parsing.
 */
function bracketPairs(text: string): BracketPair[] {
  const pairs: BracketPair[] = [];
  const stack: { at: number; kind: BracketPair["kind"] }[] = [];
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
    } else if (ch === "{" || ch === "(" || ch === "[") {
      stack.push({ at: i, kind: ch });
      i++;
    } else if (ch in CLOSERS) {
      // A stray closer of the wrong kind is ignored rather than allowed to unbalance everything after it
      if (stack.length > 0 && stack[stack.length - 1].kind === CLOSERS[ch]) {
        const { at, kind } = stack.pop()!;
        pairs.push({ open: at, close: i, kind });
      }
      i++;
    } else {
      i++;
    }
  }
  return pairs.sort((a, b) => a.open - b.open);
}

interface FileShape {
  lines: string[];
  starts: number[];
  braces: BracketPair[];
  /** Pairs of every kind, innermost last for any position */
  all: BracketPair[];
}

const contains = (pair: BracketPair, position: number): boolean => pair.open < position && position < pair.close;
const braceDepthAt = (shape: FileShape, position: number): number => shape.braces.filter((pair) => contains(pair, position)).length;
const argDepthAt = (shape: FileShape, position: number): number => shape.all.filter((pair) => pair.kind !== "{" && contains(pair, position)).length;

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

/** `@Test` (Java, Kotlin), `[Fact]` (C#) */
const isAnnotation = (line: string): boolean => /^\s*(@|\[\w)/.test(line);
const isAnnotationOrComment = (line: string): boolean => isAnnotation(line) || /^\s*(\/\/|\/\*|\*)/.test(line);

interface LineRange {
  start: number;
  end: number;
}

/** Extends a range up over the annotations and comments that introduce it */
function withLeadIn(lines: string[], range: LineRange): LineRange {
  let start = range.start;
  while (start > 0 && isAnnotationOrComment(lines[start - 1])) start--;
  return { start, end: range.end };
}

/**
 * The body a header at `offset` introduces: the first block that opens below it, within a few lines, at
 * the same depth. A block inside an argument list (a `FunSpec({ … })` lambda, an annotation's `{ … }`
 * array) belongs to that call rather than to the header, so it does not count.
 */
function bodyBelow(shape: FileShape, offset: number): BracketPair | undefined {
  const { lines, starts } = shape;
  const hitLine = lineOf(starts, offset);
  const depth = braceDepthAt(shape, offset);
  const argDepth = argDepthAt(shape, offset);
  const lastLookaheadLine = Math.min(lines.length - 1, hitLine + HEADER_LOOKAHEAD_LINES);
  return shape.braces.find((pair) => {
    if (pair.open < offset || lineOf(starts, pair.open) > lastLookaheadLine) return false;
    if (braceDepthAt(shape, pair.open) !== depth || argDepthAt(shape, pair.open) !== argDepth) return false;
    // A statement ending before the brace means the ID belongs to something that has no body here
    return !/;\s*$/m.test(lines.slice(hitLine, lineOf(starts, pair.open)).join("\n"));
  });
}

/**
 * The outermost argument list or literal the ID sits in, when it is data (`listOf(Case("ID", …))`,
 * `withData(…)`, `@CsvSource({ "ID, …" })`) rather than the name of a test. An annotation's `{ }` array
 * is looked through; any other block is code, and the search stops there.
 */
function enclosingData(shape: FileShape, offset: number): BracketPair | undefined {
  const enclosing = shape.all.filter((pair) => contains(pair, offset)).reverse();
  let outer: BracketPair | undefined;
  for (const pair of enclosing) {
    if (pair.kind !== "{") outer = pair;
    else if (!isAnnotation(shape.lines[lineOf(shape.starts, pair.open)])) break;
  }
  return outer;
}

/** `name` in `val name = listOf(`, `private static final List<Case> name = List.of(`, `name = [` */
function declaredName(lineBefore: string): string | undefined {
  return lineBefore.match(/(\w+)\s*(?::[^=]*)?=\s*[\w.<>]*\s*$/)?.[1];
}

/** The first block in the file that a line naming `name` opens: `name.forEach {`, `for (c in name) {`, `withData(name) {` */
function loopOver(shape: FileShape, text: string, name: string, declaration: BracketPair): BracketPair | undefined {
  const declarationLine = lineOf(shape.starts, declaration.open);
  for (const match of text.matchAll(new RegExp(`(?<![\\w.])${escapeRegExp(name)}(?!\\w)`, "g"))) {
    const at = match.index!;
    const line = lineOf(shape.starts, at);
    if (line === declarationLine || contains(declaration, at)) continue;
    // `val byId = CASES.associateBy { … }` derives more data rather than running the cases
    if (declaredName(text.slice(shape.starts[line], at))) continue;
    const block = shape.braces.find((pair) => pair.open > at && lineOf(shape.starts, pair.open) === line);
    if (block) return block;
  }
  return undefined;
}

const onlyBlankBetween = (lines: string[], from: number, to: number): boolean => lines.slice(from + 1, to).every((line) => line.trim() === "");

/**
 * The line ranges to show for an ID at `offset`. An ID in what introduces a test (an annotation, its name,
 * a test-name string) gets that test's body. An ID in data gets its row and the test the data feeds: the
 * block right after the call (`withData(…) { }`, an annotated method), or, for data held in a variable,
 * the block that loops over it in the same file. Anything else gets a window around the hit.
 */
function snippetRanges(shape: FileShape, text: string, offset: number): LineRange[] {
  const { lines, starts } = shape;
  const hitLine = lineOf(starts, offset);
  const window = [{ start: Math.max(0, hitLine - WINDOW_LINES), end: Math.min(lines.length - 1, hitLine + WINDOW_LINES) }];

  const data = enclosingData(shape, offset);
  if (!data) {
    const body = bodyBelow(shape, offset);
    return body ? [withLeadIn(lines, { start: hitLine, end: lineOf(starts, body.close) })] : window;
  }

  const dataStart = lineOf(starts, data.open);
  const dataEnd = lineOf(starts, data.close);
  const head = withLeadIn(lines, { start: dataStart, end: dataEnd });
  // The row is the item of the data that holds the ID, so a long list is not shown whole
  const item = shape.all.filter((pair) => contains(pair, offset) && contains(data, pair.open)).shift();
  const row = item ? { start: lineOf(starts, item.open), end: lineOf(starts, item.close) } : { start: hitLine, end: hitLine };
  const joined = (body: LineRange): LineRange[] => {
    if (body.end - head.start + 1 <= MAX_SNIPPET_LINES) return [{ start: head.start, end: body.end }];
    return row.start >= body.start && row.end <= body.end ? [body] : [row, body];
  };

  // A block right after the closing parenthesis is the call's trailing lambda: the test the data feeds
  const trailing = shape.braces.find((pair) => pair.open > data.close);
  if (trailing && /^[ \t]*\n?[ \t]*$/.test(text.slice(data.close + 1, trailing.open))) {
    return joined({ start: lineOf(starts, data.close), end: lineOf(starts, trailing.close) });
  }

  if (isAnnotation(lines[dataStart])) {
    const body = bodyBelow(shape, data.close + 1);
    return body ? joined({ start: dataEnd + 1, end: lineOf(starts, body.close) }) : window;
  }

  const name = declaredName(text.slice(starts[dataStart], data.open));
  if (!name) {
    // A call nobody keeps is the test itself: `it("ID", () => { })`, `t.Run("ID", func…{ })`, `test("ID").config(…) { }`
    const inside = bodyBelow(shape, offset);
    if (inside) return [withLeadIn(lines, { start: hitLine, end: lineOf(starts, inside.close) })];
    const after = bodyBelow(shape, data.close + 1);
    return after ? joined({ start: dataEnd, end: lineOf(starts, after.close) }) : window;
  }
  const loop = loopOver(shape, text, name, data);
  if (!loop) return window;
  const loopRange = withLeadIn(lines, { start: lineOf(starts, loop.open), end: lineOf(starts, loop.close) });
  return loopRange.start > dataEnd && onlyBlankBetween(lines, dataEnd, loopRange.start) ? joined(loopRange) : [row, loopRange];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function snippetsInFile(file: SourceFile, ids: Set<string>, pattern: RegExp, into: Map<string, SourceSnippet[]>): void {
  let shape: FileShape | null = null;
  const taken = new Map<string, LineRange[]>();

  for (const match of file.text.matchAll(pattern)) {
    const id = match[1];
    if (!ids.has(id)) continue;
    if (!shape) {
      const all = bracketPairs(file.text);
      shape = { lines: file.text.split("\n"), starts: lineStarts(file.text), all, braces: all.filter((pair) => pair.kind === "{") };
    }
    for (const range of snippetRanges(shape, file.text, match.index!)) {
      // Two hits in one method (annotation and name) are one snippet
      const seen = taken.get(id) ?? [];
      if (seen.some((other) => range.start >= other.start && range.end <= other.end)) continue;
      seen.push(range);
      taken.set(id, seen);

      const truncated = range.end - range.start + 1 > MAX_SNIPPET_LINES;
      const end = truncated ? range.start + MAX_SNIPPET_LINES - 1 : range.end;
      const snippet: SourceSnippet = {
        file: relative(file.base, file.path),
        path: file.path,
        startLine: range.start + 1,
        endLine: end + 1,
        code: shape.lines.slice(range.start, end + 1).join("\n"),
        truncated,
      };
      into.set(id, [...(into.get(id) ?? []), snippet]);
    }
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
