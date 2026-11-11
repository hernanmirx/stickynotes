# 📌 StickyNotes (Rust + Tauri v2) — Linux & Android

Aplicación multiplataforma de **Notas Rápidas (Sticky Notes)** y **Listas de Comprobación (Checklists)** desarrollada en **Rust + Tauri v2 + TypeScript**, diseñada con **Modo de Ventanas Flotantes Independientes** para escritorio Linux, sincronización en la nube con **Google Drive (`appDataFolder`)** y arquitectura lista para compilar en **Android**.

---

## ✨ Características Principales

1. **Modo Ventanas Flotantes en Linux (Opción 2):**
   - Cada nota se abre en su propia ventana flotante sin bordes del sistema (`decorations: false`).
   - Barra superior arrastrable con controles rápidos:
     - `➕`: Crea y abre inmediatamente una nueva ventana flotante de nota.
     - `☑️`: Activa/oculta la **Lista de Comprobación (Checklist)** con barra de progreso y contador.
     - `🎨`: Selector de 6 temas de colores agradables (*Amarillo Clásico, Verde Menta, Rosa Pastel, Azul Cielo, Lavanda y Modo Oscuro*).
     - `📌`: Fija la ventana **Siempre Visible (`Always on Top`)** sobre el resto de tus aplicaciones en Linux.
     - `☁️`: Abre el **Centro de Control y Sincronización con Google Drive**.
   - Persistencia automática de posición `(x, y)` y tamaño `(width, height)` de cada ventana en tu escritorio.

2. **Almacenamiento Local Instantáneo (Local-First):**
   - Todas las notas se guardan automáticamente mientras escribes en `~/.local/share/com.stickynotes.app/notes.json`.

3. **Sincronización con Google Drive (Respaldo y Migración de Linux / Android):**
   - Usa la carpeta segura de aplicación `appDataFolder` de Google Drive API v3.
   - Fusión inteligente sin pérdida basada en marcas de tiempo (`updated_at`) por cada nota.

---

## 🚀 Cómo Ejecutar en Linux

Asegúrate de tener `~/.cargo/bin` en tu `PATH`:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
npm run tauri dev
```

Para generar el ejecutable e instalador nativo de Linux:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
npm run tauri build
```

---

## ☁️ Cómo Configurar la Sincronización con Google Drive

1. Entra en [Google Cloud Console](https://console.cloud.google.com/).
2. Crea un proyecto y habilita la **Google Drive API**.
3. En **Pantalla de consentimiento de OAuth**, agrega el alcance `.../auth/drive.appdata` y añade tu correo como usuario de prueba.
4. En **Credenciales → Crear credenciales → ID de cliente de OAuth**, elige **Aplicación de escritorio (Desktop App)**.
5. Copia el **Client ID** y el **Client Secret**, pégalos en la ventana de **Centro de Control (`☁️`)** de StickyNotes y haz clic en **Conectar con Google Drive (OAuth2)**.

---

## 📱 Cómo Escalar a Android

Dado que el núcleo en Rust (`src-tauri/src/lib.rs`) ya cuenta con el punto de entrada móvil `#[cfg_attr(mobile, tauri::mobile_entry_point)]` y tienes el Android SDK en `~/Android/Sdk`:

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
npx tauri android init
npx tauri android dev
```

# stickynotes
