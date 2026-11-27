// Local, synthetic-only OpenAI-compatible fixture. No external calls or request logging.
import http from 'node:http'
const port = Number(process.env.STUDY_TEST_PORT || 8787)
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin
  if (origin && /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS')
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.setHeader('Content-Type','application/json')
    res.end(JSON.stringify({data:['synthetic','synthetic-slow','synthetic-fail','synthetic-auth'].map(id=>({id}))})); return
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return }
  let body = ''
  for await (const part of req) { body += part; if (body.length > 1024 * 1024) { res.writeHead(413); res.end(); return } }
  let request
  try { request = JSON.parse(body) } catch { res.writeHead(400); res.end(); return }
  if (!Array.isArray(request.messages)) { res.writeHead(400); res.end(); return }
  if (request.model === 'synthetic-auth') { res.writeHead(401); res.end('Synthetic authentication failure'); return }
  if (!request.stream) {
    const prompt=String(request.messages[0]?.content||'');const content=prompt.includes('JSON array')?'["history"]':prompt.includes('literary title')?'In the Margins':'OK'
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content},finish_reason:'stop'}]}));return
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }); res.flushHeaders()
  let closed = false; res.on('close', () => { closed = true })
  const text = `这是本机合成回应，不是真实模型。\n\n收到 ${request.messages.length} 条历史消息，强度为 ${request.reasoning_effort || '供应商默认'}。\n\n用于验证中文流式、停止、重开续聊与导出。`
  for (const char of text) {
    if (closed) return
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: char }, finish_reason: null }] })}\r\n\r\n`)
    if (request.model === 'synthetic-fail' && char === '。') { res.destroy(); return }
    await new Promise(resolve => setTimeout(resolve, request.model === 'synthetic-slow' ? 180 : 45))
  }
  res.end('data: [DONE]\n\n')
})
server.listen(port, '127.0.0.1', () => console.log(`Synthetic-only SSE: http://127.0.0.1:${port}/v1/chat/completions\nModels: synthetic, synthetic-slow, synthetic-fail, synthetic-auth. No API key needed.`))
