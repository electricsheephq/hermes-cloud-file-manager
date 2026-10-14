// v0.4.2: page rows drag native in-place references; pickers and Drive remain unchanged.
import { act, fireEvent, render, screen, within } from '@testing-library/react'

import { createTestContext, host, resetHost, resetQueryCache, setDownloadCapture } from './sdk-mock'
import { fakeBackend } from './fake-backend'
import { $available, $driveAvailable, bindContext } from '../api'
import { $drafts } from '../editor'
import { $batch, CloudFilesPage } from '../page'
import { closePicker, cloudProvider, driveProvider, PickerHost } from '../picker'
import { S } from '../strings'

const flush = async (rounds = 10) => {
  for (let i = 0; i < rounds; i++) await act(() => new Promise(resolve => setTimeout(resolve, 0)))
}
const file = (rel: string, extra = {}) => ({ name: rel.split('/').pop()!, rel, abs: `/home/agent/${rel}`, is_dir: false, size: 1, mtime: 0, ...extra })
const row = (name: string) => screen.getByText(name).closest('[role=option]') as HTMLElement
const transfer = () => ({
  effectAllowed: 'uninitialized', dropEffect: 'move',
  types: ['application/x-hermes-paths', 'text/plain'], setData: vi.fn()
})
function page(overrides: Parameters<typeof fakeBackend>[0] = {}) {
  const backend = fakeBackend(overrides)
  bindContext(createTestContext({ rest: backend.rest }).ctx as any)
  return { ...backend, view: render(<CloudFilesPage />) }
}
const ownerStore = host.state.focusedSessionOwner
beforeEach(() => {
  resetQueryCache(); resetHost(); setDownloadCapture(undefined)
  $available.set(true); $driveAvailable.set(null); $batch.set(null); $drafts.set(new Map())
})
afterEach(() => {
  host.state.focusedSessionOwner = ownerStore
  act(closePicker); setDownloadCapture(undefined); vi.restoreAllMocks()
})

