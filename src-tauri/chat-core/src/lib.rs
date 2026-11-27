mod sse;
mod library;
use futures_util::StreamExt;
use reqwest::{redirect::Policy, Url};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::Write,
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;
use zeroize::Zeroizing;

type Result<T> = std::result::Result<T, String>;
const DB_ERROR: &str = "无法读写本地数据库；请检查磁盘空间和应用目录权限。";
#[cfg(feature = "native-credentials")]
const KEY_ERROR: &str = "无法访问系统凭据库，请解锁凭据库后重试；不会回退到明文保存。";
#[derive(Clone, Serialize, Deserialize, Default, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub name: String,
    pub endpoint: String,
    pub model: String,
    pub use_key: bool,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub role: String,
    pub content: String,
    pub status: String,
    pub error: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub project_id: String,
    pub conversation_id: String,
    pub provider: Option<Provider>,
    pub has_key: bool,
    pub draft: String,
    pub messages: Vec<Message>,
}
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Event {
    Started { user: Message, assistant: Message },
    Delta { id: String, content: String },
    Finished { message: Message },
}

pub trait Secrets: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>>;
    fn set(&self, account: &str, value: &str) -> Result<()>;
    fn delete(&self, account: &str) -> Result<()>;
}
#[cfg(feature = "native-credentials")]
pub struct SystemSecrets;
#[cfg(feature = "native-credentials")]
impl Secrets for SystemSecrets {
    fn get(&self, account: &str) -> Result<Option<String>> {
        match keyring::Entry::new("com.studychat.desktop.provider", account)
            .map_err(|_| KEY_ERROR)?
            .get_password()
        {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(KEY_ERROR.into()),
        }
    }
    fn set(&self, account: &str, value: &str) -> Result<()> {
        keyring::Entry::new("com.studychat.desktop.provider", account)
            .map_err(|_| KEY_ERROR)?
            .set_password(value)
            .map_err(|_| KEY_ERROR.into())
    }
    fn delete(&self, account: &str) -> Result<()> {
        match keyring::Entry::new("com.studychat.desktop.provider", account)
            .map_err(|_| KEY_ERROR)?
            .delete_credential()
        {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(KEY_ERROR.into()),
        }
    }
}
fn account(endpoint: &str) -> String {
    format!("endpoint-{:x}", Sha256::digest(endpoint.as_bytes()))
}
fn validate(provider: &Provider) -> Result<()> {
    let url =
        Url::parse(&provider.endpoint).map_err(|_| "请输入完整的 chat/completions 请求地址。")?;
    let loopback = url.host_str().is_some_and(|h| {
        h == "localhost"
            || h.trim_matches(['[', ']'])
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
    });
    if (url.scheme() != "https" && !(url.scheme() == "http" && loopback))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "地址必须为 HTTPS（本机测试允许 HTTP），且不能包含凭据、查询参数或片段。".into(),
        );
    }
    if !url.path().ends_with("/chat/completions") {
        return Err("请填写完整请求地址，以 /chat/completions 结尾；不会自动添加 /v1。".into());
    }
    if provider.name.trim().is_empty()
        || provider.model.trim().is_empty()
        || provider.name.len() > 200
        || provider.model.len() > 200
        || provider.endpoint.len() > 2048
    {
        return Err("请填写有效的服务商名称和模型 ID。".into());
    }
    Ok(())
}
struct Store {
    conn: Connection,
}
impl Store {
    fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path).map_err(|_| DB_ERROR)?;
        conn.busy_timeout(Duration::from_secs(5))
            .map_err(|_| DB_ERROR)?;
        conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
          CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,title TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),title TEXT NOT NULL,draft TEXT NOT NULL DEFAULT '');
          CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,conversation_id TEXT NOT NULL REFERENCES conversations(id),role TEXT NOT NULL,content TEXT NOT NULL,status TEXT NOT NULL,error TEXT);
          CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),provider TEXT NOT NULL);
          INSERT OR IGNORE INTO projects VALUES('book-1','与自己的漫长对话');
          INSERT OR IGNORE INTO conversations(id,project_id,title) VALUES('conversation-1','book-1','与自己的漫长对话');
          UPDATE messages SET status='interrupted',error='上次运行在回应完成前结束，已保留收到的内容。' WHERE status='streaming';
          CREATE TABLE IF NOT EXISTS library(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,data TEXT NOT NULL);
          PRAGMA user_version=1;").map_err(|_| DB_ERROR)?;
        Ok(Self { conn })
    }
    fn provider(&self) -> Result<Option<Provider>> {
        use rusqlite::OptionalExtension;
        let value: Option<String> = self
            .conn
            .query_row("SELECT provider FROM settings WHERE id=1", [], |r| r.get(0))
            .optional()
            .map_err(|_| DB_ERROR)?;
        value
            .map(|s| serde_json::from_str(&s).map_err(|_| DB_ERROR.into()))
            .transpose()
    }
    fn messages(&self) -> Result<Vec<Message>> {
        let mut query = self.conn.prepare("SELECT id,role,content,status,error FROM messages WHERE conversation_id='conversation-1' ORDER BY seq").map_err(|_| DB_ERROR)?;
        let rows = query
            .query_map([], |r| {
                Ok(Message {
                    id: r.get(0)?,
                    role: r.get(1)?,
                    content: r.get(2)?,
                    status: r.get(3)?,
                    error: r.get(4)?,
                })
            })
            .map_err(|_| DB_ERROR)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|_| DB_ERROR.into())
    }
    fn update(&self, message: &Message) -> Result<()> {
        self.conn
            .execute(
                "UPDATE messages SET content=?1,status=?2,error=?3 WHERE id=?4",
                params![message.content, message.status, message.error, message.id],
            )
            .map_err(|_| DB_ERROR)?;
        Ok(())
    }
}
struct Active {
    id: String,
    cancel: CancellationToken,
}
pub struct Chat {
    store: Mutex<Store>,
    secrets: Arc<dyn Secrets>,
    active: Mutex<Option<Active>>,
    client: reqwest::Client,
    idle_timeout: Duration,
    library_requests: Mutex<std::collections::HashMap<String, CancellationToken>>,
}
struct Release<'a>(&'a Mutex<Option<Active>>);
impl Drop for Release<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.0.lock() {
            *active = None;
        }
    }
}
impl Chat {
    pub fn open(path: &Path, secrets: Arc<dyn Secrets>) -> Result<Self> {
        Ok(Self {
            store: Mutex::new(Store::open(path)?),
            secrets,
            active: Mutex::new(None),
            client: reqwest::Client::builder()
                .redirect(Policy::none())
                .no_proxy()
                .connect_timeout(Duration::from_secs(15))
                .build()
                .map_err(|_| "无法初始化网络客户端。")?,
            idle_timeout: Duration::from_secs(60),
            library_requests: Mutex::new(std::collections::HashMap::new()),
        })
    }
    pub fn snapshot(&self) -> Result<Snapshot> {
        let _active = self.active.lock().map_err(|_| DB_ERROR)?;
        let store = self.store.lock().map_err(|_| DB_ERROR)?;
        let provider = store.provider()?;
        // Loading history must still work when the system keychain is locked.
        let has_key = provider.as_ref().is_some_and(|p| {
            self.secrets
                .get(&account(&p.endpoint))
                .ok()
                .flatten()
                .is_some()
        });
        let draft = store
            .conn
            .query_row(
                "SELECT draft FROM conversations WHERE id='conversation-1'",
                [],
                |r| r.get(0),
            )
            .map_err(|_| DB_ERROR)?;
        Ok(Snapshot {
            project_id: "book-1".into(),
            conversation_id: "conversation-1".into(),
            provider,
            has_key,
            draft,
            messages: store.messages()?,
        })
    }
    pub fn save_provider(&self, provider: Provider, key: Option<String>) -> Result<()> {
        let key = key.map(Zeroizing::new);
        validate(&provider)?;
        let active = self.active.lock().map_err(|_| DB_ERROR)?;
        if active.is_some() {
            return Err("请先停笔，再修改服务商。".into());
        }
        if let Some(key) = key {
            if key.trim().is_empty() || key.contains(['\r', '\n']) {
                return Err("API key 不能为空或包含换行。".into());
            }
            self.secrets.set(&account(&provider.endpoint), &key)?;
        }
        if provider.use_key && self.secrets.get(&account(&provider.endpoint))?.is_none() {
            return Err("该地址还没有保存 API key。更换地址后需要重新设置凭据。".into());
        }
        self.store.lock().map_err(|_| DB_ERROR)?.conn.execute("INSERT INTO settings VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider", [serde_json::to_string(&provider).map_err(|_| DB_ERROR)?]).map_err(|_| DB_ERROR)?;
        Ok(())
    }
    pub fn forget_key(&self) -> Result<()> {
        let active = self.active.lock().map_err(|_| DB_ERROR)?;
        if active.is_some() {
            return Err("请先停笔，再删除凭据。".into());
        }
        if let Some(provider) = self.store.lock().map_err(|_| DB_ERROR)?.provider()? {
            self.secrets.delete(&account(&provider.endpoint))?;
        }
        Ok(())
    }
    pub fn save_draft(&self, draft: &str) -> Result<()> {
        if draft.len() > 256 * 1024 {
            return Err("草稿过长，请分段发送。".into());
        }
        self.store
            .lock()
            .map_err(|_| DB_ERROR)?
            .conn
            .execute(
                "UPDATE conversations SET draft=?1 WHERE id='conversation-1'",
                [draft],
            )
            .map_err(|_| DB_ERROR)?;
        Ok(())
    }
    pub fn cancel(&self, id: &str) -> Result<()> {
        if let Some(active) = self.active.lock().map_err(|_| DB_ERROR)?.as_ref() {
            if active.id == id {
                active.cancel.cancel();
            }
        }
        Ok(())
    }
    pub fn export(&self, path: &Path) -> Result<()> {
        let snapshot = self.snapshot()?;
        let mut text = String::from("# 与自己的漫长对话\n\n");
        for m in snapshot.messages {
            text.push_str(&format!(
                "## {}\n\n{}\n\n",
                if m.role == "user" { "提问" } else { "回应" },
                m.content
            ));
            if m.status != "complete" {
                text.push_str(&format!(
                    "> 状态：{}。{}\n\n",
                    m.status,
                    m.error.unwrap_or_default()
                ));
            }
        }
        if !snapshot.draft.is_empty() {
            text.push_str(&format!("## 未发送草稿\n\n{}\n", snapshot.draft));
        }
        // Temp file in the destination directory + atomic replace. Never truncate on failure.
        let parent = path.parent().ok_or("导出路径无效。")?;
        let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|_| "无法创建导出文件。")?;
        file.write_all(text.as_bytes())
            .and_then(|_| file.as_file().sync_all())
            .map_err(|_| "导出写入失败，原文件未修改。")?;
        file.persist(path)
            .map_err(|_| "无法保存导出文件，原文件未修改。")?;
        Ok(())
    }
    pub async fn send(
        &self,
        request_id: String,
        question: String,
        notify: impl Fn(Event) + Send + Sync,
    ) -> Result<()> {
        if question.trim().is_empty() || question.len() > 256 * 1024 {
            return Err("请填写问题（最多 256 KiB），或将长内容分段发送。".into());
        }
        let cancel = CancellationToken::new();
        let (provider, key, history, user, mut assistant) = {
            let mut active = self.active.lock().map_err(|_| DB_ERROR)?;
            if active.is_some() {
                return Err("已有回应正在生成，请先停笔。".into());
            }
            let mut store = self.store.lock().map_err(|_| DB_ERROR)?;
            let provider = store.provider()?.ok_or("请先配置服务商和模型。")?;
            validate(&provider)?;
            let key = if provider.use_key {
                Some(Zeroizing::new(
                    self.secrets
                        .get(&account(&provider.endpoint))?
                        .ok_or("系统凭据库中未找到 API key，请重新设置。")?,
                ))
            } else {
                None
            };
            let mut history: Vec<Value> = store
                .messages()?
                .into_iter()
                .filter(|m| !m.content.is_empty())
                .map(|m| json!({"role":m.role,"content":m.content}))
                .collect();
            history.push(json!({"role":"user","content":question}));
            let user = Message {
                id: Uuid::new_v4().to_string(),
                role: "user".into(),
                content: question,
                status: "complete".into(),
                error: None,
            };
            let assistant = Message {
                id: Uuid::new_v4().to_string(),
                role: "assistant".into(),
                content: String::new(),
                status: "streaming".into(),
                error: None,
            };
            let tx = store.conn.transaction().map_err(|_| DB_ERROR)?;
            for m in [&user, &assistant] {
                tx.execute("INSERT INTO messages(id,conversation_id,role,content,status) VALUES(?1,'conversation-1',?2,?3,?4)", params![m.id,m.role,m.content,m.status]).map_err(|_| DB_ERROR)?;
            }
            tx.execute(
                "UPDATE conversations SET draft='' WHERE id='conversation-1'",
                [],
            )
            .map_err(|_| DB_ERROR)?;
            tx.commit().map_err(|_| DB_ERROR)?;
            *active = Some(Active {
                id: request_id,
                cancel: cancel.clone(),
            });
            (provider, key, history, user, assistant)
        };
        let _release = Release(&self.active);
        notify(Event::Started {
            user,
            assistant: assistant.clone(),
        });
        let result = tokio::select! {
            biased;
            _ = cancel.cancelled() => Err("已停笔，已收到的内容保留在本地。".into()),
            result = self.receive(&provider,key.as_deref().map(|s| s.as_str()),history,&mut assistant,&notify) => result,
        };
        assistant.status = if cancel.is_cancelled() {
            "cancelled"
        } else if result.is_ok() {
            "complete"
        } else {
            "failed"
        }
        .into();
        assistant.error = result.err();
        self.store
            .lock()
            .map_err(|_| DB_ERROR)?
            .update(&assistant)?;
        notify(Event::Finished { message: assistant });
        Ok(())
    }
    async fn receive(
        &self,
        provider: &Provider,
        key: Option<&str>,
        history: Vec<Value>,
        assistant: &mut Message,
        notify: &(impl Fn(Event) + Send + Sync),
    ) -> Result<()> {
        let mut request = self
            .client
            .post(&provider.endpoint)
            .header("Accept", "text/event-stream")
            .json(&json!({"model":provider.model,"messages":history,"stream":true}));
        if let Some(key) = key {
            request = request.bearer_auth(key);
        }
        let response = tokio::time::timeout(self.idle_timeout, request.send())
            .await
            .map_err(|_| "等待服务商响应超时，可以重试。")?
            .map_err(|_| "无法连接服务商，请检查地址、网络或证书。")?;
        if !response.status().is_success() {
            return Err(match response.status().as_u16() {
                401 | 403 => "服务商拒绝认证，请检查 API key 和权限。",
                404 => "服务商地址不存在，请检查 /v1 和 /chat/completions。",
                429 => "服务商限流或额度不足，请稍后重试。",
                300..=399 => "服务商要求重定向；为保护对话和凭据已停止，请填写最终地址。",
                _ => "服务商返回错误，已保留提问，请稍后重试。",
            }
            .into());
        }
        if !response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.to_ascii_lowercase().starts_with("text/event-stream"))
        {
            return Err("服务商没有返回 SSE，请检查兼容协议和端点。".into());
        }
        let mut stream = response.bytes_stream();
        let mut decoder = sse::Decoder::default();
        loop {
            let next = tokio::time::timeout(self.idle_timeout, stream.next())
                .await
                .map_err(|_| "回应流超时；已收到的内容已保存，可以继续或重新提问。")?;
            let Some(chunk) = next else {
                return Err("回应流意外断开，已收到的内容已保存。".into());
            };
            for event in decoder.push(&chunk.map_err(|_| "回应传输中断，已收到的内容已保存。")?)?
            {
                if event.trim() == "[DONE]" {
                    return Ok(());
                }
                let value: Value = serde_json::from_str(&event)
                    .map_err(|_| "服务商返回了无法识别的 SSE 数据。")?;
                if value.get("error").is_some() {
                    return Err("服务商在生成中返回错误，已保留部分内容。".into());
                }
                let Some(choice) = value
                    .get("choices")
                    .and_then(|c| c.as_array())
                    .and_then(|c| c.first())
                else {
                    continue;
                };
                if choice.pointer("/delta/tool_calls").is_some()
                    || choice.pointer("/delta/function_call").is_some()
                {
                    return Err("本版本尚不支持工具调用，请使用普通文本对话模型。".into());
                }
                if let Some(text) = choice.pointer("/delta/content").and_then(Value::as_str) {
                    if assistant.content.len() + text.len() > 4 * 1024 * 1024 {
                        return Err("回应超过本版本长度限制，已保存已接收部分。".into());
                    }
                    assistant.content.push_str(text);
                    self.store.lock().map_err(|_| DB_ERROR)?.update(assistant)?;
                    notify(Event::Delta {
                        id: assistant.id.clone(),
                        content: assistant.content.clone(),
                    });
                }
                if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
                    return if reason == "stop" {
                        Ok(())
                    } else {
                        Err(match reason {
                            "length" => "回应达到服务商长度上限，已保存部分内容，可继续提问。",
                            "content_filter" => "服务商过滤了回应，已保存收到的内容。",
                            _ => "服务商以不支持的原因结束回应，已保存收到的内容。",
                        }
                        .into())
                    };
                }
            }
        }
    }
}
