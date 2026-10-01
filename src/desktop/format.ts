// Pure helpers: insert text, sizes, dates, POSIX paths. No regex literal here may contain a quote or a
// backtick (the fork's runtime loader misreads those; see scripts/check-loader-scan.mjs).
import { S } from './strings'

const TICK = '`'

export interface Location {
  abs: string
  is_dir: boolean
}

/** One markdown bullet per location; folders end in `/`. A path containing a backtick is wrapped in
 *  double backticks with inner spaces so the code span still closes. */
export function formatLocation({ abs, is_dir }: Location): string {
  const path = is_dir && !abs.endsWith('/') ? `${abs}/` : abs
  const [open, close] = path.includes(TICK) ? [`${TICK}${TICK} `, ` ${TICK}${TICK}`] : [TICK, TICK]
  return `- ${open}${path}${close}`
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
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
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

const MEDIA = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'bmp', 'svg', 'tif', 'tiff', 'mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'])

export function entryIcon(entry: { name: string; is_dir: boolean; link_outside?: boolean }): string {
  if (entry.link_outside) return 'link'
  if (entry.is_dir) return 'folder'
  const dot = entry.name.lastIndexOf('.')
  return dot > 0 && MEDIA.has(entry.name.slice(dot + 1).toLowerCase()) ? 'file-media' : 'file'
}
