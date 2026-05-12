import { motion } from 'framer-motion'
import type { RevisionIntent } from '../../services/ai/intentParser'
import { intentLabel, intentDisplayValue } from '../../services/ai/intentParser'

interface Props {
  intent: RevisionIntent
}

const skipKeys = new Set(['goal'])

export default function IntentPreview({ intent }: Props) {
  const entries = Object.entries(intent).filter(([k]) => !skipKeys.has(k))

  return (
    <motion.div
      className="intent-tags"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      {entries.map(([key, value]) => (
        <span key={key} className="intent-tag">
          <span className="intent-tag-label">{intentLabel(key)}</span>
          <span className="intent-tag-value">{intentDisplayValue(key, value)}</span>
        </span>
      ))}
    </motion.div>
  )
}
