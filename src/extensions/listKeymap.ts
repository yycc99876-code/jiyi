import { Extension } from '@tiptap/core'

function isPlainNumberMarker(text: string) {
  return /^\s*\d+\.\s*$/.test(text)
}

export const ListKeymap = Extension.create({
  name: 'listKeymap',

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        if (!empty) return false

        const paragraph = editor.schema.nodes.paragraph
        const listItem = editor.schema.nodes.listItem
        if (!paragraph || !listItem) return false

        if ($from.parent.type === paragraph && isPlainNumberMarker($from.parent.textContent)) {
          return editor.commands.splitBlock()
        }

        for (let depth = $from.depth; depth > 0; depth--) {
          if ($from.node(depth).type === listItem && $from.node(depth).textContent.trim() === '') {
            return editor.commands.liftListItem('listItem')
          }
        }

        return false
      },
    }
  },
})
