pub mod gdrive;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChecklistItem {
    pub id: String,
    pub text: String,
    pub checked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StickyNote {
    pub id: String,
    pub title: String,
    pub content: String,
    pub checklist: Vec<ChecklistItem>,
    pub show_checklist: bool,
    pub color: String,
    pub is_open: bool,
    pub always_on_top: bool,
    pub width: f64,
    pub height: f64,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub updated_at: u64,
    pub deleted: bool,
}

/// Sesión interna almacenada localmente por el backend en Rust.
/// Su `access_token` nunca se expone a la interfaz de usuario.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoogleDriveSession {
    pub api_url: Option<String>,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub user_email: Option<String>,
    pub last_sync: Option<u64>,
    pub auto_sync: bool,
}

impl Default for GoogleDriveSession {
    fn default() -> Self {
        Self {
            api_url: None,
            access_token: None,
            refresh_token: None,
            user_email: None,
            last_sync: None,
            auto_sync: true,
        }
    }
}

impl GoogleDriveSession {
    pub fn effective_api_url(&self) -> String {
        match &self.api_url {
            Some(u) if !u.trim().is_empty() => u.trim().to_string(),
            _ => gdrive::DEFAULT_SYNC_API_URL.to_string(),
        }
    }
}

/// Estado público y seguro que recibe la interfaz de usuario.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudAccountStatus {
    pub connected: bool,
    pub user_email: Option<String>,
    pub api_url: String,
    pub last_sync: Option<u64>,
    pub auto_sync: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncResult {
    pub status: String,
    pub merged_count: usize,
    pub last_sync: u64,
}

pub struct AppState {
    pub notes: Mutex<Vec<StickyNote>>,
    pub drive_session: Mutex<GoogleDriveSession>,
    pub data_dir: PathBuf,
}

fn now_ts() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

impl AppState {
    pub fn load(data_dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&data_dir);
        let notes_path = data_dir.join("notes.json");
        let session_path = data_dir.join("cloud_session.json");

        let mut notes: Vec<StickyNote> = if notes_path.exists() {
            fs::read_to_string(&notes_path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        if notes.is_empty() {
            notes.push(StickyNote {
                id: Uuid::new_v4().to_string(),
                title: "¡Bienvenido a StickyNotes!".to_string(),
                content: "Esta es una ventana flotante independiente en Linux.\nPuedes arrastrarla desde la barra superior o cambiar su color 🎨.".to_string(),
                checklist: vec![
                    ChecklistItem {
                        id: Uuid::new_v4().to_string(),
                        text: "Probar marcar esta casilla de verificación".to_string(),
                        checked: true,
                    },
                    ChecklistItem {
                        id: Uuid::new_v4().to_string(),
                        text: "Pulsar ➕ arriba a la izquierda para crear otra ventana flotante".to_string(),
                        checked: false,
                    },
                    ChecklistItem {
                        id: Uuid::new_v4().to_string(),
                        text: "Pulsar ☁️ para iniciar sesión y sincronizar en tu servidor MySQL".to_string(),
                        checked: false,
                    },
                ],
                show_checklist: true,
                color: "yellow".to_string(),
                is_open: true,
                always_on_top: false,
                width: 340.0,
                height: 410.0,
                x: Some(120.0),
                y: Some(120.0),
                updated_at: now_ts(),
                deleted: false,
            });
        }

        let drive_session: GoogleDriveSession = if session_path.exists() {
            fs::read_to_string(&session_path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            GoogleDriveSession::default()
        };

        let state = Self {
            notes: Mutex::new(notes),
            drive_session: Mutex::new(drive_session),
            data_dir,
        };
        state.persist_notes();
        state.persist_drive_session();
        state
    }

    pub fn persist_notes(&self) {
        if let Ok(notes) = self.notes.lock() {
            let path = self.data_dir.join("notes.json");
            if let Ok(json) = serde_json::to_string_pretty(&*notes) {
                let _ = fs::write(path, json);
            }
        }
    }

    pub fn persist_drive_session(&self) {
        if let Ok(session) = self.drive_session.lock() {
            let path = self.data_dir.join("cloud_session.json");
            if let Ok(json) = serde_json::to_string_pretty(&*session) {
                let _ = fs::write(path, json);
            }
        }
    }
}

pub fn spawn_note_window(app: &AppHandle, note: &StickyNote) -> Result<(), String> {
    let label = format!("note-{}", note.id);
    if let Some(existing_win) = app.get_webview_window(&label) {
        let _ = existing_win.show();
        let _ = existing_win.set_focus();
        return Ok(());
    }

    let url = format!("index.html?noteId={}", note.id);
    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title(if note.title.is_empty() {
            "StickyNote"
        } else {
            &note.title
        })
        .inner_size(note.width.max(260.0), note.height.max(260.0))
        .min_inner_size(240.0, 220.0)
        .decorations(false)
        .always_on_top(note.always_on_top)
        .resizable(true);

    if let (Some(x), Some(y)) = (note.x, note.y) {
        builder = builder.position(x, y);
    }

    builder
        .build()
        .map_err(|e| format!("No se pudo crear ventana de nota: {e}"))?;

    Ok(())
}

pub fn spawn_manager_window(app: &AppHandle) -> Result<(), String> {
    let label = "manager";
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App("index.html?view=manager".into()),
    )
    .title("StickyNotes - Mis Notas y Sincronización en la Nube")
    .inner_size(860.0, 640.0)
    .min_inner_size(580.0, 440.0)
    .decorations(true)
    .resizable(true)
    .build()
    .map_err(|e| format!("No se pudo abrir el panel de notas: {e}"))?;

    Ok(())
}

#[tauri::command]
fn list_notes(state: State<'_, AppState>) -> Vec<StickyNote> {
    let notes = state.notes.lock().unwrap();
    notes.clone()
}

#[tauri::command]
fn get_note(id: String, state: State<'_, AppState>) -> Option<StickyNote> {
    let notes = state.notes.lock().unwrap();
    notes.iter().find(|n| n.id == id && !n.deleted).cloned()
}

#[tauri::command]
fn save_note(note: StickyNote, app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut notes = state.notes.lock().unwrap();
        if let Some(existing) = notes.iter_mut().find(|n| n.id == note.id) {
            *existing = note;
        } else {
            notes.push(note);
        }
    }
    state.persist_notes();
    let _ = app.emit("notes-updated", ());
    Ok(())
}

