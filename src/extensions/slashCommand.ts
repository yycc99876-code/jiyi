import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import type { SuggestionOptions, SuggestionKeyDownProps } from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import tippy, { type Instance as TippyInstance } from 'tippy.js'
import SlashCommandMenu from '../components/editor/SlashCommandMenu'

const suggestionRender = () => {
  let component: ReactRenderer | null = null
  let popup: TippyInstance[] | null = null

  return {
    onStart: (props: any) => {
      component = new ReactRenderer(SlashCommandMenu, {
        props,
        editor: props.editor,
      })

      if (!props.clientRect) return

      popup = tippy('body', {
        getReferenceClientRect: props.clientRect,
        appendTo: () => document.body,
        content: component.element,
        showOnCreate: true,
        interactive: true,
        trigger: 'manual',
        placement: 'bottom-start',
      })
    },

    onUpdate: (props: any) => {
      component?.updateProps(props)

      if (!props.clientRect) return

      popup?.[0]?.setProps({
        getReferenceClientRect: props.clientRect,
      })
    },

    onKeyDown: (props: SuggestionKeyDownProps) => {
      if (props.event.key === 'Escape') {
        popup?.[0]?.hide()
        return true
      }

      return (component?.ref as any)?.onKeyDown?.(props.event) ?? false
    },

    onExit: () => {
      popup?.[0]?.destroy()
      component?.destroy()
    },
  }
}

export interface SlashCommandOptions {
  suggestion: Omit<SuggestionOptions, 'editor'>
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        allowSpaces: false,
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        render: suggestionRender,
        ...this.options.suggestion,
      }),
    ]
  },
})
