<?php
/**
 * API RESTful en PHP para StickyNotes (Linux, Android, iOS)
 * Utiliza consultas SQL directas con mysqli (sin PDO), ideal para cualquier Hosting Compartido.
 *
 * Endpoints:
 *   - POST api.php?action=register            { "email": "...", "password": "..." }
 *   - POST api.php?action=login               { "email": "...", "password": "..." }
 *   - POST api.php?action=sync                { "token": "...", "notes": [...] }
 *   - POST api.php?action=upload_attachment   (multipart/form-data o JSON con data_base64)
 *   - GET  api.php?action=download_attachment&id=...&token=...
 *   - POST api.php?action=delete_attachment   { "token": "...", "id": "..." }
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/config.php';

function send_json(int $status, array $payload): void {
    header('Content-Type: application/json; charset=utf-8');
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

$conn = get_db_connection();
if (!$conn) {
    send_json(500, [
        'error' => 'No se pudo conectar a la base de datos MySQL. Verifica los datos en config.php.',
    ]);
}

/**
 * Asegura la migración automática de esquema (columna attachments_json y tabla attachments)
 * para instalaciones previas sin requerir intervención manual en phpMyAdmin.
 */
function ensure_schema_migrations(mysqli $conn): void {
    $resCol = mysqli_query($conn, "SHOW COLUMNS FROM `notes` LIKE 'attachments_json'");
    if ($resCol && mysqli_num_rows($resCol) === 0) {
        mysqli_query(
            $conn,
            "ALTER TABLE `notes` ADD COLUMN `attachments_json` MEDIUMTEXT DEFAULT NULL AFTER `checklist_json`"
        );
    }

    $resRemAt = mysqli_query($conn, "SHOW COLUMNS FROM `notes` LIKE 'reminder_at'");
    if ($resRemAt && mysqli_num_rows($resRemAt) === 0) {
        mysqli_query(
            $conn,
            "ALTER TABLE `notes` ADD COLUMN `reminder_at` BIGINT UNSIGNED DEFAULT NULL AFTER `pos_y`"
        );
    }

    $resRemNotif = mysqli_query($conn, "SHOW COLUMNS FROM `notes` LIKE 'reminder_notified'");
    if ($resRemNotif && mysqli_num_rows($resRemNotif) === 0) {
        mysqli_query(
            $conn,
            "ALTER TABLE `notes` ADD COLUMN `reminder_notified` TINYINT(1) NOT NULL DEFAULT 0 AFTER `reminder_at`"
        );
    }

    $sqlCreateAtt = "
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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ";
    mysqli_query($conn, $sqlCreateAtt);
}

ensure_schema_migrations($conn);

$action = $_GET['action'] ?? '';
$rawBody = file_get_contents('php://input');
$body = json_decode($rawBody ?: '{}', true);
if (!is_array($body)) {
    $body = [];
}

/**
 * Extrae el token de sesión del JSON body, POST form, GET query o cabecera Authorization.
 */
function get_request_token(array $body): string {
    if (!empty($body['token']) && is_string($body['token'])) {
        return trim($body['token']);
    }
    if (!empty($_POST['token']) && is_string($_POST['token'])) {
        return trim($_POST['token']);
    }
    if (!empty($_GET['token']) && is_string($_GET['token'])) {
        return trim($_GET['token']);
    }
    $authHeader = $_SERVER['HTTP_AUTHORIZATION']
        ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
        ?? '';
    if (stripos($authHeader, 'Bearer ') === 0) {
        return trim(substr($authHeader, 7));
    }
    return '';
}

/**
 * Autentica al usuario a partir del token de la petición.
 */
function require_authenticated_user(mysqli $conn, array $body): array {
    $token = get_request_token($body);
    if ($token === '') {
        send_json(401, ['error' => 'Sesión no autorizada. Inicia sesión nuevamente.']);
    }
    $tokenEsc = mysqli_real_escape_string($conn, $token);
    $sqlAuth = "SELECT id, email FROM users WHERE api_token = '$tokenEsc' LIMIT 1";
    $resAuth = mysqli_query($conn, $sqlAuth);
    $user = $resAuth ? mysqli_fetch_assoc($resAuth) : null;
    if (!$user) {
        send_json(401, ['error' => 'Tu sesión expiró o no es válida. Inicia sesión nuevamente.']);
    }
    return $user;
}

