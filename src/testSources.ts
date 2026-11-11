// Finds the automated test code behind a test case: the files named by `--tests` are searched for the
// case's ID, and the test method around each hit is cut out so the page can show it.

import { readFileSync, statSync } from "fs";
import { isAbsolute, posix, relative, resolve } from "path";

export interface SourceSnippet {
  /** Path as shown to the reader: relative to the directory `--tests` named, so a deep checkout does not put its own location in front */
  file: string;
  /**
   * `file` under the directory as `--tests` wrote it, for a tooltip saying which file it is. Never absolute
   * (an absolute `--tests` adds nothing to `file`): the page is handed around, and an absolute path would
   * show the user's home and differ from machine to machine.
   */
  path: string;
  startLine: number;
  endLine: number;
  code: string;
  /** The method was longer than `MAX_SNIPPET_LINES`, so only its start is kept */
  truncated: boolean;
  containers?: string[];
  definitions?: SourceDefinition[];
}

export interface SourceDefinition {
  kind: "type" | "data";
  name: string;
  file: string;
  path: string;
  startLine: number;
  endLine: number;
  code: string;
  truncated: boolean;
}

interface SourceFile {
  path: string;
  /** The directory the pattern that found the file starts from */
  base: string;
  /** That directory as the pattern wrote it, or "" when it was absolute */
  shownBase: string;
  text: string;
}

