// db.rs v3
// שכבת DB — קטגוריה היא שדה טקסט מוצפן ברשומה, ללא טבלת categories

use rusqlite::{Connection, params};
use thiserror::Error;

use crate::crypto::{self, CryptoError, DerivedKey};
use crate::models::*;

// ── שגיאות ──────────────────────────────────────────────────

#[derive(Debug, Error)]
pub enum DbError {
    #[error("שגיאת DB: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("שגיאת הצפנה: {0}")]
    Crypto(#[from] CryptoError),
    #[error("רשומה לא נמצאה")]
    NotFound,
}

impl serde::Serialize for DbError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where S: serde::Serializer {
        serializer.serialize_str(&self.to_string())
    }
}

// ── אתחול ───────────────────────────────────────────────────

pub fn open(path: &str) -> Result<Connection, DbError> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), DbError> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS entries (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            content    TEXT NOT NULL,   -- מוצפן
            tone       TEXT,            -- 'positive'|'neutral'|'negative'
            rating     INTEGER,         -- 1-10
            category   TEXT,            -- מוצפן, טקסט חופשי
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );

        CREATE TABLE IF NOT EXISTS notes (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            title      TEXT NOT NULL,   -- מוצפן
            content    TEXT NOT NULL,   -- מוצפן
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );
    ")?;
    Ok(())
}

// ── meta ─────────────────────────────────────────────────────

pub fn get_meta(conn: &Connection, key: &str) -> Result<Option<String>, DbError> {
    let mut stmt = conn.prepare("SELECT value FROM meta WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    Ok(rows.next()?.map(|r| r.get(0).unwrap()))
}

pub fn set_meta(conn: &Connection, key: &str, value: &str) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn is_initialized(conn: &Connection) -> Result<bool, DbError> {
    Ok(get_meta(conn, "salt")?.is_some())
}

pub fn initialize(conn: &Connection) -> Result<String, DbError> {
    let salt     = crypto::generate_salt();
    let salt_hex = crypto::salt_to_hex(&salt);
    set_meta(conn, "salt", &salt_hex)?;
    Ok(salt_hex)
}

pub fn get_salt(conn: &Connection) -> Result<String, DbError> {
    get_meta(conn, "salt")?.ok_or(DbError::NotFound)
}

// ── הצפנה מחדש של כל הנתונים (לשינוי סיסמה) ────────────────
//
// מצפינה מחדש את כל entries ו-notes, ומעדכנת salt + check_value —
// הכל בטרנזקציה SQL אחת.  אם כל שלב כלשהו נכשל, ה-DB חוזר
// למצבו הקודם ללא שום שינוי (אטומי לחלוטין).

pub fn reencrypt_all(
    conn:         &Connection,
    old_key:      &DerivedKey,
    new_key:      &DerivedKey,
    new_salt_hex: &str,
    new_check:    &str,
) -> Result<(), DbError> {
    // BEGIN IMMEDIATE — נועל את ה-DB לכתיבה מיידית,
    // מונע race condition עם קריאות מקבילות.
    conn.execute_batch("BEGIN IMMEDIATE")?;

    let result: Result<(), DbError> = (|| {
        // ── entries ──────────────────────────────────────────
        let entry_rows: Vec<(i64, String, Option<String>)> = {
            let mut stmt = conn.prepare(
                "SELECT id, content, category FROM entries"
            )?;
            let rows = stmt.query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })?
            .collect::<Result<_, _>>()?;
            rows
        };

        for (id, enc_content, enc_category) in entry_rows {
            let plain_content   = crypto::decrypt(&enc_content, old_key)?;
            let new_enc_content = crypto::encrypt(&plain_content, new_key)?;

            let new_enc_category: Option<String> = enc_category
                .as_deref()
                .map(|c| -> Result<String, DbError> {
                    let plain = crypto::decrypt(c, old_key)?;
                    Ok(crypto::encrypt(&plain, new_key)?)
                })
                .transpose()?;

            conn.execute(
                "UPDATE entries SET content = ?1, category = ?2 WHERE id = ?3",
                params![new_enc_content, new_enc_category, id],
            )?;
        }

        // ── notes ────────────────────────────────────────────
        let note_rows: Vec<(i64, String, String)> = {
            let mut stmt = conn.prepare(
                "SELECT id, title, content FROM notes"
            )?;
            let rows = stmt.query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })?
            .collect::<Result<_, _>>()?;
            rows
        };

        for (id, enc_title, enc_content) in note_rows {
            let plain_title     = crypto::decrypt(&enc_title,   old_key)?;
            let plain_content   = crypto::decrypt(&enc_content, old_key)?;
            let new_enc_title   = crypto::encrypt(&plain_title,   new_key)?;
            let new_enc_content = crypto::encrypt(&plain_content, new_key)?;

            conn.execute(
                "UPDATE notes SET title = ?1, content = ?2 WHERE id = ?3",
                params![new_enc_title, new_enc_content, id],
            )?;
        }

        // ── salt + check_value (באותה טרנזקציה!) ────────────
        set_meta(conn, "salt",        new_salt_hex)?;
        set_meta(conn, "check_value", new_check)?;

        Ok(())
    })();

    // COMMIT רק אם הכל הצליח; אחרת ROLLBACK — DB לא ישתנה כלל
    match result {
        Ok(()) => { conn.execute_batch("COMMIT")?;   Ok(()) }
        Err(e) => { let _ = conn.execute_batch("ROLLBACK"); Err(e) }
    }
}

