export interface RevisionIntent {
  goal: 'rewrite'
  tone: string
  style: string
  audience: string
  length: string
  preserve_meaning: boolean
  rewrite_strength: number
}

const labelMap: Record<string, string> = {
  tone: '语气',
  style: '风格',
  audience: '受众',
  length: '长度',
  preserve_meaning: '保意',
  rewrite_strength: '强度',
}

export function intentLabel(key: string): string {
  return labelMap[key] ?? key
}

export function intentDisplayValue(key: string, value: unknown): string {
  if (key === 'preserve_meaning') return value ? '是' : '否'
  if (key === 'rewrite_strength') return `${Math.round((value as number) * 100)}%`
  return String(value)
}

export async function parseIntent(
  selectedText: string,
  userInstruction: string,
): Promise<RevisionIntent> {
  const res = await fetch('/api/revision/rewrite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selectedText, userInstruction, stage: 'intent' }),
  })

  if (!res.ok) throw new Error(`Intent parse failed: ${res.status}`)
  return res.json()
}
