import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createTestContext, host, resetHost, resetQueryCache } from './sdk-mock'
import { DRIVE, fakeBackend } from './fake-backend'
import { $available, $driveAvailable, bindContext } from '../api'
import { $driveJob, DriveImport } from '../drive'
import { $batch, CloudFilesPage, currentPin } from '../page'
import { $pickerOpen, closePicker } from '../picker'
import plugin from '../plugin'
import { S } from '../strings'
import { UploadBatch } from '../upload'

const flush = () => act(() => new Promise(resolve => setTimeout(resolve, 0)))
const contexts: ReturnType<typeof createTestContext>[] = []
function context(rest = fakeBackend().rest) {
  const t = createTestContext({ rest }); contexts.push(t); return t
}
beforeEach(() => { resetHost(); resetQueryCache(); $available.set(null); $driveAvailable.set(null) })
afterEach(() => { contexts.splice(0).forEach(t => t.dispose()); closePicker(); vi.restoreAllMocks() })

it('restored tab waits without queries, then loads roots or shows notSetUp', async () => {
  $available.set(null)
  const backend = fakeBackend()
  bindContext(context(backend.rest).ctx as any)
  const { container } = render(<CloudFilesPage />)
  await flush()
  expect(backend.calls).toEqual([])
  expect(container.querySelector('[aria-busy="true"]')?.children).toHaveLength(3)
  act(() => $available.set(true))
  await screen.findByText('notes.txt')
  expect(backend.calls.some(c => c.path === '/roots')).toBe(true)
  fireEvent.doubleClick(screen.getByText('notes.txt'))
  await screen.findByRole('button', { name: 'Close' })
  act(() => $available.set(null))
  expect(container.querySelector('[aria-busy="true"]')?.children).toHaveLength(3)
  act(() => $available.set(true))
  expect(await screen.findByRole('button', { name: 'Close' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  act(() => $available.set(false))
  expect(screen.getByText(S.notSetUp('default'))).toBeTruthy()
})

it.each(['profile', 'connectionId'] as const)('switch clears Cloud availability on %s until its own answer', async key => {
  let resolve!: (v: unknown) => void, reject!: (e: unknown) => void
  let pending = false
  const t = context(async path => path === '/available' && pending
    ? new Promise((yes, no) => { resolve = yes; reject = no }) : { ok: true })
  plugin.register(t.ctx as any); await flush()
  expect(['nav', 'attach-cloud', 'picker-host'].every(id => t.live.has(id))).toBe(true)
  pending = true
  host.state[key].set('agent-b')
  expect($available.get()).toBeNull()
  expect(['nav', 'attach-cloud', 'picker-host'].map(id => t.live.has(id))).toEqual([false, false, true])
  reject(new Error('transport unavailable')); await flush()
  expect($available.get()).toBeNull()
  expect(t.live.has('nav') || t.live.has('attach-cloud')).toBe(false)
  t.tickIntervals(); resolve({ ok: true }); await flush()
  expect($available.get()).toBe(true)
  expect(['nav', 'attach-cloud', 'picker-host'].every(id => t.live.has(id))).toBe(true)
})

it('picker survives an agent switch and offers Copy locations without inserting', async () => {
  const t = context()
  plugin.register(t.ctx as any); await flush()
  host.state.focusedSessionOwner.set(null)
  const copy = vi.spyOn(t.ctx.os, 'writeClipboard'), insertText = vi.fn()
  render(t.live.get('picker-host').render())
  act(() => t.live.get('attach-cloud').data.run({ insertText }))
  await screen.findByText('notes.txt')
  act(() => host.state.profile.set('agent-b'))
  expect($pickerOpen.get()).toBe(true)
  expect(t.live.has('picker-host')).toBe(true)
  fireEvent.click(await screen.findByLabelText('notes.txt'))
  expect(screen.queryByRole('button', { name: 'Insert locations' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Copy locations' }))
  expect(copy).toHaveBeenCalled()
  expect(insertText).not.toHaveBeenCalled()
})

it('same-agent transport failure keeps the Cloud row and provider', async () => {
  let fail = false
  const t = context(async () => { if (fail) throw new Error('transport unavailable'); return { ok: true } })
  plugin.register(t.ctx as any); await flush()
  fail = true; t.tickIntervals(); await flush()
  expect($available.get()).toBe(true)
  expect(t.live.has('nav') && t.live.has('attach-cloud')).toBe(true)
})

it.each([false, true])('dispose cancels a paused upload and a Drive import (paused=%s)', async paused => {
  let finish!: (v: unknown) => void
  const backend = fakeBackend({ '/drive/import': () => new Promise(resolve => { finish = resolve }) })
  const t = context(backend.rest)
  plugin.register(t.ctx as any); await flush()
  const pin = currentPin()
  host.state.profile.set('agent-b'); await flush()
  const batch = new UploadBatch({ max_file_bytes: 100, chunk_bytes: 100 }, { rest: t.ctx.rest as any, state: host.state }, pin)
  batch.add({ files: [{ file: new Blob(['x']), rel: 'x.txt' }] }, { root: 'home', folder: '' })
  $batch.set(batch)
  const uploadDone = batch.start()
  const job = new DriveImport(DRIVE.root.filter(item => !item.is_folder), 'home', paused ? pin : currentPin(), { rest: t.ctx.rest as any, state: host.state })
  $driveJob.set(job)
  const driveDone = job.start()
  await waitFor(() => expect(batch.getSnapshot().paused).toBe(true))
  expect(job.getSnapshot()).toMatchObject({ running: true, paused })
  t.dispose()
  expect($batch.get()).toBeNull(); expect($driveJob.get()).toBeNull()
  expect(batch.getSnapshot().canceled && job.getSnapshot().canceled).toBe(true)
  const count = backend.calls.length
  if (!paused) finish({ ok: true })
  await Promise.all([uploadDone, driveDone])
  host.state.profile.set('default'); await flush()
  expect(batch.getSnapshot()).toMatchObject({ running: false, paused: false })
  expect(job.getSnapshot()).toMatchObject({ running: false, paused: false })
  expect(backend.calls).toHaveLength(count)
})
