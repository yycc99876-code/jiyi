import { useState, useEffect } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ArrowUpRight, ExternalLink, Loader2, Sparkles, ShieldPlus, Swords, BookOpen, PenLine, Check } from 'lucide-react'
import type { CanvasActionType } from '../../services/ai/coherenceTypes'

export interface ArgumentNodeData {
  label: string
  paragraph: string
  strength: 'strong' | 'medium' | 'weak'
  role: 'claim' | 'evidence' | 'counterargument' | 'transition' | 'conclusion'
  evidenceNote?: string
  isGhost?: boolean
  isStale?: boolean
  ghostMessage?: string
  isSelected?: boolean
  isLoading?: boolean
  acceptedVariantCount?: number
  actionError?: string
  onAction?: (action: CanvasActionType) => void
  onScrollToEditor?: () => void
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
  const {
    label, paragraph, strength, role, evidenceNote,
    isGhost, isStale, ghostMessage, isSelected, isLoading, acceptedVariantCount = 0,
    actionError, onAction, onScrollToEditor,
  } = nodeData

  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (!isSelected) setMenuOpen(false)
  }, [isSelected])

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
      className={`argument-node ${selected ? 'selected' : ''} ${isStale ? 'stale' : ''} strength-${strength}`}
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
        {acceptedVariantCount > 0 && (
          <span className="argument-node-accepted-badge" title={`${acceptedVariantCount} 个 AI 建议已接受`}>
            <Check size={10} />
            {acceptedVariantCount}
          </span>
        )}
        {isStale && <span className="argument-node-stale-badge">旧结构</span>}
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

      {isSelected && !isLoading && (
        <div className="argument-quick-actions">
          <button type="button" onClick={(e) => { e.stopPropagation(); onAction?.('strengthen') }}>
            <ShieldPlus size={11} />
            加强
          </button>
          <button type="button" onClick={(e) => { e.stopPropagation(); onAction?.('evidence') }}>
            <BookOpen size={11} />
            补证据
          </button>
          <button type="button" onClick={(e) => { e.stopPropagation(); onAction?.('rewrite') }}>
            <PenLine size={11} />
            改写
          </button>
        </div>
      )}

      {actionError && (
        <div className="argument-node-error">
          <span>{actionError}</span>
          <button type="button" onClick={(e) => { e.stopPropagation(); onAction?.('rewrite') }}>
            重试
          </button>
        </div>
      )}

      {isSelected && (
        <div className="argument-action-bar">
          {isLoading ? (
            <div className="action-bar-loading">
              <Loader2 className="spin" size={14} />
              <span>AI 生成中...</span>
            </div>
          ) : (
            <>
              <button
                className="argument-action-trigger"
                onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen) }}
                type="button"
              >
                <Sparkles size={12} />
                AI 操作
              </button>
              <button
                className="argument-action-scroll-btn"
                onClick={(e) => { e.stopPropagation(); onScrollToEditor?.() }}
                title="跳转到编辑器"
                type="button"
              >
                <ExternalLink size={12} />
              </button>
              {menuOpen && (
                <div className="argument-action-menu" onClick={(e) => e.stopPropagation()}>
                  <button className="action-menu-item strengthen" onClick={() => { onAction?.('strengthen'); setMenuOpen(false) }}>
                    <ShieldPlus size={13} />
                    <span>加强论点</span>
                    <span className="action-menu-hint">强化当前论证</span>
                  </button>
                  <button className="action-menu-item counterargument" onClick={() => { onAction?.('counterargument'); setMenuOpen(false) }}>
                    <Swords size={13} />
                    <span>找反论</span>
                    <span className="action-menu-hint">寻找对立观点</span>
                  </button>
                  <button className="action-menu-item evidence" onClick={() => { onAction?.('evidence'); setMenuOpen(false) }}>
                    <BookOpen size={13} />
                    <span>补充论据</span>
                    <span className="action-menu-hint">增加支撑材料</span>
                  </button>
                  <button className="action-menu-item rewrite" onClick={() => { onAction?.('rewrite'); setMenuOpen(false) }}>
                    <PenLine size={13} />
                    <span>改写</span>
                    <span className="action-menu-hint">重新组织语言</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
}
