import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ArrowUpRight } from 'lucide-react'

export interface ArgumentNodeData {
  label: string
  paragraph: string
  strength: 'strong' | 'medium' | 'weak'
  role: 'claim' | 'evidence' | 'counterargument' | 'transition' | 'conclusion'
  evidenceNote?: string
  isGhost?: boolean
  ghostMessage?: string
}

function roleLabel(role: string) {
  switch (role) {
    case 'claim': return '论点'
    case 'evidence': return '论据'
    case 'counterargument': return '反论'
    case 'transition': return '过渡'
    case 'conclusion': return '结论'
    default: return role
  }
}

function roleColor(role: string) {
  switch (role) {
    case 'claim': return '#b98124'
    case 'evidence': return '#286a42'
    case 'counterargument': return '#a84035'
    case 'transition': return '#747067'
    case 'conclusion': return '#523511'
    default: return '#747067'
  }
}

function strengthBorder(strength: string) {
  switch (strength) {
    case 'strong': return '2px solid rgba(40, 106, 66, 0.6)'
    case 'medium': return '2px solid rgba(185, 129, 36, 0.6)'
    case 'weak': return '2px dashed rgba(168, 64, 53, 0.6)'
    default: return '2px solid var(--line)'
  }
}

export default function ArgumentNodeCard({ data, selected }: NodeProps) {
  const nodeData = data as unknown as ArgumentNodeData
  const { label, paragraph, strength, role, evidenceNote, isGhost, ghostMessage } = nodeData

  if (isGhost) {
    return (
      <div className="argument-node argument-node-ghost">
        <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
        <div className="argument-node-ghost-body">
          <span className="argument-node-ghost-icon">?</span>
          <p>{ghostMessage || '这里需要补充内容'}</p>
        </div>
        <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      </div>
    )
  }

  return (
    <div
      className={`argument-node ${selected ? 'selected' : ''} strength-${strength}`}
      style={{ border: strengthBorder(strength) }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />

      <div className="argument-node-header">
        <span
          className="argument-node-role"
          style={{ color: roleColor(role), borderColor: roleColor(role) }}
        >
          {roleLabel(role)}
        </span>
        <span className={`argument-node-strength strength-dot-${strength}`} />
      </div>

      <strong className="argument-node-label">{label}</strong>

      <p className="argument-node-paragraph">
        {paragraph.length > 100 ? `${paragraph.slice(0, 100)}...` : paragraph}
      </p>

      {evidenceNote && (
        <span className="argument-node-evidence">{evidenceNote}</span>
      )}

      {strength === 'weak' && (
        <div className="argument-node-weak-hint">
          <ArrowUpRight size={11} />
          <span>此论点较弱</span>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
}
