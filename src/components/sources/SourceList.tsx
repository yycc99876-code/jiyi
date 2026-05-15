import {
  BookOpen,
  FileText,
  File,
  Globe,
  Trash2,
  Upload,
  Search,
} from 'lucide-react'
import type { SourceMaterial } from '../../services/sourceStore'

interface SourceListProps {
  sources: SourceMaterial[]
  onToggleSelect: (id: string) => void
  onDelete: (id: string) => void
  onOpen: (source: SourceMaterial) => void
  onUpload: () => void
  onSearch: () => void
}

function formatIcon(format: SourceMaterial['format']) {
  switch (format) {
    case 'pdf':
      return <File size={13} />
    case 'docx':
      return <File size={13} />
    case 'html':
      return <Globe size={13} />
    default:
      return <FileText size={13} />
  }
}

export default function SourceList({
  sources,
  onToggleSelect,
  onDelete,
  onOpen,
  onUpload,
  onSearch,
}: SourceListProps) {
  if (sources.length === 0) {
    return (
      <div className="source-list">
        <div className="empty-source-list">
          <BookOpen size={19} />
          <p>还没有资料，上传文件或搜索网页添加。</p>
          <div className="source-empty-actions">
            <button className="text-button" onClick={onUpload} type="button">
              <Upload size={13} />
              上传文件
            </button>
            <button className="text-button" onClick={onSearch} type="button">
              <Search size={13} />
              搜索网页
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="source-list">
      {sources.map((src) => (
        <div
          className={`source-item ${src.selected ? 'selected' : ''}`}
          key={src.id}
        >
          <input
            type="checkbox"
            className="source-checkbox"
            checked={src.selected}
            onChange={() => onToggleSelect(src.id)}
            title={src.selected ? '取消使用此资料' : '写作时使用此资料'}
          />
          <button
            className="source-item-main"
            onClick={() => onOpen(src)}
            type="button"
          >
            <span className="source-item-icon">{formatIcon(src.format)}</span>
            <span className="source-item-title">{src.title}</span>
          </button>
          <button
            className="source-item-delete"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(src.id)
            }}
            title="删除资料"
            type="button"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