/**
 * Prepara el directorio de almacenamiento seguro para archivos adjuntos del usuario.
 */
function get_user_uploads_dir(int $userId): string {
    $baseDir = __DIR__ . '/uploads';
    if (!is_dir($baseDir)) {
        @mkdir($baseDir, 0755, true);
    }
    $htaccess = $baseDir . '/.htaccess';
    if (!file_exists($htaccess)) {
        @file_put_contents($htaccess, "Options -Indexes\nDeny from all\n");
    }
    $userDir = $baseDir . '/u_' . $userId;
    if (!is_dir($userDir)) {
        @mkdir($userDir, 0755, true);
    }
    return $userDir;
}

// ============================================================================
// 1. REGISTRO DE NUEVO USUARIO (?action=register)
// ============================================================================
if ($action === 'register') {
    $email = strtolower(trim((string)($body['email'] ?? '')));
    $password = (string)($body['password'] ?? '');

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        send_json(400, ['error' => 'Por favor ingresa un correo electrónico válido.']);
    }
    if (strlen($password) < 6) {
        send_json(400, ['error' => 'La contraseña debe tener al menos 6 caracteres.']);
    }

    $emailEsc = mysqli_real_escape_string($conn, $email);
    $sqlCheck = "SELECT id FROM users WHERE email = '$emailEsc' LIMIT 1";
    $resCheck = mysqli_query($conn, $sqlCheck);

    if ($resCheck && mysqli_num_rows($resCheck) > 0) {
        send_json(409, ['error' => 'Este correo ya está registrado. Inicia sesión con tu contraseña.']);
    }

    $passwordHash = password_hash($password, PASSWORD_DEFAULT);
    $token = bin2hex(random_bytes(32));

    $hashEsc  = mysqli_real_escape_string($conn, $passwordHash);
    $tokenEsc = mysqli_real_escape_string($conn, $token);

    $sqlInsert = "INSERT INTO users (email, password_hash, api_token) VALUES ('$emailEsc', '$hashEsc', '$tokenEsc')";
    if (!mysqli_query($conn, $sqlInsert)) {
        send_json(500, ['error' => 'Error al registrar el usuario en MySQL: ' . mysqli_error($conn)]);
    }

    send_json(200, [
        'token'   => $token,
        'email'   => $email,
        'message' => 'Cuenta creada e iniciada correctamente.',
    ]);
}

// ============================================================================
// 2. INICIO DE SESIÓN (?action=login)
// ============================================================================
if ($action === 'login') {
    $email = strtolower(trim((string)($body['email'] ?? '')));
    $password = (string)($body['password'] ?? '');

    if ($email === '' || $password === '') {
        send_json(400, ['error' => 'Ingresa tu correo y contraseña.']);
    }

    $emailEsc = mysqli_real_escape_string($conn, $email);
    $sqlUser = "SELECT id, email, password_hash, api_token FROM users WHERE email = '$emailEsc' LIMIT 1";
    $resUser = mysqli_query($conn, $sqlUser);
    $user = $resUser ? mysqli_fetch_assoc($resUser) : null;

    if (!$user || !password_verify($password, $user['password_hash'])) {
        send_json(401, ['error' => 'Correo o contraseña incorrectos.']);
    }

    $token = $user['api_token'];
    if (empty($token)) {
        $token = bin2hex(random_bytes(32));
        $tokenEsc = mysqli_real_escape_string($conn, $token);
        $userId = (int)$user['id'];
        $sqlUpdateToken = "UPDATE users SET api_token = '$tokenEsc' WHERE id = $userId";
        mysqli_query($conn, $sqlUpdateToken);
    }

    send_json(200, [
        'token'   => $token,
        'email'   => $user['email'],
        'message' => 'Sesión iniciada correctamente.',
    ]);
}

