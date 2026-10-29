// Markdown rendering for test case fields (action, expected, notes).
// Unlike guides, these hold short free-form text typed or migrated from other tools, so the defaults
// that suit documents are tightened: raw HTML is shown as text, and GFM's lenient rules are narrowed.

import { Marked, type Tokens } from "marked";

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

const STRIKE = /^~~(?!\s)([\s\S]*?\S)~~/;
const STRONG = /^\*\*(?!\s)([\s\S]*?\S)\*\*/;

export interface CaseMarkdownOptions {
  /** true turns a single newline into <br>, for table cells where each line is meant as its own line */
  breaks: boolean;
}

export function createCaseMarkdown({ breaks }: CaseMarkdownOptions): Marked {
  return new Marked({
    gfm: true,
    breaks,
    // CommonMark only closes `**` after punctuation when a space or punctuation follows, so
    // `**【注意】**続き` leaves the asterisks literal. Japanese has no spaces to satisfy that rule.
    extensions: [
      {
        name: "strongAnyContext",
        level: "inline",
        start: (src: string) => src.indexOf("**"),
        tokenizer(src: string) {
          const match = STRONG.exec(src);
          if (!match) return undefined;
          return { type: "strongAnyContext", raw: match[0], tokens: this.lexer.inlineTokens(match[1]) };
        },
        renderer(token) {
          return `<strong>${this.parser.parseInline(token.tokens ?? [])}</strong>`;
        },
      },
    ],
    tokenizer: {
      // `~x~` is also strikethrough in GFM, which strikes out Japanese ranges like 1~3日
      del(src) {
        const match = STRIKE.exec(src);
        if (!match) return undefined;
        return { type: "del", raw: match[0], text: match[1], tokens: this.lexer.inlineTokens(match[1]) };
      },
    },
    renderer: {
      // Addresses are common test data and should not turn into mailto: links. The lexer has already
      // made them links by this point, so an autolinked address is recognised by its text matching its href.
      link(token: Tokens.Link) {
        if (token.href.startsWith("mailto:") && token.text === token.href.slice("mailto:".length)) return token.text;
        return false;
      },
      html(token: Tokens.HTML | Tokens.Tag) {
        const text = escapeHtml(token.text);
        return "block" in token && token.block ? `<p>${text.trimEnd()}</p>\n` : text;
      },
    },
  });
}
