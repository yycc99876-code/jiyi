export async function requestAutocomplete(paragraphText: string, fullContext: string): Promise<string> {
  try {
    const res = await fetch('/api/revision/autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paragraphText, fullContext }),
    })

    if (!res.ok) return ''
    const data = await res.json()
    return typeof data?.completion === 'string' ? data.completion : ''
  } catch {
    return ''
  }
}
