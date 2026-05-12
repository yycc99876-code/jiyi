import { motion } from 'framer-motion'
import type { IntentNode, IntentEdge } from '../../services/ai/intentMapper'

interface Props {
  nodes: IntentNode[]
  edges: IntentEdge[]
  onNodeClick: (node: IntentNode) => void
  activeNodeId: string | null
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

export default function ArticleMap({ nodes, edges, onNodeClick, activeNodeId }: Props) {
  if (nodes.length === 0) return null

  const nodeMap = new Map(nodes.map((n) => [n.id, n]))

  return (
    <div className="article-map">
      <div className="map-nodes">
        {nodes.map((node, i) => {
          const incomingEdges = edges.filter((e) => e.to === node.id)

          return (
            <motion.div
              key={node.id}
              className={`map-node ${activeNodeId === node.id ? 'active' : ''}`}
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
                  <strong>{node.label}</strong>
                  <small>{node.paragraph.slice(0, 60)}{node.paragraph.length > 60 ? '...' : ''}</small>
                </div>
              </button>

              {/* Incoming edge labels */}
              {incomingEdges.length > 0 && (
                <div className="map-node-edges">
                  {incomingEdges.map((edge) => {
                    const fromNode = nodeMap.get(edge.from)
                    return (
                      <span key={`${edge.from}-${edge.to}`} className={`map-edge-tag ${edge.relation}`}>
                        {fromNode?.label.slice(0, 8)} → {relationLabel(edge.relation)}
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
