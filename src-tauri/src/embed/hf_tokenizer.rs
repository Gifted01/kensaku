//! A small, dependency-light subset of the HuggingFace `tokenizers` pipeline.
//!
//! The original static table only understood BERT WordPiece tokenizers
//! (`potion-base-8M`). Multilingual static models such as
//! `potion-multilingual-128M` ship an XLM-R style SentencePiece tokenizer:
//! a `Unigram` model behind a `Metaspace` pre-tokenizer. This module parses
//! the parts of `tokenizer.json` those models use:
//!
//! * normalizers: `Sequence`, `Lowercase`, `NFC`/`NFD`/`NFKC`/`NFKD`,
//!   `StripAccents`, `Strip`, `Replace` (string patterns), `Prepend`,
//!   `BertNormalizer`, `Nmt`, and `Precompiled` (approximated by NFKC, which is
//!   what SentencePiece's default charsmap implements);
//! * pre-tokenizers: `Sequence`, `Metaspace`, `WhitespaceSplit`, `Whitespace`,
//!   `BertPreTokenizer`, `Punctuation`, `Digits`;
//! * models: `Unigram` (Viterbi segmentation, same tie-breaking as
//!   `tokenizers`) and `WordPiece`.
//!
//! Anything outside that subset makes [`HfTokenizer::parse`] return `None`, and
//! callers fall back exactly as they do for a missing model.

use serde_json::Value;
use std::collections::HashMap;
use unicode_normalization::UnicodeNormalization;
use unicode_normalization::char::is_combining_mark;

/// Longest word (in characters) that is segmented; see [`HfTokenizer::encode`].
const MAX_WORD_CHARS: usize = 256;

/// Matches `tokenizers`' `K_UNK_PENALTY`.
const UNK_PENALTY: f64 = 10.0;

#[derive(Debug, Clone)]
enum Normalizer {
    Lowercase,
    Nfc,
    Nfd,
    Nfkc,
    Nfkd,
    StripAccents,
    Strip {
        left: bool,
        right: bool,
    },
    Replace {
        from: String,
        to: String,
    },
    /// Regex ` {2,}` → `to`: every run of two or more spaces.
    CollapseSpaces(String),
    /// Any other `Replace` regex (e.g. `\s+` in potion-multilingual-128M).
    RegexReplace(regex::Regex, String),
    Prepend(String),
    Bert {
        clean_text: bool,
        chinese_chars: bool,
        strip_accents: bool,
        lowercase: bool,
    },
    Nmt,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Prepend {
    Always,
    First,
    Never,
}

#[derive(Debug, Clone)]
enum PreTokenizer {
    Metaspace {
        replacement: char,
        prepend: Prepend,
        split: bool,
    },
    WhitespaceSplit,
    Whitespace,
    Bert,
    Punctuation,
    Digits {
        individual: bool,
    },
}

#[derive(Debug, Clone)]
enum Model {
    Unigram {
        pieces: HashMap<String, (u32, f64)>,
        max_piece_bytes: usize,
        unk_id: Option<u32>,
        unk_score: f64,
    },
    WordPiece {
        vocab: HashMap<String, u32>,
        unk_id: u32,
        prefix: String,
        max_input_chars: usize,
    },
}

/// A parsed `tokenizer.json`.
#[derive(Debug, Clone)]
pub struct HfTokenizer {
    normalizers: Vec<Normalizer>,
    pre_tokenizers: Vec<PreTokenizer>,
    model: Model,
    /// Total number of ids the model can emit (for bounds checks).
    pub vocab_size: usize,
}

impl HfTokenizer {
    /// Parses a `tokenizer.json` value. Returns `None` for unsupported parts.
    pub fn parse(value: &Value) -> Option<Self> {
        let mut normalizers = Vec::new();
        if let Some(n) = value.get("normalizer").filter(|v| !v.is_null()) {
            parse_normalizer(n, &mut normalizers)?;
        }
        let mut pre_tokenizers = Vec::new();
        if let Some(p) = value.get("pre_tokenizer").filter(|v| !v.is_null()) {
            parse_pre_tokenizer(p, &mut pre_tokenizers)?;
        }
        let (model, vocab_size) = parse_model(value.get("model")?)?;
        Some(Self {
            normalizers,
            pre_tokenizers,
            model,
            vocab_size,
        })
    }

