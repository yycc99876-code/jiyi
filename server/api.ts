import 'dotenv/config'
import http from 'node:http'

const PORT = 3001
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY
const DASHSCOPE_MODEL = process.env.DASHSCOPE_MODEL || 'qwen-turbo'
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

async function callDeepSeek(messages: { role: string; content: string }[], temperature = 0.3, maxTokens?: number) {
  const payload: Record<string, unknown> = {
    model: DEEPSEEK_MODEL,
    temperature,
    response_format: { type: 'json_object' },
    messages,
  }
  if (maxTokens) payload.max_tokens = maxTokens

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  })

  if (!response.ok) {
    throw new Error(`DeepSeek error ${response.status}: ${await response.text()}`)
  }

  const data = await response.json()
  const message = data?.choices?.[0]?.message
  const content = message?.content || message?.reasoning_content
  if (!content) {
    console.error('[DeepSeek] Empty response, full data:', JSON.stringify(data).slice(0, 300))
    throw new Error('Empty model response')
  }
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
  const { text, terms } = body

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
            '你是一个速度很快的语音转文字校正助手。用户通过语音输入了一段话，识别结果可能把英文产品名、编程工具、AI 工具识别错。请根据上下文恢复用户真实意图，整理成简洁、清晰、通顺的书面文字。重要：优先校正技术术语，例如 cloud code / claudecode / 克劳德 code 应校正为 Claude Code；code x / codex 应校正为 Codex；open ai 应校正为 OpenAI。保留用户核心意思，不要扩写，不要解释，只返回整理后的文字。',
        },
        {
          role: 'user',
          content: `常见术语：${Array.isArray(terms) ? terms.join('、') : 'Claude Code、Codex、ChatGPT、OpenAI、Vercel、GitHub'}\n\n请整理这段语音转文字的内容：\n\n${text}`,
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
  const { paragraphs } = body

  if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
    return json(res, 400, { error: 'paragraphs is required' })
  }

  if (!DEEPSEEK_API_KEY) {
    return json(res, 200, { nodes: [], edges: [], summary: '', writingGoal: '' })
  }

  const paragraphList = paragraphs.map((p: any) => `[${p.id}] ${p.text}`).join('\n\n')

  let result
  try {
    result = await callDeepSeek([
      {
        role: 'system',
        content:
          '你是一个写作意图分析专家。分析用户的文章，提取写作意图——包括写作目标、核心主题、目标受众、语气风格、约束条件。识别这些意图之间的关系。只返回严格 JSON，不要用代码块包裹。',
      },
      {
        role: 'user',
        content:
          `文章段落：\n${paragraphList}\n\n` +
          '返回格式：\n' +
          '{\n' +
          '  "nodes": [{"id":"n1","label":"意图标签","type":"goal/theme/audience/tone/constraint","description":"详细描述","confidence":0.0到1.0}],\n' +
          '  "edges": [{"from":"n1","to":"n2","relation":"supports/conflicts/depends/enables"}],\n' +
          '  "summary": "写作意图整体分析",\n' +
          '  "writingGoal": "核心写作目标的一句话概括"\n' +
          '}\n\n' +
          '最多 8 个节点，最多 10 条边。每个 type 至少出现一次。',
      },
    ], 0.3, 1500)
  } catch {
    return json(res, 200, { nodes: [], edges: [], summary: '', writingGoal: '' })
  }

  json(res, 200, {
    nodes: Array.isArray(result?.nodes) ? result.nodes : [],
    edges: Array.isArray(result?.edges) ? result.edges : [],
    summary: typeof result?.summary === 'string' ? result.summary : '',
    writingGoal: typeof result?.writingGoal === 'string' ? result.writingGoal : '',
  })
}

// ─── Coherence Agent Cache ───

const coherenceCache = new Map<string, { data: unknown; ts: number }>()
const COHERENCE_CACHE_TTL = 10_000

function coherenceCacheKey(paragraphs: { id: string; text: string }[]): string {
  return paragraphs.map((p) => `${p.id}:${p.text.length}:${p.text.slice(0, 30)}...${p.text.slice(-20)}`).join('|')
}

