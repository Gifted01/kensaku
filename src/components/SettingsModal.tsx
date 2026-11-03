import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Bot,
  Check,
  Copy,
  Filter,
  FolderTree,
  Info,
  Plus,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Stethoscope,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  KensakuConfig,
  ClientStatus,
  InstallOutcome,
} from "../types";
import { useTheme } from "../hooks/useTheme";
import { useStats } from "../hooks/useStats";
import { Card, Field, Switch, Stepper, SectionHeader, reasonFrom } from "./settings/kit";
import { OcrField } from "./settings/ocr";
import { StatsForNerds } from "./settings/stats";
import { DoctorSection } from "./settings/doctor";
import { ModelFilesCard } from "./settings/models";
import { formatBytes, formatComma } from "../lib/format";
import { MultilingualModelCard } from "./settings/multilingual";
import { LANGUAGES, getLanguageSetting, setLanguageSetting, t, useLanguage } from "../i18n";

export interface SettingsProps {
  onClose: () => void;
  initialSection?: string;
  onConfigSaved: () => void;
}

type SectionId =
  | "general"
  | "folders"
  | "exclusions"
  | "search"
  | "ai"
  | "beta"
  | "agents"
  | "stats"
  | "doctor"
  | "about";

const SECTIONS: { id: SectionId; label: string; icon: LucideIcon }[] = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "folders", label: "Folders", icon: FolderTree },
  { id: "exclusions", label: "Exclusions", icon: Filter },
  { id: "search", label: "Search", icon: Search },
  { id: "ai", label: "Meaning search", icon: Sparkles },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "doctor", label: "Health", icon: Stethoscope },
  { id: "about", label: "About", icon: Info },
];

const SECTION_META: Record<SectionId, { title: string; description: string }> = {
  general: { title: "General", description: "Appearance, invocation and startup behaviour." },
  folders: { title: "Folders", description: "Directories watched and indexed on this machine." },
  exclusions: { title: "Exclusions", description: "Names and extensions kept out of the index." },
  search: { title: "Search", description: "Ranking, OCR and the query language." },
  ai: { title: "Smart search", description: "Understands meaning, not just words. Runs on this computer." },
  beta: { title: "Beta", description: "Optional experiments that are not part of the default search path." },
  agents: { title: "Agents", description: "Read-only access for MCP clients and the CLI." },
  stats: { title: "Stats for Nerds", description: "Live telemetry from the running index." },
  doctor: { title: "Health", description: "Is the index up to date and everything running?" },
  about: { title: "About", description: "Version, thesis and the reset control." },
};

const EXCLUSION_PRESETS: Record<string, string[]> = {
  Developer: [
    "node_modules", ".git", "target", "dist", "build", "out",
    ".next", ".nuxt", ".output", ".cache", ".venv", "venv",
    "__pycache__", "vendor", ".gradle", ".idea", ".vscode",
  ],
  Creative: [
    "node_modules", ".git", ".Trash", ".cache", "Backups",
    "Time Machine", "Library", "lost+found", ".dub", "_archive",
  ],
  "All-round": [
    "node_modules", ".git", "target", "dist", "build", "out",
    ".cache", ".venv", "__pycache__", ".Trash", "Backups",
    "lost+found", ".idea", ".vscode", "Library",
  ],
};

/* Full overlay settings page: 200px rail + bento sections.
   Config edits are local until Save; theme applies immediately. */

