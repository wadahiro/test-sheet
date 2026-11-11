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
  containers?: SourceContainer[];
  /** What the test checks, as its own name says it (its @DisplayName or Kotest name, without the case ID); absent when the name cannot be read */
  title?: string;
}

/** What a test sits inside, outermost first: a named container, or a call that makes one container per element of some data */
export type SourceContainer =
  | { name: string }
  | {
      /** The call as written, which is all there is to show when nothing below could be worked out */
      call: string;
      /** The variable the call goes over (`PLANS`) */
      each?: string;
      /** How an element is named, when that is a reference such as `Plan::name`; a lambda is not shown */
      by?: string;
      /** Those names, when every element is a constructor call that writes the name as a string literal */
      names?: string[];
    };

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
  /**
   * What the page needs to let a reader follow names out of the given files (by the `path` a snippet
   * carries): those files, every file that declares a name they use, and so on, with where each name is
   * declared. Files nothing links to are left out, so the page does not grow with the whole test tree.
   */
  reachable(paths: string[]): { files: Record<string, string>; symbols: Record<string, SourceSymbol[]> };
}

/** Where a name is declared: the lines (1-based, inclusive) to show, from its annotations or comment to the end of its body */
export interface SourceSymbol {
  path: string;
  start: number;
  end: number;
  /** The line the name itself is on, so the declaration is not linked to itself */
  line: number;
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

function shapeOf(file: SourceFile, shapes: Map<SourceFile, FileShape>): FileShape {
  let shape = shapes.get(file);
  if (!shape) {
    shape = fileShape(file.text);
    shapes.set(file, shape);
  }
  return shape;
}

interface TypeDeclaration {
  file: SourceFile;
  shape: FileShape;
  line: number;
  parameters: BracketPair;
}

/** The `class` or `record` header that declares a row type, in this file first and then the others */
function typeDeclaration(typeName: string, file: SourceFile, files: SourceFile[], shapes: Map<SourceFile, FileShape>): TypeDeclaration | undefined {
  for (const candidate of [file, ...files.filter((other) => other !== file)]) {
    const shape = shapeOf(candidate, shapes);
    const pattern = new RegExp(`\\b(?:class|record)\\s+${escapeRegExp(typeName)}\\s*(?:<[^>]+>\\s*)?\\(`, "g");
    for (const match of candidate.text.matchAll(pattern)) {
      const open = match.index! + match[0].length - 1;
      const parameters = shape.all.find((pair) => pair.open === open && pair.kind === "(");
      if (!parameters) continue;
      const line = lineOf(shape.starts, match.index!);
      const header = shape.lines[line].slice(0, match.index! - shape.starts[line]);
      if (!/^\s*(?:(?:private|public|protected|internal|data|static|final|sealed|open|abstract)\s+)*$/.test(header)) continue;
      return { file: candidate, shape, line, parameters };
    }
  }
  return undefined;
}

interface DataDeclaration {
  name: string;
  file: SourceFile;
  shape: FileShape;
  /** The `listOf(…)` / `[…]` the variable is set to */
  literal: BracketPair;
}

/** Where a variable is declared as a list or array literal, in this file first and then the others */
function dataDeclaration(name: string, file: SourceFile, files: SourceFile[], shapes: Map<SourceFile, FileShape>): DataDeclaration | undefined {
  for (const candidate of [file, ...files.filter((other) => other !== file)]) {
    const shape = shapeOf(candidate, shapes);
    const literal = shape.all
      .filter((pair) => pair.kind !== "{" && declaredName(candidate.text.slice(shape.starts[lineOf(shape.starts, pair.open)], pair.open)) === name)
      .sort((a, b) => a.open - b.open)[0];
    if (literal) return { name, file: candidate, shape, literal };
  }
  return undefined;
}

/** Splits at the commas that are not inside brackets or a string */
function splitArguments(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      current += char;
      if (char === "\\") current += text[++i] ?? "";
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if ("([{".includes(char)) depth++;
    else if (")]}".includes(char)) depth--;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const MAX_SHOWN_NAMES = 6;
const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * The names the elements of `declaration` give to their containers, when each element is a constructor
 * call of `typeName` and the property that names it (`Plan::name`) is a string literal there. All or
 * nothing: a list with one unreadable name would mislead more than no list.
 */
function elementNames(declaration: DataDeclaration, typeName: string, property: string, files: SourceFile[], shapes: Map<SourceFile, FileShape>): string[] | undefined {
  const type = typeDeclaration(typeName, declaration.file, files, shapes);
  if (!type) return undefined;
  const parameters = splitArguments(withoutComments(type.file.text.slice(type.parameters.open + 1, type.parameters.close)));
  const index = parameters.findIndex((parameter) => parameter.match(/(\w+)\s*:/)?.[1] === property);
  if (index < 0) return undefined;
  const { file, shape, literal } = declaration;
  const elements = shape.all.filter(
    (pair) =>
      pair.kind === "(" &&
      contains(literal, pair.open) &&
      !shape.all.some((outer) => contains(outer, pair.open) && contains(literal, outer.open)) &&
      new RegExp(`\\b${escapeRegExp(typeName)}\\s*$`).test(file.text.slice(shape.starts[lineOf(shape.starts, pair.open)], pair.open))
  );
  if (elements.length === 0 || elements.length > MAX_SHOWN_NAMES) return undefined;
  const names: string[] = [];
  for (const element of elements.sort((a, b) => a.open - b.open)) {
    const given = splitArguments(withoutComments(file.text.slice(element.open + 1, element.close)));
    const value = given.find((arg) => new RegExp(`^${escapeRegExp(property)}\\s*=(?!=)`).test(arg))?.replace(/^\w+\s*=\s*/, "") ?? given.filter((arg) => !/^\w+\s*=(?!=)/.test(arg))[index];
    const literalText = value?.match(/^"((?:[^"\\$]|\\.)*)"$/)?.[1];
    if (literalText === undefined) return undefined;
    names.push(literalText);
  }
  return names;
}

