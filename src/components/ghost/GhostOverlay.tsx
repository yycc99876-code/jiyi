import { useState, useEffect, useCallback, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { Sparkles } from 'lucide-react'
import { scanParagraph, type GhostSuggestion } from '../../services/ai/ghostScanner'

interface GhostWithRect extends GhostSuggestion {
  rect: { top: number; left: number; width: number; height: number }
  id: string
  paragraphText: string
}

export interface GhostUiSuggestion extends GhostSuggestion {
  id: string
  paragraphText: string
}

export interface GhostConsoleState {
  suggestions: GhostUiSuggestion[]
  activeIndex: number
  loading: boolean
  acceptCurrent: () => void
  acceptSuggestion: (id: string) => void
  ignoreCurrent: () => void
  ignoreSuggestion: (id: string) => void
  clearSuggestions: () => void
  setActiveIndex: (index: number) => void
}

interface Props {
  editor: Editor
  containerRef: React.RefObject<HTMLDivElement | null>
  onStateChange?: (state: GhostConsoleState) => void
}

function getParagraphAtCursor(editor: Editor): HTMLElement | null {
  const { from } = editor.state.selection
  const dom = editor.view.domAtPos(from)
  let node: HTMLElement | null =
    dom.node instanceof HTMLElement ? dom.node : (dom.node.parentElement ?? null)
  while (node) {
    if (node.tagName === 'P' || node.tagName === 'H1' || node.tagName === 'H2' || node.tagName === 'H3') {
      if (editor.view.dom.contains(node)) return node
      return null
    }
    node = node.parentElement
  }
  return null
}

function findGhostRects(paragraph: HTMLElement, original: string, container: HTMLElement) {
  const containerRect = container.getBoundingClientRect()
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
  let fullText = ''
  const textNodes: { node: Text; start: number }[] = []
  while (walker.nextNode()) {
    const tn = walker.currentNode as Text
    textNodes.push({ node: tn, start: fullText.length })
    fullText += tn.textContent ?? ''
  }
  const idx = fullText.indexOf(original)
  if (idx === -1) return null
  let startNode: Text | null = null
  let startOffset = 0
  let endNode: Text | null = null
  let endOffset = 0
  for (const { node, start } of textNodes) {
    const end = start + (node.textContent?.length ?? 0)
    if (!startNode && idx >= start && idx < end) { startNode = node; startOffset = idx - start }
    if (!endNode && idx + original.length > start && idx + original.length <= end) { endNode = node; endOffset = idx + original.length - start }
  }
  if (!startNode || !endNode) return null
  try {
    const range = document.createRange()
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset)
    const rects = range.getClientRects()
    if (rects.length === 0) return null
    const rect = rects[0]
    return {
      top: rect.top - containerRect.top + container.scrollTop,
      left: rect.left - containerRect.left,
      width: rect.width,
      height: rect.height,
    }
  } catch { return null }
}

function extractParagraphText(el: HTMLElement): string {
  return (el.textContent ?? '').trim()
}

