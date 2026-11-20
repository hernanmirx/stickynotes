pub mod gdrive;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
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
pub struct NoteAttachment {
    pub id: String,
    pub file_name: String,
    pub mime_type: String,
    pub size: u64,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub uploaded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StickyNote {
    pub id: String,
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub checklist: Vec<ChecklistItem>,
    #[serde(default)]
    pub attachments: Vec<NoteAttachment>,
    #[serde(default)]
    pub show_checklist: bool,
    pub color: String,
    pub is_open: bool,
    pub always_on_top: bool,
    pub width: f64,
    pub height: f64,
    pub x: Option<f64>,
    pub y: Option<f64>,
    #[serde(default)]
    pub reminder_at: Option<u64>,
    #[serde(default)]
    pub reminder_notified: bool,
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

pub fn attachment_file_path(attachments_dir: &Path, attachment_id: &str, file_name: &str) -> PathBuf {
    let safe_id: String = attachment_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    let ext: String = Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| {
            s.chars()
                .filter(|c| c.is_ascii_alphanumeric())
                .collect::<String>()
        })
        .unwrap_or_default();

    if ext.is_empty() {
        attachments_dir.join(format!("{safe_id}.bin"))
    } else {
        attachments_dir.join(format!("{safe_id}.{ext}"))
    }
}

impl AppState {
    pub fn attachments_dir(&self) -> PathBuf {
        let dir = self.data_dir.join("attachments");
        let _ = fs::create_dir_all(&dir);
        dir
    }

