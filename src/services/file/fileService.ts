import mammoth from 'mammoth'
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'

// ─── Import ───

function extOf(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim()
      if (!trimmed) return ''
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`
    })
    .filter(Boolean)
    .join('')
}

async function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

async function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file, 'utf-8')
  })
}

export interface ImportResult {
  html: string
  fileName: string
}

export async function importFile(file: File): Promise<ImportResult> {
  const ext = extOf(file.name)

  if (ext === 'doc') {
    throw new Error(
      '.doc 是旧版 Word 格式，暂不支持直接导入。请用 Word 或 WPS 另存为 .docx 格式后再试。',
    )
  }

  if (ext === 'docx') {
    const arrayBuffer = await readAsArrayBuffer(file)
    const result = await mammoth.convertToHtml({ arrayBuffer })
    return { html: result.value, fileName: file.name }
  }

  if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
    const text = await readAsText(file)
    return { html: textToHtml(text), fileName: file.name }
  }

  throw new Error(`不支持的文件格式: .${ext}。支持 .docx、.txt、.md、.markdown`)
}

// ─── Export Helpers ───

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function stripHtml(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent ?? ''
}

function htmlToMarkdown(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html

  let md = ''

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      md += node.textContent
      return
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement
    const tag = el.tagName.toLowerCase()

    if (tag === 'h1') {
      md += `\n# ${el.textContent}\n\n`
      return
    }
    if (tag === 'h2') {
      md += `\n## ${el.textContent}\n\n`
      return
    }
    if (tag === 'h3') {
      md += `\n### ${el.textContent}\n\n`
      return
    }
    if (tag === 'p') {
      md += '\n'
      el.childNodes.forEach(walk)
      md += '\n\n'
      return
    }
    if (tag === 'br') {
      md += '\n'
      return
    }
    if (tag === 'strong' || tag === 'b') {
      md += `**${el.textContent}**`
      return
    }
    if (tag === 'em' || tag === 'i') {
      md += `*${el.textContent}*`
      return
    }
    if (tag === 'blockquote') {
      md += `\n> ${el.textContent}\n\n`
      return
    }
    if (tag === 'ul' || tag === 'ol') {
      el.childNodes.forEach((li, i) => {
        if (li.nodeType === Node.ELEMENT_NODE) {
          const prefix = tag === 'ol' ? `${i + 1}. ` : '- '
          md += `${prefix}${(li as HTMLElement).textContent}\n`
        }
      })
      md += '\n'
      return
    }
    if (tag === 'li') {
      el.childNodes.forEach(walk)
      return
    }

    el.childNodes.forEach(walk)
  }

  div.childNodes.forEach(walk)
  return md.replace(/\n{3,}/g, '\n\n').trim()
}

function headingTagToLevel(tag: string): (typeof HeadingLevel)[keyof typeof HeadingLevel] | undefined {
  switch (tag) {
    case 'h1':
      return HeadingLevel.HEADING_1
    case 'h2':
      return HeadingLevel.HEADING_2
    case 'h3':
      return HeadingLevel.HEADING_3
    default:
      return undefined
  }
}

function htmlToDocxParagraphs(html: string): Paragraph[] {
  const div = document.createElement('div')
  div.innerHTML = html
  const paragraphs: Paragraph[] = []

  function walkBlock(block: HTMLElement) {
    const tag = block.tagName.toLowerCase()
    const runs: TextRun[] = []

    function collectRuns(node: Node) {
      if (node.nodeType === Node.TEXT_NODE) {
        runs.push(new TextRun({ text: node.textContent ?? '' }))
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return
      const el = node as HTMLElement
      const childRuns: TextRun[] = []

      function collectChild(n: Node) {
        if (n.nodeType === Node.TEXT_NODE) {
          childRuns.push(new TextRun({ text: n.textContent ?? '' }))
          return
        }
        if (n.nodeType !== Node.ELEMENT_NODE) return
        const e = n as HTMLElement
        const t = e.tagName.toLowerCase()
        if (t === 'strong' || t === 'b') {
          childRuns.push(new TextRun({ text: e.textContent ?? '', bold: true }))
        } else if (t === 'em' || t === 'i') {
          childRuns.push(new TextRun({ text: e.textContent ?? '', italics: true }))
        } else {
          e.childNodes.forEach(collectChild)
        }
      }

      el.childNodes.forEach(collectChild)
      runs.push(...childRuns)
    }

    block.childNodes.forEach(collectRuns)
    const heading = headingTagToLevel(tag)

    paragraphs.push(
      new Paragraph({
        children: runs,
        ...(heading ? { heading } : {}),
      }),
    )
  }

  div.childNodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      walkBlock(node as HTMLElement)
    } else if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      paragraphs.push(new Paragraph({ children: [new TextRun({ text: node.textContent })] }))
    }
  })

  if (paragraphs.length === 0) {
    paragraphs.push(new Paragraph({ children: [new TextRun({ text: '' })] }))
  }

  return paragraphs
}

// ─── Export Functions ───

export function exportTxt(html: string, fileName: string) {
  const text = stripHtml(html)
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  download(blob, fileName.replace(/\.\w+$/, '.txt'))
}

export function exportMarkdown(html: string, fileName: string) {
  const md = htmlToMarkdown(html)
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  download(blob, fileName.replace(/\.\w+$/, '.md'))
}

export async function exportDocx(html: string, fileName: string) {
  const paragraphs = htmlToDocxParagraphs(html)
  const doc = new Document({ sections: [{ children: paragraphs }] })
  const blob = await Packer.toBlob(doc)
  download(blob, fileName.replace(/\.\w+$/, '.docx'))
}

export function exportDoc(html: string, fileName: string) {
  const content = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`
  const blob = new Blob([content], { type: 'application/msword' })
  download(blob, fileName.replace(/\.\w+$/, '.doc'))
}
