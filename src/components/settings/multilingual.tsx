import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Download, LoaderCircle } from "lucide-react";
import type { KensakuConfig, ModelsStatus } from "../../types";
import { formatBytes } from "../../lib/format";
import { t } from "../../i18n";
import { Card, Field, Switch } from "./kit";

/* Multilingual meaning search. The default text model (potion-base-8M) only
   knows English, so meaning search does nothing useful for Russian text.
   potion-multilingual-128M has the same format and 101 languages; it is a
   larger, optional download. Switching models re-embeds everything, which
   happens on the next launch. */

const MULTILINGUAL = "multilingual";

export function MultilingualModelCard({
  config,
  setConfig,
}: {
  config: KensakuConfig;
  setConfig: React.Dispatch<React.SetStateAction<KensakuConfig | null>>;
}) {
  const [status, setStatus] = useState<ModelsStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await invoke<ModelsStatus>("get_multilingual_status"));
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!status?.downloading) return;
    const id = window.setInterval(load, 800);
    return () => window.clearInterval(id);
  }, [status?.downloading, load]);

  const download = async () => {
    setBusy(true);
    try {
      setStatus(await invoke<ModelsStatus>("download_multilingual_model"));
    } catch (err) {
      console.warn("download_multilingual_model failed:", err);
    } finally {
      setBusy(false);
    }
  };

  const enabled = (config.semantic_model ?? "static").toLowerCase() === MULTILINGUAL;
  const prog = status?.progress;
  const pct =
    prog && prog.total > 0 ? Math.min(100, Math.round((prog.downloaded / prog.total) * 100)) : 0;
  const size = status?.total_bytes ? formatBytes(status.total_bytes) : "~530 MB";

  return (
    <Card title={t("Russian and other languages")}>
      <Field
        label={t("Multilingual model")}
        description={t(
          "Meaning search in 101 languages, Russian included. {size} download, ~130 MB of memory, applies after a restart.",
          { size },
        )}
      >
        <Switch
          checked={enabled}
          disabled={!status?.ready && !enabled}
          onChange={(v) =>
            setConfig((c) => (c ? { ...c, semantic_model: v ? MULTILINGUAL : "static" } : c))
          }
        />
      </Field>
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <p className="min-w-0 text-[12px] leading-[18px] text-muted">
          {status === null
            ? t("Model status unavailable — the backend command is not connected yet.")
            : status.downloading
              ? prog?.phase === "verifying"
                ? t("Verifying {file}…", { file: prog.file })
                : t("Downloading {pct}%", { pct })
              : status.ready
                ? t("Downloaded and verified.")
                : status.error
                  ? status.error
                  : t("Not downloaded yet. The switch unlocks once the model is here.")}
        </p>
        {status && !status.ready && (
          <button
            type="button"
            onClick={download}
            disabled={busy || status.downloading}
            className="btn btn-secondary h-8 shrink-0 px-3 text-[12px]"
          >
            {busy || status.downloading ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            {t("Download")}
          </button>
        )}
      </div>
      {status?.downloading && (
        <div className="px-4 pb-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-accent-soft">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${Math.max(4, pct)}%` }}
            />
          </div>
        </div>
      )}
    </Card>
  );
}
