import { useState } from 'react'
import { ArrowLeft, Search, Plus, Loader2, Globe, Check } from 'lucide-react'
import { addSource, truncateContent } from '../../services/sourceStore'
import type { SourceMaterial } from '../../services/sourceStore'

interface WebSearchResult {
  title: string
  url: string
  snippet: string
}

interface WebSearchPanelProps {
  onBack: () => void
  onAdd: (source: SourceMaterial) => void
  docId: string
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function getFaviconUrl(url: string): string {
  try {
    const domain = new URL(url).origin
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
  } catch {
    return ''
  }
}

export default function WebSearchPanel({ onBack, onAdd, docId }: WebSearchPanelProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<WebSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [addedUrls, setAddedUrls] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)

  const handleSearch = async () => {
    if (!query.trim()) return
    setSearching(true)
    setError('')
    setResults([])
    setSearched(true)
    try {
      const res = await fetch('/api/revision/web-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), limit: 8 }),
      })
      if (!res.ok) throw new Error(`搜索失败: ${res.status}`)
      const data = await res.json()
      setResults(data.results ?? [])
    } catch (err: any) {
      setError(err.message || '搜索失败')
    } finally {
      setSearching(false)
    }
  }

  const handleAddResult = async (result: WebSearchResult) => {
    if (addedUrls.has(result.url)) return
    setAdding(result.url)
    try {
      const res = await fetch('/api/revision/fetch-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: result.url }),
      })
      let content = result.snippet
      let htmlContent = `<p>${result.snippet}</p>`
      if (res.ok) {
        const data = await res.json()
        content = data.content || result.snippet
        htmlContent = data.htmlContent || `<p>${result.snippet}</p>`
      }

      const source = addSource({
        docId,
        type: 'web',
        format: 'html',
        title: result.title,
        content: truncateContent(content),
        htmlContent: truncateContent(htmlContent),
        url: result.url,
        selected: true,
      })
      if (source) {
        onAdd(source)
        setAddedUrls((prev) => new Set(prev).add(result.url))
      }
    } catch {
      const source = addSource({
        docId,
        type: 'web',
        format: 'html',
        title: result.title,
        content: result.snippet,
        htmlContent: `<p>${result.snippet}</p>`,
        url: result.url,
        selected: true,
      })
      if (source) {
        onAdd(source)
        setAddedUrls((prev) => new Set(prev).add(result.url))
      }
    } finally {
      setAdding(null)
    }
  }

  return (
    <div className="web-search-panel">
      <div className="web-search-header">
        <button className="source-reader-back" onClick={onBack} type="button">
          <ArrowLeft size={14} />
          返回
        </button>
        <h3>搜索网页资料</h3>
      </div>

      <div className="web-search-input-row">
        <input
          className="web-search-input"
          type="text"
          placeholder="搜索任何主题的资料..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          autoFocus
        />
        <button
          className="web-search-btn"
          onClick={handleSearch}
          disabled={searching || !query.trim()}
          type="button"
        >
          {searching ? <Loader2 className="spin" size={14} /> : <Search size={14} />}
        </button>
      </div>

      {error && <p className="web-search-error">{error}</p>}

      {searching && (
        <div className="web-search-loading">
          <div className="web-search-loading-bar" />
          <p>正在搜索 "{query}"...</p>
          <div className="web-search-skeleton-list">
            {[1, 2, 3].map((i) => (
              <div className="web-search-skeleton" key={i}>
                <div className="skeleton-line skeleton-short" />
                <div className="skeleton-line skeleton-long" />
                <div className="skeleton-line skeleton-medium" />
              </div>
            ))}
          </div>
        </div>
      )}

      {!searching && searched && results.length === 0 && !error && (
        <div className="web-search-empty">
          <Globe size={20} />
          <p>没有找到相关结果，换个关键词试试</p>
        </div>
      )}

      <div className="web-search-results">
        {results.map((r) => {
          const isAdded = addedUrls.has(r.url)
          return (
            <div className={`web-search-result ${isAdded ? 'added' : ''}`} key={r.url}>
              <div className="web-search-result-favicon">
                <img src={getFaviconUrl(r.url)} alt="" width={16} height={16} />
              </div>
              <div className="web-search-result-info">
                <div className="web-search-result-domain">{getDomain(r.url)}</div>
                <a
                  className="web-search-result-title"
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {r.title}
                </a>
                <p className="web-search-result-snippet">{r.snippet}</p>
              </div>
              <button
                className={`web-search-add-btn ${isAdded ? 'added' : ''}`}
                onClick={() => handleAddResult(r)}
                disabled={adding === r.url || isAdded}
                title={isAdded ? '已添加' : '添加到资料库'}
                type="button"
              >
                {adding === r.url ? (
                  <Loader2 className="spin" size={14} />
                ) : isAdded ? (
                  <Check size={14} />
                ) : (
                  <Plus size={14} />
                )}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
