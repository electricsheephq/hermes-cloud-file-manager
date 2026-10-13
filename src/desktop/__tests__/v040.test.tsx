// v0.4.0: Download (A), the file list as a keyboard listbox with announcements (B), and the picker fixes of #51 (C).
// Opening a folder, the no-steal rule and closing the editor keep their v0.3.5 focus tests (v035.test.tsx, D2).
import { act, fireEvent, render, screen, within } from '@testing-library/react'

import { createTestContext, host, resetHost, resetQueryCache, setDownloadCapture, useQueryClient } from './sdk-mock'
import { fakeBackend } from './fake-backend'
import { $available, $driveAvailable, $unreachable, bindContext } from '../api'
import { captureFor } from '../download'
import { $drafts } from '../editor'
import { $batch, CloudFilesPage } from '../page'
import { closePicker, cloudProvider, PickerHost } from '../picker'
import plugin from '../plugin'
import { S } from '../strings'

const flush = async (rounds = 10) => {
  for (let i = 0; i < rounds; i++) await act(() => new Promise(resolve => setTimeout(resolve, 0)))
}
const file = (rel: string, extra = {}) => ({ name: rel.split('/').pop()!, rel, abs: `/home/agent/${rel}`, is_dir: false, size: 1, mtime: 0, ...extra })
const row = (name: string) => screen.getByText(name).closest('[role=option]') as HTMLElement
const download = () => screen.queryByRole('button', { name: 'Download' })
const live = () => document.querySelector('div[aria-live="polite"]:not([role])')?.textContent
const focused = () => document.activeElement?.getAttribute('data-entry')
const registered: Array<() => void> = []
/** The plugin registered on a test context; afterEach disposes it, so its availability gate stops probing. */
function register(rest: ReturnType<typeof fakeBackend>['rest']) {
  const t = createTestContext({ rest })
  plugin.register(t.ctx as any)
  registered.push(t.dispose)
  return t
}

/** The host's capture: each call records the agent selected then (as capabilityScoped does) and returns its own save. */
function captures() {
  const saves: Array<{ agent: string; save: ReturnType<typeof vi.fn> }> = []
  const capture = vi.fn(() => {
    const save = vi.fn(async () => undefined)
    saves.push({ agent: host.state.profile.get(), save })
    return save
  })
  setDownloadCapture(capture)
  return { capture, saves }
}
function Invalidate() {
  const client = useQueryClient()
  return <button onClick={() => void client.invalidateQueries({ queryKey: ['hcfm'] })}>Invalidate</button>
}
type Rest = ReturnType<typeof fakeBackend>['rest']
function page(overrides: Parameters<typeof fakeBackend>[0] = {}, wrap: (rest: Rest) => Rest = rest => rest) {
  const backend = fakeBackend(overrides)
  bindContext(createTestContext({ rest: wrap(backend.rest) }).ctx as any)
  return { ...backend, view: render(<><CloudFilesPage /><Invalidate /></>) }
}
const typeSearch = async (text: string) => {
  fireEvent.change(screen.getByLabelText('Search files'), { target: { value: text } })
  await act(() => new Promise(resolve => setTimeout(resolve, 350)))
  await flush()
}

beforeEach(() => {
  resetQueryCache(); resetHost(); setDownloadCapture(undefined)
  $available.set(true); $driveAvailable.set(null); $batch.set(null); $drafts.set(new Map())
})
afterEach(() => { registered.splice(0).forEach(dispose => dispose()); act(closePicker); setDownloadCapture(undefined); vi.restoreAllMocks() })