    pub fn load(data_dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&data_dir);
        let _ = fs::create_dir_all(data_dir.join("attachments"));
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
                content: "Esta es una ventana flotante independiente en Linux.\nPuedes arrastrarla desde la barra superior, adjuntar imágenes o documentos 📎 y cambiar su color 🎨.".to_string(),
                checklist: vec![
                    ChecklistItem {
                        id: Uuid::new_v4().to_string(),
                        text: "Probar marcar esta casilla de verificación".to_string(),
                        checked: true,
                    },
                    ChecklistItem {
                        id: Uuid::new_v4().to_string(),
                        text: "Pulsar 📎 para adjuntar imágenes o documentos a tu nota".to_string(),
                        checked: false,
                    },
                    ChecklistItem {
                        id: Uuid::new_v4().to_string(),
                        text: "Pulsar ☁️ para iniciar sesión y sincronizar en todos tus dispositivos".to_string(),
                        checked: false,
                    },
                ],
                attachments: Vec::new(),
                show_checklist: true,
                color: "yellow".to_string(),
                is_open: true,
                always_on_top: false,
                width: 350.0,
                height: 430.0,
                x: Some(120.0),
                y: Some(120.0),
                reminder_at: None,
                reminder_notified: false,
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
        attachments: Vec::new(),
        show_checklist: false,
        color,
        is_open: true,
        always_on_top: false,
        width: 320.0,
        height: 340.0,
        x: Some(160.0 + offset),
        y: Some(140.0 + offset),
        reminder_at: None,
        reminder_notified: false,
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
    trigger_background_sync(app);
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
    trigger_background_sync(app);
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

/// Adjunta una imagen o documento a una nota, guardándolo localmente y subiéndolo al servidor si hay sesión activa.
#[tauri::command]
async fn add_attachment(
    note_id: String,
    file_name: String,
    mime_type: String,
    data_base64: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<NoteAttachment, String> {
    let raw_bytes = BASE64_STANDARD
        .decode(data_base64.trim())
        .map_err(|e| format!("Datos base64 del archivo inválidos: {e}"))?;

    let att_id = Uuid::new_v4().to_string();
    let created_at = now_ts();
    let size = raw_bytes.len() as u64;

    let clean_name = Path::new(&file_name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("adjunto")
        .to_string();

    let effective_mime = if mime_type.trim().is_empty() {
        "application/octet-stream".to_string()
    } else {
        mime_type.trim().to_string()
    };

    let attachments_dir = state.attachments_dir();
    let local_path = attachment_file_path(&attachments_dir, &att_id, &clean_name);
    fs::write(&local_path, &raw_bytes)
        .map_err(|e| format!("No se pudo guardar el archivo adjunto localmente: {e}"))?;

    let mut attachment = NoteAttachment {
        id: att_id.clone(),
        file_name: clean_name,
        mime_type: effective_mime,
        size,
        created_at,
        uploaded: false,
    };

    // Si hay sesión conectada, intentamos subir inmediatamente el archivo al servidor PHP
    let session_snapshot = state.drive_session.lock().unwrap().clone();
    if let Some(token) = session_snapshot.access_token.as_deref() {
        let base_url = session_snapshot.effective_api_url();
        if !base_url.is_empty() && !base_url.contains("tudominio.com") {
            if gdrive::upload_attachment_to_backend(
                &base_url,
                token,
                &note_id,
                &attachment,
                &local_path,
            )
            .await
            .is_ok()
            {
                attachment.uploaded = true;
            }
        }
    }

    {
        let mut notes = state.notes.lock().unwrap();
        let note = notes
            .iter_mut()
            .find(|n| n.id == note_id && !n.deleted)
            .ok_or_else(|| "La nota especificada no existe.".to_string())?;
        note.attachments.push(attachment.clone());
        note.updated_at = now_ts();
    }
    state.persist_notes();
    let _ = app.emit("notes-updated", ());

    Ok(attachment)
}

/// Elimina un archivo adjunto de una nota (tanto local como en el backend si hay sesión).
#[tauri::command]
async fn remove_attachment(
    note_id: String,
    attachment_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut removed_file_name: Option<String> = None;
    {
        let mut notes = state.notes.lock().unwrap();
        if let Some(note) = notes.iter_mut().find(|n| n.id == note_id) {
            if let Some(pos) = note.attachments.iter().position(|a| a.id == attachment_id) {
                let removed = note.attachments.remove(pos);
                removed_file_name = Some(removed.file_name);
                note.updated_at = now_ts();
            }
        }
    }
    state.persist_notes();

    if let Some(fname) = removed_file_name {
        let local_path = attachment_file_path(&state.attachments_dir(), &attachment_id, &fname);
        if local_path.exists() {
            let _ = fs::remove_file(local_path);
        }
    }

    let session_snapshot = state.drive_session.lock().unwrap().clone();
    if let Some(token) = session_snapshot.access_token.as_deref() {
        let base_url = session_snapshot.effective_api_url();
        if !base_url.is_empty() && !base_url.contains("tudominio.com") {
            let _ = gdrive::delete_attachment_from_backend(&base_url, token, &attachment_id).await;
        }
    }

    let _ = app.emit("notes-updated", ());
    Ok(())
}

/// Devuelve un Data URL (`data:<mime>;base64,...`) del adjunto para previsualizar imágenes o descargar documentos.
/// Si aún no está en caché local pero existe sesión en la nube, lo descarga bajo demanda.
#[tauri::command]
async fn get_attachment_data_url(
    attachment_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let att_meta = {
        let notes = state.notes.lock().unwrap();
        notes
            .iter()
            .filter(|n| !n.deleted)
            .flat_map(|n| n.attachments.iter())
            .find(|a| a.id == attachment_id)
            .cloned()
            .ok_or_else(|| "Adjunto no encontrado en las notas.".to_string())?
    };

    let attachments_dir = state.attachments_dir();
    let local_path = attachment_file_path(&attachments_dir, &att_meta.id, &att_meta.file_name);

    if !local_path.exists() {
        let session_snapshot = state.drive_session.lock().unwrap().clone();
        let base_url = session_snapshot.effective_api_url();
        let token = session_snapshot.access_token.ok_or_else(|| {
            "El archivo adjunto aún no está descargado en este dispositivo. Inicia sesión y sincroniza.".to_string()
        })?;
        gdrive::download_attachment_from_backend(&base_url, &token, &att_meta.id, &local_path)
            .await?;
    }

    let bytes = fs::read(&local_path)
        .map_err(|e| format!("Error leyendo archivo adjunto en caché local: {e}"))?;
    let b64 = BASE64_STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{b64}", att_meta.mime_type))
}

/// Abre el archivo adjunto con el visor o aplicación predeterminada del sistema operativo (imágenes, PDF, Office, etc.)
#[tauri::command]
async fn open_attachment(
    attachment_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let att_meta = {
        let notes = state.notes.lock().unwrap();
        notes
            .iter()
            .filter(|n| !n.deleted)
            .flat_map(|n| n.attachments.iter())
            .find(|a| a.id == attachment_id)
            .cloned()
            .ok_or_else(|| "Adjunto no encontrado en las notas.".to_string())?
    };

    let attachments_dir = state.attachments_dir();
    let local_path = attachment_file_path(&attachments_dir, &att_meta.id, &att_meta.file_name);

    if !local_path.exists() {
        let session_snapshot = state.drive_session.lock().unwrap().clone();
        let base_url = session_snapshot.effective_api_url();
        let token = session_snapshot.access_token.ok_or_else(|| {
            "El archivo adjunto no se encuentra localmente. Inicia sesión para descargarlo.".to_string()
        })?;
        gdrive::download_attachment_from_backend(&base_url, &token, &att_meta.id, &local_path)
            .await?;
    }

    open::that(&local_path)
        .map_err(|e| format!("No se pudo abrir el archivo con el visor del sistema: {e}"))?;

    Ok(())
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
    perform_cloud_sync(&app, &state).await
}

async fn perform_cloud_sync(app: &AppHandle, state: &AppState) -> Result<SyncResult, String> {
    let local_notes = state.notes.lock().unwrap().clone();
    let mut session = state.drive_session.lock().unwrap().clone();
    let attachments_dir = state.attachments_dir();

    let (merged_notes, result) =
        gdrive::sync_notes_with_drive(&local_notes, &mut session, &attachments_dir).await?;

    // Detectar si hubo cambios reales respecto a las notas locales antes de re-renderizar o abrir/cerrar ventanas
    let changed = serde_json::to_string(&local_notes).ok() != serde_json::to_string(&merged_notes).ok();

    {
        let mut notes_lock = state.notes.lock().unwrap();
        let mut merged_with_latest = merged_notes.clone();
        // Si durante la petición HTTP el usuario editó alguna nota localmente con timestamp más nuevo, preservarla
        for local_now in notes_lock.iter() {
            if let Some(m) = merged_with_latest.iter_mut().find(|n| n.id == local_now.id) {
                if local_now.updated_at > m.updated_at {
                    *m = local_now.clone();
                }
            } else {
                merged_with_latest.insert(0, local_now.clone());
            }
        }
        *notes_lock = merged_with_latest;
    }
    {
        let mut session_lock = state.drive_session.lock().unwrap();
        session_lock.last_sync = session.last_sync;
    }
    state.persist_notes();
    state.persist_drive_session();

    let final_notes = state.notes.lock().unwrap().clone();
    for note in &final_notes {
        let label = format!("note-{}", note.id);
        if !note.deleted && note.is_open {
            if app.get_webview_window(&label).is_none() {
                let _ = spawn_note_window(app, note);
            }
        } else if note.deleted {
            if let Some(win) = app.get_webview_window(&label) {
                let _ = win.close();
            }
        }
    }

    if changed {
        let _ = app.emit("notes-synced", &final_notes);
    }
    Ok(result)
}

/// Dispara una sincronización inmediata en segundo plano si la sesión está conectada y auto_sync activo
fn trigger_background_sync(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let should_sync = {
            let s = match state.drive_session.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            s.access_token.is_some() && s.auto_sync
        };
        if should_sync {
            let _ = perform_cloud_sync(&app, &state).await;
        }
    });
}

/// Hilo de sincronización continua en tiempo real (cada 4 segundos) con el servidor PHP + MySQL
fn start_auto_sync_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(4)).await;
            let state = app.state::<AppState>();
            let should_sync = {
                let s = match state.drive_session.lock() {
                    Ok(g) => g,
                    Err(_) => continue,
                };
                s.access_token.is_some() && s.auto_sync
            };
            if should_sync {
                let _ = perform_cloud_sync(&app, &state).await;
            }
        }
    });
}

