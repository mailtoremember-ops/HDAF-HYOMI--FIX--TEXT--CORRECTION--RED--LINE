// models.rs
// מבני הנתונים — קטגוריה היא שדה טקסט חופשי ברשומה עצמה

use serde::{Deserialize, Serialize};

// ── טון רגשי ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Tone {
    Positive,
    Neutral,
    Negative,
}

impl Tone {
    pub fn to_str(&self) -> &'static str {
        match self {
            Tone::Positive => "positive",
            Tone::Neutral  => "neutral",
            Tone::Negative => "negative",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "positive" => Some(Tone::Positive),
            "neutral"  => Some(Tone::Neutral),
            "negative" => Some(Tone::Negative),
            _          => None,
        }
    }
}

// ── רשומת יומן ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub id:         i64,
    pub content:    String,
    pub tone:       Option<Tone>,
    pub rating:     Option<i64>,  // 1–10
    pub category:   Option<String>, // טקסט חופשי, מוצפן
    pub created_at: String,         // ISO-8601
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct NewEntry {
    pub content:  String,
    pub tone:     Option<Tone>,
    pub rating:   Option<i64>,
    pub category: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateEntry {
    pub id:       i64,
    pub content:  String,
    pub tone:     Option<Tone>,
    pub rating:   Option<i64>,
    pub category: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SearchParams {
    pub query:     Option<String>, // חיפוש בתוכן
    pub category:  Option<String>, // חיפוש בקטגוריה (contains)
    pub date_from: Option<String>, // YYYY-MM-DD
    pub date_to:   Option<String>, // YYYY-MM-DD
}

// ── פתק ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id:         i64,
    pub title:      String,
    pub content:    String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct NewNote {
    pub title:   String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateNote {
    pub id:      i64,
    pub title:   String,
    pub content: String,
}

// ── תשובות כלליות ────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct DeleteResult {
    pub success: bool,
}

#[derive(Debug, Serialize)]
pub struct UnlockResult {
    pub success: bool,
}
