import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { AnimatePresence, motion } from 'framer-motion'
import { diffWords } from 'diff'
import {
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
  RotateCcw,
  Sparkles,
  Sun,
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
import ArgumentCanvas from './components/canvas/ArgumentCanvas'
import useCoherenceAgent from './hooks/useCoherenceAgent'
import {
  importFile,
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

async function createMockAnalysis(selectedText: string): Promise<Analysis> {
  const clean = selectedText.replace(/\s+/g, ' ').trim()
  const candidates = [
    {
      original: '可以帮助用户更好地完成内容创作',
      replacement: '能帮助用户把零散想法整理成可继续编辑的内容',
      reason: '把泛泛的“更好地完成”改成更明确的创作动作。',
      problem: '表达偏泛，缺少真实写作场景。',
    },
    {
      original: '提升工作效率',
      replacement: '更快把初稿打磨成可发布的内容',
      reason: '把抽象收益落到“初稿到发布”的具体结果上。',
      problem: '收益描述模板化，辨识度不够。',
    },
    {
      original: '生成一大段内容',
      replacement: '一次性抛出整段改写结果',
      reason: '更贴近 AI 写作工具的真实交互问题。',
      problem: '原表达准确，但产品语境还可以更具体。',
    },
    {
      original: '给出建议',
      replacement: '给出可以被逐条接受或忽略的编辑建议',
      reason: '补充用户控制权，强化产品差异点。',
      problem: '没有说明建议如何被用户使用。',
    },
    {
      original: '管理自己的想法',
      replacement: '整理写作过程中的零散判断和表达草稿',
      reason: '把“想法”拆成更贴近写作工作流的资产。',
      problem: '概念较大，不够可感知。',
    },
    {
      original: '变得更加高效',
      replacement: '在不丢失个人语气的前提下更快完成修改',
      reason: '补充约束条件，避免听起来像普通效率工具。',
      problem: '表达过于常见，缺少产品态度。',
    },
  ]

  const matched = candidates.filter((item) => clean.includes(item.original)).slice(0, 4)
  const fallbackOriginal = clean.split(/[，。,.]/)[0] || clean.slice(0, 16)
  const revisions: Revision[] =
    matched.length > 0
      ? matched.map((item, index) => ({
          id: `rev_${Date.now()}_${index}`,
          original: item.original,
          replacement: item.replacement,
          reason: item.reason,
          status: 'pending',
        }))
      : [
          {
            id: `rev_${Date.now()}_0`,
            original: fallbackOriginal,
            replacement: `${fallbackOriginal}，并补充更具体的使用场景`,
            reason: '当前表达可以继续保留，但需要增加一点具体性，避免只停留在结论。',
            status: 'pending',
          },
        ]

  const issues = revisions.map((revision, index) => ({
    text: revision.original,
    problem: matched[index]?.problem ?? '表达方向清楚，但还缺少可验证的细节。',
    suggestion: `建议改为“${revision.replacement}”。`,
  }))

  return new Promise((resolve) => {
    window.setTimeout(() => {
      resolve({
        summary:
          '这段文字有清晰的产品判断，但部分表达还偏概括。建议保留原本克制的语气，同时把收益、场景和用户控制感说得更具体。',
        goals: ['保留原文语气', '增强场景感', '让产品差异更清楚'],
        issues,
        revisions,
      })
    }, 820)
  })
}

async function requestAnalysis(selectedText: string, fullContext: string): Promise<Analysis> {
  try {
    const response = await fetch('/api/revision/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedText, fullContext }),
    })

    if (!response.ok) {
      throw new Error(`Analyze failed: ${response.status}`)
    }

    return normalizeAnalysis(await response.json())
  } catch {
    return createMockAnalysis(selectedText)
  }
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
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [selection, setSelection] = useState<SelectionSnapshot | null>(null)
  const [documents, setDocuments] = useState<StoredDocument[]>([])
  const [activeDocId, setActiveDocIdState] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null)
  const [leftTab, setLeftTab] = useState<'docs' | 'history'>('docs')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [darkMode, setDarkMode] = useState(false)
  const [saveState, setSaveState] = useState('已保存')
  const [selectedCount, setSelectedCount] = useState(0)
  const [revisionPanelOpen, setRevisionPanelOpen] = useState(false)
  const [revisionSelection, setRevisionSelection] = useState<SelectionSnapshot | null>(null)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [autoStartVoice, setAutoStartVoice] = useState(false)
  const [rightTab, setRightTab] = useState<'ghost' | 'intent' | 'lens'>('ghost')
  const [canvasMode, setCanvasMode] = useState(false)
  const [ghostConsole, setGhostConsole] = useState<GhostConsoleState>(emptyGhostConsole)
  const editorCardRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const switchingDocRef = useRef(false)

  // Initialize: load document list and active doc
  const activeDoc = documents.find((d) => d.id === activeDocId) ?? null

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: '写一点内容，然后选中一段文字启动 Revision Lens...',
      }),
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
      if (activeDocId) {
        updateDocument(activeDocId, { content: html })
        // Update local documents state
        setDocuments((docs) =>
          docs.map((d) => (d.id === activeDocId ? { ...d, content: html, updatedAt: Date.now() } : d)),
        )
      }
      window.setTimeout(() => setSaveState('已保存'), 280)
    },
  })

  const handleGraphUpdate = useCallback(
    (graph: ArgumentGraph, nudges: StructuralNudge[]) => {
      if (activeDocId) {
        updateDocument(activeDocId, { graph, nudges })
        setDocuments((docs) =>
          docs.map((d) =>
            d.id === activeDocId ? { ...d, graph, nudges, updatedAt: Date.now() } : d,
          ),
        )
      }
    },
    [activeDocId],
  )

  const coherence = useCoherenceAgent(editor, {
    initialGraph: activeDoc?.graph ?? null,
    initialNudges: activeDoc?.nudges ?? [],
    onGraphUpdate: handleGraphUpdate,
  })

  // Initialize on mount
  useEffect(() => {
    const { doc } = getOrCreateDefault()
    const docs = getAllDocuments()
    setDocuments(docs)
    setActiveDocIdState(doc.id)
    setActiveDocId(doc.id)
    setHistory(getStoredHistory())
    setDarkMode(window.localStorage.getItem(THEME_KEY) === 'dark')
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

  const runAnalysis = async () => {
    if (!editor) return
    const { from, to, empty } = editor.state.selection
    const text = empty ? '' : editor.state.doc.textBetween(from, to, '').trim()

    if (!text) return

    const snapshot = { from, to, text }
    setSelection(snapshot)
    setIsAnalyzing(true)
    setActiveHistoryId(null)

    try {
      const result = normalizeAnalysis(await requestAnalysis(text, editor.getText()))
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
    } finally {
      setIsAnalyzing(false)
    }
  }

  const clearHistory = () => {
    setHistory([])
    setActiveHistoryId(null)
    window.localStorage.removeItem(HISTORY_KEY)
  }

  const openRevisionPanel = () => {
    if (!editor) return
    const { from, to, empty } = editor.state.selection
    const text = empty ? '' : editor.state.doc.textBetween(from, to, '').trim()
    if (!text) return
    setRevisionSelection({ from, to, text })
    setRevisionPanelOpen(true)
  }

  const acceptRevisionRewrite = (replacement: string) => {
    if (!editor || !revisionSelection) return
    editor.chain().focus().insertContentAt(revisionSelection, replacement).run()
    setRevisionPanelOpen(false)
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

      // Update local docs state
      setDocuments(getAllDocuments())

      // Release guard after editor processes the content change
      requestAnimationFrame(() => {
        switchingDocRef.current = false
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
    setActiveDocIdState(doc.id)

    switchingDocRef.current = true
    editor.commands.setContent('<p></p>')
    setAnalysis(null)
    setSelection(null)
    requestAnimationFrame(() => {
      switchingDocRef.current = false
    })
  }, [editor, activeDocId])

  const deleteDoc = useCallback(
    (docId: string) => {
      deleteDocument(docId)
      const docs = getAllDocuments()
      setDocuments(docs)

      // If deleted the active doc, switch to the most recent
      if (docId === activeDocId && docs.length > 0) {
        switchDocument(docs[0].id)
      } else if (docs.length === 0) {
        // No docs left, create a new one
        const doc = createDocument('<p></p>')
        setDocuments(getAllDocuments())
        setActiveDocIdState(doc.id)
        if (editor) {
          switchingDocRef.current = true
          editor.commands.setContent('<p></p>')
          requestAnimationFrame(() => {
            switchingDocRef.current = false
          })
        }
      }
    },
    [activeDocId, editor, switchDocument],
  )

  const resetDocument = useCallback(() => {
    if (!editor) return
    const sample = `<h1>AI 写作工具应该如何真正帮助用户</h1>
<p>很多 AI 写作产品现在都可以帮助用户更好地完成内容创作，并提升工作效率。但是这些产品经常会直接生成一大段内容，用户很难判断哪些地方是真的有帮助，哪些地方只是看起来更流畅。</p>
<p>我希望做一个更自然的编辑器体验，让 AI 不只是替用户写东西，而是在合适的时候给出建议。这个产品可以帮助用户管理自己的想法，并让写作过程变得更加高效。</p>
<p>真正好的 AI Writing 产品应该尊重用户原本的表达，理解用户正在写什么，并在需要的时候提供可以被用户控制的修改。</p>`

    if (activeDocId) {
      updateDocument(activeDocId, { content: sample })
      setDocuments(getAllDocuments())
    }
    switchingDocRef.current = true
    editor.commands.setContent(sample)
    setAnalysis(null)
    setSelection(null)
    requestAnimationFrame(() => {
      switchingDocRef.current = false
    })
  }, [editor, activeDocId])

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
      setActiveDocIdState(doc.id)

      switchingDocRef.current = true
      editor.commands.setContent(html)
      setAnalysis(null)
      setSelection(null)
      requestAnimationFrame(() => {
        switchingDocRef.current = false
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
      let found = -1
      doc.nodesBetween(0, doc.content.size, (node, pos) => {
        if (found !== -1 || !node.isText || !node.text) return false
        if (node.text.includes(paragraph.slice(0, 20))) {
          found = pos
        }
        return false
      })
      if (found !== -1) {
        editor.commands.focus(found)
        const editorEl = editor.view.dom
        editorEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    },
    [editor],
  )

  const handleExport = async (format: 'docx' | 'doc' | 'txt' | 'markdown') => {
    if (!editor) return
    const html = editor.getHTML()
    const fileName = `revision-lens-export`
    setExportMenuOpen(false)

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
  }

  const activeGhostIndex =
    ghostConsole.activeIndex >= 0 && ghostConsole.activeIndex < ghostConsole.suggestions.length
      ? ghostConsole.activeIndex
      : ghostConsole.suggestions.length > 0
        ? 0
        : -1

  const activeGhost = activeGhostIndex >= 0 ? ghostConsole.suggestions[activeGhostIndex] : null

  return (
    <main className="app-shell">
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
            onClick={() => setCanvasMode(true)}
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
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                className="doc-title-editable"
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
                dangerouslySetInnerHTML={{ __html: activeDoc?.title || '未命名文档' }}
              />
            </div>
            <div className="editor-stats">
              <FileText size={15} />
              <span>Prototype</span>
            </div>
          </div>

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
                <button onClick={openRevisionPanel} type="button">
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
                  onClose={() => {
                    setRevisionPanelOpen(false)
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
          ) : isAnalyzing ? (
            <div className="loading-state">
              <Loader2 className="spin" size={24} />
              <h3>正在阅读你的文本</h3>
              <p>Revision Lens 会拆解问题、修改意图和可逐条接受的建议。</p>
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

      {canvasMode && (
        <ArgumentCanvas
          graph={coherence.graph}
          nudges={coherence.nudges}
          isScanning={coherence.isScanning}
          onClose={() => setCanvasMode(false)}
          onNodeClick={handleIntentNodeClick}
        />
      )}
    </main>
  )
}

export default App