async function handleCoherenceAgent(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = JSON.parse(await readBody(req))
  const { paragraphs, changedParagraphIds, previousGraph, previousDecisions } = body

  if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
    return json(res, 400, { error: 'paragraphs is required' })
  }

  if (!DEEPSEEK_API_KEY) {
    return json(res, 200, { graph: null, ghostSuggestions: [], structuralNudges: [] })
  }

  // Check cache
  const key = coherenceCacheKey(paragraphs)
  const cached = coherenceCache.get(key)
  if (cached && Date.now() - cached.ts < COHERENCE_CACHE_TTL) {
    return json(res, 200, cached.data)
  }

  const paragraphList = paragraphs
    .map((p: any) => `[${p.id}]${p.heading ? ` (标题: ${p.heading})` : ''} ${p.text}`)
    .join('\n\n')

  let instruction = ''
  if (previousGraph && Array.isArray(changedParagraphIds) && changedParagraphIds.length > 0 && changedParagraphIds.length <= 2) {
    instruction = `\n\n增量更新模式：以下段落发生了变化：${changedParagraphIds.join(', ')}。请只重新分析这些段落及其相关的边，保持其他节点不变。返回完整的更新后图谱。`
  }

  let decisionsContext = ''
  if (Array.isArray(previousDecisions) && previousDecisions.length > 0) {
    const rejected = previousDecisions.filter((d: any) => !d.accepted).slice(0, 10)
    if (rejected.length > 0) {
      decisionsContext = `\n\n用户之前拒绝了这些建议（不要重复类似模式）：\n${rejected.map((d: any) => `- "${d.original}" → "${d.replacement}"`).join('\n')}`
    }
  }

  const systemPrompt =
    '你是一个中文写作结构编辑，不是代写助手。你的任务是分析文章的论证结构，帮助作者发现逻辑问题。\n\n' +
    '你需要：\n' +
    '1. 为每个段落识别其在论证中的角色（claim=论点, evidence=论据, counterargument=反论, transition=过渡, conclusion=结论）\n' +
    '2. 评估每个论点的证据强度（strong/medium/weak）\n' +
    '3. 检测段落间的逻辑关系（supports/contradicts/extends/weakens）\n' +
    '4. 发现结构性问题：矛盾、论点缺乏论据、冗余、缺少结论\n' +
    '5. 生成 0-3 条论证层面的幽灵文字建议（不是错别字，那是另一个系统负责的）\n\n' +
    '只返回严格 JSON，不要输出 Markdown，不要用代码块包裹。'

  const userMessage =
    `文章段落：\n${paragraphList}${instruction}${decisionsContext}\n\n` +
    '返回格式：\n' +
    '{\n' +
    '  "graph": {\n' +
    '    "nodes": [{"id":"p_0","label":"论点摘要","paragraph":"对应段落片段","strength":"strong/medium/weak","role":"claim/evidence/counterargument/transition/conclusion","evidenceNote":"为什么强或弱"}],\n' +
    '    "edges": [{"from":"p_0","to":"p_1","relation":"supports/contradicts/extends/weakens","explanation":"为什么有这个关系"}],\n' +
    '    "summary":"文章整体结构判断",\n' +
    '    "coherenceScore": 0.0到1.0之间的分数\n' +
    '  },\n' +
    '  "ghostSuggestions": [{"original":"原文片段","replacement":"建议替换","reason":"原因","severity":"minor/moderate/major","argumentContext":"这对论证的意义"}],\n' +
    '  "structuralNudges": [{"type":"contradiction/gap/redundancy/unsupported_claim/missing_conclusion","message":"问题描述","relatedParagraphs":["p_0"],"severity":"low/medium/high"}]\n' +
    '}\n\n' +
    '连贯性评分标准：所有论点都有论据支撑(0.3) + 无矛盾(0.2) + 段落间逻辑流畅(0.2) + 结论覆盖所有论点(0.15) + 无冗余(0.15)。最多3条幽灵建议，最多3条结构提示。'

  let result: any
  try {
    result = await callDeepSeek([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ], 0.3, 2000)
  } catch {
    return json(res, 200, { graph: null, ghostSuggestions: [], structuralNudges: [] })
  }

  if (!result) {
    return json(res, 200, { graph: null, ghostSuggestions: [], structuralNudges: [] })
  }

  // Normalize graph
  const normalizeGraph = (raw: any) => {
    const nodes = Array.isArray(raw?.nodes)
      ? raw.nodes.map((n: any) => ({
          id: String(n.id || ''),
          label: String(n.label || ''),
          paragraph: String(n.paragraph || ''),
          strength: ['strong', 'medium', 'weak'].includes(n.strength) ? n.strength : 'medium',
          role: ['claim', 'evidence', 'counterargument', 'transition', 'conclusion'].includes(n.role)
            ? n.role
            : 'claim',
          evidenceNote: typeof n.evidenceNote === 'string' ? n.evidenceNote : undefined,
        }))
      : []
    const edges = Array.isArray(raw?.edges)
      ? raw.edges.map((e: any) => ({
          from: String(e.from || ''),
          to: String(e.to || ''),
          relation: ['supports', 'contradicts', 'extends', 'weakens', 'unrelated'].includes(e.relation)
            ? e.relation
            : 'unrelated',
          explanation: typeof e.explanation === 'string' ? e.explanation : undefined,
        }))
      : []
    const score = typeof raw?.coherenceScore === 'number' ? Math.min(1, Math.max(0, raw.coherenceScore)) : 0.5
    return { nodes, edges, summary: String(raw?.summary || ''), coherenceScore: score }
  }

  const normalizeNudges = (raw: any) => {
    if (!Array.isArray(raw)) return []
    return raw
      .map((n: any) => ({
        type: ['contradiction', 'gap', 'redundancy', 'unsupported_claim', 'missing_conclusion'].includes(n.type)
          ? n.type
          : 'gap',
        message: String(n.message || ''),
        relatedParagraphs: Array.isArray(n.relatedParagraphs) ? n.relatedParagraphs.map(String) : [],
        severity: ['low', 'medium', 'high'].includes(n.severity) ? n.severity : 'medium',
      }))
      .filter((n: any) => n.message.length > 0)
  }

  const allText = paragraphs.map((p: any) => p.text).join('\n')
  const normalizeSuggestions = (raw: any) => {
    if (!Array.isArray(raw)) return []
    return raw
      .map((s: any) => {
        const original = typeof s.original === 'string' ? s.original.trim() : ''
        const replacement = typeof s.replacement === 'string' ? s.replacement.trim() : ''
        if (!original || !replacement || original === replacement) return null
        if (!allText.includes(original)) return null
        return {
          original,
          replacement,
          reason: String(s.reason || ''),
          severity: ['minor', 'moderate', 'major'].includes(s.severity) ? s.severity : 'minor',
          argumentContext: typeof s.argumentContext === 'string' ? s.argumentContext : undefined,
        }
      })
      .filter(Boolean)
  }

  const responseData = {
    graph: result.graph ? normalizeGraph(result.graph) : null,
    ghostSuggestions: normalizeSuggestions(result.ghostSuggestions),
    structuralNudges: normalizeNudges(result.structuralNudges),
  }

  coherenceCache.set(key, { data: responseData, ts: Date.now() })
  if (coherenceCache.size > 50) {
    const now = Date.now()
    for (const [k, v] of coherenceCache) {
      if (now - v.ts > COHERENCE_CACHE_TTL) coherenceCache.delete(k)
    }
  }

  json(res, 200, responseData)
}

