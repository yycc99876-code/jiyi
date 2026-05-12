import { motion } from 'framer-motion'
import { diffWords } from 'diff'
import { Check, X } from 'lucide-react'

interface Props {
  original: string
  rewritten: string
  onAccept: () => void
  onReject: () => void
  status: 'pending' | 'accepted' | 'rejected'
}

export default function RewriteDiff({ original, rewritten, onAccept, onReject, status }: Props) {
  const parts = diffWords(original, rewritten)

  return (
    <motion.div
      className={`rewrite-diff ${status}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
    >
      <p className="diff-line">
        {parts.map((part, i) => {
          if (part.added) return <mark className="diff-add" key={i}>{part.value}</mark>
          if (part.removed) return <mark className="diff-remove" key={i}>{part.value}</mark>
          return <span key={i}>{part.value}</span>
        })}
      </p>
      {status === 'pending' && (
        <div className="rewrite-diff-actions">
          <button type="button" className="accept-btn" onClick={onAccept}>
            <Check size={14} /> 接受
          </button>
          <button type="button" className="reject-btn" onClick={onReject}>
            <X size={14} /> 拒绝
          </button>
        </div>
      )}
      {status === 'accepted' && <span className="rewrite-status accepted">已接受</span>}
      {status === 'rejected' && <span className="rewrite-status rejected">已拒绝</span>}
    </motion.div>
  )
}