export function Settings({ onClose, initialSection, onConfigSaved }: SettingsProps) {
  useLanguage();
  const [section, setSection] = useState<SectionId>(
    (SECTIONS.find((s) => s.id === initialSection)?.id ?? "general") as SectionId,
  );
  const [config, setConfig] = useState<KensakuConfig | null>(null);
  /* Loaded snapshot — serialized once. A JSON compare marks the save bar. */
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = config !== null && snapshot !== null && JSON.stringify(config) !== snapshot;

  useEffect(() => {
    invoke<KensakuConfig>("get_config")
      .then((cfg) => {
        setConfig(cfg);
        setSnapshot(JSON.stringify(cfg));
      })
      .catch((err) => console.error("Failed to load config:", err));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSave = async (reindex: boolean) => {
    if (!config) return;
    setSaving(true);
    try {
      await invoke("save_config", { config });
      setSnapshot(JSON.stringify(config));
      if (reindex) {
        await invoke("complete_setup", {
          watchedDirs: config.watched_dirs,
          excludedDirs: config.excluded_dirs,
          shortcut: config.shortcut,
        });
      }
      onConfigSaved();
      if (reindex) {
        onClose();
      } else {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1600);
      }
    } catch (err) {
      console.error("Save failed:", err);
      alert(t("Failed to save settings: {error}", { error: String(err) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fade-in absolute inset-0 z-40 flex bg-bg">
      <nav data-tauri-drag-region className="relative z-10 flex w-[200px] shrink-0 flex-col overflow-y-auto px-3 pb-3 pt-5">
        <p data-tauri-drag-region className="t-title px-3 pb-4 text-fg">{t("Settings")}</p>
        <div className="flex flex-col gap-0.5">
          {SECTIONS.map((s) => {
            const active = section === s.id;
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-8 w-full items-center gap-2.5 rounded-control px-2.5 text-[13px] transition-colors duration-150 ${
                  active ? "control font-medium text-fg" : "text-muted hover:text-fg"
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? "text-fg" : "text-subtle"}`} strokeWidth={1.75} />
                {t(s.label)}
              </button>
            );
          })}
        </div>
      </nav>

      <main className="surface relative z-10 m-2 ml-0 min-w-0 flex-1 overflow-hidden rounded-sheet">
        <button
          type="button"
          title={t("Close (Esc)")}
          onClick={onClose}
          className="btn btn-ghost btn-icon absolute right-4 top-4 z-20 h-8 !rounded-full"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <div className="absolute inset-0 overflow-y-auto px-6 pb-20 pt-6" style={{ scrollbarGutter: "stable" }}>
          <div className="mx-auto max-w-[640px]">
            {config ? (
              <SectionShell section={section}>{renderSection(section, config, setConfig)}</SectionShell>
            ) : (
              <ConfigSkeleton />
            )}
          </div>
        </div>

        <footer className="pointer-events-none absolute inset-x-0 bottom-5 z-10 flex justify-center">
          <div className="control pointer-events-auto flex items-center gap-2 rounded-full py-1.5 pl-4 pr-1.5">
            <span className="flex items-center gap-2 pr-2 text-[12px] text-muted">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${dirty ? "bg-warning" : "bg-success/70"}`} />
              {dirty ? t("Unsaved changes") : saved ? t("Saved") : t("Up to date")}
            </span>
            <button type="button" onClick={() => handleSave(true)} disabled={saving || !config} className="btn btn-ghost h-8 !rounded-full px-3 text-[12px]">
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t("Save & reindex")}
            </button>
            <button type="button" onClick={() => handleSave(false)} disabled={saving || !config || !dirty} className="btn btn-primary h-8 !rounded-full px-4 text-[12px]">
              {saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" strokeWidth={1.75} />}
              {saved ? t("Saved") : saving ? t("Saving") : t("Save")}
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
}

function renderSection(
  section: SectionId,
  config: KensakuConfig,
  setConfig: React.Dispatch<React.SetStateAction<KensakuConfig | null>>,
): React.ReactNode {
  switch (section) {
    case "general":
      return <GeneralSection config={config} setConfig={setConfig} />;
    case "folders":
      return <FoldersSection config={config} setConfig={setConfig} />;
    case "exclusions":
      return <ExclusionsSection config={config} setConfig={setConfig} />;
    case "search":
      return <SearchSection config={config} setConfig={setConfig} />;
    case "ai":
      return <AiSection config={config} setConfig={setConfig} />;
    case "agents":
      return <AgentsSection config={config} setConfig={setConfig} />;
    case "doctor":
      // Health groups what used to be Doctor, Stats for Nerds and Beta.
      return (
        <>
          <DoctorSection />
          <StatsForNerds />
          <BetaSection config={config} setConfig={setConfig} />
        </>
      );
    case "about":
      return <AboutSection />;
  }
}

function ConfigSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="surface h-16 animate-pulse opacity-60" />
      ))}
    </div>
  );
}

/** Wraps every section: header block first, then the cards. */
function SectionShell({ section, children }: { section: SectionId; children: React.ReactNode }) {
  const meta = SECTION_META[section];
  return (
    // Keyed by section so each switch replays a short ease-in.
    <div key={section} className="section-enter">
      <SectionHeader title={t(meta.title)} description={t(meta.description)} />
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* General                                                           */
/* ---------------------------------------------------------------- */

function GeneralSection({
  config,
  setConfig,
}: {
  config: KensakuConfig;
  setConfig: React.Dispatch<React.SetStateAction<KensakuConfig | null>>;
}) {
  const { theme, setTheme } = useTheme();
  const [capturing, setCapturing] = useState(false);

  /* null = unknown (backend rejected get_autostart) → switch stays off. */
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [autostartError, setAutostartError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<boolean>("get_autostart")
      .then((v) => {
        if (!cancelled) setAutostart(v);
      })
      .catch(() => {
        if (!cancelled) setAutostart(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Optimistic toggle: flip the switch immediately, revert on failure. */
  const toggleAutostart = async (next: boolean) => {
    if (autostart === null || autostartBusy) return;
    const prev = autostart;
    setAutostart(next);
    setAutostartError(null);
    setAutostartBusy(true);
    try {
      await invoke("set_autostart", { enabled: next });
    } catch (err) {
      setAutostart(prev);
      setAutostartError(reasonFrom(err));
    } finally {
      setAutostartBusy(false);
    }
  };

  useEffect(() => {
    if (!capturing) return;
    document.body.dataset.ksCapture = "1";
    // Modifiers accumulate across keydowns, so tapping Ctrl then K works as
    // well as holding Ctrl+K.
    const pressed = new Set<string>();
    const normalizeModifier = (key: string) => (key === "Meta" ? "Super" : key);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (e.key === "Escape") {
        setCapturing(false);
        return;
      }
      if (["Control", "Super", "Meta", "Alt", "Shift"].includes(e.key)) {
        pressed.add(normalizeModifier(e.key));
        return;
      }
      if (e.ctrlKey) pressed.add("Control");
      if (e.metaKey) pressed.add("Super");
      if (e.altKey) pressed.add("Alt");
      if (e.shiftKey) pressed.add("Shift");
      const order = ["Control", "Super", "Alt", "Shift"];
      const parts = order.filter((m) => pressed.has(m));
      const key = e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      parts.push(key);
      setConfig((c) => (c ? { ...c, shortcut: parts.join("+") } : c));
      setCapturing(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      delete document.body.dataset.ksCapture;
      window.removeEventListener("keydown", onKey);
    };
  }, [capturing, setConfig]);

  return (
    <>
      <Card title={t("Appearance")}>
        <div className="grid grid-cols-2 gap-4 p-4">
          {(["light", "dark"] as const).map((value) => (
            <ThemeSwatch
              key={value}
              value={value}
              active={theme === value}
              onSelect={() => {
                setTheme(value);
                /* Keep the app's config copy in step, or a later Save would
                   write the stale theme back over the persisted pick. */
                setConfig((c) => (c ? { ...c, theme: value } : c));
              }}
            />
          ))}
        </div>
      </Card>

      <Card title={t("Language")}>
        <Field
          label={t("Interface language")}
          description={t("Also turns on Russian text recognition in screenshots. Tray menu: after a restart.")}
        >
          <select
            value={config.language ?? getLanguageSetting()}
            onChange={(e) => {
              const value = e.target.value;
              // Applies at once, like the theme; Save keeps it.
              setLanguageSetting(value);
              setConfig((c) => (c ? { ...c, language: value } : c));
            }}
            className="field h-8 w-40 shrink-0"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.value === "system" ? t("System") : l.label}
              </option>
            ))}
          </select>
        </Field>
      </Card>

      <Card title={t("Invocation")}>
        <Field label={t("Quick shortcut")} description={t("Press it from anywhere to open search. Click, then press a combo to change it. On Linux Wayland, desktops may block global keys: bind a shortcut to the command kensaku --toggle instead.")}>
          <button
            type="button"
            onClick={() => setCapturing(true)}
            className={`flex h-8 min-w-40 items-center justify-center rounded-control border px-3 font-mono text-[12px] transition-colors duration-150 ${
              capturing
                ? "border-accent text-accent"
                : "border-line bg-accent-soft text-fg hover:border-line-strong"
            }`}
          >
            {capturing ? t("press keys…") : config.shortcut}
          </button>
        </Field>

        <Field label={t("Maximum results")} description={t("Hard ceiling per query. Lower keeps rendering instant.")}>
          <Stepper
            value={config.max_results}
            min={25}
            max={500}
            step={25}
            onChange={(v) => setConfig((c) => (c ? { ...c, max_results: v } : c))}
          />
        </Field>

        <Field
          label={t("Start at login")}
          description={
            autostart === null ? t("Unavailable on this system") : t("Launch Kensaku when you sign in.")
          }
        >
          <Switch
            checked={autostart ?? false}
            disabled={autostart === null || autostartBusy}
            onChange={toggleAutostart}
          />
        </Field>
        {autostartError && (
          <p className="break-words border-t border-line px-4 py-2 font-mono text-[11px] text-danger">
            {t("Could not update login item:")} {autostartError}
          </p>
        )}
      </Card>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* Folders                                                           */
/* ---------------------------------------------------------------- */

function FoldersSection({
  config,
  setConfig,
}: {
  config: KensakuConfig;
  setConfig: React.Dispatch<React.SetStateAction<KensakuConfig | null>>;
}) {
  const [input, setInput] = useState("");
  const { stats } = useStats(null);

  const addDir = () => {
    const v = input.trim();
    if (v && !config.watched_dirs.includes(v)) {
      setConfig((c) => (c ? { ...c, watched_dirs: [...c.watched_dirs, v] } : c));
      setInput("");
    }
  };

  const addDropped = (paths: string[]) =>
    setConfig((c) => {
      if (!c) return c;
      const fresh = paths.filter((p) => !c.watched_dirs.includes(p));
      return fresh.length ? { ...c, watched_dirs: [...c.watched_dirs, ...fresh] } : c;
    });

  return (
    <>
      <Card title={t("Watched directories")}>
        {config.watched_dirs.length === 0 && (
          <p className="px-4 py-3 text-[11px] text-subtle">{t("Nothing watched yet.")}</p>
        )}
        {config.watched_dirs.map((dir) => (
          <div
            key={dir}
            className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="truncate text-[12px] text-fg">
                {dir.split(/[\\/]/).filter(Boolean).pop() || dir}
              </p>
              <p className="truncate font-mono text-[11px] text-subtle">{dir}</p>
            </div>
            <button
              type="button"
              title={t("Stop watching {dir}", { dir })}
              onClick={() =>
                setConfig((c) =>
                  c ? { ...c, watched_dirs: c.watched_dirs.filter((d) => d !== dir) } : c,
                )
              }
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-subtle transition-colors hover:bg-accent-soft hover:text-danger"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.currentTarget.classList.add("border-accent", "text-fg");
          }}
          onDragLeave={(e) => {
            e.currentTarget.classList.remove("border-accent", "text-fg");
          }}
          onDrop={async (e) => {
            e.preventDefault();
            e.currentTarget.classList.remove("border-accent", "text-fg");
            const paths: string[] = [];
            for (const item of Array.from(e.dataTransfer.files)) {
              const p = (item as File & { path?: string }).path;
              if (p) paths.push(p);
            }
            if (paths.length === 0 && input.trim()) paths.push(input.trim());
            addDropped(paths);
          }}
          className="mx-4 my-2.5 flex h-16 items-center justify-center rounded-control border border-dashed border-line text-[11px] text-subtle transition-colors duration-150"
        >
          {t("Drop folders here to add them for watching")}
        </div>

        <div className="flex gap-1.5 border-t border-line p-3">
          <input
            type="text"
            value={input}
            placeholder="/absolute/path/to/directory"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addDir()}
            spellCheck={false}
            className="field h-8 min-w-0 flex-1 font-mono"
          />
          <button
            type="button"
            onClick={addDir}
            className="btn btn-secondary h-8 px-3 text-[12px]"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("Add")}
          </button>
        </div>
        {stats && stats.index.files > 0 && (
          <p className="border-t border-line px-4 py-2 font-mono text-[11px] text-subtle">
            {t("{files} files indexed across {dirs} folders", { files: formatComma(stats.index.files), dirs: formatComma(stats.index.dirs) })}
          </p>
        )}
      </Card>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* Exclusions                                                        */
/* ---------------------------------------------------------------- */

function ExclusionsSection({
  config,
  setConfig,
}: {
  config: KensakuConfig;
  setConfig: React.Dispatch<React.SetStateAction<KensakuConfig | null>>;
}) {
  const [dirInput, setDirInput] = useState("");
  const [extInput, setExtInput] = useState("");

  const removeDir = (d: string) =>
    setConfig((c) => (c ? { ...c, excluded_dirs: c.excluded_dirs.filter((x) => x !== d) } : c));

  return (
    <>
      <Card title={t("Presets")}>
        <div className="flex flex-wrap gap-1.5 px-4 py-3">
          {Object.keys(EXCLUSION_PRESETS).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setConfig((c) => (c ? { ...c, excluded_dirs: [...EXCLUSION_PRESETS[p]] } : c))}
              className="flex h-7 items-center rounded-full border border-line px-3 text-[12px] text-muted transition-colors duration-150 hover:border-line-strong hover:text-fg"
            >
              {t(p)}
            </button>
          ))}
          <span className="self-center text-[11px] text-subtle">{t("replaces the list below")}</span>
        </div>
      </Card>

      <Card title={t("Excluded directory names")}>
        <div className="flex flex-wrap gap-1.5 px-4 py-3">
          {config.excluded_dirs.map((d) => (
            <button
              key={d}
              type="button"
              title={t("Remove {name}", { name: d })}
              onClick={() => removeDir(d)}
              className="group flex h-6 items-center gap-1.5 rounded-full bg-accent-soft px-2.5 font-mono text-[11px] text-muted transition-colors hover:text-danger"
            >
              {d}
              <X className="h-3 w-3 opacity-50 group-hover:opacity-100" />
            </button>
          ))}
        </div>
        <div className="border-t border-line p-3">
          <input
            value={dirInput}
            placeholder={t("directory name, e.g. bundle_cache — Enter to add")}
            onChange={(e) => setDirInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && dirInput.trim()) {
                const v = dirInput.trim();
                setConfig((c) =>
                  c && !c.excluded_dirs.includes(v) ? { ...c, excluded_dirs: [...c.excluded_dirs, v] } : c,
                );
                setDirInput("");
              }
            }}
            spellCheck={false}
            className="field h-8 w-full font-mono"
          />
        </div>
      </Card>

      <Card title={t("Excluded extensions")}>
        <div className="flex flex-wrap gap-1.5 px-4 py-3">
          {config.excluded_extensions.map((x) => (
            <button
              key={x}
              type="button"
              title={t("Remove {name}", { name: x })}
              onClick={() =>
                setConfig((c) =>
                  c ? { ...c, excluded_extensions: c.excluded_extensions.filter((e) => e !== x) } : c,
                )
              }
              className="group flex h-6 items-center gap-1.5 rounded-full bg-accent-soft px-2.5 font-mono text-[11px] text-muted transition-colors hover:text-danger"
            >
              {x}
              <X className="h-3 w-3 opacity-50 group-hover:opacity-100" />
            </button>
          ))}
        </div>
        <div className="border-t border-line p-3">
          <input
            value={extInput}
            placeholder={t("extension, e.g. .bin — Enter to add")}
            onChange={(e) => setExtInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && extInput.trim()) {
                const v = extInput.trim();
                setConfig((c) =>
                  c && !c.excluded_extensions.includes(v)
                    ? { ...c, excluded_extensions: [...c.excluded_extensions, v] }
                    : c,
                );
                setExtInput("");
              }
            }}
            spellCheck={false}
            className="field h-8 w-full font-mono"
          />
        </div>
      </Card>

      <Card title={t("Hidden files")}>
        <Field
          label={t("Skip hidden files")}
          description={t("Skip files and folders whose name starts with a dot. Turn off to index hidden files.")}
        >
          <Switch
            checked={config.skip_hidden ?? true}
            onChange={(v) => setConfig((c) => (c ? { ...c, skip_hidden: v } : c))}
          />
        </Field>
      </Card>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* Search                                                            */
/* ---------------------------------------------------------------- */

const CHEATSHEET: [string, string][] = [
  ["type:image,dir,doc,code,media", "Class of file"],
  ["ext:png", "Restrict by extension"],
  ['in:"~/Projects"', "Within folder, recursively"],
  ["modified:<7d", "Changed recently"],
  ["size:>2mb", "Size threshold"],
  ["-ext:log", "Negate any filter"],
  [">reindex", "Rebuild the full index"],
  [">doctor", "Health diagnostics"],
  [">model", "Embedding model status"],
  [">add folder", "Register a watch path"],
];

function SearchSection({
  config,
  setConfig,
}: {
  config: KensakuConfig;
  setConfig: React.Dispatch<React.SetStateAction<KensakuConfig | null>>;
}) {
  return (
    <>
      <Card title={t("Results")}>
        <Field
          label={t("Show thumbnails")}
          description={t("Previews for images and PDFs (first page). PDFs need poppler, e.g. brew install poppler. Without it, PDFs show their file icon. Turn off to skip previews.")}
        >
          <Switch
            checked={config.show_thumbnails ?? true}
            onChange={(v) => setConfig((c) => (c ? { ...c, show_thumbnails: v } : c))}
          />
        </Field>
        <Field
          label={t("Result layout")}
          description={t("Grid shows image cards. List shows one file per row, with size and age.")}
        >
          <div role="radiogroup" aria-label={t("Result layout")} className="pill-group">
            {(["grid", "list"] as const).map((v) => {
              const active = (config.results_view ?? "grid") === v;
              return (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setConfig((c) => (c ? { ...c, results_view: v } : c))}
                  className="pill capitalize"
                >
                  {t(v === "grid" ? "Grid" : "List")}
                </button>
              );
            })}
          </div>
        </Field>
      </Card>

      <Card title={t("Ranking")}>
        <Field
          label={t("Semantic search")}
          description={t("Static embeddings, ~0.1 ms per query, fused with BM25 via RRF.")}
        >
          <Switch
            checked={config.semantic_enabled ?? true}
            onChange={(v) => setConfig((c) => (c ? { ...c, semantic_enabled: v } : c))}
          />
        </Field>
        <OcrField config={config} setConfig={setConfig} />
      </Card>

      <Card title={t("Background indexing")}>
        <Field
          label={t("Crawl mode")}
          description={t("Balanced uses idle I/O and CPU priority. Eco also paces work on battery. Full speed keeps normal priority.")}
        >
          <select
            value={config.crawl_mode ?? "full"}
            onChange={(e) =>
              setConfig((c) =>
                c
                  ? {
                      ...c,
                      crawl_mode: e.target.value as
                        | "full"
                        | "balanced"
                        | "eco",
                    }
                  : c,
              )
            }
            className="field h-8"
          >
            <option value="full">{t("Full speed")}</option>
            <option value="balanced">{t("Balanced")}</option>
            <option value="eco">{t("Eco")}</option>
          </select>
        </Field>
        <Field
          label={t("Pause indexing")}
          description={t("Stops reading new files. Renames and deletes still update the index while paused.")}
        >
          <Switch
            checked={config.pause_indexing ?? false}
            onChange={(v) =>
              setConfig((c) => (c ? { ...c, pause_indexing: v } : c))
            }
          />
        </Field>
      </Card>

      <Card title={t("Aliases")}>
        <div className="space-y-2 p-4">
          <p className="text-[12px] leading-[18px] text-muted">
            {t("Personal vocabulary: typing the term also matches any of its expansions (case-insensitive, OR semantics).")}
          </p>
          {(config.aliases ?? []).map((alias, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={alias.term}
                placeholder="term"
                onChange={(e) =>
                  setConfig((c) => {
                    if (!c) return c;
                    const aliases = [...(c.aliases ?? [])];
                    aliases[i] = { ...aliases[i], term: e.target.value };
                    return { ...c, aliases };
                  })
                }
                className="field h-8 w-28 shrink-0 font-mono"
              />
              <span className="text-subtle">→</span>
              <input
                type="text"
                value={alias.expansions.join(", ")}
                placeholder="cv, curriculum"
                onChange={(e) =>
                  setConfig((c) => {
                    if (!c) return c;
                    const aliases = [...(c.aliases ?? [])];
                    aliases[i] = {
                      ...aliases[i],
                      expansions: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                    };
                    return { ...c, aliases };
                  })
                }
                className="field h-8 min-w-0 flex-1 font-mono"
              />
              <button
                type="button"
                title={t("Remove alias")}
                onClick={() =>
                  setConfig((c) =>
                    c ? { ...c, aliases: (c.aliases ?? []).filter((_, j) => j !== i) } : c,
                  )
                }
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-subtle transition-colors hover:bg-accent-soft hover:text-danger"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setConfig((c) =>
                c ? { ...c, aliases: [...(c.aliases ?? []), { term: "", expansions: [] }] } : c,
              )
            }
            className="flex h-7 items-center gap-1 rounded-control border border-line px-2.5 text-[12px] text-muted transition-colors hover:border-line-strong hover:text-fg"
          >
            <Plus className="h-3 w-3" /> {t("Add alias")}
          </button>
        </div>
      </Card>

      <Card title={t("Query language")}>
        <div className="grid grid-cols-2 gap-x-8 px-4 py-2.5">
          {CHEATSHEET.map(([token, desc], idx) => (
            <div
              key={token}
              className={`flex h-8 items-center justify-between gap-3 ${
                idx < CHEATSHEET.length - 2 ? "border-b border-line/70" : ""
              }`}
            >
              <code className="shrink-0 whitespace-nowrap text-fg">{token}</code>
              <span className="truncate text-right text-[11px] text-subtle">{t(desc)}</span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* AI & Semantic                                                     */
/* ---------------------------------------------------------------- */

function AiSection({ config, setConfig }: { config: KensakuConfig; setConfig: React.Dispatch<React.SetStateAction<KensakuConfig | null>> }) {
  const { stats, live } = useStats(2000);
  const [reembedState, setReembedState] = useState<"idle" | "pending">("idle");

  const modelId =
    stats?.runtime?.model_id || config.semantic_model || t("reported when the backend lands");
  const queueDepth = stats?.ingestion?.embed_queue_depth ?? 0;

  const reembed = async () => {
    setReembedState("pending");
    try {
      await invoke("reembed_all");
    } catch {
      console.warn("reembed_all not available yet");
    }
    window.setTimeout(() => setReembedState("idle"), 1500);
  };

  return (
    <>
      <MultilingualModelCard config={config} setConfig={setConfig} />

      <Card title={t("Embedding model")}>
        <Field label={t("Model")} description={t("Static embeddings — no GPU, no network.")}>
          <span className="max-w-48 truncate font-mono text-[11px] text-fg">{modelId}</span>
        </Field>
        <Field label={t("Dimensions")} description={t("Reported by the model manifest.")}>
          <span className="font-mono text-[11px] text-muted">{live ? "—" : "—"}</span>
        </Field>
        <Field label={t("Vector tier on disk")} description={t("Embedding vectors stored inside metadata.db.")}>
          <span className="font-mono text-[11px] text-muted">{formatBytes(stats?.index?.vector_bytes ?? 0)}</span>
        </Field>
        <Field label={t("Readiness")} description={t("Units searchable in RRF fusion right now.")}>
          <span
            className={`font-mono text-[11px] ${
              stats?.runtime?.semantic_ready ? "text-success" : "text-warning"
            }`}
          >
            {stats?.runtime?.semantic_ready ? t("ready") : live ? t("warming up") : t("pending backend")}
          </span>
        </Field>
      </Card>

      <Card title={t("Embedding table")}>
        <Field
          label={t("Use f32 table")}
          description={t("Keep the static embedding table in f32 instead of the compact i8 table. For quality comparisons only.")}
        >
          <Switch
            checked={config.semantic_f32_table ?? false}
            onChange={(v) => setConfig((c) => (c ? { ...c, semantic_f32_table: v } : c))}
          />
        </Field>
      </Card>

      <Card title={t("Embed queue")}>
        <div className="space-y-2 p-4">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted">{t("Queued units")}</span>
            <span className="font-mono text-fg">{formatComma(queueDepth)}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-accent-soft">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${queueDepth > 0 ? Math.max(4, Math.min(100, queueDepth)) : 0}%` }}
            />
          </div>
          <div className="flex items-center justify-between pt-1">
            <span className="font-mono text-[11px] text-subtle">
              {live ? t("polled every 2 s") : t("get_stats pending on the backend")}
            </span>
            <button
              type="button"
              onClick={reembed}
              className="flex h-7 items-center gap-1.5 rounded-control border border-line px-2.5 text-[11px] text-fg transition-colors hover:border-line-strong"
            >
              <RefreshCw className="h-3 w-3" />
              {reembedState === "pending" ? t("Queued…") : t("Re-embed all")}
            </button>
          </div>
        </div>
      </Card>

      <ModelFilesCard />
    </>
  );
}

/* ---------------------------------------------------------------- */
/* Agents                                                            */
/* ---------------------------------------------------------------- */

const MCP_CONFIG = `{
  "mcpServers": {
    "kensaku": { "command": "kensaku-cli", "args": ["mcp"] }
  }
}`;

const CLI_EXAMPLES = [
  'kensaku-cli search "docker error" --json --limit 10',
  'kensaku-cli search "type:pdf invoice" --path ~/Documents',
  'kensaku-cli state --json',
];

const MCP_TOOLS: [string, string][] = [
  ["health_check", "daemon · db · index · model"],
  ["search", "query, page_size ≤ 50, cursor, mode, filters"],
  ["read_snippet", "path, query?, max_tokens ≤ 1024"],
  ["index_state", "counts, phase, queue, freshness"],
  ["regex_search", "bounded pattern, page_size, cursor"],
  ["find_symbol", "symbol name, language?, page_size ≤ 50"],
  ["reindex", "opt-in only; requires daemon"],
];

/** One copyable mono row — command text with a trailing copy button. */
function CopyRow({
  text,
  copied,
  onCopied,
}: {
  text: string;
  copied: boolean;
  onCopied: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-line/60 px-3 py-2 last:border-b-0">
      <code className="no-scrollbar min-w-0 flex-1 select-text overflow-x-auto whitespace-nowrap font-mono text-[11px] leading-5 text-fg">
        {text}
      </code>
      <button
        type="button"
        title={t("Copy")}
        onClick={() => {
          navigator.clipboard.writeText(text);
          onCopied();
        }}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-subtle transition-colors hover:bg-elevated hover:text-fg"
      >
        {copied ? <Check className="h-3 w-3 text-accent" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Beta                                                              */
/* ---------------------------------------------------------------- */

function BetaSection({
  config,
  setConfig,
}: {
  config: KensakuConfig;
  setConfig: React.Dispatch<React.SetStateAction<KensakuConfig | null>>;
}) {
  void config;
  void setConfig;
  return (
    <Card title={t("Visual search")}>
      <div className="flex items-center justify-between gap-4 px-4 py-3 opacity-50">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-fg">{t("Visual search")}</p>
          <p className="text-[12px] leading-[18px] text-muted">{t("Find images by what they show. Coming later.")}</p>
        </div>
        <span className="shrink-0 rounded-small border border-line px-2 py-0.5 text-[12px] text-muted">{t("Coming later")}</span>
      </div>
    </Card>
  );
}

function AgentConnectCard() {
  const [statuses, setStatuses] = useState<ClientStatus[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setStatuses(await invoke<ClientStatus[]>("agent_connect_status"));
    } catch {
      setStatuses([]);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const install = async (id: string) => {
    setBusy(id);
    setNotice(null);
    try {
      const outcome = await invoke<InstallOutcome>("agent_connect_install", { client: id });
      setNotice(outcome.message);
    } catch (err) {
      setNotice(reasonFrom(err));
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const statusLabel = (status: ClientStatus): string => {
    if (status.configured) return t("Connected");
    if (status.installed) return t("Found");
    if (status.config_path) return t("Not set up");
    return t("Not detected");
  };

  return (
    <Card title={t("One-click connect")}>
      <div>
        {statuses.length === 0 && (
          <p className="px-4 py-3 text-[12px] text-muted">
            {t("Detecting installed MCP clients…")}
          </p>
        )}
        {statuses.map((status) => (
          <div
            key={status.id}
            className="flex items-center justify-between gap-4 border-b border-line/60 px-4 py-2.5 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-fg">{status.name}</p>
              <p className="truncate font-mono text-[11px] text-subtle">
                {status.config_path ?? t("config location not found")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${
                  status.configured
                    ? "bg-accent-soft text-accent"
                    : "border border-line text-subtle"
                }`}
              >
                {statusLabel(status)}
              </span>
              {!status.configured && (
                <button
                  type="button"
                  disabled={busy === status.id || !status.config_path}
                  onClick={() => void install(status.id)}
                  className="flex h-6 items-center rounded-control border border-line px-2 text-[11px] text-fg transition-colors hover:border-line-strong disabled:opacity-50"
                >
                  {busy === status.id ? t("Adding…") : t("Add Kensaku")}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {notice && (
        <p className="border-t border-line px-4 py-2 text-[12px] text-muted">{notice}</p>
      )}
      <p className="border-t border-line px-4 py-2.5 text-[12px] leading-[18px] text-muted">
        {t("Adding Kensaku merges one entry into the client's config file (a backup is left next to it). Restart the client afterwards. Manual JSON stays available above.")}
      </p>
    </Card>
  );
}

function AgentsSection({
  config,
  setConfig,
}: {
  config: KensakuConfig;
  setConfig: React.Dispatch<React.SetStateAction<KensakuConfig | null>>;
}) {
  const [configCopied, setConfigCopied] = useState(false);
  const [copiedRow, setCopiedRow] = useState<string | null>(null);

  const flashRow = (text: string) => {
    setCopiedRow(text);
    window.setTimeout(() => setCopiedRow((r) => (r === text ? null : r)), 1500);
  };

  return (
    <>
      <p className="pb-3 text-[12px] leading-[18px] text-muted">
        {t("Let agents search this index. Read-only by default, local, no network.")}
      </p>

      <AgentConnectCard />

      {/* MCP */}
      <Card title={t("Model Context Protocol")}>
        <div className="px-4 py-3">
          <p className="text-[12px] leading-[18px] text-muted">
            {t("Point Claude Code, Cursor, or any MCP client at the")}{" "}
            <code className="font-mono text-[11px] text-fg">kensaku-cli</code>{" "}
            {t("binary. It reuses this app's data directory: it attaches to the daemon when one is running, otherwise it reads the index read-only.")}
          </p>
        </div>
        <div className="relative border-t border-line bg-accent-soft p-3 pr-10">
          <pre className="select-text whitespace-pre-wrap break-all font-mono text-[11px] leading-[18px] text-muted">
            {MCP_CONFIG}
          </pre>
          <button
            type="button"
            title={t("Copy config JSON")}
            onClick={() => {
              navigator.clipboard.writeText(MCP_CONFIG);
              setConfigCopied(true);
              window.setTimeout(() => setConfigCopied(false), 1500);
            }}
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded text-subtle transition-colors hover:bg-elevated hover:text-fg"
          >
            {configCopied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
        <p className="border-t border-line px-4 py-2.5 text-[12px] leading-[18px] text-muted">
          {t("If")} <code className="font-mono text-[11px] text-fg">kensaku-cli</code>{" "}
          {t("isn't on your PATH, use the absolute path to the binary —")}{" "}
          <code className="font-mono text-[11px] text-fg">~/.cargo/bin/kensaku-cli</code> {t("or")}{" "}
          <code className="font-mono text-[11px] text-fg">target/release/kensaku-cli</code>.
        </p>
      </Card>

      {/* CLI */}
      <Card title={t("Command line")}>
        <div>
          {CLI_EXAMPLES.map((cmd) => (
            <CopyRow
              key={cmd}
              text={cmd}
              copied={copiedRow === cmd}
              onCopied={() => flashRow(cmd)}
            />
          ))}
        </div>
        <p className="border-t border-line px-4 py-2.5 text-[12px] leading-[18px] text-muted">
          {t("When the daemon is running the MCP server forwards queries to it and never opens the database itself. Without a daemon it falls back to the read-only local index.")}
        </p>
      </Card>

      {/* Tools */}
      <Card title={t("MCP tools")}>
        <div className="px-4 py-1.5">
          {MCP_TOOLS.map(([name, args]) => (
            <div
              key={name}
              className="flex items-baseline justify-between gap-4 border-b border-line/60 py-2.5 last:border-b-0"
            >
              <code className="shrink-0 whitespace-nowrap font-mono text-[11px] font-medium text-fg">
                {name}
              </code>
              <span className="min-w-0 truncate text-right font-mono text-[11px] text-subtle">
                {args}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* Write access */}
      <Card title={t("Write access")}>
        <Field
          label={t("Allow MCP reindex")}
          description={t("Adds an opt-in reindex tool for agents. Requires the daemon; restart MCP clients after changing this.")}
        >
          <Switch
            checked={config.mcp_allow_reindex ?? false}
            onChange={(v) =>
              setConfig((c) => (c ? { ...c, mcp_allow_reindex: v } : c))
            }
          />
        </Field>
      </Card>

      {/* Security */}
      <Card title={t("Security")}>
        <p className="p-4 text-[12px] leading-[18px] text-muted">
          {t("Read-only by default.")} <code className="font-mono text-[11px] text-fg">reindex</code>{" "}
          {t("is off unless enabled above. No shell and no network. Honors your watched folders, exclusions and the daemon's opt-in check.")}
        </p>
      </Card>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* About + Danger zone                                               */
/* ---------------------------------------------------------------- */

const CONFIRM_WORD = "RESET";

/** Best-effort: the backend may not ship get_reset_pending yet. */
function useResetPending(): boolean {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    invoke<boolean>("get_reset_pending")
      .then(setPending)
      .catch(() => setPending(false));
  }, []);
  return pending;
}

/** Tracks keys the app persists in localStorage, so a reset starts clean. */
function clearClientState() {
  try {
    for (const key of ["kensaku.theme", "kensaku.view", "kensaku.preview", "kensaku.language"]) {
      localStorage.removeItem(key);
    }
  } catch {
    /* storage unavailable — the backend reset owns the rest */
  }
}

/**
 * Type-RESET confirmation. Traps focus, Esc cancels, Enter submits only
 * when the word matches exactly. On reject the error surfaces inline and
 * nothing is cleared; on resolve the app is expected to restart.
 */
function ResetDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const matches = text === CONFIRM_WORD;

  /* Window-level capture so Esc/Tab are handled before the settings
     overlay's own Escape-to-close listener sees them. */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>("input, button:not([disabled])"));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const list = focusables();
        if (list.length === 0) return;
        const first = list[0];
        const last = list[list.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    const input = dialog.querySelector<HTMLInputElement>("input");
    input?.focus();
    input?.select();
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const submit = async () => {
    if (!matches || running) return;
    setRunning(true);
    setError(null);
    try {
      await invoke("reset_all", { confirm: CONFIRM_WORD });
      // Resolves → the app restarts. Clear client-only view state so a
      // relaunched window comes up fresh; show nothing.
      clearClientState();
      onClose();
    } catch (err) {
      // Rejects → keep everything, surface the reason inline.
      console.error("reset_all failed:", err);
      setError(String(err));
      setRunning(false);
    }
  };

  return (
    <div
      className="fade-in absolute inset-0 z-50 flex items-center justify-center p-6 backdrop-blur-[2px]"
      style={{ background: "var(--scrim)" }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("Reset Kensaku")}
        className="overlay-in elevated w-full max-w-[400px] overflow-hidden border-danger/30"
      >
        <div className="flex items-center justify-between border-b border-line bg-accent-soft px-4 py-2.5">
          <p className="text-[11px] font-medium text-danger">{t("Danger zone")}</p>
          <button
            type="button"
            title={t("Cancel (Esc)")}
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-elevated hover:text-fg"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="p-4">
            <p className="text-[13px] font-semibold text-fg">{t("Reset Kensaku")}</p>
            <p className="pt-0.5 text-[12px] leading-[18px] text-muted">
              {t("This will delete your index and settings and restart Kensaku.")}
            </p>
          </div>

          <div className="px-4 pb-4">
            <label htmlFor="reset-confirm" className="eyebrow pb-1.5 block">
              {t("Type")} <span className="font-mono normal-case text-danger">RESET</span> {t("to confirm")}
            </label>
            <input
              id="reset-confirm"
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className={`h-9 w-full rounded-control border bg-accent-soft px-2.5 font-mono text-[12px] text-fg outline-none transition-colors focus:border-accent ${
                text && !matches ? "border-danger/50" : "border-line"
              }`}
            />
            {error && (
              <p className="break-words pt-2 font-mono text-[11px] text-danger">{error}</p>
            )}
          </div>

          <div className="flex items-center justify-end gap-1.5 border-t border-line bg-accent-soft px-3 py-2.5">
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 items-center rounded-control border border-line px-3 text-[12px] text-fg transition-colors hover:border-line-strong"
            >
              {t("Cancel")}
            </button>
            <button
              type="submit"
              disabled={!matches || running}
              className="flex h-8 items-center rounded-control bg-danger px-3 text-[12px] font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {running ? t("Resetting…") : t("Reset and restart")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AboutSection() {
  const resetPending = useResetPending();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [version, setVersion] = useState<string>("…");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch(() => {
        if (!cancelled) setVersion(t("unknown"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const checkForUpdates = async () => {
    setChecking(true);
    try {
      await openUrl("https://github.com/yjid/kensaku/releases/latest");
    } catch {
      /* fall back to nothing; the link is also in the docs */
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      {resetPending && (
        <div className="flex items-center gap-2 rounded-control border border-warning/40 bg-elevated px-4 py-2.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
          <p className="text-[12px] text-muted">{t("A reset is pending and will finish on next launch.")}</p>
        </div>
      )}
      {resetPending && <div className="h-3" />}

      <Card title={t("Version")}>
        <div className="flex items-center justify-between p-4">
          <div>
            <p className="text-[15px] font-semibold text-fg">
              Kensaku <span className="font-normal text-muted">検索</span>
            </p>
            <p className="font-mono text-[11px] text-subtle">{version}</p>
            <p className="mt-1 text-[11px] text-subtle">
              {t("Auto-update isn't wired up yet — updates are manual.")}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {["Rust", "Tauri 2", "MIT"].map((b) => (
              <span
                key={b}
                className="rounded-full border border-line px-2.5 py-1 font-mono text-[11px] text-muted"
              >
                {b}
              </span>
            ))}
          </div>
        </div>
        <div className="border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={checkForUpdates}
            disabled={checking}
            className="btn btn-secondary h-8 !rounded-control"
          >
            {checking ? t("Opening…") : t("Check for updates")}
          </button>
          <span className="ml-3 text-[11px] text-subtle">
            {t("Opens the latest release page in your browser.")}
          </span>
        </div>
      </Card>

      <Card title={t("How to use Kensaku")}>
        <div className="space-y-2 p-4 text-[12px] leading-[18px] text-muted">
          <p className="text-fg">{t("A few simple tricks make search feel instant:")}</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><b>Tab</b> {t("shows or hides the details pane next to results.")}</li>
            <li><b>{t("Aliases")}</b> {t("let a word like “resume” also find “cv” and “curriculum”.")}</li>
            <li><b>{t("Filters")}</b> {t("such as")} <code className="font-mono text-[11px] text-fg">type:pdf</code>, <code className="font-mono text-[11px] text-fg">ext:png</code>, <code className="font-mono text-[11px] text-fg">in:~/Projects</code>, <code className="font-mono text-[11px] text-fg">modified:&lt;7d</code> {t("narrow results.")}</li>
            <li><b>/</b> {t("opens the command menu for quick actions like")} <code className="font-mono text-[11px] text-fg">/dupes</code>, <code className="font-mono text-[11px] text-fg">/doctor</code>, <code className="font-mono text-[11px] text-fg">/settings</code>.</li>
            <li><b>@</b> {t("mentions a folder to search inside it.")}</li>
            <li><b>{t("Sort")}</b> {t("and")} <b>{t("saved searches")}</b> {t("keep your best queries one click away.")}</li>
            <li><b>{t("Pin")}</b> {t("important files so they stay on the home screen.")}</li>
            <li><b>OCR</b> {t("reads text inside images and screenshots.")}</li>
            <li>{t("Plain Russian works:")} <code className="font-mono text-[11px] text-fg">скриншоты за прошлую неделю</code>, <code className="font-mono text-[11px] text-fg">большие видео в загрузках</code>.</li>
          </ul>
          <p>{t("Everything stays on your computer. Nothing is sent anywhere.")}</p>
        </div>
      </Card>

      <Card title={t("Design thesis")}>
        <div className="p-4 text-center">
          <p className="font-serif text-[15px] italic leading-[18px] text-muted">
            {t("“A warm, local, read-only index of your machine that answers in under 15 ms — for you, and for every agent you use.”")}
          </p>
        </div>
      </Card>

      <Card title={t("Setup")}>
        <div className="flex items-center justify-between gap-4 p-4">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-fg">{t("Run setup again")}</p>
            <p className="line-clamp-2 pt-0.5 text-[12px] leading-[18px] text-muted">
              {t("Re-run the guided first-run flow (folders, preferences, optional packs, first scan). Your index and config are preserved; setup markers reset.")}
            </p>
          </div>
          <button
            type="button"
            onClick={async () => {
              try {
                await invoke("run_setup_again");
                window.location.reload();
              } catch (e) {
                console.error(e);
              }
            }}
            className="h-8 shrink-0 rounded-control border border-line px-3 text-[11px] font-medium text-fg transition-colors hover:border-line-strong"
          >
            {t("Run setup again…")}
          </button>
        </div>
      </Card>

      {/* Danger zone — visually distinct but calm: danger hairline, no fills. */}
      <div>
        <p className="pb-2 text-[11px] font-medium text-danger">
          {t("Danger zone")}
        </p>
        <div className="overflow-hidden rounded-panel border border-danger/30 bg-elevated">
          <div className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-fg">{t("Reset Kensaku")}</p>
              <p className="line-clamp-2 pt-0.5 text-[12px] leading-[18px] text-muted">
                {t("Deletes the index, metadata database, downloaded models, and settings. This cannot be undone.")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="h-8 shrink-0 rounded-control border border-danger/40 px-3 text-[11px] font-medium text-danger transition-colors hover:bg-danger/10"
            >
              {t("Reset everything…")}
            </button>
          </div>
        </div>
      </div>

      {confirmOpen && <ResetDialog onClose={() => setConfirmOpen(false)} />}
    </>
  );
}

/* A tiny rendering of the app in each finish: field, rule, three tiles.
   Colors are the real tokens, scoped by data-theme on the swatch. */
function ThemeSwatch({ value, active, onSelect }: { value: "light" | "dark"; active: boolean; onSelect: () => void }) {
  const label = { light: t("Light"), dark: t("Dark") }[value];
  return (
    <button type="button" onClick={onSelect} aria-pressed={active} className="group flex flex-col gap-2.5 text-left outline-none">
      <span
        data-theme={value}
        className={`relative block aspect-[16/10] w-full overflow-hidden rounded-panel bg-bg transition-[outline-color,transform] duration-200 group-hover:-translate-y-0.5 ${
          active ? "outline-2 outline-offset-[3px] outline-ink" : "outline-0"
        }`}
        style={{ outlineStyle: active ? "solid" : "none", boxShadow: "inset 0 0 0 1px var(--border)" }}
      >
        <span className="absolute bottom-3 left-3 right-3 top-9 grid grid-cols-3 gap-1.5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span
              key={i}
              className="block rounded-small"
              style={{
                background: i % 3 === 1 ? "var(--fg-subtle)" : "var(--bg-elevated)",
                opacity: i % 3 === 1 ? 0.5 : 1,
                boxShadow: "var(--panel-edge)",
              }}
            />
          ))}
        </span>
        <span className="control absolute left-3 right-3 top-2.5 flex h-5 items-center rounded-full px-2">
          <span className="h-1 w-1/3 rounded-full bg-fg opacity-70" />
        </span>
      </span>
      <span className={`px-0.5 text-[13px] ${active ? "font-medium text-fg" : "text-muted"}`}>{label}</span>
    </button>
  );
}
