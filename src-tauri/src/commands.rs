// commands.rs v3
// ללא ניהול קטגוריות, תמיכה ב-created_at מפורש, שינוי סיסמה

use std::sync::Mutex;
use tauri::State;

use crate::crypto::{self, DerivedKey};
use crate::db::{self, DbError};
use crate::models::*;

// ── AppState ─────────────────────────────────────────────────

pub struct AppState {
    pub db:  Mutex<rusqlite::Connection>,
    pub key: Mutex<Option<DerivedKey>>,
}

#[derive(Debug, serde::Serialize)]
pub struct CmdError(String);

impl From<DbError> for CmdError {
    fn from(e: DbError) -> Self { CmdError(e.to_string()) }
}
impl From<crypto::CryptoError> for CmdError {
    fn from(e: crypto::CryptoError) -> Self { CmdError(e.to_string()) }
}
impl From<String> for CmdError {
    fn from(s: String) -> Self { CmdError(s) }
}

type Cmd<T> = Result<T, CmdError>;

fn with_key<F, T>(state: &State<AppState>, f: F) -> Cmd<T>
where
    F: FnOnce(&DerivedKey, &rusqlite::Connection) -> Result<T, DbError>,
{
    let key_guard = state.key.lock().map_err(|_| CmdError("lock error".into()))?;
    let key = key_guard.as_ref().ok_or_else(|| CmdError("האפליקציה נעולה".into()))?;
    let conn = state.db.lock().map_err(|_| CmdError("lock error".into()))?;
    f(key, &conn).map_err(CmdError::from)
}

// ── אימות ────────────────────────────────────────────────────

#[tauri::command]
pub fn is_initialized(state: State<AppState>) -> Cmd<bool> {
    let conn = state.db.lock().map_err(|_| CmdError("lock error".into()))?;
    db::is_initialized(&conn).map_err(CmdError::from)
}

#[tauri::command]
pub fn unlock(state: State<AppState>, password: String) -> Cmd<UnlockResult> {
    let conn = state.db.lock().map_err(|_| CmdError("lock error".into()))?;

    let salt_hex = if db::is_initialized(&conn)? {
        db::get_salt(&conn)?
    } else {
        db::initialize(&conn)?
    };

    drop(conn);

    let salt = crypto::salt_from_hex(&salt_hex).map_err(CmdError::from)?;
    let key  = crypto::derive_key(&password, &salt).map_err(CmdError::from)?;

    {
        let conn = state.db.lock().map_err(|_| CmdError("lock error".into()))?;
        if let Some(check) = db::get_meta(&conn, "check_value")? {
            crypto::decrypt(&check, &key).map_err(|_| CmdError("סיסמה שגויה".into()))?;
        } else {
            let enc = crypto::encrypt("ok", &key).map_err(CmdError::from)?;
            db::set_meta(&conn, "check_value", &enc)?;
        }
    }

    let mut key_guard = state.key.lock().map_err(|_| CmdError("lock error".into()))?;
    *key_guard = Some(key);
    Ok(UnlockResult { success: true })
}

#[tauri::command]
pub fn lock(state: State<AppState>) -> Cmd<bool> {
    let mut key_guard = state.key.lock().map_err(|_| CmdError("lock error".into()))?;
    *key_guard = None;
    Ok(true)
}

