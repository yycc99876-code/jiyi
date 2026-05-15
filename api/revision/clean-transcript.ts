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

  const { text, terms } = req.body ?? {}
  if (!text || typeof text !== 'string') {
    res.status(400).json({ error: 'text is required' })
    return
  }

  let cleaned: string
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    try {
      const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'qwen-turbo',
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content:
                '你是语音转文字校正助手。用户通过语音输入了一段话，识别结果可能有错别字、同音字、英文术语识别错误等问题。请：1）修正明显的错别字和同音字；2）校正技术术语（如 cloud code→Claude Code，code x→Codex，open ai→OpenAI）；3）补充缺失的标点符号；4）整理成通顺的书面文字。保留用户核心意思，不要扩写，不要解释，只返回整理后的文字。',
            },
            {
              role: 'user',
              content: `常见术语：${Array.isArray(terms) ? terms.join('、') : 'Claude Code、Codex、ChatGPT、OpenAI、Vercel、GitHub'}\n\n请整理这段语音转文字的内容：\n\n${text}`,
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
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    cleaned = text
  }

  res.status(200).json({
    raw: text,
    cleaned: cleanRewrittenText(cleaned, text),
  })
}
