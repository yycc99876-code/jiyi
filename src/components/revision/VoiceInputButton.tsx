import { useState, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, Sparkles } from 'lucide-react'
import {
  startRecording,
  stopRecording,
  isVoiceRecordingSupported,
  type RecordingState,
} from '../../services/ai/voiceInput'
import { cleanTranscript } from '../../services/ai/transcriptCleaner'

interface Props {
  onTranscript: (text: string) => void
  autoStart?: boolean
}

export default function VoiceInputButton({ onTranscript, autoStart }: Props) {
  const [state, setState] = useState<RecordingState>('idle')
  const [interim, setInterim] = useState('')
  const autoStartDone = useRef(false)

  const handleClick = useCallback(async () => {
    if (state === 'idle') {
      if (!isVoiceRecordingSupported()) {
        alert('当前浏览器不支持语音识别，请使用 Chrome 或 Edge')
        return
      }
      setInterim('')
      startRecording(
        (text) => setInterim(text.slice(-30)),
        (error) => {
          alert(error)
          setState('idle')
          setInterim('')
        },
      )
      setState('recording')
    } else if (state === 'recording') {
      const raw = stopRecording()
      setInterim('')
      if (!raw) {
        setState('idle')
        return
      }
      setState('processing')
      try {
        const result = await cleanTranscript(raw)
        onTranscript(result.cleaned)
      } catch {
        onTranscript(raw)
      }
      setState('idle')
    }
  }, [state, onTranscript])

  useEffect(() => {
    if (autoStart && !autoStartDone.current) {
      autoStartDone.current = true
      handleClick()
    }
  }, [autoStart, handleClick])

  if (!isVoiceRecordingSupported()) {
    return null
  }

  return (
    <div className={`voice-input-area ${state === 'recording' ? 'is-recording' : ''}`}>
      <button
        type="button"
        className={`voice-btn ${state}`}
        onClick={handleClick}
        title={state === 'recording' ? '停止录音并整理' : '语音输入 (Alt+M)'}
      >
        {state === 'recording' && (
          <>
            <span className="voice-ring voice-ring-1" />
            <span className="voice-ring voice-ring-2" />
            <span className="voice-ring voice-ring-3" />
          </>
        )}
        <AnimatePresence mode="wait">
          {state === 'processing' ? (
            <motion.span
              key="processing"
              className="voice-icon"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
            >
              <Sparkles size={15} className="spin" />
            </motion.span>
          ) : state === 'recording' ? (
            <motion.span
              key="recording"
              className="voice-icon"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
            >
              <Mic size={15} />
            </motion.span>
          ) : (
            <motion.span
              key="idle"
              className="voice-icon"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
            >
              <Mic size={14} />
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      <AnimatePresence>
        {state === 'recording' && (
          <motion.div
            className="voice-recording-bar"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
          >
            <span className="voice-dot" />
            <span className="voice-recording-text">
              {interim || '正在聆听...'}
            </span>
          </motion.div>
        )}
        {state === 'processing' && (
          <motion.div
            className="voice-recording-bar processing"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
          >
            <Sparkles size={11} className="spin" />
            <span className="voice-recording-text">AI 整理中...</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
