import type { CanvasChatRequest, CanvasChatResponse, CanvasSuggestion } from '../../src/services/ai/coherenceTypes'

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

function fallbackSuggestions(message: string): CanvasSuggestion[] {
  const topic = message.trim().slice(0, 40) || '这篇文章'
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

  const body: CanvasChatRequest = await req.json()
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) {
    return Response.json({ error: 'message is required' }, { status: 400 })
  }

  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) {
    return Response.json({
      reply: '我先给你拆一个可以放到画布上的草稿方向。',
      suggestions: fallbackSuggestions(message),
    } satisfies CanvasChatResponse)
  }

  try {
    const history = Array.isArray(body.history)
      ? body.history.slice(-8).map((m) => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`).join('\n')
      : ''

    const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen-turbo',
        temperature: 0.45,
        response_format: { type: 'json_object' },
        messages: [
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
              `当前文章上下文：\n${body.articleContext?.slice(0, 1800) || '无'}\n\n` +
              '返回格式：{"reply":"一句简短回应","suggestions":[{"type":"note/outline/draft/question","title":"标题","content":"内容","actionLabel":"放到画布或补全正文"}]}',
          },
        ],
      }),
      signal: AbortSignal.timeout(55_000),
    })

    if (!response.ok) {
      throw new Error(`model ${response.status}`)
    }

    const data = await response.json()
    const content: string = data?.choices?.[0]?.message?.content ?? ''
    const parsed = content ? parseJson(content) : null
    const rawSuggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions : []
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

    return Response.json({
      reply: typeof parsed?.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim() : '我给你整理了几个草稿方向。',
      suggestions: suggestions.length > 0 ? suggestions : fallbackSuggestions(message),
    } satisfies CanvasChatResponse)
  } catch {
    return Response.json({
      reply: '模型暂时没有返回，我先给你一个可用的草稿起点。',
      suggestions: fallbackSuggestions(message),
    } satisfies CanvasChatResponse)
  }
}
