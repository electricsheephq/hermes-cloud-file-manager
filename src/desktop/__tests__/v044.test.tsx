// v0.4.4: bounded tool-event refresh of Cloud listings and Drive row keyboard navigation.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { createTestContext, host, resetHost, resetQueryCache, useQuery } from './sdk-mock'
import { fakeBackend } from './fake-backend'
import { $available, $driveAvailable, bindContext } from '../api'
import { toolMayChangeFiles } from '../browser'
import { $driveJob } from '../drive'
import { $drafts } from '../editor'
import { $batch, CloudFilesPage } from '../page'
import { closePicker, cloudProvider, driveProvider, PickerHost } from '../picker'

const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve() }) }
const advance = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms) }); await flush() }
const event = (extra = {}) => ({ type: 'tool.complete', profile: 'default', connectionId: 'conn-1', payload: { name: 'write_file' }, ...extra })
const row = (name: string) => screen.getByText(name).closest('[role=option]') as HTMLElement
const focus = (element: HTMLElement) => act(() => element.focus())
function page(onEvent = true, overrides: Parameters<typeof fakeBackend>[0] = {}) {
  const backend = fakeBackend(overrides)
  const context = createTestContext({ rest: backend.rest, onEvent })
  bindContext(context.ctx as any)
  return { ...backend, ...context, view: render(<CloudFilesPage />) }
}
async function drivePage() {
  const result = page()
  await flush()
  act(() => $driveAvailable.set(true))
  fireEvent.click(screen.getAllByRole('option').find(el => el.closest('[data-select]') && el.textContent === 'Google Drive')!)
  await flush()
  expect(row('Projects')).toBeTruthy()
  return result
}
beforeEach(() => {
  vi.useFakeTimers()
  resetQueryCache(); resetHost()
  $available.set(true); $driveAvailable.set(null); $batch.set(null); $driveJob.set(null); $drafts.set(new Map())
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
})
afterEach(() => { act(closePicker); cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('toolMayChangeFiles', () => {
  it.each([
    [{ name: 'write_file' }, true], [{ name: 'read_file' }, false], [{ name: 'search_files' }, false],
    [{ name: 'terminal' }, true], [{ name: 'apply_patch' }, true], [{ name: 'read_file', inline_diff: '@@' }, true],
    [{}, false], [undefined, false], [null, false], ['write_file', false],
    [{ tool: 'move_file' }, true], [{ name: 'read_file', inline_diff: '  ' }, false]
  ])('classifies %j as %s', (payload, expected) => expect(toolMayChangeFiles(payload)).toBe(expected))
})

describe('Cloud live refresh', () => {
  it('refreshes the matching listing once after 1000 ms, showing a newly written file', async () => {
    let written = false
    const backend = page(true, { '/list': () => ({ ok: true, entries: written ? [{ name: 'new.txt', rel: 'new.txt', abs: '/home/agent/new.txt', is_dir: false, size: 1, mtime: 0 }] : [], total: written ? 1 : 0 }) })
    await flush()
    const start = backend.calls.length
    written = true
    act(() => backend.emitEvent(event()))
    await advance(999)
    expect(backend.calls.slice(start)).toHaveLength(0)
    await advance(1)
    expect(backend.calls.slice(start).map(c => c.path)).toEqual(['/list'])
    expect(screen.getByText('new.txt')).toBeTruthy()
  })

  it('coalesces five events without restarting the timer, then accepts a sixth', async () => {
    const backend = page()
    await flush()
    const start = backend.calls.length
    act(() => backend.emitEvent(event()))
    for (let i = 0; i < 4; i++) {
      await advance(200)
      act(() => backend.emitEvent(event()))
    }
    await advance(199)
    expect(backend.calls.slice(start)).toHaveLength(0)
    await advance(1)
    expect(backend.calls.slice(start).map(c => c.path)).toEqual(['/list'])
    act(() => backend.emitEvent(event()))
    await advance(999)
    expect(backend.calls.slice(start)).toHaveLength(1)
    await advance(1)
    expect(backend.calls.slice(start).map(c => c.path)).toEqual(['/list', '/list'])
  })

  it.each([
    { payload: { name: 'read_file' } }, { profile: 'other' }, { connectionId: 'conn-B' },
    { profile: undefined }, { payload: undefined }, { payload: 'write_file' }, { type: 'tool.start' }
  ])('ignores an unrelated or unowned event %j', async extra => {
    const backend = page()
    await flush()
    const start = backend.calls.length
    act(() => backend.emitEvent(event(extra)))
    await advance(1000)
    expect(backend.calls.slice(start)).toHaveLength(0)
  })

  it.each([
    [null, undefined], [null, ''], [null, '  '], ['local', undefined], ['local', 'local'], ['', undefined], ['', 'local']
  ] as const)('host connection %j matches a local event connection %j, excluding remote events', async (hostId, connectionId) => {
    host.state.connectionId.set(hostId)
    const backend = page()
    await flush()
    const start = backend.calls.length
    act(() => backend.emitEvent(event({ connectionId: 'conn-B' })))
    await advance(1000)
    expect(backend.calls.slice(start)).toHaveLength(0)
    act(() => backend.emitEvent(event({ connectionId })))
    await advance(1000)
    expect(backend.calls.slice(start).map(c => c.path)).toEqual(['/list'])
  })

  it.each(['', '  ', ' default '])('normalizes the event profile %j to default', async profile => {
    const backend = page()
    await flush()
    const start = backend.calls.length
    act(() => backend.emitEvent(event({ profile, connectionId: ' conn-1 ' })))
    await advance(1000)
    expect(backend.calls.slice(start).map(c => c.path)).toEqual(['/list'])
  })

  it('refreshes search only, leaving roots, Drive, previews, editor and other scopes alone', async () => {
    const backend = page()
    await flush()
    function OtherQueries() {
      for (const key of [
        ['conn-1', 'default', 'drive'], ['conn-1', 'default', 'preview'], ['conn-1', 'default', 'file'],
        ['conn-1', 'other', 'list'], ['conn-B', 'default', 'search']
      ]) useQuery({ queryKey: ['hcfm', ...key], queryFn: () => backend.rest(`/untouched/${key.join('/')}`) })
      return null
    }
    render(<OtherQueries />)
    fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'notes' } })
    await advance(300)
    expect(screen.getByRole('listbox', { name: 'Search results' })).toBeTruthy()
    const start = backend.calls.length
    act(() => backend.emitEvent(event()))
    await advance(1000)
    expect(backend.calls.slice(start).map(c => c.path)).toEqual(['/search'])
  })

  it('defers hidden events until visible, with no refresh for visibility alone', async () => {
    const backend = page()
    await flush()
    const start = backend.calls.length
    const visibility = vi.spyOn(document, 'visibilityState', 'get')
    visibility.mockReturnValue('hidden')
    act(() => backend.emitEvent(event()))
    await advance(1000)
    act(() => backend.emitEvent(event()))
    await advance(1000)
    expect(backend.calls.slice(start)).toHaveLength(0)
    visibility.mockReturnValue('visible')
    fireEvent(document, new Event('visibilitychange'))
    await flush()
    expect(backend.calls.slice(start).map(c => c.path)).toEqual(['/list'])
    fireEvent(document, new Event('visibilitychange'))
    await flush()
    expect(backend.calls.slice(start)).toHaveLength(1)
  })

  it('refreshes once when the window returns with a refresh already pending', async () => {
    const backend = page()
    await flush()
    const start = backend.calls.length
    const visibility = vi.spyOn(document, 'visibilityState', 'get')
    visibility.mockReturnValue('hidden')
    act(() => backend.emitEvent(event()))
    await advance(1000)
    act(() => backend.emitEvent(event()))
    await advance(500)
    visibility.mockReturnValue('visible')
    fireEvent(document, new Event('visibilitychange'))
    await flush()
    expect(backend.calls.slice(start)).toHaveLength(0)
    await advance(500)
    expect(backend.calls.slice(start).map(c => c.path)).toEqual(['/list'])
  })

  it('keeps Load more enabled and focused through a live refresh', async () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ name: `f${String(i).padStart(3, '0')}.txt`, rel: `f${String(i).padStart(3, '0')}.txt`, abs: `/home/agent/f${String(i).padStart(3, '0')}.txt`, is_dir: false, size: 1, mtime: 0 }))
    let release: (() => void) | undefined
    let hold = false
    const backend = page(true, { '/list': async () => {
      if (hold) await new Promise<void>(resolve => { release = resolve })
      return { ok: true, entries: many.slice(0, 500), total: many.length }
    } })
    await flush()
    const more = screen.getByRole('button', { name: 'Load more' }) as HTMLButtonElement
    focus(more)
    hold = true
    act(() => backend.emitEvent(event()))
    await advance(1000)
    expect(release).toBeDefined()
    expect(more.disabled).toBe(false)
    expect(document.activeElement).toBe(more)
    await act(async () => release!())
    await flush()
    expect(document.activeElement).toBe(more)
  })

  it('disposes the subscription and pending timer and visibility listener on unmount', async () => {
    const backend = page()
    await flush()
    const start = backend.calls.length
    const remove = vi.spyOn(document, 'removeEventListener')
    act(() => backend.emitEvent(event()))
    backend.view.unmount()
    expect(backend.eventDisposals()).toBe(1)
    expect(backend.listeners.get('tool.complete')?.size).toBe(0)
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    await advance(1000)
    fireEvent(document, new Event('visibilitychange'))
    expect(backend.calls.slice(start)).toHaveLength(0)
  })

  it.each(['profile', 'connectionId'] as const)('clears pending work and re-subscribes when %s changes', async store => {
    const backend = page()
    await flush()
    act(() => backend.emitEvent(event()))
    act(() => host.state[store].set('other'))
    await flush()
    const start = backend.calls.length
    expect(backend.eventDisposals()).toBe(1)
    await advance(1000)
    expect(backend.calls.slice(start)).toHaveLength(0)
    act(() => backend.emitEvent(event()))
    await advance(1000)
    expect(backend.calls.slice(start)).toHaveLength(0)
    act(() => backend.emitEvent(event({ [store]: 'other' })))
    await advance(1000)
    expect(backend.calls.slice(start).map(c => c.path)).toEqual(['/list'])
  })

  it('renders without onEvent, installing no listener or timer', async () => {
    const backend = page(false)
    await flush()
    expect(screen.getByText('notes.txt')).toBeTruthy()
    const start = backend.calls.length
    expect(backend.listeners.size).toBe(0)
    act(() => backend.emitEvent(event()))
    await advance(1000)
    expect(backend.calls.slice(start)).toHaveLength(0)
  })

  it('refreshes the Cloud picker through the shared list', async () => {
    const backend = fakeBackend()
    const context = createTestContext({ rest: backend.rest })
    bindContext(context.ctx as any)
    render(<PickerHost />)
    act(() => void cloudProvider.run({ insertText: vi.fn() }))
    await flush()
    expect(within(screen.getByRole('dialog')).getByText('notes.txt')).toBeTruthy()
    const start = backend.calls.length
    act(() => context.emitEvent(event()))
    await advance(1000)
    expect(backend.calls.slice(start).map(c => c.path)).toEqual(['/list'])
  })
})

