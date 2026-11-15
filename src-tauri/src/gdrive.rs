use crate::{GoogleDriveSession, StickyNote, SyncResult};
use reqwest::Client;
use serde::Deserialize;
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

fn build_action_url(base_url: &str, action: &str) -> String {
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

/// Sincroniza bidireccionalmente las notas locales con la base de datos MySQL vía PHP
pub async fn sync_notes_with_drive(
    local_notes: &[StickyNote],
    session: &mut GoogleDriveSession,
) -> Result<(Vec<StickyNote>, SyncResult), String> {
    let token = session.access_token.clone().ok_or_else(|| {
        "Inicia sesión con tu correo y contraseña para sincronizar tus notas.".to_string()
    })?;

    let base_url = session.effective_api_url();
    let url = build_action_url(&base_url, "sync");
    let client = Client::new();

    let payload = serde_json::json!({
        "token": token,
        "notes": local_notes,
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

    let merged_notes = data.notes.unwrap_or_else(|| local_notes.to_vec());

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
