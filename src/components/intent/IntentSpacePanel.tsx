import { RefreshCw, Target, Users, BookOpen, Palette, Lock, AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { IntentMap, IntentNode, IntentNodeType } from '../../services/ai/intentMapper'

interface Props {
  intentMap: IntentMap | null
  isScanning: boolean
  scanStage: string
  scanError: string | null
  onScanNow: () => void
}

const typeLabels: Record<IntentNodeType, string> = {
  goal: '写作目标',
  theme: '核心主题',
  audience: '目标受众',
  tone: '语气风格',
  constraint: '约束条件',
}

const typeColors: Record<IntentNodeType, string> = {
  goal: '#286a42',
  theme: '#b98124',
  audience: '#523511',
  tone: '#747067',
  constraint: '#a84035',
}

const typeIcons: Record<IntentNodeType, React.ReactNode> = {
  goal: <Target size={13} />,
  theme: <BookOpen size={13} />,
  audience: <Users size={13} />,
  tone: <Palette size={13} />,
  constraint: <Lock size={13} />,
}

const relationLabels: Record<string, string> = {
  supports: '支撑',
  conflicts: '冲突',
  depends: '依赖',
  enables: '促成',
}

const relationColors: Record<string, string> = {
  supports: '#286a42',
  conflicts: '#a84035',
  depends: '#b98124',
  enables: '#523511',
}

function stageLabel(stage: string) {
  switch (stage) {
    case 'preparing': return '准备中...'
    case 'requesting': return '分析中...'
    case 'parsing': return '解析结果...'
    case 'done': return '已完成'
    case 'error': return '出错'
    default: return ''
  }
}

export default function IntentSpacePanel({ intentMap, isScanning, scanStage, scanError, onScanNow }: Props) {
  return (
    <div className="intent-panel">
      {/* Header */}
      <div className="intent-panel-header">
        <span className="intent-panel-title">
          <Target size={14} />
          意图空间
        </span>
      </div>

      {/* Scan status bar */}
      <div className="scan-status-bar">
        <div className="scan-status-left">
          {isScanning ? (
            <span className="scan-stage-label">{stageLabel(scanStage)}</span>
          ) : scanError ? (
            <>
              <AlertTriangle size={12} style={{ color: 'var(--red)' }} />
              <span className="scan-stage-label" style={{ color: 'var(--red)' }}>{scanError}</span>
            </>
          ) : intentMap ? (
            <>
              <CheckCircle2 size={12} style={{ color: 'var(--green)' }} />
              <span className="scan-stage-label">已分析</span>
            </>
          ) : (
            <span className="scan-stage-label">等待首次扫描</span>
          )}
        </div>
        <button
          type="button"
          className={`scan-trigger-btn ${scanError ? 'scan-trigger-retry' : ''}`}
          onClick={onScanNow}
          disabled={isScanning}
        >
          <RefreshCw size={12} className={isScanning ? 'spin' : ''} />
          {scanError ? '重试' : isScanning ? '扫描中' : '扫描'}
        </button>
      </div>

      {/* Content */}
      {!intentMap ? (
        <div className="intent-empty">
          <Target size={28} style={{ opacity: 0.3 }} />
          <p>{isScanning ? '正在分析写作意图...' : '开始写作后，AI 会自动分析你的写作意图。'}</p>
        </div>
      ) : (
        <div className="intent-content">
          {/* Writing goal */}
          {intentMap.writingGoal && (
            <div className="intent-goal-card">
              <Target size={14} />
              <span>{intentMap.writingGoal}</span>
            </div>
          )}

          {/* Summary */}
          {intentMap.summary && (
            <div className="intent-summary">{intentMap.summary}</div>
          )}

          {/* Intent nodes by type */}
          {intentMap.nodes.length > 0 && (
            <div className="intent-section">
              <h4 className="intent-section-title">写作意图</h4>
              <div className="intent-node-list">
                {intentMap.nodes.map((node) => (
                  <IntentNodeCard key={node.id} node={node} />
                ))}
              </div>
            </div>
          )}

          {/* Intent edges / relations */}
          {intentMap.edges.length > 0 && (
            <div className="intent-section">
              <h4 className="intent-section-title">意图关系</h4>
              <div className="intent-edge-list">
                {intentMap.edges.map((edge) => {
                  const fromNode = intentMap.nodes.find((n) => n.id === edge.from)
                  const toNode = intentMap.nodes.find((n) => n.id === edge.to)
                  if (!fromNode || !toNode) return null
                  return (
                    <div key={`${edge.from}-${edge.to}-${edge.relation}`} className="intent-edge-item">
                      <span className="intent-edge-from">{fromNode.label}</span>
                      <span
                        className="intent-edge-relation"
                        style={{ color: relationColors[edge.relation] || '#747067' }}
                      >
                        {relationLabels[edge.relation] || edge.relation}
                      </span>
                      <span className="intent-edge-to">{toNode.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function IntentNodeCard({ node }: { node: IntentNode }) {
  const color = typeColors[node.type] || '#747067'
  return (
    <div className="intent-node-card" style={{ borderLeftColor: color }}>
      <div className="intent-node-header">
        <span className="intent-node-type" style={{ color, borderColor: color }}>
          {typeIcons[node.type]}
          {typeLabels[node.type] || node.type}
        </span>
        <span className="intent-node-confidence" style={{ opacity: 0.6 }}>
          {Math.round(node.confidence * 100)}%
        </span>
      </div>
      <strong className="intent-node-label">{node.label}</strong>
      {node.description && (
        <p className="intent-node-desc">{node.description}</p>
      )}
    </div>
  )
}
