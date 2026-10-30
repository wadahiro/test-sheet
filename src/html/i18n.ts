// UI language. Shared by the browser bundle and the CLI (which validates locale files), so it must
// not touch the DOM or storage at import time.

import { en, type MessageKey } from "./locales/en";
import { ja } from "./locales/ja";

export type { MessageKey };

/** A language may translate only some keys; the rest read in English rather than as a bare key */
export type Messages = Partial<Record<MessageKey, string>>;

export interface LocaleDefinition {
  /** BCP 47 tag, e.g. "ja" or "pt-BR" */
  code: string;
  /** Shown in the language menu, in the language itself, so a reader can find theirs */
  label: string;
  messages: Messages;
}

export const FALLBACK_LOCALE = "en";

const BUILT_IN: LocaleDefinition[] = [
  { code: "en", label: "English", messages: en },
  { code: "ja", label: "日本語", messages: ja },
];

export function isMessageKey(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

/**
 * Built-in languages plus those supplied at generation time. A supplied locale with a built-in's code
 * overrides only the keys it names, so wording can be adjusted without restating the whole language.
 */
export function mergeLocales(extra: LocaleDefinition[]): LocaleDefinition[] {
  const merged = new Map(BUILT_IN.map((locale) => [locale.code.toLowerCase(), locale]));
  for (const locale of extra) {
    const known = merged.get(locale.code.toLowerCase());
    merged.set(
      locale.code.toLowerCase(),
      known ? { ...known, label: locale.label || known.label, messages: { ...known.messages, ...locale.messages } } : locale
    );
  }
  return [...merged.values()];
}

/**
 * The first language the browser prefers that is available: an exact tag wins over its base
 * language ("pt-BR" over "pt"), and a regional tag falls back to its base ("ja-JP" -> "ja").
 */
export function matchLocale(locales: LocaleDefinition[], preferred: readonly string[]): string {
  const codes = new Map(locales.map((locale) => [locale.code.toLowerCase(), locale.code]));
  for (const tag of preferred) {
    const lower = tag.toLowerCase();
    const exact = codes.get(lower);
    if (exact) return exact;
    const base = codes.get(lower.split("-")[0]);
    if (base) return base;
  }
  return FALLBACK_LOCALE;
}

interface Active {
  code: string;
  messages: Messages;
  plural: Intl.PluralRules;
}

let active: Active = { code: FALLBACK_LOCALE, messages: en, plural: new Intl.PluralRules(FALLBACK_LOCALE) };

export function setLocale(locale: LocaleDefinition) {
  let plural: Intl.PluralRules;
  try {
    plural = new Intl.PluralRules(locale.code);
  } catch {
    // A tag the runtime rejects still has to display; English rules are a harmless stand-in
    plural = new Intl.PluralRules(FALLBACK_LOCALE);
  }
  active = { code: locale.code, messages: locale.messages, plural };
}

export function currentLocaleCode(): string {
  return active.code;
}

function fill(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  return fill(active.messages[key] ?? en[key], params);
}

/** Picks the `.one` / `.other` (…) variant of `key` for `n`; `{n}` is filled in as well */
export function tn(key: string, n: number, params: Record<string, string | number> = {}): string {
  const form = active.plural.select(n);
  const pick = (suffix: string): string | undefined => {
    const full = `${key}.${suffix}`;
    return isMessageKey(full) ? (active.messages[full] ?? en[full]) : undefined;
  };
  return fill(pick(form) ?? pick("other") ?? key, { ...params, n });
}

/** Locale for number and date formatting; falls back when the tag is not a valid BCP 47 one */
export function formattingLocale(): string | undefined {
  try {
    return Intl.getCanonicalLocales(active.code)[0];
  } catch {
    return undefined;
  }
}
