<?php
/**
 * Plantilla de configuración de conexión a MySQL con mysqli para tu Hosting Compartido.
 * Copia este archivo a `config.php` en tu servidor y completa los 4 valores:
 */

define('DB_HOST', 'localhost');
define('DB_NAME', 'tu_base_de_datos');
define('DB_USER', 'tu_usuario_mysql');
define('DB_PASS', 'tu_password_mysql');
define('DB_CHARSET', 'utf8mb4');

function get_db_connection() {
    mysqli_report(MYSQLI_REPORT_OFF);
    $conn = @mysqli_connect(DB_HOST, DB_USER, DB_PASS, DB_NAME);
    if (!$conn) {
        return false;
    }
    
    return $conn;
}