describe('page row payloads', () => {
  it('a single unselected file carries the exact native paths JSON and required plain text', async () => {
    page()
    await screen.findByText('notes.txt')
    expect(row('notes.txt').getAttribute('draggable')).toBe('true')
    const dataTransfer = transfer()
    expect(fireEvent.dragStart(row('notes.txt'), { dataTransfer })).toBe(true)
    expect(dataTransfer.effectAllowed).toBe('copy')
    expect(dataTransfer.setData.mock.calls).toEqual([
      ['application/x-hermes-paths', '[{"isDirectory":false,"path":"/home/agent/notes.txt"}]'],
      ['text/plain', '/home/agent/notes.txt']
    ])
    expect(row('notes.txt').getAttribute('aria-selected')).toBe('false')
  })

  it('a folder carries isDirectory true', async () => {
    page()
    await screen.findByText('docs')
    const dataTransfer = transfer()
    fireEvent.dragStart(row('docs'), { dataTransfer })
    expect(dataTransfer.setData.mock.calls).toEqual([
      ['application/x-hermes-paths', '[{"isDirectory":true,"path":"/home/agent/docs"}]'],
      ['text/plain', '/home/agent/docs']
    ])
  })

  it('a selected row carries the selection in shown order, skipping outside links', async () => {
    const entries = [file('notes.txt'), file('outside', { link_outside: true }), file('docs', { is_dir: true }), file('a.txt')]
    page({ '/list': () => ({ ok: true, entries, total: entries.length, truncated: false }) })
    await screen.findByText('notes.txt')
    // Select backwards relative to the listing, mixing the checkbox and Space selection paths.
    fireEvent.click(screen.getByLabelText('outside'))
    fireEvent.keyDown(row('notes.txt'), { key: ' ' })
    fireEvent.click(screen.getByLabelText('docs'))
    const dataTransfer = transfer()
    fireEvent.dragStart(row('notes.txt'), { dataTransfer })
    expect(dataTransfer.setData.mock.calls).toEqual([
      ['application/x-hermes-paths', '[{"isDirectory":true,"path":"/home/agent/docs"},{"isDirectory":false,"path":"/home/agent/notes.txt"}]'],
      ['text/plain', '/home/agent/docs\n/home/agent/notes.txt']
    ])
    expect(row('outside').getAttribute('draggable')).not.toBe('true')
    const outside = transfer()
    fireEvent.dragStart(row('outside'), { dataTransfer: outside })
    expect(outside.setData).not.toHaveBeenCalled()
    expect(['docs', 'notes.txt', 'outside'].map(name => row(name).getAttribute('aria-selected'))).toEqual(['true', 'true', 'true'])
  })

  it('an unselected row carries only itself while other rows are selected', async () => {
    page()
    await screen.findByText('notes.txt')
    fireEvent.click(screen.getByLabelText('docs'))
    fireEvent.click(screen.getByLabelText('readme.md'))
    const dataTransfer = transfer()
    fireEvent.dragStart(row('notes.txt'), { dataTransfer })
    expect(dataTransfer.setData.mock.calls).toEqual([
      ['application/x-hermes-paths', '[{"isDirectory":false,"path":"/home/agent/notes.txt"}]'],
      ['text/plain', '/home/agent/notes.txt']
    ])
  })

  it('search results are draggable and retain the shown search order for a selection', async () => {
    const results = [file('docs/z.txt'), file('docs/a.txt')]
    page({ '/search': () => ({ ok: true, results, truncated: false, reason: null, visited: 2 }) })
    await screen.findByText('notes.txt')
    fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'txt' } })
    await act(() => new Promise(resolve => setTimeout(resolve, 350)))
    await screen.findByRole('listbox', { name: 'Search results' })
    expect(row('z.txt').getAttribute('draggable')).toBe('true')
    fireEvent.click(screen.getByLabelText('a.txt'))
    fireEvent.click(screen.getByLabelText('z.txt'))
    const dataTransfer = transfer()
    fireEvent.dragStart(row('a.txt'), { dataTransfer })
    expect(dataTransfer.setData.mock.calls).toEqual([
      ['application/x-hermes-paths', '[{"isDirectory":false,"path":"/home/agent/docs/z.txt"},{"isDirectory":false,"path":"/home/agent/docs/a.txt"}]'],
      ['text/plain', '/home/agent/docs/z.txt\n/home/agent/docs/a.txt']
    ])
  })

  it('a selection keeps rows a search hides, after the shown ones', async () => {
    page({ '/search': () => ({ ok: true, results: [file('docs/z.txt')], truncated: false, reason: null, visited: 1 }) })
    await screen.findByText('notes.txt')
    fireEvent.click(screen.getByLabelText('notes.txt'))
    fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'z' } })
    await act(() => new Promise(resolve => setTimeout(resolve, 350)))
    await screen.findByRole('listbox', { name: 'Search results' })
    expect(screen.queryByText('notes.txt')).toBeNull()
    fireEvent.click(screen.getByLabelText('z.txt'))
    const dataTransfer = transfer()
    fireEvent.dragStart(row('z.txt'), { dataTransfer })
    expect(dataTransfer.setData.mock.calls).toEqual([
      ['application/x-hermes-paths', '[{"isDirectory":false,"path":"/home/agent/docs/z.txt"},{"isDirectory":false,"path":"/home/agent/notes.txt"}]'],
      ['text/plain', '/home/agent/docs/z.txt\n/home/agent/notes.txt']
    ])
  })
})

describe('live agent guard', () => {
  it.each(['profile', 'connectionId'] as const)('rejects a live %s switch after the rows rendered, before setting any payload', async store => {
    host.state.focusedSessionOwner.set(null)
    page()
    await screen.findByText('notes.txt')
    const element = row('notes.txt')
    const notify = vi.spyOn(host, 'notify')
    // Model the event between an agent switch and the page remount: the rows retain their old scope.
    vi.spyOn(host.state[store], 'get').mockReturnValue('other')
    const dataTransfer = transfer()
    expect(fireEvent.dragStart(element, { dataTransfer })).toBe(false)
    expect(dataTransfer.setData).not.toHaveBeenCalled()
    expect(dataTransfer.effectAllowed).toBe('uninitialized')
    expect(notify).toHaveBeenCalledExactlyOnceWith({ kind: 'warning', message: S.dragOtherAgent(store === 'profile' ? 'other' : 'default', 'default') })
  })

  it.each([
    { connectionId: 'conn-1', profile: 'other' },
    { connectionId: 'conn-2', profile: 'default' }
  ])('rejects a focused chat owned by another agent: %o', async owner => {
    page()
    await screen.findByText('notes.txt')
    const notify = vi.spyOn(host, 'notify')
    // This store is not observed by the list: the handler must read its live value.
    act(() => host.state.focusedSessionOwner.set(owner))
    const dataTransfer = transfer()
    expect(fireEvent.dragStart(row('notes.txt'), { dataTransfer })).toBe(false)
    expect(dataTransfer.setData).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledExactlyOnceWith({ kind: 'warning', message: S.dragOtherAgent(owner.profile, 'default') })
  })

  it('allows an older SDK with no focusedSessionOwner store', async () => {
    delete (host.state as { focusedSessionOwner?: typeof ownerStore }).focusedSessionOwner
    page()
    await screen.findByText('notes.txt')
    const notify = vi.spyOn(host, 'notify')
    const dataTransfer = transfer()
    expect(fireEvent.dragStart(row('notes.txt'), { dataTransfer })).toBe(true)
    expect(dataTransfer.setData).toHaveBeenCalledTimes(2)
    expect(notify).not.toHaveBeenCalled()
  })

  it('allows a local listing when the owner uses an empty connection id and profile', async () => {
    host.state.connectionId.set(null)
    host.state.focusedSessionOwner.set({ connectionId: '', profile: '' })
    page()
    await screen.findByText('notes.txt')
    const dataTransfer = transfer()
    expect(fireEvent.dragStart(row('notes.txt'), { dataTransfer })).toBe(true)
    expect(dataTransfer.setData).toHaveBeenCalledTimes(2)
  })

  it('uses the picker agent-name helper and the specified warning text', () => {
    expect(S.dragOtherAgent('reader', 'writer')).toBe("The chat you'd drop into is reader's; these files are on writer's machine. Switch to reader's files, or open the chat for writer.")
    expect(S.dragOtherAgent('', 'default')).toBe("The chat you'd drop into is the agent's; these files are on the agent's machine. Switch to the agent's files, or open the chat for the agent.")
  })
})

