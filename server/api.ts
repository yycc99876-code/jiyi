import 'dotenv/config'
import http from 'node:http'

const PORT = 3001
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY
const DASHSCOPE_MODEL = process.env.DASHSCOPE_MODEL || 'qwen3.6-plus'
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat'

const analyzeSchemaHint = `{
  "summary": "整体判断",
  "goals": ["修改目标"],
  "issues": [
    {
      "text": "原文中的问题片段",
      "problem": "具体问题",
      "suggestion": "修改建议"
    }
  ],
  "revisions": [
    {
      "id": "rev_1",
      "original": "必须能在 selectedText 中找到的原片段",
      "replacement": "建议替换文本",
      "reason": "为什么这样改",
      "status": "pending"
    }
  ]
}`

const intentSchemaHint = `{
  "goal": "rewrite",
  "tone": "natural/formal/casual/persuasive",
  "style": "professional/conversational/academic/creative",
  "audience": "目标读者",
  "length": "shorter/same/longer",
  "preserve_meaning": true,
  "rewrite_strength": 0.0
}`

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function json(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify(data))
}

function parseJson(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')

  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  const candidate =
    firstBrace >= 0 && lastBrace > firstBrace ? cleaned.slice(firstBrace, lastBrace + 1) : cleaned

  return JSON.parse(candidate)
}

function normalizeIntent(value: any) {
  return {
    goal: 'rewrite',
    tone: String(value?.tone || 'natural'),
    style: String(value?.style || 'professional'),
    audience: String(value?.audience || 'general readers'),
    length: String(value?.length || 'same'),
    preserve_meaning: value?.preserve_meaning !== false,
    rewrite_strength:
      typeof value?.rewrite_strength === 'number' ? Math.min(1, Math.max(0, value.rewrite_strength)) : 0.6,
  }
}

function cleanRewrittenText(raw: unknown, original: string) {
  let text =
    typeof raw === 'string'
      ? raw
      : typeof (raw as any)?.rewritten === 'string'
        ? (raw as any).rewritten
        : typeof (raw as any)?.text === 'string'
          ? (raw as any).text
          : JSON.stringify(raw)

  text = text
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim()

  const markerPatterns = [
    /(?:final|output|rewritten|改写后|最终版本|结果)\s*[:：]\s*/i,
    /(?:ready|只返回改写文本)\s*[.。:：]\s*/i,
  ]

  for (const pattern of markerPatterns) {
    const match = text.match(pattern)
    if (match?.index !== undefined) {
      text = text.slice(match.index + match[0].length).trim()
    }
  }

  const forbiddenMarkers = [
    'The user wants',
    'The constraints are',
    'Original:',
    'Key concepts',
    'Check constraints',
    'Draft:',
    'PM/Professional phrasing adjustments',
  ]

  if (forbiddenMarkers.some((marker) => text.includes(marker))) {
    const draftMatch = text.match(/(?:Draft|改写后|最终版本)\s*[:：]\s*([\s\S]*?)(?:Check constraints|Output:|Ready\.|$)/i)
    if (draftMatch?.[1]) {
      text = draftMatch[1].trim()
    } else {
      text = original
    }
  }

  return text || original
}

async function callDashScope(messages: { role: string; content: string }[], json = true, temperature = 0.35) {
  const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DASHSCOPE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DASHSCOPE_MODEL,
      temperature,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      messages,
    }),
  })

  if (!response.ok) {
    throw new Error(`DashScope error ${response.status}: ${await response.text()}`)
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('Empty model response')
  return json ? parseJson(content) : content
}

async function callDeepSeek(messages: { role: string; content: string }[], temperature = 0.3) {
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      temperature,
      response_format: { type: 'json_object' },
      messages,
    }),
  })

  if (!response.ok) {
    throw new Error(`DeepSeek error ${response.status}: ${await response.text()}`)
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('Empty model response')
  return parseJson(content)
}

