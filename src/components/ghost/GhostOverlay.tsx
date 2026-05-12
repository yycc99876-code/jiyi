import { useState, useEffect, useCallback, useRef } from 'react'
import { Plugin, PluginKey } from 'prosemirror-state'
import type { Editor } from '@tiptap/react'
import { Sparkles } from 'lucide-react'
import { scanParagraph, type GhostSuggestion } from '../../services/ai/ghostScanner'

interface GhostWithRect extends GhostSuggestion {
  rect: { top: number; left: number; width: number; height: number }
  id: string
}

interface Props {
  editor: Editor
  containerRef: React.RefObject<HTMLDivElement | null>
}

const ghostPluginKey = new PluginKey('ghostOverlay')

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

export default function GhostOverlay({ editor, containerRef }: Props) {
  const [ghosts, setGhosts] = useState<GhostWithRect[]>([])
  const [activeIdx, setActiveIdx] = useState(-1)
  const [loading, setLoading] = useState(false)
  const cacheRef = useRef<Map<string, GhostSuggestion[]>>(new Map())
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const scanIdRef = useRef(0)

  const ghostsRef = useRef<GhostWithRect[]>([])
  const activeIdxRef = useRef(-1)
  const editorRef = useRef(editor)

  useEffect(() => { ghostsRef.current = ghosts }, [ghosts])
  useEffect(() => { activeIdxRef.current = activeIdx }, [activeIdx])
  useEffect(() => { editorRef.current = editor }, [editor])

  const recalcRects = useCallback(
    (suggestions: GhostSuggestion[], paragraph: HTMLElement) => {
      const container = containerRef.current
      if (!container) return []
      return suggestions.flatMap((s) => {
        const rect = findGhostRects(paragraph, s.original, container)
        return rect ? [{ ...s, rect, id: `${s.original}__${s.replacement}` }] : []
      })
    },
    [containerRef],
  )

  // doAccept stored in ref so plugin always calls the latest version
  const doAcceptRef = useRef<(ghost: GhostWithRect) => void>(() => {})
  const scanRef = useRef<() => void>(() => {})

  doAcceptRef.current = (ghost: GhostWithRect) => {
    const ed = editorRef.current
    const { state } = ed
    const doc = state.doc
    let foundFrom = -1
    let foundTo = -1
    doc.nodesBetween(0, doc.content.size, (node, pos) => {
      if (foundFrom !== -1 || !node.isText || !node.text) return false
      const idx = node.text.indexOf(ghost.original)
      if (idx !== -1) { foundFrom = pos + idx; foundTo = foundFrom + ghost.original.length }
      return false
    })
    if (foundFrom === -1) return
    ed.chain().focus().deleteRange({ from: foundFrom, to: foundTo }).insertContentAt(foundFrom, ghost.replacement).run()
    setGhosts((prev) => prev.filter((g) => g.id !== ghost.id))
    setActiveIdx(-1)
    setTimeout(() => scanRef.current(), 300)
  }

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

  // ProseMirror plugin — uses refs, never stale
  useEffect(() => {
    const plugin = new Plugin({
      key: ghostPluginKey,
      props: {
        handleKeyDown(_view, event) {
          const g = ghostsRef.current
          if (g.length === 0) return false

          if (event.key === 'Tab') {
            event.preventDefault()
            setActiveIdx((i) => {
              const next = event.shiftKey
                ? (i <= 0 ? g.length - 1 : i - 1)
                : (i + 1) % g.length
              activeIdxRef.current = next
              return next
            })
            return true
          }

          if (event.key === 'Enter') {
            const idx = activeIdxRef.current
            if (idx >= 0 && idx < g.length) {
              event.preventDefault()
              doAcceptRef.current(g[idx])
              return true
            }
            return false
          }

          if (event.key === 'Escape') {
            event.preventDefault()
            setGhosts([])
            setActiveIdx(-1)
            return true
          }

          return false
        },
      },
    })
    editor.registerPlugin(plugin)
    return () => { editor.unregisterPlugin(ghostPluginKey) }
  }, [editor])

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

  return (
    <>
      {ghosts.map((ghost, i) => (
        <div
          key={ghost.id}
          style={{
            position: 'absolute',
            top: ghost.rect.top,
            left: ghost.rect.left,
            minWidth: ghost.rect.width,
            height: ghost.rect.height,
            pointerEvents: 'none',
            zIndex: 5,
            display: 'flex',
            alignItems: 'flex-end',
          }}
        >
          <div style={{ position: 'absolute', bottom: 0, left: 0, width: ghost.rect.width, height: 2, background: i === activeIdx ? 'var(--accent)' : 'var(--green)', borderRadius: 1, opacity: 0.7 }} />
          <div style={{
            position: 'absolute', bottom: ghost.rect.height + 4, left: 0, whiteSpace: 'nowrap',
            fontSize: '0.92em', lineHeight: 1.3,
            color: i === activeIdx ? 'var(--accent-ink)' : 'var(--green)',
            opacity: i === activeIdx ? 1 : 0.8,
            fontWeight: i === activeIdx ? 600 : 400,
            padding: '1px 4px', borderRadius: 3,
            background: i === activeIdx ? 'rgba(185, 129, 36, 0.12)' : 'transparent',
            pointerEvents: 'none',
          }}>
            {ghost.replacement}
          </div>
        </div>
      ))}

      {loading && (
        <div className="ghost-loading-hint">
          <Sparkles size={13} className="spin" />
          <span>AI 扫描中...</span>
        </div>
      )}

      {ghosts.length > 0 && (() => {
        const paragraph = getParagraphAtCursor(editor)
        const container = containerRef.current
        if (!paragraph || !container) return null
        const pRect = paragraph.getBoundingClientRect()

        return (
          <div
            className="ghost-suggestion-panel"
            style={{ position: 'fixed', top: pRect.bottom + 8, left: pRect.left, zIndex: 999, pointerEvents: 'auto' }}
            tabIndex={-1}
          >
            {ghosts.map((ghost, i) => (
              <button
                key={ghost.id}
                type="button"
                className={`ghost-suggestion-card ${i === activeIdx ? 'active' : ''} ${ghost.severity}`}
                tabIndex={-1}
                onClick={() => doAcceptRef.current(ghost)}
                onMouseEnter={() => setActiveIdx(i)}
              >
                <span className="ghost-severity-dot" />
                <span className="ghost-suggestion-text">{ghost.replacement}</span>
                <span className="ghost-suggestion-reason">{ghost.reason}</span>
              </button>
            ))}
            <div className="ghost-hint">Tab 切换 · Enter 接受 · Esc 关闭</div>
          </div>
        )
      })()}
    </>
  )
}
