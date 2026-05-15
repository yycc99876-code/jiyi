import { useState, useEffect, useRef, useCallback } from 'react'
import type { Editor } from '@tiptap/react'
import type {
  ArgumentGraph,
  StructuralNudge,
  CoherenceGhostSuggestion,
  CoherenceAgentResponse,
  GraphParagraph,
  DecisionRecord,
} from '../services/ai/coherenceTypes'

// ---------------------------------------------------------------------------
// Scan stages for the UI to display
// ---------------------------------------------------------------------------
export type ScanStage = 'idle' | 'preparing' | 'requesting' | 'parsing' | 'done' | 'error'

interface CoherenceState {
  graph: ArgumentGraph | null
  nudges: StructuralNudge[]
  coherenceGhostSuggestions: CoherenceGhostSuggestion[]
  isEnabled: boolean
  isScanning: boolean
  scanStage: ScanStage
  scanError: string | null
  lastScannedAt: number | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractParagraphs(editor: Editor): GraphParagraph[] {
  const paragraphs: GraphParagraph[] = []
  const doc = editor.state.doc

  doc.nodesBetween(0, doc.content.size, (node, pos) => {
    if (!node.isBlock) return true
    if (node.type.name === 'doc') return true

    const text = node.textContent.trim()
    if (!text) return true

    const isHeading = node.type.name.startsWith('heading')
    const id = `p_${pos}`

    paragraphs.push({
      id,
      text,
      heading: isHeading ? text : undefined,
    })

    return false
  })

  if (paragraphs.length < 2) {
    const fullText = editor.getText({ blockSeparator: '\n' }).trim()
    const fallbackChunks = splitTextForScan(fullText)
    if (fallbackChunks.length >= 2) {
      return fallbackChunks.map((text, index) => ({
        id: `auto_${index}`,
        text,
        heading: index === 0 && text.length <= 80 ? text : undefined,
      }))
    }
  }

  return paragraphs
}

function splitTextForScan(text: string): string[] {
  if (text.length < 80) return []

  const lineChunks = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 12)

  if (lineChunks.length >= 2) return lineChunks

  const sentences = text
    .match(/[^。！？!?；;.!?]+[。！？!?；;.!?]?/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) ?? []

  if (sentences.length < 2) return chunkByLength(text)

  const chunks: string[] = []
  let current = ''

  for (const sentence of sentences) {
    const next = current ? `${current}${sentence}` : sentence
    if (next.length < 70) {
      current = next
      continue
    }
    chunks.push(next)
    current = ''
  }

  if (current) {
    if (chunks.length > 0 && current.length < 40) {
      chunks[chunks.length - 1] = `${chunks[chunks.length - 1]}${current}`
    } else {
      chunks.push(current)
    }
  }

  const filtered = chunks.filter((chunk) => chunk.length >= 20)
  return filtered.length >= 2 ? filtered : chunkByLength(text)
}

function chunkByLength(text: string): string[] {
  if (text.length < 120) return []
  const chunks: string[] = []
  for (let index = 0; index < text.length; index += 90) {
    const chunk = text.slice(index, index + 90).trim()
    if (chunk.length >= 30) chunks.push(chunk)
  }
  return chunks.length >= 2 ? chunks : []
}

/** Fast 32-bit hash for per-paragraph change detection */
function simpleHash(text: string): string {
  let h = 0
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0
  }
  return `${h}_${text.length}`
}

/**
 * Full-document signature — a stable hash over ALL paragraph ids+texts.
 * Used to reliably skip unchanged scans even after incremental paragraph
 * hash-map mutations.
 */
function computeDocSignature(paragraphs: GraphParagraph[]): string {
  let h = 0
  for (const p of paragraphs) {
    // Mix paragraph id
    for (let i = 0; i < p.id.length; i++) {
      h = ((h << 5) - h + p.id.charCodeAt(i)) | 0
    }
    // Mix paragraph text
    for (let i = 0; i < p.text.length; i++) {
      h = ((h << 5) - h + p.text.charCodeAt(i)) | 0
    }
  }
  return `${h}_${paragraphs.length}`
}

const SCAN_TIMEOUT_MS = 90_000 // 90 seconds — generous headroom for longer coherence scans

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseCoherenceAgentOptions {
  initialGraph?: ArgumentGraph | null
  initialNudges?: StructuralNudge[]
  resetKey?: string | null
  onGraphUpdate?: (graph: ArgumentGraph, nudges: StructuralNudge[]) => void
}

