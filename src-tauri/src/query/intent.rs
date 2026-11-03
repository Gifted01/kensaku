//! Deterministic natural-language intent compilation.
//!
//! Small, local, explainable rules map common phrasings ("latest resume",
//! "screenshots from last week", "big videos in Projects") onto the existing
//! query grammar plus an explicit sort. No model, no network, no silent
//! rewrites: every emitted filter is returned as a removable chip.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterpretationChip {
    /// "type" | "time" | "size" | "sort" | "place"
    pub kind: String,
    pub label: String,
    /// The filter token appended to the query, e.g. `type:image`.
    pub raw: String,
    /// The words in the user's input that produced this chip.
    pub source: String,
}

#[derive(Debug, Clone, Default)]
pub struct Intent {
    /// Query with intent phrases removed and filters appended.
    pub query: String,
    /// Explicit sort requested by language, if any.
    pub sort: Option<String>,
    pub chips: Vec<InterpretationChip>,
}

fn take(
    work: &mut String,
    re: &Regex,
    kind: &str,
    label: &str,
    raw: &str,
    appends: &mut Vec<String>,
    chips: &mut Vec<InterpretationChip>,
) {
    if let Some(m) = re.find(work) {
        let source = m.as_str().trim().to_string();
        *work = format!("{} {}", &work[..m.start()], &work[m.end()..]);
        appends.push(raw.to_string());
        chips.push(InterpretationChip {
            kind: kind.to_string(),
            label: label.to_string(),
            raw: raw.to_string(),
            source,
        });
    }
}

/// Compiles natural language into the existing query grammar.
pub fn compile(raw: &str) -> Intent {
    compile_with_aliases(raw, &[])
}

/// The query as typed, with only personal vocabulary expanded: no filters,
/// dates or sorts are read into it. Used when the interpreted query matches
/// nothing (see `SearchDispatcher::search_response_with_snippets`).
pub fn literal_with_aliases(raw: &str, aliases: &[(String, Vec<String>)]) -> Intent {
    let (mut work, quoted) = mask_quoted(raw);
    let mut appends = Vec::new();
    let mut chips = Vec::new();
    expand_aliases(&mut work, aliases, &mut appends, &mut chips);
    if chips.is_empty() {
        return Intent {
            query: raw.to_string(),
            sort: None,
            chips,
        };
    }
    let mut query = unmask_quoted(&work, &quoted)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    for token in appends {
        if !query.is_empty() {
            query.push(' ');
        }
        query.push_str(&token);
    }
    Intent {
        query,
        sort: None,
        chips,
    }
}

/// Replaces each complete `"..."` span with a placeholder so no rule can
/// read quoted words as a filter, a date or a sort. Returns the masked text
/// and the spans, in order, for [`unmask_quoted`].
fn mask_quoted(text: &str) -> (String, Vec<String>) {
    let Ok(re) = Regex::new(r#""[^"]*""#) else {
        return (text.to_string(), Vec::new());
    };
    let mut spans = Vec::new();
    let masked = re
        .replace_all(text, |c: &regex::Captures| {
            spans.push(c[0].to_string());
            format!("{QUOTE_MARK}{}{QUOTE_MARK}", spans.len() - 1)
        })
        .into_owned();
    (masked, spans)
}

fn unmask_quoted(text: &str, spans: &[String]) -> String {
    if spans.is_empty() {
        return text.to_string();
    }
    let Ok(re) = Regex::new(&format!("{QUOTE_MARK}(\\d+){QUOTE_MARK}")) else {
        return text.to_string();
    };
    re.replace_all(text, |c: &regex::Captures| {
        c[1].parse::<usize>()
            .ok()
            .and_then(|i| spans.get(i).cloned())
            .unwrap_or_default()
    })
    .into_owned()
}

/// Private-use character around quoted-span placeholders: not a word
/// character, so no `\b...\b` rule can match across it.
const QUOTE_MARK: char = '\u{E000}';

