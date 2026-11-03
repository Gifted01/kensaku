# Changelog

All notable changes to Kensaku. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added
- Russian interface: every screen, the setup wizard and the tray menu. The
  language follows the system or is picked in Settings → General (`language`
  in `config.json`). Strings are wrapped in `t()` with English as the key;
  `node tools/check-i18n.mjs` reports untranslated strings, so another
  language (#70) only needs a dictionary.
- Russian morphology in full-text search: Cyrillic words are indexed and
  queried by their Snowball stem (`договоры` finds `договора`), `ё` = `е`.
  Content schema v4 rebuilds the index once.
- Natural-language queries in Russian: dates, types, sizes, sort words and
  standard folders (`скриншоты за прошлую неделю`, `самые большие видео в
  загрузках`).
- Optional multilingual meaning search: `potion-multilingual-128M` (101
  languages) with a built-in HuggingFace tokenizer (Unigram/SentencePiece,
  Metaspace, WordPiece), verified against `tokenizers` 0.23.
- Cyrillic OCR: Tesseract downloads `rus.traineddata` and runs `rus+eng` on
  Cyrillic systems; Indra OCR becomes the default engine there.

### Fixed
- Filename prefilter folded case only for ASCII, so a lowercase Cyrillic
  query skipped capitalized names (`договор` missed `Договор.pdf`).
- `presentations` / `slides` / `spreadsheets` mapped to `type:doc`, which
  excludes `.pptx` and `.xlsx`; they now map to `type:presentation` and
  `type:sheet`.
- Windows: Tesseract received non-ANSI paths (Cyrillic file or user names on
  an English Windows) as `?`; such paths now use 8.3 short names or stdin.
- PP-OCRv6 was documented as reading Cyrillic; its dictionary has none.
- Model checksums are streamed instead of reading the whole file into memory.
- Interpretation chips in the Russian interface showed half-translated
  labels (`Изменён: 7 days (последний)`). Time chips now carry one English
  label whatever the query language (`Modified: last Friday`,
  `Modified: 3 days ago`) and the UI translates whole labels first.
- Regex queries (`re:`, MCP `regex_search`) missed inflected Russian words:
  the main fields hold stems. A small `word_forms` side field keeps the
  forms as written; content schema v5 rebuilds the index once.
- Natural-language reading turned ordinary words into filters
  (`журнал учёта`, `документация`, `план на месяц`, `Большой театр`), and a
  filter that matched nothing hid the files the words alone would find.
  Russian rules now use explicit word forms; dates are read before sort
  words (`за последнюю неделю` is a window, not "newest"); quoted words are
  never interpreted (`"last week" notes`); when the interpreted query finds
  nothing, the words as typed are searched instead, with a note. Dismissing
  a chip keeps its words, quoted, instead of deleting them.

## [1.0.12] — 2026-11-03

### Added
- `mouse near[5] button`: the `near[x]` proximity operator matches files
  where the terms sit within `x` words of each other. Chains
  (`a near[3] b near[2] c`) and the `near:5` filter form work too; the
  fuzzy, semantic and visual tiers are skipped for such queries because
  word distance is a lexical constraint embeddings cannot honor. Distances
  are safely clamped to 100.
- The data directory is overridable: `KENSAKU_DATA_DIR` (tests, Nix /
  Flatpak-style packaging) has highest precedence, then a `portable` or
  `kensaku.portable` marker file next to the executable keeps everything
  in `<exe_dir>/data` (the Windows portable build is now self-contained),
  before the platform default (`~/.config/kensaku`, `%APPDATA%\kensaku`,
  …). The metadata database no longer hardcodes one location and follows
  the same resolution as every other data path (see `docs/CONFIG.md`).
- Multilingual and format documentation (`docs/LANGUAGES.md`): detailed
  analysis of CJK unigram + bigram segmentation, 50+ programming and data
  formats, and multi-script OCR engine routing.

### Fixed
- macOS permissions (#73): bundled `Info.plist` with explicit TCC privacy
  usage descriptions (`NSDocumentsFolderUsageDescription`,
  `NSDesktopFolderUsageDescription`, etc.) and ensured child preview
  processes on macOS never receive raw file paths, preventing repeated
  permission prompt loops on macOS Sequoia / Darwin 24.
- Theme first-paint flicker (#72): resolves stored or system theme
  preference before initial paint, eliminating a dark flash on light OS themes.
- Office document extraction: decodes XML entity references (`&amp;`, `&lt;`,
  `&gt;`, `&quot;`, `&apos;`) in DOCX, PPTX, XLSX, EPUB, and ODT files.
- Excel shared strings: accumulates text across all `<t>` tags within a cell
  instead of only keeping the last one.
- PDF single-page extraction: safely caps extraction budget at valid UTF-8
  character boundaries.
- Ignore engine: merges rules when `.gitignore` and `.kensakuignore` or
  `.cursorignore` coexist in the same directory rather than overwriting.
- Windows portable release packaging (#68): automated CI packaging now
  ships `kensaku-portable-<version>-x64.zip` containing the `portable`
  marker file and README.

## [1.0.11] — 2026-10-30

### Added
- Indra OCR (datalab-to/indra-ocr) as a third engine, ported natively to Rust
  on the same ONNX Runtime as PP-OCR: orientation and deskew, script routing
  to four CTC recognizers, RTL reordering and Hangul composition. Text matches
  the Python reference at 97-100% on the sample pages. The ~27 MB model pack
  (v1.1.0, SHA-256-pinned) downloads only when Indra is selected; Indra falls
  back to PP-OCR, then Tesseract, and doctor, Settings and setup report it.
- Setup wizard: launcher-only flow with folder, OCR and shortcut steps.
  Progression blocks until the selected OCR engine is ready, downloads show
  download/verify progress, and an application-type step is gone in favor of
  launcher mode with a close-to-hide note and shortcut capture.

### Changed
- PP-OCR is the default OCR engine again (`indra` was briefly the default;
  existing configs are untouched either way).
- Existing model artifacts are checksum-verified on startup instead of being
  trusted by name; corrupt files are re-downloaded.

### Fixed
- The wizard's OCR pack download no longer triggers a scan before the user
  has picked their folders: a fresh or corrupt config falls back to watching
  the home directory, and the pack-ready callback used to crawl those
  defaults mid-setup (walking `~\AppData`, MTP and network devices).
  `start_indexing` and `start_indexing_when_idle` now refuse to run before
  the setup wizard completes, which also protects the daemon's startup crawl.
- Watcher live updates are covered again on Windows: the config-v6 prune of
  `~\AppData` made every event under `AppData\Local\Temp` (the test
  environment) look excluded, so four watcher tests had been failing since
  1.0.10 on Windows. The tests now watch their temp root explicitly.
- The agent CLI compiles again: since the vendored `paddleocr_rs_onnx`
  (`shared_environment`) landed, the separately-workspaced CLI built the
  plain crates.io crate and failed (`[patch.crates-io]` is per-workspace and
  had to be repeated). The daemon `rescan` RPC now also reloads the config
  the GUI just saved instead of crawling stale in-memory folders.
- Initial indexing shows "Verifying files" instead of a stuck 0%.
- Setup step counts ("03 / 03") after the flow gained a third step.

## [1.0.5] — 2026-10-28

### Fixed
- Theme choice is saved again. The UI renamed its themes to `light` / `dark`
  in 1.0.4, but the backend still only accepted the old `paper` / `void`
  names, so every `set_theme` call failed and the pick never reached disk.
  Both old names are still accepted and existing configs are migrated
  (config v5).
- Red CI on master: `clippy::items_after_test_module` in `memory.rs` (merge artifact) fixed.

## [1.0.4] — 2026-10-28

### Changed
- Redesign: design system, search surface, results, home, onboarding, dialogs, menus, settings.
- Drop glass theme; tighter spacing; rounded-rect search.
- Remove Alt+Space hint from search bar; distinct settings tab icons.
- Master Escape key handling.

## [1.0.3] — 2026-10-27

### Changed
- Scope: Ask-a-file, the local model query refinement, `kensaku-cli ask`, and video previews are removed.
- Quick shortcut: Settings label, Wayland note, and `kensaku --toggle` for desktop keys.
- Keyboard: Cmd/Ctrl+C copies the selected path, Cmd/Ctrl+I opens details.
- Time travel: "last Tuesday" and "N days ago" become time filters.
- README: speed-first hero, measured performance section, new hero image.

## [1.0.2] — 2026-10-27

### Added
- Grid or list results, chosen in the results bar and in Settings.
- Sort dropdown: Best match, Newest, Oldest, Largest, Name.
- Previews for PDFs (first page) and images, shown on cards and in Quick Look (Space).
- Recent files shown as a list on the home screen.
- Save-search and layout controls on the same row as the category filters.
- Tesseract OCR is found inside the app first, before PATH and system installs.

### Changed
- Thumbnails and previews use one 240px size.
- Filters, sort, and layout share one pill style.
- Setup folder step: clearer selection, neutral checkboxes, centered layout.
- Dark-mode borders use the theme color.
- Settings labels: "Meaning search" and "Local model" replace the AI wording.

### Fixed
- Release workflow stages only installable files and checks that artifacts arrived.

## [1.0.1] — 2026-10-27

### Changed
- New UI: neutral light and dark themes with no accent color, the Mac system
  font, and Apple-style motion curves.
- Header is search and Settings only.
- Results are a grid of square cards with infinite scroll. Only what is on
  screen is rendered.
- Hover shows a slim info bar with size, image dimensions, and age.
- Sort is an icon row. Right-click a result for Open, Show in folder, Copy
  path, and Details.
- Onboarding starts with no folders selected.

### Added
- Show thumbnails setting (Settings → Search), on by default.
- Thumbnails are sent to the UI as data URLs, so they render on every platform.

### Fixed
- Infinite scroll no longer repeats the same page request.
- Thumbnails are generated for every visible image, not only the first 30.

## [1.0.0] — 2026-10-27

Kensaku 1.0 is the first release with the full agent surface, optional local
LLM, the search-quality pass, and a cleaned public documentation set. The
desktop app, daemon, CLI, and MCP/HTTP transports are read-only by default and
local-first.

### Added
- Agent surface v2: `find_symbol` (tree-sitter for Rust, Python, JavaScript,
  TypeScript), `.gitignore`/`.cursorignore` parity at index time
  (`include_ignored` opts out), keyset cursors past the 10k exhaustive cap,
  and `agent_scoped_roots` read-only scoping with resolved-path containment.
- Loopback HTTP/SSE transport: `kensaku-cli serve` exposes the MCP tools on
  `127.0.0.1` with a bearer token, JSON or SSE responses, and read-only
  `/health` and `/search` endpoints. `reindex` is never available there.
- One-click agent connect for Claude Desktop, Claude Code, and Cursor via
  Settings → Agents (atomic merge, `.bak` backup), mirrored by
  `kensaku-cli connect <client> [--write]`.
- Optional local LLM (Ollama / LM Studio / OpenAI-compatible; off by default):
  a query compiler that validates filter keys and values before showing chips,
  and `/ask` with path+line citations and no-retrieval-no-answer semantics.
  Non-loopback endpoints require explicit consent and show a cloud indicator in
  the app; the default remains fully local.
- `facet_bench` and a `KENSAKU_SEARCH_BENCH=1` mode for `mem_probe`, plus the
  golden-query integration set in CI.

### Changed
- Search performance: interned extensions (no per-entry `String`), content
  schema v3 with indexed `ext` and fast `size` filter pushdown, allocation-light
  rayon-folded facets (release p50 3.1 ms at 100k, 17.3 ms at 1M), parallel
  metadata materialization, a path index only for trie queries, and parallel
  fuzzy scoring. Full `search_response_fast` p50 is 207 ms at 1M and 24 ms at
  100k; the fuzzy filename tier is 3.6–5.2 ms. Content indexes rebuild once to
  v3 and preserve `index.legacy-*`.
- The Tantivy writer stays single-threaded with a 16 MB arena after measuring
  the 1M trade-off (2 threads were 1.9× faster but used ~47 MB more peak RSS).
- Doctor now checks free disk space alongside its existing per-root
  readability, database, index, watcher, extractor, model, OCR, and version
  checks. The reset marker/restart path has an automated smoke test.
- `RELEASING.md` now documents the draft-release workflow, which uploads every
  bundle, CLI binary, and `SHA256SUMS` to a draft GitHub release on tag push.
- Project version is `1.0.0` in the app, CLI, Tauri config, and docs.

### Fixed
- The ONNX runtime loads dynamically, so older glibc toolchains link again.
  Accurate OCR probes the runtime, contains loader/run panics, reports the
  engine unavailable when the library is missing, and falls back to Tesseract
  instead of losing the file.
- Agent root scoping resolves `..`, `.` and symlinks before comparison;
  out-of-scope reads are rejected.
- One-click connect uses the platform Claude config directory, detects
  project-scoped Claude Code entries, and writes atomically with full-name
  `.bak` backups.
- The query compiler rejects invalid filter values instead of silently
  downgrading them to text terms.
- PP-OCRv6 is compiled into normal builds; Setup/Settings present Tesseract and
  PP-OCRv6 as an either/or choice, and the unsupported native-OCR option is
  disabled rather than faked.
- The fake visual/native paths from the automated pass were removed. Visual
  search remains a Settings → Beta model-download experiment and is not wired
  into search.

### Release notes
- Bundles and the CLI are **unsigned**. See `INSTALL.md` for how to verify a
  download and what the OS warnings mean. Signing/notarization and the
  auto-updater are follow-ups after 1.0.
- Linux: `.deb`, `.rpm`, `.AppImage`; macOS: universal `.dmg`; Windows: `.msi`
  and NSIS `.exe`; plus `kensaku-cli` for each platform and `SHA256SUMS`.

## [0.3.3] — 2026-10-26

### Fixed
- **Images and PDFs were not indexed for existing installs.** Early UI configs
  stored exclusions with a leading dot (`.jpg`, `.pdf`), which the v1 migration
  did not normalize, so those files were skipped forever. A v2 migration strips
  dotted document/image extensions and bumps the config version. Restart after
  upgrading; the startup crawl picks the files up.
- **Thumbnails were blank.** The Tauri asset scope used `$APPCONFIG`, which is
  `<config>/<identifier>`, while thumbs live at `<config>/kensaku/thumbs`. The
  scope now starts with `$CONFIG/kensaku/thumbs/**`.
- **Search took 5–9 s.** Snippets called the full extractor (PDF/OCR) inside the
  query. They now read plain text directly or a cached extraction only; a second
  batched request fills them after the results paint. Measured: 3.86 s → 0.14 s.
- **The metadata DB was 310 MB for 382 rows.** Startup now vacuums when free
  pages exceed 20%, caps the WAL at 64 MB, and checkpoints after crawls
  (310 MB → 604 KB).
- Image previews no longer run OCR; previews are debounced and sequenced.
- `content_docs` reports the real Tantivy document count.

### Changed
- Release pipeline builds bundles and CLI binaries as workflow artifacts;
  publishing is done with `gh` (see `docs/RELEASING.md`).
- Packaging: `bench` is now a cargo example and `kensaku-cli` is a separate
  crate, so Tauri bundles exactly one binary. This fixes the macOS universal
  build failing while trying to copy the extra binaries.

## [0.3.1] — 2026-10-26

### Fixed
- **OCR could not be turned on.** The Settings switch was a disabled placeholder
  and `ocr_enabled` was never read by the backend. The switch now persists to
  config, extraction is gated on it, and changing it re-scans only images.
- **OCR silently produced nothing when tesseract had no language data.** Settings
  now reports engine/language status, can download `eng.traineddata` (~4 MB) into
  Kensaku's own directory, and shows platform install commands when the engine is
  missing. Doctor gained an OCR check.

### Changed
- `content_pending` column lets a settings change re-process only the affected
  files; pending images with no extractable text have stale documents removed.

## [0.3.0] — 2026-10-26

The open-source launch. Seven focused changesets on top of v0.2.0.

### Added
- **Agent surface.** `kensaku-cli` with `search`, `state`, and `mcp`; an MCP stdio
  server exposing `search`, `read_snippet`, and `index_state` over the same
  read-only index. Token-budgeted snippets, ranked and exhaustive modes, path/ext/
  lookback filters. See `docs/AGENTS.md`.
- **Real static embeddings.** Manual safetensors (F32/F16) + BERT WordPiece loader
  for potion-base-8M, loaded once via a global registry; automatic re-embed when
  the model id changes. Hashing estimator remains the fallback.
- **Image support.** Lazy cached thumbnails (320 px JPEG), dimensions, 64-bit dHash,
  perceptual near-duplicate groups merged into `find_duplicates`, thumbnail-forward
  results and preview.
- **Query semantics.** `re:` regex execution, true `name:`/`content:` field scoping
  in BM25, `mode:exhaustive`, and a semantic candidate prefilter.
- **Robustness.** Single-instance lock, atomic config writes with corrupt-file
  backup, unavailable-root preservation, 8-second extraction timeout on a bounded
  pool, directory-rename subtree rewrite, Windows cloud-placeholder guard.
- **Launch plumbing.** Start at login, rotating local crash log (256 KiB) with a
  Doctor check, unsigned multi-OS draft release workflow, CLI artifacts.
- **Tests and CI.** 77 Rust tests (parser, config migration, extraction, fuzzy
  relevance, ranking, MCP/CLI, images, crash log), `clippy -D warnings`, web and
  rust workflows, benchmark methodology.

### Changed
- Ranking now normalizes RRF before bonuses, bounds the depth penalty, clamps
  scores at zero, and drops weak semantic-only hits. This removes negative scores
  and shallow-but-irrelevant top results.
- The main window is files-only: search, category chips, results, preview. Stats
  and actions live in Settings.
- Grid view navigates by rows (Up/Down jump a row, Left/Right stay in the row).
- Default exclusions no longer skip PDF/Office/image formats now that extraction
  and OCR exist; a `config_version` migration cleans existing configs.
- Rewritten README, install/usage/FAQ/security/contributing docs, LICENSE.

### Fixed
- Document and image indexing were effectively disabled by legacy default
  exclusions.
- `state` reports the units' model id separately from the active query model.
- Embed queue no longer renders an inverse fill for queue depth.

## [0.2.0] — 2026-10-25

- Durable SQLite metadata with warm start; incremental crawl; identity by
  `(dev, ino)`; rename/delete handling; stale-document purge.
- Full query language and three-tier RRF fusion.
- PDF, Office, EPUB/ODT, RTF extraction; tesseract OCR.
- UI v2: `paper`/`void` themes, category chips, list/grid, command palette,
  preview pane, Settings with Doctor, Stats for Nerds, model download and factory
  reset.

## [0.1.0] — 2026-10-24

- Initial release: Rust engine (nucleo, Tantivy, jwalk, notify) and Tauri shell
  with a floating search window, tray, global shortcut and onboarding.
