import { Handle, Position, type NodeProps } from '@xyflow/react'
import { FileText, PenLine, Plus } from 'lucide-react'
import type { CanvasSuggestionType } from '../../services/ai/coherenceTypes'

export interface DraftNoteData {
  title: string
  content: string
  type: CanvasSuggestionType
  status?: 'draft' | 'accepted' | 'ignored'
  onAppendToArticle?: () => void
  onExpand?: () => void
}

function typeLabel(type: CanvasSuggestionType) {
  switch (type) {
    case 'outline': return '大纲'
    case 'draft': return '草稿'
    case 'question': return '问题'
    default: return '便签'
  }
}

export default function DraftNoteNode({ data }: NodeProps) {
  const note = data as unknown as DraftNoteData

  return (
    <div className={`draft-note-node ${note.type} ${note.status === 'accepted' ? 'accepted' : ''}`}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className="draft-note-header">
        <span>
          <FileText size={11} />
          {typeLabel(note.type)}
        </span>
        {note.status === 'accepted' && <strong>已写入</strong>}
      </div>
      <h3>{note.title}</h3>
      <p>{note.content.length > 220 ? `${note.content.slice(0, 220)}...` : note.content}</p>
      <div className="draft-note-actions">
        <button type="button" onClick={(e) => { e.stopPropagation(); note.onAppendToArticle?.() }}>
          <Plus size={11} />
          补全正文
        </button>
        <button type="button" onClick={(e) => { e.stopPropagation(); note.onExpand?.() }}>
          <PenLine size={11} />
          继续展开
        </button>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
}
