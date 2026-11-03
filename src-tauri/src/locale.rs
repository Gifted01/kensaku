//! Interface language and Cyrillic-script awareness.
//!
//! The UI language is a user setting (`language`: `system`, `en` or `ru`).
//! Search features that depend on the script people write in (OCR language
//! data, the default OCR engine) follow the same choice: when the interface is
//! Russian, or `system` resolves to a Cyrillic-script locale, Kensaku reads
//! Cyrillic in screenshots and scans by default.

/// Languages the interface ships translations for.
pub const SUPPORTED: &[&str] = &["en", "ru"];

/// Normalizes a stored `language` value to `system`, `en` or `ru`.
pub fn normalize_language(raw: &str) -> String {
    let lower = raw.trim().to_ascii_lowercase();
    if lower == "system" || lower.is_empty() {
        return "system".to_string();
    }
    let primary = lower.split(['-', '_']).next().unwrap_or("");
    if SUPPORTED.contains(&primary) {
        primary.to_string()
    } else {
        "system".to_string()
    }
}

/// Primary language subtag of the operating-system UI locale, lowercase
/// (`ru`, `en`, ...), or `None` when it cannot be determined.
pub fn system_language() -> Option<String> {
    if let Some(forced) = std::env::var_os("KENSAKU_LOCALE") {
        let forced = forced.to_string_lossy().to_ascii_lowercase();
        return forced.split(['-', '_', '.']).next().map(str::to_string);
    }
    system_language_impl()
}

#[cfg(windows)]
fn system_language_impl() -> Option<String> {
    // LANGID: low 10 bits are the primary language.
    let langid = unsafe { windows::Win32::Globalization::GetUserDefaultUILanguage() };
    let primary = langid & 0x3ff;
    Some(
        match primary {
            0x19 => "ru",
            0x22 => "uk",
            0x23 => "be",
            0x02 => "bg",
            0x3f => "kk",
            0x40 => "ky",
            0x2f => "mk",
            0x44 => "tt",
            0x09 => "en",
            _ => "other",
        }
        .to_string(),
    )
}

#[cfg(not(windows))]
fn system_language_impl() -> Option<String> {
    for var in ["LC_ALL", "LC_MESSAGES", "LANG", "LANGUAGE"] {
        if let Some(value) = std::env::var_os(var) {
            let value = value.to_string_lossy().to_ascii_lowercase();
            let first = value.split(':').next().unwrap_or("");
            let primary = first.split(['-', '_', '.', '@']).next().unwrap_or("");
            if !primary.is_empty() && primary != "c" && primary != "posix" {
                return Some(primary.to_string());
            }
        }
    }
    None
}

/// True when `language` is written in Cyrillic script.
pub fn is_cyrillic_language(language: &str) -> bool {
    matches!(
        language,
        "ru" | "uk" | "be" | "bg" | "kk" | "ky" | "mk" | "sr" | "tt" | "mn" | "tg" | "ba"
    )
}

/// Effective interface language for a stored setting.
pub fn resolve(setting: &str) -> String {
    match normalize_language(setting).as_str() {
        "system" => match system_language() {
            Some(lang) if SUPPORTED.contains(&lang.as_str()) => lang,
            // Other Cyrillic-script locales read Russian more easily than English.
            Some(lang) if is_cyrillic_language(&lang) => "ru".to_string(),
            _ => "en".to_string(),
        },
        other => other.to_string(),
    }
}

/// True when OCR and search defaults should cover Cyrillic text.
pub fn wants_cyrillic(setting: &str) -> bool {
    // An English interface on a Russian Windows still has Russian files.
    normalize_language(setting) == "ru"
        || system_language().is_some_and(|l| is_cyrillic_language(&l))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_settings() {
        assert_eq!(normalize_language("ru-RU"), "ru");
        assert_eq!(normalize_language("EN"), "en");
        assert_eq!(normalize_language(""), "system");
        assert_eq!(normalize_language("de"), "system");
    }

    #[test]
    fn explicit_language_wins_over_system() {
        assert_eq!(resolve("ru"), "ru");
        assert_eq!(resolve("en"), "en");
        assert!(wants_cyrillic("ru"));
    }

    #[test]
    fn cyrillic_languages() {
        for l in ["ru", "uk", "be", "kk"] {
            assert!(is_cyrillic_language(l));
        }
        assert!(!is_cyrillic_language("en"));
    }
}
