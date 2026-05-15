import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { motion, useMotionValue, useSpring } from 'framer-motion'
import {
  ArrowRight,
  Grid3X3,
  Mic,
  Moon,
  Play,
  Sparkles,
  Sun,
  Users,
} from 'lucide-react'

interface ParticleIntroProps {
  darkMode: boolean
  onComplete: () => void
  onToggleTheme: () => void
}

const featureCards = [
  {
    title: '幽灵文字建议',
    body: '在写作停顿处浮现建议，尊重你的节奏，不打断、不替代。',
    icon: Sparkles,
    hoverLabel: 'Tab',
  },
  {
    title: '结构画布',
    body: '将零散想法可视化，梳理结构与逻辑，让表达更清晰。',
    icon: Grid3X3,
    hoverLabel: 'Map',
  },
  {
    title: '语音草稿',
    body: '用你的声音开始写作，语音转文字，让灵感自然流动。',
    icon: Mic,
    hoverLabel: 'Speak',
  },
  {
    title: '协作诊断',
    body: '与他人共同打磨，获得深入诊断，把好内容写得更好。',
    icon: Users,
    hoverLabel: 'Ask',
  },
] as const

function QuillCursor({ label }: { label: string }) {
  const [visible, setVisible] = useState(false)
  const mouseX = useMotionValue(-160)
  const mouseY = useMotionValue(-160)
  const x = useSpring(mouseX, { damping: 24, stiffness: 360, mass: 0.12 })
  const y = useSpring(mouseY, { damping: 24, stiffness: 360, mass: 0.12 })

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      mouseX.set(event.clientX)
      mouseY.set(event.clientY)
      setVisible(true)
    }
    const handleLeave = () => setVisible(false)

    window.addEventListener('mousemove', handleMove, { passive: true })
    window.addEventListener('mouseleave', handleLeave)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseleave', handleLeave)
    }
  }, [mouseX, mouseY])

  return (
    <motion.div
      className={`intro-quill-cursor ${label ? 'is-hovering' : ''}`}
      style={{ x, y }}
      animate={{ opacity: visible ? 1 : 0 }}
      aria-hidden="true"
    >
      <motion.div
        className="intro-quill-mask"
        animate={{ opacity: label ? 1 : 0, scale: label ? 1 : 0.84, y: label ? 0 : 8 }}
        transition={{ type: 'spring', stiffness: 330, damping: 26 }}
      >
        <span>{label}</span>
      </motion.div>
      <motion.img
        className="intro-quill-svg"
        src="/quill-cursor.png"
        alt=""
        draggable={false}
        animate={{ rotate: label ? -2 : 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      />
    </motion.div>
  )
}

export default function ParticleIntro({ darkMode, onComplete, onToggleTheme }: ParticleIntroProps) {
  const previewRef = useRef<HTMLDivElement | null>(null)
  const [entering, setEntering] = useState(false)
  const [cursorLabel, setCursorLabel] = useState('')

  const enterProduct = () => {
    setEntering(true)
    window.setTimeout(onComplete, 520)
  }

  return (
    <section className={`particle-intro ${entering ? 'entering-product' : ''}`}>
      <QuillCursor label={cursorLabel} />
      <div className="intro-atmosphere" aria-hidden="true">
        <span className="intro-story-light" />
        <span className="intro-handwriting intro-handwriting-one">Revision Lens</span>
        <span className="intro-orbit-dots" />
      </div>

      <motion.nav
        className="intro-nav"
        aria-label="Revision Lens landing navigation"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.58 }}
      >
        <button
          className="intro-brand"
          type="button"
          onMouseEnter={() => setCursorLabel('Lens')}
          onMouseLeave={() => setCursorLabel('')}
        >
          <Sparkles size={22} />
          <span>Revision Lens</span>
        </button>
        <div className="intro-nav-links">
          {['幽灵文字', '结构画布', '语音草稿', '协作诊断'].map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
              onMouseEnter={() => setCursorLabel('View')}
              onMouseLeave={() => setCursorLabel('')}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="intro-nav-actions">
          <button
            className="intro-theme-btn"
            type="button"
            aria-label="切换首页主题"
            onClick={onToggleTheme}
            onMouseEnter={() => setCursorLabel(darkMode ? 'Light' : 'Dark')}
            onMouseLeave={() => setCursorLabel('')}
          >
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            className="intro-nav-cta"
            type="button"
            onClick={enterProduct}
            onMouseEnter={() => setCursorLabel('进入')}
            onMouseLeave={() => setCursorLabel('')}
          >
            进入产品
          </button>
        </div>
      </motion.nav>

      <main className="intro-landing">
        <motion.div
          className="intro-copy"
          initial={{ opacity: 0, x: -22 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.72, delay: 0.16 }}
        >
          <div className="intro-kicker">
            <Sparkles size={14} />
            <span>AI WRITING EDITOR</span>
            <i />
            <span>GHOST TEXT</span>
            <i />
            <span>CANVAS</span>
          </div>
          <h1>
            <span className="intro-title-line">让写作，</span>
            <span className="intro-title-line">
              重新有一点<span className="intro-title-accent">期待</span>
            </span>
          </h1>
          <div className="intro-reveal-line" aria-hidden="true" />
          <p>你写，它等；你停，它应。让灵感不断线，让表达更轻松。</p>
          <div className="intro-actions">
            <button
              className="intro-primary-btn"
              type="button"
              onClick={enterProduct}
              onMouseEnter={() => setCursorLabel('进入')}
              onMouseLeave={() => setCursorLabel('')}
            >
              进入产品
              <ArrowRight size={18} />
            </button>
            <button
              className="intro-secondary-btn"
              type="button"
              onClick={() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
              onMouseEnter={() => setCursorLabel('Demo')}
              onMouseLeave={() => setCursorLabel('')}
            >
              <Play size={14} />
              查看交互演示
            </button>
          </div>
          <div className="intro-proof-row">
            <span>AI 实时建议</span>
            <span>隐私优先</span>
            <span>多模态写作</span>
          </div>
        </motion.div>

        <motion.div
          className="intro-product-scene"
          ref={previewRef}
          initial={{ opacity: 0, x: 20, scale: 0.985 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          transition={{ duration: 0.82, delay: 0.32 }}
          onMouseEnter={() => setCursorLabel('Scan')}
          onMouseLeave={() => setCursorLabel('')}
        >
          <span className="intro-desk-reflection" aria-hidden="true" />
          <div className="intro-product-window">
            <div className="intro-window-top">
              <span />
              <span />
              <span />
            </div>
            <div className="intro-app-topbar">
              <div className="intro-mock-brand">
                <Sparkles size={13} />
                <div>
                  <strong>Revision Lens</strong>
                  <span>AI writing editor</span>
                </div>
              </div>
              <div className="intro-mock-actions">
                <span>新建</span>
                <span>导入</span>
                <span>导出</span>
                <span>已保存</span>
                <span>画布</span>
              </div>
            </div>
            <div className="intro-mock-workspace">
              <aside className="intro-mock-docs">
                <div className="intro-mock-tabs">
                  <span>文章</span>
                  <span>资料库</span>
                  <span>历史</span>
                  <span>新建</span>
                </div>
                <div className="intro-mock-doc active">
                  <strong>示例文章</strong>
                  <em>AI 写作工具应该如何真正帮助...</em>
                  <span>45%</span>
                </div>
              </aside>
              <article className="intro-mock-editor">
                <div className="intro-mock-editor-head">
                  <span>DOCUMENT</span>
                  <em>244 字</em>
                </div>
                <div className="intro-mock-toolbar">
                  <span>正文</span>
                  <span>默认</span>
                  <span>字号</span>
                  <i />
                  <i />
                  <i />
                  <button type="button">AI 菜单</button>
                </div>
                <h2>AI 写作工具应该如何真正帮助用户</h2>
                <p>
                  很多 AI 写作产品现在都可以帮助用户更好地完成内容创作，提升工作效率。但是这些产品经常会直接生成一大段内容，用户很难判断哪些地方是真的有帮助。
                </p>
                <p>
                  我希望做一个更自然的编辑器体验，让 AI 不只是替用户写东西，而是在合适的时候给出建议。
                </p>
                <div className="intro-mock-shortcuts">
                  <kbd>Tab</kbd>
                  <span>切换建议</span>
                  <kbd>Enter</kbd>
                  <span>接受</span>
                </div>
              </article>
              <aside className="intro-mock-console">
                <div className="intro-console-tabs">
                  <span className="active">幽灵文字</span>
                  <span>意图空间</span>
                  <span>连贯性</span>
                  <span>诊断</span>
                </div>
                <strong>GHOST CONSOLE</strong>
                <h3>1 条即时建议</h3>
                <div className="intro-console-actions">
                  <button type="button">接受当前</button>
                  <button type="button">忽略当前</button>
                </div>
                <motion.div
                  className="intro-console-suggestion"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, delay: 0.95 }}
                >
                  <span>原文</span>
                  <b>AI Writing</b>
                  <span>建议</span>
                  <b>AI 写作</b>
                  <em>中文段落中应使用中文，避免中英混杂。</em>
                </motion.div>
                <div className="intro-console-keys">
                  <span>Tab 切换</span>
                  <span>Enter 接受</span>
                  <span>双击卡片接受</span>
                </div>
              </aside>
            </div>
          </div>
        </motion.div>
      </main>

      <motion.div
        className="intro-status-film"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.62, delay: 0.68 }}
        aria-label="Revision Lens product status"
      >
        <span>状态：已保存</span>
        <i />
        <span>幽灵文字：开启</span>
        <i />
        <span>Tab 补全：智能预测中</span>
        <i />
        <span>结构画布：待展开</span>
        <i />
        <span>语音草稿：待启动</span>
        <i />
        <span>协作诊断：暂无问题</span>
      </motion.div>

      <motion.section
        className="intro-feature-strip"
        aria-label="Revision Lens feature strip"
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.74, delay: 0.9 }}
      >
        {featureCards.map((card, index) => {
          const Icon = card.icon
          return (
            <article
              className="intro-feature-item"
              key={card.title}
              style={{ '--delay': `${index * 0.45}s` } as CSSProperties}
              onMouseEnter={() => setCursorLabel(card.hoverLabel)}
              onMouseLeave={() => setCursorLabel('')}
            >
              <div className="intro-feature-icon">
                <Icon size={26} />
              </div>
              <div>
                <h2>{card.title}</h2>
                <p>{card.body}</p>
              </div>
            </article>
          )
        })}
      </motion.section>
    </section>
  )
}
