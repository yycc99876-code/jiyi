import type { ArgumentGraph, StructuralNudge } from './ai/coherenceTypes'

export interface StoredDocument {
  id: string
  title: string
  content: string
  graph: ArgumentGraph | null
  nudges: StructuralNudge[]
  createdAt: number
  updatedAt: number
}

const STORAGE_KEY = 'revision-lens-documents'
const ACTIVE_KEY = 'revision-lens-active-doc'

const sampleContent = `
<h1>AI 写作工具应该如何真正帮助用户</h1>
<p>很多 AI 写作产品现在都可以帮助用户更好地完成内容创作，并提升工作效率。但是这些产品经常会直接生成一大段内容，用户很难判断哪些地方是真的有帮助，哪些地方只是看起来更流畅。</p>
<p>我希望做一个更自然的编辑器体验，让 AI 不只是替用户写东西，而是在合适的时候给出建议。这个产品可以帮助用户管理自己的想法，并让写作过程变得更加高效。</p>
<p>真正好的 AI Writing 产品应该尊重用户原本的表达，理解用户正在写什么，并在需要的时候提供可以被用户控制的修改。</p>
`

function generateId(): string {
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function extractTitle(content: string): string {
  const h1Match = content.match(/<h1[^>]*>(.*?)<\/h1>/)
  if (h1Match) {
    return h1Match[1].replace(/<[^>]+>/g, '').trim()
  }
  const textMatch = content.replace(/<[^>]+>/g, '').trim()
  if (textMatch) {
    const firstLine = textMatch.split('\n')[0].trim()
    return firstLine.length > 30 ? `${firstLine.slice(0, 30)}...` : firstLine
  }
  return '未命名文档'
}

function loadAll(): StoredDocument[] {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

function saveAll(docs: StoredDocument[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(docs))
}

export function getActiveDocId(): string | null {
  return window.localStorage.getItem(ACTIVE_KEY)
}

export function setActiveDocId(id: string) {
  window.localStorage.setItem(ACTIVE_KEY, id)
}

export function getAllDocuments(): StoredDocument[] {
  return loadAll().sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getDocument(id: string): StoredDocument | null {
  return loadAll().find((d) => d.id === id) ?? null
}

export function createDocument(content?: string): StoredDocument {
  const now = Date.now()
  const doc: StoredDocument = {
    id: generateId(),
    title: extractTitle(content ?? ''),
    content: content ?? '<p></p>',
    graph: null,
    nudges: [],
    createdAt: now,
    updatedAt: now,
  }
  const docs = loadAll()
  docs.push(doc)
  saveAll(docs)
  setActiveDocId(doc.id)
  return doc
}

export function updateDocument(
  id: string,
  updates: Partial<Pick<StoredDocument, 'title' | 'content' | 'graph' | 'nudges'>>,
): StoredDocument | null {
  const docs = loadAll()
  const idx = docs.findIndex((d) => d.id === id)
  if (idx === -1) return null

  if (updates.title !== undefined) {
    docs[idx].title = updates.title
  }
  if (updates.content !== undefined) {
    docs[idx].content = updates.content
    if (updates.title === undefined) {
      docs[idx].title = extractTitle(updates.content)
    }
  }
  if (updates.graph !== undefined) {
    docs[idx].graph = updates.graph
  }
  if (updates.nudges !== undefined) {
    docs[idx].nudges = updates.nudges
  }
  docs[idx].updatedAt = Date.now()

  saveAll(docs)
  return docs[idx]
}

export function deleteDocument(id: string): boolean {
  const docs = loadAll()
  const filtered = docs.filter((d) => d.id !== id)
  if (filtered.length === docs.length) return false
  saveAll(filtered)

  // If deleted doc was active, switch to most recent
  if (getActiveDocId() === id) {
    const sorted = filtered.sort((a, b) => b.updatedAt - a.updatedAt)
    if (sorted.length > 0) {
      setActiveDocId(sorted[0].id)
    } else {
      window.localStorage.removeItem(ACTIVE_KEY)
    }
  }
  return true
}

export function getOrCreateDefault(): { doc: StoredDocument; isNew: boolean } {
  const docs = getAllDocuments()
  if (docs.length > 0) {
    const activeId = getActiveDocId()
    const active = activeId ? docs.find((d) => d.id === activeId) : null
    return { doc: active ?? docs[0], isNew: false }
  }
  // First launch — create sample document
  const doc = createDocument(sampleContent)
  return { doc, isNew: true }
}

export function compact(text: string, size = 44): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > size ? `${clean.slice(0, size)}...` : clean
}
