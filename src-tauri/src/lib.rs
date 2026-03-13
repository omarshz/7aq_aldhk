mod commands;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::screenshot::capture_screen,
            commands::llm::query_llm,
            commands::llm::query_llm_chat,
        ])
        .setup(|app| {
            // Tray menu
            let quit = MenuItem::with_id(app, "quit", "Quit Dubly", true, None::<&str>)?;
            let center = MenuItem::with_id(app, "center", "Move to Center", true, None::<&str>)?;
            let pause = MenuItem::with_id(app, "pause", "Pause", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&center, &pause, &quit])?;

            TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Dubly")
                .icon_as_template(true)
                .icon(app.default_window_icon().unwrap().clone())
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "center" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.center();
                        }
                    }
                    "pause" => {
                        // Toggle pause handled via frontend event
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("toggle-pause", ());
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
