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
              '你是中文写作编辑。分析用户给定的段落，找出 1-3 个最值得改进的局部问题。只做必要的局部编辑，不要重写整句。每条 original 必须是段落中已有的精确片段，replacement 应简洁，长度不要明显超过 original。避免主观润色，除非能明显提升清晰度或正确性。不允许重复或重叠建议。severity: minor=措辞微调, moderate=表达改进, major=逻辑/结构问题。只返回严格 JSON。',
          },
          {
            role: 'user',
            content: `paragraphText:\n${paragraphText}\n\nfullContext（仅供参考，不要修改）:\n${fullContext || '无'}\n\n返回格式：{"suggestions":[{"original":"原文片段","replacement":"建议替换","reason":"原因","severity":"minor/moderate/major"}]}，最多 3 条。`,
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

  const raw: any[] = Array.isArray(result?.suggestions) ? result.suggestions : []
  const seen = new Set<string>()
  const suggestions = raw
    .map((s: any) => {
      const original = typeof s.original === 'string' ? s.original.trim() : ''
      const replacement = typeof s.replacement === 'string' ? s.replacement.trim() : ''
      const reason = typeof s.reason === 'string' ? s.reason.trim() : ''
      const severity =
        s.severity === 'minor' || s.severity === 'moderate' || s.severity === 'major'
          ? s.severity
          : 'minor'
      return { original, replacement, reason, severity }
    })
    .filter((s) => {
      if (!s.original || !s.replacement) return false
      if (s.original === s.replacement) return false
      if (!paragraphText.includes(s.original)) return false
      if (s.original.length > 4 && s.replacement.length > s.original.length * 2) return false
      const key = `${s.original}__${s.replacement}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 3)

  res.status(200).json({ suggestions })
}
