interface Suggestion {
  original: string
  replacement: string
  reason: string
  severity: 'minor' | 'moderate' | 'major'
}

const HARD_ERROR_RULES: { pattern: string; replacement: string; reason: string; severity: 'moderate' | 'major' }[] = [
  {
    pattern: '更束缚',
    replacement: '更流畅',
    reason: '"束缚"表示限制，不适合搭配"看起来"；此处应为"更流畅"，形容表达顺畅',
    severity: 'major',
  },
  {
    pattern: '帮主',
    replacement: '帮助',
    reason: '错别字：帮主应为帮助',
    severity: 'major',
  },
  {
    pattern: 'dan是',
    replacement: '但是',
    reason: '拼音输入未转换：应为"但是"',
    severity: 'major',
  },
  {
    pattern: '更好的进行',
    replacement: '更好地进行',
    reason: '修饰动词"进行"应用副词"地"而非"的"',
    severity: 'moderate',
  },
]

function detectHardErrors(text: string): Suggestion[] {
  const results: Suggestion[] = []
  for (const rule of HARD_ERROR_RULES) {
    if (text.includes(rule.pattern)) {
      results.push({
        original: rule.pattern,
        replacement: rule.replacement,
        reason: rule.reason,
        severity: rule.severity,
      })
    }
  }
  return results
}

function normalizeSuggestions(items: any[], paragraphText: string): Suggestion[] {
  const seen = new Set<string>()
  const results: Suggestion[] = []

  for (const s of items) {
    const original = typeof s.original === 'string' ? s.original.trim() : ''
    const replacement = typeof s.replacement === 'string' ? s.replacement.trim() : ''
    const reason = typeof s.reason === 'string' ? s.reason.trim() : ''
    const severity =
      s.severity === 'minor' || s.severity === 'moderate' || s.severity === 'major'
        ? s.severity
        : 'minor'

    if (!original || !replacement) continue
    if (original === replacement) continue
    if (!paragraphText.includes(original)) continue
    if (original.length > 4 && replacement.length > original.length * 2) continue

    const key = `${original}__${replacement}`
    if (seen.has(key)) continue
    seen.add(key)

    results.push({ original, replacement, reason, severity })
  }

  return results
}

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

  const { paragraphText, fullContext } = req.body ?? {}
  if (!paragraphText || typeof paragraphText !== 'string') {
    res.status(400).json({ error: 'paragraphText is required' })
    return
  }

  const hardErrors = detectHardErrors(paragraphText)

  let modelRaw: any[] = []
  if (apiKey) {
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
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                '你是中文写作编辑。分析用户给定的段落，找出 1-3 个最值得改进的局部问题。优先发现错别字、搭配错误、拼音/输入法残留等硬性问题，其次才是风格润色。只做必要的局部编辑，不要重写整句。每条 original 必须是段落中已有的精确片段，replacement 应简洁，长度不要明显超过 original。避免主观润色，除非能明显提升清晰度或正确性。不允许重复或重叠建议。severity: minor=措辞微调, moderate=表达改进, major=逻辑/结构/硬性问题。只返回严格 JSON。',
            },
            {
              role: 'user',
              content: `paragraphText:\n${paragraphText}\n\nfullContext（仅供参考，不要修改）:\n${fullContext || '无'}\n\n返回格式：{"suggestions":[{"original":"原文片段","replacement":"建议替换","reason":"原因","severity":"minor/moderate/major"}]}，最多 3 条。`,
            },
          ],
        }),
      })

      if (response.ok) {
        const data = await response.json()
        const content = data?.choices?.[0]?.message?.content
        const result = content ? parseJson(content) : { suggestions: [] }
        modelRaw = Array.isArray(result?.suggestions) ? result.suggestions : []
      }
    } catch {
      // Model call failed; fall through to return hard errors only
    }
  }

  const modelSuggestions = normalizeSuggestions(modelRaw, paragraphText)
  const merged = normalizeSuggestions([...hardErrors, ...modelSuggestions], paragraphText)

  res.status(200).json({ suggestions: merged.slice(0, 3) })
}
