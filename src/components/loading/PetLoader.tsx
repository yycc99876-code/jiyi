import { useEffect, useMemo, useState } from 'react'

export type PetLoaderStatus =
  | 'idle'
  | 'reading'
  | 'mapping'
  | 'thinking'
  | 'polishing'
  | 'success'
  | 'error'

type PetManifestState = {
  src: string
  label: string
  step: number
  totalSteps: number
}

type PetManifest = {
  name: string
  states: Record<string, PetManifestState>
}

interface PetLoaderProps {
  status?: PetLoaderStatus
  label?: string
  compact?: boolean
  showElapsed?: boolean
}

const DEFAULT_MANIFEST: PetManifest = {
  name: 'revision-chick',
  states: {
    idle: { src: '/pets/revision-chick/idle.svg', label: '等待指令', step: 0, totalSteps: 3 },
    reading: { src: '/pets/revision-chick/reading.svg', label: '正在阅读你的文本', step: 1, totalSteps: 3 },
    mapping: { src: '/pets/revision-chick/mapping.svg', label: '正在绘制文章结构', step: 2, totalSteps: 3 },
    thinking: { src: '/pets/revision-chick/thinking.svg', label: '正在寻找逻辑断点', step: 2, totalSteps: 3 },
    polishing: { src: '/pets/revision-chick/polishing.svg', label: '正在整理可执行建议', step: 3, totalSteps: 3 },
    success: { src: '/pets/revision-chick/success.svg', label: '分析完成', step: 3, totalSteps: 3 },
    error: { src: '/pets/revision-chick/error.svg', label: '扫描没有完成', step: 0, totalSteps: 3 },
  },
}

function formatElapsed(seconds: number) {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}m ${rest}s`
}

export default function PetLoader({
  status = 'reading',
  label,
  compact = false,
  showElapsed = true,
}: PetLoaderProps) {
  const [manifest, setManifest] = useState<PetManifest>(DEFAULT_MANIFEST)
  const [startedAt, setStartedAt] = useState(Date.now())
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetch('/pets/revision-chick/manifest.json')
      .then((res) => res.ok ? res.json() : DEFAULT_MANIFEST)
      .then((data: PetManifest) => {
        if (!cancelled) setManifest(data)
      })
      .catch(() => {
        if (!cancelled) setManifest(DEFAULT_MANIFEST)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setStartedAt(Date.now())
    setElapsed(0)
  }, [status])

  useEffect(() => {
    if (status === 'success' || status === 'error' || !showElapsed) return
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 500)
    return () => window.clearInterval(id)
  }, [showElapsed, startedAt, status])

  const state = manifest.states[status] ?? manifest.states.reading
  const displayLabel = label ?? state.label

  const dots = useMemo(() => {
    return Array.from({ length: state.totalSteps }, (_, index) => index + 1)
  }, [state.totalSteps])

  return (
    <div className={`pet-loader ${compact ? 'pet-loader-compact' : ''} pet-loader-${status}`}>
      <div className="pet-loader-portrait" aria-hidden="true">
        <img src={state.src} alt="" draggable={false} />
      </div>

      <div className="pet-loader-copy">
        <div className="pet-loader-status">
          <strong>{displayLabel}</strong>
          {showElapsed && status !== 'success' && status !== 'error' && (
            <span>{formatElapsed(elapsed)}</span>
          )}
        </div>
        {!compact && (
          <div className="pet-loader-steps" aria-label={`第 ${state.step} / ${state.totalSteps} 步`}>
            {dots.map((dot) => (
              <span
                key={dot}
                className={dot <= state.step ? 'active' : ''}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
