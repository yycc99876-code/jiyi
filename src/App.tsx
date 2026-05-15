import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Image from '@tiptap/extension-image'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { TextStyle } from '@tiptap/extension-text-style'
import { FontFamily } from '@tiptap/extension-text-style/font-family'
import { FontSize } from '@tiptap/extension-text-style/font-size'
import Color from '@tiptap/extension-color'
import TextAlign from '@tiptap/extension-text-align'
import Underline from '@tiptap/extension-underline'
import { SlashCommand } from './extensions/slashCommand'
import { ListKeymap } from './extensions/listKeymap'
import { filterSlashCommands } from './components/editor/slashCommands'
import EditorToolbar from './components/editor/EditorToolbar'
import { AnimatePresence, motion } from 'framer-motion'
import { diffWords } from 'diff'
import {
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  Download,
  FilePlus,
  FileText,
  LayoutGrid,
  Loader2,
  Map,
  Moon,
  PenLine,
  Plus,
  RotateCcw,
  Sparkles,
  Sun,
  Target,
  Trash2,
  Upload,
  Wand2,
  X,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import RevisionPanel from './components/revision/RevisionPanel'
import GhostOverlay from './components/ghost/GhostOverlay'
import type { GhostConsoleState } from './components/ghost/GhostOverlay'
import IntentPanel from './components/intent/IntentPanel'
import IntentSpacePanel from './components/intent/IntentSpacePanel'
import ArgumentCanvas from './components/canvas/ArgumentCanvas'
import useCoherenceAgent from './hooks/useCoherenceAgent'
import useIntentSpace from './hooks/useIntentSpace'
import ChickenProgress from './components/loading/ChickenProgress'
import {
  importFile,
  importSourceFile,
  exportTxt,
  exportMarkdown,
  exportDocx,
  exportDoc,
} from './services/file/fileService'
import {
  getAllDocuments,
  getDocument,
  getOrCreateDefault,
  createDocument,
  updateDocument,
  deleteDocument,
  setActiveDocId,
  compact,
} from './services/documentStore'
import type { StoredDocument } from './services/documentStore'
import type { ArgumentGraph, StructuralNudge } from './services/ai/coherenceTypes'
import {
  getSourcesByDocId,
  addSource,
  updateSource,
  deleteSource,
  deleteSourcesByDocId,
  truncateContent,
} from './services/sourceStore'
import type { SourceMaterial } from './services/sourceStore'
import SourceList from './components/sources/SourceList'
import SourceImportMenu from './components/sources/SourceImportMenu'
import SourceReader from './components/sources/SourceReader'
import WebSearchPanel from './components/sources/WebSearchPanel'
import WritingChatPanel from './components/sources/WritingChatPanel'
import type { WritingMessage } from './components/sources/WritingChatPanel'
import { VoiceInputBar, HandsfreeOverlay, emptyVoiceCapsule } from './components/editor/VoiceInputBar'
import type { VoiceCapsuleState } from './components/editor/VoiceInputBar'
import ParticleIntro from './components/effects/ParticleIntro'
import { playVoiceCue } from './services/ai/voiceCue'
import {
  isVoiceRecordingSupported,
  startRecording,
  stopRecording,
  stopRecordingWithMinDuration,
} from './services/ai/voiceInput'
import { cleanTranscript } from './services/ai/transcriptCleaner'

type RevisionStatus = 'pending' | 'accepted' | 'ignored'

type Issue = {
  text: string
  problem: string
  suggestion: string
}

type Revision = {
  id: string
  original: string
  replacement: string
  reason: string
  status: RevisionStatus
}

type Analysis = {
  summary: string
  goals: string[]
  issues: Issue[]
  revisions: Revision[]
}

type SelectionSnapshot = {
  from: number
  to: number
  text: string
}

type HistoryItem = {
  id: string
  createdAt: string
  excerpt: string
  analysis: Analysis
}

const emptyGhostConsole: GhostConsoleState = {
  suggestions: [],
  activeIndex: -1,
  loading: false,
  acceptCurrent: () => {},
  acceptSuggestion: () => {},
  ignoreCurrent: () => {},
  ignoreSuggestion: () => {},
  clearSuggestions: () => {},
  setActiveIndex: () => {},
}

const THEME_KEY = 'revision-lens-theme'
const HISTORY_KEY = 'revision-lens-history'

function getStoredHistory(): HistoryItem[] {
  try {
    return JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? '[]')
  } catch {
    return []
  }
}

function normalizeAnalysis(analysis: Analysis): Analysis {
  return {
    ...analysis,
    revisions: analysis.revisions.map((revision, index) => ({
      ...revision,
      id: revision.id || `rev_${index + 1}`,
      status: revision.status ?? 'pending',
    })),
  }
}

async function requestAnalysis(selectedText: string, fullContext: string): Promise<Analysis> {
  const response = await fetch('/api/revision/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selectedText, fullContext }),
  })

  if (!response.ok) {
    throw new Error(`分析请求失败 (${response.status})`)
  }

  return normalizeAnalysis(await response.json())
}

function findTextRange(editor: Editor, range: SelectionSnapshot, target: string) {
  const doc = editor.state.doc
  const rangeText = doc.textBetween(range.from, range.to, '')
  const startOffset = rangeText.indexOf(target)

  if (startOffset === -1) {
    return null
  }

  const endOffset = startOffset + target.length
  let textOffset = 0
  let from = -1
  let to = -1

  doc.nodesBetween(range.from, range.to, (node, pos) => {
    if (!node.isText || !node.text) {
      return
    }

    const sliceStart = Math.max(0, range.from - pos)
    const sliceEnd = Math.min(node.text.length, range.to - pos)
    const slice = node.text.slice(sliceStart, sliceEnd)
    const segmentStart = textOffset
    const segmentEnd = textOffset + slice.length

    if (from === -1 && startOffset >= segmentStart && startOffset <= segmentEnd) {
      from = pos + sliceStart + (startOffset - segmentStart)
    }

    if (to === -1 && endOffset >= segmentStart && endOffset <= segmentEnd) {
      to = pos + sliceStart + (endOffset - segmentStart)
    }

    textOffset = segmentEnd
  })

  return from > -1 && to > -1 ? { from, to } : null
}

function DiffView({ original, replacement }: { original: string; replacement: string }) {
  return (
    <p className="diff-line">
      {diffWords(original, replacement).map((part, index) => {
        if (part.added) {
          return (
            <mark className="diff-add" key={index}>
              {part.value}
            </mark>
          )
        }

        if (part.removed) {
          return (
            <mark className="diff-remove" key={index}>
              {part.value}
            </mark>
          )
        }

        return <span key={index}>{part.value}</span>
      })}
    </p>
  )
}

