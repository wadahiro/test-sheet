// Colours test code for the case view. Only the languages listed here are bundled: highlight.js ships
// ~190, and each one inlined would grow every generated page for the sake of files nobody opens.

import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import csharp from "highlight.js/lib/languages/csharp";
import go from "highlight.js/lib/languages/go";
import groovy from "highlight.js/lib/languages/groovy";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scala from "highlight.js/lib/languages/scala";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const LANGUAGES = { bash, csharp, go, groovy, java, javascript, json, kotlin, python, ruby, rust, scala, sql, typescript, xml, yaml };
for (const [name, definition] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, definition);

const BY_EXTENSION: Record<string, keyof typeof LANGUAGES> = {
  kt: "kotlin", kts: "kotlin", java: "java", groovy: "groovy", gradle: "groovy", scala: "scala", cs: "csharp",
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", rb: "ruby", go: "go", rs: "rust", sh: "bash", bash: "bash", sql: "sql",
  json: "json", yaml: "yaml", yml: "yaml", xml: "xml", html: "xml",
};

/**
 * The highlighted code one entry per line, each closed and reopened where a token (a block comment,
 * a multi-line string) crosses a line break, so a line can be shown on its own. Null as for highlightHtml.
 */
export function highlightLines(code: string, file: string): string[] | null {
  const marked = highlightHtml(code, file);
  if (marked === null) return null;
  const open: string[] = [];
  return marked.split("\n").map((line) => {
    const reopened = open.join("");
    for (const tag of line.matchAll(/<span[^>]*>|<\/span>/g)) {
      if (tag[0] === "</span>") open.pop();
      else open.push(tag[0]);
    }
    return reopened + line + "</span>".repeat(open.length);
  });
}

/** Highlighted HTML for the code, or null for a file type with no grammar here, which is shown as plain text */
export function highlightHtml(code: string, file: string): string | null {
  const language = BY_EXTENSION[file.slice(file.lastIndexOf(".") + 1).toLowerCase()];
  if (!language) return null;
  // The result is escaped by highlight.js; ignoreIllegals keeps a fragment cut out of a file from being refused
  return hljs.highlight(code, { language, ignoreIllegals: true }).value;
}
