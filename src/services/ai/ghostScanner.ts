export interface GhostSuggestion {
  original: string
  replacement: string
  reason: string
  severity: 'minor' | 'moderate' | 'major'
}

export interface GhostScanResult {
  suggestions: GhostSuggestion[]
}

export async function scanParagraph(paragraphText: string, fullContext: string): Promise<GhostScanResult> {
  const res = await fetch('/api/revision/ghost-scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paragraphText, fullContext }),
  })

  if (!res.ok) throw new Error(`Ghost scan failed: ${res.status}`)
  return res.json()
}
