import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ShieldQuestion, ArrowUpRight } from 'lucide-react'
import type { ArgumentNode, ArgumentEdge } from '../../services/ai/coherenceTypes'

interface Props {
  nodes: ArgumentNode[]
  edges: ArgumentEdge[]
  onNodeClick: (node: ArgumentNode) => void
  onChallengeEdge: (from: string, to: string) => void
  onStrengthenNode: (nodeId: string) => void
}

function strengthColor(strength: string) {
  switch (strength) {
    case 'strong':
      return 'var(--green)'
    case 'medium':
      return 'var(--accent)'
    case 'weak':
      return 'var(--red)'
    default:
      return 'var(--muted)'
  }
}

function relationLabel(relation: string) {
  switch (relation) {
    case 'supports':
      return '支撑'
    case 'contradicts':
      return '矛盾'
    case 'extends':
      return '递进'
    case 'weakens':
      return '弱化'
    default:
      return relation
  }
}

function roleLabel(role: string) {
  switch (role) {
    case 'claim':
      return '论点'
    case 'evidence':
      return '论据'
    case 'counterargument':
      return '反论'
    case 'transition':
      return '过渡'
    case 'conclusion':
      return '结论'
    default:
      return role
  }
}

function roleColor(role: string) {
  switch (role) {
    case 'claim':
      return 'var(--accent)'
    case 'evidence':
      return 'var(--green)'
    case 'counterargument':
      return 'var(--red)'
    case 'transition':
      return 'var(--muted)'
    case 'conclusion':
      return 'var(--accent-ink)'
    default:
      return 'var(--muted)'
  }
}

export default function ArticleMap({ nodes, edges, onNodeClick, onChallengeEdge, onStrengthenNode }: Props) {
  const [expandedEdge, setExpandedEdge] = useState<string | null>(null)

  if (nodes.length === 0) return null

  const nodeMap = new Map(nodes.map((n) => [n.id, n]))

  return (
    <div className="article-map">
      <div className="map-nodes">
        {nodes.map((node, i) => {
          const incomingEdges = edges.filter((e) => e.to === node.id)
          const isWeak = node.strength === 'weak'

          return (
            <motion.div
              key={node.id}
              className={`map-node ${isWeak ? 'map-node-weak' : ''}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <button
                type="button"
                className="map-node-btn"
                onClick={() => onNodeClick(node)}
              >
                <span
                  className="map-node-strength"
                  style={{ background: strengthColor(node.strength) }}
                />
                <div className="map-node-content">
                  <div className="map-node-label-row">
                    <strong>{node.label}</strong>
                    <span className="map-node-role" style={{ color: roleColor(node.role), borderColor: roleColor(node.role) }}>
                      {roleLabel(node.role)}
                    </span>
                  </div>
                  <small>{node.paragraph.slice(0, 60)}{node.paragraph.length > 60 ? '...' : ''}</small>
                  {node.evidenceNote && (
                    <span className="map-node-evidence-note">{node.evidenceNote}</span>
                  )}
                </div>
              </button>

              {/* Strengthen button for weak nodes */}
              {isWeak && (
                <div className="map-node-strengthen">
                  <button
                    type="button"
                    className="strengthen-btn"
                    onClick={() => onStrengthenNode(node.id)}
                  >
                    <ArrowUpRight size={12} />
                    加强此论点
                  </button>
                </div>
              )}

              {/* Incoming edge labels */}
              {incomingEdges.length > 0 && (
                <div className="map-node-edges">
                  {incomingEdges.map((edge) => {
                    const fromNode = nodeMap.get(edge.from)
                    const edgeKey = `${edge.from}-${edge.to}`
                    const isExpanded = expandedEdge === edgeKey

                    return (
                      <span key={edgeKey} className="map-edge-wrapper">
                        <button
                          type="button"
                          className={`map-edge-tag ${edge.relation} ${edge.explanation ? 'has-explanation' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setExpandedEdge(isExpanded ? null : edgeKey)
                          }}
                        >
                          {fromNode?.label.slice(0, 8)} &rarr; {relationLabel(edge.relation)}
                        </button>
                        <AnimatePresence>
                          {isExpanded && edge.explanation && (
                            <motion.div
                              className="map-edge-tooltip"
                              initial={{ opacity: 0, y: -4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              transition={{ duration: 0.15 }}
                            >
                              <p>{edge.explanation}</p>
                              <button
                                type="button"
                                className="challenge-edge-btn"
                                onClick={() => onChallengeEdge(edge.from, edge.to)}
                              >
                                <ShieldQuestion size={11} />
                                质疑此关系
                              </button>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </span>
                    )
                  })}
                </div>
              )}
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
