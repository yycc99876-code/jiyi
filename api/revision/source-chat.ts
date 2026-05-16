type ChatRole = 'user' | 'assistant' | 'system'

interface ChatMessage {
  role: ChatRole
  content: string
}

function sendJson(res: any, status: number, data: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.end(JSON.stringify(data))
}

function readBody(req: any): Promise<string> {
  if (typeof req.body === 'string') return Promise.resolve(req.body)
  if (req.body && typeof req.body === 'object') return Promise.resolve(JSON.stringify(req.body))

  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer | string) => {
      body += chunk.toString()
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function normalizeHistory(history: unknown): ChatMessage[] {
  if (!Array.isArray(history)) return []

  return history
    .slice(-10)
    .map((item) => {
      const role: ChatRole = item?.role === 'assistant' ? 'assistant' : item?.role === 'system' ? 'system' : 'user'
      const content = typeof item?.content === 'string' ? item.content.trim() : ''
      return { role, content }
    })
    .filter((item) => item.content && !item.content.startsWith('请求失败') && !item.content.startsWith('生成失败'))
}

async function callDashScope(messages: ChatMessage[], mode: 'quick' | 'long') {
  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY is missing')

  const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.DASHSCOPE_MODEL || 'qwen-turbo',
      temperature: mode === 'long' ? 0.58 : 0.48,
      max_tokens: mode === 'long' ? 2400 : 900,
      messages,
    }),
    signal: AbortSignal.timeout(mode === 'long' ? 90_000 : 60_000),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`DashScope error ${response.status}: ${detail.slice(0, 180)}`)
  }

  const data = await response.json()
  return String(data?.choices?.[0]?.message?.content || '').trim()
}

async function callDeepSeek(messages: ChatMessage[]) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is missing')

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      temperature: 0.58,
      max_tokens: 2600,
      messages,
    }),
    signal: AbortSignal.timeout(90_000),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`DeepSeek error ${response.status}: ${detail.slice(0, 180)}`)
  }

  const data = await response.json()
  return String(data?.choices?.[0]?.message?.content || '').trim()
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.end()
    return
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }

  try {
    const rawBody = await readBody(req)
    const body = rawBody ? JSON.parse(rawBody) : {}
    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    if (!message) {
      sendJson(res, 400, { error: 'message is required' })
      return
    }

    const mode: 'quick' | 'long' = body?.mode === 'long' ? 'long' : 'quick'
    const sourceContext = String(body?.sourceContext || '').slice(0, 6000)
    const articleContext = String(body?.articleContext || '').slice(0, 1800)
    const history = normalizeHistory(body?.history)

    const systemPrompt = `你是 Revision Lens 的中文写作助手。
你帮助用户把资料、想法和当前正文整理成可以直接使用的文字。
规则：
- 用简洁、自然、清楚的中文回答。
- 如果用户要求写文章、段落、提纲或改写，直接给出可用内容，不要写空泛解释。
- 如果用户提供了资料，优先基于资料回答。
- 如果资料不足，可以基于常识补全，但要保持稳妥。
- 不要重复用户已经写过的失败提示。`

    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }]

    if (sourceContext) {
      messages.push({ role: 'system', content: `参考资料：\n${sourceContext}` })
    }

    if (articleContext) {
      messages.push({ role: 'system', content: `当前正文片段：\n${articleContext}` })
    }

    messages.push(...history)
    messages.push({ role: 'user', content: message })

    const reply =
      mode === 'long' && process.env.DEEPSEEK_API_KEY
        ? await callDeepSeek(messages)
        : await callDashScope(messages, mode)

    sendJson(res, 200, {
      reply: reply || '我没有生成有效回复，请再试一次。',
    })
  } catch (error) {
    console.error('[source-chat] request failed', error)
    sendJson(res, 200, {
      reply: '生成失败，请稍后再试。如果你刚刚切换了线上版本，可以刷新页面后重试。',
    })
  }
}