/// Compiles natural language, expanding personal vocabulary aliases into an
/// OR-regex term (e.g. `resume` → `re:"(?i)(resume|cv)"`).
pub fn compile_with_aliases(raw: &str, aliases: &[(String, Vec<String>)]) -> Intent {
    // Explicit grammar is authoritative: never reinterpret a query that
    // already contains a filter token.
    let has_explicit_filter = raw
        .split_whitespace()
        .any(|t| t.contains(':') && !t.starts_with("http") && !t.starts_with("https"));

    // Quoted words are meant literally ("журнал" учёта, "last week" notes).
    let (mut work, quoted) = mask_quoted(raw);
    let mut appends: Vec<String> = Vec::new();
    let mut chips: Vec<InterpretationChip> = Vec::new();
    let mut sort: Option<String> = None;

    if !has_explicit_filter {
        // --- Time windows ----------------------------------------------
        for (pat, filter, label) in [
            (r"(?i)\btoday\b", "modified:<1d", "Modified: today"),
            (
                r"(?i)\byesterday\b",
                "modified:1d..2d",
                "Modified: yesterday",
            ),
            (
                r"(?i)\b(?:this|last|past) week\b",
                "modified:<7d",
                "Modified: last 7 days",
            ),
            (
                r"(?i)\b(?:this|last|past) month\b",
                "modified:<30d",
                "Modified: last 30 days",
            ),
            (
                r"(?i)\b(?:this|last|past) year\b",
                "modified:<365d",
                "Modified: last year",
            ),
            // Russian
            (
                r"(?i)\b(?:за\s+)?(?:сегодня|сегодняшн\w*)\b",
                "modified:<1d",
                "Modified: today",
            ),
            (
                r"(?i)\bпозавчера\b",
                "modified:2d..3d",
                "Modified: 2 days ago",
            ),
            (
                r"(?i)\b(?:вчера|вчерашн\w*)\b",
                "modified:1d..2d",
                "Modified: yesterday",
            ),
            (
                r"(?i)\b(?:за\s+(?:(?:эту|прошлую|последнюю)\s+)?неделю|(?:на|в)\s+(?:(?:этой|прошлой|последней)\s+)?неделе|(?:эта|прошлая|последняя)\s+неделя)\b",
                "modified:<7d",
                "Modified: last 7 days",
            ),
            (
                r"(?i)\b(?:за\s+(?:(?:этот|прошлый|последний)\s+)?месяц|(?:в|на)\s+(?:этом|прошлом|последнем)\s+месяце|(?:этот|прошлый|последний)\s+месяц)\b",
                "modified:<30d",
                "Modified: last 30 days",
            ),
            (
                r"(?i)\b(?:за\s+(?:(?:этот|прошлый|последний)\s+)?год|(?:в|на)\s+(?:этом|прошлом|последнем)\s+году|(?:этот|прошлый|последний)\s+год)\b",
                "modified:<365d",
                "Modified: last year",
            ),
        ] {
            if let Ok(re) = Regex::new(pat) {
                take(
                    &mut work,
                    &re,
                    "time",
                    label,
                    filter,
                    &mut appends,
                    &mut chips,
                );
            }
        }

        // --- Time travel: weekday and "N days ago" ---------------------
        // "last Tuesday" is the most recent Tuesday before today. "N days ago"
        // is that day. Both become a one-day window and a removable chip.
        for (pat, days_fn, label) in [
            (
                r"(?i)\blast\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b",
                weekday_days_back as fn(&str, u32) -> Option<u32>,
                "Modified: last",
            ),
            (
                r"(?i)\b(\d{1,3})\s+days?\s+ago\b",
                days_ago_days as fn(&str, u32) -> Option<u32>,
                "Modified: days ago",
            ),
            (
                r"(?i)\b(?:в(?:о)?\s+)?прошл(?:ый|ую|ое|ая)\s+(понедельник|вторник|сред[ау]|четверг|пятниц[ау]|суббот[ау]|воскресенье)\b",
                weekday_days_back as fn(&str, u32) -> Option<u32>,
                "Modified: last",
            ),
            (
                r"(?i)\b(\d{1,3})\s+(?:дн(?:я|ей)|день)\s+назад\b",
                days_ago_days as fn(&str, u32) -> Option<u32>,
                "Modified: days ago",
            ),
        ] {
            if let Ok(re) = Regex::new(pat)
                && let Some(m) = re.captures(&work)
            {
                let whole = m.get(0).map(|x| x.as_str().to_string()).unwrap_or_default();
                let arg = m.get(1).map(|x| x.as_str()).unwrap_or("");
                let weekday_today = chrono_weekday_today();
                if let Some(back) = days_fn(arg, weekday_today) {
                    let filter = format!("modified:{}d..{}d", back, back + 1);
                    // One English label whatever the query language; the UI
                    // translates it ("Modified: last Friday", "... 3 days ago").
                    let shown = if label == "Modified: last" {
                        let day = weekday_index(arg)
                            .map(|i| WEEKDAY_NAMES[i as usize])
                            .unwrap_or(arg);
                        format!("Modified: last {day}")
                    } else {
                        format!("Modified: {back} days ago")
                    };
                    work = work.replacen(&whole, " ", 1);
                    appends.push(filter.clone());
                    chips.push(InterpretationChip {
                        kind: "time".to_string(),
                        label: shown,
                        raw: filter,
                        source: whole,
                    });
                }
            }
        }

        // --- Sort words -------------------------------------------------
        // After the dates: "за последнюю неделю" is a window, not "newest".
        // Before sizes: "самые большие" is a sort, not the "большие" filter.
        for (pat, order, label) in [
            (r"(?i)\b(?:latest|newest|most recent)\b", "newest", "Newest"),
            (r"(?i)\boldest\b", "oldest", "Oldest"),
            (r"(?i)\b(?:biggest|largest)\b", "largest", "Largest"),
            // Russian.
            (
                r"(?i)\b(?:последн(?:ий|яя|ее|ие|юю|его|ей|их)|свеж(?:ий|ая|ее|ие|ую|их)|новейш\w*|самы[йеях]\w*\s+нов\w*)\b",
                "newest",
                "Newest",
            ),
            (
                r"(?i)\b(?:старейш\w*|самы[йеях]\w*\s+стар\w*)\b",
                "oldest",
                "Oldest",
            ),
            (
                r"(?i)\b(?:крупнейш\w*|самы[йеях]\w*\s+(?:больш|крупн|тяж[её]л)\w*)\b",
                "largest",
                "Largest",
            ),
        ] {
            if sort.is_none()
                && let Ok(re) = Regex::new(pat)
                && re.is_match(&work)
            {
                let source = re
                    .find(&work)
                    .map(|m| m.as_str().to_string())
                    .unwrap_or_default();
                work = re.replace(&work, " ").to_string();
                sort = Some(order.to_string());
                chips.push(InterpretationChip {
                    kind: "sort".to_string(),
                    label: format!("Sort: {}", label),
                    raw: format!("sort:{}", order),
                    source,
                });
            }
        }

        // --- Size -------------------------------------------------------
        if let Ok(re) = Regex::new(
            r"(?i)\b(?:under|less than|smaller than|меньше|менее|до)\s+(\d+(?:[.,]\d+)?)\s*(kb|mb|gb|кб|мб|гб)\b",
        ) && let Some(c) = re.captures(&work)
        {
            let number = c[1].replace(',', ".");
            let unit = latin_size_unit(&c[2]);
            let raw = format!("size:<{}{}", number, unit);
            let source = c.get(0).map(|m| m.as_str().to_string()).unwrap_or_default();
            work = re.replace(&work, " ").to_string();
            appends.push(raw.clone());
            chips.push(InterpretationChip {
                kind: "size".to_string(),
                label: format!("Size: under {}{}", number, unit.to_uppercase()),
                raw,
                source,
            });
        }
        if let Ok(re) = Regex::new(
            r"(?i)\b(?:over|more than|larger than|bigger than|больше|более|свыше|от)\s+(\d+(?:[.,]\d+)?)\s*(kb|mb|gb|кб|мб|гб)\b",
        ) && let Some(c) = re.captures(&work)
        {
            let number = c[1].replace(',', ".");
            let unit = latin_size_unit(&c[2]);
            let raw = format!("size:>{}{}", number, unit);
            let source = c.get(0).map(|m| m.as_str().to_string()).unwrap_or_default();
            work = re.replace(&work, " ").to_string();
            appends.push(raw.clone());
            chips.push(InterpretationChip {
                kind: "size".to_string(),
                label: format!("Size: over {}{}", number, unit.to_uppercase()),
                raw,
                source,
            });
        }
        for (pat, filter, label) in [
            (
                r"(?i)\b(?:huge|big|large)\b",
                "size:>100mb",
                "Size: over 100 MB",
            ),
            (r"(?i)\b(?:tiny|small)\b", "size:<1mb", "Size: under 1 MB"),
            (
                r"(?i)\b(?:огромн(?:ые|ых)|больш(?:ие|их)|тяж[её]л(?:ые|ых))\b",
                "size:>100mb",
                "Size: over 100 MB",
            ),
            (
                r"(?i)\b(?:маленьк(?:ие|их)|мелк(?:ие|их)|крошечн(?:ые|ых))\b",
                "size:<1mb",
                "Size: under 1 MB",
            ),
        ] {
            if let Ok(re) = Regex::new(pat) {
                take(
                    &mut work,
                    &re,
                    "size",
                    label,
                    filter,
                    &mut appends,
                    &mut chips,
                );
            }
        }

        // --- Visual search intent --------------------------------------
        for pat in [r"(?i)\b(?:visual search|search visually for|visually)\b"] {
            if let Ok(re) = Regex::new(pat)
                && re.is_match(&work)
            {
                let source = re
                    .find(&work)
                    .map(|m| m.as_str().to_string())
                    .unwrap_or_default();
                work = re.replace(&work, " ").to_string();
                appends.push("type:image".to_string());
                chips.push(InterpretationChip {
                    kind: "visual".to_string(),
                    label: "Visual: images".to_string(),
                    raw: "type:image".to_string(),
                    source,
                });
                break;
            }
        }

        // --- Media / document nouns ------------------------------------
        for (pat, filter, label) in [
            (
                r"(?i)\b(?:screenshots?|images?|photos?|pictures?)\b",
                "type:image",
                "Type: images",
            ),
            (r"(?i)\bpdfs?\b", "ext:pdf", "Type: PDF"),
            (
                r"(?i)\b(?:videos?|movies?|clips?)\b",
                "type:media",
                "Type: media",
            ),
            (
                r"(?i)\b(?:audio|music|songs?)\b",
                "type:media",
                "Type: media",
            ),
            (r"(?i)\b(?:code|source)\b", "type:code", "Type: code"),
            (
                r"(?i)\b(?:documents?|docs?)\b",
                "type:doc",
                "Type: documents",
            ),
            // Office tables and decks have their own types: `type:doc` covers
            // text documents only (no .xlsx/.pptx), so mapping these words to
            // it matched none of the files they name.
            (
                r"(?i)\b(?:spreadsheets?|excel)\b",
                "type:sheet",
                "Type: spreadsheets",
            ),
            (
                r"(?i)\b(?:presentations?|slides?)\b",
                "type:presentation",
                "Type: presentations",
            ),
            (
                r"(?i)\b(?:folders?|directories|directory)\b",
                "type:dir",
                "Type: folders",
            ),
            (
                r"(?i)\b(?:archives?|zips?)\b",
                "type:archive",
                "Type: archives",
            ),
            (r"(?i)\blogs?\b", "ext:log", "Type: logs"),
            // Russian. Explicit word forms, not stems: "документация",
            // "журнал учёта", "архивное", "каталог товаров" or "фотошоп" are
            // content words, not requests for a file type.
            (
                r"(?i)\b(?:скриншот(?:ы|а|ов|ах|ами)?|скрин(?:ы|ов|ах)?|снимок|снимк(?:и|ов|ах)|картинк(?:а|и|у|ах|ами)|картинок|изображени(?:е|я|й|ях)|фото|фотк(?:а|и|у)|фоток|фотографи(?:я|и|ю|ях)|фотографий)\b",
                "type:image",
                "Type: images",
            ),
            (r"(?i)\bпдф\w*\b", "ext:pdf", "Type: PDF"),
            (
                r"(?i)\b(?:видео|видеозапис(?:ь|и|ей)|ролик(?:и|ов)?|фильм(?:ы|ов)?)\b",
                "type:media",
                "Type: media",
            ),
            (
                r"(?i)\b(?:аудио|аудиозапис(?:ь|и|ей)|музык(?:а|у|и)|песн(?:я|и|ю)|песен)\b",
                "type:media",
                "Type: media",
            ),
            (
                r"(?i)\b(?:исходник(?:и|ов)?|исходн(?:ый|ого|ом)\s+код)\b",
                "type:code",
                "Type: code",
            ),
            (
                r"(?i)\b(?:документы|документов|документах|доки|доков)\b",
                "type:doc",
                "Type: documents",
            ),
            (
                r"(?i)\b(?:таблиц(?:а|ы|у|ах)?|эксел(?:ь|е|я|ьки|ек)|ексел(?:ь|е|я))\b",
                "type:sheet",
                "Type: spreadsheets",
            ),
            (
                r"(?i)\b(?:презентаци(?:я|и|ю|ях)|презентаций|слайд(?:ы|ов)?)\b",
                "type:presentation",
                "Type: presentations",
            ),
            (
                r"(?i)\b(?:папки|папок|директории|директорий)\b",
                "type:dir",
                "Type: folders",
            ),
            (
                r"(?i)\b(?:архивы|архивов|архивах)\b",
                "type:archive",
                "Type: archives",
            ),
            (
                r"(?i)\b(?:лог(?:и|ов|ах)?|лог-файл(?:ы|ов)?)\b",
                "ext:log",
                "Type: logs",
            ),
        ] {
            if let Ok(re) = Regex::new(pat) {
                take(
                    &mut work,
                    &re,
                    "type",
                    label,
                    filter,
                    &mut appends,
                    &mut chips,
                );
            }
        }

        // --- Place ------------------------------------------------------
        if let Ok(re) = Regex::new(
            r"(?i)\bin\s+(?:my\s+)?(projects|downloads|documents|desktop|pictures|videos|music|work)\b",
        ) {
            expand_aliases(&mut work, aliases, &mut appends, &mut chips);
            // Russian names of the standard folders. On a Russian Windows the
            // folders on disk are still "Downloads", "Documents"... (only the
            // shell shows translated names), so they map to those names.
            if let Ok(ru) = Regex::new(
                r"(?i)\b(?:в|на|из)\s+(?:мо(?:их|ей|ём|ем)\s+)?(?:папке\s+)?(загрузк(?:ах|и)|скачанн\w*|документах|рабоч(?:ем|ий)\s+стол[еа]?|изображениях|картинках|видео|музыке|проектах)\b",
            ) && let Some(c) = ru.captures(&work)
            {
                let word = c[1].to_lowercase();
                let place = if word.starts_with("загрузк") || word.starts_with("скачанн")
                {
                    "downloads"
                } else if word.starts_with("документ") {
                    "documents"
                } else if word.starts_with("рабоч") {
                    "desktop"
                } else if word.starts_with("изображ") || word.starts_with("картин") {
                    "pictures"
                } else if word.starts_with("видео") {
                    "videos"
                } else if word.starts_with("музык") {
                    "music"
                } else {
                    "projects"
                };
                let raw = format!("in:{}", place);
                let source = c.get(0).map(|m| m.as_str().to_string()).unwrap_or_default();
                work = ru.replace(&work, " ").to_string();
                appends.push(raw.clone());
                chips.push(InterpretationChip {
                    kind: "place".to_string(),
                    label: format!("In: {}", place),
                    raw,
                    source,
                });
            } else if let Some(c) = re.captures(&work) {
                let place = c[1].to_string();
                let raw = format!("in:{}", place);
                let source = c.get(0).map(|m| m.as_str().to_string()).unwrap_or_default();
                work = re.replace(&work, " ").to_string();
                appends.push(raw.clone());
                chips.push(InterpretationChip {
                    kind: "place".to_string(),
                    label: format!("In: {}", place),
                    raw,
                    source,
                });
            }
        }
    }

    if chips.is_empty() {
        return Intent {
            query: raw.to_string(),
            sort: None,
            chips: Vec::new(),
        };
    }

    // Drop connective filler left behind once the intent words are removed.
    if let Ok(re) = Regex::new(
        r"(?i)\b(?:from|the|a|an|my|me|show|find|get|give|all|some|of|за|со?|от|из|мо[йиюяё]|моих|покажи|найди|найти|дай|все|всё|какие-нибудь)\b",
    ) {
        work = re.replace_all(&work, " ").to_string();
    }

    let work = unmask_quoted(&work, &quoted);
    let mut query = work.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut seen = HashSet::new();
    for token in appends {
        if seen.insert(token.clone()) {
            if !query.is_empty() {
                query.push(' ');
            }
            query.push_str(&token);
        }
    }

    if query.trim().is_empty() {
        query = raw.to_string();
    }

    Intent { query, sort, chips }
}

