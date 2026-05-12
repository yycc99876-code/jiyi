function cleanRewrittenText(raw: unknown, original: string) {
  let text =
    typeof raw === 'string'
      ? raw
      : typeof (raw as any)?.text === 'string'
        ? (raw as any).text
        : JSON.stringify(raw)

  text = text
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim()

  return text || original
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

  const { text } = req.body ?? {}
  if (!text || typeof text !== 'string') {
    res.status(400).json({ error: 'text is required' })
    return
  }

  let cleaned: string
  try {
    const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.DASHSCOPE_MODEL || 'qwen3.6-plus',
        temperature: 0.3,
        messages: [
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
      }),
    })

    if (!response.ok) {
      cleaned = text
    } else {
      const data = await response.json()
      cleaned = data?.choices?.[0]?.message?.content || text
    }
  } catch {
    cleaned = text
  }

  res.status(200).json({
    raw: text,
    cleaned: cleanRewrittenText(cleaned, text),
  })
}
