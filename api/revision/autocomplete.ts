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

  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) {
    res.status(501).json({ error: 'DASHSCOPE_API_KEY is not configured' })
    return
  }

  const { paragraphText, fullContext } = req.body ?? {}
  if (!paragraphText || typeof paragraphText !== 'string') {
    res.status(400).json({ error: 'paragraphText is required' })
    return
  }

  // Don't complete very short text or text that ends with punctuation
  if (paragraphText.length < 4) {
    res.status(200).json({ completion: '' })
    return
  }

  const lastChar = paragraphText[paragraphText.length - 1]
  if ('。！？.!?\n'.includes(lastChar)) {
    res.status(200).json({ completion: '' })
    return
  }

  try {
    const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen-turbo',
        temperature: 0.6,
        max_tokens: 60,
        messages: [
          {
            role: 'system',
            content:
              '你是一个文本续写助手。根据用户正在输入的段落，预测接下来最可能的 5-20 个字。只输出续写内容，不输出原文。续写要自然衔接，保持原文语气和风格。如果原文是一个完整的句子或段落（以句号、感叹号、问号结尾），返回空字符串。只返回 JSON：{"completion":"续写内容"}',
          },
          {
            role: 'user',
            content: `当前段落：\n${paragraphText}\n\n全文（仅供风格参考）：\n${(fullContext || '').slice(0, 800)}\n\n只返回 JSON，不要输出其他内容。`,
          },
        ],
      }),
    })

    if (!response.ok) {
      res.status(200).json({ completion: '' })
      return
    }

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content

    if (!content) {
      res.status(200).json({ completion: '' })
      return
    }

    const result = parseJson(content)
    const completion = typeof result?.completion === 'string' ? result.completion.trim() : ''
    res.status(200).json({ completion })
  } catch {
    res.status(200).json({ completion: '' })
  }
}
