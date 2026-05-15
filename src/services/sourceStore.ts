export interface SourceMaterial {
  id: string
  docId: string
  type: 'file' | 'web'
  format: 'txt' | 'md' | 'docx' | 'pdf' | 'html'
  title: string
  content: string
  htmlContent: string
  originalFileName?: string
  url?: string
  selected: boolean
  createdAt: number
  rawDataBase64?: string
  mimeType?: string
}

const STORAGE_KEY = 'revision-lens-sources'
const MAX_STORAGE_BYTES = 8 * 1024 * 1024 // 8MB
const MAX_CONTENT_BYTES = 2 * 1024 * 1024 // 2MB per material

function generateId(): string {
  return `src_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function loadAll(): SourceMaterial[] {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

function saveAll(sources: SourceMaterial[]): boolean {
  const json = JSON.stringify(sources)
  if (new Blob([json]).size > MAX_STORAGE_BYTES) {
    return false
  }
  window.localStorage.setItem(STORAGE_KEY, json)
  return true
}

export function truncateContent(text: string, maxBytes: number = MAX_CONTENT_BYTES): string {
  const encoder = new TextEncoder()
  if (encoder.encode(text).length <= maxBytes) return text
  // Binary search for the right cutoff
  let lo = 0, hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (encoder.encode(text.slice(0, mid)).length <= maxBytes) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  return text.slice(0, lo) + '\n\n[内容已截断]'
}

export function getSourcesByDocId(docId: string): SourceMaterial[] {
  return loadAll().filter((s) => s.docId === docId).sort((a, b) => b.createdAt - a.createdAt)
}

export function addSource(
  source: Omit<SourceMaterial, 'id' | 'createdAt'>,
): SourceMaterial | null {
  const all = loadAll()
  const newSource: SourceMaterial = {
    ...source,
    id: generateId(),
    createdAt: Date.now(),
  }
  all.push(newSource)
  if (!saveAll(all)) {
    all.pop()
    return null
  }
  return newSource
}

export function updateSource(
  id: string,
  updates: Partial<Pick<SourceMaterial, 'selected' | 'title'>>,
): SourceMaterial | null {
  const all = loadAll()
  const idx = all.findIndex((s) => s.id === id)
  if (idx === -1) return null
  const previous = { ...all[idx] }
  Object.assign(all[idx], updates)
  if (!saveAll(all)) {
    Object.assign(all[idx], previous)
    return null
  }
  return all[idx]
}

export function deleteSource(id: string): boolean {
  const all = loadAll()
  const filtered = all.filter((s) => s.id !== id)
  if (filtered.length === all.length) return false
  saveAll(filtered)
  return true
}

export function deleteSourcesByDocId(docId: string): void {
  const all = loadAll()
  const filtered = all.filter((s) => s.docId !== docId)
  saveAll(filtered)
}

export function getSelectedSources(docId: string): SourceMaterial[] {
  return getSourcesByDocId(docId).filter((s) => s.selected)
}