// ─── Canvas Action Handler ──────────────────────────────────────────────────

const ACTION_PROMPTS: Record<string, string> = {
  strengthen: '你是中文写作结构编辑。用户给你一个论点段落，你需要生成 2-3 个更强版本。每个版本应该：更有说服力、更具体、逻辑更严密。保留用户的核心观点，不要改变立场。',
  counterargument: '你是中文写作结构编辑。用户给你一个论点段落，你需要站在对立面生成 2-3 个有力的反驳论点。每个反驳应该有理有据，不是简单否定。',
  evidence: '你是中文写作结构编辑。用户给你一个论点段落，你需要生成 2-3 条可以支撑这个论点的论据。论据应该具体、可信、有说服力。',
  rewrite: '你是中文写作编辑。用户给你一个段落，你需要生成 2-3 个改写版本。每个版本保持核心意思，但在表达上有所改进。',
}

function fallbackCanvasSuggestions(message: string) {
  const topic = String(message || '').trim().slice(0, 40) || '这篇文章'
  return [
    {
      id: `draft_${Date.now()}_0`,
      type: 'outline',
      title: '草稿大纲',
      content: `1. 先说明你想讨论的主题：${topic}\n2. 写出当前常见问题或真实场景\n3. 提出你的判断和解决方向\n4. 用一个具体例子收束观点`,
      actionLabel: '放到画布',
    },
    {
      id: `draft_${Date.now()}_1`,
      type: 'draft',
      title: '开头草稿',
      content: `关于「${topic}」，可以先从一个真实使用场景切入，再说明为什么这个问题值得讨论。`,
      actionLabel: '补全正文',
    },
  ]
}

