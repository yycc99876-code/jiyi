export interface CleanResult {
  raw: string
  cleaned: string
}

export async function cleanTranscript(raw: string): Promise<CleanResult> {
  const res = await fetch('/api/revision/clean-transcript', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: raw }),
  })

  if (!res.ok) throw new Error(`Clean failed: ${res.status}`)
  return res.json()
}