describe('excluded surfaces and upload drops', () => {
  it('Cloud picker rows have no draggable true attribute or payload handler', async () => {
    bindContext(createTestContext({ rest: fakeBackend().rest }).ctx as any)
    render(<PickerHost />)
    act(() => void cloudProvider.run({ insertText: vi.fn() }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('notes.txt')
    expect(dialog.querySelector('[draggable="true"]')).toBeNull()
    const dataTransfer = transfer()
    fireEvent.dragStart(row('notes.txt'), { dataTransfer })
    expect(dataTransfer.setData).not.toHaveBeenCalled()
  })

  it('Drive page rows are not draggable', async () => {
    const { view } = page()
    act(() => $driveAvailable.set(true))
    await screen.findByText('notes.txt')
    fireEvent.click(screen.getAllByRole('option').find(el => el.textContent === 'Google Drive')!)
    await screen.findByText('Plan')
    expect(screen.getAllByRole('option').filter(row => row.hasAttribute('data-entry'))).toHaveLength(3)
    expect(view.container.querySelector('[draggable="true"]')).toBeNull()
  })

  it('Drive picker rows are not draggable', async () => {
    bindContext(createTestContext({ rest: fakeBackend().rest }).ctx as any)
    $driveAvailable.set(true)
    render(<PickerHost />)
    act(() => void driveProvider.run({ insertText: vi.fn() }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('Plan')
    expect(within(dialog).getAllByRole('option').filter(row => row.hasAttribute('data-entry'))).toHaveLength(3)
    expect(dialog.querySelector('[draggable="true"]')).toBeNull()
  })

  it('Frame rejects reference drags without highlight or upload, even if files are present', async () => {
    const { calls } = page()
    await screen.findByText('notes.txt')
    const frame = screen.getByText('Cloud Files').closest('section')!
    const dataTransfer = { ...transfer(), items: [], files: [new File(['hello'], 'a.txt')] }
    expect(fireEvent.dragEnter(frame, { dataTransfer })).toBe(false)
    expect(fireEvent.dragOver(frame, { dataTransfer })).toBe(false)
    expect(dataTransfer.dropEffect).toBe('none')
    expect(screen.queryByText('Drop to upload to Home')).toBeNull()
    expect(fireEvent.drop(frame, { dataTransfer })).toBe(false)
    await flush()
    expect($batch.get()).toBeNull()
    expect(calls.some(c => c.path.startsWith('/uploads/'))).toBe(false)
  })

  it('Frame still highlights Files drags and allows copying, clearing on leave', async () => {
    // Actual Finder file uploads and folder walking remain covered by page.test.tsx.
    page()
    await screen.findByText('notes.txt')
    const frame = screen.getByText('Cloud Files').closest('section')!
    const dataTransfer = { ...transfer(), types: ['Files'] }
    fireEvent.dragEnter(frame, { dataTransfer })
    expect(screen.getByText('Drop to upload to Home')).toBeTruthy()
    expect(fireEvent.dragOver(frame, { dataTransfer })).toBe(false)
    expect(dataTransfer.dropEffect).toBe('copy')
    fireEvent.dragLeave(frame, { dataTransfer })
    expect(screen.queryByText('Drop to upload to Home')).toBeNull()
  })
})