async function handleCanvasChat(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = JSON.parse(await readBody(req))
  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  if (!message) {
    return json(res, 400, { error: 'message is required' })
  }

  if (!DEEPSEEK_API_KEY) {
    return json(res, 200, {
      reply: '我先给你拆一个可以放到画布上的草稿方向。',
      suggestions: fallbackCanvasSuggestions(message),
    })
  }

  const history = Array.isArray(body.history)
    ? body.history.slice(-8).map((m: any) => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`).join('\n')
    : ''

  try {
    const result = await callDeepSeek([
      {
        role: 'system',
        content:
          '你是 Revision Lens 的 AI 草稿助手。用户正在一张写作草稿画布上构思文章。你要用简洁中文回应，并生成 1-3 个可放到画布或补全正文的结构化建议。不要写长篇说明。只返回严格 JSON。',
      },
      {
        role: 'user',
        content:
          `用户输入：${message}\n\n` +
          `历史对话：\n${history || '无'}\n\n` +
          `当前文章上下文：\n${String(body.articleContext || '').slice(0, 1800) || '无'}\n\n` +
          '返回格式：{"reply":"一句简短回应","suggestions":[{"type":"note/outline/draft/question","title":"标题","content":"内容","actionLabel":"放到画布或补全正文"}]}',
      },
    ], 0.45, 1400)

    const rawSuggestions = Array.isArray(result?.suggestions) ? result.suggestions : []
    const suggestions = rawSuggestions
      .filter((item: any) => item && typeof item.content === 'string' && item.content.trim())
      .slice(0, 3)
      .map((item: any, index: number) => ({
        id: `draft_${Date.now()}_${index}`,
        type: ['note', 'outline', 'draft', 'question'].includes(item.type) ? item.type : 'note',
        title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : '草稿建议',
        content: item.content.trim(),
        actionLabel: typeof item.actionLabel === 'string' ? item.actionLabel : undefined,
      }))

    return json(res, 200, {
      reply: typeof result?.reply === 'string' && result.reply.trim() ? result.reply.trim() : '我给你整理了几个草稿方向。',
      suggestions: suggestions.length > 0 ? suggestions : fallbackCanvasSuggestions(message),
    })
  } catch {
    return json(res, 200, {
      reply: '模型暂时没有返回，我先给你一个可用的草稿起点。',
      suggestions: fallbackCanvasSuggestions(message),
    })
  }
}

async function handleCanvasAction(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = JSON.parse(await readBody(req))
  const { paragraph, action, context } = body

  if (!paragraph || typeof paragraph !== 'string') {
    return json(res, 400, { error: 'paragraph is required' })
  }
  if (!action || !ACTION_PROMPTS[action]) {
    return json(res, 400, { error: 'action must be one of: strengthen, counterargument, evidence, rewrite' })
  }

  if (!DEEPSEEK_API_KEY) {
    return json(res, 200, { original: paragraph, action, variants: [] })
  }

  try {
    const systemPrompt = ACTION_PROMPTS[action]
    const userMessage = `段落内容：\n${paragraph}\n\n${context ? `文章上下文（仅供参考）：\n${context.slice(0, 2000)}\n\n` : ''}请返回 JSON：\n{\n  "variants": [\n    {"text": "改写内容", "explanation": "为什么这样改"}\n  ]\n}`

    const data = await callDeepSeek([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ], 0.5)

    const rawVariants = Array.isArray(data?.variants) ? data.variants : []
    const variants = rawVariants
      .filter((v: any) => v && typeof v.text === 'string' && v.text.trim())
      .map((v: any, i: number) => ({
        id: `action_${Date.now()}_${i}`,
        text: v.text.trim(),
        explanation: typeof v.explanation === 'string' ? v.explanation : '',
      }))

    return json(res, 200, { original: paragraph, action, variants })
  } catch (err: any) {
    return json(res, 200, { original: paragraph, action, variants: [] })
  }
}

async function handleAutocomplete(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = JSON.parse(await readBody(req) || '{}')
  const paragraphText = typeof body.paragraphText === 'string' ? body.paragraphText.trim() : ''
  const fullContext = typeof body.fullContext === 'string' ? body.fullContext : ''

  if (!paragraphText) {
    return json(res, 400, { error: 'paragraphText is required' })
  }

  if (paragraphText.length < 4) {
    return json(res, 200, { completion: '' })
  }

  const lastChar = paragraphText[paragraphText.length - 1]
  if ('。！？!?；;\n'.includes(lastChar)) {
    return json(res, 200, { completion: '' })
  }

  try {
    const result = await callDashScope([
      {
        role: 'system',
        content:
          '你是一个中文写作自动补全助手。根据用户正在输入的段落，预测接下来最自然的 5-20 个字。只输出 JSON：{"completion":"续写内容"}。不要重复原文，不要解释。如果原文已经像完整句子，返回空字符串。',
      },
      {
        role: 'user',
        content: `当前段落：\n${paragraphText}\n\n全文风格参考：\n${fullContext.slice(0, 800)}\n\n只返回 JSON。`,
      },
    ], true, 0.45)

    const completion = typeof result?.completion === 'string' ? result.completion.trim() : ''
    return json(res, 200, { completion })
  } catch {
    return json(res, 200, { completion: '' })
  }
}

// ─── Web Search ───

async function handleWebSearch(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const body = parseJson(await readBody(req))
    const query = String(body.query || '').trim()
    const limit = typeof body.limit === 'number' ? body.limit : 8

    if (!query) return json(res, 400, { error: 'query is required' })

    const result = await callDeepSeek([
      {
        role: 'system',
        content: `你是一个搜索助手。根据用户的查询，返回相关的搜索结果。返回 JSON 格式：{"results": [{"title": "标题", "url": "https://...", "snippet": "简短描述"}]}。返回 ${limit} 条结果。URL 必须是真实存在的网站地址。`,
      },
      {
        role: 'user',
        content: query,
      },
    ])

    const results = Array.isArray(result?.results) ? result.results : []
    return json(res, 200, { results: results.slice(0, limit) })
  } catch {
    return json(res, 200, { results: [] })
  }
}

// ─── Fetch URL ───

async function handleFetchUrl(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const body = parseJson(await readBody(req))
    const url = String(body.url || '').trim()

    if (!url) return json(res, 400, { error: 'url is required' })

    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RevisionLens/1.0)' },
    })
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`)

    const html = await response.text()

    // Extract title
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is)
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : url

    // Strip HTML to plain text (simple approach)
    const textContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    // Build simple HTML for reader
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/is)
    const htmlContent = bodyMatch
      ? bodyMatch[1]
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      : `<p>${textContent.slice(0, 50000)}</p>`

    return json(res, 200, {
      title,
      content: textContent.slice(0, 200000),
      htmlContent: htmlContent.slice(0, 200000),
    })
  } catch (err: any) {
    return json(res, 500, { error: err.message || 'Failed to fetch URL' })
  }
}

