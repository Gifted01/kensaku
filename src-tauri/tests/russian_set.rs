//! End-to-end Russian search: a small Cyrillic corpus goes through the full
//! search pipeline (natural-language intent, fuzzy names, BM25 with Russian
//! morphology, snippets), the way the app answers a query.

use kensaku_lib::config::KensakuConfig;
use kensaku_lib::embed::{DEFAULT_MODEL_ID, EMBEDDING_DIM, Unit, UnitStore};
use kensaku_lib::indexer::content::ContentIndex;
use kensaku_lib::indexer::metadata::MetadataStore;
use kensaku_lib::indexer::metadata_db::MetadataDb;
use kensaku_lib::indexer::walker::{FileEntry, intern_extension};
use kensaku_lib::search::fuzzy::compute_char_mask;
use kensaku_lib::search::{SearchDispatcher, SortOrder};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const DAY: u64 = 86_400;

/// (relative path, content, age in days)
const DOCS: &[(&str, &str, u64)] = &[
    (
        "Документы/Договор поставки Касперский.docx",
        "Договор поставки программного обеспечения. Стороны договорились о поставке лицензий \
         Kaspersky Endpoint Security для бизнеса сроком на один год.",
        40,
    ),
    (
        "Документы/Счёт на оплату 1543.pdf",
        "Счёт на оплату №1543 от 12 октября. Итого к оплате 1 250 000 рублей, в том числе НДС.",
        3,
    ),
    (
        "Документы/Счёт на оплату 0981.pdf",
        "Счёт на оплату №981. Продление технической поддержки.",
        200,
    ),
    (
        "Проекты/Отчёт о внедрении DLP.txt",
        "Отчёт о внедрении DLP-системы Solar Dozor: настроены политики, перехват почты и \
         мессенджеров, обработаны первые инциденты.",
        10,
    ),
    (
        "Презентации/Solar вендор.pptx",
        "Презентация вендора о защите конечных точек и управлении уязвимостями.",
        60,
    ),
    (
        "Pictures/Screenshots/скриншот ошибки vCenter.png",
        "Ошибка подключения к vCenter: сертификат недействителен, проверьте время на хосте.",
        2,
    ),
    (
        "notes/english notes.md",
        "Database indexing improves query performance. Invoice tracking.",
        5,
    ),
];

/// (query, expected path fragment as the top result)
const QUERIES: &[(&str, &str)] = &[
    // Morphology: forms that do not occur in the text.
    ("договоры касперского", "Договор поставки"),
    ("лицензия", "Договор поставки"),
    ("отчеты о внедрениях", "Отчёт о внедрении"),
    ("инцидент", "Отчёт о внедрении"),
    // ё/е and case.
    ("счет 1543", "Счёт на оплату 1543"),
    ("ДОГОВОР", "Договор поставки"),
    // File names typed in lowercase.
    ("договор поставки", "Договор поставки"),
    // Natural language in Russian.
    ("скриншоты за прошлую неделю", "скриншот ошибки"),
    ("последний счёт", "Счёт на оплату 1543"),
    ("презентация вендора", "Solar вендор"),
    ("вендора", "Solar вендор"),
    ("ext:pptx вендора", "Solar вендор"),
    ("ошибка сертификат", "скриншот ошибки"),
    // English still works.
    ("database indexing", "english notes"),
];

struct Corpus {
    dir: PathBuf,
    metadata: MetadataStore,
    content: Option<ContentIndex>,
    units: UnitStore,
}

impl Drop for Corpus {
    fn drop(&mut self) {
        self.content.take();
        let _ = fs::remove_dir_all(&self.dir);
    }
}

fn setup() -> Corpus {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    let dir = std::env::temp_dir().join(format!(
        "kensaku-ru-{}-{}",
        std::process::id(),
        now.as_nanos()
    ));
    fs::create_dir_all(&dir).unwrap();
    let db = MetadataDb::open_in_dir(&dir).unwrap();
    let content = ContentIndex::new(&dir).unwrap();
    let mut units = UnitStore::new(EMBEDDING_DIM);

    for (i, (rel, text, age)) in DOCS.iter().enumerate() {
        let id = (i + 1) as u64;
        let path = dir.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, text).unwrap();
        let name = path.file_name().unwrap().to_str().unwrap().to_string();
        let modified = now.as_secs() - age * DAY;
        db.upsert(&FileEntry {
            id,
            path: path.clone(),
            name: name.clone(),
            extension: intern_extension(path.extension().and_then(|e| e.to_str())),
            size: text.len() as u64,
            modified,
            is_dir: false,
            dev: 0,
            ino: id,
            char_bloom: compute_char_mask(&name),
            content_pending: false,
        })
        .unwrap();
        content
            .add_or_update(
                &path,
                &name,
                text,
                modified,
                text.len() as u64,
                path.extension().and_then(|e| e.to_str()),
            )
            .unwrap();
        let vec = kensaku_lib::embed::model::ModelRegistry::global().embed_to_i8(text);
        units.add_unit(
            Unit {
                id,
                node_id: id,
                byte_start: 0,
                byte_end: text.len(),
                model_id: DEFAULT_MODEL_ID,
            },
            &vec,
        );
    }
    content.commit().unwrap();
    Corpus {
        dir,
        metadata: MetadataStore::with_db(db),
        content: Some(content),
        units,
    }
}

#[test]
fn russian_queries_find_the_right_file() {
    let corpus = setup();
    let aliases = KensakuConfig::default().alias_pairs();
    let mut failures = Vec::new();

    for (seq, (query, expected)) in QUERIES.iter().enumerate() {
        let response = SearchDispatcher::search_response_fast_sorted_with_snippets(
            query,
            &corpus.metadata,
            &corpus.content,
            Some(&corpus.units),
            true,
            10,
            seq as u64 + 1,
            SortOrder::Best,
            &aliases,
            0,
            false,
        );
        let names: Vec<String> = response
            .results
            .iter()
            .map(|r| r.filename.clone())
            .collect();
        let top_ok = response
            .results
            .first()
            .is_some_and(|r| r.path.contains(expected));
        println!(
            "{query:<32} → {:?}",
            names.iter().take(3).collect::<Vec<_>>()
        );
        if !top_ok {
            failures.push(format!(
                "{query:?}: expected {expected:?} first, got {names:?}"
            ));
        }
    }
    assert!(failures.is_empty(), "\n{}", failures.join("\n"));
}

#[test]
fn russian_intent_is_reported_as_chips() {
    let corpus = setup();
    let aliases = KensakuConfig::default().alias_pairs();
    let response = SearchDispatcher::search_response_fast_sorted_with_snippets(
        "скриншоты за прошлую неделю",
        &corpus.metadata,
        &corpus.content,
        Some(&corpus.units),
        true,
        10,
        1,
        SortOrder::Best,
        &aliases,
        0,
        false,
    );
    // Only the recent screenshot qualifies: type:image and the 7-day window.
    assert_eq!(response.results.len(), 1, "{:?}", response.results);
    assert!(response.results[0].filename.contains("скриншот"));
}
