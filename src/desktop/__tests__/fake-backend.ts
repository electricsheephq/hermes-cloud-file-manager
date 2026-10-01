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

export interface Recorded {
  path: string
  params: Record<string, string>
  opts?: any
}

export function fakeBackend(overrides: Record<string, (opts?: any) => any> = {}) {
  const calls: Recorded[] = []
  const rest = async (full: string, opts?: any) => {
    const [path, qs = ''] = full.split('?')
    const params = Object.fromEntries(new URLSearchParams(qs))
    calls.push({ path, params, opts })
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
        .filter(e => e.name.includes(params.q))
      return { ok: true, results, truncated: false, visited: 7 }
    }
    if (path === '/mkdir') return { ok: true, created: true, entry: entry(opts.body.path, true) }
    return { ok: false, code: 'unknown', message: `no fake for ${path}` }
  }
  return { rest, calls }
}
