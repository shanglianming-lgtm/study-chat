use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use study_chat_core::{Chat, Event, Provider, Secrets};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
#[derive(Default)]
struct TestSecrets(Mutex<HashMap<String, String>>);
impl Secrets for TestSecrets {
    fn get(&self, a: &str) -> Result<Option<String>, String> {
        Ok(self.0.lock().unwrap().get(a).cloned())
    }
    fn set(&self, a: &str, v: &str) -> Result<(), String> {
        self.0.lock().unwrap().insert(a.into(), v.into());
        Ok(())
    }
    fn delete(&self, a: &str) -> Result<(), String> {
        self.0.lock().unwrap().remove(a);
        Ok(())
    }
}
fn provider(endpoint: String) -> Provider {
    Provider {
        name: "Local synthetic test".into(),
        endpoint,
        model: "synthetic-model".into(),
        use_key: false,
    }
}
// A real loopback HTTP server; no external host, production key, or application data.
async fn server(
    status: &'static str,
    parts: Vec<(Vec<u8>, u64)>,
) -> (String, tokio::task::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let mut bytes = [0u8; 4096];
        loop {
            let n = socket.read(&mut bytes).await.unwrap();
            if n == 0 {
                break;
            }
            request.extend_from_slice(&bytes[..n]);
            if let Some(pos) = request.windows(4).position(|v| v == b"\r\n\r\n") {
                let header = String::from_utf8_lossy(&request[..pos]);
                let size: usize = header
                    .lines()
                    .find_map(|l| {
                        l.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .map(|s| s.trim().parse().unwrap())
                    })
                    .unwrap_or(0);
                if request.len() >= pos + 4 + size {
                    break;
                }
            }
        }
        socket.write_all(format!("HTTP/1.1 {status}\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
        for (part, delay) in parts {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            if socket.write_all(&part).await.is_err() {
                break;
            }
        }
        String::from_utf8(request).unwrap()
    });
    (format!("http://127.0.0.1:{port}/v1/chat/completions"), task)
}
#[test]
fn library_prevents_stale_writes_and_reopens_the_same_edition() {
    let directory=tempfile::tempdir().unwrap();
    let path=directory.path().join("register.sqlite");
    let secrets=Arc::new(TestSecrets::default());
    let chat=Chat::open(&path,secrets.clone()).unwrap();
    let value=serde_json::json!({"version":1,"books":[{"id":"one","effort":"xhigh"}]});
    assert!(chat.library_load().unwrap().is_none());
    assert_eq!(chat.library_save(value.clone(),0).unwrap(),1);
    assert!(chat.library_save(serde_json::Value::Null,0).is_err());
    drop(chat);
    let reopened=Chat::open(&path,secrets).unwrap();
    assert_eq!(reopened.library_load().unwrap().unwrap()["value"],value);
}

#[tokio::test]
async fn library_stream_sends_the_book_model_and_only_the_address_bound_key() {
    let directory=tempfile::tempdir().unwrap();
    let chat=Chat::open(&directory.path().join("library.db"),Arc::new(TestSecrets::default())).unwrap();
    let (endpoint,capture)=server("200 OK",vec![(delta("printed"),0),(done(),0)]).await;
    chat.library_secret(&endpoint,Some("local-fixture-key".into()),false).unwrap();
    let different=endpoint.replace("/v1/","/v2/");
    assert!(!chat.library_secret(&different,None,false).unwrap());
    let body=serde_json::json!({"model":"book-model","reasoning_effort":"xhigh","stream":true,"messages":[{"role":"user","content":"fixture"}]});
    let events=Mutex::new(Vec::new());
    assert!(chat.library_http("proof".into(),endpoint,true,Some(body),None,|e|events.lock().unwrap().push(e)).await.unwrap().is_none());
    let wire=capture.await.unwrap();
    assert!(wire.to_lowercase().contains("authorization: bearer local-fixture-key"));
    assert!(wire.contains("\"model\":\"book-model\"") && wire.contains("\"reasoning_effort\":\"xhigh\""));
    assert_eq!(events.lock().unwrap().last().unwrap(),"[DONE]");
}

fn delta(s: &str) -> Vec<u8> {
    format!(
        "data: {}\r\n\r\n",
        serde_json::json!({"choices":[{"delta":{"content":s},"finish_reason":null}]})
    )
    .into_bytes()
}
fn done() -> Vec<u8> {
    b"data: [DONE]\n\n".to_vec()
}

