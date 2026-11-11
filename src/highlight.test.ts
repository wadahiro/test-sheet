import { expect, test } from "bun:test";
import { highlightLines } from "./html/highlight";

const strip = (markup: string) => markup.replace(/<[^>]+>/g, "").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

test("a token crossing lines is closed and reopened so each line stands alone", () => {
  const code = ["/**", " * Revokes <expired> ones", " */", "fun testDeleteExpired() {}", ""].join("\n");
  const lines = highlightLines(code, "Spec.kt")!;
  expect(lines).toHaveLength(code.split("\n").length);
  lines.forEach((line, i) => {
    expect(strip(line)).toBe(code.split("\n")[i]);
    expect(line.match(/<span/g)?.length ?? 0).toBe(line.match(/<\/span>/g)?.length ?? 0);
  });
  expect(lines[1]).toContain('class="hljs-comment"');
});

test("a file type with no grammar is left to be shown as plain text", () => {
  expect(highlightLines("a\nb", "notes.txt")).toBeNull();
});
