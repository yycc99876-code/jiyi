import { useState, useEffect, useCallback, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { Sparkles } from 'lucide-react'
import { scanParagraph, type GhostSuggestion } from '../../services/ai/ghostScanner'
import { requestAutocomplete } from '../../services/ai/autocompleteScanner'
import type { CoherenceGhostSuggestion } from '../../services/ai/coherenceTypes'

interface GhostWithRect extends GhostSuggestion {
  rect: { top: number; left: number; width: number; height: number }
  id: string
  paragraphText: string
  isCoherence?: boolean
  argumentContext?: string
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
  coherenceSuggestions?: CoherenceGhostSuggestion[]
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

export default function GhostOverlay({ editor, containerRef, onStateChange, coherenceSuggestions = [] }: Props) {
  const [ghosts, setGhosts] = useState<GhostWithRect[]>([])
  const [activeIdx, setActiveIdx] = useState(-1)
  const [loading, setLoading] = useState(false)
  const paragraphMapRef = useRef<Map<string, GhostSuggestion[]>>(new Map())
  const ignoredKeySetRef = useRef<Set<string>>(new Set())
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const scanIdRef = useRef(0)

  // Autocomplete state
  const [completion, setCompletion] = useState('')
  const [completionRect, setCompletionRect] = useState<{ top: number; left: number; height: number } | null>(null)
  const completionRef = useRef('')
  const autocompleteDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const autocompleteIdRef = useRef(0)
  const completionCacheRef = useRef<Map<string, string>>(new Map())
  const MAX_CACHE_SIZE = 100

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

  const getParagraphTexts = useCallback((): Set<string> => {
    const texts = new Set<string>()
    const ed = editorRef.current
    ed.state.doc.nodesBetween(0, ed.state.doc.content.size, (node) => {
      if (node.isBlock && node.textContent) texts.add(node.textContent.trim())
    })
    return texts
  }, [])

  const cleanupStaleParagraphs = useCallback(() => {
    const liveTexts = getParagraphTexts()
    const map = paragraphMapRef.current
    for (const key of map.keys()) {
      if (!liveTexts.has(key)) map.delete(key)
    }
  }, [getParagraphTexts])

  const buildAllGhosts = useCallback(
    (currentParagraph: HTMLElement | null): GhostWithRect[] => {
      const container = containerRef.current
      const map = paragraphMapRef.current
      const result: GhostWithRect[] = []

      for (const [paraText, suggestions] of map.entries()) {
        const filtered = filterSuggestions(suggestions, paraText)
        const isCurrent = currentParagraph && extractParagraphText(currentParagraph) === paraText

        for (const s of filtered) {
          const id = `${s.original}__${s.replacement}`
          if (ignoredKeySetRef.current.has(`${s.original}__${s.replacement}`)) continue

          if (isCurrent && container) {
            const rect = findGhostRects(currentParagraph, s.original, container)
            if (rect) {
              result.push({ ...s, rect, id, paragraphText: paraText })
            }
          } else {
            result.push({
              ...s,
              id,
              paragraphText: paraText,
              rect: { top: 0, left: 0, width: 0, height: 0 },
            })
          }
        }
      }

      return result
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
      // Paragraph text has changed — remove from map and rebuild
      paragraphMapRef.current.delete(ghost.paragraphText)
      setGhosts(buildAllGhosts(getParagraphAtCursor(ed)))
      setActiveIdx(-1)
      return
    }

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
      paragraphMapRef.current.delete(ghost.paragraphText)
      setGhosts(buildAllGhosts(getParagraphAtCursor(ed)))
      setActiveIdx(-1)
      return
    }

    const tr = state.tr.insertText(ghost.replacement, foundFrom, foundTo)
    view.dispatch(tr)

    // Remove accepted suggestion from paragraph map
    const map = paragraphMapRef.current
    const existing = map.get(ghost.paragraphText)
    if (existing) {
      const filtered = existing.filter((s) => s.original !== ghost.original || s.replacement !== ghost.replacement)
      if (filtered.length > 0) map.set(ghost.paragraphText, filtered)
      else map.delete(ghost.paragraphText)
    }

    setGhosts(buildAllGhosts(getParagraphAtCursor(ed)))
    setActiveIdx(-1)
    setTimeout(() => scanRef.current(), 300)
  }, [buildAllGhosts])

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
    paragraphMapRef.current.clear()
    setGhosts([])
    setActiveIdx(-1)
  }, [])

  const ignoreSuggestion = useCallback((id: string) => {
    const ghost = ghostsRef.current.find((g) => g.id === id)
    if (ghost) {
      ignoredKeySetRef.current.add(`${ghost.original}__${ghost.replacement}`)
      // Remove from paragraph map
      const map = paragraphMapRef.current
      const existing = map.get(ghost.paragraphText)
      if (existing) {
        const filtered = existing.filter((s) => s.original !== ghost.original || s.replacement !== ghost.replacement)
        if (filtered.length > 0) map.set(ghost.paragraphText, filtered)
        else map.delete(ghost.paragraphText)
      }
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

  const coherenceRef = useRef(coherenceSuggestions)
  useEffect(() => { coherenceRef.current = coherenceSuggestions }, [coherenceSuggestions])

  const scanRef = useRef<() => void>(() => {})

  const scanCurrentParagraph = useCallback(async () => {
    const container = containerRef.current
    if (!container) return
    const paragraph = getParagraphAtCursor(editor)
    if (!paragraph) { cleanupStaleParagraphs(); setGhosts(buildAllGhosts(null)); setActiveIdx(-1); return }
    const text = extractParagraphText(paragraph)
    if (text.length < 8) { cleanupStaleParagraphs(); setGhosts(buildAllGhosts(paragraph)); setActiveIdx(-1); return }
    const cached = paragraphMapRef.current.get(text)
    if (cached) { cleanupStaleParagraphs(); setGhosts(buildAllGhosts(paragraph)); setActiveIdx(-1); return }
    const currentScan = ++scanIdRef.current
    setLoading(true)
    try {
      const result = await scanParagraph(text, editor.getText())
      if (currentScan !== scanIdRef.current) return
      paragraphMapRef.current.set(text, result.suggestions)
      cleanupStaleParagraphs()
      setGhosts(buildAllGhosts(paragraph))
      setActiveIdx(-1)
    } catch { /* silent */ }
    finally { if (currentScan === scanIdRef.current) setLoading(false) }
  }, [editor, containerRef, buildAllGhosts, cleanupStaleParagraphs])

  scanRef.current = scanCurrentParagraph

  // ── Autocomplete ──

  const getCursorRect = useCallback((): { top: number; left: number; height: number } | null => {
    const container = containerRef.current
    if (!container) return null
    const { from } = editor.state.selection
    try {
      const coords = editor.view.coordsAtPos(from)
      const containerRect = container.getBoundingClientRect()
      return {
        top: coords.top - containerRect.top + container.scrollTop,
        left: coords.left - containerRect.left,
        height: coords.bottom - coords.top,
      }
    } catch {
      return null
    }
  }, [editor, containerRef])

  const doAutocomplete = useCallback(async () => {
    const paragraph = getParagraphAtCursor(editor)
    if (!paragraph) { setCompletion(''); setCompletionRect(null); return }
    const text = extractParagraphText(paragraph)
    if (text.length < 4) { setCompletion(''); setCompletionRect(null); return }

    // Don't complete if cursor is not at end of paragraph
    const { from, to } = editor.state.selection
    if (from !== to) { setCompletion(''); setCompletionRect(null); return }

    // Check if cursor is near the end of the paragraph
    const paraEnd = editor.state.doc.resolve(from).after(1) - 1
    if (from < paraEnd - 2) { setCompletion(''); setCompletionRect(null); return }

    // Check cache
    const cached = completionCacheRef.current.get(text)
    if (cached !== undefined) {
      setCompletion(cached)
      setCompletionRect(getCursorRect())
      return
    }

    const currentId = ++autocompleteIdRef.current
    try {
      const result = await requestAutocomplete(text, editor.getText())
      if (currentId !== autocompleteIdRef.current) return
      if (completionCacheRef.current.size >= MAX_CACHE_SIZE) {
        const firstKey = completionCacheRef.current.keys().next().value
        if (firstKey !== undefined) completionCacheRef.current.delete(firstKey)
      }
      completionCacheRef.current.set(text, result)
      setCompletion(result)
      setCompletionRect(getCursorRect())
    } catch {
      // silent
    }
  }, [editor, getCursorRect])

  const acceptCompletion = useCallback(() => {
    if (!completionRef.current) return
    const { from } = editor.state.selection
    editor.chain().focus().insertContentAt(from, completionRef.current).run()
    setCompletion('')
    setCompletionRect(null)
    // Clear cache since text changed
    completionCacheRef.current.clear()
  }, [editor])

  // Keep completion ref in sync
  useEffect(() => { completionRef.current = completion }, [completion])

  // Autocomplete debounce: trigger after user pauses typing (1.2s)
  useEffect(() => {
    const handler = () => {
      setCompletion('')
      setCompletionRect(null)
      clearTimeout(autocompleteDebounceRef.current)
      autocompleteDebounceRef.current = setTimeout(doAutocomplete, 1200)
    }
    editor.on('update', handler)
    return () => {
      editor.off('update', handler)
      clearTimeout(autocompleteDebounceRef.current)
    }
  }, [editor, doAutocomplete])

  // Update completion rect on scroll/resize
  useEffect(() => {
    if (!completion) return
    const container = containerRef.current
    if (!container) return
    const recalc = () => setCompletionRect(getCursorRect())
    container.addEventListener('scroll', recalc, { passive: true })
    window.addEventListener('resize', recalc)
    return () => { container.removeEventListener('scroll', recalc); window.removeEventListener('resize', recalc) }
  }, [completion, containerRef, getCursorRect])

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

      // Tab: accept completion if available, otherwise cycle error ghosts
      if (e.key === 'Tab') {
        // Priority 1: accept autocomplete completion
        if (completionRef.current) {
          e.preventDefault()
          e.stopPropagation()
          e.stopImmediatePropagation()
          acceptCompletion()
          requestAnimationFrame(() => editorRef.current?.commands.focus())
          return
        }
        // Priority 2: cycle error ghosts
        if (g.length > 0) {
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
          requestAnimationFrame(() => editorRef.current?.commands.focus())
          return
        }
      }

      // Right arrow at end of paragraph: also accept completion
      if (e.key === 'ArrowRight' && completionRef.current) {
        const { from, to } = editorRef.current.state.selection
        if (from === to) {
          const paraEnd = editorRef.current.state.doc.resolve(from).after(1) - 1
          if (from >= paraEnd - 2) {
            e.preventDefault()
            e.stopPropagation()
            e.stopImmediatePropagation()
            acceptCompletion()
            return
          }
        }
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
        paragraphMapRef.current.clear()
        setGhosts([])
        setActiveIdx(-1)
        setCompletion('')
        setCompletionRect(null)
        return
      }

      // Any other key clears completion (user is still typing)
      if (e.key.length === 1 || e.key === 'Backspace') {
        setCompletion('')
        setCompletionRect(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [doAccept, acceptCompletion])

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
      if (paragraph) setGhosts(buildAllGhosts(paragraph))
    }
    container.addEventListener('scroll', recalc, { passive: true })
    window.addEventListener('resize', recalc)
    return () => { container.removeEventListener('scroll', recalc); window.removeEventListener('resize', recalc) }
  }, [editor, containerRef, buildAllGhosts])

  // Merge coherence suggestions with fast-path ghosts
  const mergedGhosts = [...ghosts]
  const container = containerRef.current
  const currentParagraph = container ? getParagraphAtCursor(editor) : null
  if (currentParagraph && coherenceSuggestions.length > 0) {
    const paraText = extractParagraphText(currentParagraph)
    const existingOriginals = new Set(ghosts.map((g) => g.original))
    for (const cs of coherenceSuggestions) {
      if (!paraText.includes(cs.original)) continue
      if (existingOriginals.has(cs.original)) continue
      const rect = container ? findGhostRects(currentParagraph, cs.original, container) : null
      if (!rect) continue
      mergedGhosts.push({
        ...cs,
        rect,
        id: `coh_${cs.original}__${cs.replacement}`,
        paragraphText: paraText,
        isCoherence: true,
      })
    }
  }

  if (mergedGhosts.length === 0 && !loading) return null

  // Only render underlines for ghosts with valid rects (current paragraph)
  const underlinedGhosts = mergedGhosts.filter((g) => g.rect.width > 0 && g.rect.height > 0)

  return (
    <>
      {underlinedGhosts.map((ghost) => {
        const globalIdx = mergedGhosts.indexOf(ghost)
        const isActive = globalIdx === activeIdx
        return (
          <div
            key={ghost.id}
            className={`ghost-range ${isActive ? 'active' : ''} ${ghost.severity} ${ghost.isCoherence ? 'coherence' : ''}`}
            style={{
              top: ghost.rect.top,
              left: ghost.rect.left,
              minWidth: ghost.rect.width,
              height: ghost.rect.height,
            }}
          >
            {isActive && (
              <span className="ghost-inline-replacement">{ghost.replacement}</span>
            )}
          </div>
        )
      })}

      {/* Autocomplete completion ghost at cursor */}
      {completion && completionRect && (
        <div
          className="ghost-completion"
          style={{
            top: completionRect.top,
            left: completionRect.left,
            height: completionRect.height,
          }}
        >
          {completion}
        </div>
      )}

      {loading && (
        <div className="ghost-loading-hint">
          <Sparkles size={13} className="spin" />
          <span>AI 扫描中...</span>
        </div>
      )}

      {(mergedGhosts.length > 0 || completion) && (
        <div className="ghost-kbd-hint">
          {completion && <><kbd>Tab</kbd> 接受补全 </>}
          {mergedGhosts.length > 0 && <><kbd>Tab</kbd> 切换建议 <kbd>Enter</kbd> 接受</>}
        </div>
      )}
    </>
  )
}