#[tokio::test]
async fn send_stream_reopen_continue_export_and_keep_secrets_out_of_sqlite() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("chat.db");
    let secrets = Arc::new(TestSecrets::default());
    let (endpoint, request) = server(
        "200 OK",
        vec![(delta("你好，"), 0), (delta("书房。"), 30), (done(), 0)],
    )
    .await;
    let chat = Chat::open(&db, secrets.clone()).unwrap();
    let mut p = provider(endpoint);
    p.use_key = true;
    chat.save_provider(p.clone(), Some("SYNTHETIC-TEST-ONLY".into()))
        .unwrap();
    chat.save_draft("synthetic question").unwrap();
    let events = Mutex::new(Vec::new());
    chat.send("first".into(), "synthetic question".into(), |e| {
        events.lock().unwrap().push(e)
    })
    .await
    .unwrap();
    let wire = request.await.unwrap();
    assert!(wire.contains("Bearer SYNTHETIC-TEST-ONLY"));
    assert!(wire.contains("synthetic-model"));
    assert!(
        events
            .lock()
            .unwrap()
            .iter()
            .filter(|e| matches!(e, Event::Delta { .. }))
            .count()
            >= 2
    );
    assert_eq!(chat.snapshot().unwrap().messages[1].content, "你好，书房。");
    chat.save_draft("next draft").unwrap();
    drop(chat);
    let chat = Chat::open(&db, secrets.clone()).unwrap();
    let snapshot = chat.snapshot().unwrap();
    assert_eq!(snapshot.messages.len(), 2);
    assert_eq!(snapshot.draft, "next draft");
    assert!(snapshot.has_key);
    let (endpoint, request) = server("200 OK", vec![(delta("continued"), 0), (done(), 0)]).await;
    chat.save_provider(provider(endpoint), None).unwrap();
    chat.send("second".into(), "continue".into(), |_| {})
        .await
        .unwrap();
    let wire = request.await.unwrap();
    assert!(wire.contains("你好，书房。"));
    assert!(wire.contains("synthetic question"));
    assert!(!wire.contains("SYNTHETIC-TEST-ONLY"));
    let export = dir.path().join("conversation.md");
    chat.export(&export).unwrap();
    let text = std::fs::read_to_string(export).unwrap();
    assert!(text.contains("你好，书房。"));
    assert!(text.contains("continued"));
    assert!(!text.contains("SYNTHETIC-TEST-ONLY"));
    drop(chat);
    for file in std::fs::read_dir(dir.path()).unwrap() {
        let bytes = std::fs::read(file.unwrap().path()).unwrap();
        assert!(!bytes.windows(19).any(|v| v == b"SYNTHETIC-TEST-ONLY"));
    }
}
#[tokio::test]
async fn cancel_keeps_partial_and_next_send_works() {
    let dir = tempfile::tempdir().unwrap();
    let chat = Arc::new(
        Chat::open(
            &dir.path().join("chat.db"),
            Arc::new(TestSecrets::default()),
        )
        .unwrap(),
    );
    let (endpoint, server) = server(
        "200 OK",
        vec![
            (delta("partial"), 0),
            (delta("never needed"), 300),
            (done(), 0),
        ],
    )
    .await;
    chat.save_provider(provider(endpoint), None).unwrap();
    let c = chat.clone();
    chat.send("cancel-me".into(), "cancel test".into(), move |e| {
        if matches!(e, Event::Delta { .. }) {
            c.cancel("cancel-me").unwrap()
        }
    })
    .await
    .unwrap();
    let snapshot = chat.snapshot().unwrap();
    assert_eq!(snapshot.messages[1].status, "cancelled");
    assert_eq!(snapshot.messages[1].content, "partial");
    server.abort();
    let (endpoint, task) = self::server("200 OK", vec![(delta("recovered"), 0), (done(), 0)]).await;
    chat.save_provider(provider(endpoint), None).unwrap();
    chat.send("next".into(), "continue".into(), |_| {})
        .await
        .unwrap();
    task.await.unwrap();
    assert_eq!(
        chat.snapshot().unwrap().messages.last().unwrap().status,
        "complete"
    );
}
#[tokio::test]
async fn disconnect_and_http_failure_keep_messages_and_sanitize_errors() {
    let dir = tempfile::tempdir().unwrap();
    let chat = Chat::open(
        &dir.path().join("chat.db"),
        Arc::new(TestSecrets::default()),
    )
    .unwrap();
    let (endpoint, task) = server("200 OK", vec![(delta("kept"), 0)]).await;
    chat.save_provider(provider(endpoint), None).unwrap();
    chat.send("drop".into(), "hello".into(), |_| {})
        .await
        .unwrap();
    task.await.unwrap();
    let snap = chat.snapshot().unwrap();
    assert_eq!(snap.messages[1].content, "kept");
    assert_eq!(snap.messages[1].status, "failed");
    let (endpoint, task) = server(
        "401 Unauthorized",
        vec![(b"DO-NOT-EXPOSE-BODY".to_vec(), 0)],
    )
    .await;
    chat.save_provider(provider(endpoint), None).unwrap();
    chat.send("auth".into(), "hello".into(), |_| {})
        .await
        .unwrap();
    task.await.unwrap();
    let error = chat
        .snapshot()
        .unwrap()
        .messages
        .last()
        .unwrap()
        .error
        .clone()
        .unwrap();
    assert!(error.contains("认证"));
    assert!(!error.contains("DO-NOT-EXPOSE"));
}
#[tokio::test]
async fn redirect_is_not_followed() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let task = tokio::spawn(async move {
        let (mut s, _) = listener.accept().await.unwrap();
        let mut b = [0; 4096];
        s.read(&mut b).await.unwrap();
        s.write_all(b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/unconfigured\r\nContent-Length: 0\r\n\r\n").await.unwrap();
    });
    let dir = tempfile::tempdir().unwrap();
    let chat = Chat::open(
        &dir.path().join("chat.db"),
        Arc::new(TestSecrets::default()),
    )
    .unwrap();
    chat.save_provider(
        provider(format!("http://127.0.0.1:{port}/chat/completions")),
        None,
    )
    .unwrap();
    chat.send("redirect".into(), "synthetic".into(), |_| {})
        .await
        .unwrap();
    task.await.unwrap();
    assert!(chat.snapshot().unwrap().messages[1]
        .error
        .as_ref()
        .unwrap()
        .contains("重定向"));
}
#[test]
fn startup_recovers_incomplete_checkpoint_and_validates_destinations() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("chat.db");
    drop(Chat::open(&db, Arc::new(TestSecrets::default())).unwrap());
    let conn = rusqlite::Connection::open(&db).unwrap();
    conn.execute("INSERT INTO messages(id,conversation_id,role,content,status) VALUES('interrupted','conversation-1','assistant','saved checkpoint','streaming')",[]).unwrap();
    drop(conn);
    let chat = Chat::open(&db, Arc::new(TestSecrets::default())).unwrap();
    let snap = chat.snapshot().unwrap();
    assert_eq!(snap.messages[0].status, "interrupted");
    assert_eq!(snap.messages[0].content, "saved checkpoint");
    for endpoint in [
        "http://example.com/v1/chat/completions",
        "https://user:secret@example.com/chat/completions",
        "https://example.com/chat/completions?key=secret",
        "https://example.com/v1",
    ] {
        assert!(chat.save_provider(provider(endpoint.into()), None).is_err());
    }
    let mut p = provider("https://example.com/v1/chat/completions".into());
    p.use_key = true;
    assert!(chat.save_provider(p, None).is_err());
}

#[tokio::test]
async fn library_stops_an_oversized_event_stream() {
    let dir = tempfile::tempdir().unwrap();
    let chat = Chat::open(&dir.path().join("library.db"), Arc::new(TestSecrets::default())).unwrap();
    let event = format!("data: {}\n\n", "a".repeat(256 * 1024)).into_bytes();
    let (endpoint, request) = server("200 OK", vec![(event, 0); 20]).await;
    let count = std::sync::atomic::AtomicUsize::new(0);
    let result = chat
        .library_http("large".into(), endpoint, false, Some(serde_json::json!({})), None, |_| {
            count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        })
        .await;
    request.await.unwrap();
    assert_eq!(result.unwrap_err(), "回应流过大，已停止接收。");
    assert!((1..20).contains(&count.into_inner()));
}
