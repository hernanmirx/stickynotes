use crate::{GoogleDriveSession, StickyNote, SyncResult};
use reqwest::Client;
use serde::Deserialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{SystemTime, UNIX_EPOCH};

const SYNC_FILENAME: &str = "stickynotes_sync_v1.json";

/// Credenciales internas de cliente OAuth inyectadas desde `.env` en tiempo de compilación.
/// Nunca se suben a Git ni se exponen al frontend (WebView/JS) ni al usuario final.
const INTERNAL_GOOGLE_CLIENT_ID: &str = match option_env!("GOOGLE_CLIENT_ID") {
    Some(val) => val,
    None => "",
};
const INTERNAL_GOOGLE_CLIENT_SECRET: &str = match option_env!("GOOGLE_CLIENT_SECRET") {
    Some(val) => val,
    None => "",
};

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct DriveFileList {
    files: Vec<DriveFileItem>,
}

#[derive(Deserialize)]
struct DriveFileItem {
    id: String,
}

/// Inicia el flujo OAuth 2.0 en un puerto local (Loopback) sin exponer credenciales al usuario
pub async fn perform_google_oauth(session: &mut GoogleDriveSession) -> Result<String, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("No se pudo abrir puerto local OAuth: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Error obteniendo puerto local: {e}"))?
        .port();

    let redirect_uri = format!("http://localhost:{port}");
    let scope = "https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email";

    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&prompt=consent",
        urlencoding::encode(INTERNAL_GOOGLE_CLIENT_ID),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(scope)
    );

    open::that(&auth_url).map_err(|e| format!("No se pudo abrir el navegador: {e}"))?;

    let code = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let (mut stream, _) = listener
            .accept()
            .map_err(|e| format!("Error recibiendo callback OAuth: {e}"))?;

        let mut buffer = [0u8; 4096];
        let n = stream
            .read(&mut buffer)
            .map_err(|e| format!("Error leyendo solicitud OAuth: {e}"))?;
        let request = String::from_utf8_lossy(&buffer[..n]);

        let first_line = request.lines().next().unwrap_or("");
        let code_opt = first_line
            .split_whitespace()
            .nth(1)
            .and_then(|path| path.split('?').nth(1))
            .and_then(|query| {
                query.split('&').find_map(|pair| {
                    let mut kv = pair.splitn(2, '=');
                    if kv.next() == Some("code") {
                        kv.next()
                            .map(|v| urlencoding::decode(v).unwrap_or_default().into_owned())
                    } else {
                        None
                    }
                })
            });

        let html = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n\
            <html><body style='font-family:sans-serif;background:#181a20;color:#ffe066;text-align:center;padding:50px;'>\
            <h2>✅ ¡Sesión iniciada en StickyNotes!</h2>\
            <p style='color:#e9ecef;'>Tu cuenta de Google Drive ya está vinculada. Puedes cerrar esta pestaña.</p>\
            </body></html>";
        let _ = stream.write_all(html.as_bytes());
        let _ = stream.flush();

        code_opt.ok_or_else(|| "No se completó la autorización en Google.".to_string())
    })
    .await
    .map_err(|e| format!("Error en tarea OAuth: {e}"))??;

    let client = Client::new();
    let params = [
        ("code", code.as_str()),
        ("client_id", INTERNAL_GOOGLE_CLIENT_ID),
        ("client_secret", INTERNAL_GOOGLE_CLIENT_SECRET),
        ("redirect_uri", redirect_uri.as_str()),
        ("grant_type", "authorization_code"),
    ];

    let resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Error solicitando token: {e}"))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("No se pudo completar el inicio de sesión: {body}"));
    }

    let token_data: TokenResponse = resp
        .json()
        .await
        .map_err(|e| format!("Respuesta de sesión inválida: {e}"))?;

    session.access_token = Some(token_data.access_token.clone());
    if let Some(rt) = token_data.refresh_token {
        session.refresh_token = Some(rt);
    }

    if let Ok(info_resp) = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(&token_data.access_token)
        .send()
        .await
    {
        if let Ok(json) = info_resp.json::<serde_json::Value>().await {
            if let Some(email) = json.get("email").and_then(|v| v.as_str()) {
                session.user_email = Some(email.to_string());
            }
        }
    }

    let email_str = session
        .user_email
        .as_deref()
        .unwrap_or("tu cuenta de Google");
    Ok(format!("Sesión iniciada como {email_str}"))
}

