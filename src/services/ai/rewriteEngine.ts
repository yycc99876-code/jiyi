import type { RevisionIntent } from './intentParser'

export interface RewriteResult {
  original: string
  rewritten: string
  intent: RevisionIntent
}

function sanitizeRewrittenText(value: string, original: string) {
  let text = String(value || '')
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim()

  const forbiddenMarkers = [
    'The user wants',
    'The constraints are',
    'Original:',
    'Key concepts',
    'Check constraints',
    'Draft:',
    'PM/Professional phrasing adjustments',
  ]

  if (forbiddenMarkers.some((marker) => text.includes(marker))) {
    const draftMatch = text.match(/(?:Draft|改写后|最终版本)\s*[:：]\s*([\s\S]*?)(?:Check constraints|Output:|Ready\.|$)/i)
    text = draftMatch?.[1]?.trim() || original
  }

  return text || original
}

export async function rewrite(
  selectedText: string,
  userInstruction: string,
): Promise<RewriteResult> {
  const res = await fetch('/api/revision/rewrite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selectedText, userInstruction, stage: 'rewrite' }),
  })

  if (!res.ok) throw new Error(`Rewrite failed: ${res.status}`)
  const data = await res.json()

  return {
    ...data,
    original: data.original || selectedText,
    rewritten: sanitizeRewrittenText(data.rewritten, selectedText),
  }
}
