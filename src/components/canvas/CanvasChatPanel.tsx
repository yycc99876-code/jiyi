import { useState, useCallback } from 'react'
import { Send, Mic, Sparkles, Plus, FileText } from 'lucide-react'
import type { CanvasChatMessage, CanvasSuggestion } from '../../services/ai/coherenceTypes'

interface Props {
  messages: CanvasChatMessage[]
  input: string
  loading: boolean
  voiceActive: boolean
  voiceSupported: boolean
  onInputChange: (value: string) => void
  onSend: () => void
  onAddToCanvas: (suggestion: CanvasSuggestion) => void
  onAppendToArticle: (text: string) => void
}

function suggestionTypeLabel(type: CanvasSuggestion['type']) {
  switch (type) {
    case 'outline': return '大纲'
    case 'draft': return '草稿'
    case 'question': return '追问'
    default: return '便签'
  }
}

export default function CanvasChatPanel({
  messages,
  input,
  loading,
  voiceActive,
  voiceSupported,
  onInputChange,
  onSend,
  onAddToCanvas,
  onAppendToArticle,
}: Props) {
  const [appendedIds, setAppendedIds] = useState<Set<string>>(new Set())
  const handleAppend = useCallback((id: string, text: string) => {
    if (appendedIds.has(id)) return
    setAppendedIds((prev) => new Set(prev).add(id))
    onAppendToArticle(text)
  }, [appendedIds, onAppendToArticle])

  return (
    <aside className="canvas-chat-panel">
      <div className="canvas-chat-header">
        <div>
          <span>AI 草稿助手</span>
          <p>先聊想法，再放到画布。</p>
        </div>
        <Sparkles size={16} />
      </div>

      <div className="canvas-chat-messages">
        {messages.length === 0 ? (
          <div className="canvas-chat-empty">
            <strong>从一句主题开始</strong>
            <p>例如：我想写一篇关于 AI 写作工具如何真正帮助用户的文章。</p>
          </div>
        ) : (
          messages.map((message) => (
            <div className={`canvas-chat-message ${message.role}`} key={message.id}>
              <p>{message.content}</p>
              {message.suggestions && message.suggestions.length > 0 && (
                <div className="canvas-suggestion-list">
                  {message.suggestions.map((suggestion) => (
                    <article className={`canvas-suggestion-card ${suggestion.type}`} key={suggestion.id}>
                      <span>
                        <FileText size={11} />
                        {suggestionTypeLabel(suggestion.type)}
                      </span>
                      <strong>{suggestion.title}</strong>
                      <p>{suggestion.content}</p>
                      <div className="canvas-suggestion-actions">
                        <button type="button" onClick={() => onAddToCanvas(suggestion)}>
                          <Plus size={11} />
                          放到画布
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAppend(suggestion.id, suggestion.content)}
                          disabled={appendedIds.has(suggestion.id)}
                        >
                          {appendedIds.has(suggestion.id) ? '已补全' : '补全正文'}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
        {loading && (
          <div className="canvas-chat-message assistant loading">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

      <div className={`canvas-chat-input ${voiceActive ? 'voice-active' : ''}`}>
        <textarea
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder="和 AI 说说你想写什么..."
          rows={3}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              onSend()
            }
          }}
        />
        <div className="canvas-chat-input-footer">
          <span className={voiceActive ? 'active' : ''}>
            <Mic size={11} />
            {voiceSupported ? (voiceActive ? '语音输入中' : '语音可用') : '当前浏览器不支持语音'}
          </span>
          <button type="button" onClick={onSend} disabled={loading || !input.trim()}>
            <Send size={13} />
            发送
          </button>
        </div>
      </div>
    </aside>
  )
}
