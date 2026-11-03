/* Formatting helpers shared across components. Monospace-facing so that
   numbers tabulate cleanly in the status bar, stats and result rows. */

import { locale, t, tn } from "../i18n";

export function formatBytes(bytes: number): string {
  const sizes = [t("B"), t("KB"), t("MB"), t("GB"), t("TB")];
  if (!bytes || bytes <= 0) return `0 ${sizes[0]}`;
  const k = 1024;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  const v = bytes / Math.pow(k, i);
  const shown = v >= 100 ? Math.round(v) : parseFloat(v.toFixed(1));
  return `${shown.toLocaleString(locale())} ${sizes[i]}`;
}

export function formatComma(n: number): string {
  return n.toLocaleString(locale());
}

export function formatRelativeTime(secs: number): string {
  if (!secs) return "";
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - secs);
  if (diff < 60) return t("just now");
  if (diff < 3600) return t("{n}m ago", { n: Math.floor(diff / 60) });
  if (diff < 86400) return t("{n}h ago", { n: Math.floor(diff / 3600) });
  if (diff < 86400 * 30) return tn(Math.floor(diff / 86400), "{n}d ago", "{n}d ago");
  if (diff < 86400 * 365) return t("{n}mo ago", { n: Math.floor(diff / (86400 * 30)) });
  return new Date(secs * 1000).toLocaleDateString(locale());
}

export function formatDuration(secs: number): string {
  if (!secs || secs <= 0) return t("{s}s", { s: 0 });
  if (secs < 60) return t("{s}s", { s: Math.round(secs) });
  const m = Math.floor(secs / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return t("{h}h {m}m", { h, m: m % 60 });
  return t("{m}m {s}s", { m, s: Math.floor(secs % 60) });
}

/** Extracts the free-text search terms, dropping `filter:` tokens. */
export function queryTerms(query: string): string[] {
  return query
    .split(/\s+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 1 && !t.includes(":"));
}

/** Splits text into plain / match segments for subtle inline highlighting. */
export function highlightSegments(
  text: string,
  terms: string[],
): { text: string; match: boolean }[] {
  if (terms.length === 0) return [{ text, match: false }];
  const lower = text.toLowerCase();
  type Seg = { start: number; end: number };
  const ranges: Seg[] = [];
  for (const term of terms.flatMap((x) => [x, ruStem(x)])) {
    let idx = lower.indexOf(term);
    while (idx !== -1 && term.length > 0) {
      ranges.push({ start: idx, end: idx + term.length });
      idx = lower.indexOf(term, idx + term.length);
    }
  }
  if (ranges.length === 0) return [{ text, match: false }];
  ranges.sort((a, b) => a.start - b.start);
  // Merge overlaps.
  const merged: Seg[] = [ranges[0]];
  for (const r of ranges.slice(1)) {
    const last = merged[merged.length - 1];
    if (r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push(r);
  }
  const out: { text: string; match: boolean }[] = [];
  let pos = 0;
  for (const r of merged) {
    if (r.start > pos) out.push({ text: text.slice(pos, r.start), match: false });
    out.push({ text: text.slice(r.start, r.end), match: true });
    pos = r.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), match: false });
  return out;
}

/** Formats a millisecond latency with a tailwind color class by bucket. */
export function latencyToken(ms: number): string {
  if (ms < 10) return "text-success";
  if (ms < 40) return "text-warning";
  return "text-danger";
}

export function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() || p;
}

/* Russian word endings, longest first. Search matches word forms by stem
   (the index uses a Snowball stemmer), so highlighting strips the ending too:
   the query "договоры" highlights "договора" in a snippet. Deliberately crude:
   it only decides what to underline, never what matches. */
const RU_ENDINGS = [
  "иями", "ями", "ами", "ого", "его", "ому", "ему", "ыми", "ими", "иях", "ией",
  "ах", "ях", "ой", "ей", "ом", "ем", "ам", "ям", "ов", "ев", "ия", "ии", "ию",
  "ий", "ые", "ие", "ый", "ая", "яя", "ое", "ее", "ую", "юю", "ы", "и", "а",
  "я", "у", "ю", "е", "о", "ь", "й",
];

/** Stem of a Cyrillic word for highlighting; other text is returned as is. */
export function ruStem(word: string): string {
  const w = word.toLowerCase().replace(/ё/g, "е");
  if (!/^[\u0400-\u04FF]+$/.test(w) || w.length < 5) return w;
  for (const end of RU_ENDINGS) {
    if (w.endsWith(end) && w.length - end.length >= 4) return w.slice(0, -end.length);
  }
  return w;
}

/** Parent folder for display: home collapsed to ~, long paths keep the tail. */
export function displayParent(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  parts.pop();
  let p = parts.join("/");
  p = p.replace(/^\/(Users|home)\/[^/]+/, "~").replace(/^[A-Z]:\/Users\/[^/]+/i, "~");
  const segs = p.split("/");
  return segs.length > 4 ? `${segs[0]}/…/${segs.slice(-2).join("/")}` : p || "/";
}