    /// True when the model is a SentencePiece Unigram model.
    pub fn is_unigram(&self) -> bool {
        matches!(self.model, Model::Unigram { .. })
    }

    /// The id of the unknown token, when the vocabulary has one.
    pub fn unk_id(&self) -> Option<u32> {
        match &self.model {
            Model::Unigram { unk_id, .. } => *unk_id,
            Model::WordPiece { unk_id, .. } => Some(*unk_id),
        }
    }

    /// Encodes `text` without special tokens, keeping at most `max_tokens` ids.
    pub fn encode(&self, text: &str, max_tokens: usize) -> Vec<u32> {
        let normalized = self.normalize(text);
        let mut ids = Vec::new();
        for word in self.pre_tokenize(&normalized) {
            // A "word" can be a whole base64 blob or minified line. Segmenting
            // it costs O(length × longest piece) for at most a few useful
            // tokens, so only its start is used.
            let word = match word.char_indices().nth(MAX_WORD_CHARS) {
                Some((cut, _)) => &word[..cut],
                None => word.as_str(),
            };
            match &self.model {
                Model::Unigram {
                    pieces,
                    max_piece_bytes,
                    unk_id,
                    unk_score,
                } => viterbi(
                    word,
                    pieces,
                    *max_piece_bytes,
                    *unk_id,
                    *unk_score,
                    &mut ids,
                ),
                Model::WordPiece {
                    vocab,
                    unk_id,
                    prefix,
                    max_input_chars,
                } => wordpiece(word, vocab, *unk_id, prefix, *max_input_chars, &mut ids),
            }
            if ids.len() >= max_tokens {
                ids.truncate(max_tokens);
                break;
            }
        }
        ids
    }

    /// Token strings for `text` (tests and diagnostics).
    pub fn tokens(&self, text: &str) -> Vec<String> {
        let reverse: HashMap<u32, &str> = match &self.model {
            Model::Unigram { pieces, .. } => pieces
                .iter()
                .map(|(k, (id, _))| (*id, k.as_str()))
                .collect(),
            Model::WordPiece { vocab, .. } => {
                vocab.iter().map(|(k, id)| (*id, k.as_str())).collect()
            }
        };
        self.encode(text, usize::MAX)
            .into_iter()
            .map(|id| reverse.get(&id).copied().unwrap_or("<unk>").to_string())
            .collect()
    }

    fn normalize(&self, text: &str) -> String {
        let mut s = text.to_string();
        for n in &self.normalizers {
            s = match n {
                Normalizer::Lowercase => s.to_lowercase(),
                Normalizer::Nfc => s.nfc().collect(),
                Normalizer::Nfd => s.nfd().collect(),
                Normalizer::Nfkc => s.nfkc().collect(),
                Normalizer::Nfkd => s.nfkd().collect(),
                Normalizer::StripAccents => s.chars().filter(|c| !is_combining_mark(*c)).collect(),
                Normalizer::Strip { left, right } => {
                    let mut t: &str = &s;
                    if *left {
                        t = t.trim_start();
                    }
                    if *right {
                        t = t.trim_end();
                    }
                    t.to_string()
                }
                Normalizer::Replace { from, to } => {
                    if from.is_empty() {
                        s
                    } else {
                        s.replace(from.as_str(), to)
                    }
                }
                Normalizer::RegexReplace(re, to) => re.replace_all(&s, to.as_str()).into_owned(),
                Normalizer::CollapseSpaces(to) => {
                    let mut out = String::with_capacity(s.len());
                    let mut run = 0usize;
                    for c in s.chars() {
                        if c == ' ' {
                            run += 1;
                            continue;
                        }
                        match run {
                            0 => {}
                            1 => out.push(' '),
                            _ => out.push_str(to),
                        }
                        run = 0;
                        out.push(c);
                    }
                    match run {
                        0 => {}
                        1 => out.push(' '),
                        _ => out.push_str(to),
                    }
                    out
                }
                Normalizer::Prepend(p) => {
                    if s.is_empty() {
                        s
                    } else {
                        format!("{p}{s}")
                    }
                }
                Normalizer::Bert {
                    clean_text,
                    chinese_chars,
                    strip_accents,
                    lowercase,
                } => bert_normalize(&s, *clean_text, *chinese_chars, *strip_accents, *lowercase),
                Normalizer::Nmt => s
                    .chars()
                    .filter_map(|c| match c as u32 {
                        0x0001..=0x0008 | 0x000B | 0x000E..=0x001F | 0x007F | 0x008F | 0x009F => {
                            None
                        }
                        0x0009
                        | 0x000A
                        | 0x000C
                        | 0x000D
                        | 0x1680
                        | 0x200B..=0x200F
                        | 0x2028
                        | 0x2029
                        | 0x2581
                        | 0xFEFF
                        | 0xFFFD => Some(' '),
                        _ => Some(c),
                    })
                    .collect(),
            };
        }
        s
    }