export default function useCoherenceAgent(
  editor: Editor | null,
  options: UseCoherenceAgentOptions = {},
) {
  const { initialGraph, initialNudges, resetKey, onGraphUpdate } = options

  const [state, setState] = useState<CoherenceState>({
    graph: initialGraph ?? null,
    nudges: initialNudges ?? [],
    coherenceGhostSuggestions: [],
    isEnabled: true,
    isScanning: false,
    scanStage: 'idle',
    scanError: null,
    lastScannedAt: null,
  })

  // Refs
  const paragraphHashRef = useRef<Map<string, string>>(new Map())
  const docSignatureRef = useRef<string | null>(null)
  const graphRef = useRef<ArgumentGraph | null>(initialGraph ?? null)
  const scanIdRef = useRef(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const editorRef = useRef(editor)
  const enabledRef = useRef(true)
  const dismissedNudgesRef = useRef<Set<string>>(new Set())
  const decisionsRef = useRef<DecisionRecord[]>([])
  const abortControllerRef = useRef<AbortController | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Guard: prevent overlapping requests */
  const scanRunningRef = useRef(false)
  const onGraphUpdateRef = useRef(onGraphUpdate)

  useEffect(() => { editorRef.current = editor }, [editor])
  useEffect(() => { graphRef.current = state.graph }, [state.graph])
  useEffect(() => { onGraphUpdateRef.current = onGraphUpdate }, [onGraphUpdate])

  // Reset state when the active document changes.
  useEffect(() => {
    graphRef.current = initialGraph ?? null
    paragraphHashRef.current = new Map()
    docSignatureRef.current = null
    dismissedNudgesRef.current = new Set()
    decisionsRef.current = []
    scanRunningRef.current = false
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setState({
      graph: initialGraph ?? null,
      nudges: initialNudges ?? [],
      coherenceGhostSuggestions: [],
      isEnabled: true,
      isScanning: false,
      scanStage: 'idle',
      scanError: null,
      lastScannedAt: null,
    })
  }, [resetKey])

  // ── Cleanup on unmount ──────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      // Abort in-flight request
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
      // Clear timeout
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      // Clear debounce
      clearTimeout(debounceRef.current)
    }
  }, [])

  // ── recordDecision ──────────────────────────────────────────────────────
  const recordDecision = useCallback((original: string, replacement: string, accepted: boolean, paragraphId?: string) => {
    decisionsRef.current = [
      { original, replacement, accepted, timestamp: Date.now(), paragraphId },
      ...decisionsRef.current,
    ].slice(0, 50)
  }, [])

  // ── Core scan logic ─────────────────────────────────────────────────────
  const scanDocument = useCallback(async (force = false) => {
    const ed = editorRef.current
    if (!ed || !enabledRef.current) return

    // Prevent overlapping requests
    if (scanRunningRef.current) return

    const paragraphs = extractParagraphs(ed)
    if (paragraphs.length < 2) {
      if (force) {
        setState((s) => ({
          ...s,
          isScanning: false,
          scanStage: 'error',
          scanError: '当前正文太短，至少需要两段内容才能生成结构图。',
        }))
      }
      return
    }

    // Full-document signature — skip if unchanged (unless forced)
    const docSig = computeDocSignature(paragraphs)
    if (!force && docSignatureRef.current === docSig && graphRef.current) return

    // Compute per-paragraph hash diff for incremental updates
    const newHashMap = new Map<string, string>()
    const changedIds: string[] = []

    for (const p of paragraphs) {
      const hash = simpleHash(p.text)
      newHashMap.set(p.id, hash)
      const prevHash = paragraphHashRef.current.get(p.id)
      if (prevHash !== hash) {
        changedIds.push(p.id)
      }
    }

    // Check for removed paragraphs
    for (const oldId of paragraphHashRef.current.keys()) {
      if (!newHashMap.has(oldId)) {
        changedIds.push(oldId)
      }
    }

    // Skip if nothing changed (and not forced)
    if (!force && changedIds.length === 0 && graphRef.current) return

    // ── Start scan ──
    scanRunningRef.current = true
    const currentScan = ++scanIdRef.current
    setState((s) => ({
      ...s,
      isScanning: true,
      scanStage: 'preparing',
      scanError: null,
    }))

    // Abort controller for this scan
    const controller = new AbortController()
    abortControllerRef.current = controller

    // Hard timeout
    timeoutRef.current = setTimeout(() => {
      controller.abort()
    }, SCAN_TIMEOUT_MS)

    try {
      setState((s) => ({ ...s, scanStage: 'requesting' }))

      const res = await fetch('/api/revision/coherence-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paragraphs,
          changedParagraphIds: changedIds,
          previousGraph: graphRef.current,
          previousDecisions: decisionsRef.current.slice(0, 20),
        }),
        signal: controller.signal,
      })

      if (currentScan !== scanIdRef.current) return

      if (!res.ok) {
        if (res.status === 501) {
          enabledRef.current = false
          setState((s) => ({
            ...s,
            isEnabled: false,
            isScanning: false,
            scanStage: 'idle',
            scanError: null,
          }))
          return
        }
        throw new Error(`Server responded ${res.status}`)
      }

      setState((s) => ({ ...s, scanStage: 'parsing' }))

      const data: CoherenceAgentResponse = await res.json()

      if (currentScan !== scanIdRef.current) return

      // Commit hashes & signature only on success
      paragraphHashRef.current = newHashMap
      docSignatureRef.current = docSig

      // Filter out dismissed nudges
      const newNudges = data.structuralNudges.filter((n) => {
        const key = `${n.type}_${n.relatedParagraphs.join(',')}`
        return !dismissedNudgesRef.current.has(key)
      })

      setState((s) => ({
        ...s,
        graph: data.graph,
        nudges: newNudges,
        coherenceGhostSuggestions: data.ghostSuggestions,
        isScanning: false,
        scanStage: 'done',
        scanError: null,
        lastScannedAt: Date.now(),
      }))

      // Persist graph to document store
      if (data.graph) {
        onGraphUpdateRef.current?.(data.graph, newNudges)
      }
    } catch (err: unknown) {
      if (currentScan !== scanIdRef.current) return

      const isAbort =
        err instanceof DOMException && err.name === 'AbortError'
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
      // Clean up controller / timeout
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      abortControllerRef.current = null
      scanRunningRef.current = false
    }
  }, [])

  // ── Manual scan / retry ─────────────────────────────────────────────────
  const scanNow = useCallback(() => {
    scanDocument(true)
  }, [scanDocument])

  // ── Subscribe to editor updates with debounce ───────────────────────────
  useEffect(() => {
    if (!editor) return

    const handler = () => {
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => scanDocument(false), 2500)
    }

    editor.on('update', handler)
    return () => {
      editor.off('update', handler)
      clearTimeout(debounceRef.current)
    }
  }, [editor, scanDocument])

  // ── Initial scan when editor is ready ───────────────────────────────────
  useEffect(() => {
    if (!editor) return
    const timer = setTimeout(() => scanDocument(false), 1000)
    return () => clearTimeout(timer)
  }, [editor, scanDocument])

  // ── dismissNudge ────────────────────────────────────────────────────────
  const dismissNudge = useCallback((nudgeKey: string) => {
    setState((s) => {
      dismissedNudgesRef.current.add(nudgeKey)
      return {
        ...s,
        nudges: s.nudges.filter(
          (n) => `${n.type}_${n.relatedParagraphs.join(',')}` !== nudgeKey,
        ),
      }
    })
  }, [])

  // ── challengeEdge / strengthenNode ──────────────────────────────────────
  const challengeEdge = useCallback(
    (_from: string, _to: string) => {
      scanDocument(true)
    },
    [scanDocument],
  )

  const strengthenNode = useCallback(
    (_nodeId: string) => {
      scanDocument(true)
    },
    [scanDocument],
  )

  // ── Return ──────────────────────────────────────────────────────────────
  return {
    graph: state.graph,
    nudges: state.nudges,
    coherenceGhostSuggestions: state.coherenceGhostSuggestions,
    isEnabled: state.isEnabled,
    isScanning: state.isScanning,
    scanStage: state.scanStage,
    scanError: state.scanError,
    lastScannedAt: state.lastScannedAt,
    scanNow,
    dismissNudge,
    challengeEdge,
    strengthenNode,
    recordDecision,
  }
}