async function handleAnalyze(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = JSON.parse(await readBody(req))
  const { selectedText, fullContext } = body

  if (!selectedText || typeof selectedText !== 'string') {
    return json(res, 400, { error: 'selectedText is required' })
  }

  const result = await callDashScope([
    {
      role: 'system',
      content:
        '你是一个中文写作编辑，不是代写助手。请诊断用户选中文本的问题，并给出细粒度、可解释、可逐条接受的修改建议。尽量保留用户原本语气，不要重写整段，不要过度润色。每条 revisions.original 必须能在 selectedText 中找到。只返回严格 JSON。',
    },
    {
      role: 'user',
      content: `selectedText:\n${selectedText}\n\nfullContext:\n${fullContext || ''}\n\n请按这个 JSON 结构返回，不要输出 Markdown：\n${analyzeSchemaHint}`,
    },
  ])

  json(res, 200, result)
}

async function handleRewrite(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = JSON.parse(await readBody(req))
  const { selectedText, userInstruction } = body

  if (!selectedText || typeof selectedText !== 'string') {
    return json(res, 400, { error: 'selectedText is required' })
  }

  const instruction =
    typeof userInstruction === 'string' && userInstruction.trim() ? userInstruction.trim() : '让表达更自然'

  let intent
  try {
    const parsedIntent = await callDashScope([
      {
        role: 'system',
        content:
          '你是一个写作意图解析器。根据用户的中文自然语言修改指令，提取结构化的改写意图。只返回严格 JSON，不要解释。',
      },
      {
        role: 'user',
        content: `用户选中的文本：\n${selectedText}\n\n用户的修改指令：\n${instruction}\n\n请按这个 JSON 结构返回：\n${intentSchemaHint}`,
      },
    ])
    intent = normalizeIntent(parsedIntent)
  } catch {
    intent = normalizeIntent({})
  }

  let rewriteObject: any
  try {
    rewriteObject = await callDashScope(
      [
        {
          role: 'system',
          content:
            '你是一个中文写作编辑。你的任务是按用户指令改写 selectedText。只返回 JSON，且 JSON 只能包含 rewritten 字段。rewritten 必须是最终改写文本。不要输出分析、约束、解释、英文提示词、Markdown、引号或多余字段。',
        },
        {
          role: 'user',
          content: `selectedText:\n${selectedText}\n\nuserInstruction:\n${instruction}\n\nstructuredIntent:\n${JSON.stringify(intent)}\n\n返回格式：{"rewritten":"最终改写文本"}`,
        },
      ],
      true,
      0.45,
    )
  } catch {
    return json(res, 502, { error: '模型调用失败，请稍后重试' })
  }

  const rewritten = cleanRewrittenText(rewriteObject?.rewritten ?? rewriteObject, selectedText)

  json(res, 200, {
    original: selectedText,
    rewritten,
    intent,
  })
}

async function handleCleanTranscript(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = JSON.parse(await readBody(req))
  const { text } = body

  if (!text || typeof text !== 'string') {
    return json(res, 400, { error: 'text is required' })
  }

  let cleaned: string
  try {
    cleaned = await callDashScope(
      [
        {
          role: 'system',
          content:
            '你是一个文字整理助手。用户通过语音输入了一段话，可能有口语化表达、重复、冗余、逻辑不清等问题。请将其整理成简洁、清晰、通顺的书面文字。保留用户的核心意思和关键信息，去除口头禅、重复内容和无关废话。只返回整理后的文字，不要解释。',
        },
        {
          role: 'user',
          content: `请整理这段语音转文字的内容：\n\n${text}`,
        },
      ],
      false,
      0.3,
    )
  } catch {
    cleaned = text
  }

  json(res, 200, {
    raw: text,
    cleaned: cleanRewrittenText(cleaned, text),
  })
}

function readMultipartBody(req: http.IncomingMessage): Promise<{ filename: string; buffer: Buffer; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const contentType = req.headers['content-type'] || ''
      const boundaryMatch = contentType.match(/boundary=(.+)/i)
      if (!boundaryMatch) return reject(new Error('Missing multipart boundary'))

      const boundary = boundaryMatch[1]
      const parts = body.toString('binary').split(`--${boundary}`)

      for (const part of parts) {
        const headerEnd = part.indexOf('\r\n\r\n')
        if (headerEnd === -1) continue

        const header = part.slice(0, headerEnd)
        const filenameMatch = header.match(/filename="(.+?)"/i)
        const mimeMatch = header.match(/Content-Type:\s*(.+?)\r\n/i)

        if (filenameMatch) {
          const rawBody = part.slice(headerEnd + 4)
          const cleanBody = rawBody.endsWith('\r\n') ? rawBody.slice(0, -2) : rawBody
          resolve({
            filename: filenameMatch[1],
            buffer: Buffer.from(cleanBody, 'binary'),
            mimeType: mimeMatch?.[1]?.trim() || 'audio/webm',
          })
          return
        }
      }
      reject(new Error('No audio file found in request'))
    })
    req.on('error', reject)
  })
}

