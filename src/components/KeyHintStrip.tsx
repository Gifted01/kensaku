import React from "react";
import type { IndexingStatus, DoctorReport } from "../types";
import { formatComma } from "../lib/format";
import { Stethoscope, ArrowUpCircle } from "lucide-react";
import { t, tn, useLanguage } from "../i18n";

/* Status line. Index health on the left, the few keys worth knowing on the
   right. Quiet by default: it only takes the ink while indexing. */

const HINTS: { keys: string; label: string }[] = [
  { keys: "↵", label: "Open" },
  { keys: "Space", label: "Preview" },
  { keys: "⇧↵", label: "Reveal" },
  { keys: "⌘I", label: "Details" },
];

function statusText(s: IndexingStatus | null | undefined): { text: string; busy: boolean } {
  if (!s) return { text: "", busy: false };
  if (s.paused) return { text: t("Indexing paused"), busy: false };
  if (s.is_indexing || (s.phase && s.phase !== "idle")) {
    if (s.phase === "rebuilding") return { text: s.current_status || t("Rebuilding index…"), busy: true };
    const done = s.extract_done ?? s.files_indexed;
    const total = s.extract_total ?? s.total_files;
    return {
      text: total
        ? t("Indexing {done} of {total}", { done: formatComma(done), total: formatComma(total) })
        : tn(done, "Indexing {n} file", "Indexing {n} files"),
      busy: true,
    };
  }
  return { text: tn(s.files_indexed, "{n} file", "{n} files"), busy: false };
}

export const KeyHintStrip: React.FC<{
  status?: IndexingStatus | null;
  doctor?: DoctorReport | null;
  updateAvailable?: string | null;
  onDoctor?: () => void;
  onUpdate?: () => void;
}> = ({ status, doctor, updateAvailable, onDoctor, onUpdate }) => {
  useLanguage();
  const { text, busy } = statusText(status);
  const issues = doctor ? doctor.summary.warn + doctor.summary.fail : 0;
  return (
    <div className="relative z-10 flex h-7 shrink-0 items-center justify-between gap-4 px-3.5 text-[11px] text-subtle">
      <span className="flex items-center gap-2">
        {text && (
          <>
            <span className={`h-1.5 w-1.5 rounded-full ${busy ? "dot-pulse bg-ink" : "bg-success/70"}`} />
            <span className="t-meta">{text}</span>
          </>
        )}
        {doctor && (
          <button
            type="button"
            onClick={onDoctor}
            title={issues ? tn(issues, "{n} health issue — open Health", "{n} health issues — open Health") : t("Index health OK")}
            className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 transition-colors hover:bg-surface-2 ${issues ? "text-warning" : "text-subtle"}`}
          >
            <Stethoscope className="h-3.5 w-3.5" />
            {issues > 0 && <span className="t-meta">{tn(issues, "{n} issue", "{n} issues")}</span>}
          </button>
        )}
        {updateAvailable && (
          <button
            type="button"
            onClick={onUpdate}
            title={t("Update available: {version}", { version: updateAvailable })}
            className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-accent transition-colors hover:bg-surface-2"
          >
            <ArrowUpCircle className="h-3.5 w-3.5" />
            <span className="t-meta">{t("Update")}</span>
          </button>
        )}
      </span>
      <span className="hidden items-center gap-4 sm:flex">
        {HINTS.map((h) => (
          <span key={h.label} className="flex items-center gap-1.5">
            <span className="kbd">{h.keys}</span>
            <span>{t(h.label)}</span>
          </span>
        ))}
      </span>
    </div>
  );
};
