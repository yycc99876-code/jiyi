export interface IntentNode {
  id: string
  label: string
  paragraph: string
  strength: 'strong' | 'medium' | 'weak'
}

export interface IntentEdge {
  from: string
  to: string
  relation: 'supports' | 'contradicts' | 'extends' | 'weakens'
}

export interface IntentMap {
  nodes: IntentNode[]
  edges: IntentEdge[]
  summary: string
}

export async function buildIntentMap(fullText: string): Promise<IntentMap> {
  const res = await fetch('/api/revision/intent-map', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullText }),
  })

  if (!res.ok) throw new Error(`Intent map failed: ${res.status}`)
  return res.json()
}
