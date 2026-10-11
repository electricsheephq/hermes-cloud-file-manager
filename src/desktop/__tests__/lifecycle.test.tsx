import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createTestContext, host, resetHost, resetQueryCache } from './sdk-mock'
import { DRIVE, fakeBackend, importedEntry } from './fake-backend'
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

it.each(['profile', 'connectionId'] as const)('Cloud picker pinned elsewhere survives a 404 after switching %s, then removes its host on close', async key => {
  const original = host.state[key].get()
  const backend = fakeBackend({ '/available': () => {
    if (host.state[key].get() !== original) throw new Error('404: plugin not mounted')
    return { ok: true }
  } })
  const t = context(backend.rest)
  plugin.register(t.ctx as any); await flush()
  host.state.focusedSessionOwner.set(null)
  const copy = vi.spyOn(t.ctx.os, 'writeClipboard'), insertText = vi.fn()
  render(t.live.get('picker-host').render())
  act(() => t.live.get('attach-cloud').data.run({ insertText }))
  fireEvent.click(await screen.findByLabelText('notes.txt'))
  act(() => host.state[key].set('agent-b'))
  await waitFor(() => expect($available.get()).toBe(false))
  expect($pickerOpen.get()).toBe(true)
  expect(['picker-host', 'nav', 'attach-cloud', 'attach-drive'].map(id => t.live.has(id))).toEqual([true, false, false, false])
  fireEvent.click(await screen.findByLabelText('notes.txt'))
  expect(screen.queryByRole('button', { name: 'Insert locations' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Copy locations' }))
  expect(copy).toHaveBeenCalledTimes(1)
  expect(copy.mock.calls[0][0]).toContain('/home/agent/notes.txt')
  expect(insertText).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect($pickerOpen.get()).toBe(false)
  expect(t.live.has('picker-host')).toBe(false)
})

it.each([false, true])('a 404 for the picker\'s own agent closes it (round trip=%s)', async roundTrip => {
  let unavailable = false
  const backend = fakeBackend({ '/available': () => {
    if (unavailable) throw new Error('404: plugin not mounted')
    return { ok: true }
  } })
  const t = context(backend.rest)
  plugin.register(t.ctx as any); await flush()
  host.state.focusedSessionOwner.set(null)
  render(t.live.get('picker-host').render())
  const insertText = vi.fn()
  act(() => t.live.get('attach-cloud').data.run({ insertText }))
  await screen.findByText('notes.txt')
  if (roundTrip) {
    act(() => host.state.profile.set('agent-b'))
    await flush()
  }
  unavailable = true
  act(() => roundTrip ? host.state.profile.set('default') : t.tickIntervals())
  await waitFor(() => expect($available.get()).toBe(false))
  expect($pickerOpen.get()).toBe(false)
  expect(t.live.has('picker-host')).toBe(false)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(insertText).not.toHaveBeenCalled()
})

it.each(['cloud-404', 'drive-false', 'drive-404'])('Drive picker pinned elsewhere keeps its paused import after B answers %s', async answer => {
  let negative = false, finish!: () => void
  const backend = fakeBackend({
    '/available': () => {
      if (negative && answer === 'cloud-404' && host.state.profile.get() === 'agent-b') throw new Error('404: plugin not mounted')
      return { ok: true }
    },
    '/drive/available': () => {
      if (negative && host.state.profile.get() === 'agent-b') {
        if (answer === 'drive-404') throw new Error('404: Drive not mounted')
        return { available: false }
      }
      return { available: true }
    },
    '/drive/import': opts => new Promise(resolve => { finish = () => resolve({ ok: true, entry: importedEntry(opts.body.id) }) })
  })
  const t = context(backend.rest)
  plugin.register(t.ctx as any); await flush()
  host.state.focusedSessionOwner.set(null)
  const start = vi.spyOn(DriveImport.prototype, 'start'), insertText = vi.fn()
  render(t.live.get('picker-host').render())
  act(() => t.live.get('attach-drive').data.run({ insertText }))
  fireEvent.click(await screen.findByText('Plan'))
  fireEvent.click(screen.getByText('report.pdf'))
  fireEvent.click(screen.getByRole('button', { name: 'Import and insert' }))
  const job = start.mock.contexts[0] as DriveImport
  expect(job.getSnapshot()).toMatchObject({ running: true, canceled: false })
  negative = answer === 'cloud-404'
  act(() => host.state.profile.set('agent-b'))
  await flush()
  // A Drive-only no must also work when B's provider was already registered by its first probe.
  if (!negative) { negative = true; act(() => t.tickIntervals()); await flush() }
  await act(async () => { finish(); await flush() })
  expect(job.getSnapshot()).toMatchObject({ running: true, paused: true, canceled: false })
  expect($pickerOpen.get()).toBe(true)
  expect(t.live.has('picker-host')).toBe(true)
  expect(t.live.has('attach-drive')).toBe(false)
  expect(backend.calls.filter(c => c.path === '/drive/import')).toHaveLength(1)
  expect(insertText).not.toHaveBeenCalled()
  act(() => closePicker())
  await start.mock.results[0].value
  expect(job.getSnapshot().canceled).toBe(true)
})

it('Cloud picker stays open on a round trip after B\'s 404 and registers its host exactly once', async () => {
  const backend = fakeBackend({ '/available': () => {
    if (host.state.profile.get() === 'agent-b') throw new Error('404: plugin not mounted')
    return { ok: true }
  } })
  const t = context(backend.rest), register = vi.spyOn(t.ctx, 'register')
  plugin.register(t.ctx as any); await flush()
  host.state.focusedSessionOwner.set(null)
  const insertText = vi.fn()
  render(t.live.get('picker-host').render())
  act(() => t.live.get('attach-cloud').data.run({ insertText }))
  await screen.findByText('notes.txt')
  act(() => host.state.profile.set('agent-b'))
  await waitFor(() => expect($available.get()).toBe(false))
  expect($pickerOpen.get()).toBe(true)
  act(() => host.state.profile.set('default'))
  await waitFor(() => expect($available.get()).toBe(true))
  expect(['nav', 'attach-cloud', 'picker-host'].every(id => t.live.has(id))).toBe(true)
  expect(register.mock.calls.filter(([c]) => c.id === 'picker-host')).toHaveLength(1)
  expect($pickerOpen.get()).toBe(true)
  fireEvent.click(await screen.findByLabelText('notes.txt'))
  expect(screen.queryByRole('button', { name: 'Insert locations' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Copy locations' })).toBeTruthy()
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
