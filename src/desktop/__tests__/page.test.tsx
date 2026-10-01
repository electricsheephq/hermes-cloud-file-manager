import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { createTestContext, host, resetHost, resetQueryCache } from './sdk-mock'
import { fakeBackend } from './fake-backend'
import { $available, bindContext } from '../api'
import { $batch, CloudFilesPage, enqueueUpload } from '../page'

function setup(overrides?: Parameters<typeof fakeBackend>[0]) {
  const backend = fakeBackend(overrides)
  const t = createTestContext({ rest: backend.rest })
  bindContext(t.ctx as any)
  render(<CloudFilesPage />)
  return { ...backend, ctx: t.ctx }
}

const ipcError = (status: number) => new Error(`Error invoking remote method 'hermes:api': Error: ${status}: {"detail":"No such API endpoint"}`)
const flush = async (rounds = 10) => {
  for (let i = 0; i < rounds; i++) await act(() => new Promise(resolve => setTimeout(resolve, 0)))
}

const rows = () => screen.getAllByRole('listitem').map(row => row.getAttribute('data-entry'))

beforeEach(() => {
  resetQueryCache()
  resetHost()
  $available.set(null)
  $batch.set(null)
})

describe('Cloud Files page', () => {
  it('lists the root with highlighted folders first and folder notes as secondary text', async () => {
    setup()
    expect(await screen.findByText('Cloud Files')).toBeTruthy()
    await screen.findByText('notes.txt')
    expect(rows()).toEqual(['docs', 'uploads', 'zeta', 'notes.txt', 'readme.md'])
    expect(screen.getByText('Shared documents')).toBeTruthy()
    expect(screen.getByText('Up to 100 MB per file')).toBeTruthy()
  })

  it('navigates into a folder on double-click and back through the breadcrumbs', async () => {
    const { calls } = setup()
    await screen.findByText('docs')
    fireEvent.doubleClick(screen.getByText('docs'))
    await screen.findByText('a.pdf')
    expect(calls.some(c => c.path === '/list' && c.params.path === 'docs' && c.params.root === 'home')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Home' }))
    await screen.findByText('notes.txt')
  })

  it('opens a folder with Enter', async () => {
    setup()
    await screen.findByText('docs')
    fireEvent.keyDown(screen.getByText('docs').closest('[role=listitem]')!, { key: 'Enter' })
    await screen.findByText('b.pdf')
  })

  it('shows search results across the root with their folder, and Esc returns to the folder', async () => {
    const { calls } = setup()
    await screen.findByText('docs')
    fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'pdf' } })
    await screen.findByText('a.pdf', undefined, { timeout: 2000 })
    expect(calls.find(c => c.path === '/search')?.params).toMatchObject({ root: 'home', q: 'pdf' })
    expect(screen.getAllByText('docs').length).toBeGreaterThan(0) // the result's folder path
    fireEvent.keyDown(screen.getByLabelText('Search files'), { key: 'Escape' })
    await screen.findByText('notes.txt')
  })

  it('creates a folder with /mkdir and validates the name first', async () => {
    const { calls } = setup()
    await screen.findByText('docs')
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }))
    const dialog = screen.getByRole('dialog')
    const input = within(dialog).getByLabelText('Folder name')
    fireEvent.change(input, { target: { value: 'a/b' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    expect(await within(dialog).findByText('A folder name cannot contain /')).toBeTruthy()
    expect(calls.some(c => c.path === '/mkdir')).toBe(false)

    fireEvent.change(input, { target: { value: 'reports' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls.find(c => c.path === '/mkdir')?.opts).toMatchObject({ method: 'POST', body: { root: 'home', path: 'reports' } })
  })

  it('maps an in-band mkdir failure to readable text', async () => {
    setup({ '/mkdir': () => ({ ok: false, code: 'exists_file', message: 'exists' }) })
    await screen.findByText('docs')
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }))
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'notes.txt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('A file with that name already exists')).toBeTruthy()
  })

  it('copies the absolute paths of the selection', async () => {
    const { ctx } = setup()
    const copy = vi.spyOn(ctx.os, 'writeClipboard')
    await screen.findByText('docs')
    expect(screen.getByRole('button', { name: 'Copy path' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByLabelText('notes.txt'))
    fireEvent.click(screen.getByLabelText('readme.md'))
    fireEvent.click(screen.getByRole('button', { name: 'Copy path' }))
    expect(copy).toHaveBeenCalledWith('/home/agent/notes.txt\n/home/agent/readme.md')
  })

  it('uploads dropped files into the current folder and shows them in the drawer', async () => {
    const uploads = {
      '/uploads/start': (opts: any) => ({ ok: true, upload_id: 'u1', chunk_bytes: 4 * 1024 * 1024, max_file_bytes: 1e9, path: opts.body.path }),
      '/uploads/chunk': (opts: any) => ({ ok: true, size: opts.body.offset + atob(opts.body.data).length }),
      '/uploads/finish': () => ({ ok: true, renamed: true, entry: { name: 'a (1).txt', rel: 'docs/a (1).txt' } })
    }
    const { calls } = setup(uploads)
    await screen.findByText('docs')
    fireEvent.doubleClick(screen.getByText('docs'))
    await screen.findByText('a.pdf')
    const file = new File(['hello'], 'a.txt')
    const entry = { name: 'a.txt', isFile: true, isDirectory: false, file: (ok: (f: File) => void) => ok(file) }
    const dataTransfer = { types: ['Files'], items: [{ kind: 'file', webkitGetAsEntry: () => entry }], files: [file] }
    const page = screen.getByText('Cloud Files').closest('section')!
    fireEvent.dragEnter(page, { dataTransfer })
    expect(screen.getByText('Drop to upload to docs')).toBeTruthy()
    fireEvent.drop(page, { dataTransfer })
    expect(await screen.findByText('Saved as "a (1).txt"')).toBeTruthy()
    expect(calls.find(c => c.path === '/uploads/start')?.opts.body).toEqual({ root: 'home', path: 'docs/a.txt', size: 5 })
    expect(calls.find(c => c.path === '/uploads/chunk')?.opts.body).toMatchObject({ offset: 0, data: btoa('hello') })
    expect(await screen.findByText('Uploaded 1 of 1')).toBeTruthy()
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0) // finished rows carry no bar (E3)
    await waitFor(() => expect(calls.filter(c => c.path === '/list' && c.params.path === 'docs').length).toBeGreaterThan(1))
  })

  it('explains how to set up the plugin when the agent does not have it', async () => {
    setup()
    act(() => $available.set(false))
    expect(
      await screen.findByText(
        "Cloud Files isn't set up on default yet. Install the plugin on the agent's gateway, add it to `plugins.enabled`, and restart the gateway."
      )
    ).toBeTruthy()
  })

  it('shows the backend reason when the storage is unsupported', async () => {
    setup({ '/roots': () => ({ ok: true, supported: false, reason: 'Files live in a remote sandbox', roots: [], max_file_bytes: 0, chunk_bytes: 0 }) })
    expect(await screen.findByText('Files live in a remote sandbox')).toBeTruthy()
  })

  it('shows an error with Retry when listing fails', async () => {
    let fail = true
    setup({ '/list': () => (fail ? Promise.reject(new Error('connect ECONNREFUSED')) : { ok: true, entries: [], total: 0, truncated: false }) })
    expect(await screen.findByText('connect ECONNREFUSED')).toBeTruthy()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('This folder is empty — drop files here or use Upload')).toBeTruthy()
  })

  it('keeps a drop pinned to the agent it was dropped on, even if the agent changes during the folder walk (F2)', async () => {
    const { calls } = setup({
      '/uploads/start': () => ({ ok: true, upload_id: 'u1', chunk_bytes: 4 * 1024 * 1024 }),
      '/uploads/chunk': (opts: any) => ({ ok: true, size: opts.body.offset + atob(opts.body.data).length }),
      '/uploads/finish': () => ({ ok: true, renamed: false, entry: { name: 'a.txt', rel: 'pics/a.txt' } })
    })
    await screen.findByText('docs')
    let release!: () => void
    const walked = new Promise<void>(resolve => (release = resolve))
    const file = new File(['hi'], 'a.txt')
    const child = { name: 'a.txt', isFile: true, isDirectory: false, file: (ok: (f: File) => void) => ok(file) }
    let read = false
    const dir = {
      name: 'pics',
      isFile: false,
      isDirectory: true,
      createReader: () => ({
        readEntries: (ok: (entries: unknown[]) => void) => {
          if (read) return ok([])
          read = true
          void walked.then(() => ok([child]))
        }
      })
    }
    const page = screen.getByText('Cloud Files').closest('section')!
    fireEvent.drop(page, { dataTransfer: { types: ['Files'], items: [{ kind: 'file', webkitGetAsEntry: () => dir }], files: [] } })
    act(() => host.state.profile.set('other'))
    release()
    await flush()
    expect(calls.filter(c => c.path.startsWith('/uploads')).map(c => c.profile)).toEqual([])
    expect(await screen.findByText('Switch back to default to continue uploading')).toBeTruthy()
    act(() => host.state.profile.set('default'))
    expect(await screen.findByText('Uploaded 1 of 1')).toBeTruthy()
    const uploads = calls.filter(c => c.path.startsWith('/uploads'))
    expect(uploads.every(c => c.profile === 'default')).toBe(true)
    expect(uploads[0].opts.body).toMatchObject({ root: 'home', path: 'pics/a.txt' })
  })

  it('treats unsupported_backend as a failure everywhere except /roots (F5)', async () => {
    setup({ '/mkdir': () => ({ ok: false, code: 'unsupported_backend', message: 'nope' }) })
    await screen.findByText('docs')
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }))
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'reports' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('This agent’s storage is not supported')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('shows a listing failure with unsupported_backend as an error, not an empty folder (F5)', async () => {
    setup({ '/list': () => ({ ok: false, code: 'unsupported_backend', message: 'nope' }) })
    expect(await screen.findByText('This agent’s storage is not supported')).toBeTruthy()
    expect(screen.queryByText('This folder is empty — drop files here or use Upload')).toBeNull()
  })

  it('explains a 404 from an older or disabled gateway plugin instead of showing raw IPC text (E1)', async () => {
    setup({ '/roots': () => Promise.reject(ipcError(404)) })
    expect(await screen.findByText('Cloud Files needs an update on this agent')).toBeTruthy()
    expect(
      screen.getByText(
        "The agent's machine has an older version of the Cloud File Manager plugin, or it isn't enabled. Update or enable it there, then restart Hermes on that machine."
      )
    ).toBeTruthy()
    expect(screen.queryByText("Couldn't load files")).toBeNull()
    expect(screen.getByText(/404/)).toBeTruthy() // raw error kept as a small details line
  })

  it('Space on a row checkbox toggles the entry exactly once (thread 4152214271)', async () => {
    setup()
    await screen.findByText('notes.txt')
    const box = screen.getByLabelText('notes.txt')
    fireEvent.keyDown(box, { key: ' ' }) // bubbles to the row
    fireEvent.click(box) // the checkbox's own activation
    expect(screen.getByText('notes.txt').closest('[role=listitem]')!.getAttribute('aria-selected')).toBe('true')
  })

  it('shows the copy-failed notice when the clipboard write rejects (thread 4152214259)', async () => {
    const { ctx } = setup()
    vi.spyOn(ctx.os, 'writeClipboard').mockRejectedValue(new Error('clipboard denied'))
    const notify = vi.spyOn(host, 'notify')
    await screen.findByText('notes.txt')
    fireEvent.click(screen.getByLabelText('notes.txt'))
    fireEvent.click(screen.getByRole('button', { name: 'Copy path' }))
    await waitFor(() => expect(notify).toHaveBeenCalledWith({ kind: 'error', message: "Couldn't copy to the clipboard" }))
    notify.mockRestore()
  })

  it('accepts a new upload on another agent while a canceled batch is still settling (thread 4152214233)', async () => {
    const backend = fakeBackend({
      '/uploads/start': () => ({ ok: true, upload_id: 'u1' }),
      '/uploads/chunk': () => new Promise(() => undefined)
    })
    bindContext(createTestContext({ rest: backend.rest }).ctx as any)
    const notify = vi.spyOn(host, 'notify')
    const limits = { max_file_bytes: 1e6, chunk_bytes: 262144 }
    enqueueUpload({ files: [{ file: new File(['a'], 'a.txt'), rel: 'a.txt' }] }, { root: 'home', folder: '' }, limits)
    await flush()
    const first = $batch.get()!
    first.cancel()
    expect(first.getSnapshot()).toMatchObject({ canceled: true, running: true })
    act(() => host.state.profile.set('other'))
    enqueueUpload({ files: [{ file: new File(['b'], 'b.txt'), rel: 'b.txt' }] }, { root: 'home', folder: '' }, limits)
    expect(notify).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'Finish or cancel the current uploads first' }))
    expect($batch.get()).not.toBe(first)
    expect($batch.get()!.getSnapshot()).toMatchObject({ profile: 'other', canceled: false })
    notify.mockRestore()
  })
})