export default function GhostOverlay({ editor, containerRef, onStateChange }: Props) {
  const [ghosts, setGhosts] = useState<GhostWithRect[]>([])
  const [activeIdx, setActiveIdx] = useState(-1)
  const [loading, setLoading] = useState(false)
  const cacheRef = useRef<Map<string, GhostSuggestion[]>>(new Map())
  const ignoredKeySetRef = useRef<Set<string>>(new Set())
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const scanIdRef = useRef(0)

  const ghostsRef = useRef<GhostWithRect[]>([])
  const activeIdxRef = useRef(-1)
  const editorRef = useRef(editor)

  useEffect(() => { ghostsRef.current = ghosts }, [ghosts])
  useEffect(() => { activeIdxRef.current = activeIdx }, [activeIdx])
  useEffect(() => { editorRef.current = editor }, [editor])

  const filterSuggestions = useCallback(
    (raw: GhostSuggestion[], paragraphText: string): GhostSuggestion[] => {
      const seen = new Set<string>()
      const result: GhostSuggestion[] = []
      for (const s of raw) {
        const orig = (s.original ?? '').trim()
        const repl = (s.replacement ?? '').trim()
        const reason = (s.reason ?? '').trim()
        const severity: GhostSuggestion['severity'] =
          s.severity === 'minor' || s.severity === 'moderate' || s.severity === 'major'
            ? s.severity
            : 'minor'
        if (!orig || !repl) continue
        if (orig === repl) continue
        if (!paragraphText.includes(orig)) continue
        if (orig.length > 4 && repl.length > orig.length * 2) continue
        const key = `${orig}__${repl}`
        if (ignoredKeySetRef.current.has(key)) continue
        if (seen.has(key)) continue
        seen.add(key)
        result.push({ original: orig, replacement: repl, reason, severity })
        if (result.length >= 3) break
      }
      return result
    },
    [],
  )

  const recalcRects = useCallback(
    (suggestions: GhostSuggestion[], paragraph: HTMLElement) => {
      const container = containerRef.current
      if (!container) return []
      const paraText = extractParagraphText(paragraph)
      const filtered = filterSuggestions(suggestions, paraText)
      return filtered.flatMap((s) => {
        const rect = findGhostRects(paragraph, s.original, container)
        return rect ? [{ ...s, rect, id: `${s.original}__${s.replacement}`, paragraphText: paraText }] : []
      })
    },
    [containerRef, filterSuggestions],
  )

  const doAccept = useCallback((ghost: GhostWithRect) => {
    const ed = editorRef.current
    const view = ed.view
    const { state } = view
    const doc = state.doc
    const search = ghost.original

    // Find the paragraph that produced this suggestion by matching paragraphText
    let paraFrom = -1
    let paraTo = -1
    doc.nodesBetween(0, doc.content.size, (node, pos) => {
      if (paraFrom !== -1) return false
      if (node.isBlock && node.textContent === ghost.paragraphText) {
        paraFrom = pos
        paraTo = pos + node.nodeSize
        return false
      }
      return false
    })

    if (paraFrom === -1) {
      // Paragraph text has changed (user edited) — drop this stale suggestion
      setGhosts((prev) => prev.filter((g) => g.id !== ghost.id))
      setActiveIdx(-1)
      return
    }

    // Search only within that paragraph for the original text
    let foundFrom = -1
    let foundTo = -1

    doc.nodesBetween(paraFrom, paraTo, (node, pos) => {
      if (foundFrom !== -1) return false
      if (!node.isText || !node.text) return
      const idx = node.text.indexOf(search)
      if (idx !== -1) {
        foundFrom = pos + idx
        foundTo = foundFrom + search.length
      }
      return false
    })

    if (foundFrom === -1) {
      // Original text no longer exists in the paragraph — drop the stale suggestion
      setGhosts((prev) => prev.filter((g) => g.id !== ghost.id))
      setActiveIdx(-1)
      return
    }

    const tr = state.tr.insertText(ghost.replacement, foundFrom, foundTo)
    view.dispatch(tr)

    setGhosts((prev) => prev.filter((g) => g.id !== ghost.id))
    setActiveIdx(-1)
    setTimeout(() => scanRef.current(), 300)
  }, [])

  const acceptCurrent = useCallback(() => {
    const g = ghostsRef.current
    const idx = activeIdxRef.current >= 0 ? activeIdxRef.current : 0
    if (idx >= 0 && idx < g.length) doAccept(g[idx])
  }, [doAccept])

  const acceptSuggestion = useCallback((id: string) => {
    const ghost = ghostsRef.current.find((g) => g.id === id)
    if (ghost) doAccept(ghost)
  }, [doAccept])

  const clearSuggestions = useCallback(() => {
    setGhosts([])
    setActiveIdx(-1)
  }, [])

  const ignoreSuggestion = useCallback((id: string) => {
    const ghost = ghostsRef.current.find((g) => g.id === id)
    if (ghost) {
      ignoredKeySetRef.current.add(`${ghost.original}__${ghost.replacement}`)
    }
    setGhosts((prev) => {
      const next = prev.filter((g) => g.id !== id)
      setActiveIdx((i) => (i >= next.length ? Math.max(next.length - 1, -1) : i))
      return next
    })
  }, [])

  const ignoreCurrent = useCallback(() => {
    const g = ghostsRef.current
    const idx = activeIdxRef.current >= 0 ? activeIdxRef.current : 0
    if (idx >= 0 && idx < g.length) {
      ignoreSuggestion(g[idx].id)
    }
  }, [ignoreSuggestion])

  const setActiveIndex = useCallback((index: number) => {
    const max = ghostsRef.current.length - 1
    setActiveIdx(max < 0 ? -1 : Math.min(Math.max(index, 0), max))
  }, [])

  const scanRef = useRef<() => void>(() => {})

  const scanCurrentParagraph = useCallback(async () => {
    const container = containerRef.current
    if (!container) return
    const paragraph = getParagraphAtCursor(editor)
    if (!paragraph) { setGhosts([]); setActiveIdx(-1); return }
    const text = extractParagraphText(paragraph)
    if (text.length < 8) { setGhosts([]); setActiveIdx(-1); return }
    const cached = cacheRef.current.get(text)
    if (cached) { setGhosts(recalcRects(cached, paragraph)); setActiveIdx(-1); return }
    const currentScan = ++scanIdRef.current
    setLoading(true)
    try {
      const result = await scanParagraph(text, editor.getText())
      if (currentScan !== scanIdRef.current) return
      cacheRef.current.set(text, result.suggestions)
      setGhosts(recalcRects(result.suggestions, paragraph))
      setActiveIdx(-1)
    } catch { /* silent */ }
    finally { if (currentScan === scanIdRef.current) setLoading(false) }
  }, [editor, containerRef, recalcRects])

  scanRef.current = scanCurrentParagraph

  useEffect(() => {
    if (!onStateChange) return
    onStateChange({
      suggestions: ghosts.map(({ id, original, replacement, reason, severity, paragraphText }) => ({ id, original, replacement, reason, severity, paragraphText })),
      activeIndex: activeIdx,
      loading,
      acceptCurrent,
      acceptSuggestion,
      ignoreCurrent,
      ignoreSuggestion,
      clearSuggestions,
      setActiveIndex,
    })
  }, [ghosts, activeIdx, loading, onStateChange, acceptCurrent, acceptSuggestion, ignoreCurrent, ignoreSuggestion, clearSuggestions, setActiveIndex])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const g = ghostsRef.current
      if (g.length === 0) return

      if (e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        setActiveIdx((i) => {
          const next = e.shiftKey
            ? (i <= 0 ? g.length - 1 : i - 1)
            : (i + 1) % g.length
          activeIdxRef.current = next
          return next
        })
        // Refocus editor
        requestAnimationFrame(() => editorRef.current?.commands.focus())
        return
      }

      if (e.key === 'Enter') {
        const idx = activeIdxRef.current >= 0 ? activeIdxRef.current : 0
        if (idx >= 0 && idx < g.length) {
          e.preventDefault()
          e.stopPropagation()
          e.stopImmediatePropagation()
          doAccept(g[idx])
          return
        }
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        setGhosts([])
        setActiveIdx(-1)
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [doAccept])

  useEffect(() => {
    const handler = () => {
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(scanCurrentParagraph, 600)
    }
    editor.on('selectionUpdate', handler)
    editor.on('update', handler)
    return () => {
      editor.off('selectionUpdate', handler)
      editor.off('update', handler)
      clearTimeout(debounceRef.current)
    }
  }, [editor, scanCurrentParagraph])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const recalc = () => {
      const paragraph = getParagraphAtCursor(editor)
      if (!paragraph || ghosts.length === 0) return
      const text = extractParagraphText(paragraph)
      const cached = cacheRef.current.get(text)
      if (cached) setGhosts(recalcRects(cached, paragraph))
    }
    container.addEventListener('scroll', recalc, { passive: true })
    window.addEventListener('resize', recalc)
    return () => { container.removeEventListener('scroll', recalc); window.removeEventListener('resize', recalc) }
  }, [editor, containerRef, ghosts.length, recalcRects])

  if (ghosts.length === 0 && !loading) return null

  const activeGhost = activeIdx >= 0 ? ghosts[activeIdx] : null

  return (
    <>
      {ghosts.map((ghost, i) => (
        <div
          key={ghost.id}
          className={`ghost-range ${i === activeIdx ? 'active' : ''} ${ghost.severity}`}
          style={{
            top: ghost.rect.top,
            left: ghost.rect.left,
            minWidth: ghost.rect.width,
            height: ghost.rect.height,
          }}
        >
          {activeGhost?.id === ghost.id && (
            <div className="ghost-inline-preview">
              <span>建议</span>
              <strong>{ghost.replacement}</strong>
            </div>
          )}
        </div>
      ))}

      {loading && (
        <div className="ghost-loading-hint">
          <Sparkles size={13} className="spin" />
          <span>AI 扫描中...</span>
        </div>
      )}

    </>
  )
}