    /// Applies the pre-tokenizer chain. Each stage splits every piece produced
    /// by the previous one; `first_offset` tracks whether a piece starts the
    /// original text (for `prepend_scheme: "first"`).
    fn pre_tokenize(&self, text: &str) -> Vec<String> {
        let mut pieces: Vec<(String, bool)> = vec![(text.to_string(), true)];
        if self.pre_tokenizers.is_empty() {
            return pieces
                .into_iter()
                .map(|(p, _)| p)
                .filter(|p| !p.is_empty())
                .collect();
        }
        for pt in &self.pre_tokenizers {
            let mut next = Vec::new();
            for (piece, is_first) in pieces {
                for (i, part) in split_with(pt, &piece, is_first).into_iter().enumerate() {
                    next.push((part, is_first && i == 0));
                }
            }
            pieces = next;
        }
        pieces
            .into_iter()
            .map(|(p, _)| p)
            .filter(|p| !p.is_empty())
            .collect()
    }
}

fn split_with(pt: &PreTokenizer, piece: &str, is_first: bool) -> Vec<String> {
    match pt {
        PreTokenizer::Metaspace {
            replacement,
            prepend,
            split,
        } => {
            if piece.is_empty() {
                return Vec::new();
            }
            let mut s: String = piece
                .chars()
                .map(|c| if c == ' ' { *replacement } else { c })
                .collect();
            let wants_prefix = match prepend {
                Prepend::Always => true,
                Prepend::First => is_first,
                Prepend::Never => false,
            };
            if wants_prefix && !s.starts_with(*replacement) {
                s.insert(0, *replacement);
            }
            if !*split {
                return vec![s];
            }
            // MergedWithNext: every replacement char starts a new piece.
            let mut out = Vec::new();
            let mut cur = String::new();
            for c in s.chars() {
                if c == *replacement && !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
                cur.push(c);
            }
            if !cur.is_empty() {
                out.push(cur);
            }
            out
        }
        PreTokenizer::WhitespaceSplit => piece.split_whitespace().map(str::to_string).collect(),
        PreTokenizer::Whitespace => {
            // Regex `\w+|[^\w\s]+`
            let mut out = Vec::new();
            let mut cur = String::new();
            let mut cur_word: Option<bool> = None;
            for c in piece.chars() {
                if c.is_whitespace() {
                    if !cur.is_empty() {
                        out.push(std::mem::take(&mut cur));
                    }
                    cur_word = None;
                    continue;
                }
                let w = is_word_char(c);
                if cur_word.is_some_and(|cw| cw != w) {
                    out.push(std::mem::take(&mut cur));
                }
                cur_word = Some(w);
                cur.push(c);
            }
            if !cur.is_empty() {
                out.push(cur);
            }
            out
        }
        PreTokenizer::Bert | PreTokenizer::Punctuation => {
            let split_ws = matches!(pt, PreTokenizer::Bert);
            let mut out = Vec::new();
            let mut cur = String::new();
            for c in piece.chars() {
                if split_ws && c.is_whitespace() {
                    if !cur.is_empty() {
                        out.push(std::mem::take(&mut cur));
                    }
                } else if is_punctuation(c) {
                    if !cur.is_empty() {
                        out.push(std::mem::take(&mut cur));
                    }
                    out.push(c.to_string());
                } else {
                    cur.push(c);
                }
            }
            if !cur.is_empty() {
                out.push(cur);
            }
            out
        }
        PreTokenizer::Digits { individual } => {
            let mut out = Vec::new();
            let mut cur = String::new();
            let mut cur_digit: Option<bool> = None;
            for c in piece.chars() {
                let d = c.is_ascii_digit();
                let boundary = match cur_digit {
                    Some(cd) => cd != d || (d && *individual),
                    None => false,
                };
                if boundary && !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
                cur_digit = Some(d);
                cur.push(c);
            }
            if !cur.is_empty() {
                out.push(cur);
            }
            out
        }
    }
}

/// Unigram Viterbi segmentation, mirroring `tokenizers`' optimized encoder:
/// candidate pieces are tried shortest-first and only a strictly better score
/// replaces a node, and a single-character `<unk>` is offered only when no
/// single-character piece exists at that position.
fn viterbi(
    word: &str,
    pieces: &HashMap<String, (u32, f64)>,
    max_piece_bytes: usize,
    unk_id: Option<u32>,
    unk_score: f64,
    out: &mut Vec<u32>,
) {
    if word.is_empty() {
        return;
    }
    let bounds: Vec<usize> = word
        .char_indices()
        .map(|(i, _)| i)
        .chain(std::iter::once(word.len()))
        .collect();
    let n = bounds.len() - 1;
    // best[i] = (score, id, start_char_index) for prefix ending at char i.
    let mut best: Vec<Option<(f64, Option<u32>, usize)>> = vec![None; n + 1];
    best[0] = Some((0.0, None, 0));
    for i in 0..n {
        let Some((base, _, _)) = best[i] else {
            continue;
        };
        let mut has_single = false;
        for j in (i + 1)..=n {
            let bytes = bounds[j] - bounds[i];
            if bytes > max_piece_bytes {
                break;
            }
            let piece = &word[bounds[i]..bounds[j]];
            if let Some(&(id, score)) = pieces.get(piece) {
                if j == i + 1 {
                    has_single = true;
                }
                let cand = base + score;
                if best[j].is_none_or(|(s, _, _)| cand > s) {
                    best[j] = Some((cand, Some(id), i));
                }
            }
        }
        if !has_single {
            let cand = base + unk_score;
            if best[i + 1].is_none_or(|(s, _, _)| cand > s) {
                best[i + 1] = Some((cand, unk_id, i));
            }
        }
    }
    let mut seq = Vec::new();
    let mut pos = n;
    while pos > 0 {
        let Some((_, id, start)) = best[pos] else {
            return;
        };
        seq.push(id);
        pos = start;
    }
    seq.reverse();
    // fuse_unk: consecutive unknowns become one id.
    let mut prev_unk = false;
    for id in seq {
        match id {
            Some(id) if Some(id) != unk_id => {
                out.push(id);
                prev_unk = false;
            }
            _ => {
                if !prev_unk && let Some(u) = unk_id {
                    out.push(u);
                }
                prev_unk = true;
            }
        }
    }
}

fn wordpiece(
    word: &str,
    vocab: &HashMap<String, u32>,
    unk_id: u32,
    prefix: &str,
    max_input_chars: usize,
    out: &mut Vec<u32>,
) {
    if let Some(&id) = vocab.get(word) {
        out.push(id);
        return;
    }
    let chars: Vec<char> = word.chars().collect();
    if chars.len() > max_input_chars {
        out.push(unk_id);
        return;
    }
    let mut start = 0;
    let mut pieces = Vec::new();
    while start < chars.len() {
        let mut end = chars.len();
        let mut found = None;
        while end > start {
            let mut piece: String = chars[start..end].iter().collect();
            if start > 0 {
                piece.insert_str(0, prefix);
            }
            if let Some(&id) = vocab.get(&piece) {
                found = Some(id);
                break;
            }
            end -= 1;
        }
        match found {
            Some(id) => {
                pieces.push(id);
                start = end;
            }
            None => {
                out.push(unk_id);
                return;
            }
        }
    }
    out.extend(pieces);
}

/// Short description of a tokenizer's parts, e.g.
/// `normalizer Sequence[Precompiled, Replace(Regex), Strip]; pre_tokenizer
/// Metaspace; model Unigram`, for error messages about unsupported files.
pub fn describe(value: &Value) -> String {
    fn part(v: &Value) -> String {
        let Some(kind) = v.get("type").and_then(Value::as_str) else {
            return "none".to_string();
        };
        let children = v
            .get("normalizers")
            .or_else(|| v.get("pretokenizers"))
            .and_then(Value::as_array);
        match (kind, children) {
            (_, Some(list)) => format!(
                "{kind}[{}]",
                list.iter().map(part).collect::<Vec<_>>().join(", ")
            ),
            ("Replace", None) => {
                let pattern = v
                    .get("pattern")
                    .and_then(|p| p.get("Regex").map(|r| format!("Regex {r}")))
                    .unwrap_or_else(|| "String".to_string());
                format!("Replace({pattern})")
            }
            ("Split", None) => format!(
                "Split({})",
                v.get("pattern").map(|p| p.to_string()).unwrap_or_default()
            ),
            _ => kind.to_string(),
        }
    }
    let model = value
        .get("model")
        .and_then(|m| m.get("type"))
        .and_then(Value::as_str)
        .unwrap_or("?");
    format!(
        "normalizer {}; pre_tokenizer {}; model {model}",
        value.get("normalizer").map(part).unwrap_or_else(|| "none".into()),
        value.get("pre_tokenizer").map(part).unwrap_or_else(|| "none".into()),
    )
}

fn parse_normalizer(v: &Value, out: &mut Vec<Normalizer>) -> Option<()> {
    let kind = v.get("type")?.as_str()?;
    match kind {
        "Sequence" => {
            for n in v.get("normalizers")?.as_array()? {
                parse_normalizer(n, out)?;
            }
        }
        "Lowercase" => out.push(Normalizer::Lowercase),
        "NFC" => out.push(Normalizer::Nfc),
        "NFD" => out.push(Normalizer::Nfd),
        "NFKC" | "Precompiled" => out.push(Normalizer::Nfkc),
        "NFKD" => out.push(Normalizer::Nfkd),
        "StripAccents" => out.push(Normalizer::StripAccents),
        "Strip" => out.push(Normalizer::Strip {
            left: v.get("strip_left").and_then(Value::as_bool).unwrap_or(true),
            right: v
                .get("strip_right")
                .and_then(Value::as_bool)
                .unwrap_or(true),
        }),
        "Replace" => {
            let pattern = v.get("pattern")?;
            if let Some(s) = pattern.get("String").and_then(Value::as_str) {
                out.push(Normalizer::Replace {
                    from: s.to_string(),
                    to: v.get("content")?.as_str()?.to_string(),
                });
            } else {
                let r = pattern.get("Regex").and_then(Value::as_str)?;
                let to = v.get("content")?.as_str()?.to_string();
                if r == " {2,}" {
                    out.push(Normalizer::CollapseSpaces(to));
                } else {
                    // tokenizers uses Oniguruma; the simple patterns found in
                    // real files (`\s+`, character classes) mean the same in
                    // the `regex` crate. Anything it cannot compile rejects
                    // the tokenizer rather than tokenizing differently.
                    out.push(Normalizer::RegexReplace(regex::Regex::new(r).ok()?, to));
                }
            }
        }
        "Prepend" => out.push(Normalizer::Prepend(v.get("prepend")?.as_str()?.to_string())),
        "BertNormalizer" => {
            let lowercase = v.get("lowercase").and_then(Value::as_bool).unwrap_or(true);
            out.push(Normalizer::Bert {
                clean_text: v.get("clean_text").and_then(Value::as_bool).unwrap_or(true),
                chinese_chars: v
                    .get("handle_chinese_chars")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
                // `null` means "follow lowercase", as in tokenizers.
                strip_accents: v
                    .get("strip_accents")
                    .and_then(Value::as_bool)
                    .unwrap_or(lowercase),
                lowercase,
            });
        }
        "Nmt" => out.push(Normalizer::Nmt),
        _ => return None,
    }
    Some(())
}

fn parse_pre_tokenizer(v: &Value, out: &mut Vec<PreTokenizer>) -> Option<()> {
    let kind = v.get("type")?.as_str()?;
    match kind {
        "Sequence" => {
            for p in v.get("pretokenizers")?.as_array()? {
                parse_pre_tokenizer(p, out)?;
            }
        }
        "Metaspace" => {
            let replacement = v
                .get("replacement")
                .and_then(Value::as_str)
                .and_then(|s| s.chars().next())
                .unwrap_or('\u{2581}');
            let prepend = match v.get("prepend_scheme").and_then(Value::as_str) {
                Some("always") => Prepend::Always,
                Some("first") => Prepend::First,
                Some("never") => Prepend::Never,
                _ => {
                    if v.get("add_prefix_space")
                        .and_then(Value::as_bool)
                        .unwrap_or(true)
                    {
                        Prepend::Always
                    } else {
                        Prepend::Never
                    }
                }
            };
            out.push(PreTokenizer::Metaspace {
                replacement,
                prepend,
                split: v.get("split").and_then(Value::as_bool).unwrap_or(true),
            });
        }
        "WhitespaceSplit" => out.push(PreTokenizer::WhitespaceSplit),
        "Whitespace" => out.push(PreTokenizer::Whitespace),
        "BertPreTokenizer" => out.push(PreTokenizer::Bert),
        "Punctuation" => out.push(PreTokenizer::Punctuation),
        "Digits" => out.push(PreTokenizer::Digits {
            individual: v
                .get("individual_digits")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        }),
        _ => return None,
    }
    Some(())
}

fn parse_model(v: &Value) -> Option<(Model, usize)> {
    let kind = v.get("type").and_then(Value::as_str).unwrap_or_else(|| {
        // Older files omit `type`; infer from the vocab shape.
        if v.get("vocab").is_some_and(Value::is_array) {
            "Unigram"
        } else {
            "WordPiece"
        }
    });
    match kind {
        "Unigram" => {
            let vocab = v.get("vocab")?.as_array()?;
            let mut pieces = HashMap::with_capacity(vocab.len());
            let mut min_score = f64::INFINITY;
            let mut max_piece_bytes = 0;
            for (id, entry) in vocab.iter().enumerate() {
                let pair = entry.as_array()?;
                let piece = pair.first()?.as_str()?;
                let score = pair.get(1)?.as_f64()?;
                min_score = min_score.min(score);
                max_piece_bytes = max_piece_bytes.max(piece.len());
                // First occurrence wins, like a trie insert-if-absent.
                pieces
                    .entry(piece.to_string())
                    .or_insert((id as u32, score));
            }
            if pieces.is_empty() {
                return None;
            }
            let unk_id = v.get("unk_id").and_then(Value::as_u64).map(|u| u as u32);
            Some((
                Model::Unigram {
                    pieces,
                    max_piece_bytes,
                    unk_id,
                    unk_score: min_score - UNK_PENALTY,
                },
                vocab.len(),
            ))
        }
        "WordPiece" => {
            let obj = v.get("vocab")?.as_object()?;
            let mut vocab = HashMap::with_capacity(obj.len());
            let mut size = 0usize;
            for (k, id) in obj {
                let id = id.as_u64()? as u32;
                size = size.max(id as usize + 1);
                vocab.insert(k.clone(), id);
            }
            let unk = v
                .get("unk_token")
                .and_then(Value::as_str)
                .unwrap_or("[UNK]");
            let unk_id = vocab.get(unk).copied().unwrap_or(0);
            Some((
                Model::WordPiece {
                    vocab,
                    unk_id,
                    prefix: v
                        .get("continuing_subword_prefix")
                        .and_then(Value::as_str)
                        .unwrap_or("##")
                        .to_string(),
                    max_input_chars: v
                        .get("max_input_chars_per_word")
                        .and_then(Value::as_u64)
                        .unwrap_or(100) as usize,
                },
                size,
            ))
        }
        _ => None,
    }
}

fn bert_normalize(s: &str, clean: bool, chinese: bool, strip_accents: bool, lower: bool) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if clean {
            if c == '\0' || c == '\u{fffd}' || (c.is_control() && !c.is_whitespace()) {
                continue;
            }
            if c.is_whitespace() {
                out.push(' ');
                continue;
            }
        }
        if chinese && crate::indexer::tokenizer::is_cjk(c) {
            out.push(' ');
            out.push(c);
            out.push(' ');
        } else {
            out.push(c);
        }
    }
    if strip_accents {
        out = out.nfd().filter(|c| !is_combining_mark(*c)).collect();
    }
    if lower {
        out = out.to_lowercase();
    }
    out
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || is_combining_mark(c)
}

