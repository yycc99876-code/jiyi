import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  MarkerType,
  BackgroundVariant,
  PanOnScrollMode,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from 'dagre'
import { X, ArrowLeft, Zap, Trash2, Crosshair, RefreshCw, CheckCircle2, Lightbulb, ListChecks, Map as MapIcon, Wand2 } from 'lucide-react'
import ChickenProgress from '../loading/ChickenProgress'
import ArgumentNodeCard from './ArgumentNodeCard'
import type { ArgumentNodeData } from './ArgumentNodeCard'
import ActionVariantNode from './ActionVariantNode'
import DraftNoteNode from './DraftNoteNode'
import type { DraftNoteData } from './DraftNoteNode'
import CanvasChatPanel from './CanvasChatPanel'
import useCanvasActions from '../../hooks/useCanvasActions'
import {
  isVoiceRecordingSupported,
  startRecording,
  stopRecording,
} from '../../services/ai/voiceInput'
import { playVoiceCue } from '../../services/ai/voiceCue'
import type {
  ArgumentGraph,
  StructuralNudge,
  CanvasChatMessage,
  CanvasChatResponse,
  CanvasSuggestion,
} from '../../services/ai/coherenceTypes'

interface Props {
  visible?: boolean
  sessionKey: string
  graph: ArgumentGraph | null
  nudges: StructuralNudge[]
  isScanning: boolean
  scanError?: string | null
  onClose: () => void
  onNodeClick: (paragraph: string) => void
  onAcceptVariant: (originalParagraph: string, newText: string) => boolean
  onScanNow: () => void
  onAppendDraft: (text: string) => void
}

const nodeTypes = { argumentNode: ArgumentNodeCard, actionVariant: ActionVariantNode, draftNote: DraftNoteNode }

interface DraftCanvasNode {
  id: string
  type: CanvasSuggestion['type']
  title: string
  content: string
  x: number
  y: number
  status?: 'draft' | 'accepted' | 'ignored'
}

type VoiceCapsulePhase = 'idle' | 'recording' | 'processing' | 'ready'

interface VoiceCapsuleState {
  phase: VoiceCapsulePhase
  mode: 'hold' | 'handsfree'
  rawText: string
  cleanedText: string
  error?: string
}

interface FocusRequest {
  nodeId: string
  tick: number
}

interface CanvasContextMenu {
  nodeId: string
  x: number
  y: number
  label: string
}

type CanvasWorkMode = 'mission' | 'focus' | 'map'
type IdeaFormat = '观点文章' | '技术博客' | '产品文案' | '演讲稿'

const emptyVoiceCapsule: VoiceCapsuleState = {
  phase: 'idle',
  mode: 'hold',
  rawText: '',
  cleanedText: '',
}

function createFocusRequest(nodeId: string): FocusRequest {
  return { nodeId, tick: Date.now() }
}

function clonePosition(position: { x: number; y: number }) {
  return { x: position.x, y: position.y }
}

function relationColor(relation: string) {
  switch (relation) {
    case 'supports': return '#286a42'
    case 'contradicts': return '#a84035'
    case 'extends': return '#b98124'
    case 'weakens': return '#747067'
    default: return '#747067'
  }
}

function relationLabel(relation: string) {
  switch (relation) {
    case 'supports': return '支撑'
    case 'contradicts': return '矛盾'
    case 'extends': return '递进'
    case 'weakens': return '弱化'
    default: return relation
  }
}

function coherenceLabel(score: number) {
  if (score >= 0.8) return { text: '连贯性强', color: 'var(--green)' }
  if (score >= 0.5) return { text: '连贯性中等', color: 'var(--accent)' }
  return { text: '需要改进', color: 'var(--red)' }
}

function layoutGraph(graph: ArgumentGraph, nudges: StructuralNudge[]): { nodes: Node[]; edges: Edge[] } {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))
  dagreGraph.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 100, marginx: 40, marginy: 40 })

  // Add regular nodes
  for (const node of graph.nodes) {
    const textLen = node.paragraph.length
    const width = Math.max(220, Math.min(320, textLen * 1.5))
    const height = node.evidenceNote ? 160 : 120
    dagreGraph.setNode(node.id, { width, height })
  }

  // Add ghost nodes for nudges
  const ghostNodes: { id: string; message: string; relatedTo: string }[] = []
  for (let i = 0; i < nudges.length; i++) {
    const nudge = nudges[i]
    if (nudge.type === 'gap' || nudge.type === 'unsupported_claim') {
      const ghostId = `ghost_${i}`
      const ref = nudge.relatedParagraphs[0]
      if (!ref) continue
      // Try exact ID match first, then fall back to substring match on paragraph content
      const match = graph.nodes.find((n) => n.id === ref)
        ?? graph.nodes.find((n) => n.paragraph.includes(ref.slice(0, 20)) || ref.includes(n.paragraph.slice(0, 20)))
      if (match) {
        dagreGraph.setNode(ghostId, { width: 200, height: 80 })
        dagreGraph.setEdge(match.id, ghostId, { weight: 1 })
        ghostNodes.push({ id: ghostId, message: nudge.message, relatedTo: match.id })
      }
    }
  }

  // Add edges
  for (const edge of graph.edges) {
    if (dagreGraph.hasNode(edge.from) && dagreGraph.hasNode(edge.to)) {
      dagreGraph.setEdge(edge.from, edge.to, {
        weight: edge.relation === 'supports' ? 3 : edge.relation === 'contradicts' ? 2 : 1,
      })
    }
  }

  dagre.layout(dagreGraph)

  const nodes: Node[] = graph.nodes.map((node) => {
    const pos = dagreGraph.node(node.id)
    return {
      id: node.id,
      type: 'argumentNode',
      position: { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 },
      data: {
        label: node.label,
        paragraph: node.paragraph,
        strength: node.strength,
        role: node.role,
        evidenceNote: node.evidenceNote,
      } as unknown as Record<string, unknown>,
    }
  })

  // Add ghost nodes
  for (const ghost of ghostNodes) {
    const pos = dagreGraph.node(ghost.id)
    if (pos) {
      nodes.push({
        id: ghost.id,
        type: 'argumentNode',
        position: { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 },
        data: {
          label: '',
          paragraph: '',
          strength: 'weak',
          role: 'claim',
          isGhost: true,
          ghostMessage: ghost.message,
        } as unknown as Record<string, unknown>,
      })
    }
  }

  const edges: Edge[] = graph.edges
    .filter((e) => dagreGraph.hasNode(e.from) && dagreGraph.hasNode(e.to))
    .map((edge) => ({
      id: `${edge.from}-${edge.to}`,
      source: edge.from,
      target: edge.to,
      label: edge.explanation ? relationLabel(edge.relation) : undefined,
      labelStyle: { fontSize: 10, fontWeight: 600 },
      labelBgStyle: { fill: 'var(--surface-strong)', fillOpacity: 0.9 },
      labelBgPadding: [4, 6] as [number, number],
      labelBgBorderRadius: 4,
      style: {
        stroke: relationColor(edge.relation),
        strokeWidth: 2,
        strokeDasharray: edge.relation === 'contradicts' ? '6 3' : undefined,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: relationColor(edge.relation),
        width: 16,
        height: 16,
      },
      animated: edge.relation === 'contradicts',
    }))

  return { nodes, edges }
}

