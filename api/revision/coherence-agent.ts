import type { CoherenceAgentRequest, CoherenceAgentResponse, ArgumentGraph, StructuralNudge, CoherenceGhostSuggestion } from '../../src/services/ai/coherenceTypes'

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

function normalizeGraph(raw: any): ArgumentGraph {
  const nodes = Array.isArray(raw?.nodes)
    ? raw.nodes.map((n: any) => ({
        id: String(n.id || ''),
        label: String(n.label || ''),
        paragraph: String(n.paragraph || ''),
        strength: ['strong', 'medium', 'weak'].includes(n.strength) ? n.strength : 'medium',
        role: ['claim', 'evidence', 'counterargument', 'transition', 'conclusion'].includes(n.role)
          ? n.role
          : 'claim',
        evidenceNote: typeof n.evidenceNote === 'string' ? n.evidenceNote : undefined,
      }))
    : []

  const edges = Array.isArray(raw?.edges)
    ? raw.edges.map((e: any) => ({
        from: String(e.from || ''),
        to: String(e.to || ''),
        relation: ['supports', 'contradicts', 'extends', 'weakens', 'unrelated'].includes(e.relation)
          ? e.relation
          : 'unrelated',
        explanation: typeof e.explanation === 'string' ? e.explanation : undefined,
      }))
    : []

  const score = typeof raw?.coherenceScore === 'number'
    ? Math.min(1, Math.max(0, raw.coherenceScore))
    : 0.5

  return { nodes, edges, summary: String(raw?.summary || ''), coherenceScore: score }
}

function normalizeNudges(raw: any): StructuralNudge[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((n: any) => ({
      type: ['contradiction', 'gap', 'redundancy', 'unsupported_claim', 'missing_conclusion'].includes(n.type)
        ? n.type
        : 'gap',
      message: String(n.message || ''),
      relatedParagraphs: Array.isArray(n.relatedParagraphs) ? n.relatedParagraphs.map(String) : [],
      severity: ['low', 'medium', 'high'].includes(n.severity) ? n.severity : 'medium',
    }))
    .filter((n: StructuralNudge) => n.message.length > 0)
}

function normalizeGhostSuggestions(raw: any, paragraphs: { id: string; text: string }[]): CoherenceGhostSuggestion[] {
  if (!Array.isArray(raw)) return []
  const allText = paragraphs.map((p) => p.text).join('\n')
  return raw
    .map((s: any) => {
      const original = typeof s.original === 'string' ? s.original.trim() : ''
      const replacement = typeof s.replacement === 'string' ? s.replacement.trim() : ''
      if (!original || !replacement || original === replacement) return null
      if (!allText.includes(original)) return null
      return {
        original,
        replacement,
        reason: String(s.reason || ''),
        severity: ['minor', 'moderate', 'major'].includes(s.severity) ? s.severity : 'minor',
        argumentContext: typeof s.argumentContext === 'string' ? s.argumentContext : undefined,
      }
    })
    .filter(Boolean) as CoherenceGhostSuggestion[]
}

const SYSTEM_PROMPT = `你是一个中文写作结构编辑，不是代写助手。你的任务是分析文章的论证结构，帮助作者发现逻辑问题。

你需要：
1. 为每个段落识别其在论证中的角色（claim=论点, evidence=论据, counterargument=反论, transition=过渡, conclusion=结论）
2. 评估每个论点的证据强度（strong/medium/weak）
3. 检测段落间的逻辑关系（supports/contradicts/extends/weakens）
4. 发现结构性问题：矛盾、论点缺乏论据、冗余、缺少结论
5. 生成 0-3 条论证层面的幽灵文字建议（不是错别字，那是另一个系统负责的）

只返回严格 JSON，不要输出 Markdown。`