#[tauri::command]
fn create_and_open_note(app: AppHandle, state: State<'_, AppState>) -> Result<StickyNote, String> {
    let palette = ["yellow", "mint", "pink", "sky", "lavender"];
    let count = state.notes.lock().unwrap().len();
    let color = palette[count % palette.len()].to_string();
    let offset = ((count % 6) as f64) * 34.0;

    let new_note = StickyNote {
        id: Uuid::new_v4().to_string(),
        title: String::new(),
        content: String::new(),
        checklist: Vec::new(),
        show_checklist: false,
        color,
        is_open: true,
        always_on_top: false,
        width: 320.0,
        height: 340.0,
        x: Some(160.0 + offset),
        y: Some(140.0 + offset),
        updated_at: now_ts(),
        deleted: false,
    };

    {
        let mut notes = state.notes.lock().unwrap();
        notes.insert(0, new_note.clone());
    }
    state.persist_notes();

    spawn_note_window(&app, &new_note)?;
    let _ = app.emit("notes-updated", ());
    Ok(new_note)
}

#[tauri::command]
fn open_note_window(id: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let note_opt = {
        let mut notes = state.notes.lock().unwrap();
        if let Some(n) = notes.iter_mut().find(|n| n.id == id && !n.deleted) {
            n.is_open = true;
            n.updated_at = now_ts();
            Some(n.clone())
        } else {
            None
        }
    };
    state.persist_notes();

    if let Some(note) = note_opt {
        spawn_note_window(&app, &note)?;
        let _ = app.emit("notes-updated", ());
    }
    Ok(())
}

#[tauri::command]
fn open_all_note_windows(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let to_open: Vec<StickyNote> = {
        let mut notes = state.notes.lock().unwrap();
        for n in notes.iter_mut().filter(|n| !n.deleted) {
            n.is_open = true;
        }
        notes.iter().filter(|n| !n.deleted).cloned().collect()
    };
    state.persist_notes();

    for note in to_open {
        let _ = spawn_note_window(&app, &note);
    }
    let _ = app.emit("notes-updated", ());
    Ok(())
}

#[tauri::command]
fn close_note_window(id: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let remaining_open = {
        let mut notes = state.notes.lock().unwrap();
        if let Some(n) = notes.iter_mut().find(|n| n.id == id) {
            n.is_open = false;
            n.updated_at = now_ts();
        }
        notes.iter().filter(|n| !n.deleted && n.is_open).count()
    };
    state.persist_notes();

    let label = format!("note-{id}");
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.close();
    }

    if remaining_open == 0 && app.get_webview_window("manager").is_none() {
        let _ = spawn_manager_window(&app);
    }

    let _ = app.emit("notes-updated", ());
    Ok(())
}