function CanvasKeyboardHandler({ onEscape }: { onEscape: () => void }) {
  const { fitView } = useReactFlow()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onEscape()
        return
      }
      if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
        fitView({ padding: 0.3, duration: 300 })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onEscape, fitView])

  return null
}

function CanvasFocusController({ focusRequest }: { focusRequest: FocusRequest | null }) {
  const { fitView, getNode, setCenter } = useReactFlow()

  useEffect(() => {
    if (!focusRequest) return

    const node = getNode(focusRequest.nodeId)
    if (!node) {
      fitView({ nodes: [{ id: focusRequest.nodeId }], padding: 0.55, duration: 360 })
      return
    }

    const width = node.measured?.width ?? node.width ?? 260
    const height = node.measured?.height ?? node.height ?? 150
    void setCenter(node.position.x + width / 2, node.position.y + height / 2, {
      zoom: node.type === 'draftNote' ? 1.35 : 1.55,
      duration: 420,
    })
  }, [fitView, focusRequest, getNode, setCenter])

  return null
}

export default function ArgumentCanvas({
  visible = true,
  sessionKey,
  graph,
  nudges,
  isScanning,
  scanError,
  onClose,
  onNodeClick,
  onAcceptVariant,
  onScanNow,
  onAppendDraft,
}: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[])
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[])
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [voiceMode, setVoiceMode] = useState<'idle' | 'hold' | 'handsfree'>('idle')
  const [voiceCapsule, setVoiceCapsule] = useState<VoiceCapsuleState>(emptyVoiceCapsule)
  const [taskRailOpen, setTaskRailOpen] = useState(true)
  const [draftNodes, setDraftNodes] = useState<DraftCanvasNode[]>([])
  const [chatMessages, setChatMessages] = useState<CanvasChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [workMode, setWorkMode] = useState<CanvasWorkMode>('mission')
  const [ideaPrompt, setIdeaPrompt] = useState('')
  const [ideaFormat, setIdeaFormat] = useState<IdeaFormat>('观点文章')
  const [hiddenNodeIds, setHiddenNodeIds] = useState<Set<string>>(() => new Set())
  const [contextMenu, setContextMenu] = useState<CanvasContextMenu | null>(null)
  const [voiceSupported] = useState(() => isVoiceRecordingSupported())
  const canvasOverlayRef = useRef<HTMLDivElement | null>(null)
  const nodePositionsRef = useRef<globalThis.Map<string, { x: number; y: number }>>(new globalThis.Map())
  const timersRef = useRef<number[]>([])

  // Cleanup pending timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach((id) => clearTimeout(id))
      timersRef.current = []
    }
  }, [])
  const previousGraphNodesRef = useRef<Node[]>([])
  const voiceCapsuleRef = useRef(voiceCapsule)
  const sendCanvasChatRef = useRef<(override?: string, options?: { autoPlace?: boolean }) => Promise<CanvasChatResponse | null>>(async () => null)
  const focusedActionBatchesRef = useRef<Set<string>>(new Set())
  const canvasActions = useCanvasActions()

  useEffect(() => {
    stopRecording()
    setNodes([])
    setEdges([])
    setFocusRequest(null)
    setToast(null)
    setVoiceMode('idle')
    setVoiceCapsule(emptyVoiceCapsule)
    setTaskRailOpen(true)
    setDraftNodes([])
    setChatMessages([])
    setChatInput('')
    setChatLoading(false)
    setWorkMode('mission')
    setIdeaPrompt('')
    setIdeaFormat('观点文章')
    setHiddenNodeIds(new Set())
    setContextMenu(null)
    nodePositionsRef.current = new globalThis.Map()
    previousGraphNodesRef.current = []
    focusedActionBatchesRef.current = new Set()
    canvasActions.clearAllActions()
  }, [sessionKey, setNodes, setEdges, canvasActions.clearAllActions])

  // Clear hidden nodes when graph re-scans (node IDs may change)
  const graphNodeIdsRef = useRef<string>('')
  useEffect(() => {
    if (!graph) return
    const ids = graph.nodes.map((n) => n.id).join(',')
    if (ids !== graphNodeIdsRef.current) {
      graphNodeIdsRef.current = ids
      setHiddenNodeIds(new Set())
    }
  }, [graph])

  const weakNodes = useMemo(
    () => graph?.nodes.filter((node) => node.strength === 'weak') ?? [],
    [graph],
  )

  const visibleWeakNodes = useMemo(
    () => weakNodes.filter((node) => !hiddenNodeIds.has(node.id)),
    [hiddenNodeIds, weakNodes],
  )

  const visibleNudges = useMemo(
    () => nudges.filter((nudge) => !nudge.relatedParagraphs[0] || !hiddenNodeIds.has(nudge.relatedParagraphs[0])),
    [hiddenNodeIds, nudges],
  )

  const taskCount = visibleWeakNodes.length + visibleNudges.length

  const missionCards = useMemo(() => {
    const weakTasks = visibleWeakNodes.map((node) => ({
      id: `weak-${node.id}`,
      nodeId: node.id,
      title: '加强弱论点',
      body: node.label,
      tone: 'danger' as const,
    }))
    const nudgeTasks = visibleNudges.map((nudge, index) => ({
      id: `nudge-${index}`,
      nodeId: nudge.relatedParagraphs[0],
      title: nudge.severity === 'high' ? '优先处理' : '结构提醒',
      body: nudge.message,
      tone: nudge.severity === 'high' ? 'danger' as const : 'warning' as const,
    }))
    return [...weakTasks, ...nudgeTasks].slice(0, 6)
  }, [visibleNudges, visibleWeakNodes])

  const addDraftToCanvas = useCallback((suggestion: CanvasSuggestion, preferredIndex?: number) => {
    setDraftNodes((current) => {
      const index = preferredIndex ?? current.length
      const draft: DraftCanvasNode = {
        id: `draft_node_${Date.now()}_${index}`,
        type: suggestion.type,
        title: suggestion.title,
        content: suggestion.content,
        x: 80 + (index % 3) * 280,
        y: 80 + Math.floor(index / 3) * 220,
        status: 'draft',
      }
      // Delay focus until ReactFlow has processed the new node
      const t1 = window.setTimeout(() => setFocusRequest(createFocusRequest(draft.id)), 120)
      const t2 = window.setTimeout(() => setToast(null), 1600)
      timersRef.current.push(t1, t2)
      setWorkMode('map')
      setToast('已放到画布')
      return [...current, draft]
    })
  }, [])

  const appendDraftToArticle = useCallback((text: string, draftId?: string) => {
    onAppendDraft(text)
    if (draftId) {
      setDraftNodes((current) =>
        current.map((draft) => draft.id === draftId ? { ...draft, status: 'accepted' } : draft),
      )
    }
    setToast('已补全到正文')
    const t1 = window.setTimeout(onScanNow, 650)
    const t2 = window.setTimeout(() => setToast(null), 1600)
    timersRef.current.push(t1, t2)
  }, [onAppendDraft, onScanNow])

  const sendCanvasChat = useCallback(
    async (override?: string, options?: { autoPlace?: boolean }) => {
      const message = (override ?? chatInput).trim()
      if (!message || chatLoading) return null

      const userMessage: CanvasChatMessage = {
        id: `msg_${Date.now()}_user`,
        role: 'user',
        content: message,
        createdAt: Date.now(),
      }
      const history = [...chatMessages, userMessage]
      setChatMessages(history)
      setChatInput('')
      setChatLoading(true)

      try {
        const res = await fetch('/api/revision/canvas-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            history: history.slice(-8).map((item) => ({ role: item.role, content: item.content })),
            articleContext: graph?.summary ?? '',
          }),
        })
        if (!res.ok) throw new Error('chat failed')
        const data: CanvasChatResponse = await res.json()
        const suggestions = Array.isArray(data.suggestions) ? data.suggestions : []
        setChatMessages((current) => [
          ...current,
          {
            id: `msg_${Date.now()}_assistant`,
            role: 'assistant',
            content: data.reply || '我给你整理了几个草稿方向。',
            suggestions,
            createdAt: Date.now(),
          },
        ])
        if (options?.autoPlace && suggestions.length > 0) {
          suggestions.forEach((suggestion, index) => addDraftToCanvas(suggestion, index))
          setWorkMode('map')
        }
        return data
      } catch {
        setChatMessages((current) => [
          ...current,
          {
            id: `msg_${Date.now()}_assistant`,
            role: 'assistant',
            content: '这次没有生成成功，可以换一种说法再试一次。',
            createdAt: Date.now(),
          },
        ])
        return null
      } finally {
        setChatLoading(false)
      }
    },
    [addDraftToCanvas, chatInput, chatLoading, chatMessages, graph?.summary],
  )

  useEffect(() => {
    sendCanvasChatRef.current = sendCanvasChat
  }, [sendCanvasChat])

  const createIdeaMap = useCallback(() => {
    const idea = ideaPrompt.trim()
    if (!idea || chatLoading) return
    const prompt = [
      `我想写一篇${ideaFormat}。`,
      `我的原始想法是：${idea}`,
      '请不要直接代写整篇文章。请先帮我生成一张可放到画布上的构思地图：推荐主线、3-5 张论点/素材卡、2-3 个需要我补充的问题。每个建议都要短、可拖动、可继续展开。',
    ].join('\n')
    void sendCanvasChat(prompt, { autoPlace: true })
  }, [chatLoading, ideaFormat, ideaPrompt, sendCanvasChat])

  const cleanVoiceTranscript = useCallback(async (rawText: string) => {
    const normalized = rawText
      .replace(/\bcloud\s*code\b/gi, 'Claude Code')
      .replace(/\bclaude\s*code\b/gi, 'Claude Code')
      .replace(/\bcode\s*x\b/gi, 'Codex')
      .replace(/\bcodex\b/gi, 'Codex')
      .trim()

    if (!normalized) return ''

    try {
      const res = await fetch('/api/revision/clean-transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: normalized,
          domain: 'canvas-draft-chat',
          terms: ['Claude Code', 'Codex', 'ChatGPT', 'OpenAI', 'Vercel', 'GitHub'],
        }),
      })
      if (!res.ok) return normalized
      const data = await res.json()
      return typeof data.cleaned === 'string' && data.cleaned.trim() ? data.cleaned.trim() : normalized
    } catch {
      return normalized
    }
  }, [])

  const prepareVoiceTranscript = useCallback(
    async (rawText: string, mode: 'hold' | 'handsfree') => {
      const transcript = rawText.trim()
      if (!transcript) {
        setVoiceCapsule({
          phase: 'ready',
          mode,
          rawText: '',
          cleanedText: '',
          error: '没有听清，可以再说一次',
        })
        return
      }

      setVoiceCapsule((current) => ({
        ...current,
        phase: 'processing',
        mode,
        rawText: transcript,
        cleanedText: '',
        error: undefined,
      }))

      const cleaned = await cleanVoiceTranscript(transcript)
      setVoiceCapsule({
        phase: 'ready',
        mode,
        rawText: transcript,
        cleanedText: cleaned || transcript,
      })
    },
    [cleanVoiceTranscript],
  )

  useEffect(() => {
    voiceCapsuleRef.current = voiceCapsule
  }, [voiceCapsule])

  useEffect(() => {
    if (!visible) return
    requestAnimationFrame(() => canvasOverlayRef.current?.focus())
  }, [visible])

  // Memoize base graph layout — only recompute when graph/nudges/hiddenNodeIds change
  const baseLayout = useMemo(() => {
    const baseNodes: Node[] = []
    const baseEdges: Edge[] = []

    if (graph) {
      const layout = layoutGraph(graph, nudges)
      baseNodes.push(...layout.nodes.map((node) => {
        const savedPosition = nodePositionsRef.current.get(node.id)
        const position = savedPosition ? clonePosition(savedPosition) : node.position
        if (!savedPosition) nodePositionsRef.current.set(node.id, clonePosition(position))
        return { ...node, position }
      }))
      baseEdges.push(...layout.edges)
    }

    if (graph && previousGraphNodesRef.current.length > 0) {
      const currentIds = new Set(baseNodes.map((node) => node.id))
      const staleNodes = previousGraphNodesRef.current
        .filter((node) => node.type === 'argumentNode' && !currentIds.has(node.id))
        .filter((node) => {
          const data = node.data as unknown as ArgumentNodeData
          return !data.isGhost
        })
        .map((node) => {
          const staleId = `stale_${node.id}`
          const savedPosition = nodePositionsRef.current.get(node.id) ?? node.position
          return {
            ...node,
            id: staleId,
            position: clonePosition(savedPosition),
            data: {
              ...node.data,
              isStale: true,
              isSelected: false,
              isLoading: false,
              actionError: undefined,
              onAction: undefined,
            } as unknown as Record<string, unknown>,
          }
        })
      baseNodes.push(...staleNodes)
    }

    if (graph) {
      previousGraphNodesRef.current = baseNodes.filter((node) => {
        const data = node.data as unknown as ArgumentNodeData
        return node.type === 'argumentNode' && !data.isGhost && !data.isStale
      })
    }

    const visibleBaseNodes = baseNodes.filter((node) => {
      const originalId = node.id.startsWith('stale_') ? node.id.slice(6) : node.id
      return !hiddenNodeIds.has(node.id) && !hiddenNodeIds.has(originalId)
    })

    return { visibleBaseNodes, visibleBaseEdges: baseEdges }
  }, [graph, nudges, hiddenNodeIds])

  // Merge action variant nodes and draft notes into the graph
  useEffect(() => {
    const { visibleBaseNodes, visibleBaseEdges } = baseLayout

    // Find parent node positions for placing variant nodes
    const parentPositions = new Map<string, { x: number; y: number; height: number }>()
    for (const node of visibleBaseNodes) {
      if (node.type === 'argumentNode') {
        const data = node.data as unknown as ArgumentNodeData
        if (!data.isGhost) {
          parentPositions.set(node.id, {
            x: node.position.x,
            y: node.position.y,
            height: data.evidenceNote ? 160 : 120,
          })
        }
      }
    }

    // Add action variant nodes
    const variantNodes: Node[] = []
    const variantEdges: Edge[] = []
    let variantIndex = 0

    if (graph) for (const [parentId, variants] of canvasActions.actionNodes) {
      const parentPos = parentPositions.get(parentId)
      if (!parentPos) continue

      const activeVariants = variants.filter((v) => v.status !== 'dismissed' && !hiddenNodeIds.has(v.id))
      const totalWidth = activeVariants.length * 290
      const startX = parentPos.x + 160 - totalWidth / 2

      for (const variant of activeVariants) {
        const proposedPosition = {
          x: startX + variantIndex * 290,
          y: parentPos.y + parentPos.height + 60,
        }
        const savedPosition = nodePositionsRef.current.get(variant.id)
        const position = savedPosition ? clonePosition(savedPosition) : proposedPosition
        if (!savedPosition) nodePositionsRef.current.set(variant.id, clonePosition(position))

        variantNodes.push({
          id: variant.id,
          type: 'actionVariant',
          position,
          data: {
            parentId: variant.parentId,
            action: variant.action,
            text: variant.text,
            explanation: variant.explanation,
            status: variant.status,
            onAccept: () => {
              canvasActions.acceptVariant(variant.id, parentId)
              const parentNode = graph.nodes.find((n) => n.id === parentId)
              if (parentNode) {
                const ok = onAcceptVariant(parentNode.paragraph, variant.text)
                if (ok) {
                  const t1 = window.setTimeout(onScanNow, 650)
                  timersRef.current.push(t1)
                  setToast('已写回正文')
                } else {
                  setToast('段落未找到，可能已被修改')
                }
                const t2 = window.setTimeout(() => setToast(null), 1800)
                timersRef.current.push(t2)
              }
            },
            onDismiss: () => {
              canvasActions.dismissVariant(variant.id, parentId)
            },
          } as unknown as Record<string, unknown>,
        })

        const isAccepted = variant.status === 'accepted'
        variantEdges.push({
          id: `edge-${parentId}-${variant.id}`,
          source: parentId,
          target: variant.id,
          style: {
            stroke: isAccepted ? 'var(--green)' : 'var(--line)',
            strokeWidth: isAccepted ? 2 : 1,
            strokeDasharray: isAccepted ? undefined : '4 4',
          },
          animated: !isAccepted,
          markerEnd: isAccepted
            ? { type: MarkerType.ArrowClosed, color: 'var(--green)', width: 12, height: 12 }
            : undefined,
        })

        variantIndex++
      }
    }

    const selectedNodeId = canvasActions.selectedNodeId

    // Enrich base argument nodes with selection/action data
    const enrichedNodes = visibleBaseNodes.map((node) => {
      if (node.type !== 'argumentNode') return node
      const data = node.data as unknown as ArgumentNodeData
      if (data.isGhost) return node

      const acceptedCount = (canvasActions.actionNodes.get(node.id) ?? [])
        .filter((v) => v.status === 'accepted').length

      return {
        ...node,
        className: selectedNodeId
          ? selectedNodeId === node.id
            ? 'canvas-node-spotlight'
            : 'canvas-node-dimmed'
          : undefined,
        data: {
          ...node.data,
          isSelected: canvasActions.selectedNodeId === node.id,
          isLoading: canvasActions.loadingNodeIds.has(node.id),
          acceptedVariantCount: acceptedCount,
          actionError: canvasActions.errorByNode.get(node.id),
          onAction: (action: string) => {
            canvasActions.executeAction(node.id, data.paragraph, action as any, graph?.summary)
          },
          onScrollToEditor: () => {
            onNodeClick(data.paragraph)
          },
        } as unknown as Record<string, unknown>,
      }
    })

    const draftFlowNodes: Node[] = draftNodes.filter((draft) => !hiddenNodeIds.has(draft.id)).map((draft) => {
      const proposedPosition = { x: draft.x, y: draft.y }
      const savedPosition = nodePositionsRef.current.get(draft.id)
      const position = savedPosition ? clonePosition(savedPosition) : proposedPosition
      if (!savedPosition) nodePositionsRef.current.set(draft.id, clonePosition(position))
      return {
        id: draft.id,
        type: 'draftNote',
        position,
        data: {
          title: draft.title,
          content: draft.content,
          type: draft.type,
          status: draft.status,
          onAppendToArticle: () => appendDraftToArticle(draft.content, draft.id),
          onExpand: () => {
            setChatInput(`请继续展开这张草稿卡：${draft.title}\n${draft.content}`)
          },
        } satisfies DraftNoteData as unknown as Record<string, unknown>,
      }
    })

    const focusedBaseEdges = selectedNodeId
      ? visibleBaseEdges.map((edge) => {
          const related = edge.source === selectedNodeId || edge.target === selectedNodeId
          return {
            ...edge,
            className: related ? 'canvas-edge-spotlight' : 'canvas-edge-dimmed',
            style: {
              ...edge.style,
              opacity: related ? 1 : 0.12,
            },
          }
        })
      : visibleBaseEdges

    setNodes([...enrichedNodes, ...variantNodes, ...draftFlowNodes])
    setEdges([...focusedBaseEdges, ...variantEdges])
  }, [
    baseLayout,
    canvasActions.actionNodes,
    canvasActions.selectedNodeId,
    canvasActions.loadingNodeIds,
    canvasActions.errorByNode,
    draftNodes,
    appendDraftToArticle,
    onAcceptVariant,
    onNodeClick,
    onScanNow,
    setNodes,
    setEdges,
  ])

  const handleNodesChange = useCallback((changes: any[]) => {
    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        nodePositionsRef.current.set(change.id, clonePosition(change.position))
      }
      if (change.type === 'dimensions' && change.position) {
        nodePositionsRef.current.set(change.id, clonePosition(change.position))
      }
    }
    onNodesChange(changes)
  }, [onNodesChange])

  useEffect(() => {
    let focusId: string | null = null

    for (const variants of canvasActions.actionNodes.values()) {
      const pending = variants.find((variant) => variant.status === 'pending')
      if (pending && !focusedActionBatchesRef.current.has(pending.batchId)) {
        focusedActionBatchesRef.current.add(pending.batchId)
        focusId = pending.id
        break
      }
    }

    if (!focusId) return
    const timeout = window.setTimeout(() => {
      setFocusRequest(createFocusRequest(focusId))
    }, 80)
    return () => window.clearTimeout(timeout)
  }, [canvasActions.actionNodes])

  const deleteCanvasNode = useCallback((nodeId: string) => {
    setContextMenu(null)
    setFocusRequest(null)

    if (nodeId.startsWith('draft_node_')) {
      setDraftNodes((current) => current.filter((draft) => draft.id !== nodeId))
    } else {
      let removedAction = false
      for (const [parentId, variants] of canvasActions.actionNodes) {
        if (variants.some((variant) => variant.id === nodeId)) {
          canvasActions.dismissVariant(nodeId, parentId)
          removedAction = true
          break
        }
      }

      if (!removedAction) {
        setHiddenNodeIds((current) => {
          const next = new Set(current)
          next.add(nodeId)
          if (nodeId.startsWith('stale_')) next.add(nodeId.slice(6))
          return next
        })
      }
    }

    if (canvasActions.selectedNodeId === nodeId) {
      canvasActions.clearSelection()
    }
  }, [canvasActions])

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const nodeData = node.data as unknown as ArgumentNodeData
      if (nodeData.isGhost) return

      // Action variant nodes have their own buttons, don't select them
      if (node.type === 'actionVariant') {
        setContextMenu(null)
        return
      }

      // Toggle selection for argument nodes
      canvasActions.selectNode(node.id)
      setContextMenu(null)
      setWorkMode('focus')
    },
    [canvasActions],
  )

  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault()
      event.stopPropagation()
      const data = node.data as any
      const label =
        typeof data?.label === 'string' && data.label
          ? data.label
          : typeof data?.title === 'string' && data.title
            ? data.title
            : node.type === 'actionVariant'
              ? 'AI 候选卡'
              : '画布卡片'
      canvasActions.selectNode(node.id)
      setContextMenu({ nodeId: node.id, x: event.clientX, y: event.clientY, label })
    },
    [canvasActions],
  )

  const handlePaneClick = useCallback(() => {
    canvasActions.clearSelection()
    setContextMenu(null)
  }, [canvasActions])

  const hasActionNodes = canvasActions.actionNodes.size > 0
  const scoreLabel = graph ? coherenceLabel(graph.coherenceScore) : null

  const focusWeakNode = useCallback(() => {
    const firstWeak = visibleWeakNodes[0] ?? graph?.nodes.find((node) => !hiddenNodeIds.has(node.id))
    if (!firstWeak) return
    canvasActions.selectNode(firstWeak.id)
    setFocusRequest(createFocusRequest(firstWeak.id))
  }, [canvasActions, graph?.nodes, hiddenNodeIds, visibleWeakNodes])

  const focusTask = useCallback(
    (nodeId: string | undefined) => {
      if (!nodeId) return
      canvasActions.selectNode(nodeId)
      setFocusRequest(createFocusRequest(nodeId))
      setWorkMode('focus')
    },
    [canvasActions],
  )


  useEffect(() => {
    if (!visible) return
    const pressed = new Set<string>()

    const isEditableTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null
      const editable = el?.closest('input, textarea, [contenteditable="true"]')
      return !!editable && !!editable.closest('.canvas-overlay')
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return
      pressed.add(event.code)

      if (event.key === 'Escape') {
        setContextMenu(null)
        return
      }

      if ((event.key === 'Backspace' || event.key === 'Delete') && canvasActions.selectedNodeId) {
        event.preventDefault()
        deleteCanvasNode(canvasActions.selectedNodeId)
        return
      }

      if (event.code === 'KeyR' && voiceCapsuleRef.current.phase === 'ready') {
        event.preventDefault()
        const message = voiceCapsuleRef.current.cleanedText.trim()
        if (message) {
          setVoiceCapsule(emptyVoiceCapsule)
          setVoiceMode('idle')
          void sendCanvasChatRef.current(message)
        }
        return
      }

      if (event.code === 'KeyF' && voiceCapsuleRef.current.phase === 'ready') {
        event.preventDefault()
        const message = voiceCapsuleRef.current.cleanedText.trim()
        if (message) setChatInput(message)
        setVoiceCapsule(emptyVoiceCapsule)
        setVoiceMode('idle')
        return
      }

      if (event.code !== 'Space') return
      event.preventDefault()

      if (pressed.has('KeyV')) {
        setVoiceMode((current) => {
          const next = current === 'handsfree' ? 'idle' : 'handsfree'
          if (next === 'handsfree' && voiceSupported) {
            setVoiceCapsule({ ...emptyVoiceCapsule, phase: 'recording', mode: 'handsfree' })
            startRecording(
              (text) => setVoiceCapsule((capsule) => ({ ...capsule, rawText: text })),
              (error) => setToast(error),
            )
          } else {
            const text = stopRecording()
            void prepareVoiceTranscript(text, 'handsfree')
          }
          playVoiceCue('handsfree')
          return next
        })
        return
      }

      setVoiceMode((current) => {
        if (current !== 'hold') {
          playVoiceCue('hold')
          setVoiceCapsule({ ...emptyVoiceCapsule, phase: 'recording', mode: 'hold' })
          if (voiceSupported) {
            startRecording(
              (text) => setVoiceCapsule((capsule) => ({ ...capsule, rawText: text })),
              (error) => setToast(error),
            )
          }
        }
        return 'hold'
      })
    }

    const onKeyUp = (event: KeyboardEvent) => {
      pressed.delete(event.code)
      if (event.code === 'Space') {
        setVoiceMode((current) => {
          if (current !== 'hold') return current
          const text = stopRecording()
          void prepareVoiceTranscript(text, 'hold')
          return 'idle'
        })
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      stopRecording()
    }
  }, [
    visible,
    canvasActions.selectedNodeId,
    deleteCanvasNode,
    prepareVoiceTranscript,
    voiceSupported,
  ])

  if (!visible) return null

  return (
    <div className="canvas-overlay" ref={canvasOverlayRef} tabIndex={-1}>
      {/* Top bar */}
      <div className="canvas-topbar">
        <button type="button" className="canvas-back-btn" onClick={onClose}>
          <ArrowLeft size={15} />
          返回编辑
        </button>

        <div className="canvas-topbar-center">
          <span className="canvas-title">论证工作台</span>
        {graph && (
            <span className="canvas-summary-pill">
              {taskCount} 个结构任务 · {weakNodes.length} 个弱点
            </span>
          )}
          {isScanning && <ChickenProgress compact label="分析中..." />}
        </div>

          {graph && (
            <div className="canvas-mode-switch" aria-label="画布视图">
              <button type="button" className={workMode === 'mission' ? 'active' : ''} onClick={() => setWorkMode('mission')}>
                <ListChecks size={12} />
                任务板
              </button>
              <button type="button" className={workMode === 'focus' ? 'active' : ''} onClick={() => setWorkMode('focus')}>
                <Crosshair size={12} />
                聚焦
              </button>
              <button type="button" className={workMode === 'map' ? 'active' : ''} onClick={() => setWorkMode('map')}>
                <MapIcon size={12} />
                地图
              </button>
            </div>
          )}
        <div className="canvas-topbar-right">
          <button
            type="button"
            className="canvas-tool-btn"
            onClick={onScanNow}
            disabled={isScanning}
            title="重新扫描文章结构"
          >
            <RefreshCw size={13} className={isScanning ? 'spin' : ''} />
            重新扫描
          </button>
          <button
            type="button"
            className="canvas-tool-btn"
            onClick={focusWeakNode}
            disabled={!graph}
            title="定位第一个弱点"
          >
            <Crosshair size={13} />
            定位弱点
          </button>
          {hasActionNodes && (
            <button
              type="button"
              className="canvas-clear-btn"
              onClick={canvasActions.clearAllActions}
              title="清除所有 AI 操作"
            >
              <Trash2 size={13} />
              清除操作
            </button>
          )}
          {graph && scoreLabel && (
            <span className="canvas-score-pill" style={{ color: scoreLabel.color }}>
              <Zap size={12} />
              {Math.round(graph.coherenceScore * 100)}%
            </span>
          )}
          <button type="button" className="canvas-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </div>

      {/* ReactFlow canvas */}
      <div className="canvas-body">
          <div className={`canvas-workspace ${taskRailOpen ? '' : 'task-rail-collapsed'}`}>
            <aside className="canvas-task-rail">
              <div className="canvas-task-rail-header">
                <span>{taskRailOpen ? '结构任务' : '任务'}</span>
                <button type="button" onClick={() => setTaskRailOpen((open) => !open)}>
                  {taskRailOpen ? '收起' : '展开'}
                </button>
              </div>
              {taskRailOpen && (
                <>
                  <div className="canvas-task-rail-count">
                    <strong>{taskCount}</strong>
                    <span>待处理</span>
                  </div>
                  <div className="canvas-task-list">
                    {visibleWeakNodes.map((node, index) => (
                      <button
                        type="button"
                        key={`weak-${node.id}`}
                        className="canvas-task-item weak"
                        onClick={() => focusTask(node.id)}
                      >
                        <span>{index + 1}</span>
                        <div>
                          <strong>加强弱论点</strong>
                          <p>{node.label}</p>
                        </div>
                      </button>
                    ))}
                    {visibleNudges.map((nudge, index) => (
                      <button
                        type="button"
                        key={`${nudge.type}-${index}`}
                        className={`canvas-task-item ${nudge.severity}`}
                        onClick={() => focusTask(nudge.relatedParagraphs[0])}
                      >
                        <span>{visibleWeakNodes.length + index + 1}</span>
                        <div>
                          <strong>{nudge.severity === 'high' ? '优先处理' : '结构提醒'}</strong>
                          <p>{nudge.message}</p>
                        </div>
                      </button>
                    ))}
                    {draftNodes.map((draft, index) => (
                      <button
                        type="button"
                        key={`draft-list-${draft.id}`}
                        className="canvas-task-item draft"
                        onClick={() => setFocusRequest(createFocusRequest(draft.id))}
                      >
                        <span>{visibleWeakNodes.length + visibleNudges.length + index + 1}</span>
                        <div>
                          <strong>{draft.title}</strong>
                          <p>{draft.content}</p>
                        </div>
                      </button>
                    ))}
                    {taskCount === 0 && draftNodes.length === 0 && (
                      <div className="canvas-task-empty">
                        <CheckCircle2 size={15} />
                        先和右侧 AI 聊一个主题
                      </div>
                    )}
                  </div>
                </>
              )}
            </aside>

            <div className={`canvas-flow-area mode-${workMode}`}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={handleNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={handleNodeClick}
              onNodeContextMenu={handleNodeContextMenu}
              onPaneClick={handlePaneClick}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.3 }}
              minZoom={0.3}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
              panOnDrag
              panOnScroll
              panOnScrollMode={PanOnScrollMode.Vertical}
              zoomOnScroll
              zoomActivationKeyCode="Control"
              selectionOnDrag
            >
              <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--line)" />
              <Controls showInteractive={false} />
              <MiniMap
                nodeColor={(node) => {
                  if (node.type === 'actionVariant') return 'rgba(185, 129, 36, 0.5)'
                  if (node.type === 'draftNote') return 'rgba(185, 129, 36, 0.35)'
                  const data = node.data as unknown as ArgumentNodeData
                  if (data.isGhost) return 'rgba(168, 64, 53, 0.3)'
                  switch (data.role) {
                    case 'claim': return '#b98124'
                    case 'evidence': return '#286a42'
                    case 'counterargument': return '#a84035'
                    case 'conclusion': return '#523511'
                    default: return '#747067'
                  }
                }}
                maskColor="rgba(0,0,0,0.1)"
                style={{ background: 'var(--surface)' }}
              />
              <CanvasKeyboardHandler onEscape={canvasActions.clearSelection} />
              <CanvasFocusController focusRequest={focusRequest} />
            </ReactFlow>

              {graph && workMode === 'mission' && (
                <div className="canvas-mission-overlay">
                  <div className="canvas-mission-header">
                    <span>
                      <ListChecks size={15} />
                      这篇文章先处理这些任务
                    </span>
                    <button type="button" onClick={() => setWorkMode('map')}>
                      查看完整地图
                    </button>
                  </div>
                  <div className="canvas-mission-grid">
                    {missionCards.length > 0 ? missionCards.map((mission, index) => (
                      <button
                        type="button"
                        className={`canvas-mission-card ${mission.tone}`}
                        key={mission.id}
                        onClick={() => focusTask(mission.nodeId)}
                      >
                        <span>{index + 1}</span>
                        <div>
                          <strong>{mission.title}</strong>
                          <p>{mission.body}</p>
                        </div>
                      </button>
                    )) : (
                      <div className="canvas-mission-clear">
                        <CheckCircle2 size={18} />
                        暂时没有明显结构任务，可以切到地图继续整理草稿。
                      </div>
                    )}
                  </div>
                </div>
              )}

              {!graph && draftNodes.length === 0 && (
                <div className="canvas-empty-overlay">
                  <ChickenProgress stage={isScanning ? 'mapping' : 'reading'} label={isScanning ? '正在生成论证地图' : '还没有论证地图'} />
                  <p>先在右侧输入一个主题，或者按住 Space 说出你的想法。</p>
                  {scanError && !isScanning && (
                    <div className="canvas-empty-error">
                      {scanError}
                    </div>
                  )}
                  <div className="canvas-ideation-panel">
                    <div className="canvas-ideation-kicker">
                      <Lightbulb size={14} />
                      空白画布是构思场
                    </div>
                    <h3>先把一个想法变成可操作的写作地图</h3>
                    <textarea
                      value={ideaPrompt}
                      onChange={(event) => setIdeaPrompt(event.target.value)}
                      placeholder="例如：我想写一篇关于 Claude Code 如何改变个人开发者工作方式的文章"
                      rows={3}
                    />
                    <div className="canvas-idea-formats">
                      {(['观点文章', '技术博客', '产品文案', '演讲稿'] as IdeaFormat[]).map((format) => (
                        <button
                          type="button"
                          className={ideaFormat === format ? 'active' : ''}
                          key={format}
                          onClick={() => setIdeaFormat(format)}
                        >
                          {format}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="canvas-ideation-submit"
                      onClick={createIdeaMap}
                      disabled={chatLoading || !ideaPrompt.trim()}
                    >
                      <Wand2 size={14} />
                      {chatLoading ? '正在生成构思地图' : '生成构思地图'}
                    </button>
                  </div>
                  <div className={`canvas-voice-primer ${voiceMode !== 'idle' ? 'active' : ''}`}>
                    <div className="canvas-voice-orb" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </div>
                    <div className="canvas-voice-copy">
                      <strong>
                        {voiceMode === 'handsfree'
                          ? '免提记录中'
                          : voiceMode === 'hold'
                            ? '正在听你说'
                            : '也可以先说出你的想法'}
                      </strong>
                      <p>
                        {voiceMode === 'handsfree'
                          ? '再次按 V + Space 关闭免提。'
                          : '按住 Space 说话，V + Space 开启免提模式。'}
                      </p>
                    </div>
                  </div>
                  <button type="button" className="canvas-empty-scan-btn" onClick={onScanNow} disabled={isScanning}>
                    <RefreshCw size={13} className={isScanning ? 'spin' : ''} />
                    {isScanning ? '扫描中' : '扫描已有正文'}
                  </button>
                </div>
              )}
              {voiceCapsule.phase !== 'idle' && (
                <div className={`canvas-voice-capsule ${voiceCapsule.phase} ${voiceCapsule.mode}`}>
                  <div className="canvas-voice-capsule-meter" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="canvas-voice-capsule-copy">
                    <strong>
                      {voiceCapsule.phase === 'recording'
                        ? voiceCapsule.mode === 'handsfree' ? '免提记录中' : '正在听你说'
                        : voiceCapsule.phase === 'processing'
                          ? '正在整理语音'
                          : voiceCapsule.error ? '这次没听清' : '按 R 发送，按 F 修改'}
                    </strong>
                    <p>
                      {voiceCapsule.phase === 'recording'
                        ? (voiceCapsule.rawText || '说出你的想法，Revision Lens 会先帮你整理。')
                        : voiceCapsule.phase === 'processing'
                          ? (voiceCapsule.rawText || '正在理解你的意思...')
                          : (voiceCapsule.error || voiceCapsule.cleanedText)}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <CanvasChatPanel
              messages={chatMessages}
              input={chatInput}
              loading={chatLoading}
              voiceActive={voiceMode !== 'idle'}
              voiceSupported={voiceSupported}
              onInputChange={setChatInput}
              onSend={() => void sendCanvasChat()}
              onAddToCanvas={addDraftToCanvas}
              onAppendToArticle={(text) => appendDraftToArticle(text)}
            />
          </div>
      </div>

      {contextMenu && (
        <div
          className="canvas-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <span title={contextMenu.label}>{contextMenu.label}</span>
          <button type="button" onClick={() => deleteCanvasNode(contextMenu.nodeId)}>
            <Trash2 size={13} />
            删除
          </button>
        </div>
      )}

      {toast && (
        <div className="canvas-toast">
          <CheckCircle2 size={14} />
          {toast}
        </div>
      )}
    </div>
  )
}
