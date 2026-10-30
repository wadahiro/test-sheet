// Turns reference numbers written as plain text (PROJ-123) into links at generation time, the way
// GitHub and GitLab autolink references do: the case holds the number, the configuration holds where
// numbers lead. A tracker that moves then needs one edit, not one per case.

import type { MarkedExtension, Tokens } from "marked";

export interface AutolinkRule {
  /** Regular expression source; matched against the text between Markdown constructs */
  pattern: string;
  /** Link target. `{0}` is the whole match, `{1}`… the capture groups, each URL-encoded */
  url: string;
}

type Warn = (message: string) => void;

const WORD_CHAR = /[A-Za-z0-9_]/;
const HTTP_URL = /^https?:\/\//i;

/**
 * Checks what a configuration holds and keeps the rules that can work. A wrong rule is reported and
 * left out rather than failing the whole sheet, since the cases are readable without links.
 */
export function parseAutolinkRules(raw: unknown, source: string, warn: Warn = console.error): AutolinkRule[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    warn(`Warning: ${source}: autolinks must be a list of { pattern, url } pairs; ignoring it.`);
    return [];
  }
  const rules: AutolinkRule[] = [];
  raw.forEach((entry: unknown, i) => {
    const where = `${source}: autolinks[${i}]`;
    const item = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
    const { pattern, url } = item;
    if (typeof pattern !== "string" || pattern === "" || typeof url !== "string" || url === "") {
      warn(`Warning: ${where} needs a non-empty "pattern" and "url"; ignoring it.`);
      return;
    }
    let groups: number;
    try {
      const probe = new RegExp(`${pattern}|`);
      groups = (probe.exec("") ?? []).length - 1;
      if (new RegExp(pattern).exec("")) {
        warn(`Warning: ${where}: pattern "${pattern}" matches an empty string; ignoring it.`);
        return;
      }
    } catch (err) {
      warn(`Warning: ${where}: pattern "${pattern}" is not a valid regular expression (${err instanceof Error ? err.message : String(err)}); ignoring it.`);
      return;
    }
    if (!HTTP_URL.test(url)) {
      warn(`Warning: ${where}: url "${url}" must start with http:// or https://; ignoring it.`);
      return;
    }
    const used = [...url.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
    if (used.length === 0) warn(`Warning: ${where}: url has no {0} placeholder, so every match links to the same page.`);
    const missing = used.filter((n) => n > groups);
    if (missing.length > 0) {
      warn(`Warning: ${where}: url uses {${missing[0]}} but pattern "${pattern}" has ${groups} capture group(s); ignoring it.`);
      return;
    }
    rules.push({ pattern, url });
  });
  return rules;
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

interface Found {
  index: number;
  text: string;
  href: string;
}

function expand(url: string, match: RegExpExecArray): string {
  return url.replace(/\{(\d+)\}/g, (_, n: string) => encodeURIComponent(match[Number(n)] ?? ""));
}

/**
 * A reference must stand alone: "XPROJ-123" and "PROJ-123abc" are other words, not tickets. Only
 * ASCII word characters count, since CJK text runs straight into a number ("関連PROJ-123を見る").
 */
function standsAlone(text: string, start: number, end: number): boolean {
  return !(start > 0 && WORD_CHAR.test(text[start - 1])) && !(end < text.length && WORD_CHAR.test(text[end]));
}

/**
 * A Marked inline extension rather than a pass over the finished HTML: by the time the lexer offers
 * text to it, code spans, code blocks, existing links and bare URLs have already been taken, so a
 * number inside any of them is never touched. Link text is the one place the lexer still recurses
 * into, and `inLink` is how it says so.
 */
export function autolinkExtension(rules: AutolinkRule[]): MarkedExtension {
  if (rules.length === 0) return {};
  const compiled = rules.map((rule) => ({ rule, source: rule.pattern }));

  const search = (src: string, atStart: boolean): Found | null => {
    let best: Found | null = null;
    for (const { rule, source } of compiled) {
      const re = new RegExp(source, atStart ? "y" : "g");
      for (let match = re.exec(src); match; match = re.exec(src)) {
        const end = match.index + match[0].length;
        // Without the preceding character, a match at the very start of a text run is taken as standing alone
        const ok = standsAlone(src, atStart ? 0 : match.index, end);
        if (match[0] !== "" && ok) {
          if (!best || match.index < best.index) best = { index: match.index, text: match[0], href: expand(rule.url, match) };
          break;
        }
        if (atStart || match[0] === "") break;
      }
      if (atStart && best) break;
    }
    return best;
  };

  return {
    extensions: [
      {
        name: "autolinkReference",
        level: "inline",
        start: (src: string) => search(src, false)?.index,
        tokenizer(src: string) {
          if (this.lexer.state.inLink) return undefined;
          const found = search(src, true);
          if (!found) return undefined;
          return { type: "autolinkReference", raw: found.text, text: found.text, href: found.href } as Tokens.Generic;
        },
        renderer(token) {
          return `<a href="${escapeHtml(token.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(token.text)}</a>`;
        },
      },
    ],
  };
}
