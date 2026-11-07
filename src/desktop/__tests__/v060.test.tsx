import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { $available, $driveAvailable, $scopeInfo, bindContext, type Entry } from '../api'
import { $pickState, LIST_LIMIT } from '../browser'
import { CloudFilesPage } from '../page'
import { closePicker, cloudProvider, PickerHost } from '../picker'
import { fakeBackend } from './fake-backend'
import { createTestContext, resetHost, resetQueryCache, useQueryClient } from './sdk-mock'

const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve() }) }
const advance = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms) }); await flush() }
const entry = (rel: string, is_dir = false, mtime: number | null = 0): Entry => ({ name: rel.split('/').pop()!, rel, abs: `/home/agent/${rel}`, is_dir, size: 1, mtime: mtime as number })
const row = (name: string) => screen.getByText(name).closest('[data-entry]') as HTMLElement
const live = () => document.querySelector('[aria-live=polite]')?.textContent
const noMarks = () => { expect(screen.queryByText('New')).toBeNull(); expect(screen.queryByText('Updated')).toBeNull() }
function Refresh() {
  const client = useQueryClient()
  return <button onClick={() => void client.invalidateQueries({ queryKey: ['hcfm'] })}>Refresh</button>
}
function setup(all = [entry('old.txt'), entry('docs', true)], picker = false, truncated = false) {
  let hold = false
  const releases: Array<() => void> = []
  const backend = fakeBackend({ '/list': () => {
    const { params } = backend.calls.at(-1)!
    const items = params.path ? [entry(`${params.path}/inside.txt`)] : all
    const ordered = params.sort === 'mtime' ? [...items].reverse() : items
    const response = { ok: true, applied_sort: params.sort ?? 'name', entries: ordered.slice(Number(params.offset), Number(params.offset) + Number(params.limit)), total: items.length, truncated }
    return hold ? new Promise(resolve => releases.push(() => resolve(response))) : response
  }, '/search': () => ({ ok: true, results: all, truncated: false }) })
  const context = createTestContext({ rest: backend.rest })
  bindContext(context.ctx as any)
  const insert = vi.fn()
  render(picker ? <PickerHost /> : <><CloudFilesPage /><Refresh /></>)
  if (picker) act(() => void cloudProvider.run({ insertText: insert }))
  return { all, insert, hold: () => { hold = true }, release: () => { hold = false; releases.splice(0).forEach(fn => fn()) },
    refresh: async () => { act(() => context.emitEvent({ type: 'tool.complete', profile: 'default', connectionId: 'conn-1', payload: { name: 'write_file' } })); await advance(1000) } }
}
beforeEach(() => {
  vi.useFakeTimers(); resetHost(); resetQueryCache(); $scopeInfo.set({}); $pickState.set(null)
  $available.set(true); $driveAvailable.set(false)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
})
afterEach(() => { act(closePicker); cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

it('first load has no marks or extra announcement', async () => {
  setup(); await flush(); noMarks(); expect(live()).toBe('2 items')
})
it('marks a live-added file New and announces changed counts only', async () => {
  const b = setup(); await flush(); b.all.push(entry('new.txt')); await b.refresh()
  expect(within(row('new.txt')).getByText('New')).toBeTruthy()
  expect(screen.getByRole('option', { name: /new.txt, New/ })).toBeTruthy()
  expect(live()).toBe('3 items. 1 new')
  await b.refresh(); expect(live()).toBe('3 items')
  b.all.push(entry('next.txt')); b.all[0] = entry('old.txt', false, 2); await b.refresh()
  expect(live()).toBe('4 items. 2 new, 1 updated')
})
it('marks only increased numeric baseline mtimes Updated, including manual refresh', async () => {
  const b = setup([entry('old.txt'), entry('null.txt', false, null), entry('lower.txt', false, 3), entry('gone.txt')]); await flush()
  b.all.splice(0, 4, entry('old.txt', false, 2), entry('null.txt', false, 2), entry('lower.txt', false, 2))
  fireEvent.click(screen.getByText('Refresh')); await flush()
  expect(within(row('old.txt')).getByText('Updated')).toBeTruthy()
  expect(within(row('null.txt')).queryByText('Updated')).toBeNull()
  expect(within(row('lower.txt')).queryByText('Updated')).toBeNull()
  expect(live()).toBe('3 items. 1 updated')
  b.all[0] = entry('old.txt', false, null); await b.refresh(); noMarks()
})
it('sort Name to Date keeps the baseline and marks', async () => {
  const b = setup(); await flush(); b.all.push(entry('new.txt')); await b.refresh()
  fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'mtime' } }); await flush()
  expect(within(row('new.txt')).getByText('New')).toBeTruthy()
  expect(live()).toContain('Sorted by date modified'); expect(live()).not.toContain('1 new')
})
it('navigating away and back starts a fresh baseline', async () => {
  const b = setup(); await flush(); b.all.push(entry('new.txt')); await b.refresh()
  fireEvent.doubleClick(row('docs')); await flush(); noMarks()
  fireEvent.click(screen.getByRole('button', { name: 'Home' })); await flush(); noMarks()
})
it.each([false, true])('incomplete baseline never upgrades after Load more (truncated=%s)', async truncated => {
  const b = setup(Array.from({ length: LIST_LIMIT + 1 }, (_, i) => entry(`f${i}.txt`)), false, truncated); await flush()
  fireEvent.click(screen.getByText('Load more')); await flush()
  expect(row(`f${LIST_LIMIT}.txt`)).toBeTruthy(); noMarks()
  b.all[0] = entry('f0.txt', false, 1); b.all.push(entry('later.txt')); await b.refresh()
  expect(within(row('f0.txt')).getByText('Updated')).toBeTruthy()
  expect(within(row('later.txt')).queryByText('New')).toBeNull()
  expect(live()).toContain('1 updated'); expect(live()).not.toContain('new')
})
it('search results have no marks or change announcement', async () => {
  const b = setup(); await flush(); b.all.push(entry('new.txt')); await b.refresh()
  fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'txt' } }); await advance(300)
  expect(row('new.txt')).toBeTruthy(); noMarks(); expect(live()).not.toMatch(/new|updated/)
})
it('picker marks preserve selection and exact inserted text', async () => {
  const b = setup([entry('old.txt')], true); await flush(); fireEvent.click(row('old.txt'))
  b.all[0] = entry('old.txt', false, 1); b.all.push(entry('new.txt')); await b.refresh()
  expect(row('old.txt').getAttribute('aria-selected')).toBe('true')
  expect(within(row('old.txt')).getByText('Updated')).toBeTruthy()
  expect(within(row('new.txt')).getByText('New')).toBeTruthy(); fireEvent.click(row('new.txt'))
  expect(screen.getByRole('status').textContent).toBe('2 selected')
  fireEvent.click(screen.getByRole('button', { name: 'Insert locations' }))
  expect(b.insert).toHaveBeenCalledWith("\nCloud files on the agent's machine:\n- `/home/agent/old.txt`\n- `/home/agent/new.txt`")
})
it('another folder never borrows marked placeholder rows while its listing waits', async () => {
  const b = setup(); await flush(); b.all.push(entry('new.txt')); await b.refresh(); b.hold()
  fireEvent.doubleClick(row('docs')); await flush()
  expect(document.querySelectorAll('[data-entry]')).toHaveLength(0); noMarks()
  await act(async () => b.release()); await flush(); expect(row('inside.txt')).toBeTruthy(); noMarks()
})
