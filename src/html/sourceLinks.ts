// Turns the names in highlighted code into links to their definitions. Done on the HTML highlight.js
// produced, so the colouring stays, and only on plain code: a name inside a string, a comment or a
// keyword's own span is not a reference.

const NOT_CODE = /hljs-(?:string|comment|keyword|number|literal|regexp|meta|doctag)/;
const PIECE = /<span class="([^"]*)">|<\/span>|([^<]+)/g;
const WORD = /(&[a-z#0-9]+;)|\b([A-Za-z_]\w*)\b/g;

// A name being declared is where the reader already is: `val certificates = t.certificates()` links the
// call on the right, and the left one would only lead back to itself or to an unrelated member of the same name
const DECLARED_AFTER = /\b(?:val|var|const|let|fun|func|function|def|class|object|interface|typealias|enum|record|struct)\s+(?:<[^>]*>\s*)?$/;
const DECLARED_BEFORE = /^\s*:=/;

const escapeAttribute = (value: string): string => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

/**
 * The markup with each name `linked` accepts wrapped in a span carrying `data-ref`. A span and not an
 * anchor: an `a[href^="#/"]` would be taken for a route, and following it here does not leave the page.
 */
export function linkifyHtml(markup: string, linked: (name: string) => boolean, title = ""): string {
  const open: boolean[] = [];
  let hidden = 0;
  let before = "";
  return markup.replace(PIECE, (piece: string, classes: string | undefined, text: string | undefined) => {
    if (classes !== undefined) {
      const skip = NOT_CODE.test(classes);
      open.push(skip);
      if (skip) hidden++;
      return piece;
    }
    if (piece === "</span>") {
      if (open.pop()) hidden--;
      return piece;
    }
    if (text === undefined) return piece;
    const seen = before;
    before = (before + text).slice(-80);
    if (hidden > 0) return piece;
    return text.replace(WORD, (word: string, entity: string | undefined, name: string | undefined, at: number) => {
      if (name === undefined || !linked(name)) return word;
      if (DECLARED_AFTER.test(seen + text.slice(0, at)) || DECLARED_BEFORE.test(text.slice(at + name.length))) return word;
      return `<span class="src-ref" data-ref="${name}" role="link" tabindex="0" title="${escapeAttribute(title)}">${name}</span>`;
    });
  });
}