#[tauri::command]
fn delete_note(id: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let remaining_open = {
        let mut notes = state.notes.lock().unwrap();
        if let Some(n) = notes.iter_mut().find(|n| n.id == id) {
            n.deleted = true;
            n.is_open = false;
            n.updated_at = now_ts();
        }
        notes.iter().filter(|n| !n.deleted && n.is_open).count()
    };
    state.persist_notes();

    let label = format!("note-{id}");
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.close();
    }

    if remaining_open == 0 && app.get_webview_window("manager").is_none() {
        let _ = spawn_manager_window(&app);
    }

    let _ = app.emit("notes-updated", ());
    Ok(())
}

#[tauri::command]
fn set_note_always_on_top(
    id: String,
    always_on_top: bool,
    app: AppHandle,
) -> Result<(), String> {
    let label = format!("note-{id}");
    if let Some(win) = app.get_webview_window(&label) {
        win.set_always_on_top(always_on_top)
            .map_err(|e| format!("Error cambiando always_on_top: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
fn open_manager_window(app: AppHandle) -> Result<(), String> {
    spawn_manager_window(&app)
}

#[tauri::command]
fn get_cloud_status(state: State<'_, AppState>) -> CloudAccountStatus {
    let s = state.drive_session.lock().unwrap();
    CloudAccountStatus {
        connected: s.access_token.is_some(),
        user_email: s.user_email.clone(),
        api_url: s.effective_api_url(),
        last_sync: s.last_sync,
        auto_sync: s.auto_sync,
    }
}

#[tauri::command]
fn set_api_url(api_url: String, state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut s = state.drive_session.lock().unwrap();
        let trimmed = api_url.trim().to_string();
        s.api_url = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        };
    }
    state.persist_drive_session();
    Ok(())
}

#[tauri::command]
fn set_auto_sync(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut s = state.drive_session.lock().unwrap();
        s.auto_sync = enabled;
    }
    state.persist_drive_session();
    Ok(())
}

#[tauri::command]
fn logout_google(state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut s = state.drive_session.lock().unwrap();
        s.access_token = None;
        s.refresh_token = None;
        s.user_email = None;
    }
    state.persist_drive_session();
    Ok(())
}

#[tauri::command]
async fn auth_login(
    email: String,
    password: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let mut session = state.drive_session.lock().unwrap().clone();
    let msg = gdrive::authenticate_with_php_backend("login", &email, &password, &mut session).await?;
    {
        let mut current = state.drive_session.lock().unwrap();
        *current = session;
    }
    state.persist_drive_session();
    Ok(msg)
}

#[tauri::command]
async fn auth_register(
    email: String,
    password: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let mut session = state.drive_session.lock().unwrap().clone();
    let msg =
        gdrive::authenticate_with_php_backend("register", &email, &password, &mut session).await?;
    {
        let mut current = state.drive_session.lock().unwrap();
        *current = session;
    }
    state.persist_drive_session();
    Ok(msg)
}

#[tauri::command]
async fn sync_google_drive(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SyncResult, String> {
    let local_notes = state.notes.lock().unwrap().clone();
    let mut session = state.drive_session.lock().unwrap().clone();

    let (merged_notes, result) = gdrive::sync_notes_with_drive(&local_notes, &mut session).await?;

    {
        let mut notes_lock = state.notes.lock().unwrap();
        *notes_lock = merged_notes.clone();
    }
    {
        let mut session_lock = state.drive_session.lock().unwrap();
        *session_lock = session;
    }
    state.persist_notes();
    state.persist_drive_session();

    for note in merged_notes.iter().filter(|n| !n.deleted && n.is_open) {
        let _ = spawn_note_window(&app, note);
    }

    let _ = app.emit("notes-synced", &merged_notes);
    Ok(result)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("/tmp/stickynotes-data"));

            let state = AppState::load(app_data_dir);
            let open_notes: Vec<StickyNote> = state
                .notes
                .lock()
                .unwrap()
                .iter()
                .filter(|n| !n.deleted && n.is_open)
                .cloned()
                .collect();

            app.manage(state);

            let handle = app.handle().clone();
            if open_notes.is_empty() {
                let _ = spawn_manager_window(&handle);
            } else {
                for note in &open_notes {
                    let _ = spawn_note_window(&handle, note);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_notes,
            get_note,
            save_note,
            create_and_open_note,
            open_note_window,
            open_all_note_windows,
            close_note_window,
            delete_note,
            set_note_always_on_top,
            open_manager_window,
            get_cloud_status,
            set_api_url,
            set_auto_sync,
            logout_google,
            auth_login,
            auth_register,
            sync_google_drive,
        ])
        .run(tauri::generate_context!())
        .expect("Error al ejecutar la aplicación StickyNotes");
}
