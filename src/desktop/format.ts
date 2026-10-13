// Pure helpers: insert text, sizes, dates, POSIX paths. No regex literal here may contain a quote or a
// backtick (the fork's runtime loader misreads those; see scripts/check-loader-scan.mjs).
import { S } from './strings'

const TICK = '`'

export const hasLineBreak = (abs: string) => abs.includes('\n') || abs.includes('\r')

export interface Location {
  abs: string
  is_dir: boolean
}

/** Length of the longest run of consecutive backticks in `text`. */
function longestTickRun(text: string): number {
  let longest = 0
  let run = 0
  for (const ch of text) {
    run = ch === TICK ? run + 1 : 0
    longest = Math.max(longest, run)
  }
  return longest
}

/** One markdown bullet per location; folders end in `/`. The code-span fence is one backtick longer than
 *  the longest backtick run in the path (CommonMark), padded with a space when the path starts or ends with
 *  a backtick so the fence and the path don't merge. */
export function formatLocation({ abs, is_dir }: Location): string {
  const path = is_dir && !abs.endsWith('/') ? `${abs}/` : abs
  const fence = TICK.repeat(longestTickRun(path) + 1)
  const pad = path.startsWith(TICK) || path.endsWith(TICK) ? ' ' : ''
  return `- ${fence}${pad}${path}${pad}${fence}`
}

export function formatInsertText(profile: string, items: Location[]): string {
  return `\n${S.insertHeader(profile)}\n${items.map(formatLocation).join('\n')}`
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

/** Short modified date: time today, "Mar 4" this year, else "Mar 4, 2024". `mtime` is epoch seconds. */
export function shortDate(mtime: number, now = new Date()): string {
  const date = new Date(mtime * 1000)
  if (Number.isNaN(date.getTime())) return ''
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

/** Join POSIX path pieces, dropping empty segments ("" + "a/b" → "a/b"). */
export function joinPath(...parts: string[]): string {
  return parts
    .flatMap(part => part.split('/'))
    .filter(Boolean)
    .join('/')
}

export function parentPath(rel: string): string {
  const parts = rel.split('/').filter(Boolean)
  return parts.slice(0, -1).join('/')
}

export function baseName(rel: string): string {
  const parts = rel.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

const EDITABLE = new Set(['md', 'markdown', 'txt'])

function extension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** Files the editor opens: .md, .markdown and .txt (any case). Folders and links never qualify. */
export const isEditable = (entry: { name: string; is_dir: boolean; link_outside?: boolean }) =>
  !entry.is_dir && !entry.link_outside && EDITABLE.has(extension(entry.name))

export const isMarkdown = (name: string) => extension(name) !== 'txt'

/** Files the read-only viewer shows through GET /file/preview, by lowercase extension (the gateway's table).
 *  md, markdown and txt are in none of them: those open in the editor. */
export const PREVIEW_EXTS = {
  image: { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml' } as Record<string, string>,
  pdf: ['pdf'],
  text: ('json jsonl ndjson yaml yml toml ini cfg conf properties csv tsv log xml html htm css scss less js mjs cjs ts tsx jsx py rb go rs java kt ' +
    'swift c h cc cpp hpp cs php sh bash zsh fish ps1 sql r lua pl dart scala vue svelte graphql proto tf diff patch rst tex adoc srt vtt').split(' ')
}

export type PreviewKind = 'image' | 'pdf' | 'text'

export function previewKind(name: string): PreviewKind | null {
  const ext = extension(name)
  if (!ext) return null
  if (Object.hasOwn(PREVIEW_EXTS.image, ext)) return 'image'
  if (PREVIEW_EXTS.pdf.includes(ext)) return 'pdf'
  return PREVIEW_EXTS.text.includes(ext) ? 'text' : null
}

/** Files a double-click, Enter or Open shows: editable ones in the editor, previewable ones in the viewer. */
export const isOpenable = (entry: { name: string; is_dir: boolean; link_outside?: boolean }) =>
  !entry.is_dir && !entry.link_outside && (EDITABLE.has(extension(entry.name)) || previewKind(entry.name) !== null)

/** CSV (or TSV with a tab) by RFC 4180: quoted fields, doubled quotes, line breaks inside quotes. Stops after
 *  `maxRows` rows; `more` says rows were left. A CRLF or LF ends a row; a final line break adds no empty row. */
export function parseDelimited(text: string, sep: string, maxRows: number): { rows: string[][]; more: boolean } {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let open = false // the last record has begun, even if only with an empty quoted field
  const end = () => {
    row.push(field)
    field = ''
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch !== '"') field += ch
      else if (text[i + 1] === '"') field += text[++i]
      else quoted = false
    } else if (ch === '"' && field === '') {
      quoted = true
    } else if (ch === sep) {
      end()
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      end()
      if (rows.length === maxRows) return { rows, more: true }
      rows.push(row)
      row = []
      open = false
      continue
    } else {
      field += ch
    }
    open = true
  }
  if (open) {
    end()
    if (rows.length === maxRows) return { rows, more: true }
    rows.push(row)
  }
  return { rows, more: false }
}

const MEDIA = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'bmp', 'svg', 'tif', 'tiff', 'mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'])

export function entryIcon(entry: { name: string; is_dir: boolean; link_outside?: boolean }): string {
  if (entry.link_outside) return 'link'
  if (entry.is_dir) return 'folder'
  const dot = entry.name.lastIndexOf('.')
  return dot > 0 && MEDIA.has(entry.name.slice(dot + 1).toLowerCase()) ? 'file-media' : 'file'
}
