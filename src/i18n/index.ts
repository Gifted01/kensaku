/* Interface language.

   Strings are written in English in the components and wrapped in `t()`;
   the English text is the key ("gettext style"), so a missing translation
   simply shows English. Translations live in one dictionary per language
   (`ru.ts`). `tools/check-i18n.mjs` lists keys a dictionary is missing.

   The setting (`system` | `en` | `ru`) is stored in the backend config, the
   durable source of truth; localStorage only holds the pre-paint pick, the
   same way the theme does. */

import { useSyncExternalStore } from "react";
import { ru } from "./ru";

export type Lang = "en" | "ru";
export type LangSetting = "system" | Lang;

/** Plural forms: Russian needs three (1 файл, 2 файла, 5 файлов). */
export type PluralForms = readonly [one: string, few: string, many: string];
export type Dictionary = Record<string, string | PluralForms>;

const DICTIONARIES: Record<Lang, Dictionary | null> = { en: null, ru };
const STORAGE_KEY = "kensaku.language";
const CYRILLIC = ["ru", "uk", "be", "kk", "ky", "bg", "mk", "tt"];

export function normalizeLangSetting(raw: string | null | undefined): LangSetting {
  const v = (raw ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return v === "en" || v === "ru" ? v : "system";
}

/** The language a setting shows. `system` follows the OS/webview locale. */
export function resolveLanguage(setting: LangSetting): Lang {
  if (setting !== "system") return setting;
  const prefs =
    typeof navigator !== "undefined"
      ? [...(navigator.languages ?? []), navigator.language].filter(Boolean)
      : [];
  for (const tag of prefs) {
    const primary = tag.toLowerCase().split(/[-_]/)[0];
    if (primary === "en") return "en";
    if (CYRILLIC.includes(primary)) return "ru";
  }
  return "en";
}

function readStored(): LangSetting {
  try {
    return normalizeLangSetting(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "system";
  }
}

let setting: LangSetting = readStored();
let current: Lang = resolveLanguage(setting);
const listeners = new Set<() => void>();

function applyDocumentLang() {
  if (typeof document !== "undefined") document.documentElement.lang = current;
}
applyDocumentLang();

export function getLanguageSetting(): LangSetting {
  return setting;
}

export function getLanguage(): Lang {
  return current;
}

/** Applies a language setting (from config or the Settings picker). */
export function setLanguageSetting(next: string | null | undefined) {
  setting = normalizeLangSetting(next);
  try {
    localStorage.setItem(STORAGE_KEY, setting);
  } catch {
    /* storage unavailable */
  }
  const lang = resolveLanguage(setting);
  if (lang === current) return;
  current = lang;
  applyDocumentLang();
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Re-renders the calling component when the language changes. */
export function useLanguage(): Lang {
  return useSyncExternalStore(subscribe, getLanguage, getLanguage);
}

/** BCP-47 locale for number and date formatting. */
export function locale(): string {
  return current === "ru" ? "ru-RU" : "en-US";
}

function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** Translates an English source string. `{name}` placeholders are filled from `vars`. */
export function t(source: string, vars?: Record<string, string | number>): string {
  const dict = DICTIONARIES[current];
  const entry = dict?.[source];
  const text = typeof entry === "string" ? entry : Array.isArray(entry) ? entry[2] : source;
  return interpolate(text, vars);
}

/** Russian plural category: 0 = one (1, 21), 1 = few (2–4, 22–24), 2 = many. */
export function ruPluralIndex(n: number): 0 | 1 | 2 {
  const abs = Math.abs(Math.trunc(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return 0;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 1;
  return 2;
}

/**
 * Count-dependent text. `one` / `other` are the English forms and `one` is
 * the dictionary key; Russian entries hold three forms. `{n}` is the
 * locale-formatted count.
 */
export function tn(
  n: number,
  one: string,
  other: string,
  vars?: Record<string, string | number>,
): string {
  const all = { n: n.toLocaleString(locale()), ...vars };
  const entry = DICTIONARIES[current]?.[one];
  if (Array.isArray(entry)) return interpolate(entry[ruPluralIndex(n)], all);
  if (typeof entry === "string") return interpolate(entry, all);
  return interpolate(n === 1 ? one : other, all);
}

/** Every key a dictionary should contain (used by the coverage check). */
export const LANGUAGES: { value: LangSetting; label: string }[] = [
  { value: "system", label: "System" },
  { value: "en", label: "English" },
  { value: "ru", label: "Русский" },
];