async function handleTranscribe(req: http.IncomingMessage, res: http.ServerResponse) {
  let audioBuffer: Buffer
  let mimeType: string

  try {
    const parsed = await readMultipartBody(req)
    audioBuffer = parsed.buffer
    mimeType = parsed.mimeType
  } catch (err: any) {
    return json(res, 400, { error: err.message })
  }

  const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : 'wav'
  const fileBlob = new Blob([audioBuffer], { type: mimeType })
  const form = new FormData()
  form.append('file', fileBlob, `audio.${ext}`)
  form.append('model', 'paraformer-v2')

  const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${DASHSCOPE_API_KEY}` },
    body: form,
  })

  if (!response.ok) {
    const errText = await response.text()
    return json(res, 502, { error: `语音识别服务错误: ${response.status} ${errText}` })
  }

  const data = await response.json()
  const text = data?.text || ''
  json(res, 200, { text })
}

interface Suggestion {
  original: string
  replacement: string
  reason: string
  severity: 'minor' | 'moderate' | 'major'
}

const HARD_ERROR_RULES: { pattern: string; replacement: string; reason: string; severity: 'moderate' | 'major' }[] = [
  {
    pattern: '更束缚',
    replacement: '更流畅',
    reason: '"束缚"表示限制，不适合搭配"看起来"；此处应为"更流畅"，形容表达顺畅',
    severity: 'major',
  },
  {
    pattern: '帮主',
    replacement: '帮助',
    reason: '错别字：帮主应为帮助',
    severity: 'major',
  },
  {
    pattern: 'dan是',
    replacement: '但是',
    reason: '拼音输入未转换：应为"但是"',
    severity: 'major',
  },
  {
    pattern: '更好的进行',
    replacement: '更好地进行',
    reason: '修饰动词"进行"应用副词"地"而非"的"',
    severity: 'moderate',
  },
]

function detectHardErrors(text: string): Suggestion[] {
  const results: Suggestion[] = []
  for (const rule of HARD_ERROR_RULES) {
    if (text.includes(rule.pattern)) {
      results.push({
        original: rule.pattern,
        replacement: rule.replacement,
        reason: rule.reason,
        severity: rule.severity,
      })
    }
  }
  return results
}

function normalizeSuggestions(items: any[], paragraphText: string): Suggestion[] {
  const seen = new Set<string>()
  const results: Suggestion[] = []

  for (const s of items) {
    const original = typeof s.original === 'string' ? s.original.trim() : ''
    const replacement = typeof s.replacement === 'string' ? s.replacement.trim() : ''
    const reason = typeof s.reason === 'string' ? s.reason.trim() : ''
    const severity =
      s.severity === 'minor' || s.severity === 'moderate' || s.severity === 'major'
        ? s.severity
        : 'minor'

    if (!original || !replacement) continue
    if (original === replacement) continue
    if (!paragraphText.includes(original)) continue
    if (original.length > 4 && replacement.length > original.length * 2) continue

    const key = `${original}__${replacement}`
    if (seen.has(key)) continue
    seen.add(key)

    results.push({ original, replacement, reason, severity })
  }

  return results
}

async function handleGhostScan(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = JSON.parse(await readBody(req))
  const { paragraphText, fullContext } = body

  if (!paragraphText || typeof paragraphText !== 'string') {
    return json(res, 400, { error: 'paragraphText is required' })
  }

  const hardErrors = detectHardErrors(paragraphText)

  let modelRaw: any[] = []
  if (DEEPSEEK_API_KEY) {
    try {
      const result = await callDeepSeek([
        {
          role: 'system',
          content:
            '你是中文写作编辑。分析用户给定的段落，找出 1-3 个最值得改进的局部问题。优先发现错别字、搭配错误、拼音/输入法残留等硬性问题，其次才是风格润色。只做必要的局部编辑，不要重写整句。每条 original 必须是段落中已有的精确片段，replacement 应简洁，长度不要明显超过 original。避免主观润色，除非能明显提升清晰度或正确性。不允许重复或重叠建议。severity: minor=措辞微调, moderate=表达改进, major=逻辑/结构/硬性问题。只返回严格 JSON。',
        },
        {
          role: 'user',
          content: `paragraphText:\n${paragraphText}\n\nfullContext（仅供参考，不要修改）:\n${fullContext || '无'}\n\n返回格式：{"suggestions":[{"original":"原文片段","replacement":"建议替换","reason":"原因","severity":"minor/moderate/major"}]}，最多 3 条。`,
        },
      ])
      modelRaw = Array.isArray(result?.suggestions) ? result.suggestions : []
    } catch {
      // Model call failed; fall through to return hard errors only
    }
  }

  const modelSuggestions = normalizeSuggestions(modelRaw, paragraphText)
  const merged = normalizeSuggestions([...hardErrors, ...modelSuggestions], paragraphText)

  json(res, 200, { suggestions: merged.slice(0, 3) })
}

async function handleIntentMap(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = JSON.parse(await readBody(req))
  const { fullText } = body

  if (!fullText || typeof fullText !== 'string') {
    return json(res, 400, { error: 'fullText is required' })
  }

  if (!DEEPSEEK_API_KEY) {
    return json(res, 500, { error: 'DEEPSEEK_API_KEY is not configured' })
  }

  let result
  try {
    result = await callDeepSeek([
      {
        role: 'system',
        content:
          '你是一个文章结构分析专家。分析用户的文章，提取核心论点和它们之间的逻辑关系。每个论点关联到文章中的一个段落片段。只返回严格 JSON。',
      },
      {
        role: 'user',
        content: `文章全文：\n${fullText}\n\n返回格式：{"nodes":[{"id":"n1","label":"论点摘要","paragraph":"对应的段落片段","strength":"strong/medium/weak"}],"edges":[{"from":"n1","to":"n2","relation":"supports/contradicts/extends/weakens"}],"summary":"文章整体结构判断"}`,
      },
    ])
  } catch {
    return json(res, 200, { nodes: [], edges: [], summary: '' })
  }

  json(res, 200, {
    nodes: Array.isArray(result?.nodes) ? result.nodes : [],
    edges: Array.isArray(result?.edges) ? result.edges : [],
    summary: typeof result?.summary === 'string' ? result.summary : '',
  })
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    res.end()
    return
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' })
  }

  if (!DASHSCOPE_API_KEY) {
    return json(res, 500, { error: 'DASHSCOPE_API_KEY is not configured in .env' })
  }

  try {
    if (req.url === '/api/revision/analyze') {
      await handleAnalyze(req, res)
    } else if (req.url === '/api/revision/rewrite') {
      await handleRewrite(req, res)
    } else if (req.url === '/api/revision/clean-transcript') {
      await handleCleanTranscript(req, res)
    } else if (req.url === '/api/revision/transcribe') {
      await handleTranscribe(req, res)
    } else if (req.url === '/api/revision/ghost-scan') {
      await handleGhostScan(req, res)
    } else if (req.url === '/api/revision/intent-map') {
      await handleIntentMap(req, res)
    } else {
      json(res, 404, { error: 'Not found' })
    }
  } catch (err: any) {
    json(res, 500, { error: err.message ?? 'Internal error' })
  }
})

server.listen(PORT, () => {
  console.log(`[API] DashScope proxy running on http://localhost:${PORT}`)
  console.log(`[API] DashScope Model: ${DASHSCOPE_MODEL} | Key: ${DASHSCOPE_API_KEY ? 'ok' : 'MISSING'}`)
  console.log(`[API] DeepSeek Model: ${DEEPSEEK_MODEL} | Key: ${DEEPSEEK_API_KEY ? 'ok' : 'MISSING'}`)
})
