import { expect, test } from "bun:test";
import { highlightLines } from "./html/highlight";
import { linkifyHtml } from "./html/sourceLinks";

const names = new Set(["assertMailBody", "Mail", "EXPECTED_BODY"]);
const link = (code: string) => highlightLines(code, "Spec.kt")!.map((line) => linkifyHtml(line, (name) => names.has(name)));
const refs = (markup: string) => [...markup.matchAll(/data-ref="(\w+)"/g)].map((match) => match[1]);

test("names that have a definition become links, and others stay as they were", () => {
  const [line] = link("assertMailBody(mail, EXPECTED_BODY)");
  expect(refs(line)).toEqual(["assertMailBody", "EXPECTED_BODY"]);
  expect(line).toContain("(mail, ");
});

test("a name inside a string, a comment or an annotation is not a reference", () => {
  const lines = link('@Test\n// Mail is compared\nval label = "Mail EXPECTED_BODY"\nval kept: Mail = fetch()');
  expect(refs(lines[0])).toEqual([]);
  expect(refs(lines[1])).toEqual([]);
  expect(refs(lines[2])).toEqual([]);
  expect(refs(lines[3])).toEqual(["Mail"]);
});

test("an entity is not read as a name", () => {
  const names = new Set(["lt", "amp"]);
  expect(linkifyHtml("a &lt; b &amp;&amp; c", (name) => names.has(name))).toBe("a &lt; b &amp;&amp; c");
});

test("the link carries no href, so it is never mistaken for a route", () => {
  expect(link("val x: Mail = y")[0]).not.toContain("href");
});

test("the name a line declares is not a link, but the same name used on the right is", () => {
  const declared = new Set(["certificates", "Mail"]);
  const line = highlightLines("val certificates = t.certificates()", "Spec.kt")!.map((l) => linkifyHtml(l, (name) => declared.has(name)))[0];
  expect(refs(line)).toEqual(["certificates"]);
  expect(line.indexOf("data-ref")).toBeGreaterThan(line.indexOf("="));
  const go = highlightLines("certificates := load(Mail)", "main.go")!.map((l) => linkifyHtml(l, (name) => declared.has(name)))[0];
  expect(refs(go)).toEqual(["Mail"]);
});

test("a member after a dot is judged apart from a local of the same name", () => {
  const seen: [string, boolean][] = [];
  linkifyHtml("certificates shouldHaveSize t.certificates()", (name, member) => (seen.push([name, member]), false));
  expect(seen.filter(([name]) => name === "certificates")).toEqual([["certificates", false], ["certificates", true]]);
});
