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

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    res.status(501).json({ error: 'DEEPSEEK_API_KEY is not configured' })
    return
  }

  const { paragraphText, fullContext } = req.body ?? {}
  if (!paragraphText || typeof paragraphText !== 'string') {
    res.status(400).json({ error: 'paragraphText is required' })
    return
  }

  let result
  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              '你是中文写作编辑。分析用户给定的段落，找出可以改进的地方。对每个改进点，给出原文片段和建议替换文本。保留用户原本语气，不要过度润色。每条 original 必须能在 paragraphText 中完整找到。severity: minor=措辞微调, moderate=表达改进, major=逻辑/结构问题。只返回严格 JSON。',
          },
          {
            role: 'user',
            content: `paragraphText:\n${paragraphText}\n\nfullContext（仅供参考，不要修改）:\n${fullContext || '无'}\n\n返回格式：{"suggestions":[{"original":"原文片段","replacement":"建议替换","reason":"原因","severity":"minor/moderate/major"}]}`,
          },
        ],
      }),
    })

    if (!response.ok) {
      res.status(200).json({ suggestions: [] })
      return
    }

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content
    result = content ? parseJson(content) : { suggestions: [] }
  } catch {
    res.status(200).json({ suggestions: [] })
    return
  }

  const suggestions = Array.isArray(result?.suggestions)
    ? result.suggestions.filter(
        (s: any) =>
          s.original &&
          s.replacement &&
          typeof s.original === 'string' &&
          typeof s.replacement === 'string' &&
          paragraphText.includes(s.original),
      )
    : []

  res.status(200).json({ suggestions })
}
