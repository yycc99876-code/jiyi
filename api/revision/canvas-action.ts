import type { CanvasActionRequest, CanvasActionResponse } from '../../src/services/ai/coherenceTypes'

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

const ACTION_PROMPTS: Record<string, string> = {
  strengthen:
    '你是中文写作结构编辑。用户给你一个论点段落，你需要生成 2-3 个更强版本。每个版本应该：更有说服力、更具体、逻辑更严密。保留用户的核心观点，不要改变立场。',
  counterargument:
    '你是中文写作结构编辑。用户给你一个论点段落，你需要站在对立面生成 2-3 个有力的反驳论点。每个反驳应该有理有据，不是简单否定。',
  evidence:
    '你是中文写作结构编辑。用户给你一个论点段落，你需要生成 2-3 条可以支撑这个论点的论据。论据应该具体、可信、有说服力。',
  rewrite:
    '你是中文写作编辑。用户给你一个段落，你需要生成 2-3 个改写版本。每个版本保持核心意思，但在表达上有所改进。',
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) {
    return Response.json({ original: '', action: 'rewrite', variants: [] } satisfies CanvasActionResponse)
  }

  try {
    const body: CanvasActionRequest = await req.json()
    const { paragraph, action, context } = body

    if (!paragraph || typeof paragraph !== 'string') {
      return Response.json({ error: 'paragraph is required' }, { status: 400 })
    }
    if (!action || !ACTION_PROMPTS[action]) {
      return Response.json(
        { error: 'action must be one of: strengthen, counterargument, evidence, rewrite' },
        { status: 400 },
      )
    }

    const systemPrompt = ACTION_PROMPTS[action]
    const userMessage = `段落内容：\n${paragraph}\n\n${context ? `文章上下文（仅供参考）：\n${context.slice(0, 2000)}\n\n` : ''}请返回 JSON：\n{\n  "variants": [\n    {"text": "改写内容", "explanation": "为什么这样改"}\n  ]\n}`

    const res = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'qwen-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.5,
        response_format: { type: 'json_object' },
      }),
    })

    if (!res.ok) {
      return Response.json({ original: paragraph, action, variants: [] } satisfies CanvasActionResponse)
    }

    const completion = await res.json()
    const content: string = completion.choices?.[0]?.message?.content ?? ''
    if (!content) {
      return Response.json({ original: paragraph, action, variants: [] } satisfies CanvasActionResponse)
    }

    const data = parseJson(content)
    const rawVariants = Array.isArray(data?.variants) ? data.variants : []
    const variants = rawVariants
      .filter((v: any) => v && typeof v.text === 'string' && v.text.trim())
      .map((v: any, i: number) => ({
        id: `action_${Date.now()}_${i}`,
        text: v.text.trim(),
        explanation: typeof v.explanation === 'string' ? v.explanation : '',
      }))

    return Response.json({ original: paragraph, action, variants } satisfies CanvasActionResponse)
  } catch {
    return Response.json({ original: '', action: 'rewrite', variants: [] } satisfies CanvasActionResponse)
  }
}
