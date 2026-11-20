use crate::{GoogleDriveSession, NoteAttachment, StickyNote, SyncResult};
use reqwest::multipart::{Form, Part};
use reqwest::Client;
use serde::Deserialize;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// URL por defecto inyectada desde `.env` en tiempo de compilación
pub const DEFAULT_SYNC_API_URL: &str = match option_env!("SYNC_API_URL") {
    Some(val) => val,
    None => "https://tudominio.com/stickynotes/api.php",
};

#[derive(Deserialize)]
struct AuthResponse {
    token: Option<String>,
    email: Option<String>,
    message: Option<String>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct SyncApiResponse {
    notes: Option<Vec<StickyNote>>,
    message: Option<String>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct AttachmentApiResponse {
    error: Option<String>,
}

pub fn build_action_url(base_url: &str, action: &str) -> String {
    let trimmed = base_url.trim();
    if trimmed.contains('?') {
        format!("{trimmed}&action={action}")
    } else {
        format!("{trimmed}?action={action}")
    }
}

/// Inicia sesión o registra al usuario contra el backend PHP + MySQL
pub async fn authenticate_with_php_backend(
    action: &str, // "login" o "register"
    email: &str,
    password: &str,
    session: &mut GoogleDriveSession,
) -> Result<String, String> {
    let base_url = session.effective_api_url();
    if base_url.is_empty() || base_url.contains("tudominio.com") {
        return Err(
            "Configura primero la URL de tu servidor PHP (ej: https://tusitio.com/stickynotes/api.php) en ⚙️ Servidor o en el archivo .env"
                .to_string(),
        );
    }

    let url = build_action_url(&base_url, action);
    let client = Client::new();

    let payload = serde_json::json!({
        "email": email.trim(),
        "password": password,
    });

    let resp = client
        .post(&url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("No se pudo conectar al servidor ({url}): {e}"))?;

    let status = resp.status();
    let data: AuthResponse = resp
        .json()
        .await
        .map_err(|e| format!("Respuesta inválida del servidor PHP: {e}"))?;

    if !status.is_success() {
        return Err(data
            .error
            .unwrap_or_else(|| format!("Error del servidor ({status})")));
    }

    let token = data
        .token
        .ok_or_else(|| "El servidor no devolvió un token de sesión.".to_string())?;

    session.access_token = Some(token);
    session.user_email = Some(data.email.unwrap_or_else(|| email.trim().to_string()));

    Ok(data
        .message
        .unwrap_or_else(|| "Sesión iniciada correctamente.".to_string()))
}

/// Sube un archivo adjunto local al servidor PHP + MySQL
pub async fn upload_attachment_to_backend(
    base_url: &str,
    token: &str,
    note_id: &str,
    attachment: &NoteAttachment,
    file_path: &Path,
) -> Result<(), String> {
    let bytes = fs::read(file_path)
        .map_err(|e| format!("No se pudo leer el archivo adjunto local: {e}"))?;

    let url = build_action_url(base_url, "upload_attachment");
    let client = Client::new();

    let file_part = Part::bytes(bytes)
        .file_name(attachment.file_name.clone())
        .mime_str(&attachment.mime_type)
        .unwrap_or_else(|_| {
            Part::bytes(fs::read(file_path).unwrap_or_default())
                .file_name(attachment.file_name.clone())
        });

    let form = Form::new()
        .text("token", token.to_string())
        .text("id", attachment.id.clone())
        .text("note_id", note_id.to_string())
        .text("file_name", attachment.file_name.clone())
        .text("mime_type", attachment.mime_type.clone())
        .text("created_at", attachment.created_at.to_string())
        .part("file", file_part);

    let resp = client
        .post(&url)
        .bearer_auth(token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Error subiendo adjunto ({}) al servidor: {e}", attachment.file_name))?;

    let status = resp.status();
    if !status.is_success() {
        let err_msg = resp
            .json::<AttachmentApiResponse>()
            .await
            .ok()
            .and_then(|r| r.error)
            .unwrap_or_else(|| format!("HTTP {status}"));
        return Err(format!(
            "No se pudo subir el adjunto '{}': {err_msg}",
            attachment.file_name
        ));
    }

    Ok(())
}

/// Descarga un archivo adjunto desde el servidor PHP + MySQL hacia la caché local del dispositivo
pub async fn download_attachment_from_backend(
    base_url: &str,
    token: &str,
    attachment_id: &str,
    dest_path: &Path,
) -> Result<(), String> {
    let action_url = build_action_url(base_url, "download_attachment");
    let url = format!(
        "{}&id={}&token={}",
        action_url,
        urlencoding::encode(attachment_id),
        urlencoding::encode(token)
    );

    let client = Client::new();
    let resp = client
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Error descargando adjunto {attachment_id}: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!(
            "El servidor devolvió estado {status} al descargar el adjunto {attachment_id}"
        ));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Error leyendo bytes del adjunto descargado: {e}"))?;

    if let Some(parent) = dest_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(dest_path, &bytes)
        .map_err(|e| format!("No se pudo guardar el adjunto descargado en disco: {e}"))?;

    Ok(())
}

/// Elimina un archivo adjunto en el servidor PHP + MySQL
pub async fn delete_attachment_from_backend(
    base_url: &str,
    token: &str,
    attachment_id: &str,
) -> Result<(), String> {
    let url = build_action_url(base_url, "delete_attachment");
    let client = Client::new();
    let payload = serde_json::json!({
        "token": token,
        "id": attachment_id,
    });

    let _ = client
        .post(&url)
        .bearer_auth(token)
        .json(&payload)
        .send()
        .await;

    Ok(())
}

/// Sincroniza bidireccionalmente las notas locales y todos sus archivos adjuntos con el backend PHP + MySQL
pub async fn sync_notes_with_drive(
    local_notes: &[StickyNote],
    session: &mut GoogleDriveSession,
    attachments_dir: &Path,
) -> Result<(Vec<StickyNote>, SyncResult), String> {
    let token = session.access_token.clone().ok_or_else(|| {
        "Inicia sesión con tu correo y contraseña para sincronizar tus notas.".to_string()
    })?;

    let base_url = session.effective_api_url();
    let _ = fs::create_dir_all(attachments_dir);

    // 1. Subir primero cualquier archivo adjunto local pendiente (`uploaded == false`)
    let mut notes_to_sync = local_notes.to_vec();
    for note in notes_to_sync.iter_mut() {
        if note.deleted {
            continue;
        }
        for att in note.attachments.iter_mut() {
            let local_file = crate::attachment_file_path(attachments_dir, &att.id, &att.file_name);
            if !att.uploaded && local_file.exists() {
                if upload_attachment_to_backend(&base_url, &token, &note.id, att, &local_file)
                    .await
                    .is_ok()
                {
                    att.uploaded = true;
                }
            }
        }
    }

    // 2. Sincronizar metadatos de notas, listas y adjuntos con MySQL
    let url = build_action_url(&base_url, "sync");
    let client = Client::new();

    let payload = serde_json::json!({
        "token": token,
        "notes": notes_to_sync,
    });

    let resp = client
        .post(&url)
        .bearer_auth(&token)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Error de red conectando al servidor PHP: {e}"))?;

    let status = resp.status();
    let data: SyncApiResponse = resp
        .json()
        .await
        .map_err(|e| format!("Respuesta JSON inválida desde api.php: {e}"))?;

    if !status.is_success() {
        return Err(data
            .error
            .unwrap_or_else(|| format!("Error de sincronización ({status})")));
    }

    let mut merged_notes = data.notes.unwrap_or(notes_to_sync);

    // 3. Descargar archivos adjuntos que existan en las notas sincronizadas pero aún no estén en este dispositivo,
    //    o subir los que estén localmente y aún no figuren como subidos.
    for note in merged_notes.iter_mut() {
        if note.deleted {
            continue;
        }
        for att in note.attachments.iter_mut() {
            let local_file = crate::attachment_file_path(attachments_dir, &att.id, &att.file_name);
            if !local_file.exists() {
                if download_attachment_from_backend(&base_url, &token, &att.id, &local_file)
                    .await
                    .is_ok()
                {
                    att.uploaded = true;
                }
            } else if !att.uploaded {
                if upload_attachment_to_backend(&base_url, &token, &note.id, att, &local_file)
                    .await
                    .is_ok()
                {
                    att.uploaded = true;
                }
            }
        }
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    session.last_sync = Some(now);

    let active_count = merged_notes.iter().filter(|n| !n.deleted).count();
    Ok((
        merged_notes,
        SyncResult {
            status: data
                .message
                .unwrap_or_else(|| "Sincronizado con el servidor MySQL".to_string()),
            merged_count: active_count,
            last_sync: now,
        },
    ))
}
