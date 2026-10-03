import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { $available, $driveAvailable, bindContext, type Entry } from '../api'
import { $batch, CloudFilesPage } from '../page'
import { cloudProvider, closePicker, PickerHost } from '../picker'
import { formatInsertText } from '../format'
import { fakeBackend } from './fake-backend'
import { createTestContext, host, resetHost, resetQueryCache, useQueryClient } from './sdk-mock'

const entry = (rel: string, is_dir = false): Entry => ({ name: rel.split('/').pop()!, rel, abs: `/home/agent/${rel}`, is_dir, size: 1, mtime: 0 })
const files = (n: number, folder = '') => Array.from({ length: n }, (_, i) => entry(`${folder ? folder + '/' : ''}f${String(i).padStart(4, '0')}.txt`))
const rows = () => [...document.querySelectorAll('[data-entry]')].map(row => row.getAttribute('data-entry'))
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement
const dialog = () => screen.getByRole('dialog')
const flush = async (rounds = 2) => {
  for (let i = 0; i < rounds; i++) await act(() => new Promise(resolve => setTimeout(resolve, 0)))
}
function Invalidate() {
  const client = useQueryClient()
  return <button onClick={() => void client.invalidateQueries({ queryKey: ['hcfm'] })}>Invalidate</button>
}
function setup(folders: Record<string, Entry[]>, picker = false, truncated = false) {
  let hold = false
  const releases: Array<() => void> = []
  const backend = fakeBackend({ '/list': () => {
    const { params } = backend.calls.at(-1)!
    const all = folders[params.path] ?? []
    const offset = Number(params.offset), limit = Number(params.limit)
    const reply = { ok: true, entries: all.slice(offset, offset + limit), total: all.length, truncated }
    return hold ? new Promise(resolve => releases.push(() => resolve(reply))) : reply
  } })
  const { ctx } = createTestContext({ rest: backend.rest })
  bindContext(ctx as any)
  const view = render(picker ? <PickerHost /> : <><CloudFilesPage /><Invalidate /></>)
  const insert = vi.fn()
  if (picker) act(() => void cloudProvider.run({ insertText: insert }))
  return { ...backend, ctx, view, insert, hold: () => { hold = true }, release: () => { hold = false; releases.splice(0).forEach(fn => fn()) } }
}
const more = async () => { fireEvent.click(button('Load more')); await flush() }
beforeEach(() => {
  resetQueryCache(); resetHost(); $available.set(null); $driveAvailable.set(false); $batch.set(null)
})
afterEach(() => { act(closePicker); vi.restoreAllMocks() })

