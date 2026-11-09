import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { $available, $driveAvailable, $unreachable, bindContext } from '../api'
import { $batch, CloudFilesPage } from '../page'
import { registerAvailabilityGate } from '../plugin'
import { S } from '../strings'
import { summarize, UploadBatch } from '../upload'
import { fakeBackend, ROOTS } from './fake-backend'
import { createTestContext, host, resetHost, resetQueryCache } from './sdk-mock'

const limits = { max_file_bytes: 100, chunk_bytes: 262144 }
beforeEach(() => {
  resetHost()
  resetQueryCache()
  $available.set(true)
  $driveAvailable.set(false)
  $unreachable.set(null)
  $batch.set(null)
})
afterEach(() => cleanup())

it('shows Retry after the first cloud probe fails, stays busy on retry, and clears on success', async () => {
  let succeed!: (value: unknown) => void
  const probe = vi.fn().mockRejectedValueOnce(new Error('offline'))
    .mockImplementationOnce(() => new Promise(resolve => { succeed = resolve }))
  const backend = fakeBackend({ '/available': probe })
  const context = createTestContext({ rest: backend.rest })
  bindContext(context.ctx as any)
  $available.set(null)
  registerAvailabilityGate(context.ctx as any, value => $available.set(value))
  try {
    render(<CloudFilesPage />)
    expect(await screen.findByText(S.unreachable('default', false))).toBeTruthy()
    const retry = screen.getByRole('button', { name: S.retry })
    fireEvent.click(retry)
    expect(probe).toHaveBeenCalledTimes(2)
    expect(retry.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(S.unreachable('default', false))).toBeTruthy()
    await act(async () => succeed({ ok: true }))
    expect(await screen.findByText('notes.txt')).toBeTruthy()
    expect(screen.queryByRole('button', { name: S.retry })).toBeNull()
    expect($unreachable.get()).toBeNull()
  } finally { context.dispose() }
})

function uploads(roots = ROOTS) {
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const backend = fakeBackend({
    '/roots': () => roots,
    '/uploads/start': (opts: any) => opts.body.path.endsWith('bad.txt')
      ? { ok: false, code: 'denied' } : { ok: true, upload_id: opts.body.path },
    '/uploads/chunk': () => ({ ok: true, size: 1 }),
    '/uploads/finish': async (opts: any) => {
      await held
      return { ok: true, renamed: opts.body.upload_id.endsWith('one.txt'), entry: { name: 'final.txt' } }
    }
  })
  bindContext(createTestContext({ rest: backend.rest }).ctx as any)
  const batch = new UploadBatch(limits, { rest: backend.rest, state: host.state, readChunk: async () => 'eA==' })
  batch.add({ files: ['one.txt', 'two.txt', 'folder/nested/a.txt', 'folder/b.txt', 'bad.txt'].map(rel => ({ rel, file: new Blob(['x']) })), dirs: ['empty'] }, { root: 'home', folder: 'docs' })
  $batch.set(batch)
  const insertText = vi.fn().mockResolvedValue(true)
  host.composer = { insertText }
  const view = render(<CloudFilesPage />)
  return { batch, release, insertText, rerender: () => view.rerender(<CloudFilesPage />) }
}
const drawer = () => within(screen.getByRole('region', { name: S.uploads }))

it('adds only successful top-level upload entries with final names and absolute destination paths', async () => {
  const h = uploads()
  await screen.findByText('notes.txt')
  expect(drawer().queryByRole('button', { name: S.addToChat })).toBeNull()
  let running!: Promise<void>
  act(() => { running = h.batch.start() })
  expect(drawer().queryByRole('button', { name: S.addToChat })).toBeNull()
  await act(async () => { h.release(); await running })
  fireEvent.click(drawer().getByRole('button', { name: S.addToChat }))
  await waitFor(() => expect(h.insertText).toHaveBeenCalledWith(null,
    '@folder:/home/agent/docs/empty @file:/home/agent/docs/final.txt @file:/home/agent/docs/two.txt @folder:/home/agent/docs/folder', { mode: 'inline' }))
  expect(h.insertText).toHaveBeenCalledTimes(1)
  act(() => host.state.profile.set('other'))
  await screen.findByText('notes.txt')
  expect(drawer().queryByRole('button', { name: S.addToChat })).toBeNull()
  act(() => { host.state.profile.set('default'); host.state.connectionId.set('conn-2') })
  await screen.findByText('notes.txt')
  expect(drawer().queryByRole('button', { name: S.addToChat })).toBeNull()
})

it('hides the upload action without an absolute root path and retains the live chat guard', async () => {
  const roots = { ...ROOTS, roots: [{ ...ROOTS.roots[0], path: '' }] }
  const h = uploads(roots)
  await act(async () => { h.release(); await h.batch.start() })
  expect(drawer().queryByRole('button', { name: S.addToChat })).toBeNull()
  roots.roots[0].path = '/home/agent'
  h.rerender()
  act(() => host.state.focusedSessionOwner.set({ connectionId: 'conn-1', profile: 'other' }))
  fireEvent.click(drawer().getByRole('button', { name: S.addToChat }))
  expect(h.insertText).not.toHaveBeenCalled()
})

it('counts a folder-only failure without adding it to the file totals', async () => {
  const backend = fakeBackend({ '/mkdir': () => ({ ok: false, code: 'denied' }) })
  bindContext(createTestContext({ rest: backend.rest }).ctx as any)
  const batch = new UploadBatch(limits, { rest: backend.rest, state: host.state })
  batch.add({ files: [], dirs: ['folder'] }, { root: 'home', folder: '' })
  await batch.start()
  expect(summarize(batch.getSnapshot())).toEqual({ failed: 1, total: 0, settled: 0, done: 0, sent: 0, size: 0 })
  $batch.set(batch)
  render(<CloudFilesPage />)
  expect(await screen.findByText('1 failed')).toBeTruthy()
  expect(drawer().queryByRole('button', { name: S.addToChat })).toBeNull()
})

it('Add to chat after an upload uses the folder the batch went to, even after settings change', async () => {
  const h = uploads({ ...ROOTS, roots: [{ id: 'home', label: 'Home', path: '/elsewhere', notes: {} }] } as any)
  await screen.findByText('notes.txt')
  for (const item of h.batch.getSnapshot().items) (item as any).rootPath = '/home/agent'
  let running!: Promise<void>
  act(() => { running = h.batch.start() })
  await act(async () => { h.release(); await running })
  fireEvent.click(drawer().getByRole('button', { name: S.addToChat }))
  await waitFor(() => expect(h.insertText).toHaveBeenCalledTimes(1))
  expect(h.insertText.mock.calls[0][1]).toContain('@file:/home/agent/docs/two.txt')
  expect(h.insertText.mock.calls[0][1]).not.toContain('/elsewhere')
})
