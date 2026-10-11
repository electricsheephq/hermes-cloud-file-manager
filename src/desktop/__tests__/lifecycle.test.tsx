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
const fileCalls = (calls: ReturnType<typeof fakeBackend>['calls']) => calls.filter(c =>
  ['/roots', '/list', '/search'].includes(c.path) || (c.path.startsWith('/drive/') && c.path !== '/drive/available'))
const noPlugin = () => { throw new Error('404: plugin not mounted') }
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
  const backend = fakeBackend({}, undefined, () => {
    if (host.state[key].get() !== original) noPlugin()
  })
  const t = context(backend.rest)
  plugin.register(t.ctx as any); await flush()
  host.state.focusedSessionOwner.set(null)
  const insertText = vi.fn()
  render(t.live.get('picker-host').render())
  act(() => t.live.get('attach-cloud').data.run({ insertText }))
  fireEvent.click(await screen.findByLabelText('notes.txt'))
  const beforeSwitch = backend.calls.length
  act(() => host.state[key].set('agent-b'))
  await waitFor(() => expect($available.get()).toBe(false))
  expect($pickerOpen.get()).toBe(true)
  expect(['picker-host', 'nav', 'attach-cloud', 'attach-drive'].map(id => t.live.has(id))).toEqual([true, false, false, false])
  expect(screen.getByText(key === 'profile'
    ? "Cloud Files isn't set up on agent-b. Switch back to default to keep picking files there."
    : "Cloud Files isn't set up on the agent you switched to. Switch back to the agent you opened this on to keep picking files there.")).toBeTruthy()
  expect(screen.queryByText(S.needsUpdateTitle)).toBeNull()
  expect(fileCalls(backend.calls.slice(beforeSwitch))).toEqual([])
  expect(screen.queryByRole('button', { name: 'Insert locations' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Copy locations' })).toBeNull()
  expect(insertText).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect($pickerOpen.get()).toBe(false)
  expect(t.live.has('picker-host')).toBe(false)
})

it.each([false, true])('a 404 for the picker\'s own agent closes it (round trip=%s)', async roundTrip => {
  let unavailable = false
  const backend = fakeBackend({}, undefined, () => {
    if (unavailable || host.state.profile.get() === 'agent-b') noPlugin()
  })
  const t = context(backend.rest)
  plugin.register(t.ctx as any); await flush()
  host.state.focusedSessionOwner.set(null)
  render(t.live.get('picker-host').render())
  const insertText = vi.fn()
  act(() => t.live.get('attach-cloud').data.run({ insertText }))
  await screen.findByText('notes.txt')
  if (roundTrip) {
    act(() => host.state.profile.set('agent-b'))
    await screen.findByText(S.pickerPinnedElsewhere('agent-b', 'default'))
    expect(fileCalls(backend.calls.filter(c => c.profile === 'agent-b'))).toEqual([])
    expect(screen.queryByText(S.needsUpdateTitle)).toBeNull()
  }
  unavailable = true
  act(() => roundTrip ? host.state.profile.set('default') : t.tickIntervals())
  await waitFor(() => expect($available.get()).toBe(false))
  expect($pickerOpen.get()).toBe(false)
  expect(t.live.has('picker-host')).toBe(false)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(insertText).not.toHaveBeenCalled()
})

it.each(['cloud', 'drive-cloud', 'drive-probe'])('picker waits without file requests while B availability is pending (%s)', async scenario => {
  const source = scenario === 'cloud' ? 'cloud' : 'drive'
  const probe = scenario === 'drive-probe' ? '/drive/available' : '/available'
  let reject!: (e: Error) => void
  const backend = fakeBackend({ [probe]: () => host.state.profile.get() === 'agent-b'
    ? new Promise((_yes, no) => { reject = no }) : { ok: true, available: true }
  }, undefined, path => {
    if (host.state.profile.get() !== 'agent-b' || path === probe) return
    if (scenario !== 'drive-probe' || path.startsWith('/drive/')) noPlugin()
  })
  const t = context(backend.rest)
  plugin.register(t.ctx as any); await flush()
  const insertText = vi.fn()
  const { container } = render(t.live.get('picker-host').render())
  act(() => t.live.get(`attach-${source}`).data.run({ insertText }))
  await screen.findByText(source === 'cloud' ? 'notes.txt' : 'Plan')
  act(() => host.state.profile.set('agent-b'))
  await flush()
  expect($pickerOpen.get()).toBe(true)
  expect(container.querySelector('[aria-busy="true"]')?.getAttribute('style')).toContain('height: 360px')
  expect(fileCalls(backend.calls.filter(c => c.profile === 'agent-b'))).toEqual([])
  expect(screen.queryByText(S.needsUpdateTitle)).toBeNull()
  act(() => reject(new Error('404: plugin not mounted')))
  await screen.findByText((source === 'cloud' ? S.pickerPinnedElsewhere : S.drivePinnedElsewhere)('agent-b', 'default'))
  expect(fileCalls(backend.calls.filter(c => c.profile === 'agent-b'))).toEqual([])
  expect(screen.queryByText(S.needsUpdateTitle)).toBeNull()
  // B's Drive no may linger, but C's unknown Cloud availability must still render the busy placeholder.
  act(() => host.state.profile.set('agent-c'))
  expect($available.get()).toBeNull()
  expect(container.querySelector('[aria-busy="true"]')?.getAttribute('style')).toContain('height: 360px')
  expect(fileCalls(backend.calls.filter(c => c.profile === 'agent-c'))).toEqual([])
  await flush()
  expect(insertText).not.toHaveBeenCalled()
})

it.each(['cloud-404', 'drive-false', 'drive-404'])('Drive picker pinned elsewhere keeps its paused import after B answers %s', async answer => {
  let finish!: () => void
  const backend = fakeBackend({
    '/drive/available': () => {
      if (host.state.profile.get() === 'agent-b') {
        if (answer === 'drive-404') throw new Error('404: Drive not mounted')
        return { available: false }
      }
      return { available: true }
    },
    '/drive/import': opts => new Promise(resolve => { finish = () => resolve({ ok: true, entry: importedEntry(opts.body.id) }) })
  }, undefined, path => {
    if (host.state.profile.get() !== 'agent-b') return
    if (answer === 'cloud-404' || (path.startsWith('/drive/') && path !== '/drive/available')) noPlugin()
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
  act(() => host.state.profile.set('agent-b'))
  await screen.findByText("Google Drive isn't available on agent-b. Switch back to default to keep importing; an import already started there continues when you switch back.")
  expect(screen.queryByText(S.needsUpdateTitle)).toBeNull()
  expect(fileCalls(backend.calls.filter(c => c.profile === 'agent-b'))).toEqual([])
  expect(screen.queryByRole('button', { name: 'Copy locations' })).toBeNull()
  await act(async () => { finish(); await flush() })
  expect(job.getSnapshot()).toMatchObject({ running: true, paused: true, canceled: false })
  expect($pickerOpen.get()).toBe(true)
  expect(t.live.has('picker-host')).toBe(true)
  expect(t.live.has('attach-drive')).toBe(false)
  expect(backend.calls.filter(c => c.path === '/drive/import')).toHaveLength(1)
  expect(insertText).not.toHaveBeenCalled()
  act(() => host.state.profile.set('default'))
  await waitFor(() => expect(backend.calls.filter(c => c.path === '/drive/import')).toHaveLength(2))
  await act(async () => { finish(); await start.mock.results[0].value })
  expect(job.getSnapshot()).toMatchObject({ running: false, canceled: false })
  expect(screen.getByText(S.importedTo('default'))).toBeTruthy()
  act(() => host.state.profile.set('agent-b'))
  await waitFor(() => expect($driveAvailable.get()).toBe(false))
  // A finished handoff takes precedence over B's unavailable notice and still offers Copy locations.
  expect(screen.getByText(S.importedTo('default'))).toBeTruthy()
  expect(screen.queryByText(S.drivePinnedElsewhere('agent-b', 'default'))).toBeNull()
  expect(fileCalls(backend.calls.filter(c => c.profile === 'agent-b'))).toEqual([])
  const copy = vi.spyOn(t.ctx.os, 'writeClipboard')
  fireEvent.click(screen.getByRole('button', { name: 'Copy locations' }))
  expect(copy.mock.calls[0][0]).toContain('/home/agent/uploads/drive/report.pdf')
  expect(insertText).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await start.mock.results[0].value
  expect(job.getSnapshot().canceled).toBe(true)
})

it.each(['drive-false', 'drive-404'])('Drive picker closes when its own agent answers %s after a round trip', async answer => {
  let driveGone = false, finish!: () => void
  const backend = fakeBackend({
    '/drive/available': () => {
      if (host.state.profile.get() === 'agent-b' || driveGone) {
        if (answer === 'drive-404') throw new Error('404: Drive not mounted')
        return { available: false }
      }
      return { available: true }
    },
    '/drive/import': opts => new Promise(resolve => { finish = () => resolve({ ok: true, entry: importedEntry(opts.body.id) }) })
  }, undefined, path => {
    if (host.state.profile.get() === 'agent-b' && path.startsWith('/drive/') && path !== '/drive/available') noPlugin()
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
  act(() => host.state.profile.set('agent-b'))
  await screen.findByText(S.drivePinnedElsewhere('agent-b', 'default'))
  // Back on the pinned agent, whose Drive is now gone: the provider was already dropped by the switch, and the
  // picker must still close (not sit on a busy body) and stop its import.
  driveGone = true
  act(() => host.state.profile.set('default'))
  await waitFor(() => expect($driveAvailable.get()).toBe(false))
  expect($pickerOpen.get()).toBe(false)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(job.getSnapshot().canceled).toBe(true)
  finish?.()
  expect(insertText).not.toHaveBeenCalled()
})

it('Cloud picker stays open on a round trip after B\'s 404 and registers its host exactly once', async () => {
  const backend = fakeBackend({}, undefined, () => {
    if (host.state.profile.get() === 'agent-b') noPlugin()
  })
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
  expect(screen.getByText(S.pickerPinnedElsewhere('agent-b', 'default'))).toBeTruthy()
  expect(screen.queryByText(S.needsUpdateTitle)).toBeNull()
  expect(fileCalls(backend.calls.filter(c => c.profile === 'agent-b'))).toEqual([])
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
