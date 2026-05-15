import { forwardRef, useImperativeHandle, useState, useEffect, useRef } from 'react'
import {
  Type, Heading1, Heading2, Heading3, ListOrdered, List,
  Table, Minus, Image, Code, Quote, Sparkles,
} from 'lucide-react'
import type { SlashCommandItem } from './slashCommands'

const iconMap: Record<string, React.FC<{ size?: number }>> = {
  Type, Heading1, Heading2, Heading3, ListOrdered, List,
  Table, Minus, Image, Code, Quote, Sparkles,
}

interface SlashCommandMenuProps {
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
}

export interface SlashCommandMenuRef {
  onKeyDown: (event: KeyboardEvent) => boolean
}

const SlashCommandMenu = forwardRef<SlashCommandMenuRef, SlashCommandMenuProps>(
  function SlashCommandMenu({ items, command }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0)
    const listRef = useRef<HTMLDivElement>(null)

    useEffect(() => { setSelectedIndex(0) }, [items])

    useEffect(() => {
      setSelectedIndex((index) => Math.min(index, Math.max(items.length - 1, 0)))
    }, [items.length])

    useEffect(() => {
      const el = listRef.current?.querySelectorAll<HTMLElement>('.slash-command-item')[selectedIndex]
      el?.scrollIntoView({ block: 'nearest' })
    }, [selectedIndex])

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent): boolean => {
        if (items.length === 0) return false

        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setSelectedIndex((i) => (i + items.length - 1) % items.length)
          return true
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setSelectedIndex((i) => (i + 1) % items.length)
          return true
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          const item = items[selectedIndex]
          if (item) command(item)
          return true
        }
        return false
      },
    }), [items, selectedIndex, command])

    if (items.length === 0) {
      return (
        <div className="slash-command-popup">
          <div className="slash-command-empty">无匹配命令</div>
        </div>
      )
    }

    const groups: { label: string; items: SlashCommandItem[] }[] = []
    const groupMap = new Map<string, SlashCommandItem[]>()
    for (const item of items) {
      if (!groupMap.has(item.group)) groupMap.set(item.group, [])
      groupMap.get(item.group)!.push(item)
    }
    for (const [label, groupItems] of groupMap) {
      groups.push({ label, items: groupItems })
    }

    let flatIndex = -1

    return (
      <div className="slash-command-popup">
        <div className="slash-command-list" ref={listRef}>
          {groups.map((group) => (
            <div key={group.label}>
              <div className="slash-command-group-label">{group.label}</div>
              {group.items.map((item) => {
                flatIndex++
                const itemIndex = flatIndex
                const Icon = iconMap[item.icon] || Type
                const isSelected = itemIndex === selectedIndex
                return (
                  <button
                    key={item.title}
                    className={`slash-command-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => command(item)}
                    onMouseEnter={() => setSelectedIndex(itemIndex)}
                  >
                    <span className="slash-command-item-icon">
                      <Icon size={16} />
                    </span>
                    <span className="slash-command-item-text">
                      <span className="slash-command-item-title">{item.title}</span>
                      <span className="slash-command-item-desc">{item.description}</span>
                    </span>
                    {item.alias && (
                      <span className="slash-command-item-alias">/{item.alias}</span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    )
  },
)

export default SlashCommandMenu
export { iconMap }
