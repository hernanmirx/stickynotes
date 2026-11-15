<?php
/**
 * API RESTful en PHP para StickyNotes (Linux, Android, iOS)
 * Utiliza consultas SQL directas con mysqli (sin PDO), ideal para cualquier Hosting Compartido.
 *
 * Endpoints:
 *   - POST api.php?action=register  { "email": "...", "password": "..." }
 *   - POST api.php?action=login     { "email": "...", "password": "..." }
 *   - POST api.php?action=sync      { "token": "...", "notes": [...] }
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/config.php';

function send_json(int $status, array $payload): void {
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

$action = $_GET['action'] ?? '';
$rawBody = file_get_contents('php://input');
$body = json_decode($rawBody ?: '{}', true);
if (!is_array($body)) {
    $body = [];
}

/**
 * Extrae el token de sesión tanto del JSON body como de la cabecera Authorization.
 */
function get_request_token(array $body): string {
    if (!empty($body['token']) && is_string($body['token'])) {
        return trim($body['token']);
    }
    $authHeader = $_SERVER['HTTP_AUTHORIZATION']
        ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
        ?? '';
    if (stripos($authHeader, 'Bearer ') === 0) {
        return trim(substr($authHeader, 7));
    }
    return '';
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
// 3. SINCRONIZACIÓN BIDIRECCIONAL DE NOTAS EN MYSQL (?action=sync)
// ============================================================================
if ($action === 'sync') {
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
            $serverMap[$row['id']] = [
                'id'             => (string)$row['id'],
                'title'          => (string)$row['title'],
                'content'        => (string)$row['content'],
                'checklist'      => $checklist,
                'show_checklist' => ((int)$row['show_checklist']) === 1,
                'color'          => (string)$row['color'],
                'is_open'        => ((int)$row['is_open']) === 1,
                'always_on_top'  => ((int)$row['always_on_top']) === 1,
                'width'          => (float)$row['width'],
                'height'         => (float)$row['height'],
                'x'              => $row['pos_x'] !== null ? (float)$row['pos_x'] : null,
                'y'              => $row['pos_y'] !== null ? (float)$row['pos_y'] : null,
                'updated_at'     => (int)$row['updated_at'],
                'deleted'        => ((int)$row['deleted']) === 1,
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
                'id'             => $noteId,
                'title'          => (string)($cn['title'] ?? ''),
                'content'        => (string)($cn['content'] ?? ''),
                'checklist'      => is_array($cn['checklist'] ?? null) ? $cn['checklist'] : [],
                'show_checklist' => !empty($cn['show_checklist']),
                'color'          => (string)($cn['color'] ?? 'yellow'),
                'is_open'        => !empty($cn['is_open']),
                'always_on_top'  => !empty($cn['always_on_top']),
                'width'          => (float)($cn['width'] ?? 320),
                'height'         => (float)($cn['height'] ?? 340),
                'x'              => isset($cn['x']) && $cn['x'] !== null ? (float)$cn['x'] : null,
                'y'              => isset($cn['y']) && $cn['y'] !== null ? (float)$cn['y'] : null,
                'updated_at'     => $clientUpdated,
                'deleted'        => !empty($cn['deleted']),
            ];

            $idEsc        = mysqli_real_escape_string($conn, $normalized['id']);
            $titleEsc     = mysqli_real_escape_string($conn, $normalized['title']);
            $contentEsc   = mysqli_real_escape_string($conn, $normalized['content']);
            $checklistStr = json_encode($normalized['checklist'], JSON_UNESCAPED_UNICODE);
            $checklistEsc = mysqli_real_escape_string($conn, $checklistStr ?: '[]');
            $colorEsc     = mysqli_real_escape_string($conn, $normalized['color']);

            $showCheckInt = $normalized['show_checklist'] ? 1 : 0;
            $isOpenInt    = $normalized['is_open'] ? 1 : 0;
            $alwaysTopInt = $normalized['always_on_top'] ? 1 : 0;
            $widthVal     = (float)$normalized['width'];
            $heightVal    = (float)$normalized['height'];
            $posXSql      = $normalized['x'] !== null ? (string)((float)$normalized['x']) : 'NULL';
            $posYSql      = $normalized['y'] !== null ? (string)((float)$normalized['y']) : 'NULL';
            $updatedVal   = (int)$normalized['updated_at'];
            $deletedInt   = $normalized['deleted'] ? 1 : 0;

            $sqlUpsert = "
                INSERT INTO notes (
                    id, user_id, title, content, checklist_json, show_checklist,
                    color, is_open, always_on_top, width, height, pos_x, pos_y,
                    updated_at, deleted
                ) VALUES (
                    '$idEsc', $userId, '$titleEsc', '$contentEsc', '$checklistEsc', $showCheckInt,
                    '$colorEsc', $isOpenInt, $alwaysTopInt, $widthVal, $heightVal, $posXSql, $posYSql,
                    $updatedVal, $deletedInt
                )
                ON DUPLICATE KEY UPDATE
                    title          = '$titleEsc',
                    content        = '$contentEsc',
                    checklist_json = '$checklistEsc',
                    show_checklist = $showCheckInt,
                    color          = '$colorEsc',
                    is_open        = $isOpenInt,
                    always_on_top  = $alwaysTopInt,
                    width          = $widthVal,
                    height         = $heightVal,
                    pos_x          = $posXSql,
                    pos_y          = $posYSql,
                    updated_at     = $updatedVal,
                    deleted        = $deletedInt
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
send_json(400, ['error' => 'Acción no válida. Usa ?action=login, ?action=register o ?action=sync']);
