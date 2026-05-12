import { motion } from 'framer-motion'

const suggestions = [
  '更自然',
  '更正式',
  '更简洁',
  '更像产品经理写的',
  '更口语化',
  '缩短一半',
  '增强逻辑',
  '更有说服力',
]

interface Props {
  onSelect: (text: string) => void
}

export default function SuggestionChips({ onSelect }: Props) {
  return (
    <div className="suggestion-chips">
      {suggestions.map((s) => (
        <motion.button
          key={s}
          type="button"
          className="chip"
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          onClick={() => onSelect(s)}
        >
          {s}
        </motion.button>
      ))}
    </div>
  )
}
