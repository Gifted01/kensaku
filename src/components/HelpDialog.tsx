import { useEffect } from "react";
import { X } from "lucide-react";

const KEYS: [string, string][] = [
  ["Alt+Space", "show or hide the window"],
  ["↑ ↓", "move into and through results"],
  ["← →", "move within a row, once you're in the results"],
  ["Space", "preview, once you're in the results"],
  ["⌘/Ctrl+Y", "preview, from anywhere"],
  ["Enter", "open selected file"],
  ["Shift+Enter", "show in folder"],
  ["⌘/Ctrl+C", "copy the selected path (unless text is selected)"],
  ["⌘/Ctrl+I", "details for selected file"],
  ["⌘/Ctrl+,", "settings"],
  ["?", "this sheet"],
  ["Esc", "close dialog, clear search, then hide"],
];

const FILTERS: [string, string][] = [
  ["type:pdf", "category or extension"],
  ["ext:rs", "exact extension"],
  ["in:~/Projects", "scope to a folder"],
  ["path:src", "substring match on path"],
  ["modified:7d", "changed within 7 days (1h, 30d, 7d..30d)"],
  ["size:>2mb", "size range (kb, mb, gb)"],
  ["is:image, is:dir", "category aliases"],
  ["lang:rust", "language family of extension"],
  ["name:config", "match filename only"],
  ["content:timeout", "match file contents only"],
  ["re:\"fn \\\\w+\"", "regular expression"],
  ['"last Tuesday"', "time travel filter"],
  ["mouse near[5] button", "terms within 5 words"],
];

export function HelpDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fade-in fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6 backdrop-blur-[6px]">
      <div className="elevated overlay-in max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-sheet p-6">
        <div className="flex items-center justify-between pb-3">
          <h2 className="t-title text-fg">How to search</h2>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon h-8 !rounded-full"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <section className="pb-4">
          <h3 className="t-meta pb-2 pt-4 text-subtle">Keyboard</h3>
          <table className="w-full">
            <tbody>
              {KEYS.map(([k, v]) => (
                <tr key={k} className="border-t border-line">
                  <td className="t-meta py-2 pr-6 text-fg">{k}</td>
                  <td className="py-2 text-[13px] text-muted">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h3 className="t-meta pb-2 pt-4 text-subtle">Filters</h3>
          <table className="w-full">
            <tbody>
              {FILTERS.map(([k, v]) => (
                <tr key={k} className="border-t border-line">
                  <td className="t-meta py-2 pr-6 text-fg">{k}</td>
                  <td className="py-2 text-[13px] text-muted">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