export interface SourceIndex {
  snippetsFor(id: string): SourceSnippet[];
  /**
   * Whether a test of this name is in the code that was read: `method`, `Class.method` or `Class#method`
   * (the class is then in the same file), or a Kotest name with spaces as written. Names, not resolution:
   * a renamed test is noticed, a same-named method somewhere else is not told apart.
   */
  hasTest(name: string): boolean;
  /** A file's whole text by the `path` a snippet carries, for the page to show it in full */
  fileText(path: string): string | undefined;
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
function splitPattern(pattern: string): { base: string; written: string; glob: string } {
  const at = (written: string, glob: string) => ({ base: resolve(written), written, glob });
  try {
    if (!GLOB_CHARS.test(pattern) && statSync(resolve(pattern)).isDirectory()) return at(pattern.replace(/\/+$/, "") || "/", "**/*");
  } catch {
    // Not on disk: treated as a glob below, which then matches nothing
  }
  const segments = pattern.split("/");
  const firstGlob = segments.findIndex((segment) => GLOB_CHARS.test(segment));
  if (firstGlob === -1) return at(segments.slice(0, -1).join("/") || ".", segments[segments.length - 1]);
  return at(segments.slice(0, firstGlob).join("/") || ".", segments.slice(firstGlob).join("/"));
}

/** The directories the patterns start from, for watching them */
export const testRoots = (patterns: string[]): string[] => [...new Set(patterns.map((pattern) => splitPattern(pattern).base))];

async function readSourceFiles(patterns: string[]): Promise<{ files: SourceFile[] }> {
  const files = new Map<string, SourceFile>();
  for (const pattern of patterns) {
    const { base, written, glob } = splitPattern(pattern);
    const shownBase = isAbsolute(written) ? "" : written;
    for await (const path of new Bun.Glob(glob).scan({ cwd: base, absolute: true, onlyFiles: true })) {
      if (files.has(path)) continue;
      if (path.split("/").some((segment) => IGNORED_DIRECTORIES.includes(segment))) continue;
      try {
        if (statSync(path).size > MAX_FILE_BYTES) continue;
        const text = readFileSync(path, "utf8");
        // A NUL byte means a binary file, which has no method to show
        if (text.includes("\u0000")) continue;
        files.set(path, { path, base, shownBase, text });
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

/** The blocks in the file that lines naming `name` open: `name.forEach {`, `for (c in name) {`, `withData(name) {` */
function loopsOver(shape: FileShape, text: string, name: string, declaration: BracketPair): BracketPair[] {
  const blocks = new Map<number, BracketPair>();
  const declarationLine = lineOf(shape.starts, declaration.open);
  for (const match of text.matchAll(new RegExp(`(?<![\\w.])${escapeRegExp(name)}(?!\\w)`, "g"))) {
    const at = match.index!;
    const line = lineOf(shape.starts, at);
    if (line === declarationLine || contains(declaration, at)) continue;
    // `val byId = CASES.associateBy { … }` derives more data rather than running the cases
    // An assignment inside call arguments (ts = ROWS) names an argument, not derived data.
    if (declaredName(text.slice(shape.starts[line], at)) && argDepthAt(shape, at) === argDepthAt(shape, shape.starts[line])) continue;
    // Inline lambdas in filter/sortedBy belong to the loop expression, not its body.
    const block = shape.braces.filter((pair) => pair.open > at && lineOf(shape.starts, pair.open) === line && lineOf(shape.starts, pair.close) > line).at(-1);
    if (block) blocks.set(block.open, block);
  }
  return [...blocks.values()];
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
  const loops = loopsOver(shape, text, name, data);
  if (loops.length === 0) return window;
  const ranges = loops.map((loop) => withLeadIn(lines, { start: lineOf(starts, loop.open), end: lineOf(starts, loop.close) }));
  if (ranges.length === 1) {
    const loopRange = ranges[0];
    return loopRange.start > dataEnd && onlyBlankBetween(lines, dataEnd, loopRange.start) ? joined(loopRange) : [row, loopRange];
  }
  // The predicates are arbitrary code, so every consumer is shown rather than guessing which runs a row.
  return [row, ...ranges];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fileShape(text: string): FileShape {
  const all = bracketPairs(text);
  return { lines: text.split("\n"), starts: lineStarts(text), all, braces: all.filter((pair) => pair.kind === "{") };
}

function definition(file: SourceFile, shape: FileShape, kind: SourceDefinition["kind"], name: string, range: LineRange): SourceDefinition {
  const end = Math.min(range.end, range.start + MAX_SNIPPET_LINES - 1);
  const shown = relative(file.base, file.path).replaceAll("\\", "/");
  return { kind, name, file: shown, path: posix.join(file.shownBase, shown), startLine: range.start + 1, endLine: end + 1, code: shape.lines.slice(range.start, end + 1).join("\n"), truncated: end < range.end };
}

function dataDefinitions(file: SourceFile, shape: FileShape, offset: number, files: SourceFile[], shapes: Map<SourceFile, FileShape>): SourceDefinition[] {
  const data = enclosingData(shape, offset);
  if (!data) return [];
  const result: SourceDefinition[] = [];
  const declarationLine = lineOf(shape.starts, data.open);
  const variable = declaredName(file.text.slice(shape.starts[declarationLine], data.open));
  if (variable) result.push(definition(file, shape, "data", variable, withLeadIn(shape.lines, { start: declarationLine, end: declarationLine })));
  const row = shape.all.filter((pair) => pair.kind === "(" && contains(pair, offset)).reverse().find((pair) => {
    return /\b[A-Z][\w]*\s*$/.test(file.text.slice(shape.starts[lineOf(shape.starts, pair.open)], pair.open));
  });
  if (!row) return result;
  const typeName = file.text.slice(shape.starts[lineOf(shape.starts, row.open)], row.open).match(/\b([A-Z][\w]*)\s*$/)?.[1];
  if (!typeName) return result;
  for (const candidate of [file, ...files.filter((other) => other !== file)]) {
    let candidateShape = shapes.get(candidate);
    if (!candidateShape) { candidateShape = fileShape(candidate.text); shapes.set(candidate, candidateShape); }
    const pattern = new RegExp(`\\b(?:class|record)\\s+${escapeRegExp(typeName)}\\s*(?:<[^>]+>\\s*)?\\(`, "g");
    for (const match of candidate.text.matchAll(pattern)) {
      const open = match.index! + match[0].length - 1;
      const parameters = candidateShape.all.find((pair) => pair.open === open && pair.kind === "(");
      if (!parameters) continue;
      const line = lineOf(candidateShape.starts, match.index!);
      const header = candidateShape.lines[line].slice(0, match.index! - candidateShape.starts[line]);
      if (!/^\s*(?:(?:private|public|protected|internal|data|static|final|sealed|open|abstract)\s+)*$/.test(header)) continue;
      result.push(definition(candidate, candidateShape, "type", typeName, withLeadIn(candidateShape.lines, { start: line, end: lineOf(candidateShape.starts, parameters.close) })));
      return result;
    }
  }
  return result;
}

function snippetsInFile(file: SourceFile, ids: Set<string>, pattern: RegExp, into: Map<string, SourceSnippet[]>, files: SourceFile[], shapes: Map<SourceFile, FileShape>): void {
  let shape: FileShape | null = null;
  const taken = new Map<string, LineRange[]>();

  for (const match of file.text.matchAll(pattern)) {
    const id = match[1];
    if (!ids.has(id)) continue;
    if (!shape) {
      shape = shapes.get(file) ?? fileShape(file.text);
      shapes.set(file, shape);
    }
    const definitions = dataDefinitions(file, shape, match.index!, files, shapes);
    for (const range of snippetRanges(shape, file.text, match.index!)) {
      // Two hits in one method (annotation and name) are one snippet
      const seen = taken.get(id) ?? [];
      if (seen.some((other) => range.start >= other.start && range.end <= other.end)) continue;
      seen.push(range);
      taken.set(id, seen);

      const truncated = range.end - range.start + 1 > MAX_SNIPPET_LINES;
      const end = truncated ? range.start + MAX_SNIPPET_LINES - 1 : range.end;
      const shown = relative(file.base, file.path).replaceAll("\\", "/");
      const snippet: SourceSnippet = {
        definitions,
        containers: shape.braces.filter((pair) => contains(pair, shape!.starts[range.start])).flatMap((pair) => {
          const line = lineOf(shape!.starts, pair.open);
          const header = shape!.lines[line].slice(0, pair.open - shape!.starts[line]);
          const kotest = header.match(/^\s*"((?:\\.|[^"\\])*)"\s*-\s*$/) ?? header.match(/^\s*(?:context|describe|given|when|and)\s*\(\s*"((?:\\.|[^"\\])*)"\s*\)\s*$/);
          if (kotest) return [kotest[1]];
          const dynamic = header.match(/^\s*((?:withContexts|withData)(?:<[^>]+>)?\s*\(.*\))\s*$/);
          if (dynamic) return [dynamic[1]];
          if (!/\bclass\s+\w+/.test(header)) return [];
          const lead = withLeadIn(shape!.lines, { start: line, end: line });
          const annotations = shape!.lines.slice(lead.start, line + 1).join("\n");
          if (!/@Nested\b/.test(annotations)) return [];
          const display = annotations.match(/@DisplayName\s*\(\s*"((?:\\.|[^"\\])*)"\s*\)/);
          return display ? [display[1]] : [];
        }),
        file: shown,
        path: posix.join(file.shownBase, shown),
        startLine: range.start + 1,
        endLine: end + 1,
        code: shape.lines.slice(range.start, end + 1).join("\n"),
        truncated,
      };
      into.set(id, [...(into.get(id) ?? []), snippet]);
    }
  }
}

function mentionsTest(files: SourceFile[], name: string): boolean {
  const word = (text: string) => new RegExp(`(?<!\\w)${escapeRegExp(text)}(?!\\w)`);
  if (/\s/.test(name)) return files.some((file) => file.text.includes(name));
  const parts = name.split(/[.#]/).filter(Boolean);
  const method = parts.at(-1);
  if (!method) return false;
  const owner = parts.length > 1 ? parts[parts.length - 2] : undefined;
  return files.some((file) => word(method).test(file.text) && (owner === undefined || word(owner).test(file.text)));
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
    const shapes = new Map<SourceFile, FileShape>();
    for (const file of files) snippetsInFile(file, idSet, pattern, found, files, shapes);
    for (const snippets of found.values()) {
      const seen = new Set<string>();
      for (const snippet of snippets) snippet.definitions = snippet.definitions?.filter((item) => {
        const key = `${item.path}:${item.startLine}:${item.kind}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
  }
  const byPath = new Map(files.map((file) => [posix.join(file.shownBase, relative(file.base, file.path).replaceAll("\\", "/")), file.text]));
  return { snippetsFor: (id) => found.get(id) ?? [], hasTest: (name) => mentionsTest(files, name), fileText: (path) => byPath.get(path) };
}
