import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  ChecklistItem,
  CloudAccountStatus,
  NoteColor,
  StickyNote,
  SyncResult,
} from "./types";

const COLORS: { id: NoteColor; label: string }[] = [
  { id: "yellow", label: "Amarillo" },
  { id: "mint", label: "Verde Menta" },
  { id: "pink", label: "Rosa Pastel" },
  { id: "sky", label: "Azul Cielo" },
  { id: "lavender", label: "Lavanda" },
  { id: "dark", label: "Oscuro" },
];

const params = new URLSearchParams(window.location.search);
const noteIdParam = params.get("noteId");

const appEl = document.getElementById("app")!;

if (noteIdParam) {
  initStickyNoteWindow(noteIdParam);
} else {
  initManagerWindow();
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

  let showPalette = false;
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
    if (updated) {
      note = updated;
      syncStatusText = "Sincronizado en Drive ✓";
      renderNote();
    }
  });

  function scheduleSave() {
    if (!note) return;
    syncStatusText = "Guardando...";
    updateFooterStatus();
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(async () => {
      if (!note) return;
      note.updated_at = Math.floor(Date.now() / 1000);
      await invoke("save_note", { note });
      syncStatusText = "Guardado ✓";
      updateFooterStatus();

      // Si el usuario tiene sesión iniciada y auto_sync activo, respaldamos en segundo plano
      if (cloudSyncTimer) window.clearTimeout(cloudSyncTimer);
      cloudSyncTimer = window.setTimeout(async () => {
        try {
          const status = await invoke<CloudAccountStatus>("get_cloud_status");
          if (status.connected && status.auto_sync) {
            await invoke("sync_google_drive");
          }
        } catch {
          // Silencioso en segundo plano si no hay internet temporalmente
        }
      }, 4000);
    }, 280);
  }

  function updateFooterStatus() {
    const el = document.getElementById("footer-status");
    if (el) el.textContent = syncStatusText;
  }

  function renderNote() {
    if (!note) return;
    const totalChecks = note.checklist.length;
    const doneChecks = note.checklist.filter((c) => c.checked).length;
    const pct = totalChecks > 0 ? Math.round((doneChecks / totalChecks) * 100) : 0;

    appEl.innerHTML = `
      <div class="note-window theme-${note.color}">
        <div class="note-topbar" data-tauri-drag-region>
          <div class="topbar-left">
            <button class="icon-btn" id="btn-new-note" title="Nueva nota flotante (+)">➕</button>
            <button class="icon-btn ${note.show_checklist ? "active" : ""}" id="btn-toggle-check" title="Mostrar/Ocultar Lista de Comprobación">☑️</button>
            <button class="icon-btn ${showPalette ? "active" : ""}" id="btn-palette" title="Cambiar color de nota">🎨</button>
          </div>
          <div class="topbar-right">
            <button class="icon-btn ${note.always_on_top ? "active" : ""}" id="btn-pin" title="${
              note.always_on_top
                ? "Fijada siempre visible (Click para desfijar)"
                : "Fijar nota siempre encima"
            }">📌</button>
            <button class="icon-btn" id="btn-manager" title="Mis notas y Cuenta de Google">☁️</button>
            <button class="icon-btn danger" id="btn-delete" title="Eliminar nota">🗑️</button>
            <button class="icon-btn" id="btn-close" title="Ocultar ventana de nota">✕</button>
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

        <div class="note-body">
          <input
            type="text"
            id="note-title"
            class="note-title-input"
            placeholder="Título de la nota..."
            value="${escapeHtml(note.title)}"
          />

          <textarea
            id="note-content"
            class="note-textarea"
            placeholder="Escribe una nota rápida aquí..."
          >${escapeHtml(note.content)}</textarea>

          ${
            note.show_checklist
              ? `
            <div class="checklist-section">
              <div class="checklist-header">
                <span>LISTA DE COMPROBACIÓN</span>
                <span>${doneChecks}/${totalChecks} (${pct}%)</span>
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
                      placeholder="Elemento..."
                    />
                    <button class="icon-btn danger" data-del-idx="${idx}" title="Quitar ítem">✕</button>
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
                  placeholder="+ Añadir tarea y presionar Enter..."
                />
                <button class="btn-small" id="btn-add-check">Añadir</button>
              </div>
            </div>
          `
              : ""
          }
        </div>

        <div class="note-footer" data-tauri-drag-region>
          <span id="footer-status">${syncStatusText}</span>
          <span>${note.always_on_top ? "📌 Fijada" : "StickyNotes"}</span>
        </div>
      </div>
    `;

    bindNoteEvents();
  }

  function bindNoteEvents() {
    if (!note) return;

    const topbar = document.querySelector(".note-topbar");
    topbar?.addEventListener("mousedown", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest("button")) return;
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

    document.getElementById("btn-palette")?.addEventListener("click", () => {
      showPalette = !showPalette;
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
  }

  renderNote();
}

/* =========================================================================
   MODO 2: PANEL DE NOTAS Y CUENTA DE GOOGLE DRIVE (SIN DATOS SENSIBLES)
   ========================================================================= */
async function initManagerWindow() {
  let notes: StickyNote[] = [];
  let cloudStatus: CloudAccountStatus = await invoke("get_cloud_status");
  let searchQuery = "";
  let statusBanner = "";

  async function refreshData() {
    notes = await invoke<StickyNote[]>("list_notes");
    cloudStatus = await invoke<CloudAccountStatus>("get_cloud_status");
    renderManager();
  }

  await listen("notes-updated", refreshData);
  await listen("notes-synced", refreshData);

  function renderManager() {
    const activeNotes = notes.filter((n) => !n.deleted);
    const filtered = activeNotes.filter((n) => {
      const q = searchQuery.toLowerCase();
      if (!q) return true;
      const inTitle = n.title.toLowerCase().includes(q);
      const inContent = n.content.toLowerCase().includes(q);
      const inCheck = n.checklist.some((c) => c.text.toLowerCase().includes(q));
      return inTitle || inContent || inCheck;
    });

    const lastSyncFormatted = cloudStatus.last_sync
      ? new Date(cloudStatus.last_sync * 1000).toLocaleString()
      : "Pendiente de sincronizar";

    appEl.innerHTML = `
      <div class="manager-window">
        <div class="manager-header">
          <div class="manager-brand">
            <div>
              <h1>📌 StickyNotes</h1>
              <span>Tus notas rápidas y listas de comprobación en todos tus dispositivos</span>
            </div>
          </div>
          <div class="manager-actions">
            <button class="btn-secondary" id="mgr-open-all">🪟 Mostrar Todas las Ventanas</button>
            <button class="btn-primary" id="mgr-new-note">➕ Nueva Nota</button>
          </div>
        </div>

        <div class="manager-content">
          <!-- Tarjeta limpia de Cuenta de Google Drive para el usuario final -->
          <div class="sync-panel">
            <div class="sync-panel-header">
              <div>
                <h2>☁️ Respaldo y Sincronización en Google Drive</h2>
                <p style="font-size:0.84rem; color:#9aa0a6; margin-top:4px;">
                  ${
                    cloudStatus.connected
                      ? `🟢 Conectado como <strong style="color:#fff;">${escapeHtml(
                          cloudStatus.user_email || "Cuenta de Google"
                        )}</strong> • Última sincronización: ${lastSyncFormatted}`
                      : "Inicia sesión con Google para respaldar tus notas en la nube y recuperarlas en Linux, Android o iOS."
                  }
                </p>
              </div>

              <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                ${
                  cloudStatus.connected
                    ? `
                      <label style="display:flex; align-items:center; gap:6px; font-size:0.82rem; color:#ced4da; cursor:pointer;">
                        <input type="checkbox" id="chk-auto-sync" ${
                          cloudStatus.auto_sync ? "checked" : ""
                        } />
                        Sincronización automática
                      </label>
                      <button class="btn-primary" id="btn-sync-now">
                        🔄 Sincronizar ahora
                      </button>
                      <button class="btn-secondary" id="btn-logout">
                        Cerrar sesión
                      </button>
                    `
                    : `
                      <button class="btn-primary" id="btn-oauth-login">
                        🌐 Iniciar sesión con Google
                      </button>
                    `
                }
              </div>
            </div>

            ${
              statusBanner
                ? `<div class="sync-status-msg">${escapeHtml(statusBanner)}</div>`
                : ""
            }
          </div>

          <!-- Buscador de Notas -->
          <div class="search-bar">
            <input
              type="text"
              id="mgr-search"
              class="search-input"
              placeholder="🔍 Buscar en títulos, notas o listas de comprobación..."
              value="${escapeHtml(searchQuery)}"
            />
          </div>

          <!-- Cuadrícula de todas las notas -->
          <div class="notes-grid">
            ${
              filtered.length === 0
                ? `<div style="color:#9aa0a6; padding:20px;">No hay notas que coincidan. ¡Pulsa "Nueva Nota" para crear una!</div>`
                : filtered
                    .map((n) => {
                      const done = n.checklist.filter((c) => c.checked).length;
                      const total = n.checklist.length;
                      return `
                      <div class="note-card theme-${n.color}">
                        <div>
                          <div class="note-card-header">
                            <div class="note-card-title">${escapeHtml(n.title || "Nota sin título")}</div>
                            <span class="badge-status">${n.is_open ? "🪟 Abierta" : "Cerrada"}</span>
                          </div>
                          <div class="note-card-preview">${escapeHtml(
                            n.content || (total > 0 ? `${done}/${total} tareas completadas` : "Sin contenido...")
                          )}</div>
                        </div>
                        <div class="note-card-footer">
                          <span>${total > 0 ? `☑️ ${done}/${total}` : "📝 Nota"}</span>
                          <div style="display:flex; gap:6px;">
                            <button class="btn-small" data-open-id="${n.id}">
                              ${n.is_open ? "Enfocar" : "Abrir Ventana"}
                            </button>
                            <button class="icon-btn danger" data-mgr-del-id="${n.id}" title="Eliminar">🗑️</button>
                          </div>
                        </div>
                      </div>
                    `;
                    })
                    .join("")
            }
          </div>
        </div>
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

    document.getElementById("btn-oauth-login")?.addEventListener("click", async () => {
      statusBanner = "Abriendo navegador para iniciar sesión con tu cuenta de Google...";
      renderManager();
      try {
        const msg = await invoke<string>("start_google_oauth");
        statusBanner = `${msg} • Sincronizando tus notas...`;
        renderManager();
        const res = await invoke<SyncResult>("sync_google_drive");
        statusBanner = `✅ ${msg} • ${res.status} (${res.merged_count} notas respaldadas)`;
      } catch (err) {
        statusBanner = `Aviso: ${String(err)}`;
      }
      await refreshData();
    });

    document.getElementById("btn-sync-now")?.addEventListener("click", async () => {
      statusBanner = "Sincronizando con Google Drive...";
      renderManager();
      try {
        const res = await invoke<SyncResult>("sync_google_drive");
        statusBanner = `✅ ${res.status} (${res.merged_count} notas activas)`;
      } catch (err) {
        statusBanner = `Aviso de sincronización: ${String(err)}`;
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
      statusBanner = "Sesión de Google cerrada en este dispositivo.";
      await refreshData();
    });

    document.querySelectorAll("[data-open-id]").forEach((el) => {
      el.addEventListener("click", async () => {
        const id = (el as HTMLElement).dataset.openId!;
        await invoke("open_note_window", { id });
        await refreshData();
      });
    });

    document.querySelectorAll("[data-mgr-del-id]").forEach((el) => {
      el.addEventListener("click", async () => {
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