describe('A. Download', () => {
  it('export missing: no Download button anywhere, and the plugin still registers', async () => {
    const t = register(fakeBackend().rest); await flush()
    expect(['page', 'nav', 'attach-cloud'].every(id => t.live.has(id))).toBe(true)
    render(<CloudFilesPage />)
    fireEvent.click(await screen.findByText('notes.txt'))
    expect(download()).toBeNull()
    fireEvent.doubleClick(screen.getByText('readme.md'))
    await screen.findByRole('button', { name: 'Edit' })
    expect(download()).toBeNull()
  })

  it('shows only for exactly one selected plain file and saves it with (abs, name)', async () => {
    const { saves } = captures()
    page({ '/list': () => ({ ok: true, entries: [file('docs', { is_dir: true }), file('a.txt'), file('b.txt'), file('out.txt', { link_outside: true })], total: 4, truncated: false }) })
    fireEvent.click(await screen.findByText('a.txt'))
    fireEvent.click(download()!)
    expect(saves[0].save).toHaveBeenCalledExactlyOnceWith('/home/agent/a.txt', 'a.txt')
    fireEvent.keyDown(row('b.txt'), { key: ' ' }) // two selected
    expect(download()).toBeNull()
    for (const name of ['docs', 'out.txt']) {
      fireEvent.click(screen.getByText(name))
      expect(download()).toBeNull()
    }
  })

  it('captures with each listing and search fetch, never on a click', async () => {
    const { capture, saves } = captures()
    page()
    fireEvent.click(await screen.findByText('notes.txt'))
    expect(capture).toHaveBeenCalledTimes(1)
    fireEvent.click(download()!); fireEvent.click(download()!)
    expect(capture).toHaveBeenCalledTimes(1)
    expect(saves[0].save).toHaveBeenCalledTimes(2)
    fireEvent.doubleClick(screen.getByText('docs')); await flush()
    expect(capture).toHaveBeenCalledTimes(2)
    await typeSearch('pdf')
    expect(capture).toHaveBeenCalledTimes(3)
  })

  it('an agent switch never uses the old save; the button waits for the new listing and uses its capture', async () => {
    let release!: () => void
    const { saves } = captures()
    page({}, rest => (path, opts) => path.startsWith('/list') && host.state.profile.get() === 'other'
      ? new Promise(resolve => { release = () => resolve(rest(path, opts)) }) : rest(path, opts))
    fireEvent.click(await screen.findByText('notes.txt'))
    expect(download()).toBeTruthy()
    act(() => host.state.profile.set('other'))
    expect(download()).toBeNull()
    await flush()
    act(() => release())
    fireEvent.click(await screen.findByText('notes.txt'))
    fireEvent.click(download()!)
    expect(saves.map(s => [s.agent, s.save.mock.calls.length])).toEqual([['default', 0], ['other', 1]])
  })

  it('a capture for another agent than the query key stores no save, so no button', async () => {
    const { capture } = captures()
    act(() => host.state.profile.set('other'))
    expect(captureFor(['conn-1', 'default'])).toBeNull()
    expect(capture).not.toHaveBeenCalled()
    // End to end: the default agent's search refetched while "other" is selected keeps its results without a save.
    act(() => host.state.profile.set('default'))
    page()
    await screen.findByText('notes.txt'); await typeSearch('pdf')
    act(() => host.state.profile.set('other')); await flush()
    fireEvent.click(screen.getByText('Invalidate')); await flush()
    act(() => host.state.profile.set('default')); await flush()
    await typeSearch('pdf')
    fireEvent.click(screen.getByText('a.pdf'))
    expect(download()).toBeNull()
  })

  it("the editor's View offers Download with the save captured with the file read; Edit and Review do not", async () => {
    const { saves } = captures()
    page()
    fireEvent.doubleClick(await screen.findByText('readme.md'))
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }))
    expect(saves).toHaveLength(2) // the listing, then the read
    expect(saves[1].save).toHaveBeenCalledExactlyOnceWith('/home/agent/readme.md', 'readme.md')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(download()).toBeNull()
    fireEvent.change(document.querySelector('textarea')!, { target: { value: 'changed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review & save' }))
    expect(screen.getByText(S.reviewTitle('readme.md'))).toBeTruthy()
    expect(download()).toBeNull()
  })

  it('is not offered in Drive mode or in the picker', async () => {
    captures()
    page()
    act(() => $driveAvailable.set(true))
    fireEvent.click(await screen.findByText('notes.txt'))
    expect(download()).toBeTruthy()
    fireEvent.click(screen.getAllByRole('option').find(el => el.textContent === 'Google Drive')!)
    await screen.findByText('Plan')
    expect(download()).toBeNull()
    render(<PickerHost />)
    act(() => void cloudProvider.run({ insertText: vi.fn() }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(await within(dialog).findByText('notes.txt'))
    expect(within(dialog).queryByRole('button', { name: 'Download' })).toBeNull()
  })
})

