// v0.4.3: finished upload navigation, current-folder Drive imports, preview retry and composer references.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { createTestContext, host, resetHost, resetQueryCache } from './sdk-mock'
import { fakeBackend, ROOTS } from './fake-backend'
import { $available, $driveAvailable, bindContext } from '../api'
import { $driveJob, DriveImport } from '../drive'
import { $drafts } from '../editor'
import { formatRef } from '../format'
import { $batch, CloudFilesPage } from '../page'
import { closePicker, driveProvider, PickerHost } from '../picker'
import { S } from '../strings'
import { type BatchSnapshot, UploadBatch } from '../upload'

const file = (rel: string, extra = {}) => ({ name: rel.split('/').pop()!, rel, abs: `/home/agent/${rel}`, is_dir: false, size: 1, mtime: 0, ...extra })
const row = (name: string) => screen.getByText(name).closest('[role=option]') as HTMLElement
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const flush = async () => { for (let i = 0; i < 5; i++) await act(() => new Promise(resolve => setTimeout(resolve, 0))) }
function page(overrides: Parameters<typeof fakeBackend>[0] = {}) {
  const backend = fakeBackend(overrides)
  bindContext(createTestContext({ rest: backend.rest }).ctx as any)
  return { ...backend, view: render(<CloudFilesPage />) }
}
function doneBatch(extra = {}, pin = { connectionId: 'conn-1', profile: 'default' }) {
  const snap: BatchSnapshot = { ...pin, items: [{ id: 1, root: 'home', path: 'docs/a.txt', size: 1, sent: 1, status: 'done', savedAs: 'a (1).txt', ...extra }], running: false, paused: false, canceled: false }
  $batch.set({ getSnapshot: () => snap, subscribe: () => () => undefined } as unknown as UploadBatch)
}
const roots = { ...ROOTS, roots: [...ROOTS.roots, { id: 'work', label: 'Work', path: '/work' }] }
const choose = (name: string) => fireEvent.click(screen.getAllByRole('option').find(el => el.closest('[data-select]') && el.textContent === name)!)
const insertion = () => {
  const insertText = vi.fn(async () => true)
  host.composer = { insertText }
  return insertText
}
beforeEach(() => {
  resetQueryCache(); resetHost()
  $available.set(true); $driveAvailable.set(null); $batch.set(null); $driveJob.set(null); $drafts.set(new Map())
})
afterEach(() => { act(closePicker); vi.restoreAllMocks() })

describe('finished uploads: Show', () => {
  it('opens the parent and focuses the keep-both saved name, explicitly', async () => {
    doneBatch()
    const backend = fakeBackend()
    const rest = async (path: string, opts?: any) => {
      const reply = await backend.rest(path, opts)
      if (path.startsWith('/list?') && new URLSearchParams(path.split('?')[1]).get('path') === 'docs') return { ok: true, entries: [file('docs/a (1).txt')], total: 1 }
      return reply
    }
    bindContext(createTestContext({ rest }).ctx as any)
    render(<CloudFilesPage />)
    await screen.findByText('notes.txt')
    expect(backend.calls.filter(c => c.path === '/list').every(c => c.params.path === '')).toBe(true)
    click('Show')
    await screen.findByText('a (1).txt')
    await waitFor(() => expect(document.activeElement).toBe(row('a (1).txt')))
  })

  it('shows a directory row in its parent, switching source and root', async () => {
    doneBatch({ root: 'work', path: 'docs/new', isDir: true, savedAs: undefined })
    const backend = page({ '/roots': () => roots, '/list': () => ({ ok: true, entries: [file('docs/new', { is_dir: true })], total: 1 }) })
    act(() => $driveAvailable.set(true))
    await screen.findByText('new')
    choose('Google Drive')
    await screen.findByText('Plan')
    click('Show')
    await screen.findByText('new')
    expect(backend.calls.some(c => c.path === '/list' && c.params.root === 'work' && c.params.path === 'docs')).toBe(true)
    await waitFor(() => expect(document.activeElement).toBe(row('new')))
  })

  it('hides Show for another batch agent', async () => {
    doneBatch({}, { connectionId: 'conn-2', profile: 'other' })
    page()
    await screen.findByText('notes.txt')
    expect(screen.queryByRole('button', { name: 'Show' })).toBeNull()
  })

  it('rechecks live agent identity before navigation', async () => {
    doneBatch()
    const { calls } = page()
    await screen.findByText('notes.txt')
    const notify = vi.spyOn(host, 'notify')
    vi.spyOn(host.state.profile, 'get').mockReturnValue('other')
    click('Show')
    await flush()
    expect(calls.filter(c => c.path === '/list').every(c => c.params.path === '')).toBe(true)
    expect(notify).toHaveBeenCalledWith({ kind: 'warning', message: S.showOtherAgent('default') })
  })
})

