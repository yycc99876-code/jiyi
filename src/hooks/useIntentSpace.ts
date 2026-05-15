import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { IntentMap } from '../services/ai/intentMapper'

interface IntentState {
  intentMap: IntentMap | null
  isScanning: boolean
  scanStage: 'idle' | 'preparing' | 'requesting' | 'parsing' | 'done' | 'error'
  scanError: string | null
}

function hashParagraphs(paragraphs: { id: string; text: string }[]): string {
  let h = 0
  for (const p of paragraphs) {
    for (let i = 0; i < p.text.length; i++) {
      h = ((h << 5) - h + p.text.charCodeAt(i)) | 0
    }
  }
  return `${h}_${paragraphs.length}`
}

const SCAN_TIMEOUT_MS = 90_000

export default function useIntentSpace(editor: Editor | null) {
  const [state, setState] = useState<IntentState>({
    intentMap: null,
    isScanning: false,
    scanStage: 'idle',
    scanError: null,
  })

  const abortRef = useRef<AbortController | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastHashRef = useRef<string>('')
  const scanRunningRef = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scanDocument = useCallback(async (force = false) => {
    if (!editor) return
    if (scanRunningRef.current) return

    const paragraphs: { id: string; text: string }[] = []
    editor.state.doc.forEach((node, _offset, index) => {
      const text = node.textContent.trim()
      if (text.length > 0) {
        paragraphs.push({ id: `p_${index}`, text })
      }
    })

    if (paragraphs.length < 2) return

    const hash = hashParagraphs(paragraphs)
    if (!force && hash === lastHashRef.current) return

    scanRunningRef.current = true
    lastHashRef.current = hash

    setState((s) => ({ ...s, isScanning: true, scanStage: 'preparing', scanError: null }))

    const controller = new AbortController()
    abortRef.current = controller
    timeoutRef.current = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS)

    try {
      setState((s) => ({ ...s, scanStage: 'requesting' }))

      const res = await fetch('/api/revision/intent-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paragraphs }),
        signal: controller.signal,
      })

      if (!res.ok) throw new Error(`Server error ${res.status}`)

      setState((s) => ({ ...s, scanStage: 'parsing' }))
      const data: IntentMap = await res.json()

      setState({
        intentMap: data,
        isScanning: false,
        scanStage: 'done',
        scanError: null,
      })
    } catch (err: unknown) {
      const isAbort = err instanceof DOMException && err.name === 'AbortError'
      const errorMsg = isAbort
        ? '扫描超时，请重试'
        : err instanceof Error
          ? err.message
          : '扫描失败'

      setState((s) => ({
        ...s,
        isScanning: false,
        scanStage: 'error',
        scanError: errorMsg,
      }))
    } finally {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      abortRef.current = null
      scanRunningRef.current = false
    }
  }, [editor])

  const scanNow = useCallback(() => scanDocument(true), [scanDocument])

  // Auto-scan on editor changes with debounce
  useEffect(() => {
    if (!editor) return

    const handleUpdate = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => scanDocument(false), 3000)
    }

    editor.on('update', handleUpdate)
    return () => {
      editor.off('update', handleUpdate)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [editor, scanDocument])

  // Initial scan
  useEffect(() => {
    if (!editor) return
    const timer = setTimeout(() => scanDocument(false), 1500)
    return () => clearTimeout(timer)
  }, [editor, scanDocument])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  return {
    intentMap: state.intentMap,
    isScanning: state.isScanning,
    scanStage: state.scanStage,
    scanError: state.scanError,
    scanNow,
  }
}