describe('Drive keyboard parity', () => {
  it('has one row tab stop, preferring last focus then selection; checkboxes are mouse-only', async () => {
    await drivePage()
    const rows = screen.getAllByRole('option').filter(el => el.hasAttribute('data-entry'))
    expect(rows.map(el => el.tabIndex)).toEqual([0, -1, -1])
    for (const checkbox of screen.getAllByRole('checkbox', { hidden: true })) {
      expect(checkbox.tabIndex).toBe(-1)
      expect(checkbox.parentElement?.getAttribute('aria-hidden')).toBeNull()
    }
    fireEvent.keyDown(row('Plan'), { key: ' ' })
    expect(rows.map(el => el.tabIndex)).toEqual([-1, 0, -1])
    focus(row('report.pdf'))
    expect(rows.map(el => el.tabIndex)).toEqual([-1, -1, 0])
  })

  it('moves focus with arrows, pages and Home/End, clamps and scrolls without Shift selection', async () => {
    await drivePage()
    const rows = screen.getAllByRole('option').filter(el => el.hasAttribute('data-entry'))
    const scroll = vi.fn()
    rows.forEach(el => { el.scrollIntoView = scroll })
    focus(rows[0])
    for (const [key, index] of [['ArrowDown', 1], ['End', 2], ['ArrowDown', 2], ['Home', 0], ['ArrowUp', 0], ['PageDown', 2], ['PageUp', 0], ['ArrowDown', 1], ['ArrowUp', 0]] as const) {
      fireEvent.keyDown(document.activeElement!, { key, shiftKey: true })
      expect(document.activeElement).toBe(rows[index])
      expect(rows.filter(el => el.tabIndex === 0)).toHaveLength(1)
    }
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
    expect(rows.every(el => el.getAttribute('aria-selected') === 'false')).toBe(true)
    const checkbox = screen.getAllByRole('checkbox', { hidden: true })[0]
    fireEvent.keyDown(checkbox, { key: 'End' })
    expect(document.activeElement).toBe(rows[0])
  })

  it.each([{ key: 'Backspace' }, { key: 'ArrowUp', altKey: true }])('goes up and focuses the folder it came from with %j; root is inert', async key => {
    const backend = await drivePage()
    focus(row('Projects'))
    fireEvent.keyDown(row('Projects'), { key: 'Enter' })
    await flush()
    expect(document.activeElement).toBe(row('Budget'))
    fireEvent.keyDown(row('Budget'), key)
    await flush()
    expect(document.activeElement).toBe(row('Projects'))
    const start = backend.calls.length
    expect(fireEvent.keyDown(row('Projects'), key)).toBe(false)
    await flush()
    expect(document.activeElement).toBe(row('Projects'))
    expect(backend.calls.slice(start)).toHaveLength(0)
  })

  it('keeps Space/Enter file toggling and cross-folder selection; folders stay unselected', async () => {
    await drivePage()
    fireEvent.keyDown(row('Plan'), { key: ' ' })
    expect(row('Plan').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(row('Plan'), { key: 'Enter' })
    expect(row('Plan').getAttribute('aria-selected')).toBe('false')
    fireEvent.keyDown(row('Plan'), { key: ' ' })
    focus(row('Projects'))
    fireEvent.keyDown(row('Projects'), { key: 'Enter' })
    await flush()
    fireEvent.keyDown(row('Budget'), { key: ' ' })
    fireEvent.keyDown(row('Budget'), { key: 'Backspace' })
    await flush()
    expect(row('Projects').getAttribute('aria-selected')).toBe('false')
    expect(row('Plan').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('button', { name: 'Import 2 to Cloud Files' })).toBeTruthy()
  })

  it('does not go up while searching in a subfolder', async () => {
    const backend = await drivePage()
    fireEvent.keyDown(row('Projects'), { key: 'Enter' })
    await flush()
    fireEvent.change(screen.getByLabelText('Search Google Drive'), { target: { value: 'Budget' } })
    await advance(300)
    const start = backend.calls.length
    fireEvent.keyDown(row('Budget'), { key: 'Backspace' })
    await flush()
    expect(screen.getByRole('navigation').textContent).toContain('Projects')
    expect(backend.calls.slice(start)).toHaveLength(0)
  })

  it('shares one tab stop and arrow navigation in the Google Drive picker', async () => {
    bindContext(createTestContext({ rest: fakeBackend().rest }).ctx as any)
    $driveAvailable.set(true)
    render(<PickerHost />)
    act(() => void driveProvider.run({ insertText: vi.fn() }))
    await flush()
    const rows = within(screen.getByRole('dialog')).getAllByRole('option').filter(el => el.hasAttribute('data-entry'))
    expect(rows.map(el => el.tabIndex)).toEqual([0, -1, -1])
    focus(rows[0])
    fireEvent.keyDown(rows[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[1])
  })
})