function App() {
  const [showIntro, setShowIntro] = useState(true)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [selection, setSelection] = useState<SelectionSnapshot | null>(null)
  const [documents, setDocuments] = useState<StoredDocument[]>([])
  const [activeDocId, setActiveDocIdState] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null)
  const [leftTab, setLeftTab] = useState<'docs' | 'sources' | 'history'>('docs')
  const [sources, setSources] = useState<SourceMaterial[]>([])
  const [leftReaderSource, setLeftReaderSource] = useState<SourceMaterial | null>(null)
  const [importMenuOpen, setImportMenuOpen] = useState(false)
  const [showWebSearch, setShowWebSearch] = useState(false)
  const sourceFileInputRef = useRef<HTMLInputElement>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [darkMode, setDarkMode] = useState(false)
  const [saveState, setSaveState] = useState('已保存')
  const [selectedCount, setSelectedCount] = useState(0)
  const [revisionPanelOpen, setRevisionPanelOpen] = useState(false)
  const [revisionSelection, setRevisionSelection] = useState<SelectionSnapshot | null>(null)
  const [revisionInitialInstruction, setRevisionInitialInstruction] = useState('')
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [autoStartVoice, setAutoStartVoice] = useState(false)
  const [rightTab, setRightTab] = useState<'ghost' | 'intent' | 'coherence' | 'lens' | 'writing'>('ghost')
  const [canvasMode, setCanvasMode] = useState(false)
  const [writingMessages, setWritingMessages] = useState<WritingMessage[]>([])
  const [writingLoading, setWritingLoading] = useState(false)
  const [ghostConsole, setGhostConsole] = useState<GhostConsoleState>(emptyGhostConsole)
  const [voiceCapsule, setVoiceCapsule] = useState<VoiceCapsuleState>(emptyVoiceCapsule)
  const [voiceMode, setVoiceMode] = useState<'idle' | 'hold' | 'handsfree'>('idle')
  const [writingChatInput, setWritingChatInput] = useState('')
  const voiceCapsuleRef = useRef(voiceCapsule)
  const voiceModeRef = useRef(voiceMode)
  const writingAppendRef = useRef<((text: string) => void) | null>(null)
  const handleWritingSendRef = useRef<((message: string, mode: 'quick' | 'long') => Promise<void>) | null>(null)
  const editorCardRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const switchingDocRef = useRef(false)
  const activeDocIdRef = useRef<string | null>(null)

  // Initialize: load document list and active doc
  const activeDoc = documents.find((d) => d.id === activeDocId) ?? null

  // Keep ref in sync for useEditor callbacks (avoids stale closure)
  useEffect(() => { activeDocIdRef.current = activeDocId }, [activeDocId])

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: '先把想法写下来。Revision Lens 会在停顿时浮现幽灵建议，Tab 补全/切换，Enter 接受；输入 / 插入结构，Ctrl 唤起语音。Ctrl+Alt 开启免提...',
      }),
      SlashCommand.configure({
        suggestion: {
          items: ({ query }: { query: string }) => filterSlashCommands(query),
          command: ({ editor, range, props: item }: { editor: any; range: any; props: any }) => {
            // Delete trigger text, then replace the current paragraph with the list
            const { from } = range
            const $from = editor.state.doc.resolve(from)
            const parent = $from.parent
            // If cursor is in an empty-ish paragraph, replace the whole paragraph
            if (parent.type.name === 'paragraph' && parent.content.size <= 1) {
              const startPos = $from.start()
              const endPos = $from.end()
              editor
                .chain()
                .focus()
                .deleteRange({ from: startPos, to: endPos })
                .run()
              item.action(editor.chain().focus()).run()
            } else {
              item.action(editor.chain().focus().deleteRange(range)).run()
            }
            item.onAfterRun?.()
          },
        },
      }),
      Image,
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Underline,
      ListKeymap,
    ],
    content: activeDoc?.content ?? '<p></p>',
    editorProps: {
      attributes: {
        class: 'editor-prose',
      },
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to, empty } = editor.state.selection
      setSelectedCount(empty ? 0 : editor.state.doc.textBetween(from, to, '').trim().length)
    },
    onUpdate: ({ editor }) => {
      if (switchingDocRef.current) return
      setSaveState('保存中')
      const html = editor.getHTML()
      const docId = activeDocIdRef.current
      if (docId) {
        updateDocument(docId, { content: html })
        // Update local documents state
        setDocuments((docs) =>
          docs.map((d) => (d.id === docId ? { ...d, content: html, updatedAt: Date.now() } : d)),
        )
      }
      window.setTimeout(() => setSaveState('已保存'), 280)
    },
  })

  const handleGraphUpdate = useCallback(
    (graph: ArgumentGraph, nudges: StructuralNudge[]) => {
      const docId = activeDocIdRef.current
      if (docId) {
        updateDocument(docId, { graph, nudges })
        setDocuments((docs) =>
          docs.map((d) =>
            d.id === docId ? { ...d, graph, nudges, updatedAt: Date.now() } : d,
          ),
        )
      }
    },
    [],
  )

  const coherence = useCoherenceAgent(editor, {
    initialGraph: activeDoc?.graph ?? null,
    initialNudges: activeDoc?.nudges ?? [],
    resetKey: activeDocId,
    onGraphUpdate: handleGraphUpdate,
  })

  const intentSpace = useIntentSpace(editor)

  // Initialize on mount
  useEffect(() => {
    const { doc } = getOrCreateDefault()
    const docs = getAllDocuments()
    setDocuments(docs)
    setActiveDocIdState(doc.id)
    setActiveDocId(doc.id)
    setSources(getSourcesByDocId(doc.id))
    setHistory(getStoredHistory())
    const savedTheme = window.localStorage.getItem(THEME_KEY)
    setDarkMode(savedTheme ? savedTheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    window.localStorage.setItem(THEME_KEY, darkMode ? 'dark' : 'light')
  }, [darkMode])

  useEffect(() => {
    if (!exportMenuOpen) return
    const close = () => setExportMenuOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [exportMenuOpen])

  useEffect(() => {
    if (!importMenuOpen) return
    const close = () => setImportMenuOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [importMenuOpen])

  // Source material handlers
  const handleSourceFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !activeDocId) return
    try {
      const result = await importSourceFile(file)
      const source = addSource({
        docId: activeDocId,
        type: 'file',
        format: result.format,
        title: result.title,
        content: truncateContent(result.content),
        htmlContent: truncateContent(result.htmlContent),
        originalFileName: result.originalFileName,
        selected: true,
        rawDataBase64: result.rawDataBase64 || undefined,
        mimeType: result.mimeType || undefined,
      })
      if (source) {
        setSources(getSourcesByDocId(activeDocId))
      } else {
        alert('存储空间不足，请删除一些已有资料后重试。')
      }
    } catch (err: any) {
      alert(err.message || '导入失败')
    }
    // Reset input so the same file can be re-selected
    e.target.value = ''
  }

  const handleSourceToggleSelect = (id: string) => {
    const src = sources.find((s) => s.id === id)
    if (!src) return
    updateSource(id, { selected: !src.selected })
    if (activeDocId) setSources(getSourcesByDocId(activeDocId))
  }

  const handleSourceDelete = (id: string) => {
    deleteSource(id)
    if (activeDocId) setSources(getSourcesByDocId(activeDocId))
    if (leftReaderSource?.id === id) {
      setLeftReaderSource(null)
    }
  }

  const handleSourceOpen = (source: SourceMaterial) => {
    setLeftReaderSource(source)
  }

  const handleSourceReaderBack = () => {
    setLeftReaderSource(null)
  }

  const handleWebSearchAdd = (_source: SourceMaterial) => {
    if (activeDocId) {
      setSources(getSourcesByDocId(activeDocId))
    }
  }

  // Build source context for AI
  const buildSourceContext = useCallback((srcs: SourceMaterial[]): string => {
    const MAX_CHARS = 6000
    let total = 0
    const parts: string[] = []
    for (const s of srcs) {
      const part = `【${s.title}】\n${s.content}`
      if (total + part.length > MAX_CHARS) {
        parts.push(part.slice(0, MAX_CHARS - total))
        break
      }
      parts.push(part)
      total += part.length
    }
    return parts.join('\n\n---\n\n')
  }, [])

  // Writing chat handler
  const handleWritingSend = useCallback(async (message: string, mode: 'quick' | 'long') => {
    const userMsg: WritingMessage = {
      id: `wmsg_${Date.now()}`,
      role: 'user',
      content: message,
    }

    let currentMessages: WritingMessage[] = []
    setWritingMessages((prev) => {
      currentMessages = [...prev, userMsg]
      return currentMessages
    })
    setWritingLoading(true)

    try {
      const selectedSrcs = sources.filter((s) => s.selected)
      const sourceContext = buildSourceContext(selectedSrcs)
      const articleContext = editor ? editor.getText().slice(0, 1500) : ''

      const historyToSend = currentMessages
        .slice(-11, -1)
        .filter((m) => !m.isError)
        .map((m) => ({ role: m.role, content: m.content }))

      const res = await fetch('/api/revision/source-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          history: historyToSend,
          sourceContext,
          articleContext,
          mode,
          stream: true,
        }),
      })

      if (!res.ok) throw new Error(`Chat failed: ${res.status}`)

      const contentType = res.headers.get('content-type') || ''

      if (contentType.includes('text/event-stream') && res.body) {
        // Streaming path
        const assistantId = `wmsg_${Date.now()}_a`
        let accumulated = ''

        setWritingMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '' }])

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const data = line.slice(6).trim()
              if (data === '[DONE]') continue

              try {
                const parsed = JSON.parse(data)
                if (parsed.error) throw new Error(parsed.error)
                if (parsed.content) {
                  accumulated += parsed.content
                  setWritingMessages((prev) =>
                    prev.map((m) => (m.id === assistantId ? { ...m, content: accumulated } : m)),
                  )
                }
              } catch (parseErr: any) {
                if (parseErr.message && !parseErr.message.includes('JSON')) throw parseErr
              }
            }
          }
        } finally {
          reader.releaseLock()
        }

        if (!accumulated.trim()) {
          setWritingMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: '生成失败，请重试。', isError: true } : m)),
          )
        }
      } else {
        // Non-streaming fallback
        const data = await res.json()
        const assistantMsg: WritingMessage = {
          id: `wmsg_${Date.now()}_a`,
          role: 'assistant',
          content: data.reply || '生成失败，请重试。',
          isError: !data.reply,
        }
        setWritingMessages((prev) => [...prev, assistantMsg])
      }
    } catch {
      const errMsg: WritingMessage = {
        id: `wmsg_${Date.now()}_e`,
        role: 'assistant',
        content: '请求失败，请检查网络后重试。',
        isError: true,
      }
      setWritingMessages((prev) => [...prev, errMsg])
    } finally {
      setWritingLoading(false)
    }
  }, [sources, editor, buildSourceContext])

  useEffect(() => { handleWritingSendRef.current = handleWritingSend }, [handleWritingSend])

  const writingVoiceKeyHandler = useCallback((e: React.KeyboardEvent) => {
    if (voiceCapsuleRef.current.phase === 'idle') return false
    if (e.code === 'Escape') {
      e.preventDefault()
      stopRecording()
      setVoiceCapsule(emptyVoiceCapsule); setVoiceMode('idle')
      return true
    }
    if (voiceCapsuleRef.current.phase !== 'ready') return false
    if (e.code === 'KeyR' && !voiceCapsuleRef.current.error) {
      e.preventDefault()
      const t = voiceCapsuleRef.current.cleanedText.trim()
      if (t) { handleWritingSendRef.current?.(t, 'quick'); setRightTab('writing'); setVoiceCapsule(emptyVoiceCapsule); setVoiceMode('idle') }
      return true
    }
    if (e.code === 'KeyF') {
      e.preventDefault()
      const t = voiceCapsuleRef.current.cleanedText.trim()
      if (t && writingAppendRef.current) writingAppendRef.current(t)
      setVoiceCapsule(emptyVoiceCapsule); setVoiceMode('idle')
      return true
    }
    return false
  }, [])

  // Insert text into editor
  const handleInsertText = useCallback((text: string) => {
    if (!editor) return
    const { from } = editor.state.selection
    editor.chain().focus().insertContentAt(from, text).run()
  }, [editor])

  // Voice capsule ref sync
  useEffect(() => { voiceCapsuleRef.current = voiceCapsule }, [voiceCapsule])
  useEffect(() => { voiceModeRef.current = voiceMode }, [voiceMode])

  // Voice transcript cleaning
  const prepareVoiceTranscript = useCallback(async (rawText: string, mode: 'hold' | 'handsfree') => {
    const transcript = rawText.trim()
    if (!transcript) {
      setVoiceCapsule({ phase: 'ready', mode, rawText: '', cleanedText: '', error: '没有听清，可以再说一次' })
      return
    }
    setVoiceCapsule((c) => ({ ...c, phase: 'processing', mode, rawText: transcript, cleanedText: '', error: undefined }))
    try {
      const data = await cleanTranscript(transcript)
      setVoiceCapsule({ phase: 'ready', mode, rawText: transcript, cleanedText: data.cleaned || transcript })
    } catch {
      setVoiceCapsule({ phase: 'ready', mode, rawText: transcript, cleanedText: transcript })
    }
  }, [])

  // Voice keyboard listeners
  useEffect(() => {
    const voiceSupported = isVoiceRecordingSupported()
    if (!voiceSupported) return

    const pressed = new Set<string>()
    let ctrlPendingTimer = 0
    let ctrlComboDetected = false

    // Block voice triggers in non-editor inputs (search, title, etc.)
    // Allow in: main editor (.editor-prose), writing chat input (.writing-chat-input)
    const isNonEditorInput = (target: EventTarget | null) => {
      const el = target as HTMLElement | null
      if (!el) return false
      const input = el.closest('input, textarea')
      if (input) return !input.classList.contains('writing-chat-input')
      const editable = el.closest('[contenteditable="true"]')
      if (editable && !editable.classList.contains('editor-prose')) return true
      return false
    }

    const onKeyDown = (e: KeyboardEvent) => {
      pressed.add(e.code)

      // Escape — cancel voice at any phase
      if (e.code === 'Escape' && voiceCapsuleRef.current.phase !== 'idle') {
        e.preventDefault()
        stopRecording()
        setVoiceCapsule(emptyVoiceCapsule)
        setVoiceMode('idle')
        return
      }

      // R key — confirm voice text (send to AI)
      if (e.code === 'KeyR' && voiceCapsuleRef.current.phase === 'ready' && !voiceCapsuleRef.current.error) {
        // In non-editor inputs: block only when voice is ready (prevents typing 'r')
        if (isNonEditorInput(e.target)) return
        e.preventDefault()
        const text = voiceCapsuleRef.current.cleanedText.trim()
        if (text) {
          handleWritingSendRef.current?.(text, 'quick')
          setRightTab('writing')
          setVoiceCapsule(emptyVoiceCapsule)
          setVoiceMode('idle')
        }
        return
      }

      // F key — append voice text to input / switch to writing tab
      if (e.code === 'KeyF' && voiceCapsuleRef.current.phase === 'ready') {
        if (isNonEditorInput(e.target)) return
        e.preventDefault()
        const text = voiceCapsuleRef.current.cleanedText.trim()
        if (text) {
          const target = e.target as HTMLElement
          const inWritingInput = !!target.closest('.writing-chat-input')
          if (inWritingInput && writingAppendRef.current) {
            // Already in writing chat input: append without replacing user text
            writingAppendRef.current(text)
          } else {
            // In editor or elsewhere: set as new input and switch tab
            setWritingChatInput(text)
            setRightTab('writing')
          }
        }
        setVoiceCapsule(emptyVoiceCapsule)
        setVoiceMode('idle')
        return
      }

      // Alt+Ctrl — toggle hands-free mode (works in editor too)
      if (e.altKey && e.ctrlKey) {
        if (isNonEditorInput(e.target)) return
        e.preventDefault()
        setVoiceMode((current) => {
          if (current === 'handsfree') {
            // Turn off hands-free
            const text = stopRecording()
            playVoiceCue('handsfree')
            void prepareVoiceTranscript(text, 'handsfree')
            return 'idle'
          } else if (current === 'idle') {
            // Turn on hands-free (only from idle, not from hold)
            playVoiceCue('handsfree')
            setVoiceCapsule({ ...emptyVoiceCapsule, phase: 'recording', mode: 'handsfree' })
            startRecording(
              (text) => setVoiceCapsule((c) => ({ ...c, rawText: text })),
              (error) => console.warn('Voice error:', error),
            )
            return 'handsfree'
          }
          return current
        })
        return
      }

      // Ctrl — hold to talk with combo detection
      // Start recognition immediately, cancel within 120ms if a combo key is detected
      if (e.key === 'Control' && !e.altKey && !e.shiftKey) {
        if (isNonEditorInput(e.target)) return
        if (voiceModeRef.current !== 'idle') return
        ctrlComboDetected = false
        playVoiceCue('hold')
        setVoiceCapsule({ ...emptyVoiceCapsule, phase: 'recording', mode: 'hold' })
        setVoiceMode('hold')
        startRecording(
          (text) => setVoiceCapsule((c) => ({ ...c, rawText: text })),
          (error) => console.warn('Voice error:', error),
        )
        ctrlPendingTimer = window.setTimeout(() => {
          ctrlPendingTimer = 0
          // If combo was detected during the window, stop the recording we started
          if (ctrlComboDetected && voiceModeRef.current === 'hold') {
            stopRecording()
            setVoiceCapsule(emptyVoiceCapsule)
            setVoiceMode('idle')
          }
        }, 120)
      }

      // Any non-modifier key while Ctrl is pending → mark as combo
      if (ctrlPendingTimer && !e.key.startsWith('Shift') && !e.key.startsWith('Alt') && !e.key.startsWith('Control')) {
        ctrlComboDetected = true
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      pressed.delete(e.code)

      // Release Ctrl
      if (e.key === 'Control') {
        // Cancel pending timer if Ctrl released before timeout
        if (ctrlPendingTimer) {
          window.clearTimeout(ctrlPendingTimer)
          ctrlPendingTimer = 0
        }
        // Stop hold-to-talk if voice is active (ensure minimum recording duration)
        if (voiceModeRef.current === 'hold') {
          setVoiceMode('idle')
          void stopRecordingWithMinDuration().then((text) => {
            void prepareVoiceTranscript(text, 'hold')
          })
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      if (ctrlPendingTimer) window.clearTimeout(ctrlPendingTimer)
      stopRecording()
    }
  }, [prepareVoiceTranscript])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.code === 'KeyM') {
        e.preventDefault()
        if (!editor) return

        if (revisionPanelOpen) {
          setAutoStartVoice(true)
        } else {
          const { from, to, empty } = editor.state.selection
          const text = empty ? '' : editor.state.doc.textBetween(from, to, '').trim()
          if (text) {
            setRevisionSelection({ from, to, text })
          } else {
            setRevisionSelection({ from: 0, to: 0, text: '' })
          }
          setRevisionPanelOpen(true)
          setAutoStartVoice(true)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editor, revisionPanelOpen])

  // Listen for AI writing request from slash command
  useEffect(() => {
    if (!editor) return
    const handler = () => {
      const text = editor.getText()
      setRevisionSelection({ from: 0, to: 0, text: text.slice(0, 200) })
      setRevisionPanelOpen(true)
    }
    editor.view.dom.addEventListener('slash-ai-writing', handler)
    return () => editor.view.dom.removeEventListener('slash-ai-writing', handler)
  }, [editor])

  const runAnalysis = async () => {
    if (!editor) return
    const { from, to, empty } = editor.state.selection
    const text = empty ? '' : editor.state.doc.textBetween(from, to, '').trim()

    if (!text) return

    const snapshot = { from, to, text }
    setSelection(snapshot)
    setIsAnalyzing(true)
    setActiveHistoryId(null)
    setRightTab('lens')

    try {
      const result = await requestAnalysis(text, editor.getText())
      setAnalysis(result)

      const item: HistoryItem = {
        id: `hist_${Date.now()}`,
        createdAt: new Date().toISOString(),
        excerpt: compact(text),
        analysis: result,
      }

      const nextHistory = [item, ...history].slice(0, 12)
      setHistory(nextHistory)
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory))
    } catch (err: any) {
      alert(err?.message || '分析失败，请检查网络后重试')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const clearHistory = () => {
    setHistory([])
    setActiveHistoryId(null)
    window.localStorage.removeItem(HISTORY_KEY)
  }

  const openRevisionPanel = (initialInstruction = '') => {
    if (!editor) return
    const { from, to, empty } = editor.state.selection
    const text = empty ? '' : editor.state.doc.textBetween(from, to, '').trim()
    if (!text) return
    setRevisionSelection({ from, to, text })
    setRevisionInitialInstruction(initialInstruction)
    setRevisionPanelOpen(true)
  }

  const acceptRevisionRewrite = (replacement: string) => {
    if (!editor || !revisionSelection) return
    editor.chain().focus().insertContentAt(revisionSelection, replacement).run()
    setRevisionPanelOpen(false)
    setRevisionInitialInstruction('')
    setAutoStartVoice(false)
  }

  const updateRevisionStatus = (id: string, status: RevisionStatus) => {
    setAnalysis((current) => {
      if (!current) return current
      return {
        ...current,
        revisions: current.revisions.map((revision) =>
          revision.id === id ? { ...revision, status } : revision,
        ),
      }
    })
  }

  const acceptRevision = (revision: Revision) => {
    if (!editor || !selection || revision.status !== 'pending') return

    const textRange = findTextRange(editor, selection, revision.original)

    if (!textRange) {
      updateRevisionStatus(revision.id, 'ignored')
      return
    }

    editor.chain().focus().insertContentAt(textRange, revision.replacement).run()
    updateRevisionStatus(revision.id, 'accepted')
  }

  const switchDocument = useCallback(
    (docId: string) => {
      if (docId === activeDocId) return
      if (!editor) return

      // Save current document content first
      if (activeDocId) {
        updateDocument(activeDocId, { content: editor.getHTML() })
      }

      switchingDocRef.current = true
      const target = getDocument(docId)
      if (!target) {
        switchingDocRef.current = false
        return
      }

      setActiveDocId(docId)
      setActiveDocIdState(docId)
      editor.commands.setContent(target.content)
      setAnalysis(null)
      setSelection(null)
      setRevisionPanelOpen(false)
      setCanvasMode(false)
      setSources(getSourcesByDocId(docId))
      setLeftReaderSource(null)
      setWritingMessages([])

      // Update local docs state
      setDocuments(getAllDocuments())

      // Release guard after editor processes the content change
      // Double rAF ensures Tiptap has fully committed the content change
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          switchingDocRef.current = false
        })
      })
    },
    [editor, activeDocId],
  )

  const newDocument = useCallback(() => {
    if (!editor) return

    // Save current doc
    if (activeDocId) {
      updateDocument(activeDocId, { content: editor.getHTML() })
    }

    const doc = createDocument('<p></p>')
    setDocuments(getAllDocuments())
    setActiveDocId(doc.id)
    setActiveDocIdState(doc.id)
    setSources([])
    setLeftReaderSource(null)
    setWritingMessages([])

    switchingDocRef.current = true
    editor.commands.setContent('<p></p>')
    setAnalysis(null)
    setSelection(null)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        switchingDocRef.current = false
      })
    })
  }, [editor, activeDocId])

  const deleteDoc = useCallback(
    (docId: string) => {
      // Save current editor content before deletion
      if (docId === activeDocId && editor) {
        updateDocument(docId, { content: editor.getHTML() })
      }

      deleteDocument(docId)
      deleteSourcesByDocId(docId)
      const docs = getAllDocuments()
      setDocuments(docs)

      // If deleted the active doc, switch to the most recent
      if (docId === activeDocId && docs.length > 0) {
        const target = docs[0]
        setActiveDocId(target.id)
        setActiveDocIdState(target.id)
        if (editor) {
          switchingDocRef.current = true
          editor.commands.setContent(target.content)
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              switchingDocRef.current = false
            })
          })
        }
        setAnalysis(null)
        setSelection(null)
        setCanvasMode(false)
        setSources(getSourcesByDocId(target.id))
        setLeftReaderSource(null)
        setWritingMessages([])
      } else if (docs.length === 0) {
        // No docs left, create a new one
        const doc = createDocument('<p></p>')
        setDocuments(getAllDocuments())
        setActiveDocIdState(doc.id)
        if (editor) {
          switchingDocRef.current = true
          editor.commands.setContent('<p></p>')
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              switchingDocRef.current = false
            })
          })
        }
      }
    },
    [activeDocId, editor],
  )

  const resetDocument = useCallback(() => {
    if (!editor) return
    const sample = `<h1>AI 写作工具应该如何真正帮助用户</h1>
<p>很多 AI 写作产品现在都可以帮助用户更好地完成内容创作，并提升工作效率。但是这些产品经常会直接生成一大段内容，用户很难判断哪些地方是真的有帮助，哪些地方只是看起来更流畅。</p>
<p>我希望做一个更自然的编辑器体验，让 AI 不只是替用户写东西，而是在合适的时候给出建议。这个产品可以帮助用户管理自己的想法，并让写作过程变得更加高效。</p>
<p>真正好的 AI Writing 产品应该尊重用户原本的表达，理解用户正在写什么，并在需要的时候提供可以被用户控制的修改。</p>`

    const newDoc = createDocument(sample)
    updateDocument(newDoc.id, { title: '示例文章' })
    setDocuments(getAllDocuments())
    setActiveDocId(newDoc.id)
    setActiveDocIdState(newDoc.id)
    switchingDocRef.current = true
    editor.commands.setContent(sample)
    setAnalysis(null)
    setSelection(null)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        switchingDocRef.current = false
      })
    })
  }, [editor])

  // Sync title element when active document changes
  useEffect(() => {
    if (titleRef.current) {
      const title = activeDoc?.title || '未命名文档'
      if (titleRef.current.textContent !== title) {
        titleRef.current.textContent = title
      }
    }
  }, [activeDoc?.title, activeDocId])

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !editor) return
    try {
      const { html } = await importFile(file)
      // Save current doc
      if (activeDocId) {
        updateDocument(activeDocId, { content: editor.getHTML() })
      }
      // Create new doc with imported content
      const doc = createDocument(html)
      setDocuments(getAllDocuments())
      setActiveDocId(doc.id)
      setActiveDocIdState(doc.id)

      switchingDocRef.current = true
      editor.commands.setContent(html)
      setAnalysis(null)
      setSelection(null)
      // Double rAF ensures Tiptap has fully committed the content change
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          switchingDocRef.current = false
        })
      })
    } catch (err: any) {
      alert(err.message)
    }
    e.target.value = ''
  }

  const handleIntentNodeClick = useCallback(
    (paragraph: string) => {
      if (!editor) return
      const doc = editor.state.doc
      const searchKey = paragraph.slice(0, 30)
      let found = -1
      doc.nodesBetween(0, doc.content.size, (node, pos) => {
        if (found !== -1 || !node.isBlock || node.type.name === 'doc') return true
        if (node.textContent.includes(searchKey)) {
          found = pos
        }
        return false
      })
      if (found !== -1) {
        editor.commands.focus(found)
        try {
          const { node } = editor.view.domAtPos(found)
          const el = node instanceof HTMLElement ? node : node.parentElement
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        } catch {
          // domAtPos can throw for out-of-range positions
        }
      }
    },
    [editor],
  )

  const handleAcceptVariant = useCallback(
    (originalParagraph: string, newText: string): boolean => {
      if (!editor) return false
      const doc = editor.state.doc
      const searchKey = originalParagraph.slice(0, 40)
      let found: { from: number; to: number; nodeName: string } | null = null

      doc.nodesBetween(0, doc.content.size, (node, pos) => {
        if (found || !node.isBlock || node.type.name === 'doc') return true
        if (node.textContent.includes(searchKey)) {
          found = { from: pos, to: pos + node.nodeSize, nodeName: node.type.name }
        }
        return false
      })

      if (found) {
        const { from, to, nodeName } = found
        const tag = ['heading', 'blockquote'].includes(nodeName) ? nodeName : 'p'
        const attrs = nodeName === 'heading' ? ' level="2"' : ''
        const escaped = newText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        editor.chain().focus().deleteRange({ from, to }).insertContentAt(from, `<${tag}${attrs}>${escaped}</${tag}>`).run()
        setDocuments(getAllDocuments())
        return true
      }
      return false
    },
    [editor],
  )

  const handleAppendDraft = useCallback(
    (text: string) => {
      if (!editor) return
      const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const safeText = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join('')
      editor.chain().focus('end').insertContent(safeText || `<p>${text}</p>`).run()
      if (activeDocId) {
        requestAnimationFrame(() => {
          updateDocument(activeDocId, { content: editor.getHTML() })
          setDocuments(getAllDocuments())
        })
      }
    },
    [activeDocId, editor],
  )

  const renameActiveDocument = useCallback(() => {
    if (!activeDocId) return
    const currentTitle = activeDoc?.title || '未命名文档'
    const nextTitle = window.prompt('重命名文件', currentTitle)?.trim()
    if (!nextTitle || nextTitle === currentTitle) return
    updateDocument(activeDocId, { title: nextTitle })
    setDocuments(getAllDocuments())
  }, [activeDoc?.title, activeDocId])

  const handleExport = async (format: 'docx' | 'doc' | 'txt' | 'markdown') => {
    if (!editor) return
    const html = editor.getHTML()
    const fileName = `revision-lens-export`
    setExportMenuOpen(false)

    try {
      switch (format) {
        case 'docx':
          await exportDocx(html, fileName)
          break
        case 'doc':
          exportDoc(html, fileName)
          break
        case 'txt':
          exportTxt(html, fileName)
          break
        case 'markdown':
          exportMarkdown(html, fileName)
          break
      }
    } catch (err: any) {
      alert(err?.message || '导出失败，请重试')
    }
  }

  const activeGhostIndex =
    ghostConsole.activeIndex >= 0 && ghostConsole.activeIndex < ghostConsole.suggestions.length
      ? ghostConsole.activeIndex
      : ghostConsole.suggestions.length > 0
        ? 0
        : -1

  const activeGhost = activeGhostIndex >= 0 ? ghostConsole.suggestions[activeGhostIndex] : null

  return (
    <>
      {showIntro && (
        <ParticleIntro
          darkMode={darkMode}
          onComplete={() => setShowIntro(false)}
          onToggleTheme={() => setDarkMode((value) => !value)}
        />
      )}
      <main className="app-shell" aria-hidden={showIntro}>
      <section className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={18} />
          </div>
          <div>
            <p>Revision Lens</p>
            <span>AI writing editor</span>
          </div>
        </div>

        <div className="topbar-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".doc,.docx,.txt,.md,.markdown"
            style={{ display: 'none' }}
            onChange={handleImport}
          />
          <input
            ref={sourceFileInputRef}
            type="file"
            accept=".txt,.md,.markdown,.docx,.pdf"
            style={{ display: 'none' }}
            onChange={handleSourceFileUpload}
          />
          <button className="ghost-button" onClick={newDocument} type="button">
            <FilePlus size={15} />
            新建
          </button>
          <button className="ghost-button" onClick={() => fileInputRef.current?.click()} type="button">
            <Upload size={15} />
            导入
          </button>
          <div className="export-dropdown-wrap">
            <button className="ghost-button" onClick={() => setExportMenuOpen(!exportMenuOpen)} type="button">
              <Download size={15} />
              导出
            </button>
            {exportMenuOpen && (
              <div className="export-dropdown">
                <button type="button" onClick={() => handleExport('docx')}>导出为 .docx</button>
                <button type="button" onClick={() => handleExport('doc')}>导出为 .doc</button>
                <button type="button" onClick={() => handleExport('txt')}>导出为 .txt</button>
                <button type="button" onClick={() => handleExport('markdown')}>导出为 .md</button>
              </div>
            )}
          </div>
          <span className="save-pill">{saveState}</span>
          <button className="ghost-button" onClick={resetDocument} type="button">
            <RotateCcw size={15} />
            示例文本
          </button>
          <button
            className={`ghost-button ${canvasMode ? 'active' : ''}`}
            onClick={() => setCanvasMode((v) => !v)}
            type="button"
          >
            <LayoutGrid size={15} />
            画布
          </button>
          <button
            aria-label="切换深色模式"
            className="icon-button"
            onClick={() => setDarkMode((value) => !value)}
            type="button"
          >
            {darkMode ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
      </section>

      <section className="workspace">
        <aside className="doc-panel panel">
          <div className="panel-heading">
            <div className="panel-tabs">
              <button
                className={`panel-tab ${leftTab === 'docs' ? 'active' : ''}`}
                onClick={() => setLeftTab('docs')}
                type="button"
              >
                <FileText size={13} />
                文章
              </button>
              <button
                className={`panel-tab ${leftTab === 'sources' ? 'active' : ''}`}
                onClick={() => setLeftTab('sources')}
                type="button"
              >
                <BookOpen size={13} />
                资料库
              </button>
              <button
                className={`panel-tab ${leftTab === 'history' ? 'active' : ''}`}
                onClick={() => setLeftTab('history')}
                type="button"
              >
                <Clock3 size={13} />
                历史
              </button>
            </div>
            {leftTab === 'docs' && (
              <button className="text-button" onClick={newDocument} type="button">
                <FilePlus size={13} />
                新建
              </button>
            )}
            {leftTab === 'sources' && (
              <div className="source-add-wrap">
                <button
                  className="text-button"
                  onClick={(e) => { e.stopPropagation(); setImportMenuOpen(!importMenuOpen) }}
                  type="button"
                >
                  <Plus size={13} />
                  添加
                </button>
                {importMenuOpen && (
                  <SourceImportMenu
                    onUpload={() => sourceFileInputRef.current?.click()}
                    onSearch={() => { setShowWebSearch(true); setLeftTab('sources') }}
                    onClose={() => setImportMenuOpen(false)}
                  />
                )}
              </div>
            )}
            {leftTab === 'history' && history.length > 0 && (
              <button className="text-button" onClick={clearHistory} type="button">
                清空
              </button>
            )}
          </div>

          {leftTab === 'docs' ? (
            <div className="doc-list">
              {documents.length === 0 ? (
                <div className="empty-doc-list">
                  <FileText size={19} />
                  <p>还没有文章，点击新建开始写作。</p>
                </div>
              ) : (
                documents.map((doc) => {
                  const title = doc.title || '未命名文档'
                  const preview = doc.content.replace(/<[^>]+>/g, '').trim().slice(0, 60)
                  const date = new Date(doc.updatedAt)
                  const timeStr = date.toLocaleDateString('zh-CN', {
                    month: 'short',
                    day: 'numeric',
                  })
                  const hasGraph = !!doc.graph

                  return (
                    <div
                      className={`doc-item ${doc.id === activeDocId ? 'active' : ''}`}
                      key={doc.id}
                    >
                      <button
                        className="doc-item-main"
                        onClick={() => switchDocument(doc.id)}
                        type="button"
                      >
                        <div className="doc-item-header">
                          <strong className="doc-item-title">{title}</strong>
                          <span className="doc-item-date">{timeStr}</span>
                        </div>
                        {preview && <p className="doc-item-preview">{preview}</p>}
                        <div className="doc-item-meta">
                          {hasGraph && (
                            <span className="doc-item-badge">
                              <Zap size={10} />
                              {Math.round(doc.graph!.coherenceScore * 100)}%
                            </span>
                          )}
                        </div>
                      </button>
                      <button
                        className="doc-item-delete"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (documents.length <= 1) return
                          deleteDoc(doc.id)
                        }}
                        title="删除文档"
                        type="button"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          ) : leftTab === 'sources' ? (
            leftReaderSource ? (
              <SourceReader material={leftReaderSource} onBack={handleSourceReaderBack} />
            ) : showWebSearch && activeDocId ? (
              <WebSearchPanel
                onBack={() => setShowWebSearch(false)}
                onAdd={handleWebSearchAdd}
                docId={activeDocId}
              />
            ) : (
              <SourceList
                sources={sources}
                onToggleSelect={handleSourceToggleSelect}
                onDelete={handleSourceDelete}
                onOpen={handleSourceOpen}
                onUpload={() => sourceFileInputRef.current?.click()}
                onSearch={() => setShowWebSearch(true)}
              />
            )
          ) : (
            <div className="history-list">
              {history.length === 0 ? (
                <div className="empty-doc-list">
                  <Clock3 size={19} />
                  <p>完成一次诊断后，这里会保存记录。</p>
                </div>
              ) : (
                history.map((item) => (
                  <button
                    className={`history-item ${activeHistoryId === item.id ? 'active' : ''}`}
                    key={item.id}
                    onClick={() => {
                      setActiveHistoryId(item.id)
                      setAnalysis(item.analysis)
                    }}
                    type="button"
                  >
                    <span>
                      {new Date(item.createdAt).toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <strong>{item.excerpt}</strong>
                    <ChevronRight size={15} />
                  </button>
                ))
              )}
            </div>
          )}
        </aside>

        <section className="editor-panel panel">
          <div className="editor-header">
            <div>
              <p className="eyebrow">Document</p>
              <h1
                ref={titleRef}
                contentEditable={false}
                suppressContentEditableWarning
                spellCheck={false}
                className="doc-title-editable"
                data-protected="filename"
                title="双击重命名文件"
                onDoubleClick={renameActiveDocument}
                onBlur={(e) => {
                  const newTitle = e.currentTarget.textContent?.trim() || ''
                  if (activeDocId && newTitle && newTitle !== activeDoc?.title) {
                    updateDocument(activeDocId, { title: newTitle })
                    setDocuments(getAllDocuments())
                  } else if (!newTitle && activeDocId) {
                    e.currentTarget.textContent = activeDoc?.title || '未命名文档'
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    e.currentTarget.blur()
                  }
                }}
              />
            </div>
            <div className="editor-stats">
              <FileText size={15} />
              <span>{editor ? `${editor.getText().length} 字` : ''}</span>
            </div>
          </div>

          {editor && (
            <EditorToolbar
              editor={editor}
              selectedCount={selectedCount}
              onSelectionRewrite={(instruction = '') => openRevisionPanel(instruction)}
              onFullTextRewrite={(instruction = '') => {
                if (!editor) return
                const text = editor.getText()
                if (!text.trim()) return
                setRevisionSelection({ from: 0, to: editor.state.doc.content.size, text })
                setRevisionInitialInstruction(instruction || '重写全文，让结构更清楚，表达更自然。')
                setRevisionPanelOpen(true)
              }}
            />
          )}

          <div className="editor-card" ref={editorCardRef}>
            {editor && (
              <BubbleMenu
                className="bubble-menu"
                editor={editor}
                shouldShow={({ state }: { state: Editor['state'] }) => !state.selection.empty}
              >
                <button onClick={runAnalysis} type="button">
                  <Sparkles size={15} />
                  诊断并改写
                </button>
                <button onClick={() => openRevisionPanel()} type="button">
                  <Wand2 size={15} />
                  自定义修改
                </button>
              </BubbleMenu>
            )}
            <EditorContent editor={editor} />
            <AnimatePresence>
              {revisionPanelOpen && revisionSelection && (
                <RevisionPanel
                  selectedText={revisionSelection.text}
                  initialInstruction={revisionInitialInstruction}
                  onClose={() => {
                    setRevisionPanelOpen(false)
                    setRevisionInitialInstruction('')
                    setAutoStartVoice(false)
                  }}
                  onAccept={acceptRevisionRewrite}
                  autoStartVoice={autoStartVoice}
                />
              )}
            </AnimatePresence>
            {editor && (
              <GhostOverlay
                editor={editor}
                containerRef={editorCardRef}
                onStateChange={setGhostConsole}
                coherenceSuggestions={coherence.coherenceGhostSuggestions}
              />
            )}
          </div>

          <div className="editor-voice-layer">
            <VoiceInputBar capsule={voiceCapsule} />
          </div>

          <div className="editor-footer">
            <span>选中任意一段中文，使用 Revision Lens 查看可解释的修改建议。</span>
            <div className="editor-footer-right">
              {coherence.isEnabled && coherence.graph && (
                <button
                  type="button"
                  className="coherence-pill"
                  onClick={() => setRightTab('intent')}
                  title="查看连贯性分析"
                >
                  <Zap size={12} />
                  连贯性 {Math.round(coherence.graph.coherenceScore * 100)}%
                </button>
              )}
              {selectedCount > 0 && <strong>已选中 {selectedCount} 字</strong>}
            </div>
          </div>
        </section>

        <aside className="lens-panel panel">
          <div className="panel-heading">
            <div className="panel-tabs">
              <button
                className={`panel-tab ${rightTab === 'ghost' ? 'active' : ''}`}
                onClick={() => setRightTab('ghost')}
                type="button"
              >
                <Sparkles size={14} />
                幽灵文字
              </button>
              <button
                className={`panel-tab ${rightTab === 'intent' ? 'active' : ''}`}
                onClick={() => setRightTab('intent')}
                type="button"
              >
                <Target size={14} />
                意图空间
              </button>
              <button
                className={`panel-tab ${rightTab === 'coherence' ? 'active' : ''}`}
                onClick={() => setRightTab('coherence')}
                type="button"
              >
                <Map size={14} />
                连贯性
              </button>
              <button
                className={`panel-tab ${rightTab === 'lens' ? 'active' : ''}`}
                onClick={() => setRightTab('lens')}
                type="button"
              >
                <PenLine size={14} />
                诊断
              </button>
              <button
                className={`panel-tab ${rightTab === 'writing' ? 'active' : ''}`}
                onClick={() => setRightTab('writing')}
                type="button"
              >
                <Sparkles size={14} />
                写作
              </button>
            </div>
          </div>

          {rightTab === 'ghost' ? (
            ghostConsole.suggestions.length > 0 ? (
              <div className="ghost-console">
                <div className="ghost-console-header">
                  <div>
                    <span className="ghost-console-kicker">Ghost Console</span>
                    <h3>{ghostConsole.suggestions.length} 条即时建议</h3>
                  </div>
                  <span className="ghost-console-status">
                    {ghostConsole.loading ? '扫描中' : '已就绪'}
                  </span>
                </div>

                <div className="ghost-console-actions">
                  <button
                    className="ghost-console-primary"
                    disabled={!activeGhost}
                    onClick={() => ghostConsole.acceptCurrent()}
                    type="button"
                  >
                    <Check size={14} />
                    接受当前
                  </button>
                  <button
                    className="ghost-console-secondary"
                    disabled={!activeGhost}
                    onClick={() => ghostConsole.ignoreCurrent()}
                    type="button"
                  >
                    <X size={14} />
                    忽略当前
                  </button>
                  <button
                    className="ghost-console-secondary"
                    onClick={() => ghostConsole.clearSuggestions()}
                    type="button"
                  >
                    清空建议
                  </button>
                </div>

                <div className="ghost-console-list">
                  {ghostConsole.suggestions.map((ghost, index) => (
                    <button
                      aria-label={`查看幽灵文字建议 ${index + 1}`}
                      className={`ghost-console-card ${index === activeGhostIndex ? 'active' : ''} ${ghost.severity}`}
                      key={ghost.id}
                      onClick={() => ghostConsole.setActiveIndex(index)}
                      onDoubleClick={() => ghostConsole.acceptSuggestion(ghost.id)}
                      type="button"
                    >
                      <span className="ghost-console-dot" />
                      <span className="ghost-console-card-body">
                        <span className="ghost-console-row">
                          <span>原文</span>
                          <strong className="ghost-console-original">{ghost.original}</strong>
                        </span>
                        <span className="ghost-console-row">
                          <span>建议</span>
                          <strong>{ghost.replacement}</strong>
                        </span>
                        <small>{ghost.reason}</small>
                      </span>
                    </button>
                  ))}
                </div>

                <div className="ghost-tab-hint">
                  <span>Tab 切换</span>
                  <span>Enter 接受</span>
                  <span>双击卡片接受</span>
                </div>
              </div>
            ) : ghostConsole.loading ? (
              <div className="ghost-console ghost-console-loading">
                <Loader2 className="spin" size={20} />
                <h3>正在扫描当前段落</h3>
                <p>Revision Lens 会在你停顿后刷新幽灵文字建议。</p>
              </div>
            ) : (
              <div className="ghost-tab-empty">
                <Sparkles size={18} />
                <p>在编辑器中输入文字，AI 会自动扫描并显示幽灵文字建议。</p>
                <div className="ghost-tab-hint">
                  <span>Tab 切换建议</span>
                  <span>Enter 接受</span>
                  <span>Esc 关闭</span>
                </div>
              </div>
            )
          ) : rightTab === 'intent' ? (
            <IntentSpacePanel
              intentMap={intentSpace.intentMap}
              isScanning={intentSpace.isScanning}
              scanStage={intentSpace.scanStage}
              scanError={intentSpace.scanError}
              onScanNow={intentSpace.scanNow}
            />
          ) : rightTab === 'coherence' ? (
            <IntentPanel
              graph={coherence.graph}
              nudges={coherence.nudges}
              isScanning={coherence.isScanning}
              isEnabled={coherence.isEnabled}
              scanStage={coherence.scanStage}
              scanError={coherence.scanError}
              lastScannedAt={coherence.lastScannedAt}
              onScanNow={coherence.scanNow}
              onNodeClick={handleIntentNodeClick}
              onChallengeEdge={coherence.challengeEdge}
              onStrengthenNode={coherence.strengthenNode}
              onDismissNudge={coherence.dismissNudge}
            />
          ) : rightTab === 'writing' ? (
            <WritingChatPanel
              messages={writingMessages}
              loading={writingLoading}
              selectedSources={sources.filter((s) => s.selected)}
              onSend={handleWritingSend}
              onInsertText={handleInsertText}
              externalInput={writingChatInput}
              appendInputRef={writingAppendRef}
              onVoiceKey={writingVoiceKeyHandler}
            />
          ) : isAnalyzing ? (
            <div className="loading-state">
              <ChickenProgress stage="reading" label="正在阅读你的文本" />
              <p style={{ marginTop: 8 }}>Revision Lens 会拆解问题、修改意图和可逐条接受的建议。</p>
            </div>
          ) : !analysis ? (
            <div className="empty-lens">
              <div className="lens-orbit">
                <Sparkles size={22} />
              </div>
              <h3>让 AI 像编辑一样工作</h3>
              <p>选中一段文字后，AI 会先诊断问题，再给出局部 diff，而不是直接重写整段。</p>
            </div>
          ) : (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="analysis-content"
              initial={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.22 }}
            >
              <section className="summary-card">
                <span>整体判断</span>
                <p>{analysis.summary}</p>
              </section>

              <section className="goals">
                {analysis.goals.map((goal) => (
                  <span key={goal}>{goal}</span>
                ))}
              </section>

              <section className="issues">
                <h3>诊断</h3>
                {analysis.issues.map((issue, index) => (
                  <article className="issue-item" key={`${issue.text}_${index}`}>
                    <strong>{issue.text}</strong>
                    <p>{issue.problem}</p>
                    <small>{issue.suggestion}</small>
                  </article>
                ))}
              </section>

              <section className="revisions">
                <h3>可接受的修改</h3>
                {analysis.revisions.map((revision) => (
                  <article className={`revision-card ${revision.status}`} key={revision.id}>
                    <div className="revision-meta">
                      <span>
                        {revision.status === 'accepted'
                          ? '已接受'
                          : revision.status === 'ignored'
                            ? '已忽略'
                            : '建议'}
                      </span>
                      <p>{revision.reason}</p>
                    </div>
                    <DiffView original={revision.original} replacement={revision.replacement} />
                    <div className="revision-actions">
                      <button
                        disabled={revision.status !== 'pending'}
                        onClick={() => acceptRevision(revision)}
                        type="button"
                      >
                        <Check size={14} />
                        接受
                      </button>
                      <button
                        disabled={revision.status !== 'pending'}
                        onClick={() => updateRevisionStatus(revision.id, 'ignored')}
                        type="button"
                      >
                        <X size={14} />
                        忽略
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            </motion.div>
          )}
        </aside>
      </section>

      <ArgumentCanvas
        visible={canvasMode}
        sessionKey={activeDocId ?? 'no-document'}
        graph={coherence.graph}
        nudges={coherence.nudges}
        isScanning={coherence.isScanning}
        scanError={coherence.scanError}
        onClose={() => setCanvasMode(false)}
        onNodeClick={handleIntentNodeClick}
        onAcceptVariant={handleAcceptVariant}
        onScanNow={coherence.scanNow}
        onAppendDraft={handleAppendDraft}
      />
        <HandsfreeOverlay active={voiceMode === 'handsfree'} />
      </main>
    </>
  )
}

export default App
