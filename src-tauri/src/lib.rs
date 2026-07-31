use std::sync::Mutex;

use tauri::{Emitter, Manager};

/// PDF paths the OS asked us to open before the frontend was ready to
/// receive events (cold launch via Finder / "Open With").
struct PendingFiles(Mutex<Vec<String>>);

#[tauri::command]
fn take_pending_files(state: tauri::State<'_, PendingFiles>) -> Vec<String> {
  std::mem::take(&mut *state.0.lock().unwrap())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .manage(PendingFiles(Mutex::new(Vec::new())))
    .invoke_handler(tauri::generate_handler![take_pending_files])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      // Windows/Linux (and plain CLI launches) deliver the file as argv;
      // macOS Finder opens arrive as RunEvent::Opened below.
      let args: Vec<String> = std::env::args()
        .skip(1)
        .filter(|a| a.to_ascii_lowercase().ends_with(".pdf") && std::path::Path::new(a).exists())
        .collect();
      if !args.is_empty() {
        app.state::<PendingFiles>().0.lock().unwrap().extend(args);
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      #[cfg(any(target_os = "macos", target_os = "ios"))]
      if let tauri::RunEvent::Opened { urls } = event {
        let paths: Vec<String> = urls
          .iter()
          .filter_map(|u| u.to_file_path().ok())
          .map(|p| p.to_string_lossy().into_owned())
          .collect();
        if paths.is_empty() {
          return;
        }
        // Stash for the startup pull and emit for an already-running
        // frontend; the frontend only pulls once, so both paths are safe.
        app
          .state::<PendingFiles>()
          .0
          .lock()
          .unwrap()
          .extend(paths.clone());
        let _ = app.emit("open-files", paths);
      }
    });
}