describe('Drive destination', () => {
  it.each(['', 'docs'])('imports into current root and folder %j, ignoring search, and Show uses the snapshot', async folder => {
    const { calls } = page({ '/roots': () => roots })
    act(() => $driveAvailable.set(true))
    await screen.findByText('notes.txt')
    choose('Work')
    await screen.findByText('notes.txt')
    if (folder) {
      fireEvent.doubleClick(screen.getByText('docs'))
      await screen.findByText('a.pdf')
      fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'a' } })
    }
    choose('Google Drive')
    await screen.findByText('Plan')
    expect(screen.getByText(S.importHint(folder ? 'Work/docs' : 'Work'))).toBeTruthy()
    fireEvent.click(screen.getByText('Plan'))
    click('Import 1 to Cloud Files')
    await screen.findByText('Imported 1 file')
    expect(calls.find(c => c.path === '/drive/import')?.opts.body).toEqual({ id: 'doc1', root: 'work', dest: folder })
    expect($driveJob.get()?.getSnapshot().dest).toEqual({ root: 'work', folder })
    choose('Home')
    await waitFor(() => expect(screen.getByRole('navigation').textContent).toBe('Home'))
    const at = calls.length
    click('Show')
    await waitFor(() => expect(screen.getByRole('navigation').textContent).toContain(folder ? 'docs' : 'Work'))
    expect(calls.slice(at).filter(c => c.path === '/list').every(c => c.params.root === 'work' && c.params.path === folder)).toBe(true)
    expect(screen.getByLabelText('Search files').getAttribute('value')).toBe('')
  })

  it('picker import still uses uploads/drive', async () => {
    const backend = fakeBackend()
    bindContext(createTestContext({ rest: backend.rest }).ctx as any)
    $driveAvailable.set(true)
    render(<PickerHost />)
    act(() => void driveProvider.run({ insertText: vi.fn() }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(await within(dialog).findByText('Plan'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import and insert' }))
    await waitFor(() => expect(backend.calls.find(c => c.path === '/drive/import')?.opts.body.dest).toBe('uploads/drive'))
  })

  it('pins destination and agent at construction', async () => {
    const backend = fakeBackend()
    const pin = { connectionId: 'conn-1', profile: 'default' }
    const job = new DriveImport([{ id: 'doc1', name: 'Plan', mime: '', is_folder: false, size: 1, mtime: null }], 'work', pin, { rest: backend.rest, state: host.state }, 'a/b')
    pin.profile = 'other'
    await job.start()
    expect(job.getSnapshot().dest).toEqual({ root: 'work', folder: 'a/b' })
    expect(backend.calls[0].opts.body).toEqual({ id: 'doc1', root: 'work', dest: 'a/b' })
  })
})

describe('preview Retry', () => {
  it.each(['timeout', 'network', '503: unavailable'])('retries a transport failure %s, hides while loading, and lands', async message => {
    let release!: (reply: any) => void
    let n = 0
    const { calls } = page({ '/list': () => ({ ok: true, entries: [file('data.json')], total: 1 }), '/file/preview': () => {
      if (++n === 1) throw new Error(message)
      return new Promise(resolve => { release = resolve })
    } })
    fireEvent.doubleClick(await screen.findByText('data.json'))
    await screen.findByRole('button', { name: 'Retry' })
    click('Retry')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(calls.filter(c => c.path === '/file/preview')).toHaveLength(2)
    await act(async () => release({ ok: true, kind: 'text', text: 'retried', size: 7 }))
    expect(await screen.findByText('retried')).toBeTruthy()
  })

  it.each(['too_large', 'not_text', 'not_previewable', 'protected', 'outside_root', 'is_link', 'not_a_file', 'hard_link', 'mount_point', 'bad_path', '404'])('does not retry refusal %s', async code => {
    page({ '/list': () => ({ ok: true, entries: [file('data.json')], total: 1 }), '/file/preview': () => {
      if (code === '404') throw new Error('404: not found')
      return { ok: false, code }
    } })
    fireEvent.doubleClick(await screen.findByText('data.json'))
    await flush()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    if (code === '404') expect(screen.getByText(S.previewNeedsUpdate('default'))).toBeTruthy()
  })

  it('ignores a retry answer after a new generation opens', async () => {
    let release!: (reply: any) => void
    let n = 0
    const backend = fakeBackend({ '/list': () => ({ ok: true, entries: [file('data.json'), file('other.json')], total: 2 }) })
    const rest = async (path: string, opts?: any) => {
      const reply = await backend.rest(path, opts)
      if (!path.startsWith('/file/preview?')) return reply
      if (path.includes('other.json')) return { ok: true, kind: 'text', text: 'new generation', size: 1 }
      if (++n === 1) throw new Error('network')
      return new Promise(resolve => { release = resolve })
    }
    bindContext(createTestContext({ rest }).ctx as any)
    render(<CloudFilesPage />)
    fireEvent.doubleClick(await screen.findByText('data.json'))
    await screen.findByRole('button', { name: 'Retry' })
    click('Retry'); click('Close')
    fireEvent.doubleClick(await screen.findByText('other.json'))
    await screen.findByText('new generation')
    await act(async () => release({ ok: true, kind: 'text', text: 'late', size: 1 }))
    expect(screen.queryByText('late')).toBeNull()
    expect(screen.getByText('new generation')).toBeTruthy()
  })
})

describe('Add to chat', () => {
  it.each<[string, string | null]>([
    ['/home/a.txt', '/home/a.txt'], ['/home/a b', '`/home/a b`'], ['/home/a`b', '"/home/a`b"'],
    ['/home/a.', '`/home/a.`'], ['/home/(paren)', '`/home/(paren)`'], ['/home/a`"\'b', null],
    ['/home/a`"b', "'/home/a`\"b'"], ...[',', ';', '!', '?'].map(ch => [`/home/a${ch}`, '`/home/a' + ch + '`'] as [string, string])
  ])('quotes %s exactly', (path, expected) => expect(formatRef(path!)).toBe(expected))

  it('sends a file and folder in shown order, skipping outside links, with inline active-composer text', async () => {
    const insertText = insertion()
    page({ '/list': () => ({ ok: true, entries: [file('a.txt'), file('docs', { is_dir: true }), file('outside', { link_outside: true })], total: 3 }) })
    await screen.findByText('a.txt')
    for (const name of ['outside', 'docs', 'a.txt']) fireEvent.click(screen.getByLabelText(name))
    const notify = vi.spyOn(host, 'notify')
    click('Add to chat')
    await waitFor(() => expect(insertText).toHaveBeenCalledExactlyOnceWith(null, '@folder:/home/agent/docs @file:/home/agent/a.txt', { mode: 'inline' }))
    expect(notify).toHaveBeenCalledWith({ kind: 'success', message: S.addedToChat(2) })
  })

  it('uses exact file then folder text when that is shown order', async () => {
    const insertText = insertion()
    const entries = [file('a.txt'), file('docs', { is_dir: true })]
    page({ '/list': () => ({ ok: true, entries, total: 2 }), '/search': () => ({ ok: true, results: entries, truncated: false }) })
    await screen.findByText('a.txt')
    fireEvent.click(screen.getByLabelText('a.txt'))
    fireEvent.click(screen.getByLabelText('docs'))
    fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'a' } })
    await screen.findByRole('listbox', { name: 'Search results' })
    click('Add to chat')
    await waitFor(() => expect(insertText).toHaveBeenCalledExactlyOnceWith(null, '@file:/home/agent/a.txt @folder:/home/agent/docs', { mode: 'inline' }))
  })

  it('includes hidden-by-search selection after shown rows', async () => {
    const insertText = insertion()
    page()
    await screen.findByText('notes.txt')
    fireEvent.click(screen.getByLabelText('notes.txt'))
    fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'docs' } })
    await screen.findByRole('listbox', { name: 'Search results' })
    fireEvent.click(screen.getByLabelText('docs'))
    click('Add to chat')
    await waitFor(() => expect(insertText).toHaveBeenCalledExactlyOnceWith(null, '@folder:/home/agent/docs @file:/home/agent/notes.txt', { mode: 'inline' }))
  })

  it.each(['owner', 'profile', 'connectionId'])('refuses a live %s mismatch', async change => {
    const insertText = insertion()
    page()
    fireEvent.click(await screen.findByText('notes.txt'))
    const notify = vi.spyOn(host, 'notify')
    if (change === 'owner') host.state.focusedSessionOwner.set({ connectionId: 'conn-1', profile: 'other' })
    else vi.spyOn(host.state[change as 'profile' | 'connectionId'], 'get').mockReturnValue('other')
    click('Add to chat')
    await flush()
    expect(insertText).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith({ kind: 'warning', message: S.addOtherAgent(change === 'connectionId' ? 'default' : change === 'owner' ? 'other' : 'default', 'default') })
  })

  it.each(['false', 'reject'])('gives split instructions when insertion returns %s', async result => {
    const insertText = insertion()
    if (result === 'false') insertText.mockResolvedValue(false)
    else insertText.mockRejectedValue(new Error('unmounted'))
    page()
    fireEvent.click(await screen.findByText('notes.txt'))
    const notify = vi.spyOn(host, 'notify')
    click('Add to chat')
    await waitFor(() => expect(notify).toHaveBeenCalledWith({ kind: 'info', message: S.openChatFirst }))
  })

  it('hides the action without host.composer', async () => {
    page()
    await screen.findByText('notes.txt')
    expect(screen.queryByRole('button', { name: 'Add to chat' })).toBeNull()
  })

  it.each(['data.json', 'notes.txt'])('adds the open preview/editor file %s', async name => {
    const insertText = insertion()
    page({ '/list': () => ({ ok: true, entries: [file(name)], total: 1 }) })
    fireEvent.doubleClick(await screen.findByText(name))
    await screen.findByRole('button', { name: 'Close' })
    click('Add to chat')
    await waitFor(() => expect(insertText).toHaveBeenCalledExactlyOnceWith(null, `@file:/home/agent/${name}`, { mode: 'inline' }))
  })

  it('counts and skips unquotable paths without sending them', async () => {
    const insertText = insertion()
    const name = 'a`"\'b'
    page({ '/list': () => ({ ok: true, entries: [file(name)], total: 1 }) })
    fireEvent.click(await screen.findByText(name))
    const notify = vi.spyOn(host, 'notify')
    click('Add to chat')
    await flush()
    expect(insertText).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith({ kind: 'warning', message: S.refSkipped(1) })
  })
})