describe('B. The file list', () => {
  it('is a labelled multi-select listbox of options; the checkbox is mouse-only and outside the tab order', async () => {
    page()
    await screen.findByText('notes.txt')
    const list = screen.getByRole('listbox', { name: 'Files in Home' })
    expect(list.getAttribute('aria-multiselectable')).toBe('true')
    expect(within(list).getAllByRole('option').map(el => el.getAttribute('aria-selected'))).toEqual(['false', 'false', 'false', 'false', 'false'])
    const box = screen.getByLabelText('notes.txt')
    expect(box.getAttribute('tabindex')).toBe('-1')
    expect(box.closest('[aria-hidden]')).toBeTruthy()
    fireEvent.click(box)
    expect(row('notes.txt').getAttribute('aria-selected')).toBe('true')
    await typeSearch('pdf')
    expect(screen.getByRole('listbox', { name: 'Search results' })).toBeTruthy()
  })

  it('has one tab stop: the last focused row, else the first selected, else the first', async () => {
    page()
    await screen.findByText('notes.txt')
    const stops = () => screen.getAllByRole('option').filter(el => el.tabIndex === 0).map(el => el.getAttribute('data-entry'))
    expect(stops()).toEqual(['docs'])
    fireEvent.click(screen.getByLabelText('notes.txt'))
    expect(stops()).toEqual(['notes.txt'])
    fireEvent.focus(row('zeta'))
    expect(stops()).toEqual(['zeta'])
  })

  it('arrows, Home/End and Page keys move focus and scroll the row into view', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    page()
    await screen.findByText('notes.txt') // docs, uploads, zeta, notes.txt, readme.md
    act(() => row('docs').focus())
    const press = (key: string) => fireEvent.keyDown(document.activeElement!, { key })
    press('ArrowDown'); expect(focused()).toBe('uploads')
    press('End'); expect(focused()).toBe('readme.md')
    press('ArrowDown'); expect(focused()).toBe('readme.md')
    press('Home'); expect(focused()).toBe('docs')
    press('PageDown'); expect(focused()).toBe('readme.md')
    press('PageUp'); expect(focused()).toBe('docs')
    press('ArrowUp'); expect(focused()).toBe('docs')
    expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' })
  })

  it.each([{ key: 'ArrowUp', altKey: true }, { key: 'Backspace' }])('%o goes to the parent and focuses the folder you came from', async keys => {
    page()
    await screen.findByText('docs')
    fireEvent.keyDown(row('docs'), { key: 'Enter' })
    await screen.findByText('a.pdf')
    fireEvent.keyDown(row('a.pdf'), keys)
    await screen.findByText('notes.txt')
    await flush()
    expect(focused()).toBe('docs')
    fireEvent.keyDown(row('docs'), keys) // at the root's top: nothing to go up to
    expect(screen.getByRole('listbox', { name: 'Files in Home' })).toBeTruthy()
  })

  it('Shift+ArrowDown extends the selection in the picker', async () => {
    bindContext(createTestContext({ rest: fakeBackend().rest }).ctx as any)
    render(<PickerHost />)
    act(() => void cloudProvider.run({ insertText: vi.fn() }))
    await screen.findByText('notes.txt')
    act(() => row('notes.txt').focus())
    fireEvent.keyDown(row('notes.txt'), { key: 'ArrowDown', shiftKey: true })
    expect(focused()).toBe('readme.md')
    expect(screen.getByText('2 selected')).toBeTruthy()
  })

  it('announces items on load, results for a search, a load error, and Showing N of M after Load more', async () => {
    const many = Array.from({ length: 1200 }, (_, i) => file(`f${String(i).padStart(4, '0')}.txt`))
    let fail = false
    const { calls } = page({ '/list': () => {
      if (fail) throw new Error('fetch failed')
      const { offset, limit } = calls.at(-1)!.params
      return { ok: true, entries: many.slice(Number(offset), Number(offset) + Number(limit)), total: many.length, truncated: false }
    } })
    await screen.findByText('f0000.txt')
    expect(live()).toBe('1,200 items')
    fireEvent.click(screen.getByRole('button', { name: 'Load more' })); await flush()
    expect(live()).toBe('Showing 1,000 of 1,200 items')
    fireEvent.click(screen.getByText('f0001.txt'))
    expect(live()).toBe('Showing 1,000 of 1,200 items') // not on selection changes
    await typeSearch('a.pdf')
    expect(live()).toBe('1 result')
    fail = true
    fireEvent.change(screen.getByLabelText('Search files'), { target: { value: '' } })
    fireEvent.click(screen.getByText('Invalidate')); await flush()
    expect(live()).toBe("Couldn't load this folder")
  }, 30_000)
})

