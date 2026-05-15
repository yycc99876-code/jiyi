import { Upload, Search } from 'lucide-react'

interface SourceImportMenuProps {
  onUpload: () => void
  onSearch: () => void
  onClose: () => void
}

export default function SourceImportMenu({
  onUpload,
  onSearch,
  onClose,
}: SourceImportMenuProps) {
  return (
    <div className="source-import-menu">
      <button
        className="source-import-option"
        onClick={() => { onUpload(); onClose() }}
        type="button"
      >
        <Upload size={14} />
        上传文件
      </button>
      <button
        className="source-import-option"
        onClick={() => { onSearch(); onClose() }}
        type="button"
      >
        <Search size={14} />
        搜索网页
      </button>
    </div>
  )
}
