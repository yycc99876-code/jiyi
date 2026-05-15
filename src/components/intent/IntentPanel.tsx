import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Map,
  Zap,
  RefreshCw,
  AlertTriangle,
  Clock,
  Activity,
  Target,
  CheckCircle2,
  Shield,
  Check,
  SkipForward,
} from 'lucide-react'
import ChickenProgress from '../loading/ChickenProgress'
import ArticleMap from './ArticleMap'
import type { ArgumentGraph, ArgumentNode, StructuralNudge } from '../../services/ai/coherenceTypes'
import type { ScanStage } from '../../hooks/useCoherenceAgent'

interface Props {
  graph: ArgumentGraph | null
  nudges: StructuralNudge[]
  isScanning: boolean
  isEnabled: boolean
  /** New: scan stage for progress feedback */
  scanStage: ScanStage
  /** New: last error message, if any */
  scanError: string | null
  /** New: timestamp of last successful scan */
  lastScannedAt: number | null
  /** New: force a manual scan */
  onScanNow: () => void
  onNodeClick: (paragraph: string) => void
  onChallengeEdge: (from: string, to: string) => void
  onStrengthenNode: (nodeId: string) => void
  onDismissNudge: (nudgeKey: string) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nudgeTypeLabel(type: string) {
  switch (type) {
    case 'contradiction':
      return '矛盾'
    case 'gap':
      return '逻辑缺口'
    case 'redundancy':
      return '冗余'
    case 'unsupported_claim':
      return '无论据'
    case 'missing_conclusion':
      return '缺结论'
    default:
      return type
  }
}

function nudgeTypeIcon(type: string) {
  switch (type) {
    case 'contradiction':
      return <AlertTriangle size={11} />
    case 'gap':
      return <Target size={11} />
    case 'redundancy':
      return <RefreshCw size={11} />
    case 'unsupported_claim':
      return <Shield size={11} />
    case 'missing_conclusion':
      return <Map size={11} />
    default:
      return <AlertTriangle size={11} />
  }
}

function nudgeSeverityColor(severity: string) {
  switch (severity) {
    case 'high':
      return 'var(--red)'
    case 'medium':
      return 'var(--accent)'
    default:
      return 'var(--muted)'
  }
}

function coherenceLabel(score: number) {
  if (score >= 0.85) return { text: '连贯性极强', color: 'var(--green)', level: 'S' }
  if (score >= 0.7) return { text: '连贯性强', color: 'var(--green)', level: 'A' }
  if (score >= 0.5) return { text: '连贯性中等', color: 'var(--accent)', level: 'B' }
  if (score >= 0.3) return { text: '需要改进', color: 'var(--red)', level: 'C' }
  return { text: '结构混乱', color: 'var(--red)', level: 'D' }
}

/** Relative time string: "刚刚", "3 分钟前", etc. */
function relativeTime(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 10) return '刚刚'
  if (seconds < 60) return `${seconds} 秒前`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时前`
}

/** Stage label in Chinese */
function stageLabel(stage: ScanStage): string {
  switch (stage) {
    case 'preparing':
      return '准备中…'
    case 'requesting':
      return '分析中…'
    case 'parsing':
      return '解析结果…'
    case 'done':
      return '已完成'
    case 'error':
      return '出错'
    default:
      return ''
  }
}

// ---------------------------------------------------------------------------
// Score Grade Badge — game-like letter grade
// ---------------------------------------------------------------------------

function ScoreGrade({ score }: { score: number }) {
  const { color, level, text } = coherenceLabel(score)
  const percent = Math.round(score * 100)

  return (
    <motion.div
      className="coherence-score-bar"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
    >
      <div className="coherence-score-header">
        <Zap size={13} />
        <span>连贯性</span>
        <motion.span
          className="coherence-grade-badge"
          style={{ borderColor: color, color }}
          key={level}
          initial={{ scale: 1.2, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 18 }}
        >
          {level}
        </motion.span>
        <strong style={{ color }}>{percent}%</strong>
      </div>
      <div className="coherence-score-track">
        <motion.div
          className="coherence-score-fill"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
      {/* Node / edge stats */}
      <div className="coherence-score-stats">
        <span><Activity size={10} /> {text}</span>
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Mission Progress — compact XP strip for handled/skipped missions
// ---------------------------------------------------------------------------

interface MissionProgressProps {
  active: number
  handled: number
  skipped: number
}

function MissionProgress({ active, handled, skipped }: MissionProgressProps) {
  const total = handled + skipped
  // Level up every 5 missions completed
  const level = Math.floor(total / 5) + 1
  const xpInLevel = total % 5
  const xpPercent = (xpInLevel / 5) * 100

  return (
    <div className="mission-progress">
      <div className="mission-progress-stats">
        <span className="mission-stat mission-active">
          <Activity size={10} /> {active}
        </span>
        <span className="mission-stat mission-handled">
          <Check size={10} /> {handled}
        </span>
        <span className="mission-stat mission-skipped">
          <SkipForward size={10} /> {skipped}
        </span>
        <span className="mission-level">Lv.{level}</span>
      </div>
      <div className="mission-xp-track">
        <motion.div
          className="mission-xp-fill"
          initial={{ width: 0 }}
          animate={{ width: `${xpPercent}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Scan Status Bar — shows progress stages + error + retry
// ---------------------------------------------------------------------------

function ScanStatusBar({
  isScanning,
  scanStage,
  scanError,
  lastScannedAt,
  onScanNow,
}: {
  isScanning: boolean
  scanStage: ScanStage
  scanError: string | null
  lastScannedAt: number | null
  onScanNow: () => void
}) {
  const [relative, setRelative] = useState(() =>
    lastScannedAt ? relativeTime(lastScannedAt) : null,
  )

  // Tick relative time every 30s
  useEffect(() => {
    if (!lastScannedAt) return
    setRelative(relativeTime(lastScannedAt))
    const id = setInterval(() => {
      setRelative(relativeTime(lastScannedAt))
    }, 30_000)
    return () => clearInterval(id)
  }, [lastScannedAt])

  return (
    <div className="scan-status-bar">
      {/* Left: status indicator */}
      <div className="scan-status-left">
        {isScanning ? (
          <ChickenProgress compact stage={scanStage === 'preparing' ? 'reading' : scanStage === 'requesting' ? 'reasoning' : scanStage === 'parsing' ? 'polishing' : undefined} label={stageLabel(scanStage)} />
        ) : scanError ? (
          <>
            <AlertTriangle size={12} style={{ color: 'var(--red)' }} />
            <span className="scan-stage-label" style={{ color: 'var(--red)' }}>
              {scanError}
            </span>
          </>
        ) : lastScannedAt ? (
          <>
            <CheckCircle2 size={12} style={{ color: 'var(--green)' }} />
            <span className="scan-stage-label">
              <Clock size={10} style={{ opacity: 0.6 }} />
              {relative}
            </span>
          </>
        ) : (
          <span className="scan-stage-label">等待首次扫描</span>
        )}
      </div>

      {/* Right: manual scan / retry */}
      <button
        type="button"
        className={`scan-trigger-btn ${scanError ? 'scan-trigger-retry' : ''}`}
        onClick={onScanNow}
        disabled={isScanning}
        title={scanError ? '重试扫描' : '立即扫描'}
      >
        <RefreshCw size={12} className={isScanning ? 'spin' : ''} />
        {scanError ? '重试' : isScanning ? '扫描中' : '扫描'}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main IntentPanel — Coherence Command Center
// ---------------------------------------------------------------------------

export default function IntentPanel({
  graph,
  nudges,
  isScanning,
  isEnabled,
  scanStage,
  scanError,
  lastScannedAt,
  onScanNow,
  onNodeClick,
  onChallengeEdge,
  onStrengthenNode,
  onDismissNudge,
}: Props) {
  // ── Local mission progress ─────────────────────────────────────────────
  const [handledCount, setHandledCount] = useState(0)
  const [skippedCount, setSkippedCount] = useState(0)

  const handleMissionHandled = useCallback(
    (nudgeKey: string) => {
      setHandledCount((c) => c + 1)
      onDismissNudge(nudgeKey)
    },
    [onDismissNudge],
  )

  const handleMissionSkipped = useCallback(
    (nudgeKey: string) => {
      setSkippedCount((c) => c + 1)
      onDismissNudge(nudgeKey)
    },
    [onDismissNudge],
  )

  const handleNodeClick = (node: ArgumentNode) => {
    onNodeClick(node.paragraph)
  }

  // ── Disabled state ──────────────────────────────────────────────────────
  if (!isEnabled) {
    return (
      <div className="intent-panel">
        <div className="intent-panel-header">
          <span className="intent-panel-title">
            <Map size={14} />
            连贯性指挥台
          </span>
        </div>
        <div className="intent-empty">
          <Shield size={18} />
          <p>配置 DASHSCOPE_API_KEY 后启用连贯性分析。</p>
        </div>
      </div>
    )
  }

  // ── Empty state — no graph yet ──────────────────────────────────────────
  const showEmpty = !graph && !isScanning && !scanError

  return (
    <div className="intent-panel">
      {/* Header */}
      <div className="intent-panel-header">
        <span className="intent-panel-title">
          <Map size={14} />
          连贯性指挥台
        </span>
      </div>

      {/* Scan status bar — always visible */}
      <ScanStatusBar
        isScanning={isScanning}
        scanStage={scanStage}
        scanError={scanError}
        lastScannedAt={lastScannedAt}
        onScanNow={onScanNow}
      />

      {/* Empty state */}
      {showEmpty && (
        <div className="intent-empty">
          <Activity size={18} />
          <p>开始写作后，AI 会分析文章的论证结构和逻辑关系。</p>
          <button
            type="button"
            className="scan-trigger-btn scan-trigger-start"
            onClick={onScanNow}
          >
            <Zap size={12} />
            启动首次扫描
          </button>
        </div>
      )}

      {/* Error banner (when scan failed and no graph yet) */}
      <AnimatePresence>
        {scanError && !graph && !isScanning && (
          <motion.div
            className="scan-error-banner"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            <AlertTriangle size={14} />
            <span>{scanError}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main content ── */}
      {graph && (
        <motion.div
          className="intent-content"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {/* Score grade */}
          <ScoreGrade score={graph.coherenceScore} />

          {/* Mission progress */}
          <MissionProgress
            active={nudges.length}
            handled={handledCount}
            skipped={skippedCount}
          />

          {/* Summary */}
          {graph.summary && (
            <motion.div
              className="intent-summary"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <span>整体判断</span>
              <p>{graph.summary}</p>
            </motion.div>
          )}

          {/* Structural Nudges */}
          <AnimatePresence>
            {nudges.length > 0 && (
              <motion.div
                className="nudge-section"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="nudge-section-header">
                  <AlertTriangle size={12} />
                  <span>结构问题</span>
                  <span className="nudge-count">{nudges.length}</span>
                </div>
                <div className="nudge-list">
                  {nudges.map((nudge, i) => (
                    <motion.div
                      key={`${nudge.type}_${nudge.relatedParagraphs.join('_')}_${i}`}
                      className={`nudge-card nudge-${nudge.severity}`}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 8 }}
                      transition={{ delay: i * 0.06 }}
                    >
                      <div
                        className="nudge-indicator"
                        style={{ background: nudgeSeverityColor(nudge.severity) }}
                      />
                      <div
                        className="nudge-body nudge-body-clickable"
                        onClick={() => {
                          if (!graph) return
                          const paraId = nudge.relatedParagraphs[0]
                          const node = graph.nodes.find((n) => n.id === paraId)
                          if (node) onNodeClick(node.paragraph)
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            if (!graph) return
                            const paraId = nudge.relatedParagraphs[0]
                            const node = graph.nodes.find((n) => n.id === paraId)
                            if (node) onNodeClick(node.paragraph)
                          }
                        }}
                      >
                        <span className="nudge-type">
                          {nudgeTypeIcon(nudge.type)}
                          {nudgeTypeLabel(nudge.type)}
                        </span>
                        <p>{nudge.message}</p>
                      </div>
                      <div className="nudge-actions">
                        <button
                          type="button"
                          className="nudge-action-btn nudge-action-handled"
                          onClick={() => {
                            const key = `${nudge.type}_${nudge.relatedParagraphs.join(',')}`
                            handleMissionHandled(key)
                          }}
                          aria-label="完成"
                          title="完成"
                        >
                          <Check size={11} /> 完成
                        </button>
                        <button
                          type="button"
                          className="nudge-action-btn nudge-action-skipped"
                          onClick={() => {
                            const key = `${nudge.type}_${nudge.relatedParagraphs.join(',')}`
                            handleMissionSkipped(key)
                          }}
                          aria-label="跳过"
                          title="跳过"
                        >
                          <SkipForward size={11} /> 跳过
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Article Map */}
          <div className="map-section">
            <div className="map-section-header">
              <Target size={12} />
              <span>论证地图</span>
              <span className="map-node-count">{graph.nodes.length} 节点</span>
            </div>
            <ArticleMap
              nodes={graph.nodes}
              edges={graph.edges}
              onNodeClick={handleNodeClick}
              onChallengeEdge={onChallengeEdge}
              onStrengthenNode={onStrengthenNode}
            />
          </div>
        </motion.div>
      )}

      {/* Loading skeleton when scanning but no graph yet */}
      {isScanning && !graph && (
        <motion.div
          className="scan-progress-area"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <ChickenProgress stage={scanStage === 'preparing' ? 'reading' : scanStage === 'requesting' ? 'reasoning' : scanStage === 'parsing' ? 'polishing' : 'reading'} label={stageLabel(scanStage) || '正在分析论证结构…'} />
          <p style={{ marginTop: 8 }}>AI 正在阅读你的文章，检测论点、论据和逻辑关系。</p>
        </motion.div>
      )}
    </div>
  )
}