async fn refresh_access_token_if_needed(
    client: &Client,
    session: &mut GoogleDriveSession,
) -> Result<String, String> {
    if let Some(ref refresh_token) = session.refresh_token {
        let params = [
            ("client_id", INTERNAL_GOOGLE_CLIENT_ID),
            ("client_secret", INTERNAL_GOOGLE_CLIENT_SECRET),
            ("refresh_token", refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ];
        if let Ok(resp) = client
            .post("https://oauth2.googleapis.com/token")
            .form(&params)
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(tok) = resp.json::<TokenResponse>().await {
                    session.access_token = Some(tok.access_token.clone());
                    return Ok(tok.access_token);
                }
            }
        }
    }

    session.access_token.clone().ok_or_else(|| {
        "Inicia sesión con tu cuenta de Google para sincronizar tus notas.".to_string()
    })
}

/// Sincroniza bidireccionalmente las notas locales con Google Drive (`appDataFolder`)
pub async fn sync_notes_with_drive(
    local_notes: &[StickyNote],
    session: &mut GoogleDriveSession,
) -> Result<(Vec<StickyNote>, SyncResult), String> {
    let client = Client::new();
    let token = refresh_access_token_if_needed(&client, session).await?;

    let list_url = format!(
        "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name%3D'{}'&fields=files(id,name)",
        SYNC_FILENAME
    );

    let list_resp = client
        .get(&list_url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Error de red consultando Google Drive: {e}"))?;

    if !list_resp.status().is_success() {
        let err_txt = list_resp.text().await.unwrap_or_default();
        return Err(format!("Error de acceso a Google Drive: {err_txt}"));
    }

    let file_list: DriveFileList = list_resp
        .json()
        .await
        .map_err(|e| format!("Error leyendo respuesta de Google Drive: {e}"))?;

    let existing_file_id = file_list.files.first().map(|f| f.id.clone());

    let mut remote_notes: Vec<StickyNote> = Vec::new();
    if let Some(ref fid) = existing_file_id {
        let dl_url = format!(
            "https://www.googleapis.com/drive/v3/files/{}?alt=media",
            fid
        );
        let dl_resp = client
            .get(&dl_url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| format!("Error descargando notas de Google Drive: {e}"))?;
        if dl_resp.status().is_success() {
            remote_notes = dl_resp.json::<Vec<StickyNote>>().await.unwrap_or_default();
        }
    }

    let mut merged_map: HashMap<String, StickyNote> = HashMap::new();
    for note in remote_notes {
        merged_map.insert(note.id.clone(), note);
    }
    for note in local_notes {
        match merged_map.get(&note.id) {
            Some(existing) if existing.updated_at > note.updated_at => {}
            _ => {
                merged_map.insert(note.id.clone(), note.clone());
            }
        }
    }

    let mut merged_notes: Vec<StickyNote> = merged_map.into_values().collect();
    merged_notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    let serialized = serde_json::to_vec_pretty(&merged_notes)
        .map_err(|e| format!("Error serializando notas: {e}"))?;

    if let Some(fid) = existing_file_id {
        let upload_url = format!(
            "https://www.googleapis.com/upload/drive/v3/files/{}?uploadType=media",
            fid
        );
        let up_resp = client
            .patch(&upload_url)
            .bearer_auth(&token)
            .header("Content-Type", "application/json")
            .body(serialized)
            .send()
            .await
            .map_err(|e| format!("Error actualizando respaldo en Google Drive: {e}"))?;

        if !up_resp.status().is_success() {
            let txt = up_resp.text().await.unwrap_or_default();
            return Err(format!("Error guardando en Google Drive: {txt}"));
        }
    } else {
        let meta_body = serde_json::json!({
            "name": SYNC_FILENAME,
            "parents": ["appDataFolder"]
        });
        let create_resp = client
            .post("https://www.googleapis.com/drive/v3/files")
            .bearer_auth(&token)
            .json(&meta_body)
            .send()
            .await
            .map_err(|e| format!("Error creando respaldo en Google Drive: {e}"))?;

        if !create_resp.status().is_success() {
            let txt = create_resp.text().await.unwrap_or_default();
            return Err(format!("No se pudo inicializar carpeta en Google Drive: {txt}"));
        }

        let created: DriveFileItem = create_resp
            .json()
            .await
            .map_err(|e| format!("Respuesta inválida de Google Drive: {e}"))?;

        let upload_url = format!(
            "https://www.googleapis.com/upload/drive/v3/files/{}?uploadType=media",
            created.id
        );
        client
            .patch(&upload_url)
            .bearer_auth(&token)
            .header("Content-Type", "application/json")
            .body(serialized)
            .send()
            .await
            .map_err(|e| format!("Error subiendo respaldo inicial a Google Drive: {e}"))?;
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
            status: "Sincronizado con Google Drive".to_string(),
            merged_count: active_count,
            last_sync: now,
        },
    ))
}
