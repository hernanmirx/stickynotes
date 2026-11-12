use std::fs;
use std::path::Path;

fn main() {
    // Lee las credenciales desde `../.env` en tiempo de compilación para incrustarlas
    // en el binario sin exponerlas en el repositorio Git ni al usuario final.
    let env_path = Path::new("../.env");
    println!("cargo:rerun-if-changed=../.env");

    if let Ok(contents) = fs::read_to_string(env_path) {
        for line in contents.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            if let Some((key, val)) = trimmed.split_once('=') {
                println!("cargo:rustc-env={}={}", key.trim(), val.trim());
            }
        }
    }

    tauri_build::build()
}
