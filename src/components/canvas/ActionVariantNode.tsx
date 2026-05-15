import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Check, X } from 'lucide-react'
import type { CanvasActionType } from '../../services/ai/coherenceTypes'

export interface ActionVariantData {
  parentId: string
  action: CanvasActionType
  text: string
  explanation: string
  status: 'pending' | 'accepted' | 'dismissed'
  onAccept: () => void
  onDismiss: () => void
}

const actionLabels: Record<CanvasActionType, string> = {
  strengthen: '加强论点',
  counterargument: '找反论',
  evidence: '补充论据',
  rewrite: '改写',
}

const actionColors: Record<CanvasActionType, string> = {
  strengthen: 'var(--green)',
  counterargument: 'var(--red)',
  evidence: 'var(--accent)',
  rewrite: 'var(--accent-ink)',
}

export default function ActionVariantNode({ data }: NodeProps) {
  const d = data as unknown as ActionVariantData
  const { action, text, explanation, status, onAccept, onDismiss } = d

  if (status === 'dismissed') return null

  return (
    <div className={`action-variant-node ${action} ${status === 'accepted' ? 'accepted' : ''}`}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />

      <span
        className="action-variant-badge"
        style={{ color: actionColors[action], borderColor: actionColors[action] }}
      >
        {actionLabels[action]}
      </span>

      <p className="action-variant-text">
        {text.length > 150 ? `${text.slice(0, 150)}...` : text}
      </p>

      {explanation && (
        <span className="action-variant-explanation">{explanation}</span>
      )}

      {status === 'accepted' ? (
        <div className="action-variant-accepted">
          <Check size={12} />
          <span>已接受</span>
        </div>
      ) : (
        <div className="action-variant-actions">
          <button
            className="action-variant-btn accept"
            onClick={(e) => {
              e.stopPropagation()
              onAccept()
            }}
            type="button"
          >
            <Check size={12} />
            写回正文
          </button>
          <button
            className="action-variant-btn dismiss"
            onClick={(e) => {
              e.stopPropagation()
              onDismiss()
            }}
            type="button"
          >
            <X size={12} />
            忽略
          </button>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
}
