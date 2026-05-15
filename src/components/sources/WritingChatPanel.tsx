import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Sparkles, FileText, Loader2, Zap } from 'lucide-react'
import type { SourceMaterial } from '../../services/sourceStore'

export interface WritingMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  isError?: boolean
}

interface WritingChatPanelProps {
  messages: WritingMessage[]
  loading: boolean
  selectedSources: SourceMaterial[]
  onSend: (message: string, mode: 'quick' | 'long') => void
  onInsertText: (text: string) => void
  externalInput?: string
  appendInputRef?: React.MutableRefObject<((text: string) => void) | null>
  onVoiceKey?: (e: React.KeyboardEvent) => boolean
}

export default function WritingChatPanel({
  messages,
  loading,
  selectedSources,
  onSend,
  onInsertText,
  externalInput,
  appendInputRef,
  onVoiceKey,
}: WritingChatPanelProps) {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'quick' | 'long'>('quick')
  const [autoScroll, setAutoScroll] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastExternalRef = useRef<string | undefined>(undefined)

  // Smart auto-scroll: only scroll if user is at bottom
  useEffect(() => {
    if (autoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, autoScroll])

  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current
    if (!el) return
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
    setAutoScroll(isAtBottom)
  }, [])

  // Auto-resize textarea when input changes (including external injection)
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 160) + 'px'
    }
  }, [input])

  // Sync external input (only on new injection, not repeated updates)
  useEffect(() => {
    if (externalInput !== undefined && externalInput !== null && externalInput !== lastExternalRef.current) {
      lastExternalRef.current = externalInput
      setInput(externalInput)
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          const len = externalInput.length
          inputRef.current.setSelectionRange(len, len)
        }
      })
    }
  }, [externalInput])

  // Expose append function for voice F key (appends without replacing user text)
  useEffect(() => {
    if (appendInputRef) {
      appendInputRef.current = (text: string) => {
        setInput((prev) => prev + text)
        requestAnimationFrame(() => {
          if (inputRef.current) {
            inputRef.current.focus()
            const len = (inputRef.current.value).length
            inputRef.current.setSelectionRange(len, len)
          }
        })
      }
    }
    return () => { if (appendInputRef) appendInputRef.current = null }
  }, [appendInputRef])

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text || loading) return
    onSend(text, mode)
    setInput('')
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }
  }, [input, mode, loading, onSend])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (onVoiceKey?.(e)) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
  }

  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null
  const isStreaming = loading && lastMsg?.role === 'assistant' && lastMsg.content.length > 0
  const isWaitingForFirstToken = loading && lastMsg?.role === 'assistant' && lastMsg.content.length === 0

  return (
    <div className="writing-chat-panel">
      <div className="writing-chat-header">
        <div>
          <span className="writing-chat-kicker">AI 写作助手</span>
          <p className="writing-chat-subtitle">
            {selectedSources.length > 0
              ? `基于 ${selectedSources.length} 份资料帮你写作`
              : '选择资料后，AI 可以基于资料帮你撰写文章'}
          </p>
        </div>
        <Sparkles size={16} />
      </div>

      <div className="writing-chat-messages" ref={messagesContainerRef} onScroll={handleScroll}>
        {messages.length === 0 ? (
          <div className="writing-chat-empty">
            <FileText size={24} />
            <strong>基于资料开始写作</strong>
            <p>例如：根据这些资料，帮我写一篇关于 AI 写作工具的文章大纲</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isLastAssistant = msg.role === 'assistant' && msg.id === lastMsg?.id
            return (
              <div className={`writing-chat-message ${msg.role}`} key={msg.id}>
                <div className="writing-chat-message-content">
                  {msg.content.split('\n').map((line, i) => (
                    <p key={i}>{line || ' '}</p>
                  ))}
                  {isLastAssistant && isStreaming && <span className="writing-chat-cursor" />}
                </div>
                {msg.role === 'assistant' && !loading && msg.content && !msg.isError && (
                  <button
                    className="writing-chat-insert"
                    onClick={() => onInsertText(msg.content)}
                    type="button"
                  >
                    <FileText size={12} />
                    插入正文
                  </button>
                )}
              </div>
            )
          })
        )}
        {isWaitingForFirstToken && (
          <div className="writing-chat-message assistant">
            <div className="writing-chat-loading">
              <Loader2 className="spin" size={16} />
              <span>正在连接...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="writing-chat-input-area">
        <div className="writing-chat-mode-row">
          <button
            className={`writing-mode-btn ${mode === 'quick' ? 'active' : ''}`}
            onClick={() => setMode('quick')}
            type="button"
            title="快速回复，使用 Qwen 模型"
          >
            <Zap size={12} />
            快速
          </button>
          <button
            className={`writing-mode-btn ${mode === 'long' ? 'active' : ''}`}
            onClick={() => setMode('long')}
            type="button"
            title="长文写作，使用 DeepSeek 模型"
          >
            <FileText size={12} />
            长文
          </button>
        </div>
        <div className="writing-chat-input-row">
          <textarea
            ref={inputRef}
            className="writing-chat-input"
            placeholder="输入写作需求..."
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            rows={1}
          />
          <button
            className="writing-chat-send"
            onClick={handleSend}
            disabled={loading || !input.trim()}
            type="button"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