/// שינוי סיסמה
///
/// זרימת הפעולה:
///  1. אימות סיסמה ישנה
///  2. גזירת מפתח חדש + salt חדש
///  3. הצפנה מחדש של כל הנתונים + עדכון salt/check_value —
///     הכל בטרנזקציה SQL אחת (אטומי, safe לגבי crash)
///  4. עדכון המפתח הפעיל ב-AppState
#[tauri::command]
pub fn change_password(
    state:        State<AppState>,
    old_password: String,
    new_password: String,
) -> Cmd<bool> {
    // ── שלב 1: אימות סיסמה ישנה ──────────────────────────────
    let salt_hex = {
        let conn = state.db.lock().map_err(|_| CmdError("lock error".into()))?;
        db::get_salt(&conn)?
    };

    let salt    = crypto::salt_from_hex(&salt_hex).map_err(CmdError::from)?;
    let old_key = crypto::derive_key(&old_password, &salt).map_err(CmdError::from)?;

    {
        let conn  = state.db.lock().map_err(|_| CmdError("lock error".into()))?;
        let check = db::get_meta(&conn, "check_value")?
            .ok_or_else(|| CmdError("DB לא מאותחל".into()))?;
        crypto::decrypt(&check, &old_key)
            .map_err(|_| CmdError("סיסמה ישנה שגויה".into()))?;
    }

    // ── שלב 2: salt חדש + מפתח חדש ─────────────────────────
    let new_salt     = crypto::generate_salt();
    let new_salt_hex = crypto::salt_to_hex(&new_salt);
    let new_key      = crypto::derive_key(&new_password, &new_salt)
        .map_err(CmdError::from)?;
    let new_check    = crypto::encrypt("ok", &new_key).map_err(CmdError::from)?;

    // ── שלב 3: הצפנה מחדש + עדכון DB (טרנזקציה אחת) ────────
    {
        let conn = state.db.lock().map_err(|_| CmdError("lock error".into()))?;
        db::reencrypt_all(&conn, &old_key, &new_key, &new_salt_hex, &new_check)
            .map_err(CmdError::from)?;
    }

    // ── שלב 4: עדכון המפתח הפעיל ────────────────────────────
    let mut key_guard = state.key.lock().map_err(|_| CmdError("lock error".into()))?;
    *key_guard = Some(new_key);

    Ok(true)
}

// ── entries ───────────────────────────────────────────────────

#[tauri::command]
pub fn get_entries(state: State<AppState>) -> Cmd<Vec<Entry>> {
    with_key(&state, |key, conn| db::get_entries(conn, key))
}

#[tauri::command]
pub fn get_entry(state: State<AppState>, id: i64) -> Cmd<Entry> {
    with_key(&state, |key, conn| db::get_entry(conn, key, id))
}

/// created_at אופציונלי — אם לא נשלח, נקבע ע"י DB (עכשיו)
#[tauri::command]
pub fn create_entry(
    state:      State<AppState>,
    entry:      NewEntry,
    created_at: Option<String>,
) -> Cmd<Entry> {
    with_key(&state, |key, conn| {
        db::create_entry(conn, key, &entry, created_at.as_deref())
    })
}

#[tauri::command]
pub fn update_entry(state: State<AppState>, entry: UpdateEntry) -> Cmd<Entry> {
    with_key(&state, |key, conn| db::update_entry(conn, key, &entry))
}

#[tauri::command]
pub fn delete_entry(state: State<AppState>, id: i64) -> Cmd<DeleteResult> {
    with_key(&state, |_key, conn| db::delete_entry(conn, id))
}

#[tauri::command]
pub fn search_entries(state: State<AppState>, params: SearchParams) -> Cmd<Vec<Entry>> {
    with_key(&state, |key, conn| db::search_entries(conn, key, &params))
}

// ── notes ─────────────────────────────────────────────────────

#[tauri::command]
pub fn get_notes(state: State<AppState>) -> Cmd<Vec<Note>> {
    with_key(&state, |key, conn| db::get_notes(conn, key))
}

#[tauri::command]
pub fn get_note(state: State<AppState>, id: i64) -> Cmd<Note> {
    with_key(&state, |key, conn| db::get_note(conn, key, id))
}

#[tauri::command]
pub fn create_note(state: State<AppState>, note: NewNote) -> Cmd<Note> {
    with_key(&state, |key, conn| db::create_note(conn, key, &note))
}

#[tauri::command]
pub fn update_note(state: State<AppState>, note: UpdateNote) -> Cmd<Note> {
    with_key(&state, |key, conn| db::update_note(conn, key, &note))
}

#[tauri::command]
pub fn delete_note(state: State<AppState>, id: i64) -> Cmd<DeleteResult> {
    with_key(&state, |_key, conn| db::delete_note(conn, id))
}
