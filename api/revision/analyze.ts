const jsonSchemaHint = `{
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

function parseJson(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')

  return JSON.parse(cleaned)
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const apiKey = process.env.DASHSCOPE_API_KEY

  if (!apiKey) {
    res.status(501).json({ error: 'DASHSCOPE_API_KEY is not configured' })
    return
  }

  const { selectedText, fullContext } = req.body ?? {}

  if (!selectedText || typeof selectedText !== 'string') {
    res.status(400).json({ error: 'selectedText is required' })
    return
  }

  const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.DASHSCOPE_MODEL || 'qwen3.6-plus',
      temperature: 0.35,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            '你是一个中文写作编辑，不是代写助手。请诊断用户选中文本的问题，并给出细粒度、可解释、可逐条接受的修改建议。尽量保留用户原本语气，不要重写整段，不要过度润色。每条 revisions.original 必须能在 selectedText 中找到。只返回严格 JSON。',
        },
        {
          role: 'user',
          content: `selectedText:\n${selectedText}\n\nfullContext:\n${fullContext || ''}\n\n请按这个 JSON 结构返回，不要输出 Markdown：\n${jsonSchemaHint}`,
        },
      ],
    }),
  })

  if (!response.ok) {
    res.status(response.status).json({ error: await response.text() })
    return
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content

  if (!content) {
    res.status(502).json({ error: 'Empty model response' })
    return
  }

  try {
    res.status(200).json(parseJson(content))
  } catch {
    res.status(502).json({ error: 'Model response is not valid JSON', raw: content })
  }
}