// ─── SSE Streaming ───

async function streamLLMResponse(
  messages: { role: string; content: string }[],
  res: http.ServerResponse,
  options: { provider: 'dashscope' | 'deepseek'; maxTokens?: number },
) {
  const url = options.provider === 'deepseek'
    ? 'https://api.deepseek.com/v1/chat/completions'
    : 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

  const apiKey = options.provider === 'deepseek' ? DEEPSEEK_API_KEY : DASHSCOPE_API_KEY
  const model = options.provider === 'deepseek' ? DEEPSEEK_MODEL : DASHSCOPE_MODEL

  const payload: Record<string, unknown> = {
    model,
    temperature: 0.6,
    stream: true,
    messages,
  }
  if (options.maxTokens) payload.max_tokens = options.maxTokens

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90_000),
  })

  if (!response.ok) {
    throw new Error(`${options.provider} error ${response.status}`)
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') {
          res.write('data: [DONE]\n\n')
          return
        }
        try {
          const parsed = JSON.parse(data)
          const content = parsed.choices?.[0]?.delta?.content
          if (content) {
            res.write(`data: ${JSON.stringify({ content })}\n\n`)
          }
        } catch {
          // Skip malformed JSON chunks
        }
      }
    }
    res.write('data: [DONE]\n\n')
  } finally {
    reader.releaseLock()
  }
}

// ─── Source Chat ───

