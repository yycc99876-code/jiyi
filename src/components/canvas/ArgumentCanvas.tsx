import { useCallback, useEffect, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  MarkerType,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from 'dagre'
import { X, ArrowLeft, Zap } from 'lucide-react'
import ArgumentNodeCard from './ArgumentNodeCard'
import type { ArgumentNodeData } from './ArgumentNodeCard'
import type { ArgumentGraph, StructuralNudge } from '../../services/ai/coherenceTypes'

interface Props {
  graph: ArgumentGraph | null
  nudges: StructuralNudge[]
  isScanning: boolean
  onClose: () => void
  onNodeClick: (paragraph: string) => void
}

const nodeTypes = { argumentNode: ArgumentNodeCard }

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
      const relatedNode = nudge.relatedParagraphs[0]
      if (relatedNode && graph.nodes.some((n) => n.id === relatedNode)) {
        dagreGraph.setNode(ghostId, { width: 200, height: 80 })
        dagreGraph.setEdge(relatedNode, ghostId, { weight: 1 })
        ghostNodes.push({ id: ghostId, message: nudge.message, relatedTo: relatedNode })
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

export default function ArgumentCanvas({ graph, nudges, isScanning, onClose, onNodeClick }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[])
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[])
  const [_expandedNodeId, setExpandedNodeId] = useState<string | null>(null)

  // Layout when graph changes
  useEffect(() => {
    if (!graph) return
    const { nodes: layoutedNodes, edges: layoutedEdges } = layoutGraph(graph, nudges)
    setNodes(layoutedNodes)
    setEdges(layoutedEdges)
  }, [graph, nudges, setNodes, setEdges])

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const nodeData = node.data as unknown as ArgumentNodeData
      if (nodeData.isGhost) return
      // Exit canvas and scroll to paragraph
      onNodeClick(nodeData.paragraph)
      onClose()
    },
    [onNodeClick, onClose],
  )

  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setExpandedNodeId((prev) => (prev === node.id ? null : node.id))
    },
    [],
  )

  const handlePaneClick = useCallback(() => {
    setExpandedNodeId(null)
  }, [])

  const scoreLabel = graph ? coherenceLabel(graph.coherenceScore) : null

  return (
    <div className="canvas-overlay">
      {/* Top bar */}
      <div className="canvas-topbar">
        <button type="button" className="canvas-back-btn" onClick={onClose}>
          <ArrowLeft size={15} />
          返回编辑
        </button>

        <div className="canvas-topbar-center">
          <span className="canvas-title">论证拓扑</span>
          {isScanning && <span className="canvas-scanning">分析中...</span>}
        </div>

        <div className="canvas-topbar-right">
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
        {!graph ? (
          <div className="canvas-empty">
            <p>开始写作后，AI 会自动生成论证拓扑图。</p>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            onNodeDoubleClick={handleNodeDoubleClick}
            onPaneClick={handlePaneClick}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            minZoom={0.3}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--line)" />
            <Controls showInteractive={false} />
            <MiniMap
              nodeColor={(node) => {
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
          </ReactFlow>
        )}
      </div>
    </div>
  )
}
