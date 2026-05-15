import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ExternalLink, FileText, File, Globe, Copy, Check, Eye, Type } from 'lucide-react'
import type { SourceMaterial } from '../../services/sourceStore'

interface SourceReaderProps {
  material: SourceMaterial
  onBack: () => void
}

function formatLabel(format: string): string {
  switch (format) {
    case 'txt': return 'TXT'
    case 'md': return 'Markdown'
    case 'docx': return 'DOCX'
    case 'pdf': return 'PDF'
    case 'html': return '网页'
    default: return format.toUpperCase()
  }
}

function formatIcon(format: SourceMaterial['format']) {
  switch (format) {
    case 'pdf': return <File size={14} />
    case 'docx': return <File size={14} />
    case 'html': return <Globe size={14} />
    default: return <FileText size={14} />
  }
}

export default function SourceReader({ material, onBack }: SourceReaderProps) {
  const isPdf = material.format === 'pdf' && material.rawDataBase64
  const isDocx = material.format === 'docx' && material.rawDataBase64
  const [viewMode, setViewMode] = useState<'original' | 'text'>(isPdf ? 'original' : 'text')
  const [copied, setCopied] = useState(false)

  const blobUrl = useMemo(() => {
    if (!material.rawDataBase64 || !material.mimeType) return null
    try {
      const binary = atob(material.rawDataBase64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      const blob = new Blob([bytes], { type: material.mimeType })
      return URL.createObjectURL(blob)
    } catch {
      return null
    }
  }, [material.rawDataBase64, material.mimeType])

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [blobUrl])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(material.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // fallback: create a temporary textarea, focus it, then copy
      const ta = document.createElement('textarea')
      ta.value = material.content
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      try { document.execCommand('copy') } catch { /* noop */ }
      document.body.removeChild(ta)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div className="source-reader">
      <div className="source-reader-header">
        <button className="source-reader-back" onClick={onBack} type="button">
          <ArrowLeft size={14} />
          返回
        </button>
        <div className="source-reader-meta">
          <span className="source-reader-badge">
            {formatIcon(material.format)}
            {formatLabel(material.format)}
          </span>
          {material.url && (
            <a
              className="source-reader-link"
              href={material.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={12} />
              原文
            </a>
          )}
          {isPdf && (
            <button
              className={`source-reader-toggle ${viewMode === 'text' ? 'active' : ''}`}
              onClick={() => setViewMode(viewMode === 'original' ? 'text' : 'original')}
              type="button"
              title={viewMode === 'original' ? '查看提取文本' : '查看原文档'}
            >
              {viewMode === 'original' ? <Type size={12} /> : <Eye size={12} />}
              {viewMode === 'original' ? '文本' : '原文'}
            </button>
          )}
          <button
            className="source-reader-toggle"
            onClick={handleCopy}
            type="button"
            title="复制全文"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? '已复制' : '复制'}
          </button>
          {isDocx && blobUrl && (
            <a
              className="source-reader-link"
              href={blobUrl}
              download={material.originalFileName || 'document.docx'}
            >
              <FileText size={12} />
              下载原文件
            </a>
          )}
        </div>
      </div>
      <h3 className="source-reader-title">{material.title}</h3>

      {isPdf && viewMode === 'original' && blobUrl ? (
        <iframe
          className="source-reader-pdf"
          src={blobUrl}
          title={material.title}
        />
      ) : (
        <div
          className="source-reader-content"
          dangerouslySetInnerHTML={{ __html: material.htmlContent }}
        />
      )}
    </div>
  )
}
