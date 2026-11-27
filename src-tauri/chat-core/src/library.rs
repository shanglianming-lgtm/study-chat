use super::*;
use rusqlite::OptionalExtension;

impl Chat {
    pub fn library_load(&self) -> Result<Option<Value>> {
        let db = self.store.lock().map_err(|_| DB_ERROR)?;
        let row: Option<(i64, String)> = db
            .conn
            .query_row("SELECT revision,data FROM library WHERE id=1", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()
            .map_err(|_| DB_ERROR)?;
        row.map(|(revision, data)| {
            serde_json::from_str::<Value>(&data)
                .map(|value| json!({"revision":revision,"value":value}))
                .map_err(|_| DB_ERROR.into())
        })
        .transpose()
    }
    pub fn library_save(&self, value: Value, revision: u64) -> Result<u64> {
        let data = serde_json::to_string(&value).map_err(|_| DB_ERROR)?;
        let mut store = self.store.lock().map_err(|_| DB_ERROR)?;
        let tx = store.conn.transaction().map_err(|_| DB_ERROR)?;
        let current: u64 = tx
            .query_row("SELECT revision FROM library WHERE id=1", [], |r| r.get(0))
            .optional()
            .map_err(|_| DB_ERROR)?
            .unwrap_or(0);
        if current != revision {
            return Err("另一窗口已保存更新，请重新打开书房。".into());
        }
        tx.execute("INSERT INTO library VALUES(1,?1,?2) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data",params![revision+1,data]).map_err(|_| DB_ERROR)?;
        tx.commit().map_err(|_| DB_ERROR)?;
        Ok(revision + 1)
    }
    pub fn library_secret(
        &self,
        endpoint: &str,
        key: Option<String>,
        remove: bool,
    ) -> Result<bool> {
        validate(&Provider {
            endpoint: endpoint.into(),
            name: "catalogue".into(),
            model: "catalogue".into(),
            use_key: false,
        })?;
        let account = account(endpoint);
        if remove {
            self.secrets.delete(&account)?;
        } else if let Some(key) = key.map(Zeroizing::new) {
            if key.trim().is_empty() || key.contains(['\r', '\n']) {
                return Err("请输入有效凭据。".into());
            }
            self.secrets.set(&account, key.trim())?;
        }
        Ok(self.secrets.get(&account)?.is_some())
    }
    pub fn library_cancel(&self, id: &str) -> Result<()> {
        if let Some(token) = self.library_requests.lock().map_err(|_| DB_ERROR)?.get(id) {
            token.cancel();
        }
        Ok(())
    }
    pub async fn library_http(
        &self,
        id: String,
        endpoint: String,
        use_key: bool,
        payload: Option<Value>,
        after: Option<String>,
        on_data: impl Fn(String) + Send + Sync,
    ) -> Result<Option<Value>> {
        validate(&Provider {
            endpoint: endpoint.clone(),
            name: "catalogue".into(),
            model: "catalogue".into(),
            use_key,
        })?;
        let token = CancellationToken::new();
        self.library_requests
            .lock()
            .map_err(|_| DB_ERROR)?
            .insert(id.clone(), token.clone());
        let request = async {
            let mut target = Url::parse(&endpoint).map_err(|_| "服务地址无效。")?;
            let anthropic = target.host_str() == Some("api.anthropic.com");
            let gemini_catalog = payload.is_none() && target.host_str() == Some("generativelanguage.googleapis.com");
            let method = match (payload.is_some(), target.host_str()) {
                (false, _) => "models",
                (true, Some("api.anthropic.com")) => "messages",
                (true, Some("api.openai.com")) => "responses",
                _ => "chat/completions",
            };
            let path = target.path().trim_end_matches("chat/completions").to_owned() + method;
            target.set_path(if gemini_catalog { "/v1beta/models" } else { &path });
            if payload.is_none() && (anthropic || gemini_catalog) {
                if let Some(after) = after {
                    target.query_pairs_mut().append_pair(if gemini_catalog { "pageToken" } else { "after_id" }, &after);
                }
            }
            let mut req = match &payload {
                Some(body) => self.client.post(target).json(body),
                None => self.client.get(target),
            };
            if anthropic {
                req = req.header("anthropic-version", "2023-06-01");
            }
            if use_key {
                let secret = self.secrets.get(&account(&endpoint))?.map(Zeroizing::new);
                if let Some(secret) = secret {
                    req = if anthropic {
                        req.header("x-api-key", secret.as_str())
                    } else if gemini_catalog {
                        req.header("x-goog-api-key", secret.as_str())
                    } else {
                        req.bearer_auth(secret.as_str())
                    };
                }
            }
            let response = tokio::time::timeout(self.idle_timeout, req.send())
                .await
                .map_err(|_| "等待服务商超时。")?
                .map_err(|_| "无法连接服务商，请检查地址或网络。")?;
            let status = response.status();
            if !status.is_success() {
                return Err(format!(
                    "HTTP {} · {}",
                    status.as_u16(),
                    match status.as_u16() {
                        401 | 403 => "凭据或模型权限未获接受",
                        404 => "地址或模型不存在",
                        429 => "服务商限流或额度不足",
                        400 | 422 => "服务商不接受当前请求参数，请检查模型、强度与附件",
                        _ => "服务商请求失败",
                    }
                ));
            }
            let sse = response
                .headers()
                .get("content-type")
                .and_then(|h| h.to_str().ok())
                .unwrap_or("")
                .to_lowercase()
                .contains("text/event-stream");
            let mut bytes = response.bytes_stream();
            let mut decoder = sse::Decoder::default();
            let mut json_bytes = Vec::new();
            while let Some(chunk) = tokio::time::timeout(self.idle_timeout, bytes.next())
                .await
                .map_err(|_| "回应流超时。")?
            {
                let chunk = chunk.map_err(|_| "读取回应时连接中断。")?;
                if sse {
                    for event in decoder.push(&chunk)? {
                        let done = event.trim() == "[DONE]";
                        on_data(event);
                        if done {
                            return Ok(None);
                        }
                    }
                } else {
                    if json_bytes.len() + chunk.len() > 32 * 1024 * 1024 {
                        return Err("单次回应超过 32 MiB。".into());
                    }
                    json_bytes.extend_from_slice(&chunk);
                }
            }
            if sse {
                Ok(None)
            } else {
                serde_json::from_slice(&json_bytes)
                    .map(Some)
                    .map_err(|_| "服务商没有返回有效的 JSON。".into())
            }
        };
        let result = tokio::select! { biased; _=token.cancelled()=>Err("已停笔。".into()), value=request=>value };
        self.library_requests
            .lock()
            .map_err(|_| DB_ERROR)?
            .remove(&id);
        result
    }
}