function buildUserMessage(
  paragraphs: { id: string; text: string; heading?: string }[],
  changedParagraphIds: string[],
  previousGraph: ArgumentGraph | null,
  previousDecisions: { original: string; replacement: string; accepted: boolean }[],
): string {
  const paragraphList = paragraphs
    .map((p) => `[${p.id}]${p.heading ? ` (标题: ${p.heading})` : ''} ${p.text}`)
    .join('\n\n')

  let instruction = ''
  if (previousGraph && changedParagraphIds.length > 0 && changedParagraphIds.length <= 2) {
    const changedList = changedParagraphIds.join(', ')
    instruction = `\n\n增量更新模式：以下段落发生了变化：${changedList}。请只重新分析这些段落及其相关的边，保持其他节点不变。返回完整的更新后图谱。`
  }

  let decisionsContext = ''
  if (previousDecisions.length > 0) {
    const rejected = previousDecisions.filter((d) => !d.accepted).slice(0, 10)
    if (rejected.length > 0) {
      decisionsContext = `\n\n用户之前拒绝了这些建议（不要重复类似模式）：\n${rejected.map((d) => `- "${d.original}" → "${d.replacement}"`).join('\n')}`
    }
  }

  return `文章段落：\n${paragraphList}${instruction}${decisionsContext}

返回格式：
{
  "graph": {
    "nodes": [{"id":"p_0","label":"论点摘要","paragraph":"对应段落片段","strength":"strong/medium/weak","role":"claim/evidence/counterargument/transition/conclusion","evidenceNote":"为什么强或弱"}],
    "edges": [{"from":"p_0","to":"p_1","relation":"supports/contradicts/extends/weakens","explanation":"为什么有这个关系"}],
    "summary":"文章整体结构判断",
    "coherenceScore": 0.0到1.0之间的分数
  },
  "ghostSuggestions": [{"original":"原文片段","replacement":"建议替换","reason":"原因","severity":"minor/moderate/major","argumentContext":"这对论证的意义"}],
  "structuralNudges": [{"type":"contradiction/gap/redundancy/unsupported_claim/missing_conclusion","message":"问题描述","relatedParagraphs":["p_0"],"severity":"low/medium/high"}]
}

连贯性评分标准：所有论点都有论据支撑(0.3) + 无矛盾(0.2) + 段落间逻辑流畅(0.2) + 结论覆盖所有论点(0.15) + 无冗余(0.15)。最多3条幽灵建议，最多3条结构提示。`
}

// Simple in-memory cache with 10s TTL
const cache = new Map<string, { data: CoherenceAgentResponse; ts: number }>()
const CACHE_TTL = 10_000

function cacheKey(paragraphs: { id: string; text: string }[]): string {
  return paragraphs.map((p) => `${p.id}:${p.text.slice(0, 40)}`).join('|')
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    res.status(200).json({ graph: null, ghostSuggestions: [], structuralNudges: [] })
    return
  }

  const { paragraphs, changedParagraphIds, previousGraph, previousDecisions } =
    (req.body ?? {}) as CoherenceAgentRequest

  if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
    res.status(400).json({ error: 'paragraphs is required' })
    return
  }

  // Check cache
  const key = cacheKey(paragraphs)
  const cached = cache.get(key)
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    res.status(200).json(cached.data)
    return
  }

  let result: any
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
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildUserMessage(
              paragraphs,
              changedParagraphIds ?? [],
              previousGraph ?? null,
              previousDecisions ?? [],
            ),
          },
        ],
      }),
    })

    if (!response.ok) {
      res.status(200).json({ graph: null, ghostSuggestions: [], structuralNudges: [] })
      return
    }

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content
    result = content ? parseJson(content) : null
  } catch {
    res.status(200).json({ graph: null, ghostSuggestions: [], structuralNudges: [] })
    return
  }

  if (!result) {
    res.status(200).json({ graph: null, ghostSuggestions: [], structuralNudges: [] })
    return
  }

  const response: CoherenceAgentResponse = {
    graph: result.graph ? normalizeGraph(result.graph) : null,
    ghostSuggestions: normalizeGhostSuggestions(result.ghostSuggestions, paragraphs),
    structuralNudges: normalizeNudges(result.structuralNudges),
  }

  cache.set(key, { data: response, ts: Date.now() })

  // Prune old cache entries
  if (cache.size > 50) {
    const now = Date.now()
    for (const [k, v] of cache) {
      if (now - v.ts > CACHE_TTL) cache.delete(k)
    }
  }

  res.status(200).json(response)
}