// ── entries ──────────────────────────────────────────────────

pub fn create_entry(
    conn:  &Connection,
    key:   &DerivedKey,
    entry: &NewEntry,
    // created_at מפורש — לתמיכה בתאריך נבחר שאינו היום
    created_at: Option<&str>,
) -> Result<Entry, DbError> {
    let enc_content  = crypto::encrypt(&entry.content, key)?;
    let enc_category = entry.category.as_deref()
        .map(|c| crypto::encrypt(c, key))
        .transpose()?;
    let tone_str = entry.tone.as_ref().map(|t| t.to_str());

    if let Some(ts) = created_at {
        conn.execute(
            "INSERT INTO entries (content, tone, rating, category, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![enc_content, tone_str, entry.rating, enc_category, ts],
        )?;
    } else {
        conn.execute(
            "INSERT INTO entries (content, tone, rating, category)
             VALUES (?1, ?2, ?3, ?4)",
            params![enc_content, tone_str, entry.rating, enc_category],
        )?;
    }

    let id = conn.last_insert_rowid();
    get_entry(conn, key, id)
}

pub fn get_entry(
    conn: &Connection,
    key:  &DerivedKey,
    id:   i64,
) -> Result<Entry, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, content, tone, rating, category, created_at, updated_at
         FROM entries WHERE id = ?1"
    )?;
    let mut rows = stmt.query(params![id])?;
    let row = rows.next()?.ok_or(DbError::NotFound)?;
    row_to_entry(row, key)
}

pub fn get_entries(
    conn: &Connection,
    key:  &DerivedKey,
) -> Result<Vec<Entry>, DbError> {
    // סדר: ישן למעלה (ascending) בתוך כל יום
    let mut stmt = conn.prepare(
        "SELECT id, content, tone, rating, category, created_at, updated_at
         FROM entries ORDER BY created_at ASC"
    )?;
    query_entries(&mut stmt, &[], key)
}

pub fn update_entry(
    conn:  &Connection,
    key:   &DerivedKey,
    entry: &UpdateEntry,
) -> Result<Entry, DbError> {
    let enc_content  = crypto::encrypt(&entry.content, key)?;
    let enc_category = entry.category.as_deref()
        .map(|c| crypto::encrypt(c, key))
        .transpose()?;
    let tone_str = entry.tone.as_ref().map(|t| t.to_str());

    conn.execute(
        "UPDATE entries
         SET content = ?1, tone = ?2, rating = ?3, category = ?4,
             updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE id = ?5",
        params![enc_content, tone_str, entry.rating, enc_category, entry.id],
    )?;
    get_entry(conn, key, entry.id)
}

pub fn delete_entry(conn: &Connection, id: i64) -> Result<DeleteResult, DbError> {
    conn.execute("DELETE FROM entries WHERE id = ?1", params![id])?;
    Ok(DeleteResult { success: true })
}

pub fn search_entries(
    conn:   &Connection,
    key:    &DerivedKey,
    params: &SearchParams,
) -> Result<Vec<Entry>, DbError> {
    // סינון תאריך ב-SQL (שדה לא מוצפן)
    let mut sql = String::from(
        "SELECT id, content, tone, rating, category, created_at, updated_at
         FROM entries WHERE 1=1"
    );

    if let Some(ref from) = params.date_from {
        sql.push_str(&format!(" AND date(created_at) >= date('{}')", sanitize(from)));
    }
    if let Some(ref to) = params.date_to {
        sql.push_str(&format!(" AND date(created_at) <= date('{}')", sanitize(to)));
    }
    sql.push_str(" ORDER BY created_at ASC");

    let mut stmt   = conn.prepare(&sql)?;
    let mut entries = query_entries(&mut stmt, &[], key)?;

    // סינון תוכן וקטגוריה אחרי פענוח
    if let Some(ref q) = params.query {
        let q_lower = q.to_lowercase();
        entries.retain(|e| e.content.to_lowercase().contains(&q_lower));
    }
    if let Some(ref cat) = params.category {
        let cat_lower = cat.to_lowercase();
        entries.retain(|e| {
            e.category.as_deref()
                .map(|c| c.to_lowercase().contains(&cat_lower))
                .unwrap_or(false)
        });
    }

    Ok(entries)
}