/**
 * `withContexts<Plan>(Plan::name, PLANS) { plan -> … }` as what it means: a container per element of
 * PLANS, named by `Plan::name`. What its runtime names are is not known without running it, so those
 * are read from the data only when they are written there.
 */
function dynamicContainer(file: SourceFile, shape: FileShape, lambda: BracketPair, files: SourceFile[], shapes: Map<SourceFile, FileShape>): SourceContainer | undefined {
  const before = file.text.slice(0, lambda.open).trimEnd();
  if (!before.endsWith(")")) return undefined;
  const paren = shape.all.find((pair) => pair.kind === "(" && pair.close === before.length - 1);
  const head = paren ? file.text.slice(0, paren.open).match(/\b(withContexts|withData|withTests)(<[^>]*>)?\s*$/) : null;
  if (!paren || !head) return undefined;

  const args = splitArguments(file.text.slice(paren.open + 1, paren.close));
  const call = `${head[1]}${head[2] ?? ""}(${args.join(", ")})`.replace(/\s+/g, " ");
  const isNamed = (arg: string) => /^\w+\s*=(?!=)/.test(arg);
  const named = (...keys: string[]) => args.find((arg) => keys.some((key) => new RegExp(`^${key}\\s*=(?!=)`).test(arg)))?.replace(/^\w+\s*=\s*/, "");
  const positional = args.filter((arg) => !isNamed(arg));
  const namedData = named("ts", "tests", "data");
  const data = namedData ?? positional.at(-1);
  const nameFunction = named("nameFn") ?? (namedData !== undefined || positional.length > 1 ? positional[0] : undefined);

  const each = data?.match(/^([A-Za-z_]\w*)(?:\s*\.|$)/)?.[1];
  const reference = nameFunction?.match(/^([A-Za-z_]\w*)?::([A-Za-z_]\w*)$/);
  const declaration = each ? dataDeclaration(each, file, files, shapes) : undefined;
  const names = declaration && reference?.[1] ? elementNames(declaration, reference[1], reference[2], files, shapes) : undefined;
  return { call, ...(each ? { each } : {}), ...(reference ? { by: reference[0] } : {}), ...(names ? { names } : {}) };
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
    for (const range of snippetRanges(shape, file.text, match.index!)) {
      // Two hits in one method (annotation and name) are one snippet
      const seen = taken.get(id) ?? [];
      if (seen.some((other) => range.start >= other.start && range.end <= other.end)) continue;
      seen.push(range);
      taken.set(id, seen);

      const truncated = range.end - range.start + 1 > MAX_SNIPPET_LINES;
      const end = truncated ? range.start + MAX_SNIPPET_LINES - 1 : range.end;
      const shown = relative(file.base, file.path).replaceAll("\\", "/");
      const containers = shape.braces.filter((pair) => contains(pair, shape!.starts[range.start])).flatMap((pair): SourceContainer[] => {
        const line = lineOf(shape!.starts, pair.open);
        const header = shape!.lines[line].slice(0, pair.open - shape!.starts[line]);
        const kotest = header.match(/^\s*"((?:\\.|[^"\\])*)"\s*-\s*$/) ?? header.match(/^\s*(?:context|describe|given|when|and)\s*\(\s*"((?:\\.|[^"\\])*)"\s*\)\s*$/);
        if (kotest) return [{ name: kotest[1] }];
        const dynamic = dynamicContainer(file, shape!, pair, files, shapes);
        if (dynamic) return [dynamic];
        if (!/\bclass\s+\w+/.test(header)) return [];
        const lead = withLeadIn(shape!.lines, { start: line, end: line });
        const annotations = shape!.lines.slice(lead.start, line + 1).join("\n");
        if (!/@Nested\b/.test(annotations)) return [];
        const display = annotations.match(/@DisplayName\s*\(\s*"((?:\\.|[^"\\])*)"\s*\)/);
        return display ? [{ name: display[1] }] : [];
      });
      const snippet: SourceSnippet = {
        containers,
        title: testTitle(shape.lines, range, id),
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

const STRING = '"((?:\\\\.|[^"\\\\])*)"';
const NAME_FORMS = [
  new RegExp(`@DisplayName\\s*\\(\\s*${STRING}\\s*\\)`),
  new RegExp(`^\\s*(?:x?test|it|should|then)\\s*\\(\\s*${STRING}`, "m"),
  new RegExp(`^\\s*${STRING}\\s*(?:-\\s*)?\\{`, "m"),
  /\bfun\s+`([^`]+)`/,
];

/**
 * What the test is called: its @DisplayName, or the name it is declared with (a Kotest string, a backticked
 * Kotlin function). Only a name that mentions the case ID counts unless it is a @DisplayName, so a string
 * that merely sits nearby is not taken for it. A row of data has no name of its own here, so it gets none.
 */
function testTitle(lines: string[], range: LineRange, id: string): string | undefined {
  const text = lines.slice(range.start, Math.min(range.end, range.start + HEADER_LOOKAHEAD_LINES) + 1).join("\n");
  const idPattern = new RegExp(`(?<![\\w-])${escapeRegExp(id)}(?![\\w-])`);
  const named = NAME_FORMS.map((form, i) => ({ name: text.match(form)?.[1], display: i === 0 })).find((found) => found.name !== undefined && (found.display || idPattern.test(found.name)));
  if (!named?.name) return undefined;
  const title = named.name.replace(/\\(.)/g, "$1").replace(new RegExp(`^\\s*\\[?${escapeRegExp(id)}\\]?\\s*[:：,\\-–—.]?\\s*`), "").trim();
  return title === "" ? undefined : title;
}

const MAX_SYMBOL_CANDIDATES = 6;
const MIN_SYMBOL_LENGTH = 3;
const FUNCTION_HEADER = /\b(?:fun|func|function|def)\b/;
const CLASS_HEADER = /\b(?:class|object|interface|enum|record|struct|trait|companion)\b/;
const DECLARATION_START = /^\s*(?:@\w+|(?:public|private|protected|internal|static|final|abstract|open|override|data|sealed|enum|const|suspend|inline)\s|fun\s|func\s|function\s|def\s|class\s|object\s|interface\s|val\s|var\s|const\s|record\s)/;
const DECLARATIONS: { kind: "fun" | "type" | "value"; pattern: RegExp }[] = [
  { kind: "fun", pattern: /\b(?:fun|func|function|def)\s+(?:<[^>\n]*>\s*)?(?:[\w<>?,.]+\.)?(\w+)\s*\(/gd },
  { kind: "fun", pattern: /^[ \t]*(?:(?:public|private|protected|static|final|abstract|synchronized|default)\s+)+[\w<>\[\],.? ]*?\b(\w+)\s*\(/gmd },
  { kind: "type", pattern: /\b(?:class|interface|object|record|struct|trait|typealias)\s+(\w+)/gd },
  { kind: "value", pattern: /\b(?:val|var|const)\s+(\w+)\s*(?::[^=\n]+)?=/gd },
];

/** The header of the block a `{` opens: the text before it on its line, which says whether it is a function, a class or a lambda */
const blockHeader = (file: SourceFile, shape: FileShape, pair: BracketPair): string => file.text.slice(shape.starts[lineOf(shape.starts, pair.open)], pair.open);

/** The last line a declaration covers: its block, a literal it is set to, or its own line; a following declaration is not part of it */
function declarationEnd(file: SourceFile, shape: FileShape, kind: "fun" | "type" | "value", name: string, offset: number): number {
  const line = lineOf(shape.starts, offset);
  if (kind === "value") {
    const literal = shape.all
      .filter((pair) => pair.kind !== "{" && lineOf(shape.starts, pair.open) >= line && declaredName(file.text.slice(shape.starts[lineOf(shape.starts, pair.open)], pair.open)) === name)
      .sort((a, b) => a.open - b.open)[0];
    return literal && lineOf(shape.starts, literal.open) - line <= 1 ? lineOf(shape.starts, literal.close) : line;
  }
  const body = bodyBelow(shape, offset);
  if (!body) return line;
  const opens = lineOf(shape.starts, body.open);
  return shape.lines.slice(line + 1, opens + 1).some((text) => DECLARATION_START.test(text)) ? line : lineOf(shape.starts, body.close);
}

/** Every function, type and top-level or member value the files declare, by name; locals and parameters are left out so a name used all over a test is not a link everywhere */
function symbolIndex(files: SourceFile[], shapes: Map<SourceFile, FileShape>): Map<string, SourceSymbol[]> {
  const byName = new Map<string, SourceSymbol[]>();
  for (const file of files) {
    const shape = shapeOf(file, shapes);
    const path = posix.join(file.shownBase, relative(file.base, file.path).replaceAll("\\", "/"));
    for (const { kind, pattern } of DECLARATIONS) {
      for (const match of file.text.matchAll(pattern)) {
        const name = match[1];
        const at = (match as RegExpMatchArray & { indices: [number, number][] }).indices[1][0];
        if (name.length < MIN_SYMBOL_LENGTH) continue;
        const inside = shape.all.filter((pair) => contains(pair, at));
        const blocks = inside.filter((pair) => pair.kind === "{");
        if (blocks.some((pair) => FUNCTION_HEADER.test(blockHeader(file, shape, pair)))) continue;
        if (kind === "value" && (inside.some((pair) => pair.kind === "(") || !blocks.every((pair) => CLASS_HEADER.test(blockHeader(file, shape, pair))))) continue;
        const line = lineOf(shape.starts, at);
        const end = Math.min(declarationEnd(file, shape, kind, name, at), line + MAX_SNIPPET_LINES - 1);
        const start = withLeadIn(shape.lines, { start: line, end }).start;
        const known = byName.get(name) ?? [];
        if (known.some((other) => other.path === path && other.start === start + 1)) continue;
        byName.set(name, [...known, { path, start: start + 1, end: end + 1, line: line + 1 }]);
      }
    }
  }
  for (const [name, places] of byName) if (places.length > MAX_SYMBOL_CANDIDATES) byName.delete(name);
  return byName;
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
  }
  const byPath = new Map(files.map((file) => [posix.join(file.shownBase, relative(file.base, file.path).replaceAll("\\", "/")), file.text]));
  let symbols: Map<string, SourceSymbol[]> | undefined;
  return {
    snippetsFor: (id) => found.get(id) ?? [],
    hasTest: (name) => mentionsTest(files, name),
    reachable(paths) {
      symbols ??= symbolIndex(files, new Map());
      const included = new Set(paths.filter((path) => byPath.has(path)));
      const queue = [...included];
      for (let path = queue.pop(); path !== undefined; path = queue.pop()) {
        for (const word of byPath.get(path)!.matchAll(/[A-Za-z_]\w*/g)) {
          for (const place of symbols.get(word[0]) ?? []) {
            if (included.has(place.path)) continue;
            included.add(place.path);
            queue.push(place.path);
          }
        }
      }
      return {
        files: Object.fromEntries([...included].map((path) => [path, byPath.get(path)!])),
        symbols: Object.fromEntries([...symbols].filter(([, places]) => places.every((place) => included.has(place.path)))),
      };
    },
  };
}
