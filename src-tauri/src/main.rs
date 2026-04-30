// main.rs v2
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod crypto;
mod db;
mod models;

use std::sync::Mutex;
use commands::AppState;

fn main() {
    let db_path = get_db_path();
    let conn    = db::open(&db_path).expect("לא ניתן לפתוח את מסד הנתונים");

    let state = AppState {
        db:  Mutex::new(conn),
        key: Mutex::new(None),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::is_initialized,
            commands::unlock,
            commands::lock,
            commands::change_password,
            commands::get_entries,
            commands::get_entry,
            commands::create_entry,
            commands::update_entry,
            commands::delete_entry,
            commands::search_entries,
            commands::get_notes,
            commands::get_note,
            commands::create_note,
            commands::update_note,
            commands::delete_note,
        ])
        .run(tauri::generate_context!())
        .expect("שגיאה בהפעלת האפליקציה");
}

fn get_db_path() -> String {
    if let Some(dir) = dirs_next::data_dir() {
        let app_dir = dir.join("com.hadaf.hayomi");
        std::fs::create_dir_all(&app_dir).ok();
        return app_dir.join("journal.db").to_string_lossy().into_owned();
    }
    "journal.db".to_string()
}
