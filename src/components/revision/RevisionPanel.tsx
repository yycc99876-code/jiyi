import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, ArrowRight, X } from 'lucide-react'
import SuggestionChips from './SuggestionChips'
import VoiceInputButton from './VoiceInputButton'
import IntentPreview from './IntentPreview'
import RewriteDiff from './RewriteDiff'
import { rewrite, type RewriteResult } from '../../services/ai/rewriteEngine'

type PanelState = 'input' | 'loading' | 'result'

interface Props {
  selectedText: string
  onClose: () => void
  onAccept: (replacement: string) => void
  autoStartVoice?: boolean
}

export default function RevisionPanel({ selectedText, onClose, onAccept, autoStartVoice }: Props) {
  const [instruction, setInstruction] = useState('')
  const [panelState, setPanelState] = useState<PanelState>('input')
  const [rewriteResult, setRewriteResult] = useState<RewriteResult | null>(null)
  const [diffStatus, setDiffStatus] = useState<'pending' | 'accepted' | 'rejected'>('pending')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [instruction])

  const handleChipSelect = useCallback((text: string) => {
    setInstruction((prev) => (prev ? `${prev}，${text}` : text))
    textareaRef.current?.focus()
  }, [])

  const handleVoiceTranscript = useCallback((text: string) => {
    setInstruction((prev) => (prev ? `${prev}，${text}` : text))
  }, [])

  const handleGenerate = useCallback(async () => {
    if (!instruction.trim()) return
    setPanelState('loading')

    try {
      const result = await rewrite(selectedText, instruction.trim())
      setRewriteResult(result)
      setDiffStatus('pending')
      setPanelState('result')
    } catch (err: any) {
      setPanelState('input')
      alert(err?.message || '生成修改失败，请重试')
    }
  }, [selectedText, instruction])

  const handleAccept = useCallback(() => {
    if (!rewriteResult) return
    setDiffStatus('accepted')
    onAccept(rewriteResult.rewritten)
  }, [rewriteResult, onAccept])

  const handleReject = useCallback(() => {
    setDiffStatus('rejected')
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (panelState === 'input') handleGenerate()
      }
    },
    [panelState, handleGenerate],
  )

  return (
    <motion.div
      className="revision-panel"
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.97 }}
      transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
    >
      {/* Header */}
      <div className="revision-panel-header">
        <span className="revision-panel-title">
          <Sparkles size={14} />
          自定义修改
        </span>
        <button type="button" className="icon-button" onClick={onClose}>
          <X size={14} />
        </button>
      </div>

      <AnimatePresence mode="wait">
        {panelState === 'loading' ? (
          <motion.div
            key="loading"
            className="revision-panel-loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="revision-loading-orbit">
              <Sparkles size={18} className="spin" />
            </div>
            <p>正在生成修改...</p>
          </motion.div>
        ) : panelState === 'result' && rewriteResult ? (
          <motion.div
            key="result"
            className="revision-panel-result"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {rewriteResult?.intent && <IntentPreview intent={rewriteResult.intent} />}
            <RewriteDiff
              original={rewriteResult.original}
              rewritten={rewriteResult.rewritten}
              onAccept={handleAccept}
              onReject={handleReject}
              status={diffStatus}
            />
            <button
              type="button"
              className="ghost-button back-btn"
              onClick={() => {
                setPanelState('input')
                setRewriteResult(null)
              }}
            >
              返回修改
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="input"
            className="revision-panel-input"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <p className="revision-panel-question">你希望如何修改这段内容？</p>

            <SuggestionChips onSelect={handleChipSelect} />

            <div className="revision-textarea-wrap">
              <textarea
                ref={textareaRef}
                className="revision-textarea"
                placeholder="例如：让表达更自然，但保留原本观点"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={2}
              />
              <div className="revision-textarea-footer">
                <VoiceInputButton onTranscript={handleVoiceTranscript} autoStart={autoStartVoice} />
                <span className="revision-hint">Alt+M 语音 | ⌘ Enter 生成</span>
              </div>
            </div>

            <button
              type="button"
              className="generate-btn"
              disabled={!instruction.trim()}
              onClick={handleGenerate}
            >
              <ArrowRight size={15} />
              生成修改
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