/// Envía una notificación nativa del sistema operativo (en Linux mediante `notify-send` / D-Bus)
fn trigger_os_notification(note: &StickyNote) {
    let title = if note.title.trim().is_empty() {
        "⏰ Recordatorio de StickyNotes".to_string()
    } else {
        format!("⏰ {}", note.title.trim())
    };

    let mut body = note.content.trim().to_string();
    if body.is_empty() {
        let pending_tasks: Vec<String> = note
            .checklist
            .iter()
            .filter(|c| !c.checked && !c.text.trim().is_empty())
            .take(3)
            .map(|c| format!("• {}", c.text.trim()))
            .collect();
        if !pending_tasks.is_empty() {
            body = pending_tasks.join("\n");
        } else {
            body = "Tienes una alarma o recordatorio pendiente en esta nota.".to_string();
        }
    }

    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("notify-send")
            .arg("-u")
            .arg("critical")
            .arg("-a")
            .arg("StickyNotes")
            .arg("-i")
            .arg("appointment-soon")
            .arg(&title)
            .arg(&body)
            .spawn();
    }
}

/// Inicia el hilo vigilante en segundo plano que comprueba cada segundo si alguna nota alcanzó su fecha/hora de alarma.
fn start_reminder_watcher(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let now = now_ts();
        let mut due_notes: Vec<StickyNote> = Vec::new();

        {
            let state = app.state::<AppState>();
            let mut notes = match state.notes.lock() {
                Ok(g) => g,
                Err(_) => continue,
            };

            let mut changed = false;
            for n in notes.iter_mut() {
                if n.deleted || n.reminder_notified {
                    continue;
                }
                if let Some(rem_ts) = n.reminder_at {
                    if rem_ts > 0 && now >= rem_ts {
                        n.reminder_notified = true;
                        n.is_open = true;
                        n.updated_at = now;
                        due_notes.push(n.clone());
                        changed = true;
                    }
                }
            }

            if changed {
                let path = state.data_dir.join("notes.json");
                if let Ok(json) = serde_json::to_string_pretty(&*notes) {
                    let _ = fs::write(path, json);
                }
            }
        }

        for note in due_notes {
            trigger_os_notification(&note);
            let _ = spawn_note_window(&app, &note);
            let _ = app.emit("reminder-triggered", &note);
            let _ = app.emit("notes-updated", ());
        }
    });
}

/// Descarta o pospone (`snooze_minutes`) una alarma activa en una nota.
#[tauri::command]
fn update_note_reminder(
    id: String,
    reminder_at: Option<u64>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<StickyNote, String> {
    let updated_note = {
        let mut notes = state.notes.lock().unwrap();
        let note = notes
            .iter_mut()
            .find(|n| n.id == id && !n.deleted)
            .ok_or_else(|| "Nota no encontrada.".to_string())?;
        note.reminder_at = reminder_at;
        note.reminder_notified = false;
        note.updated_at = now_ts();
        note.clone()
    };
    state.persist_notes();
    let _ = app.emit("notes-updated", ());
    Ok(updated_note)
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

            start_reminder_watcher(handle.clone());
            start_auto_sync_watcher(handle);

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
            add_attachment,
            remove_attachment,
            get_attachment_data_url,
            open_attachment,
            update_note_reminder,
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
