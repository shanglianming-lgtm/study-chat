#[cfg(windows)]
fn recover_initial_ime_focus(webview: &tauri::Webview) {
    use std::{
        sync::atomic::{AtomicBool, Ordering},
        thread,
        time::Duration,
    };

    static STARTED: AtomicBool = AtomicBool::new(false);
    if webview.label() != "main" || STARTED.swap(true, Ordering::Relaxed) {
        return;
    }
    let window = webview.window().clone();
    // WebView2 can start with TSF anchored at (0,0). A real native activation
    // cycle after the first page load mirrors the verified Alt+Tab recovery.
    // Do this once, before reading/typing; never on hot reload or later focus.
    if !window.is_focused().unwrap_or(false) || window.hide().is_err() {
        return;
    }
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(150));
        if window.show().is_ok() {
            thread::sleep(Duration::from_millis(80));
            let _ = window.set_focus();
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .on_page_load(|webview, payload| {
            #[cfg(windows)]
            if payload.event() == tauri::webview::PageLoadEvent::Finished {
                recover_initial_ime_focus(webview);
            }
            #[cfg(not(windows))]
            let _ = (webview, payload);
        })
        .run(tauri::generate_context!())
        .expect("could not start Study Chat");
}
