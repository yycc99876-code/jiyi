export type IntentNodeType = 'goal' | 'theme' | 'audience' | 'tone' | 'constraint'

export interface IntentNode {
  id: string
  label: string
  type: IntentNodeType
  description: string
  confidence: number
}

export interface IntentEdge {
  from: string
  to: string
  relation: 'supports' | 'conflicts' | 'depends' | 'enables'
}

export interface IntentMap {
  nodes: IntentNode[]
  edges: IntentEdge[]
  summary: string
  writingGoal: string
}

export async function buildIntentMap(paragraphs: { id: string; text: string }[]): Promise<IntentMap> {
  const res = await fetch('/api/revision/intent-map', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paragraphs }),
  })

  if (!res.ok) throw new Error(`Intent map failed: ${res.status}`)
  return res.json()
}