fn is_punctuation(c: char) -> bool {
    if c.is_ascii() {
        c.is_ascii_punctuation()
    } else {
        // Unicode general category P*: approximate with "not alnum, not
        // whitespace, not a symbol letter".
        !c.is_alphanumeric()
            && !c.is_whitespace()
            && !is_combining_mark(c)
            && !c.is_control()
            && matches!(c as u32, 0x2010..=0x2027 | 0x2030..=0x205E | 0x3000..=0x303F | 0x00A1 | 0x00A7 | 0x00AB | 0x00B6 | 0x00B7 | 0x00BB | 0x00BF | 0xFF01..=0xFF0F | 0xFF1A..=0xFF20)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn xlmr_like(vocab: &[(&str, f64)]) -> HfTokenizer {
        let vocab: Vec<Value> = vocab.iter().map(|(p, s)| json!([p, s])).collect();
        HfTokenizer::parse(&json!({
            "normalizer": {"type": "Sequence", "normalizers": [
                {"type": "Precompiled", "precompiled_charsmap": "AAAA"},
                {"type": "Replace", "pattern": {"Regex": " {2,}"}, "content": " "}
            ]},
            "pre_tokenizer": {"type": "Metaspace", "replacement": "▁", "prepend_scheme": "always", "split": true},
            "model": {"type": "Unigram", "unk_id": 1, "vocab": vocab}
        }))
        .expect("parse")
    }

    #[test]
    fn unigram_prefers_best_scoring_segmentation() {
        let t = xlmr_like(&[
            ("<pad>", 0.0),
            ("<unk>", 0.0),
            ("▁дого", -5.0),
            ("вор", -5.0),
            ("▁договор", -6.0),
            ("а", -3.0),
            ("▁", -2.0),
        ]);
        assert_eq!(t.tokens("договора"), vec!["▁договор", "а"]);
    }

    #[test]
    fn unknown_characters_fuse_into_one_unk() {
        let t = xlmr_like(&[("<pad>", 0.0), ("<unk>", 0.0), ("▁", -1.0), ("а", -1.0)]);
        assert_eq!(t.encode("ЖЖа", 100), vec![2, 1, 3]);
    }

    #[test]
    fn unsupported_model_is_rejected() {
        assert!(HfTokenizer::parse(&json!({"model": {"type": "BPE", "vocab": {}}})).is_none());
    }
}

/// Parity with the reference `tokenizers` library. The fixtures in
/// `testdata/` were produced by `tokenizers` 0.23 (Python) from a small
/// Russian/English corpus: one XLM-R style pipeline (NFKC, space collapse,
/// lowercase, Metaspace) over a Unigram model and one over WordPiece, plus the
/// exact ids `tokenizers` emits for ~330 strings including ё, CJK, unknown
/// characters, full-width forms and repeated spaces.
#[cfg(test)]
mod parity_tests {
    use super::*;

    fn check(tokenizer_json: &str, cases_json: &str) {
        let t = HfTokenizer::parse(&serde_json::from_str(tokenizer_json).unwrap()).unwrap();
        let cases: Vec<Value> = serde_json::from_str(cases_json).unwrap();
        let mut failures = Vec::new();
        for case in &cases {
            let text = case["text"].as_str().unwrap();
            let want: Vec<u32> = case["ids"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_u64().unwrap() as u32)
                .collect();
            let got = t.encode(text, usize::MAX);
            if got != want {
                failures.push(format!("{text:?}\n  want {want:?}\n  got  {got:?}"));
            }
        }
        assert!(
            failures.is_empty(),
            "{} of {} cases differ:\n{}",
            failures.len(),
            cases.len(),
            failures
                .iter()
                .take(5)
                .cloned()
                .collect::<Vec<_>>()
                .join("\n")
        );
    }

    #[test]
    fn unigram_metaspace_matches_reference() {
        check(
            include_str!("testdata/unigram_metaspace.json"),
            include_str!("testdata/unigram_metaspace_cases.json"),
        );
    }

    #[test]
    fn xlmr_whitespace_regex_matches_reference() {
        check(
            include_str!("testdata/unigram_regex_ws.json"),
            include_str!("testdata/unigram_regex_ws_cases.json"),
        );
    }

    #[test]
    fn wordpiece_metaspace_matches_reference() {
        check(
            include_str!("testdata/wordpiece_metaspace.json"),
            include_str!("testdata/wordpiece_metaspace_cases.json"),
        );
    }
}
