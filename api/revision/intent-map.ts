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

const SYSTEM_PROMPT =
  '你是一个写作意图分析专家。分析用户的文章，提取写作意图——包括写作目标、核心主题、目标受众、语气风格、约束条件。识别这些意图之间的关系。只返回严格 JSON，不要用代码块包裹。'

function buildUserMessage(paragraphs: { id: string; text: string }[]): string {
  const paragraphList = paragraphs.map((p) => `[${p.id}] ${p.text}`).join('\n\n')
  return (
    `文章段落：\n${paragraphList}\n\n` +
    '返回格式：\n' +
    '{\n' +
    '  "nodes": [{"id":"n1","label":"意图标签","type":"goal/theme/audience/tone/constraint","description":"详细描述","confidence":0.0到1.0}],\n' +
    '  "edges": [{"from":"n1","to":"n2","relation":"supports/conflicts/depends/enables"}],\n' +
    '  "summary": "写作意图整体分析",\n' +
    '  "writingGoal": "核心写作目标的一句话概括"\n' +
    '}\n\n' +
    '最多 8 个节点，最多 10 条边。每个 type 至少出现一次。'
  )
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) {
    res.status(200).json({ nodes: [], edges: [], summary: '', writingGoal: '' })
    return
  }

  const { paragraphs } = (req.body ?? {}) as { paragraphs?: { id: string; text: string }[] }

  if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
    res.status(400).json({ error: 'paragraphs is required' })
    return
  }

  let result: any
  try {
    const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen-turbo',
        temperature: 0.3,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(paragraphs) },
        ],
      }),
      signal: AbortSignal.timeout(55_000),
    })

    if (!response.ok) {
      res.status(200).json({ nodes: [], edges: [], summary: '', writingGoal: '' })
      return
    }

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content
    result = content ? parseJson(content) : null
  } catch {
    res.status(200).json({ nodes: [], edges: [], summary: '', writingGoal: '' })
    return
  }

  if (!result) {
    res.status(200).json({ nodes: [], edges: [], summary: '', writingGoal: '' })
    return
  }

  res.status(200).json({
    nodes: Array.isArray(result.nodes) ? result.nodes : [],
    edges: Array.isArray(result.edges) ? result.edges : [],
    summary: typeof result.summary === 'string' ? result.summary : '',
    writingGoal: typeof result.writingGoal === 'string' ? result.writingGoal : '',
  })
}