// ============================================================================
// 3. SUBIR ARCHIVO ADJUNTO (?action=upload_attachment)
// ============================================================================
if ($action === 'upload_attachment') {
    $user = require_authenticated_user($conn, $body);
    $userId = (int)$user['id'];

    $attId = trim((string)($_POST['id'] ?? $body['id'] ?? ''));
    $noteId = trim((string)($_POST['note_id'] ?? $body['note_id'] ?? ''));
    $fileName = trim((string)($_POST['file_name'] ?? $body['file_name'] ?? ''));
    $mimeType = trim((string)($_POST['mime_type'] ?? $body['mime_type'] ?? 'application/octet-stream'));
    $createdAt = (int)($_POST['created_at'] ?? $body['created_at'] ?? time());

    if ($attId === '' || $noteId === '') {
        send_json(400, ['error' => 'Faltan parámetros requeridos (id, note_id) para el adjunto.']);
    }

    // Sanitizar ID para uso seguro en disco
    $safeAttId = preg_replace('/[^a-zA-Z0-9_-]/', '', $attId);
    if ($safeAttId === '') {
        send_json(400, ['error' => 'Identificador de adjunto inválido.']);
    }

    $userDir = get_user_uploads_dir($userId);
    $relativeStoragePath = 'u_' . $userId . '/' . $safeAttId . '.bin';
    $destPath = __DIR__ . '/uploads/' . $relativeStoragePath;

    $fileSize = 0;

    if (isset($_FILES['file']) && is_array($_FILES['file'])) {
        $err = (int)($_FILES['file']['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($err !== UPLOAD_ERR_OK) {
            send_json(400, ['error' => 'Error al recibir el archivo subido (código ' . $err . ').']);
        }
        $tmpName = $_FILES['file']['tmp_name'];
        if ($fileName === '') {
            $fileName = basename((string)($_FILES['file']['name'] ?? 'archivo'));
        }
        if ($mimeType === '' || $mimeType === 'application/octet-stream') {
            $detected = @mime_content_type($tmpName);
            if (is_string($detected) && $detected !== '') {
                $mimeType = $detected;
            }
        }
        if (!@move_uploaded_file($tmpName, $destPath)) {
            if (!@copy($tmpName, $destPath)) {
                send_json(500, ['error' => 'No se pudo guardar el archivo adjunto en el servidor.']);
            }
        }
        $fileSize = (int)@filesize($destPath);
    } elseif (!empty($body['data_base64']) && is_string($body['data_base64'])) {
        $rawBytes = base64_decode($body['data_base64'], true);
        if ($rawBytes === false) {
            send_json(400, ['error' => 'El contenido base64 del archivo adjunto no es válido.']);
        }
        if (@file_put_contents($destPath, $rawBytes) === false) {
            send_json(500, ['error' => 'No se pudo escribir el archivo adjunto en el disco del servidor.']);
        }
        $fileSize = strlen($rawBytes);
    } else {
        // Si ya existe en el servidor, responder éxito idempotente
        $idEsc = mysqli_real_escape_string($conn, $attId);
        $sqlExisting = "SELECT id, size FROM attachments WHERE id = '$idEsc' AND user_id = $userId LIMIT 1";
        $resExisting = mysqli_query($conn, $sqlExisting);
        if ($resExisting && ($rowEx = mysqli_fetch_assoc($resExisting))) {
            send_json(200, [
                'id'      => $attId,
                'size'    => (int)$rowEx['size'],
                'message' => 'El adjunto ya estaba registrado en el servidor.',
            ]);
        }
        send_json(400, ['error' => 'No se envió ningún archivo adjunto.']);
    }

    if ($fileName === '') {
        $fileName = 'adjunto_' . $safeAttId;
    }

    $idEsc      = mysqli_real_escape_string($conn, $attId);
    $noteIdEsc  = mysqli_real_escape_string($conn, $noteId);
    $nameEsc    = mysqli_real_escape_string($conn, $fileName);
    $mimeEsc    = mysqli_real_escape_string($conn, $mimeType);
    $pathEsc    = mysqli_real_escape_string($conn, $relativeStoragePath);

    $sqlUpsertAtt = "
        INSERT INTO attachments (
            id, user_id, note_id, file_name, mime_type, size, storage_path, created_at
        ) VALUES (
            '$idEsc', $userId, '$noteIdEsc', '$nameEsc', '$mimeEsc', $fileSize, '$pathEsc', $createdAt
        )
        ON DUPLICATE KEY UPDATE
            note_id      = '$noteIdEsc',
            file_name    = '$nameEsc',
            mime_type    = '$mimeEsc',
            size         = $fileSize,
            storage_path = '$pathEsc'
    ";

    if (!mysqli_query($conn, $sqlUpsertAtt)) {
        send_json(500, ['error' => 'Error al registrar el archivo adjunto en MySQL: ' . mysqli_error($conn)]);
    }

    mysqli_close($conn);
    send_json(200, [
        'id'        => $attId,
        'note_id'   => $noteId,
        'file_name' => $fileName,
        'mime_type' => $mimeType,
        'size'      => $fileSize,
        'message'   => 'Archivo adjunto subido correctamente.',
    ]);
}

// ============================================================================
// 4. DESCARGAR ARCHIVO ADJUNTO (?action=download_attachment&id=...)
// ============================================================================
if ($action === 'download_attachment') {
    $user = require_authenticated_user($conn, $body);
    $userId = (int)$user['id'];

    $attId = trim((string)($_GET['id'] ?? $body['id'] ?? ''));
    if ($attId === '') {
        send_json(400, ['error' => 'Falta el parámetro id del adjunto.']);
    }

    $idEsc = mysqli_real_escape_string($conn, $attId);
    $sqlAtt = "SELECT * FROM attachments WHERE id = '$idEsc' AND user_id = $userId LIMIT 1";
    $resAtt = mysqli_query($conn, $sqlAtt);
    $att = $resAtt ? mysqli_fetch_assoc($resAtt) : null;

    if (!$att) {
        send_json(404, ['error' => 'Archivo adjunto no encontrado en el servidor.']);
    }

    $fullPath = __DIR__ . '/uploads/' . $att['storage_path'];
    if (!is_file($fullPath)) {
        send_json(404, ['error' => 'El archivo físico del adjunto no existe en el servidor.']);
    }

    mysqli_close($conn);

    $mimeType = !empty($att['mime_type']) ? $att['mime_type'] : 'application/octet-stream';
    $fileName = str_replace(['"', "\r", "\n"], '', (string)$att['file_name']);
    $fileSize = (int)filesize($fullPath);

    header('Content-Type: ' . $mimeType);
    header('Content-Length: ' . $fileSize);
    header('Content-Disposition: inline; filename="' . $fileName . '"');
    readfile($fullPath);
    exit;
}

// ============================================================================
// 5. ELIMINAR ARCHIVO ADJUNTO (?action=delete_attachment)
// ============================================================================
if ($action === 'delete_attachment') {
    $user = require_authenticated_user($conn, $body);
    $userId = (int)$user['id'];

    $attId = trim((string)($body['id'] ?? $_POST['id'] ?? $_GET['id'] ?? ''));
    if ($attId === '') {
        send_json(400, ['error' => 'Falta el parámetro id del adjunto.']);
    }

    $idEsc = mysqli_real_escape_string($conn, $attId);
    $sqlAtt = "SELECT storage_path FROM attachments WHERE id = '$idEsc' AND user_id = $userId LIMIT 1";
    $resAtt = mysqli_query($conn, $sqlAtt);
    if ($resAtt && ($att = mysqli_fetch_assoc($resAtt))) {
        $fullPath = __DIR__ . '/uploads/' . $att['storage_path'];
        if (is_file($fullPath)) {
            @unlink($fullPath);
        }
    }

    mysqli_query($conn, "DELETE FROM attachments WHERE id = '$idEsc' AND user_id = $userId");
    mysqli_close($conn);

    send_json(200, [
        'id'      => $attId,
        'message' => 'Adjunto eliminado del servidor.',
    ]);
}

// ============================================================================
// 6. SINCRONIZACIÓN BIDIRECCIONAL DE NOTAS EN MYSQL (?action=sync)
// ============================================================================
if ($action === 'sync') {
    $user = require_authenticated_user($conn, $body);
    $userId = (int)$user['id'];
    $clientNotes = is_array($body['notes'] ?? null) ? $body['notes'] : [];

    // 1. Obtener todas las notas actuales del usuario en MySQL
    $sqlNotes = "SELECT * FROM notes WHERE user_id = $userId";
    $resNotes = mysqli_query($conn, $sqlNotes);

    $serverMap = [];
    if ($resNotes) {
        while ($row = mysqli_fetch_assoc($resNotes)) {
            $checklist = json_decode($row['checklist_json'] ?? '[]', true);
            if (!is_array($checklist)) {
                $checklist = [];
            }
            $attachments = json_decode($row['attachments_json'] ?? '[]', true);
            if (!is_array($attachments)) {
                $attachments = [];
            }
            $serverMap[$row['id']] = [
                'id'                => (string)$row['id'],
                'title'             => (string)$row['title'],
                'content'           => (string)$row['content'],
                'checklist'         => $checklist,
                'attachments'       => $attachments,
                'show_checklist'    => ((int)$row['show_checklist']) === 1,
                'color'             => (string)$row['color'],
                'is_open'           => ((int)$row['is_open']) === 1,
                'always_on_top'     => ((int)$row['always_on_top']) === 1,
                'width'             => (float)$row['width'],
                'height'            => (float)$row['height'],
                'x'                 => $row['pos_x'] !== null ? (float)$row['pos_x'] : null,
                'y'                 => $row['pos_y'] !== null ? (float)$row['pos_y'] : null,
                'reminder_at'       => isset($row['reminder_at']) && $row['reminder_at'] !== null ? (int)$row['reminder_at'] : null,
                'reminder_notified' => ((int)($row['reminder_notified'] ?? 0)) === 1,
                'updated_at'        => (int)$row['updated_at'],
                'deleted'           => ((int)$row['deleted']) === 1,
            ];
        }
    }

    // 2. Fusionar notas del cliente con las de MySQL (gana la más reciente por `updated_at`)
    foreach ($clientNotes as $cn) {
        if (!is_array($cn) || empty($cn['id'])) {
            continue;
        }
        $noteId = (string)$cn['id'];
        $clientUpdated = (int)($cn['updated_at'] ?? 0);
        $serverUpdated = isset($serverMap[$noteId]) ? (int)$serverMap[$noteId]['updated_at'] : -1;

        if ($clientUpdated >= $serverUpdated) {
            $normalized = [
                'id'                => $noteId,
                'title'             => (string)($cn['title'] ?? ''),
                'content'           => (string)($cn['content'] ?? ''),
                'checklist'         => is_array($cn['checklist'] ?? null) ? $cn['checklist'] : [],
                'attachments'       => is_array($cn['attachments'] ?? null) ? $cn['attachments'] : [],
                'show_checklist'    => !empty($cn['show_checklist']),
                'color'             => (string)($cn['color'] ?? 'yellow'),
                'is_open'           => !empty($cn['is_open']),
                'always_on_top'     => !empty($cn['always_on_top']),
                'width'             => (float)($cn['width'] ?? 320),
                'height'            => (float)($cn['height'] ?? 340),
                'x'                 => isset($cn['x']) && $cn['x'] !== null ? (float)$cn['x'] : null,
                'y'                 => isset($cn['y']) && $cn['y'] !== null ? (float)$cn['y'] : null,
                'reminder_at'       => isset($cn['reminder_at']) && $cn['reminder_at'] !== null && (int)$cn['reminder_at'] > 0
                    ? (int)$cn['reminder_at']
                    : null,
                'reminder_notified' => !empty($cn['reminder_notified']),
                'updated_at'        => $clientUpdated,
                'deleted'           => !empty($cn['deleted']),
            ];

            $idEsc          = mysqli_real_escape_string($conn, $normalized['id']);
            $titleEsc       = mysqli_real_escape_string($conn, $normalized['title']);
            $contentEsc     = mysqli_real_escape_string($conn, $normalized['content']);
            $checklistStr   = json_encode($normalized['checklist'], JSON_UNESCAPED_UNICODE);
            $checklistEsc   = mysqli_real_escape_string($conn, $checklistStr ?: '[]');
            $attachmentsStr = json_encode($normalized['attachments'], JSON_UNESCAPED_UNICODE);
            $attachmentsEsc = mysqli_real_escape_string($conn, $attachmentsStr ?: '[]');
            $colorEsc       = mysqli_real_escape_string($conn, $normalized['color']);

            $showCheckInt  = $normalized['show_checklist'] ? 1 : 0;
            $isOpenInt     = $normalized['is_open'] ? 1 : 0;
            $alwaysTopInt  = $normalized['always_on_top'] ? 1 : 0;
            $widthVal      = (float)$normalized['width'];
            $heightVal     = (float)$normalized['height'];
            $posXSql       = $normalized['x'] !== null ? (string)((float)$normalized['x']) : 'NULL';
            $posYSql       = $normalized['y'] !== null ? (string)((float)$normalized['y']) : 'NULL';
            $reminderAtSql = $normalized['reminder_at'] !== null ? (string)((int)$normalized['reminder_at']) : 'NULL';
            $remNotifInt   = $normalized['reminder_notified'] ? 1 : 0;
            $updatedVal    = (int)$normalized['updated_at'];
            $deletedInt    = $normalized['deleted'] ? 1 : 0;

            $sqlUpsert = "
                INSERT INTO notes (
                    id, user_id, title, content, checklist_json, attachments_json, show_checklist,
                    color, is_open, always_on_top, width, height, pos_x, pos_y,
                    reminder_at, reminder_notified, updated_at, deleted
                ) VALUES (
                    '$idEsc', $userId, '$titleEsc', '$contentEsc', '$checklistEsc', '$attachmentsEsc', $showCheckInt,
                    '$colorEsc', $isOpenInt, $alwaysTopInt, $widthVal, $heightVal, $posXSql, $posYSql,
                    $reminderAtSql, $remNotifInt, $updatedVal, $deletedInt
                )
                ON DUPLICATE KEY UPDATE
                    title             = '$titleEsc',
                    content           = '$contentEsc',
                    checklist_json    = '$checklistEsc',
                    attachments_json  = '$attachmentsEsc',
                    show_checklist    = $showCheckInt,
                    color             = '$colorEsc',
                    is_open           = $isOpenInt,
                    always_on_top     = $alwaysTopInt,
                    width             = $widthVal,
                    height            = $heightVal,
                    pos_x             = $posXSql,
                    pos_y             = $posYSql,
                    reminder_at       = $reminderAtSql,
                    reminder_notified = $remNotifInt,
                    updated_at        = $updatedVal,
                    deleted           = $deletedInt
            ";

            mysqli_query($conn, $sqlUpsert);
            $serverMap[$noteId] = $normalized;
        }
    }

    $mergedNotes = array_values($serverMap);
    usort($mergedNotes, function ($a, $b) {
        return $b['updated_at'] <=> $a['updated_at'];
    });

    mysqli_close($conn);

    send_json(200, [
        'notes'   => $mergedNotes,
        'message' => 'Sincronizado con el servidor MySQL correctamente.',
    ]);
}

mysqli_close($conn);
send_json(400, [
    'error' => 'Acción no válida. Usa ?action=login, ?action=register, ?action=sync, ?action=upload_attachment, ?action=download_attachment o ?action=delete_attachment',
]);
