import { host } from './sdk-mock'

// A fake Cloud File Manager backend for the UI tests, answering ctx.rest(path, opts) like the real API.
const MiB = 1024 * 1024
const entry = (rel: string, is_dir = false, size = 1200) => ({
  name: rel.split('/').pop()!,
  rel,
  abs: `/home/agent/${rel}`,
  is_dir,
  size: is_dir ? 0 : size,
  mtime: 1767225600,
  link_outside: false
})

export const ROOTS = {
  ok: true,
  supported: true,
  reason: null,
  roots: [{ id: 'home', label: 'Home', path: '/home/agent', notes: { docs: 'Shared documents' } }],
  max_file_bytes: 100 * MiB,
  chunk_bytes: 4 * MiB,
  highlights: ['docs', 'uploads']
}

const FOLDERS: Record<string, ReturnType<typeof entry>[]> = {
  '': [entry('notes.txt'), entry('zeta', true), entry('uploads', true), entry('docs', true), entry('readme.md')],
  docs: [entry('docs/a.pdf'), entry('docs/b.pdf')]
}

// Google Drive: a root with a folder, a Google Doc (no size) and a PDF; the folder holds a spreadsheet.
const drive = (id: string, name: string, mime: string, size: null | number = 2048, mtime: null | string = '2024-03-04T10:00:00Z') => ({
  id,
  name,
  mime,
  is_folder: mime === 'application/vnd.google-apps.folder',
  size: mime === 'application/vnd.google-apps.folder' ? null : size,
  mtime
})
export const DRIVE: Record<string, ReturnType<typeof drive>[]> = {
  root: [
    drive('fold1', 'Projects', 'application/vnd.google-apps.folder'),
    drive('doc1', 'Plan', 'application/vnd.google-apps.document', null),
    drive('pdf1', 'report.pdf', 'application/pdf', 2048)
  ],
  fold1: [drive('sheet1', 'Budget', 'application/vnd.google-apps.spreadsheet', null, '2025-12-24T08:30:00Z')]
}
const driveItems = () => Object.values(DRIVE).flat()
/** The Entry the fake gateway answers for an imported Drive file. */
export const importedEntry = (id: string) => entry(`uploads/drive/${driveItems().find(item => item.id === id)?.name ?? id}`)

// Editable files for GET /file and POST /file/save, by rel path. The sha is a stand-in for the server's sha256.
export const TEXTS: Record<string, string> = {
  'readme.md': '# Readme\n\nHello from the agent.\n',
  'notes.txt': 'line one\nline two\n',
  'other.md': '# Other\n'
}
export const fakeSha = (text: string) => {
  let h = 0
  for (const ch of text) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0
  return `sha-${(h >>> 0).toString(16)}-${text.length}`
}

export interface Recorded {
  path: string
  params: Record<string, string>
  opts?: any
  /** The agent selected when the request was made (where ctx.rest routes it). */
  connectionId: null | string
  profile: string
}

export function fakeBackend(overrides: Record<string, (opts?: any) => any> = {}, texts: Record<string, string> = TEXTS) {
  const calls: Recorded[] = []
  const files = new Map(Object.entries(texts))
  const rest = async (full: string, opts?: any) => {
    const [path, qs = ''] = full.split('?')
    const params = Object.fromEntries(new URLSearchParams(qs))
    calls.push({ path, params, opts, connectionId: host.state.connectionId.get(), profile: host.state.profile.get() })
    if (overrides[path]) return overrides[path](opts)
    if (path === '/available') return { ok: true, plugin: 'hermes-cloud-file-manager', version: '0.1.0' }
    if (path === '/roots') return ROOTS
    if (path === '/list') {
      const entries = FOLDERS[params.path] ?? []
      return { ok: true, root: params.root, path: params.path, entries, total: entries.length, truncated: false }
    }
    if (path === '/search') {
      const results = Object.values(FOLDERS)
        .flat()
        .filter(e => (!params.path || e.rel.startsWith(`${params.path}/`)) && e.name.includes(params.q))
      return { ok: true, results, truncated: false, reason: null, visited: 7 }
    }
    if (path === '/drive/available') return { ok: true, available: true }
    if (path === '/drive/list') {
      const items = params.q ? driveItems().filter(item => item.name.toLowerCase().includes(params.q.toLowerCase())) : DRIVE[params.folder] ?? []
      return { ok: true, items, truncated: false }
    }
    if (path === '/drive/import') return { ok: true, entry: importedEntry(opts.body.id), renamed: false }
    if (path === '/file') {
      const text = files.get(params.path)
      if (text === undefined) return { ok: false, code: 'not_editable', message: 'not editable' }
      return { ok: true, text, sha256: fakeSha(text), size: text.length, mtime: 1767225600 }
    }
    if (path === '/file/save') {
      const current = files.get(opts.body.path)
      if (current === undefined) return { ok: false, code: 'gone' }
      if (fakeSha(current) !== opts.body.base_sha256) return { ok: false, code: 'conflict', sha256: fakeSha(current), text: current }
      files.set(opts.body.path, opts.body.text)
      return { ok: true, sha256: fakeSha(opts.body.text), size: opts.body.text.length, mtime: 1767225601 }
    }
    if (path === '/mkdir') return { ok: true, created: true, entry: entry(opts.body.path, true) }
    return { ok: false, code: 'unknown', message: `no fake for ${path}` }
  }
  return { rest, calls, files }
}
