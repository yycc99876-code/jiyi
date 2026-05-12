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
    text = draftMatch?.[1]?.trim() || original
  }

  return text || original
}

async function callDashScopeJson(messages: { role: string; content: string }[], temperature = 0.35) {
  const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.DASHSCOPE_MODEL || 'qwen3.6-plus',
      temperature,
      response_format: { type: 'json_object' },
      messages,
    }),
  })

  if (!response.ok) {
    throw new Error(`DashScope error ${response.status}: ${await response.text()}`)
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('Empty model response')
  return parseJson(content)
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  if (!process.env.DASHSCOPE_API_KEY) {
    res.status(501).json({ error: 'DASHSCOPE_API_KEY is not configured' })
    return
  }

  const { selectedText, userInstruction } = req.body ?? {}

  if (!selectedText || typeof selectedText !== 'string') {
    res.status(400).json({ error: 'selectedText is required' })
    return
  }

  const instruction =
    typeof userInstruction === 'string' && userInstruction.trim() ? userInstruction.trim() : '让表达更自然'

  let intent
  try {
    const parsedIntent = await callDashScopeJson([
      {
        role: 'system',
        content:
          '你是一个写作意图解析器。根据用户的中文自然语言修改指令，提取结构化的改写意图。只返回严格 JSON，不要解释。',
      },
      {
        role: 'user',
        content: `用户选中的文本：\n${selectedText}\n\n用户的修改指令：\n${instruction}\n\n返回格式：{"goal":"rewrite","tone":"natural/formal/casual/persuasive","style":"professional/conversational/academic/creative","audience":"目标读者","length":"shorter/same/longer","preserve_meaning":true,"rewrite_strength":0.6}`,
      },
    ])
    intent = normalizeIntent(parsedIntent)
  } catch {
    intent = normalizeIntent({})
  }

  let rewriteObject: any
  try {
    rewriteObject = await callDashScopeJson(
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
      0.45,
    )
  } catch {
    res.status(502).json({ error: '模型调用失败，请稍后重试' })
    return
  }

  res.status(200).json({
    original: selectedText,
    rewritten: cleanRewrittenText(rewriteObject?.rewritten ?? rewriteObject, selectedText),
    intent,
  })
}
