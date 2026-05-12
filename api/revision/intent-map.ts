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

  const { fullText } = req.body ?? {}
  if (!fullText || typeof fullText !== 'string') {
    res.status(400).json({ error: 'fullText is required' })
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
              '你是一个文章结构分析专家。分析用户的文章，提取核心论点和它们之间的逻辑关系。每个论点关联到文章中的一个段落片段。只返回严格 JSON。',
          },
          {
            role: 'user',
            content: `文章全文：\n${fullText}\n\n返回格式：{"nodes":[{"id":"n1","label":"论点摘要","paragraph":"对应的段落片段","strength":"strong/medium/weak"}],"edges":[{"from":"n1","to":"n2","relation":"supports/contradicts/extends/weakens"}],"summary":"文章整体结构判断"}`,
          },
        ],
      }),
    })

    if (!response.ok) {
      res.status(200).json({ nodes: [], edges: [], summary: '' })
      return
    }

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content
    result = content ? parseJson(content) : { nodes: [], edges: [], summary: '' }
  } catch {
    res.status(200).json({ nodes: [], edges: [], summary: '' })
    return
  }

  res.status(200).json({
    nodes: Array.isArray(result?.nodes) ? result.nodes : [],
    edges: Array.isArray(result?.edges) ? result.edges : [],
    summary: typeof result?.summary === 'string' ? result.summary : '',
  })
}
