import PetLoader, { type PetLoaderStatus } from './PetLoader'

type ChickenProgressStage =
  | 'reading'
  | 'mapping'
  | 'reasoning'
  | 'polishing'
  | 'done'
  | 'error'

interface ChickenProgressProps {
  progress?: number
  stage?: ChickenProgressStage
  label?: string
  compact?: boolean
  showPercent?: boolean
}

export default function ChickenProgress({
  progress,
  stage,
  label,
  compact,
}: ChickenProgressProps) {
  const status = mapStageToPetStatus(stage, progress)
  return <PetLoader status={status} label={label} compact={compact} />
}

function mapStageToPetStatus(stage?: ChickenProgressStage, progress?: number): PetLoaderStatus {
  if (stage === 'done' || (progress !== undefined && progress >= 100)) return 'success'
  if (stage === 'error') return 'error'
  if (stage === 'mapping') return 'mapping'
  if (stage === 'reasoning') return 'thinking'
  if (stage === 'polishing') return 'polishing'
  return 'reading'
}
