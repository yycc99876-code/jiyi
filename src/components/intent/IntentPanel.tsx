import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { Map, Loader2 } from 'lucide-react'
import ArticleMap from './ArticleMap'
import { buildIntentMap, type IntentMap, type IntentNode } from '../../services/ai/intentMapper'

interface Props {
  fullText: string
  onNodeClick: (paragraph: string) => void
}

export default function IntentPanel({ fullText, onNodeClick }: Props) {
  const [intentMap, setIntentMap] = useState<IntentMap | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const cacheRef = useRef<string>(fullText)
  const scanIdRef = useRef(0)

  const runAnalysis = useCallback(async () => {
    const text = fullText.trim()
    if (text.length < 50) {
      setIntentMap(null)
      return
    }

    const currentScan = ++scanIdRef.current
    setLoading(true)

    try {
      const result = await buildIntentMap(text)
      if (currentScan !== scanIdRef.current) return
      setIntentMap(result)
      cacheRef.current = text
    } catch {
      // silent
    } finally {
      if (currentScan === scanIdRef.current) setLoading(false)
    }
  }, [fullText])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(runAnalysis, 4000)
    return () => clearTimeout(debounceRef.current)
  }, [runAnalysis])

  const handleNodeClick = useCallback(
    (node: IntentNode) => {
      setActiveNodeId(node.id)
      onNodeClick(node.paragraph)
    },
    [onNodeClick],
  )

  return (
    <div className="intent-panel">
      <div className="intent-panel-header">
        <span className="intent-panel-title">
          <Map size={14} />
          意图空间
        </span>
        {loading && <Loader2 size={14} className="spin" />}
      </div>

      {!intentMap && !loading && (
        <div className="intent-empty">
          <Map size={18} />
          <p>开始写作后，AI 会分析文章的论点和逻辑关系。</p>
        </div>
      )}

      {intentMap && (
        <motion.div
          className="intent-content"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {intentMap.summary && (
            <div className="intent-summary">
              <span>整体判断</span>
              <p>{intentMap.summary}</p>
            </div>
          )}

          <ArticleMap
            nodes={intentMap.nodes}
            edges={intentMap.edges}
            onNodeClick={handleNodeClick}
            activeNodeId={activeNodeId}
          />
        </motion.div>
      )}
    </div>
  )
}