it.each([false, true])('%s: L1/L6 keeps 500 rows during Load more, then shows all 812 without a note', async picker => {
  const backend = setup({ '': files(812) }, picker)
  await flush()
  expect(rows()).toHaveLength(500)
  expect(screen.getByText('Showing 500 of 812 items')).toBeTruthy()
  backend.hold()
  fireEvent.click(button('Load more'))
  expect(rows()).toHaveLength(500) // before any flush
  await flush()
  // The unchanged query mock emits on settlement, not fetch start; rerender while the reply is held.
  backend.view.rerender(picker ? <PickerHost /> : <><CloudFilesPage /><Invalidate /></>)
  expect(button('Load more').disabled).toBe(true)
  expect(rows()).toHaveLength(500)
  await act(async () => backend.release())
  expect(rows()).toHaveLength(812)
  expect(screen.queryByText(/Showing/)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  if (picker) expect(within(dialog()).getAllByRole('listitem')).toHaveLength(812)
})
it('L2: count 2500 uses capped chunks at offsets 0 and 2000', async () => {
  const { calls } = setup({ '': files(2600) })
  await flush()
  for (let i = 0; i < 3; i++) await more()
  const start = calls.length
  await more()
  expect(calls.slice(start).filter(c => c.path === '/list').map(c => [c.params.offset, c.params.limit])).toEqual([['0', '2000'], ['2000', '500']])
  expect(rows()).toHaveLength(2500)
  expect(screen.getByText(`Showing ${(2500).toLocaleString()} of ${(2600).toLocaleString()} items`)).toBeTruthy()
})
it('L7: an agent switch while a chunk is pending sends no later chunk to the new agent', async () => {
  const backend = setup({ '': files(2600) })
  await flush()
  for (let i = 0; i < 3; i++) await more()
  backend.hold()
  fireEvent.click(button('Load more'))
  await flush()
  expect(backend.calls.at(-1)!.params).toMatchObject({ offset: '0', limit: '2000' })
  const start = backend.calls.length
  act(() => host.state.profile.set('other'))
  await act(async () => backend.release())
  await flush(4)
  expect(backend.calls.slice(start).some(c => c.path === '/list' && c.params.offset === '2000')).toBe(false)
})
it('L3: another folder never shows previous rows and each navigation resets count', async () => {
  setup({ '': [entry('A', true), entry('B', true)], A: files(1200, 'A'), B: files(812, 'B') })
  await flush()
  fireEvent.doubleClick(screen.getByText('A')); await flush(); await more()
  expect(rows()).toHaveLength(1000)
  fireEvent.click(button('Home'))
  expect(rows().some(rel => rel?.startsWith('A/'))).toBe(false)
  await flush()
  fireEvent.doubleClick(screen.getByText('B'))
  expect(rows().some(rel => rel?.startsWith('A/'))).toBe(false)
  await flush()
  expect(rows()).toHaveLength(500)
  expect(rows().every(rel => rel?.startsWith('B/'))).toBe(true)
  fireEvent.click(button('Home')); await flush()
  fireEvent.doubleClick(screen.getByText('A'))
  expect(rows().some(rel => rel?.startsWith('B/'))).toBe(false)
  await flush()
  expect(rows()).toHaveLength(500)
})
it('L4: upload-prefix invalidation retains the expanded 1000 rows', async () => {
  const { calls } = setup({ '': files(1200) })
  await flush(); await more()
  const start = calls.length
  fireEvent.click(button('Invalidate'))
  expect(rows()).toHaveLength(1000)
  await flush()
  expect(rows()).toHaveLength(1000)
  expect(calls.slice(start).some(c => c.path === '/list' && c.params.limit === '1000')).toBe(true)
})
it('L5: scan truncation with all known rows shown offers search, without Load more', async () => {
  setup({ '': files(7) }, false, true)
  await flush()
  expect(screen.getByText('Showing the first 7 items. Search finds the rest.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
})
it('L: fake /list reports full total and honors offset/limit', async () => {
  const reply = await fakeBackend().rest('/list?root=home&path=docs&offset=1&limit=1')
  expect(reply).toMatchObject({ total: 2, entries: [expect.objectContaining({ rel: 'docs/b.pdf' })] })
})

it.each(['\n', '\r'])('N1: skips a %s name from Insert and Copy locations, disabling both for only that name', async newline => {
  const bad = entry(`a${newline}b.md`), good = entry('c.md')
  const { insert, ctx } = setup({ '': [bad, good] }, true)
  const copy = vi.spyOn(ctx.os, 'writeClipboard')
  await flush()
  const boxes = () => within(dialog()).getAllByRole('checkbox')
  fireEvent.click(boxes()[0]); fireEvent.click(boxes()[1])
  expect(screen.getByText('A selected name has a line break, so it won’t be inserted.')).toBeTruthy()
  fireEvent.click(button('Insert locations'))
  expect(insert).toHaveBeenCalledExactlyOnceWith(formatInsertText('default', [good]))
  act(() => void cloudProvider.run({ insertText: insert })); await flush()
  fireEvent.click(boxes()[0])
  expect(button('Insert locations').disabled).toBe(true)
  act(() => host.state.activeSessionId.set('session-2'))
  expect(button('Copy locations').disabled).toBe(true)
  fireEvent.click(boxes()[1]); fireEvent.click(button('Copy locations'))
  expect(copy).toHaveBeenCalledExactlyOnceWith(formatInsertText('default', [good]))
})
it('P1: composer handoff keeps folder, search and two selected files', async () => {
  const { view, calls } = setup({ '': [entry('docs', true)], docs: [entry('docs/a.pdf'), entry('docs/b.pdf')] }, true)
  render(<PickerHost />)
  await flush()
  fireEvent.doubleClick(screen.getByText('docs')); await flush()
  fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'pdf' } })
  await act(() => new Promise(resolve => setTimeout(resolve, 350))); await flush()
  fireEvent.click(screen.getByLabelText('a.pdf')); fireEvent.click(screen.getByLabelText('b.pdf'))
  expect(screen.getByText('2 selected')).toBeTruthy()
  const start = calls.length
  view.unmount(); await flush()
  expect((screen.getByLabelText('Search files') as HTMLInputElement).value).toBe('pdf')
  expect(screen.getByRole('navigation').textContent).toContain('docs')
  expect(screen.getByText('2 selected')).toBeTruthy()
  expect(within(dialog()).getAllByRole('checkbox').every(el => (el as HTMLInputElement).checked)).toBe(true)
  expect(calls.slice(start).some(c => c.path === '/list' && c.params.path === '')).toBe(false)
})
it.each(['reopen', 'agent'] as const)('P1 control: %s starts fresh', async action => {
  setup({ '': [entry('docs', true)], docs: [entry('docs/a.pdf')] }, true)
  await flush()
  fireEvent.doubleClick(screen.getByText('docs')); await flush()
  fireEvent.click(screen.getByLabelText('a.pdf'))
  fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'pdf' } })
  if (action === 'reopen') {
    fireEvent.click(button('Cancel'))
    act(() => void cloudProvider.run({ insertText: vi.fn() }))
  } else act(() => { host.state.profile.set('other'); host.state.focusedSessionOwner.set({ connectionId: 'conn-1', profile: 'other' }) })
  await flush()
  expect((screen.getByLabelText('Search files') as HTMLInputElement).value).toBe('')
  expect(screen.getByRole('navigation').textContent).toBe('Home')
  expect(screen.getByText('0 selected')).toBeTruthy()
})