// ── notes ────────────────────────────────────────────────────

pub fn create_note(
    conn: &Connection,
    key:  &DerivedKey,
    note: &NewNote,
) -> Result<Note, DbError> {
    let enc_title   = crypto::encrypt(&note.title, key)?;
    let enc_content = crypto::encrypt(&note.content, key)?;
    conn.execute(
        "INSERT INTO notes (title, content) VALUES (?1, ?2)",
        params![enc_title, enc_content],
    )?;
    let id = conn.last_insert_rowid();
    get_note(conn, key, id)
}

pub fn get_note(
    conn: &Connection,
    key:  &DerivedKey,
    id:   i64,
) -> Result<Note, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, title, content, created_at, updated_at FROM notes WHERE id = ?1"
    )?;
    let mut rows = stmt.query(params![id])?;
    let row = rows.next()?.ok_or(DbError::NotFound)?;
    row_to_note(row, key)
}

pub fn get_notes(
    conn: &Connection,
    key:  &DerivedKey,
) -> Result<Vec<Note>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, title, content, created_at, updated_at
         FROM notes ORDER BY updated_at DESC"
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
        ))
    })?;

    let mut result = Vec::new();
    for row in rows {
        let (id, enc_title, enc_content, created_at, updated_at) = row?;
        result.push(Note {
            id,
            title:      crypto::decrypt(&enc_title, key)?,
            content:    crypto::decrypt(&enc_content, key)?,
            created_at,
            updated_at,
        });
    }
    Ok(result)
}

pub fn update_note(
    conn: &Connection,
    key:  &DerivedKey,
    note: &UpdateNote,
) -> Result<Note, DbError> {
    let enc_title   = crypto::encrypt(&note.title, key)?;
    let enc_content = crypto::encrypt(&note.content, key)?;
    conn.execute(
        "UPDATE notes SET title = ?1, content = ?2,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE id = ?3",
        params![enc_title, enc_content, note.id],
    )?;
    get_note(conn, key, note.id)
}

pub fn delete_note(conn: &Connection, id: i64) -> Result<DeleteResult, DbError> {
    conn.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
    Ok(DeleteResult { success: true })
}

// ── עזר פנימי ────────────────────────────────────────────────

fn row_to_entry(row: &rusqlite::Row, key: &DerivedKey) -> Result<Entry, DbError> {
    let enc_content:  String         = row.get(1)?;
    let tone_str:     Option<String> = row.get(2)?;
    let enc_category: Option<String> = row.get(4)?;

    Ok(Entry {
        id:         row.get(0)?,
        content:    crypto::decrypt(&enc_content, key)?,
        tone:       tone_str.as_deref().and_then(Tone::from_str),
        rating:     row.get(3)?,
        category:   enc_category
                        .as_deref()
                        .map(|c| crypto::decrypt(c, key))
                        .transpose()?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn row_to_note(row: &rusqlite::Row, key: &DerivedKey) -> Result<Note, DbError> {
    let enc_title:   String = row.get(1)?;
    let enc_content: String = row.get(2)?;
    Ok(Note {
        id:         row.get(0)?,
        title:      crypto::decrypt(&enc_title, key)?,
        content:    crypto::decrypt(&enc_content, key)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

fn query_entries(
    stmt: &mut rusqlite::Statement,
    p:    &[&dyn rusqlite::ToSql],
    key:  &DerivedKey,
) -> Result<Vec<Entry>, DbError> {
    let rows = stmt.query_map(p, |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<i64>>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, String>(6)?,
        ))
    })?;

    let mut result = Vec::new();
    for row in rows {
        let (id, enc_content, tone_str, rating, enc_category, created_at, updated_at) = row?;
        result.push(Entry {
            id,
            content:    crypto::decrypt(&enc_content, key)?,
            tone:       tone_str.as_deref().and_then(Tone::from_str),
            rating,
            category:   enc_category
                            .as_deref()
                            .map(|c| crypto::decrypt(c, key))
                            .transpose()?,
            created_at,
            updated_at,
        });
    }
    Ok(result)
}

fn sanitize(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_digit() || *c == '-').collect()
}
