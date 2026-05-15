export type RecordingState = 'idle' | 'recording' | 'processing'

declare global {
  interface Window {
    webkitSpeechRecognition: new () => SpeechRecognitionInstance
    SpeechRecognition: new () => SpeechRecognitionInstance
  }
}

interface SpeechRecognitionInstance {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: any) => void) | null
  onerror: ((event: any) => void) | null
  onend: (() => void) | null
}

let recognition: SpeechRecognitionInstance | null = null
let finalTranscript = ''
let latestInterimTranscript = ''
let lastEmittedTranscript = ''
let isRecordingActive = false
let retryCount = 0
let recordingStartTime = 0
const MAX_RETRIES = 2
const MIN_RECORDING_MS = 600

function appendTranscript(base: string, chunk: string) {
  const cleanChunk = chunk.trim()
  if (!cleanChunk) return base
  if (!base.trim()) return cleanChunk
  return `${base.trim()} ${cleanChunk}`
}

function getCombinedTranscript() {
  const combined = appendTranscript(finalTranscript, latestInterimTranscript)
  return (combined || lastEmittedTranscript).trim()
}

export function isVoiceRecordingSupported(): boolean {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)
}

export function startRecording(
  onInterim?: (text: string) => void,
  onError?: (error: string) => void,
): void {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
  recognition = new SpeechRecognition()
  recognition.lang = 'zh-CN'
  recognition.continuous = true
  recognition.interimResults = true
  recognition.maxAlternatives = 3

  finalTranscript = ''
  latestInterimTranscript = ''
  lastEmittedTranscript = ''
  isRecordingActive = true
  retryCount = 0
  recordingStartTime = Date.now()

  recognition.onresult = (event: any) => {
    retryCount = 0
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript
      if (event.results[i].isFinal) {
        finalTranscript = appendTranscript(finalTranscript, transcript)
      } else {
        interim = appendTranscript(interim, transcript)
      }
    }
    latestInterimTranscript = interim
    lastEmittedTranscript = getCombinedTranscript()
    onInterim?.(lastEmittedTranscript)
  }

  recognition.onerror = (event: any) => {
    console.warn('[VoiceInput] error:', event.error)

    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      isRecordingActive = false
      onError?.('麦克风权限被拒绝，请在浏览器设置中允许麦克风访问')
      return
    }

    if (event.error === 'network') {
      if (retryCount < MAX_RETRIES) {
        retryCount++
        return
      }
      isRecordingActive = false
      onError?.('语音识别服务暂时不可用，请稍后重试或直接打字输入')
      return
    }

    if (event.error === 'aborted') return

    isRecordingActive = false
    onError?.(`语音识别出错: ${event.error}`)
  }

  recognition.onend = () => {
    if (isRecordingActive && recognition) {
      try {
        recognition.start()
      } catch {
        // Already started
      }
    }
  }

  try {
    recognition.start()
  } catch (e) {
    console.warn('[VoiceInput] start failed:', e)
    isRecordingActive = false
  }
}

export function getFinalTranscript(): string {
  return getCombinedTranscript()
}

export function getRecordingDuration(): number {
  return recordingStartTime ? Date.now() - recordingStartTime : 0
}

export async function stopRecordingWithMinDuration(): Promise<string> {
  const elapsed = recordingStartTime ? Date.now() - recordingStartTime : 0
  if (elapsed < MIN_RECORDING_MS && isRecordingActive) {
    await new Promise((r) => setTimeout(r, MIN_RECORDING_MS - elapsed))
  }
  return stopRecording()
}

export function stopRecording(): string {
  isRecordingActive = false
  if (recognition) {
    try {
      recognition.stop()
    } catch {
      // Already stopped
    }
    recognition = null
  }
  return getCombinedTranscript()
}

export function cancelRecording(): void {
  isRecordingActive = false
  if (recognition) {
    try {
      recognition.abort()
    } catch {
      // Already stopped
    }
    recognition = null
  }
  finalTranscript = ''
  latestInterimTranscript = ''
  lastEmittedTranscript = ''
}
