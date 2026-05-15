import { useMemo } from 'react'
import { Mic, Check, PenLine } from 'lucide-react'

export type VoiceCapsulePhase = 'idle' | 'recording' | 'processing' | 'ready'

export interface VoiceCapsuleState {
  phase: VoiceCapsulePhase
  mode: 'hold' | 'handsfree'
  rawText: string
  cleanedText: string
  error?: string
}

export const emptyVoiceCapsule: VoiceCapsuleState = {
  phase: 'idle',
  mode: 'hold',
  rawText: '',
  cleanedText: '',
}

interface VoiceInputBarProps {
  capsule: VoiceCapsuleState
}

export function VoiceInputBar({ capsule }: VoiceInputBarProps) {
  const { phase, mode, rawText, cleanedText, error } = capsule

  const statusLabel = useMemo(() => {
    if (phase === 'recording') return mode === 'handsfree' ? '免提记录中' : '正在听你说'
    if (phase === 'processing') return '正在整理语音'
    if (phase === 'ready') return error ? '这次没听清' : '按 R 发送 · 按 F 修改'
    return ''
  }, [phase, mode, error])

  const displayText = useMemo(() => {
    if (phase === 'recording') return rawText || '说出你的想法...'
    if (phase === 'processing') return rawText || '正在理解你的意思...'
    if (phase === 'ready') return error || cleanedText
    return ''
  }, [phase, rawText, cleanedText, error])

  if (phase === 'idle') return null

  return (
    <div className={`voice-input-bar ${phase} ${mode}`}>
      {/* Left: Audio visualization */}
      <div className="voice-meter" aria-hidden="true">
        {phase === 'ready' ? (
          <div className="voice-meter-ready">
            <span className="voice-meter-dot" />
            <span className="voice-meter-pulse" />
          </div>
        ) : (
          <div className={`voice-meter-bars ${phase === 'processing' ? 'breathing' : ''}`}>
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} style={{ animationDelay: `${i * 0.08}s` }} />
            ))}
          </div>
        )}
      </div>

      {/* Center: Status + text */}
      <div className="voice-copy">
        <div className="voice-status-row">
          <span className={`voice-status-dot ${phase}`} />
          <span className="voice-status-label">{statusLabel}</span>
        </div>
        <p className="voice-text">
          {displayText}
          {phase === 'recording' && <span className="voice-cursor" />}
        </p>
      </div>

      {/* Right: R/F key labels (ready phase only) */}
      {phase === 'ready' && !error && (
        <div className="voice-keys">
          <span className="voice-key-label confirm">
            <Check size={10} />
            R
          </span>
          <span className="voice-key-label edit">
            <PenLine size={10} />
            F
          </span>
        </div>
      )}
    </div>
  )
}

/* ── Full-screen hands-free overlay ── */

interface HandsfreeOverlayProps {
  active: boolean
}

export function HandsfreeOverlay({ active }: HandsfreeOverlayProps) {
  if (!active) return null

  return (
    <div className="handsfree-overlay active" aria-hidden="true">
      <div className="handsfree-ring handsfree-ring-1" />
      <div className="handsfree-ring handsfree-ring-2" />
      <div className="handsfree-ring handsfree-ring-3" />
      <div className="handsfree-center-glow">
        <Mic size={20} />
      </div>
    </div>
  )
}
