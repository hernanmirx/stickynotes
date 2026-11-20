-- ============================================================================
-- Base de Datos MySQL / MariaDB para StickyNotes (Hosting Compartido)
-- Importa este archivo desde phpMyAdmin en la base de datos de tu hosting.
-- ============================================================================

CREATE TABLE IF NOT EXISTS `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(190) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `api_token` VARCHAR(128) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_api_token` (`api_token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notes` (
  `id` VARCHAR(64) NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `title` VARCHAR(500) NOT NULL DEFAULT '',
  `content` MEDIUMTEXT NOT NULL,
  `checklist_json` MEDIUMTEXT NOT NULL,
  `attachments_json` MEDIUMTEXT DEFAULT NULL,
  `show_checklist` TINYINT(1) NOT NULL DEFAULT 0,
  `color` VARCHAR(32) NOT NULL DEFAULT 'yellow',
  `is_open` TINYINT(1) NOT NULL DEFAULT 1,
  `always_on_top` TINYINT(1) NOT NULL DEFAULT 0,
  `width` DOUBLE NOT NULL DEFAULT 320,
  `height` DOUBLE NOT NULL DEFAULT 340,
  `pos_x` DOUBLE DEFAULT NULL,
  `pos_y` DOUBLE DEFAULT NULL,
  `reminder_at` BIGINT UNSIGNED DEFAULT NULL,
  `reminder_notified` TINYINT(1) NOT NULL DEFAULT 0,
  `updated_at` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `deleted` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`, `user_id`),
  CONSTRAINT `fk_notes_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `attachments` (
  `id` VARCHAR(64) NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `note_id` VARCHAR(64) NOT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(128) NOT NULL DEFAULT 'application/octet-stream',
  `size` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `storage_path` VARCHAR(500) NOT NULL,
  `created_at` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`, `user_id`),
  INDEX `idx_att_note` (`note_id`, `user_id`),
  CONSTRAINT `fk_attachments_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Si ya tenías la tabla `notes` creada anteriormente, ejecuta también:
-- ALTER TABLE `notes` ADD COLUMN `attachments_json` MEDIUMTEXT DEFAULT NULL AFTER `checklist_json`;
-- ALTER TABLE `notes` ADD COLUMN `reminder_at` BIGINT UNSIGNED DEFAULT NULL AFTER `pos_y`;
-- ALTER TABLE `notes` ADD COLUMN `reminder_notified` TINYINT(1) NOT NULL DEFAULT 0 AFTER `reminder_at`;