async function handleSourceChat(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const body = parseJson(await readBody(req))
    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    if (!message) return json(res, 400, { error: 'message is required' })

    const mode = body?.mode === 'long' ? 'long' : 'quick'
    const sourceContext = String(body?.sourceContext || '').slice(0, 6000)
    const articleContext = String(body?.articleContext || '').slice(0, 1500)

    const filteredHistory = (Array.isArray(body.history) ? body.history : [])
      .slice(-10)
      .filter((m: any) => {
        if (m.role !== 'assistant') return true
        const c = String(m.content || '')
        return !c.startsWith('请求失败') && !c.startsWith('生成失败') && !c.startsWith('请配置 API Key')
      })

    const systemPrompt = `你是一个专业的写作助手。用户正在撰写一篇文章，你可以基于用户提供的参考资料来帮助写作。

规则：
- 用简洁清晰的中文回应
- 如果用户要求写文章/段落/大纲，直接生成可用的内容，不要写多余的说明
- 如果用户提问，基于参考资料回答
- 如果没有相关资料，基于你的知识回答并说明
- 生成的文章内容应该是可直接使用的，不需要用户再修改格式`

    const messages: { role: string; content: string }[] = [
      { role: 'system', content: systemPrompt },
    ]

    if (sourceContext) {
      messages.push({ role: 'system', content: `参考资料：\n${sourceContext}` })
    }

    for (const m of filteredHistory) {
      messages.push({ role: m.role, content: m.content })
    }

    const currentContent = articleContext
      ? `[当前文章内容]\n${articleContext}\n\n${message}`
      : message
    messages.push({ role: 'user', content: currentContent })

    const useStream = body?.stream === true

    // Streaming path
    if (useStream) {
      const provider: 'dashscope' | 'deepseek' = (mode === 'long' && DEEPSEEK_API_KEY) ? 'deepseek' : 'dashscope'
      if ((provider === 'deepseek' && !DEEPSEEK_API_KEY) || (provider === 'dashscope' && !DASHSCOPE_API_KEY)) {
        return json(res, 501, { error: '请配置 API Key 后使用写作助手功能。' })
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      })
      try {
        await streamLLMResponse(messages, res, {
          provider,
          maxTokens: mode === 'long' ? 2500 : undefined,
        })
      } catch (err: any) {
        const errMsg = err?.message || 'Stream failed'
        res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`)
        res.write('data: [DONE]\n\n')
      }
      res.end()
      return
    }

    // Non-streaming path (backward compatible)
    let reply: string

    if (mode === 'long' && DEEPSEEK_API_KEY) {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          temperature: 0.6,
          max_tokens: 2500,
          messages,
        }),
        signal: AbortSignal.timeout(90_000),
      })
      if (!response.ok) throw new Error(`DeepSeek error ${response.status}`)
      const data = await response.json()
      reply = data?.choices?.[0]?.message?.content || ''
    } else if (DASHSCOPE_API_KEY) {
      reply = await callDashScope(messages, false, 0.6) as string
    } else {
      reply = '请配置 API Key 后使用写作助手功能。'
    }

    reply = String(reply || '').trim()
    if (!reply) reply = '我没有生成有效回复，请重试。'

    return json(res, 200, { reply })
  } catch {
    return json(res, 200, { reply: '生成失败，请重试。' })
  }
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

  // Endpoints that only need DEEPSEEK_API_KEY
  const deepseekOnlyRoutes = ['/api/revision/ghost-scan', '/api/revision/intent-map', '/api/revision/coherence-agent', '/api/revision/canvas-action', '/api/revision/canvas-chat', '/api/revision/web-search', '/api/revision/fetch-url', '/api/revision/source-chat']

  if (!deepseekOnlyRoutes.includes(req.url ?? '') && !DASHSCOPE_API_KEY) {
    return json(res, 500, { error: 'DASHSCOPE_API_KEY is not configured in .env' })
  }

  try {
    if (req.url === '/api/revision/analyze') {
      await handleAnalyze(req, res)
    } else if (req.url === '/api/revision/rewrite') {
      await handleRewrite(req, res)
    } else if (req.url === '/api/revision/clean-transcript') {
      await handleCleanTranscript(req, res)
    } else if (req.url === '/api/revision/autocomplete') {
      await handleAutocomplete(req, res)
    } else if (req.url === '/api/revision/transcribe') {
      await handleTranscribe(req, res)
    } else if (req.url === '/api/revision/ghost-scan') {
      await handleGhostScan(req, res)
    } else if (req.url === '/api/revision/intent-map') {
      await handleIntentMap(req, res)
    } else if (req.url === '/api/revision/coherence-agent') {
      await handleCoherenceAgent(req, res)
    } else if (req.url === '/api/revision/canvas-action') {
      await handleCanvasAction(req, res)
    } else if (req.url === '/api/revision/canvas-chat') {
      await handleCanvasChat(req, res)
    } else if (req.url === '/api/revision/web-search') {
      await handleWebSearch(req, res)
    } else if (req.url === '/api/revision/fetch-url') {
      await handleFetchUrl(req, res)
    } else if (req.url === '/api/revision/source-chat') {
      await handleSourceChat(req, res)
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
