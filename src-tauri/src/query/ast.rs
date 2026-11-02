use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TermField {
    Any,
    Name,
    Content,
    Path,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Term {
    pub text: String,
    pub field: TermField,
    pub phrase: bool,
    pub is_regex: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FileKind {
    File,
    Dir,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RangeOp {
    Lt(u64),
    Lte(u64),
    Gt(u64),
    Gte(u64),
    Between(u64, u64),
}

impl RangeOp {
    pub fn matches(&self, value: u64) -> bool {
        match *self {
            RangeOp::Lt(target) => value < target,
            RangeOp::Lte(target) => value <= target,
            RangeOp::Gt(target) => value > target,
            RangeOp::Gte(target) => value >= target,
            RangeOp::Between(low, high) => value >= low && value <= high,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Filter {
    Ext(String),
    Type(String),
    Modified(RangeOp),
    Size(RangeOp),
    Kind(FileKind),
    Lang(String),
    Name(String),
    Path(String),
    Not(Box<Filter>),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Scope {
    pub dir_id: u64,
    pub include: bool,
    pub path: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Mode {
    Ranked,
    Exhaustive,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActiveFilterDto {
    pub raw: String,
    pub filter_type: String,
    pub value: String,
    pub negated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Query {
    pub terms: Vec<Term>,
    pub filters: Vec<Filter>,
    pub scopes: Vec<Scope>,
    pub mode: Mode,
    pub raw: String,
    pub hints: Vec<String>,
    pub active_filters_dto: Vec<ActiveFilterDto>,
    /// Pairs of term indices that must appear within `distance` words of each
    /// other (the `near[x]` operator). Indices refer to `terms`.
    #[serde(default)]
    pub proximity: Vec<(usize, usize, u32)>,
}
