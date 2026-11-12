export type NoteColor =
  | "yellow"
  | "mint"
  | "pink"
  | "sky"
  | "lavender"
  | "dark";

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface StickyNote {
  id: string;
  title: string;
  content: string;
  checklist: ChecklistItem[];
  show_checklist: boolean;
  color: NoteColor;
  is_open: boolean;
  always_on_top: boolean;
  width: number;
  height: number;
  x: number | null;
  y: number | null;
  updated_at: number;
  deleted: boolean;
}

/**
 * Estado público de la cuenta que se envía a la interfaz.
 * Ningún dato sensible (client_id, client_secret, tokens) sale del backend en Rust.
 */
export interface CloudAccountStatus {
  connected: boolean;
  user_email: string | null;
  last_sync: number | null;
  auto_sync: boolean;
}

export interface SyncResult {
  status: string;
  merged_count: number;
  last_sync: number;
}
