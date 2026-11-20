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

export interface NoteAttachment {
  id: string;
  file_name: string;
  mime_type: string;
  size: number;
  created_at: number;
  uploaded: boolean;
}

export interface StickyNote {
  id: string;
  title: string;
  content: string;
  checklist: ChecklistItem[];
  attachments: NoteAttachment[];
  show_checklist: boolean;
  color: NoteColor;
  is_open: boolean;
  always_on_top: boolean;
  width: number;
  height: number;
  x: number | null;
  y: number | null;
  reminder_at: number | null;
  reminder_notified: boolean;
  updated_at: number;
  deleted: boolean;
}

/**
 * Estado público de la cuenta en el servidor PHP + MySQL.
 * El token de sesión permanece protegido dentro del backend en Rust.
 */
export interface CloudAccountStatus {
  connected: boolean;
  user_email: string | null;
  api_url: string;
  last_sync: number | null;
  auto_sync: boolean;
}

export interface SyncResult {
  status: string;
  merged_count: number;
  last_sync: number;
}
