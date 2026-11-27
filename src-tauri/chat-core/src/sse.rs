// Decode complete SSE lines as bytes so split UTF-8 codepoints stay intact.
// An upper bound prevents untrusted endpoints from growing an unfinished event forever.
#[derive(Default)]
pub struct Decoder {
    pending: Vec<u8>,
    data: Vec<String>,
    event_bytes: usize,
}
impl Decoder {
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<String>, String> {
        self.pending.extend_from_slice(bytes);
        if self.pending.len() > 2 * 1024 * 1024 {
            return Err("服务商返回的流式事件过大。".into());
        }
        let mut events = Vec::new();
        while let Some(end) = self.pending.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = self.pending.drain(..=end).collect();
            let line = std::str::from_utf8(&line[..line.len() - 1])
                .map_err(|_| "流式响应不是有效 UTF-8。")?
                .trim_end_matches('\r');
            if line.is_empty() {
                if !self.data.is_empty() {
                    events.push(self.data.join("\n"));
                    self.data.clear();
                }
                self.event_bytes = 0;
            } else if let Some(data) = line.strip_prefix("data:") {
                let data = data.strip_prefix(' ').unwrap_or(data);
                // Include field framing: even an empty data field stores a String.
                self.event_bytes += line.len() + 1;
                if self.event_bytes > 1024 * 1024 {
                    return Err("服务商返回的流式事件过大。".into());
                }
                self.data.push(data.to_owned());
            }
        }
        Ok(events)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn split_utf8_crlf_comments_and_multiline() {
        let bytes = ": heartbeat\r\ndata: 你好\r\ndata: world\r\n\r\ndata: [DONE]\n\n".as_bytes();
        let mut parser = Decoder::default();
        let mut events = Vec::new();
        for byte in bytes {
            events.extend(parser.push(&[*byte]).unwrap());
        }
        assert_eq!(events, vec!["你好\nworld", "[DONE]"]);
    }
    #[test]
    fn unfinished_event_is_not_committed_and_oversize_is_rejected() {
        let mut parser = Decoder::default();
        assert!(parser.push(b"data: incomplete").unwrap().is_empty());
        assert!(parser.push(&vec![b'x'; 2 * 1024 * 1024]).is_err());
    }

    #[test]
    fn empty_data_fields_cannot_grow_an_unfinished_event_without_limit() {
        let mut parser = Decoder::default();
        // Every field allocates a String even though its payload is empty.
        // Split across small chunks to stay below the unfinished-line limit.
        let chunk = b"data:\n".repeat(1024);
        let error = (0..180).find_map(|_| parser.push(&chunk).err());
        assert_eq!(error.as_deref(), Some("服务商返回的流式事件过大。"));
    }
}
