use std::sync::Arc;
use study_chat_core::{Chat, Event, Provider, Snapshot, SystemSecrets};
use tauri::{ipc::Channel, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
fn chat_load(chat: State<'_, Arc<Chat>>) -> Result<Snapshot, String> {
    chat.snapshot()
}
#[tauri::command]
fn chat_configure(
    chat: State<'_, Arc<Chat>>,
    provider: Provider,
    key: Option<String>,
) -> Result<(), String> {
    chat.save_provider(provider, key)
}
#[tauri::command]
fn chat_forget_key(chat: State<'_, Arc<Chat>>) -> Result<(), String> {
    chat.forget_key()
}
#[tauri::command]
fn chat_draft(chat: State<'_, Arc<Chat>>, draft: String) -> Result<(), String> {
    chat.save_draft(&draft)
}
#[tauri::command]
fn chat_cancel(chat: State<'_, Arc<Chat>>, request_id: String) -> Result<(), String> {
    chat.cancel(&request_id)
}
#[tauri::command]
async fn chat_send(
    chat: State<'_, Arc<Chat>>,
    request_id: String,
    question: String,
    on_event: Channel<Event>,
) -> Result<(), String> {
    let chat = chat.inner().clone();
    chat.send(request_id, question, move |event| {
        let _ = on_event.send(event);
    })
    .await
}
#[tauri::command]
async fn chat_export(
    app: tauri::AppHandle,
    chat: State<'_, Arc<Chat>>,
) -> Result<Option<String>, String> {
    let chat = chat.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = app
            .dialog()
            .file()
            .set_file_name("书房对话.md")
            .add_filter("Markdown", &["md"])
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = path.into_path().map_err(|_| "请选择本地文件路径。")?;
        chat.export(&path)?;
        Ok(Some(path.display().to_string()))
    })
    .await
    .map_err(|_| "无法打开导出对话框。".to_string())?
}
#[tauri::command]
fn library_load(chat: State<'_, Arc<Chat>>) -> Result<Option<serde_json::Value>, String> {
    chat.library_load()
}
#[tauri::command]
fn library_save(
    chat: State<'_, Arc<Chat>>,
    value: serde_json::Value,
    revision: u64,
) -> Result<u64, String> {
    chat.library_save(value, revision)
}
#[tauri::command]
fn library_secret(
    chat: State<'_, Arc<Chat>>,
    endpoint: String,
    key: Option<String>,
    remove: bool,
) -> Result<bool, String> {
    chat.library_secret(&endpoint, key, remove)
}
#[tauri::command]
fn library_cancel(chat: State<'_, Arc<Chat>>, id: String) -> Result<(), String> {
    chat.library_cancel(&id)
}
#[tauri::command]
async fn library_http(
    chat: State<'_, Arc<Chat>>,
    id: String,
    endpoint: String,
    use_key: bool,
    payload: Option<serde_json::Value>,
    after: Option<String>,
    on_data: Channel<String>,
) -> Result<Option<serde_json::Value>, String> {
    let chat = chat.inner().clone();
    let result = chat
        .library_http(id, endpoint, use_key, payload, after, |data| {
            let _ = on_data.send(data);
        })
        .await;
    if matches!(result, Ok(None)) {
        on_data
            .send("\u{001e}".into())
            .map_err(|_| "无法投递流式回应。".to_string())?;
    }
    result
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            let chat = Chat::open(
                &directory.join("study-chat.sqlite3"),
                Arc::new(SystemSecrets),
            )
            .map_err(std::io::Error::other)?;
            app.manage(Arc::new(chat));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            library_load,
            library_save,
            library_secret,
            library_http,
            library_cancel,
            chat_load,
            chat_configure,
            chat_forget_key,
            chat_draft,
            chat_send,
            chat_cancel,
            chat_export
        ])
        .run(tauri::generate_context!())
        .expect("could not start Study Chat");
}