describe('C. Picker (#51)', () => {
  const CHANGED = "Cloud Files isn't set up on the agent you switched to. This picker picks up again if you switch back to the agent you opened it on; Cancel closes it."
  it('the switch-back notices say what happens, in both variants', () => {
    expect(S.pickerPinnedElsewhere('B', 'A')).toBe("Cloud Files isn't set up on B. This picker picks up again if you switch back to A; Cancel closes it.")
    expect(S.pickerPinnedElsewhere('A', 'A')).toBe(CHANGED)
    expect(S.drivePinnedElsewhere('B', 'A')).toBe("Google Drive isn't available on B. This picker picks up again if you switch back to A, and an import already started there continues; Cancel closes it.")
    expect(S.drivePinnedElsewhere('A', 'A')).toContain('switch back to the agent you opened it on, and an import already started there continues; Cancel closes it.')
  })

  /** The plugin registered on `default` with the picker open; `answer(profile, n)` answers B/C's nth /available. */
  async function openOnDefault(answer: (profile: string, n: number) => Promise<unknown> | unknown) {
    const counts: Record<string, number> = {}
    const backend = fakeBackend({ '/available': () => {
      const profile = host.state.profile.get()
      counts[profile] = (counts[profile] ?? 0) + 1
      return profile === 'default' ? { ok: true } : answer(profile, counts[profile])
    } })
    const t = register(backend.rest); await flush()
    host.state.focusedSessionOwner.set(null)
    const view = render(t.live.get('picker-host').render())
    act(() => t.live.get('attach-cloud').data.run({ insertText: vi.fn() }))
    await screen.findByText('notes.txt')
    return { counts, view, t }
  }

  it("a transport error replaces the busy placeholder with Couldn't reach and Retry, which probes once", async () => {
    const { counts, view } = await openOnDefault((_, n) => (n === 1 ? Promise.reject(new Error('fetch failed')) : { ok: true }))
    act(() => host.state.profile.set('agent-b'))
    await screen.findByText("Couldn't reach agent-b's Cloud Files.")
    expect(view.container.querySelector('[aria-busy="true"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await flush()
    expect(counts['agent-b']).toBe(2)
    expect(await screen.findByText('notes.txt')).toBeTruthy()
    expect($unreachable.get()).toBeNull()
  })

  it("an older agent's late error never shows; a 404 still means not set up", async () => {
    const rejects: Record<string, (error: Error) => void> = {}
    const { view } = await openOnDefault(profile => new Promise((_yes, no) => { rejects[profile] = no }))
    act(() => host.state.profile.set('agent-b'))
    act(() => host.state.profile.set('agent-c'))
    await act(async () => rejects['agent-b'](new Error('fetch failed')))
    await flush()
    expect($unreachable.get()).toBeNull()
    expect(view.container.querySelector('[aria-busy="true"]')).toBeTruthy()
    await act(async () => rejects['agent-c'](new Error('404: plugin not mounted')))
    expect(await screen.findByText(S.pickerPinnedElsewhere('agent-c', 'default'))).toBeTruthy()
    expect(screen.queryByText(/Couldn't reach/)).toBeNull()
  })

  it('the header names the agent shown and follows a switch', async () => {
    await openOnDefault(() => ({ ok: true }))
    expect(screen.getByText("Files on the agent's machine")).toBeTruthy()
    act(() => host.state.profile.set('agent-b'))
    expect(await screen.findByText("Files on agent-b's machine")).toBeTruthy()
    expect(S.drivePickerShowing('agent-b')).toBe('Google Drive for agent-b')
  })
})
