/* Interpretation chips arrive with English labels from the backend
   ("Modified: last 7 days", "Size: under 5MB", "Modified: last Friday",
   "Modified: 3 days ago").

   English shows them as they are. Other languages first look the whole label
   up (fixed labels such as "Modified: last 7 days" are dictionary keys); only
   labels with a variable part go through a template. Templates are matched
   narrowly so a fixed label can never be split into "last" + "7 days". */

import { getLanguage, hasTranslation, t } from "../i18n";

export interface ChipLike {
  kind: string;
  label: string;
}

export function chipLabel(c: ChipLike): string {
  if (getLanguage() === "en") return c.label;
  if (hasTranslation(c.label)) return t(c.label);

  let m = c.label.match(/^Size: (under|over) (.+)$/);
  if (m) {
    return m[1] === "under"
      ? t("Size: under {v}", { v: m[2] })
      : t("Size: over {v}", { v: m[2] });
  }
  m = c.label.match(/^(In|Alias): (.+)$/);
  if (m) {
    return m[1] === "In" ? t("In: {v}", { v: m[2] }) : t("Alias: {v}", { v: m[2] });
  }
  m = c.label.match(/^Modified: (\d+) days ago$/);
  if (m) return t("Modified: {v} days ago", { v: m[1] });
  // "Modified: last <English weekday>".
  m = c.label.match(/^Modified: last (\p{L}+)$/u);
  if (m) {
    const day = m[1].toLowerCase();
    if (hasTranslation(day)) return t("Modified: last {v}", { v: t(day) });
  }
  return t(c.label);
}
