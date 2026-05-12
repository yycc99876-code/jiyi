export const config = {
  api: {
    bodyParser: false,
  },
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

  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  const body = Buffer.concat(chunks)

  const contentType = req.headers['content-type'] || ''
  const boundaryMatch = contentType.match(/boundary=(.+)/i)
  if (!boundaryMatch) {
    res.status(400).json({ error: 'Missing multipart boundary' })
    return
  }

  const boundary = boundaryMatch[1]
  const parts = body.toString('binary').split(`--${boundary}`)

  let audioBuffer: Buffer | null = null
  let mimeType = 'audio/webm'

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n')
    if (headerEnd === -1) continue

    const header = part.slice(0, headerEnd)
    const filenameMatch = header.match(/filename="(.+?)"/i)
    const mimeMatch = header.match(/Content-Type:\s*(.+?)\r\n/i)

    if (filenameMatch) {
      const rawBody = part.slice(headerEnd + 4)
      const cleanBody = rawBody.endsWith('\r\n') ? rawBody.slice(0, -2) : rawBody
      audioBuffer = Buffer.from(cleanBody, 'binary')
      mimeType = mimeMatch?.[1]?.trim() || 'audio/webm'
      break
    }
  }

  if (!audioBuffer) {
    res.status(400).json({ error: 'No audio file found in request' })
    return
  }

  const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : 'wav'
  const fileBlob = new Blob([audioBuffer], { type: mimeType })
  const form = new FormData()
  form.append('file', fileBlob, `audio.${ext}`)
  form.append('model', 'paraformer-v2')

  const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })

  if (!response.ok) {
    const errText = await response.text()
    res.status(502).json({ error: `语音识别服务错误: ${response.status} ${errText}` })
    return
  }

  const data = await response.json()
  res.status(200).json({ text: data?.text || '' })
}
