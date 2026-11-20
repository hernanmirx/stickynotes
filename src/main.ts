import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  ChecklistItem,
  CloudAccountStatus,
  NoteAttachment,
  NoteColor,
  StickyNote,
  SyncResult,
} from "./types";

const COLORS: { id: NoteColor; label: string }[] = [
  { id: "yellow", label: "Marfil" },
  { id: "mint", label: "Salvia" },
  { id: "pink", label: "Rosa Empolvado" },
  { id: "sky", label: "Bruma Azul" },
  { id: "lavender", label: "Lavanda" },
  { id: "dark", label: "Grafito" },
];

/* =========================================================================
   ICONOS SVG MINIMALISTAS (TRAZO FINO 1.75px, ESTILO LUCIDE / LINEAR)
   ========================================================================= */
const ICONS = {
  plus: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  checkSquare: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="m9 12 2 2 4-4"/></svg>`,
  paperclip: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>`,
  palette: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>`,
  grid: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1.5"/><rect width="7" height="7" x="14" y="3" rx="1.5"/><rect width="7" height="7" x="14" y="14" rx="1.5"/><rect width="7" height="7" x="3" y="14" rx="1.5"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
  close: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  search: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
  windows: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>`,
  file: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  external: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg>`,
  download: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
};

const params = new URLSearchParams(window.location.search);
const noteIdParam = params.get("noteId");

const appEl = document.getElementById("app")!;

/** Caché en memoria de Data URLs para miniaturas de imágenes adjuntas */
const imageDataUrlCache = new Map<string, string>();

if (noteIdParam) {
  initStickyNoteWindow(noteIdParam);
} else {
  initManagerWindow();
}

function isImageMime(mime: string, fileName: string): boolean {
  if (mime.toLowerCase().startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(fileName);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const commaIdx = result.indexOf(",");
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function unixToDatetimeLocal(tsSeconds: number | null | undefined): string {
  const date = tsSeconds ? new Date(tsSeconds * 1000) : new Date(Date.now() + 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function formatReminderDate(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function playAlarmChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const notes = [587.33, 880, 587.33, 880, 1174.66];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.16);
      gain.gain.setValueAtTime(0.001, ctx.currentTime + idx * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.24, ctx.currentTime + idx * 0.16 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.16 + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + idx * 0.16);
      osc.stop(ctx.currentTime + idx * 0.16 + 0.15);
    });
  } catch {
    // Silencioso si el audio está bloqueado
  }
}

/* =========================================================================
   MODO 1: VENTANA FLOTANTE INDIVIDUAL DE STICKY NOTE (LINUX DESKTOP)
   ========================================================================= */
async function initStickyNoteWindow(noteId: string) {
  let note = await invoke<StickyNote | null>("get_note", { id: noteId });
  if (!note) {
    appEl.innerHTML = `<div style="padding:20px;color:#fff">Nota no encontrada.</div>`;
    return;
  }
  if (!Array.isArray(note.attachments)) {
    note.attachments = [];
  }

  let showPalette = false;
  let showReminderBar = false;
  let isAlarmRinging = false;
  let isUploading = false;
  let previewImage: { name: string; dataUrl: string } | null = null;
  let saveTimer: number | null = null;
  let cloudSyncTimer: number | null = null;
  let syncStatusText = "Guardado";

  const currentWin = getCurrentWindow();

  let moveTimer: number | null = null;
  const persistGeometry = async () => {
    if (!note) return;
    try {
      const pos = await currentWin.outerPosition();
      const size = await currentWin.innerSize();
      note.x = pos.x;
      note.y = pos.y;
      note.width = size.width;
      note.height = size.height;
      await invoke("save_note", { note });
    } catch {
      // Ignore geometry errors on platforms without floating window coords
    }
  };

  currentWin.onMoved(() => {
    if (moveTimer) window.clearTimeout(moveTimer);
    moveTimer = window.setTimeout(persistGeometry, 400);
  });

  currentWin.onResized(() => {
    if (moveTimer) window.clearTimeout(moveTimer);
    moveTimer = window.setTimeout(persistGeometry, 400);
  });

  await listen<StickyNote[]>("notes-synced", async () => {
    const updated = await invoke<StickyNote | null>("get_note", { id: noteId });
    if (!updated) return;
    if (!Array.isArray(updated.attachments)) updated.attachments = [];

    if (saveTimer) return;
    const hasChanges = JSON.stringify(note) !== JSON.stringify(updated);
    note = updated;
    syncStatusText = "Sincronizado";
    if (hasChanges) {
      renderNote();
    } else {
      updateFooterStatus();
    }
  });

  await listen<StickyNote>("reminder-triggered", async (event) => {
    if (event.payload && event.payload.id === noteId) {
      note = event.payload;
      if (!Array.isArray(note.attachments)) note.attachments = [];
      isAlarmRinging = true;
      playAlarmChime();
      renderNote();
    }
  });

  function triggerAutoCloudSync() {
    if (cloudSyncTimer) window.clearTimeout(cloudSyncTimer);
    cloudSyncTimer = window.setTimeout(async () => {
      try {
        const status = await invoke<CloudAccountStatus>("get_cloud_status");
        if (status.connected && status.auto_sync) {
          await invoke("sync_google_drive");
        }
      } catch {
        // Silencioso si no hay red temporalmente
      }
    }, 650);
  }

  function scheduleSave() {
    if (!note) return;
    syncStatusText = "Guardando...";
    updateFooterStatus();
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(async () => {
      saveTimer = null;
      if (!note) return;
      note.updated_at = Math.floor(Date.now() / 1000);
      await invoke("save_note", { note });
      syncStatusText = "Guardado";
      updateFooterStatus();
      triggerAutoCloudSync();
    }, 280);
  }

  function updateFooterStatus() {
    const el = document.getElementById("footer-status");
    if (el) el.textContent = syncStatusText;
  }

  async function processIncomingFiles(fileList: FileList | File[]) {
    if (!note || isUploading) return;
    const files = Array.from(fileList);
    if (files.length === 0) return;

    isUploading = true;
    syncStatusText = `Adjuntando ${files.length} archivo(s)...`;
    updateFooterStatus();

    try {
      for (const file of files) {
        const base64Data = await fileToBase64(file);
        const created = await invoke<NoteAttachment>("add_attachment", {
          noteId: note.id,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          dataBase64: base64Data,
        });
        if (isImageMime(created.mime_type, created.file_name)) {
          imageDataUrlCache.set(
            created.id,
            `data:${created.mime_type};base64,${base64Data}`
          );
        }
      }
      const refreshed = await invoke<StickyNote | null>("get_note", { id: note.id });
      if (refreshed) {
        note = refreshed;
      }
      syncStatusText = "Adjunto guardado";
      triggerAutoCloudSync();
    } catch (err) {
      syncStatusText = `Error: ${String(err)}`;
    } finally {
      isUploading = false;
      renderNote();
    }
  }

  async function hydrateImageThumbnails() {
    if (!note) return;
    for (const att of note.attachments) {
      if (!isImageMime(att.mime_type, att.file_name)) continue;
      if (imageDataUrlCache.has(att.id)) continue;
      try {
        const dataUrl = await invoke<string>("get_attachment_data_url", {
          attachmentId: att.id,
        });
        imageDataUrlCache.set(att.id, dataUrl);
        const imgEl = document.querySelector(
          `img[data-att-thumb="${att.id}"]`
        ) as HTMLImageElement | null;
        if (imgEl) {
          imgEl.src = dataUrl;
        }
      } catch {
        // Ignorar si aún no está disponible offline
      }
    }
  }

  function renderNote() {
    if (!note) return;
    const totalChecks = note.checklist.length;
    const doneChecks = note.checklist.filter((c) => c.checked).length;
    const pct = totalChecks > 0 ? Math.round((doneChecks / totalChecks) * 100) : 0;
    const attachments = note.attachments || [];
    const hasReminder = Boolean(note.reminder_at && note.reminder_at > 0);
    const isDueOrTriggered =
      isAlarmRinging ||
      Boolean(
        note.reminder_at &&
          note.reminder_notified &&
          Math.floor(Date.now() / 1000) >= note.reminder_at
      );

    appEl.innerHTML = `
      <div class="note-window theme-${note.color} ${isDueOrTriggered ? "alarm-ringing" : ""}" id="note-dropzone">
        <div class="note-topbar" data-tauri-drag-region>
          <div class="topbar-left">
            <button class="icon-btn" id="btn-new-note" title="Nueva nota">${ICONS.plus}</button>
            <button class="icon-btn ${note.show_checklist ? "active" : ""}" id="btn-toggle-check" title="Lista de tareas">${ICONS.checkSquare}</button>
            <button class="icon-btn ${attachments.length > 0 ? "active" : ""}" id="btn-attach" title="Adjuntar archivo">${ICONS.paperclip}</button>
            <button class="icon-btn ${hasReminder || showReminderBar ? "active" : ""}" id="btn-reminder" title="${
              hasReminder
                ? `Recordatorio: ${formatReminderDate(note.reminder_at!)}`
                : "Recordatorio"
            }">${ICONS.clock}</button>
            <button class="icon-btn ${showPalette ? "active" : ""}" id="btn-palette" title="Color de nota">${ICONS.palette}</button>
            <input
              type="file"
              id="file-picker-input"
              multiple
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.txt,.csv,.md,.zip,.rar,.7z"
              style="display:none"
            />
          </div>
          <div class="topbar-right">
            <button class="icon-btn ${note.always_on_top ? "active" : ""}" id="btn-pin" title="${
              note.always_on_top ? "Desfijar ventana" : "Mantener siempre visible"
            }">${ICONS.pin}</button>
            <button class="icon-btn" id="btn-manager" title="Todas las notas">${ICONS.grid}</button>
            <button class="icon-btn danger" id="btn-delete" title="Eliminar nota">${ICONS.trash}</button>
            <button class="icon-btn" id="btn-close" title="Cerrar ventana">${ICONS.close}</button>
          </div>
        </div>

        ${
          showPalette
            ? `
          <div class="color-palette-bar">
            ${COLORS.map(
              (c) => `
              <div
                class="color-swatch swatch-${c.id} ${note!.color === c.id ? "selected" : ""}"
                data-color="${c.id}"
                title="${c.label}"
              ></div>
            `
            ).join("")}
          </div>
        `
            : ""
        }

        ${
          showReminderBar
            ? `
          <div class="reminder-config-bar">
            <div class="reminder-config-row">
              <span class="reminder-label">Recordatorio</span>
              <input
                type="datetime-local"
                id="input-reminder-dt"
                class="reminder-datetime-input"
                value="${unixToDatetimeLocal(note.reminder_at)}"
              />
            </div>
            <div class="reminder-quick-row">
              <button class="btn-chip" data-quick-mins="15">+15 min</button>
              <button class="btn-chip" data-quick-mins="60">+1 h</button>
              <button class="btn-chip" data-quick-mins="1440">Mañana</button>
              <div style="flex:1"></div>
              ${
                hasReminder
                  ? `<button class="btn-chip danger" id="btn-clear-reminder">Quitar</button>`
                  : ""
              }
              <button class="btn-small" id="btn-save-reminder">Guardar</button>
            </div>
          </div>
        `
            : ""
        }

        ${
          isDueOrTriggered && note.reminder_at
            ? `
          <div class="alarm-alert-banner">
            <div class="alarm-alert-text">
              <strong>Recordatorio activo</strong>
              <span>${formatReminderDate(note.reminder_at)}</span>
            </div>
            <div class="alarm-alert-actions">
              <button class="btn-chip" id="btn-snooze-10">+10 min</button>
              <button class="btn-small" id="btn-dismiss-alarm">Listo</button>
            </div>
          </div>
        `
            : hasReminder && !showReminderBar
            ? `
          <div class="reminder-badge-strip" id="strip-edit-reminder" title="Cambiar recordatorio">
            <span class="strip-left">${ICONS.bell} <span>${formatReminderDate(note.reminder_at!)}</span></span>
            <span class="strip-edit">Editar</span>
          </div>
        `
            : ""
        }

        <div class="note-body">
          <input
            type="text"
            id="note-title"
            class="note-title-input"
            placeholder="Título..."
            value="${escapeHtml(note.title)}"
          />

          <textarea
            id="note-content"
            class="note-textarea"
            placeholder="Escribe una nota..."
          >${escapeHtml(note.content)}</textarea>

          ${
            note.show_checklist
              ? `
            <div class="checklist-section">
              <div class="checklist-header">
                <span>Tareas</span>
                <span>${doneChecks}/${totalChecks}</span>
              </div>
              <div class="progress-track">
                <div class="progress-fill" style="width: ${pct}%"></div>
              </div>
              <div class="checklist-items" id="checklist-container">
                ${note.checklist
                  .map(
                    (item, idx) => `
                  <div class="checklist-row" data-idx="${idx}">
                    <input
                      type="checkbox"
                      class="checklist-checkbox"
                      data-check-idx="${idx}"
                      ${item.checked ? "checked" : ""}
                    />
                    <input
                      type="text"
                      class="checklist-text ${item.checked ? "checked" : ""}"
                      data-text-idx="${idx}"
                      value="${escapeHtml(item.text)}"
                      placeholder="Tarea..."
                    />
                    <button class="icon-btn danger" data-del-idx="${idx}" title="Quitar">${ICONS.close}</button>
                  </div>
                `
                  )
                  .join("")}
              </div>
              <div class="checklist-add-row">
                <input
                  type="text"
                  id="new-check-input"
                  class="checklist-add-input"
                  placeholder="Añadir tarea..."
                />
                <button class="btn-small" id="btn-add-check">Añadir</button>
              </div>
            </div>
          `
              : ""
          }

          ${
            attachments.length > 0
              ? `
            <div class="attachments-section">
              <div class="checklist-header">
                <span>Adjuntos (${attachments.length})</span>
                <button class="btn-link" id="btn-add-more-att">+ Añadir</button>
              </div>
              <div class="attachments-list">
                ${attachments
                  .map((att) => {
                    const isImg = isImageMime(att.mime_type, att.file_name);
                    const cachedThumb = imageDataUrlCache.get(att.id) || "";
                    return `
                      <div class="attachment-card ${isImg ? "is-image" : "is-doc"}">
                        ${
                          isImg
                            ? `
                          <div class="attachment-thumb-wrap" data-preview-att="${att.id}" title="Ver imagen">
                            <img
                              class="attachment-thumb"
                              data-att-thumb="${att.id}"
                              src="${cachedThumb}"
                              alt="${escapeHtml(att.file_name)}"
                            />
                          </div>
                        `
                            : `
                          <div class="attachment-doc-icon" data-open-att="${att.id}" title="Abrir documento">
                            ${ICONS.file}
                          </div>
                        `
                        }
                        <div class="attachment-info" data-open-att="${att.id}" title="Abrir ${escapeHtml(att.file_name)}">
                          <div class="attachment-name">${escapeHtml(att.file_name)}</div>
                          <div class="attachment-meta">
                            <span>${formatBytes(att.size)}</span>
                            <span>·</span>
                            <span>${att.uploaded ? "Sincronizado" : "Local"}</span>
                          </div>
                        </div>
                        <div class="attachment-actions">
                          <button class="icon-btn" data-open-att="${att.id}" title="Abrir">${ICONS.external}</button>
                          <button class="icon-btn" data-download-att="${att.id}" title="Guardar">${ICONS.download}</button>
                          <button class="icon-btn danger" data-remove-att="${att.id}" title="Quitar">${ICONS.close}</button>
                        </div>
                      </div>
                    `;
                  })
                  .join("")}
              </div>
            </div>
          `
              : ""
          }
        </div>

        ${
          previewImage
            ? `
          <div class="image-lightbox" id="lightbox-backdrop">
            <div class="image-lightbox-bar">
              <span>${escapeHtml(previewImage.name)}</span>
              <button class="icon-btn" id="btn-close-lightbox" style="color:#fff">${ICONS.close}</button>
            </div>
            <img src="${previewImage.dataUrl}" alt="${escapeHtml(previewImage.name)}" class="image-lightbox-img" />
          </div>
        `
            : ""
        }

        <div class="note-footer" data-tauri-drag-region>
          <span id="footer-status">${syncStatusText}</span>
          <span>${
            hasReminder ? `${formatReminderDate(note.reminder_at!)} · ` : ""
          }${
            attachments.length > 0 ? `${attachments.length} adj. · ` : ""
          }${note.always_on_top ? "Fijada" : ""}</span>
        </div>
      </div>
    `;

    bindNoteEvents();
    hydrateImageThumbnails();
  }

  function bindNoteEvents() {
    if (!note) return;

    const topbar = document.querySelector(".note-topbar");
    topbar?.addEventListener("mousedown", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest("button") || target.closest("input")) return;
      currentWin.startDragging().catch(() => {});
    });

    document.getElementById("btn-new-note")?.addEventListener("click", async () => {
      await invoke("create_and_open_note");
    });

    document.getElementById("btn-toggle-check")?.addEventListener("click", () => {
      if (!note) return;
      note.show_checklist = !note.show_checklist;
      scheduleSave();
      renderNote();
    });

    const fileInput = document.getElementById("file-picker-input") as HTMLInputElement | null;
    const openFilePicker = () => fileInput?.click();

    document.getElementById("btn-attach")?.addEventListener("click", openFilePicker);
    document.getElementById("btn-add-more-att")?.addEventListener("click", openFilePicker);

    fileInput?.addEventListener("change", async () => {
      if (fileInput.files && fileInput.files.length > 0) {
        await processIncomingFiles(fileInput.files);
        fileInput.value = "";
      }
    });

    document.getElementById("btn-reminder")?.addEventListener("click", () => {
      showReminderBar = !showReminderBar;
      showPalette = false;
      renderNote();
    });

    document.getElementById("strip-edit-reminder")?.addEventListener("click", () => {
      showReminderBar = true;
      renderNote();
    });

    document.querySelectorAll("[data-quick-mins]").forEach((el) => {
      el.addEventListener("click", () => {
        const mins = Number((el as HTMLElement).dataset.quickMins);
        const targetTs = Math.floor(Date.now() / 1000) + mins * 60;
        const dtInput = document.getElementById("input-reminder-dt") as HTMLInputElement | null;
        if (dtInput) {
          dtInput.value = unixToDatetimeLocal(targetTs);
        }
      });
    });

    document.getElementById("btn-save-reminder")?.addEventListener("click", async () => {
      if (!note) return;
      const dtInput = document.getElementById("input-reminder-dt") as HTMLInputElement | null;
      if (!dtInput || !dtInput.value) return;
      const parsedMs = new Date(dtInput.value).getTime();
      if (Number.isNaN(parsedMs)) return;

      const reminderTs = Math.floor(parsedMs / 1000);
      note = await invoke<StickyNote>("update_note_reminder", {
        id: note.id,
        reminderAt: reminderTs,
      });
      showReminderBar = false;
      isAlarmRinging = false;
      syncStatusText = `Recordatorio: ${formatReminderDate(reminderTs)}`;
      triggerAutoCloudSync();
      renderNote();
    });

    document.getElementById("btn-clear-reminder")?.addEventListener("click", async () => {
      if (!note) return;
      note = await invoke<StickyNote>("update_note_reminder", {
        id: note.id,
        reminderAt: null,
      });
      showReminderBar = false;
      isAlarmRinging = false;
      syncStatusText = "Recordatorio quitado";
      triggerAutoCloudSync();
      renderNote();
    });

    document.getElementById("btn-snooze-10")?.addEventListener("click", async () => {
      if (!note) return;
      const snoozeTs = Math.floor(Date.now() / 1000) + 10 * 60;
      note = await invoke<StickyNote>("update_note_reminder", {
        id: note.id,
        reminderAt: snoozeTs,
      });
      isAlarmRinging = false;
      syncStatusText = `Pospuesto a ${formatReminderDate(snoozeTs)}`;
      triggerAutoCloudSync();
      renderNote();
    });

    document.getElementById("btn-dismiss-alarm")?.addEventListener("click", async () => {
      if (!note) return;
      note = await invoke<StickyNote>("update_note_reminder", {
        id: note.id,
        reminderAt: null,
      });
      isAlarmRinging = false;
      syncStatusText = "Completado";
      triggerAutoCloudSync();
      renderNote();
    });

    const dropzone = document.getElementById("note-dropzone");
    dropzone?.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("drag-over");
    });
    dropzone?.addEventListener("dragleave", () => {
      dropzone.classList.remove("drag-over");
    });
    dropzone?.addEventListener("drop", async (e) => {
      e.preventDefault();
      dropzone.classList.remove("drag-over");
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        await processIncomingFiles(e.dataTransfer.files);
      }
    });

    document.getElementById("note-content")?.addEventListener("paste", async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const pastedFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f) pastedFiles.push(f);
        }
      }
      if (pastedFiles.length > 0) {
        e.preventDefault();
        await processIncomingFiles(pastedFiles);
      }
    });

    document.getElementById("btn-palette")?.addEventListener("click", () => {
      showPalette = !showPalette;
      showReminderBar = false;
      renderNote();
    });

    document.querySelectorAll(".color-swatch").forEach((el) => {
      el.addEventListener("click", () => {
        if (!note) return;
        const col = (el as HTMLElement).dataset.color as NoteColor;
        note.color = col;
        showPalette = false;
        scheduleSave();
        renderNote();
      });
    });

    document.getElementById("btn-pin")?.addEventListener("click", async () => {
      if (!note) return;
      note.always_on_top = !note.always_on_top;
      await invoke("set_note_always_on_top", {
        id: note.id,
        alwaysOnTop: note.always_on_top,
      });
      scheduleSave();
      renderNote();
    });

    document.getElementById("btn-manager")?.addEventListener("click", async () => {
      await invoke("open_manager_window");
    });

    document.getElementById("btn-delete")?.addEventListener("click", async () => {
      if (!note) return;
      await invoke("delete_note", { id: note.id });
    });

    document.getElementById("btn-close")?.addEventListener("click", async () => {
      if (!note) return;
      await invoke("close_note_window", { id: note.id });
    });

    const titleInput = document.getElementById("note-title") as HTMLInputElement | null;
    titleInput?.addEventListener("input", () => {
      if (!note || !titleInput) return;
      note.title = titleInput.value;
      scheduleSave();
    });

    const contentInput = document.getElementById("note-content") as HTMLTextAreaElement | null;
    contentInput?.addEventListener("input", () => {
      if (!note || !contentInput) return;
      note.content = contentInput.value;
      scheduleSave();
    });

    document.querySelectorAll("[data-check-idx]").forEach((el) => {
      el.addEventListener("change", () => {
        if (!note) return;
        const idx = Number((el as HTMLElement).dataset.checkIdx);
        if (note.checklist[idx]) {
          note.checklist[idx].checked = (el as HTMLInputElement).checked;
          scheduleSave();
          renderNote();
        }
      });
    });

    document.querySelectorAll("[data-text-idx]").forEach((el) => {
      el.addEventListener("input", () => {
        if (!note) return;
        const idx = Number((el as HTMLElement).dataset.textIdx);
        if (note.checklist[idx]) {
          note.checklist[idx].text = (el as HTMLInputElement).value;
          scheduleSave();
        }
      });
    });

    document.querySelectorAll("[data-del-idx]").forEach((el) => {
      el.addEventListener("click", () => {
        if (!note) return;
        const idx = Number((el as HTMLElement).dataset.delIdx);
        note.checklist.splice(idx, 1);
        scheduleSave();
        renderNote();
      });
    });

    const addCheckItem = () => {
      if (!note) return;
      const input = document.getElementById("new-check-input") as HTMLInputElement | null;
      if (!input || !input.value.trim()) return;
      const newItem: ChecklistItem = {
        id: crypto.randomUUID(),
        text: input.value.trim(),
        checked: false,
      };
      note.checklist.push(newItem);
      scheduleSave();
      renderNote();
      const nextInput = document.getElementById("new-check-input") as HTMLInputElement | null;
      nextInput?.focus();
    };

    document.getElementById("btn-add-check")?.addEventListener("click", addCheckItem);
    document.getElementById("new-check-input")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addCheckItem();
      }
    });

    document.querySelectorAll("[data-preview-att]").forEach((el) => {
      el.addEventListener("click", async () => {
        if (!note) return;
        const attId = (el as HTMLElement).dataset.previewAtt!;
        const att = note.attachments.find((a) => a.id === attId);
        if (!att) return;
        try {
          const dataUrl =
            imageDataUrlCache.get(attId) ||
            (await invoke<string>("get_attachment_data_url", { attachmentId: attId }));
          imageDataUrlCache.set(attId, dataUrl);
          previewImage = { name: att.file_name, dataUrl };
          renderNote();
        } catch (err) {
          syncStatusText = `Error: ${String(err)}`;
          updateFooterStatus();
        }
      });
    });

    document.getElementById("lightbox-backdrop")?.addEventListener("click", () => {
      previewImage = null;
      renderNote();
    });
    document.getElementById("btn-close-lightbox")?.addEventListener("click", (e) => {
      e.stopPropagation();
      previewImage = null;
      renderNote();
    });

    document.querySelectorAll("[data-open-att]").forEach((el) => {
      el.addEventListener("click", async () => {
        const attId = (el as HTMLElement).dataset.openAtt!;
        try {
          await invoke("open_attachment", { attachmentId: attId });
        } catch (err) {
          syncStatusText = `Error: ${String(err)}`;
          updateFooterStatus();
        }
      });
    });

    document.querySelectorAll("[data-download-att]").forEach((el) => {
      el.addEventListener("click", async () => {
        if (!note) return;
        const attId = (el as HTMLElement).dataset.downloadAtt!;
        const att = note.attachments.find((a) => a.id === attId);
        if (!att) return;
        try {
          const dataUrl = await invoke<string>("get_attachment_data_url", {
            attachmentId: attId,
          });
          const link = document.createElement("a");
          link.href = dataUrl;
          link.download = att.file_name;
          document.body.appendChild(link);
          link.click();
          link.remove();
        } catch (err) {
          syncStatusText = `Error: ${String(err)}`;
          updateFooterStatus();
        }
      });
    });

    document.querySelectorAll("[data-remove-att]").forEach((el) => {
      el.addEventListener("click", async () => {
        if (!note) return;
        const attId = (el as HTMLElement).dataset.removeAtt!;
        try {
          await invoke("remove_attachment", {
            noteId: note.id,
            attachmentId: attId,
          });
          imageDataUrlCache.delete(attId);
          note.attachments = note.attachments.filter((a) => a.id !== attId);
          syncStatusText = "Adjunto eliminado";
          triggerAutoCloudSync();
          renderNote();
        } catch (err) {
          syncStatusText = `Error: ${String(err)}`;
          updateFooterStatus();
        }
      });
    });
  }

  renderNote();
}

/* =========================================================================
   MODO 2: PANEL DE NOTAS MINIMALISTA Y MODAL DE CONFIGURACIÓN
   ========================================================================= */
async function initManagerWindow() {
  let notes: StickyNote[] = [];
  let cloudStatus: CloudAccountStatus = await invoke("get_cloud_status");
  let searchQuery = "";
  let statusBanner = "";
  let showSettingsModal = false;
  let showServerInput = false;
  let emailInput = "";
  let passwordInput = "";

  async function refreshData() {
    notes = await invoke<StickyNote[]>("list_notes");
    cloudStatus = await invoke<CloudAccountStatus>("get_cloud_status");
    renderManager();
  }

  await listen("notes-updated", refreshData);
  await listen("notes-synced", refreshData);
  await listen<StickyNote>("reminder-triggered", (event) => {
    playAlarmChime();
    const title = event.payload?.title || "Nota sin título";
    statusBanner = `Recordatorio: "${title}"`;
    refreshData();
  });

  function renderManager() {
    const activeNotes = notes.filter((n) => !n.deleted);
    const filtered = activeNotes.filter((n) => {
      const q = searchQuery.toLowerCase();
      if (!q) return true;
      const inTitle = n.title.toLowerCase().includes(q);
      const inContent = n.content.toLowerCase().includes(q);
      const inCheck = n.checklist.some((c) => c.text.toLowerCase().includes(q));
      const inAtt = (n.attachments || []).some((a) =>
        a.file_name.toLowerCase().includes(q)
      );
      return inTitle || inContent || inCheck || inAtt;
    });

    const lastSyncFormatted = cloudStatus.last_sync
      ? new Date(cloudStatus.last_sync * 1000).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "Sin sincronizar";

    appEl.innerHTML = `
      <div class="manager-window">
        <!-- Cabecera Minimalista -->
        <header class="manager-header">
          <div class="manager-brand">
            <div class="brand-title-row">
              <h1>StickyNotes</h1>
              <span class="notes-counter">${activeNotes.length}</span>
            </div>
            <button class="sync-pill" id="btn-open-settings-pill" title="Configuración de cuenta y sincronización">
              <span class="status-dot ${cloudStatus.connected ? "online" : "offline"}"></span>
              <span>${
                cloudStatus.connected
                  ? `${escapeHtml(cloudStatus.user_email || "Conectado")} · ${lastSyncFormatted}`
                  : "Local · Configurar sincronización"
              }</span>
            </button>
          </div>

          <div class="manager-actions">
            <button class="btn-ghost" id="mgr-open-all" title="Abrir todas las notas en el escritorio">
              ${ICONS.windows}
              <span>Mostrar ventanas</span>
            </button>
            <button class="btn-ghost icon-only" id="btn-toggle-settings" title="Configuración y sincronización">
              ${ICONS.settings}
            </button>
            <button class="btn-primary" id="mgr-new-note">
              ${ICONS.plus}
              <span>Nueva nota</span>
            </button>
          </div>
        </header>

        <main class="manager-content">
          <!-- Barra de búsqueda limpia -->
          <div class="search-bar">
            <span class="search-icon">${ICONS.search}</span>
            <input
              type="text"
              id="mgr-search"
              class="search-input"
              placeholder="Buscar notas, tareas o archivos..."
              value="${escapeHtml(searchQuery)}"
            />
          </div>

          <!-- Cuadrícula de notas -->
          <div class="notes-grid">
            ${
              filtered.length === 0
                ? `
                <div class="empty-state">
                  <p class="empty-title">No hay notas para mostrar</p>
                  <p class="empty-sub">Crea una nota nueva o ajusta tu búsqueda.</p>
                </div>
              `
                : filtered
                    .map((n) => {
                      const done = n.checklist.filter((c) => c.checked).length;
                      const total = n.checklist.length;
                      const attCount = (n.attachments || []).length;
                      const hasReminder = Boolean(n.reminder_at && n.reminder_at > 0);
                      return `
                      <div class="note-card theme-${n.color}" data-card-open-id="${n.id}">
                        <div class="note-card-top">
                          <div class="note-card-header">
                            <div class="note-card-title">${escapeHtml(n.title || "Sin título")}</div>
                            ${
                              n.is_open
                                ? `<span class="badge-status">Abierta</span>`
                                : ""
                            }
                          </div>

                          ${
                            hasReminder
                              ? `
                            <div class="note-card-reminder">
                              ${ICONS.clock}
                              <span>${formatReminderDate(n.reminder_at!)}</span>
                            </div>
                          `
                              : ""
                          }

                          <div class="note-card-preview">${escapeHtml(
                            n.content ||
                              (total > 0
                                ? `${done} de ${total} tareas completadas`
                                : attCount > 0
                                ? `${attCount} archivo(s) adjunto(s)`
                                : "Nota vacía")
                          )}</div>
                        </div>

                        <div class="note-card-footer">
                          <div class="note-card-meta">
                            ${total > 0 ? `<span>${done}/${total} tareas</span>` : `<span>Nota</span>`}
                            ${attCount > 0 ? `<span>· ${attCount} adj.</span>` : ""}
                          </div>
                          <div class="note-card-actions">
                            <button class="btn-card-action" data-open-id="${n.id}">
                              ${n.is_open ? "Enfocar" : "Abrir"}
                            </button>
                            <button class="icon-btn danger" data-mgr-del-id="${n.id}" title="Eliminar nota">
                              ${ICONS.trash}
                            </button>
                          </div>
                        </div>
                      </div>
                    `;
                    })
                    .join("")
            }
          </div>
        </main>

        <!-- Modal de Configuración, Servidor y Sincronización -->
        ${
          showSettingsModal
            ? `
          <div class="settings-backdrop" id="settings-backdrop">
            <div class="settings-modal" id="settings-modal">
              <div class="settings-header">
                <div>
                  <h2>Configuración y Sincronización</h2>
                  <p>Gestiona tu cuenta en la nube y la conexión con tu servidor</p>
                </div>
                <button class="btn-ghost icon-only" id="btn-close-settings" title="Cerrar">
                  ${ICONS.close}
                </button>
              </div>

              <div class="settings-body">
                <!-- Sección Cuenta -->
                <div class="settings-section">
                  <div class="settings-row-between">
                    <div>
                      <div class="settings-label">Estado de la cuenta</div>
                      <div class="settings-value">
                        <span class="status-dot ${cloudStatus.connected ? "online" : "offline"}"></span>
                        ${
                          cloudStatus.connected
                            ? `Conectado como <strong>${escapeHtml(cloudStatus.user_email || "Usuario")}</strong>`
                            : "Sin sesión iniciada"
                        }
                      </div>
                    </div>
                    ${
                      cloudStatus.connected
                        ? `<button class="btn-ghost danger-text" id="btn-logout">Cerrar sesión</button>`
                        : ""
                    }
                  </div>

                  ${
                    cloudStatus.connected
                      ? `
                    <div class="settings-controls-box">
                      <label class="toggle-row">
                        <span>Sincronización automática en tiempo real</span>
                        <input type="checkbox" id="chk-auto-sync" ${
                          cloudStatus.auto_sync ? "checked" : ""
                        } />
                      </label>
                      <div class="settings-row-between" style="padding-top:8px; border-top:1px solid rgba(255,255,255,0.06);">
                        <span class="settings-muted">Última sincronización: ${
                          cloudStatus.last_sync
                            ? new Date(cloudStatus.last_sync * 1000).toLocaleString()
                            : "Pendiente"
                        }</span>
                        <button class="btn-primary" id="btn-sync-now">
                          ${ICONS.refresh}
                          <span>Sincronizar ahora</span>
                        </button>
                      </div>
                    </div>
                  `
                      : `
                    <div class="auth-grid">
                      <div class="field-group">
                        <label>Correo electrónico</label>
                        <input
                          type="email"
                          id="auth-email"
                          placeholder="nombre@dominio.com"
                          value="${escapeHtml(emailInput)}"
                        />
                      </div>
                      <div class="field-group">
                        <label>Contraseña</label>
                        <input
                          type="password"
                          id="auth-password"
                          placeholder="Mínimo 6 caracteres"
                          value="${escapeHtml(passwordInput)}"
                        />
                      </div>
                      <div class="auth-actions">
                        <button class="btn-primary" id="btn-login">Iniciar sesión</button>
                        <button class="btn-ghost" id="btn-register">Crear cuenta</button>
                      </div>
                    </div>
                  `
                  }
                </div>

                <!-- Sección Servidor -->
                <div class="settings-section">
                  <div class="settings-row-between">
                    <div>
                      <div class="settings-label">Servidor de sincronización (API PHP)</div>
                      <div class="settings-muted">${escapeHtml(cloudStatus.api_url)}</div>
                    </div>
                    <button class="btn-ghost" id="btn-toggle-server">
                      ${showServerInput ? "Cancelar" : "Cambiar"}
                    </button>
                  </div>

                  ${
                    showServerInput
                      ? `
                    <div class="server-edit-row">
                      <input
                        type="url"
                        id="input-api-url"
                        placeholder="https://tudominio.com/stickynotes/api.php"
                        value="${escapeHtml(cloudStatus.api_url)}"
                      />
                      <button class="btn-primary" id="btn-save-url">Guardar</button>
                    </div>
                  `
                      : ""
                  }
                </div>

                ${
                  statusBanner
                    ? `<div class="sync-status-msg">${escapeHtml(statusBanner)}</div>`
                    : ""
                }
              </div>
            </div>
          </div>
        `
            : ""
        }
      </div>
    `;

    bindManagerEvents();
  }

  function bindManagerEvents() {
    document.getElementById("mgr-new-note")?.addEventListener("click", async () => {
      await invoke("create_and_open_note");
      await refreshData();
    });

    document.getElementById("mgr-open-all")?.addEventListener("click", async () => {
      await invoke("open_all_note_windows");
      await refreshData();
    });

    const openSettings = () => {
      showSettingsModal = true;
      renderManager();
    };

    document.getElementById("btn-toggle-settings")?.addEventListener("click", openSettings);
    document.getElementById("btn-open-settings-pill")?.addEventListener("click", openSettings);

    document.getElementById("btn-close-settings")?.addEventListener("click", () => {
      showSettingsModal = false;
      renderManager();
    });

    document.getElementById("settings-backdrop")?.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).id === "settings-backdrop") {
        showSettingsModal = false;
        renderManager();
      }
    });

    document.getElementById("btn-toggle-server")?.addEventListener("click", () => {
      showServerInput = !showServerInput;
      renderManager();
    });

    document.getElementById("btn-save-url")?.addEventListener("click", async () => {
      const val = (document.getElementById("input-api-url") as HTMLInputElement)?.value || "";
      await invoke("set_api_url", { apiUrl: val });
      showServerInput = false;
      statusBanner = "Dirección del servidor actualizada.";
      await refreshData();
    });

    const emailEl = document.getElementById("auth-email") as HTMLInputElement | null;
    const passEl = document.getElementById("auth-password") as HTMLInputElement | null;
    emailEl?.addEventListener("input", () => {
      emailInput = emailEl.value;
    });
    passEl?.addEventListener("input", () => {
      passwordInput = passEl.value;
    });

    const handleAuth = async (cmd: "auth_login" | "auth_register") => {
      emailInput = emailEl?.value.trim() || emailInput;
      passwordInput = passEl?.value || passwordInput;
      statusBanner =
        cmd === "auth_login" ? "Iniciando sesión..." : "Creando cuenta...";
      renderManager();
      try {
        const msg = await invoke<string>(cmd, {
          email: emailInput,
          password: passwordInput,
        });
        passwordInput = "";
        statusBanner = `${msg} · Sincronizando...`;
        renderManager();
        const res = await invoke<SyncResult>("sync_google_drive");
        statusBanner = `${res.status} (${res.merged_count} notas)`;
      } catch (err) {
        statusBanner = String(err);
      }
      await refreshData();
    };

    document.getElementById("btn-login")?.addEventListener("click", () => handleAuth("auth_login"));
    document
      .getElementById("btn-register")
      ?.addEventListener("click", () => handleAuth("auth_register"));

    const searchInput = document.getElementById("mgr-search") as HTMLInputElement | null;
    searchInput?.addEventListener("input", () => {
      searchQuery = searchInput.value;
      renderManager();
      const refocused = document.getElementById("mgr-search") as HTMLInputElement | null;
      if (refocused) {
        refocused.focus();
        refocused.setSelectionRange(refocused.value.length, refocused.value.length);
      }
    });

    document.getElementById("btn-sync-now")?.addEventListener("click", async () => {
      statusBanner = "Sincronizando...";
      renderManager();
      try {
        const res = await invoke<SyncResult>("sync_google_drive");
        statusBanner = `${res.status} (${res.merged_count} notas activas)`;
      } catch (err) {
        statusBanner = String(err);
      }
      await refreshData();
    });

    document.getElementById("chk-auto-sync")?.addEventListener("change", async (e) => {
      const enabled = (e.target as HTMLInputElement).checked;
      await invoke("set_auto_sync", { enabled });
      await refreshData();
    });

    document.getElementById("btn-logout")?.addEventListener("click", async () => {
      await invoke("logout_google");
      statusBanner = "Sesión cerrada.";
      await refreshData();
    });

    document.querySelectorAll("[data-open-id]").forEach((el) => {
      el.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = (el as HTMLElement).dataset.openId!;
        await invoke("open_note_window", { id });
        await refreshData();
      });
    });

    document.querySelectorAll("[data-card-open-id]").forEach((el) => {
      el.addEventListener("click", async (e) => {
        const target = e.target as HTMLElement;
        if (target.closest("button")) return;
        const id = (el as HTMLElement).dataset.cardOpenId!;
        await invoke("open_note_window", { id });
        await refreshData();
      });
    });

    document.querySelectorAll("[data-mgr-del-id]").forEach((el) => {
      el.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = (el as HTMLElement).dataset.mgrDelId!;
        await invoke("delete_note", { id });
        await refreshData();
      });
    });
  }

  await refreshData();
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
