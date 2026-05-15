import { useState } from 'react'
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  Undo2, Redo2, AlignLeft, AlignCenter, AlignRight, AlignJustify,
  ListOrdered, List, Sparkles, Eraser, Plus, Table, Image,
  Minus, Quote, ChevronDown, Wand2, Scissors, StretchHorizontal,
  Rows3, Columns3, Trash2,
} from 'lucide-react'
import type { Editor } from '@tiptap/core'

const FONT_FAMILIES = [
  { label: '默认', value: '' },
  { label: '宋体', value: 'SimSun, serif' },
  { label: '黑体', value: 'SimHei, sans-serif' },
  { label: '微软雅黑', value: 'Microsoft YaHei, sans-serif' },
  { label: '楷体', value: 'KaiTi, serif' },
  { label: '仿宋', value: 'FangSong, serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: 'Times New Roman, serif' },
]

const FONT_SIZES = [
  { label: '12', value: '12px' },
  { label: '14', value: '14px' },
  { label: '16', value: '16px' },
  { label: '18', value: '18px' },
  { label: '20', value: '20px' },
  { label: '24', value: '24px' },
  { label: '28', value: '28px' },
  { label: '32', value: '32px' },
  { label: '36', value: '36px' },
  { label: '48', value: '48px' },
]

interface EditorToolbarProps {
  editor: Editor | null
  selectedCount?: number
  onFullTextRewrite?: (instruction?: string) => void
  onSelectionRewrite?: (instruction?: string) => void
}

function currentBlockType(editor: Editor): string {
  if (editor.isActive('heading', { level: 1 })) return 'heading-1'
  if (editor.isActive('heading', { level: 2 })) return 'heading-2'
  if (editor.isActive('heading', { level: 3 })) return 'heading-3'
  return 'paragraph'
}

function setBlockType(editor: Editor, value: string) {
  const chain = editor.chain().focus()
  switch (value) {
    case 'heading-1': chain.toggleHeading({ level: 1 }).run(); break
    case 'heading-2': chain.toggleHeading({ level: 2 }).run(); break
    case 'heading-3': chain.toggleHeading({ level: 3 }).run(); break
    default: chain.setParagraph().run(); break
  }
}

export default function EditorToolbar({
  editor,
  selectedCount = 0,
  onFullTextRewrite,
  onSelectionRewrite,
}: EditorToolbarProps) {
  const [openMenu, setOpenMenu] = useState<'insert' | 'ai' | null>(null)
  if (!editor) return null

  const hasSelection = selectedCount > 0
  const inTable = editor.isActive('table')

  const run = (callback: () => void) => {
    callback()
    setOpenMenu(null)
  }

  const insertImage = () => {
    const url = window.prompt('输入图片地址')
    if (url) editor.chain().focus().setImage({ src: url }).run()
  }

  return (
    <div className="editor-toolbar">
      <div className="toolbar-group">
        <button
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="撤销"
          aria-label="撤销"
          type="button"
        >
          <Undo2 size={15} />
        </button>
        <button
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="重做"
          aria-label="重做"
          type="button"
        >
          <Redo2 size={15} />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <select
          value={currentBlockType(editor)}
          onChange={(event) => setBlockType(editor, event.target.value)}
          title="段落类型"
        >
          <option value="paragraph">正文</option>
          <option value="heading-1">标题 1</option>
          <option value="heading-2">标题 2</option>
          <option value="heading-3">标题 3</option>
        </select>
      </div>

      <div className="toolbar-group toolbar-font-group">
        <select
          className="toolbar-font-select"
          value={editor.getAttributes('textStyle').fontFamily || ''}
          onChange={(event) => {
            const chain = editor.chain().focus()
            if (event.target.value) {
              chain.setMark('textStyle', { fontFamily: event.target.value }).run()
            } else {
              chain.setMark('textStyle', { fontFamily: null }).removeEmptyTextStyle().run()
            }
          }}
          title="字体"
        >
          {FONT_FAMILIES.map((font) => (
            <option key={font.value} value={font.value}>{font.label}</option>
          ))}
        </select>
        <select
          className="toolbar-size-select"
          value={editor.getAttributes('textStyle').fontSize || ''}
          onChange={(event) => {
            const chain = editor.chain().focus()
            if (event.target.value) {
              chain.setMark('textStyle', { fontSize: event.target.value }).run()
            } else {
              chain.setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run()
            }
          }}
          title="字号"
        >
          <option value="">字号</option>
          {FONT_SIZES.map((size) => (
            <option key={size.value} value={size.value}>{size.label}</option>
          ))}
        </select>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button
          className={editor.isActive('bold') ? 'active' : ''}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="加粗"
          aria-label="加粗"
          type="button"
        >
          <Bold size={15} />
        </button>
        <button
          className={editor.isActive('italic') ? 'active' : ''}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="斜体"
          aria-label="斜体"
          type="button"
        >
          <Italic size={15} />
        </button>
        <button
          className={editor.isActive('underline') ? 'active' : ''}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          title="下划线"
          aria-label="下划线"
          type="button"
        >
          <UnderlineIcon size={15} />
        </button>
        <button
          className={editor.isActive('strike') ? 'active' : ''}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          title="删除线"
          aria-label="删除线"
          type="button"
        >
          <Strikethrough size={15} />
        </button>
        <button
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
          title="清除格式"
          aria-label="清除格式"
          type="button"
        >
          <Eraser size={15} />
        </button>
      </div>

      <div className="toolbar-group">
        <input
          type="color"
          className="toolbar-color-picker"
          value={editor.getAttributes('textStyle').color || '#20201d'}
          onChange={(event) => editor.chain().focus().setColor(event.target.value).run()}
          title="文字颜色"
        />
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        {([
          ['left', AlignLeft, '左对齐'],
          ['center', AlignCenter, '居中'],
          ['right', AlignRight, '右对齐'],
          ['justify', AlignJustify, '两端对齐'],
        ] as const).map(([align, Icon, title]) => (
          <button
            key={align}
            className={editor.isActive({ textAlign: align }) ? 'active' : ''}
            onClick={() => editor.chain().focus().setTextAlign(align).run()}
            title={title}
            aria-label={title}
            type="button"
          >
            <Icon size={15} />
          </button>
        ))}
      </div>

      <div className="toolbar-group">
        <button
          className={editor.isActive('orderedList') ? 'active' : ''}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="有序列表"
          aria-label="有序列表"
          type="button"
        >
          <ListOrdered size={15} />
        </button>
        <button
          className={editor.isActive('bulletList') ? 'active' : ''}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="无序列表"
          aria-label="无序列表"
          type="button"
        >
          <List size={15} />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-menu-wrap">
        <button
          className={`toolbar-menu-trigger ${openMenu === 'insert' ? 'active' : ''}`}
          onClick={() => setOpenMenu(openMenu === 'insert' ? null : 'insert')}
          type="button"
        >
          <Plus size={14} />
          插入
          <ChevronDown size={13} />
        </button>
        {openMenu === 'insert' && (
          <div className="toolbar-dropdown">
            <button type="button" onClick={() => run(() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}>
              <Table size={14} />
              3 x 3 表格
            </button>
            <button type="button" onClick={() => run(insertImage)}>
              <Image size={14} />
              图片
            </button>
            <button type="button" onClick={() => run(() => editor.chain().focus().setHorizontalRule().run())}>
              <Minus size={14} />
              分割线
            </button>
            <button type="button" onClick={() => run(() => editor.chain().focus().toggleBlockquote().run())}>
              <Quote size={14} />
              引用块
            </button>
          </div>
        )}
      </div>

      {inTable && (
        <>
          <div className="toolbar-divider" />
          <div className="toolbar-group toolbar-table-tools">
            <button type="button" title="下方加行" aria-label="下方加行" onClick={() => editor.chain().focus().addRowAfter().run()}>
              <Rows3 size={15} />
            </button>
            <button type="button" title="右侧加列" aria-label="右侧加列" onClick={() => editor.chain().focus().addColumnAfter().run()}>
              <Columns3 size={15} />
            </button>
            <button type="button" title="删除行" aria-label="删除行" onClick={() => editor.chain().focus().deleteRow().run()}>
              <Scissors size={15} />
            </button>
            <button type="button" title="删除列" aria-label="删除列" onClick={() => editor.chain().focus().deleteColumn().run()}>
              <StretchHorizontal size={15} />
            </button>
            <button type="button" title="删除表格" aria-label="删除表格" onClick={() => editor.chain().focus().deleteTable().run()}>
              <Trash2 size={15} />
            </button>
          </div>
        </>
      )}

      <div className="toolbar-spacer" />

      {hasSelection && (
        <div className="toolbar-selection-actions">
          <span>已选 {selectedCount} 字</span>
          <button type="button" onClick={() => onSelectionRewrite?.('润色这段文字，保持原意，让表达更自然。')}>
            局部改写
          </button>
          <button type="button" onClick={() => onSelectionRewrite?.('压缩这段文字，删掉重复表达，保留核心信息。')}>
            缩短
          </button>
          <button type="button" onClick={() => onSelectionRewrite?.('扩写这段文字，补充细节和过渡，但不要改变原意。')}>
            扩写
          </button>
        </div>
      )}

      <div className="toolbar-menu-wrap">
        <button
          className="toolbar-ai-btn"
          onClick={() => setOpenMenu(openMenu === 'ai' ? null : 'ai')}
          type="button"
        >
          <Sparkles size={14} />
          AI 菜单
          <ChevronDown size={13} />
        </button>
        {openMenu === 'ai' && (
          <div className="toolbar-dropdown toolbar-ai-dropdown">
            {hasSelection && (
              <>
                <button type="button" onClick={() => run(() => onSelectionRewrite?.('润色这段文字，保持原意，让表达更自然。'))}>
                  <Wand2 size={14} />
                  润色选中
                </button>
                <button type="button" onClick={() => run(() => onSelectionRewrite?.('解释这段文字的问题，并给出更清楚的改写。'))}>
                  <Sparkles size={14} />
                  解释修改
                </button>
              </>
            )}
            <button type="button" onClick={() => run(() => onFullTextRewrite?.('诊断全文的问题，然后给出一版结构更清楚、表达更自然的改写。'))}>
              <Sparkles size={14} />
              诊断并改写
            </button>
            <button type="button" onClick={() => run(() => onFullTextRewrite?.('续写当前文章，保持原有语气和结构。'))}>
              <Wand2 size={14} />
              续写当前段
            </button>
            <button type="button" onClick={() => run(() => onFullTextRewrite?.('把这篇文章提炼成清晰的大纲。'))}>
              <List size={14} />
              提炼大纲
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
