// Loads extra UI languages from JSON files given on the command line. The built-in languages live
// in src/html/locales; a file adds a language or adjusts the wording of one that exists.
//
//   { "code": "fr", "label": "Français", "messages": { "header.search": "Rechercher" } }

import { readFile } from "fs/promises";
import { isMessageKey, type LocaleDefinition, type Messages } from "./html/i18n";
import { en } from "./html/locales/en";

const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export interface LoadedLocale {
  locale: LocaleDefinition;
  /** Keys that are not UI strings, which usually means a typo */
  unknownKeys: string[];
}

function fail(file: string, problem: string): never {
  throw new Error(`${file}: ${problem}`);
}

export async function loadLocaleFile(file: string): Promise<LoadedLocale> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    return fail(file, `cannot read as JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) fail(file, "expected a JSON object");

  const { code, label, messages } = parsed;
  if (typeof code !== "string" || !LANGUAGE_TAG.test(code)) fail(file, '"code" must be a language tag such as "fr" or "pt-BR"');
  if (label !== undefined && typeof label !== "string") fail(file, '"label" must be a string');
  if (typeof messages !== "object" || messages === null || Array.isArray(messages)) fail(file, '"messages" must be an object');

  const known: Messages = {};
  const unknownKeys: string[] = [];
  for (const [key, value] of Object.entries(messages)) {
    if (typeof value !== "string") fail(file, `"${key}" must be a string`);
    if (isMessageKey(key)) known[key] = value;
    else unknownKeys.push(key);
  }
  return { locale: { code, label: label ?? code, messages: known }, unknownKeys };
}

/** The English catalog as a locale file to start a translation from */
export function localeTemplate(code: string): string {
  return JSON.stringify({ code, label: code, messages: en }, null, 2) + "\n";
}
