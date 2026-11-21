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
    thread::spawn(move || {
        // A WebView child can own focus while the top-level Window reports
        // false. Do not use is_focused() as a gate for this first-load cycle.
        thread::sleep(Duration::from_millis(200));
        #[cfg(debug_assertions)]
        eprintln!("[ime-startup] begin native hide/show cycle");
        if let Err(error) = window.hide() {
            eprintln!("[ime-startup] hide failed: {error}");
            return;
        }
        thread::sleep(Duration::from_millis(150));
        if let Err(error) = window.show() {
            eprintln!("[ime-startup] show failed: {error}");
            return;
        }
        thread::sleep(Duration::from_millis(120));
        let focus_result = window.set_focus();
        #[cfg(debug_assertions)]
        eprintln!("[ime-startup] restored and requested focus: {focus_result:?}");
        let _ = focus_result;
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|_window, _event| {
            #[cfg(all(windows, debug_assertions))]
            if let tauri::WindowEvent::Focused(focused) = _event {
                eprintln!("[ime-startup] native focus event: {focused}");
            }
        })
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