/// Expands personal vocabulary: `term` becomes an OR-regex of the term and
/// its expansions, with a removable chip.
fn expand_aliases(
    work: &mut String,
    aliases: &[(String, Vec<String>)],
    appends: &mut Vec<String>,
    chips: &mut Vec<InterpretationChip>,
) {
    for (term, expansions) in aliases {
        let term = term.trim();
        if term.is_empty() {
            continue;
        }
        let Ok(re) = Regex::new(&format!(r"(?i)\b{}\b", regex::escape(term))) else {
            continue;
        };
        if !re.is_match(work.as_str()) {
            continue;
        }
        let mut words = vec![term.to_lowercase()];
        for exp in expansions {
            let exp = exp.trim().to_lowercase();
            if !exp.is_empty() && !words.contains(&exp) {
                words.push(exp);
            }
        }
        let alternation = words
            .iter()
            .map(|w| regex::escape(w))
            .collect::<Vec<_>>()
            .join("|");
        let raw = format!("re:\"(?i)({})\"", alternation);
        let rest = re.replace(work.as_str(), " ").into_owned();
        *work = rest;
        appends.push(raw.clone());
        chips.push(InterpretationChip {
            kind: "alias".to_string(),
            label: format!("Alias: {}", term),
            raw,
            source: term.to_string(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn latest_resume_becomes_newest_sort() {
        let intent = compile("latest resume");
        assert_eq!(intent.sort.as_deref(), Some("newest"));
        assert_eq!(intent.query, "resume");
        assert!(intent.chips.iter().any(|c| c.raw == "sort:newest"));
    }

    #[test]
    fn screenshots_from_last_week_adds_type_and_time() {
        let intent = compile("screenshots from last week");
        assert!(intent.query.contains("type:image"));
        assert!(intent.query.contains("modified:<7d"));
    }

    #[test]
    fn big_videos_in_projects_composes_filters() {
        let intent = compile("big videos in Projects");
        assert!(intent.sort.is_none());
        assert!(intent.query.contains("size:>100mb"));
        assert!(intent.query.contains("type:media"));
        assert!(intent.query.contains("in:Projects"));
    }

    #[test]
    fn explicit_grammar_is_not_reinterpreted() {
        let intent = compile("type:pdf latest");
        assert!(intent.chips.is_empty());
        assert_eq!(intent.query, "type:pdf latest");
    }

    #[test]
    fn alias_expands_into_or_regex() {
        let aliases = vec![("resume".to_string(), vec!["cv".to_string()])];
        let intent = compile_with_aliases("resume", &aliases);
        assert!(intent.query.contains("re:\"(?i)(resume|cv)\""));
        assert!(intent.chips.iter().any(|c| c.kind == "alias"));
    }

    #[test]
    fn russian_screenshots_last_week() {
        let intent = compile("скриншоты за прошлую неделю");
        assert!(intent.query.contains("type:image"), "{}", intent.query);
        assert!(intent.query.contains("modified:<7d"), "{}", intent.query);
        assert!(!intent.query.contains("за"), "{}", intent.query);
    }

    #[test]
    fn russian_sort_size_and_place() {
        let intent = compile("самые большие видео в загрузках");
        assert_eq!(intent.sort.as_deref(), Some("largest"));
        assert!(intent.query.contains("type:media"), "{}", intent.query);
        assert!(intent.query.contains("in:downloads"), "{}", intent.query);

        let intent = compile("последний договор pdf больше 5 мб");
        assert_eq!(intent.sort.as_deref(), Some("newest"));
        assert!(intent.query.contains("size:>5mb"), "{}", intent.query);
        assert!(intent.query.starts_with("договор"), "{}", intent.query);
    }

    #[test]
    fn russian_relative_days() {
        let intent = compile("счёт 3 дня назад");
        assert!(intent.query.contains("modified:3d..4d"), "{}", intent.query);
        assert!(intent.query.starts_with("счёт"), "{}", intent.query);

        let intent = compile("отчёт вчера");
        assert!(intent.query.contains("modified:1d..2d"), "{}", intent.query);

        let intent = compile("акт в прошлую пятницу");
        assert!(intent.chips.iter().any(|c| c.kind == "time"));
        assert_eq!(intent.query.split_whitespace().next(), Some("акт"));
    }

    #[test]
    fn decks_and_tables_use_their_own_types() {
        assert!(
            compile("slides about pricing")
                .query
                .contains("type:presentation")
        );
        assert!(
            compile("презентация вендора")
                .query
                .contains("type:presentation")
        );
        assert!(compile("таблица бюджета").query.contains("type:sheet"));
    }

    #[test]
    fn russian_plain_query_is_untouched() {
        let intent = compile("лицензии касперский");
        assert!(intent.chips.is_empty());
        assert_eq!(intent.query, "лицензии касперский");
    }

    #[test]
    fn russian_content_words_are_not_filters() {
        for query in [
            "журнал учёта",
            "документация kaspersky",
            "архивное дело",
            "каталог товаров",
            "фотошоп уроки",
            "фильмография",
            "презент на день рождения",
            "план на месяц",
            "рабочая неделя",
            "Большой театр",
            "мелкий ремонт",
        ] {
            let intent = compile(query);
            assert!(
                intent.chips.iter().all(|c| c.kind == "sort"),
                "{query:?} -> {:?}",
                intent.chips
            );
        }
    }

    #[test]
    fn russian_time_window_is_not_a_sort() {
        let intent = compile("отчёт за последнюю неделю");
        assert!(intent.sort.is_none(), "{:?}", intent.sort);
        assert!(intent.query.contains("modified:<7d"), "{}", intent.query);
        assert!(intent.query.starts_with("отчёт"), "{}", intent.query);
        let intent = compile("акты на прошлой неделе");
        assert!(intent.query.contains("modified:<7d"), "{}", intent.query);
        let intent = compile("счета за этот месяц");
        assert!(intent.query.contains("modified:<30d"), "{}", intent.query);
    }

    #[test]
    fn quoted_words_are_never_interpreted() {
        let intent = compile("\"last week\" notes");
        assert!(intent.chips.is_empty());
        assert_eq!(intent.query, "\"last week\" notes");

        let intent = compile("screenshots \"today\"");
        assert!(intent.chips.iter().any(|c| c.raw == "type:image"));
        assert!(!intent.query.contains("modified:"), "{}", intent.query);
        assert!(intent.query.contains("\"today\""), "{}", intent.query);

        let intent = compile("\"журнал\" логи");
        assert!(intent.query.contains("\"журнал\""), "{}", intent.query);
        assert!(intent.query.contains("ext:log"), "{}", intent.query);
    }

    #[test]
    fn literal_mode_keeps_words_and_aliases_only() {
        let aliases = vec![("resume".to_string(), vec!["cv".to_string()])];
        let intent = literal_with_aliases("latest resume screenshots", &aliases);
        assert!(intent.sort.is_none());
        assert!(intent.chips.iter().all(|c| c.kind == "alias"));
        assert!(intent.query.contains("latest"), "{}", intent.query);
        assert!(intent.query.contains("screenshots"), "{}", intent.query);
        assert!(
            intent.query.contains("re:\"(?i)(resume|cv)\""),
            "{}",
            intent.query
        );

        let intent = literal_with_aliases("журнал учёта", &[]);
        assert!(intent.chips.is_empty());
        assert_eq!(intent.query, "журнал учёта");
    }

    #[test]
    fn time_chips_have_english_labels_for_any_query_language() {
        let ru = compile("акт в прошлую пятницу");
        let en = compile("invoice from last friday");
        let label = |i: &Intent| {
            i.chips
                .iter()
                .find(|c| c.kind == "time")
                .map(|c| c.label.clone())
        };
        assert_eq!(label(&ru).as_deref(), Some("Modified: last Friday"));
        assert_eq!(label(&en), label(&ru));
        assert_eq!(
            label(&compile("счёт 3 дня назад")).as_deref(),
            Some("Modified: 3 days ago")
        );
    }

    #[test]
    fn plain_query_is_untouched() {
        let intent = compile("docker error");
        assert!(intent.chips.is_empty());
        assert_eq!(intent.query, "docker error");
    }
}

/// Today's weekday as 0=Monday..6=Sunday, from the system clock (UTC is
/// accurate enough for a one-day window).
fn chrono_weekday_today() -> u32 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let days = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0);
    // 1970-01-01 was a Thursday (index 3 when Monday is 0).
    ((days + 3) % 7) as u32
}

/// Days back from today to the most recent given weekday, never today itself.
fn weekday_days_back(name: &str, today: u32) -> Option<u32> {
    let target = weekday_index(name)?;
    let back = (today + 7 - target) % 7;
    Some(if back == 0 { 7 } else { back })
}

/// English day names, indexed 0=Monday..6=Sunday (chip labels).
const WEEKDAY_NAMES: [&str; 7] = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
];

/// 0=Monday..6=Sunday for an English or Russian day name as typed.
fn weekday_index(name: &str) -> Option<u32> {
    let lower = name.to_lowercase();
    Some(match lower.as_str() {
        "понедельник" => 0,
        "вторник" => 1,
        "среда" | "среду" => 2,
        "четверг" => 3,
        "пятница" | "пятницу" => 4,
        "суббота" | "субботу" => 5,
        "воскресенье" => 6,
        "monday" => 0,
        "tuesday" => 1,
        "wednesday" => 2,
        "thursday" => 3,
        "friday" => 4,
        "saturday" => 5,
        "sunday" => 6,
        _ => return None,
    })
}

/// Size unit as the query grammar spells it (`мб` → `mb`).
fn latin_size_unit(unit: &str) -> String {
    match unit.to_lowercase().as_str() {
        "кб" => "kb".to_string(),
        "мб" => "mb".to_string(),
        "гб" => "gb".to_string(),
        other => other.to_string(),
    }
}

/// "N days ago" is N days back, with a floor of one day.
fn days_ago_days(n: &str, _today: u32) -> Option<u32> {
    let n: u32 = n.parse().ok()?;
    (1..=365).contains(&n).then_some(n)
}

#[cfg(test)]
mod time_travel_tests {
    use super::*;

    #[test]
    fn last_weekday_is_never_today() {
        // Thursday (3) asking for "last Thursday" must go back a full week.
        assert_eq!(weekday_days_back("thursday", 3), Some(7));
        // Thursday asking for "last Monday" is three days back.
        assert_eq!(weekday_days_back("monday", 3), Some(3));
        // Monday asking for "last Sunday" is one day back.
        assert_eq!(weekday_days_back("sunday", 0), Some(1));
        assert_eq!(weekday_days_back("noday", 0), None);
    }

    #[test]
    fn days_ago_is_bounded() {
        assert_eq!(days_ago_days("3", 0), Some(3));
        assert_eq!(days_ago_days("0", 0), None);
        assert_eq!(days_ago_days("9999", 0), None);
    }

    #[test]
    fn weekday_phrase_becomes_a_time_filter_chip() {
        let intent = compile("invoice from last tuesday");
        let chip = intent
            .chips
            .iter()
            .find(|c| c.kind == "time")
            .expect("time chip for last tuesday");
        assert!(chip.raw.starts_with("modified:"), "got {}", chip.raw);
        assert!(!intent.query.to_lowercase().contains("tuesday"));
    }

    #[test]
    fn days_ago_phrase_becomes_a_time_filter_chip() {
        let intent = compile("notes 3 days ago");
        assert!(
            intent
                .chips
                .iter()
                .any(|c| c.kind == "time" && c.raw.contains(".."))
        );
    }
}
