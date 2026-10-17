import { act, fireEvent, render, screen } from '@testing-library/react'
import { $available, $driveAvailable, $scopeInfo, ApiError, bindContext, type Entry, rest, scopeKey } from '../api'
import { CloudFilesPage } from '../page'
import { cloudProvider, closePicker, PickerHost } from '../picker'
import { registerAvailabilityGate } from '../plugin'
import { fakeBackend, ROOTS } from './fake-backend'
import { createTestContext, host, resetHost, resetQueryCache, useQueryClient } from './sdk-mock'

const entry = (rel: string, is_dir = false): Entry => ({ name: rel.split('/').pop()!, rel, abs: `/home/agent/${rel}`, is_dir, size: 1, mtime: 0 })
const files = (n: number) => Array.from({ length: n }, (_, i) => entry(`f${String(i).padStart(4, '0')}.txt`))
const rows = () => [...document.querySelectorAll('[data-entry]')].map(row => row.getAttribute('data-entry'))
const sort = () => screen.getByLabelText('Sort') as HTMLSelectElement
const change = (value: string) => fireEvent.change(sort(), { target: { value } })
const dateOption = () => screen.getByRole('option', { name: 'Date modified' }) as HTMLOptionElement
const flush = async () => { for (let i = 0; i < 3; i++) await act(() => new Promise(resolve => setTimeout(resolve, 0))) }
function Refresh() {
  const client = useQueryClient()
  return <button onClick={() => void client.invalidateQueries({ queryKey: ['hcfm'] })}>Refresh</button>
}
function setup(all = files(812), picker = false) {
  let old = false, truncated = false, hold = false, missingPage = false
  const releases: Array<() => void> = []
  const backend = fakeBackend({ '/list': () => {
    const { params } = backend.calls.at(-1)!
    const ordered = params.sort === 'mtime' ? [...all].reverse() : all
    const offset = Number(params.offset), limit = Number(params.limit)
    const response = { ok: true, ...(old || (missingPage && offset > 0) ? {} : { applied_sort: params.sort ?? 'name' }),
      entries: ordered.slice(offset, offset + limit), total: ordered.length, truncated }
    return hold ? new Promise(resolve => releases.push(() => resolve(response))) : response
  } })
  const context = createTestContext({ rest: backend.rest, writeClipboard: vi.fn(async () => true) })
  bindContext(context.ctx as any)
  render(picker ? <PickerHost /> : <><CloudFilesPage /><Refresh /></>)
  if (picker) act(() => void cloudProvider.run({ insertText: vi.fn() }))
  return { ...backend, ...context, all, old: () => { old = true }, truncate: () => { truncated = true },
    modern: () => { old = false }, missingPage: () => { missingPage = true },
    releaseOne: () => releases.shift()?.(),
    hold: () => { hold = true }, release: () => { hold = false; releases.splice(0).forEach(fn => fn()) } }
}
beforeEach(() => {
  resetHost(); resetQueryCache(); $scopeInfo.set({}); $available.set(true); $driveAvailable.set(false)
})
afterEach(() => { act(closePicker); vi.useRealTimers(); vi.restoreAllMocks() })

it('sort identities reset count, exclude placeholders and never append across sorts', async () => {
  const b = setup(); await flush()
  fireEvent.click(screen.getByText('Load more')); await flush()
  expect(rows()).toHaveLength(812)
  b.hold(); change('mtime')
  expect(rows()).toEqual([])
  await flush()
  expect(b.calls.at(-1)?.params).toMatchObject({ sort: 'mtime', offset: '0', limit: '500' })
  await act(async () => b.release())
  expect(rows()).toHaveLength(500)
  expect(rows()[0]).toBe('f0811.txt')
  expect(document.querySelector('[aria-live=polite]')?.textContent).toContain('Sorted by date modified')
  change('name'); await flush()
  expect(rows()).toHaveLength(500)
})
it('Date rereads a same-total reordered prefix with the boundary unchanged', async () => {
  const b = setup(); await flush(); change('mtime'); await flush()
  // Reverse order is [811..0]; move the old 501st row first without changing the 500th boundary.
  const oldBoundary = rows().at(-1)
  const newest = b.all[311]; [b.all[311], b.all[811]] = [b.all[811], b.all[311]]
  const start = b.calls.length
  fireEvent.click(screen.getByText('Load more')); await flush()
  expect(b.calls.slice(start).map(c => c.params)).toEqual([expect.objectContaining({ sort: 'mtime', offset: '0', limit: '1000' })])
  expect(rows()[0]).toBe(newest.rel)
  expect(rows()[499]).toBe(oldBoundary)
  expect(new Set(rows()).size).toBe(812)
})
it('an old gateway disables Date and falls back without erasing the remembered choice', async () => {
  const b = setup(); await flush(); change('mtime'); await flush()
  b.old(); fireEvent.click(screen.getByText('Refresh')); await flush()
  expect(sort().value).toBe('name'); expect(dateOption().disabled).toBe(true)
  expect(screen.getByText('Update Cloud File Manager on the agent to sort by date.')).toBeTruthy()
  expect($scopeInfo.get()[scopeKey()]).toMatchObject({ sort: 'mtime', date: false })
  expect(rows()[0]).toBe('f0000.txt')
})
it('A-new/B-old/A-new ignores late rows and capabilities from either other scope', async () => {
  const b = setup(files(3)); await flush(); change('mtime'); await flush()
  b.hold(); fireEvent.click(screen.getByText('Refresh')); await flush()
  b.old(); b.all.splice(0, 3, entry('B-private.txt'))
  act(() => host.state.profile.set('B')); await flush()
  expect(rows()).toEqual([])
  await act(async () => b.releaseOne()); await flush()
  expect($scopeInfo.get()[scopeKey()]?.date).toBeUndefined(); expect(rows()).toEqual([])
  await act(async () => b.release()); await flush()
  expect(rows()).toEqual(['B-private.txt']); expect(dateOption().disabled).toBe(true)
  expect($scopeInfo.get()['conn-1|default']).toMatchObject({ sort: 'mtime', date: true })
  b.hold(); fireEvent.click(screen.getByText('Refresh')); await flush()
  b.modern(); b.all.splice(0, 1, ...files(3))
  act(() => host.state.profile.set('default'))
  expect(rows()).not.toContain('B-private.txt'); expect(sort().value).toBe('mtime')
  await act(async () => b.releaseOne()); await flush()
  expect(dateOption().disabled).toBe(false)
  await act(async () => b.release()); await flush()
  expect(dateOption().disabled).toBe(false)
  expect(rows()).toEqual(['f0002.txt', 'f0001.txt', 'f0000.txt'])
})
it.each([false, true])('Name keeps highlights, folders and locale order (old=%s)', async old => {
  const backend = fakeBackend({}, undefined, undefined, old)
  bindContext(createTestContext({ rest: backend.rest }).ctx as any)
  render(<CloudFilesPage />); await flush()
  expect(rows()).toEqual(['docs', 'uploads', 'zeta', 'notes.txt', 'readme.md'])
  expect(dateOption().disabled).toBe(old)
})
it('Date preserves raw server order, interleaving files and highlighted folders', async () => {
  setup([entry('docs', true), entry('uploads', true), entry('zeta', true), entry('a.txt')]); await flush(); change('mtime'); await flush()
  expect(rows()).toEqual(['a.txt', 'zeta', 'uploads', 'docs'])
})
it('search disables Sort immediately through debounce and keeps walker order', async () => {
  setup(files(3)); await flush(); change('mtime'); await flush()
  fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'pdf' } })
  expect(sort().disabled).toBe(true)
  await act(() => new Promise(resolve => setTimeout(resolve, 320))); await flush()
  expect(rows()).toEqual(['docs/a.pdf', 'docs/b.pdf'])
  expect(document.querySelector('[aria-live=polite]')?.textContent).not.toContain('Sorted by date modified')
  fireEvent.change(screen.getByLabelText('Search files'), { target: { value: '' } }); await flush()
  expect(sort().disabled).toBe(false); expect(sort().value).toBe('mtime')
  expect(rows()).toEqual(['f0002.txt', 'f0001.txt', 'f0000.txt'])
  expect(document.querySelector('[aria-live=polite]')?.textContent).toContain('Sorted by date modified')
})
it('picker selection survives sorting and its toolbar wraps', async () => {
  setup([entry('docs', true), entry('a.txt')], true); await flush()
  fireEvent.click(screen.getByLabelText('a.txt'))
  fireEvent.doubleClick(screen.getByText('docs')); await flush()
  change('mtime'); await flush()
  expect(screen.getByText('1 selected')).toBeTruthy()
  expect(sort().closest('label')?.parentElement?.style.flexWrap).toBe('wrap')
  fireEvent.click(screen.getByRole('button', { name: 'Home' })); await flush()
  expect((screen.getByLabelText('a.txt') as HTMLInputElement).checked).toBe(true)
})
it('shows the Date scan-limit note on the first truncated page', async () => {
  const b = setup(); await flush(); b.truncate(); change('mtime'); await flush()
  expect(rows()).toHaveLength(500)
  expect(screen.getByText('Date order covers the first 20,000 entries scanned.')).toBeTruthy()
  expect(screen.getByText('Load more')).toBeTruthy()
})
it('requires the Date echo on every page, including a later capped chunk', async () => {
  const b = setup(files(2001)); await flush(); change('mtime'); await flush(); b.missingPage()
  for (let i = 0; i < 4; i++) { fireEvent.click(screen.getByText('Load more')); await flush() }
  expect(b.calls.some(c => c.params.sort === 'mtime' && c.params.offset === '2000')).toBe(true)
  expect(sort().value).toBe('name'); expect(dateOption().disabled).toBe(true)
  expect(rows()).toHaveLength(500); expect(rows()[0]).toBe('f0000.txt')
}, 30_000)
it('live refresh still fetches Date keys with sort=mtime', async () => {
  const b = setup(files(3)); await flush(); change('mtime'); await flush()
  const start = b.calls.length
  vi.useFakeTimers()
  act(() => b.emitEvent({ type: 'tool.complete', connectionId: 'conn-1', profile: 'default', payload: { name: 'write_file' } }))
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  expect(b.calls.slice(start).filter(c => c.path === '/list').map(c => c.params.sort)).toEqual(['mtime'])
})
it.each(['normal', 'unavailable', 'roots-error', 'loading', 'unreachable', 'unknown-code'] as const)('safe diagnostics: %s', async state => {
  const backend = fakeBackend({
    ...(state === 'unavailable' ? { '/available': () => { throw new Error('404: /private/label') } } : {}),
    ...(state === 'unreachable' ? { '/available': () => { throw new Error('503: /private/label') } } : {}),
    ...(state === 'roots-error' || state === 'unknown-code' ? { '/roots': () => ({ ok: false, code: state === 'roots-error' ? 'protected' : '/private/label', message: ROOTS.roots[0].path }) } : {}),
    ...(state === 'loading' ? { '/available': () => new Promise(() => {}) } : {})
  })
  const copy = vi.fn(async (_text: string) => true)
  const context = createTestContext({ rest: backend.rest, writeClipboard: copy }); bindContext(context.ctx as any)
  $available.set(null)
  registerAvailabilityGate(context.ctx as any, available => $available.set(available))
  render(<CloudFilesPage />); await flush()
  fireEvent.click(screen.getByText('Copy diagnostics')); await flush()
  const unavailable = state === 'unavailable', unknown = state === 'loading' || state === 'unreachable'
  expect(copy).toHaveBeenCalledExactlyOnceWith([
    'Cloud Files desktop unknown', `Agent side: ${unavailable ? 'unavailable' : state === 'unreachable' ? 'unreachable' : state === 'loading' ? 'unknown' : '0.1.0'}`,
    `Google Drive: ${unknown ? 'unknown' : unavailable ? 'unavailable' : 'available'}`,
    `Sort by date: ${state === 'normal' ? 'supported' : 'unknown'}`,
    `Folders configured: ${state === 'normal' ? '1' : 'unknown'}`,
    `Last error: ${state === 'roots-error' ? 'protected' : state === 'unreachable' || state === 'unknown-code' ? 'other' : 'none'}`
  ].join('\n'))
  for (const forbidden of [ROOTS.roots[0].label, ROOTS.roots[0].path, 'conn-1', 'default', '/private/label']) expect(copy.mock.calls[0][0]).not.toContain(forbidden)
  act(() => context.dispose())
})
it.each([
  ['/uploads/chunk', 'no_space', false], ['/drive/import', 'protected', false],
  ['/drive/import', '/private/label', false], ['/uploads/chunk', 'no_space', true],
  ['/drive/import', null, true]
] as const)('rest diagnostics preserve the contract (%s, %s, thrown=%s)', async (path, code, thrown) => {
  const failure = thrown ? code ? new ApiError(code, '/private/message', { text: '/private/body' }) : new Error('/private/message')
    : { ok: false, code, message: '/private/message', text: '/private/body' }
  const backend = fakeBackend({ [path]: () => { if (thrown) throw failure; return failure } })
  const copy = vi.fn(async (_text: string) => true)
  bindContext(createTestContext({ rest: backend.rest, writeClipboard: copy }).ctx as any)
  render(<CloudFilesPage />); await flush()
  const request = rest(path, { method: 'POST' })
  if (thrown) await expect(request).rejects.toBe(failure)
  else await expect(request).resolves.toBe(failure)
  fireEvent.click(screen.getByText('Copy diagnostics')); await flush()
  expect(copy.mock.calls[0][0].split('\n').at(-1)).toBe(`Last error: ${code === 'no_space' || code === 'protected' ? code : 'other'}`)
  for (const secret of ['/private/label', '/private/message', '/private/body']) expect(copy.mock.calls[0][0]).not.toContain(secret)
})
it.each([false, true])('rest ignores late failures for another scope (thrown=%s)', async thrown => {
  let finish!: (value: unknown) => void
  bindContext(createTestContext({ rest: (() => new Promise(resolve => { finish = resolve })) as any }).ctx as any)
  const request = rest('/drive/import').catch(error => error)
  act(() => host.state.profile.set('B'))
  await act(async () => { finish(thrown ? Promise.reject(new Error('/private/message')) : { ok: false, code: 'no_space' }); await request })
  expect($scopeInfo.get()).toEqual({})
})
it('diagnostics never borrow A facts while B probes or after B answers late', async () => {
  let release: (value: unknown) => void = () => {}
  const backend = fakeBackend({ '/available': () => host.state.profile.get() === 'B' ? new Promise(resolve => { release = resolve }) : { version: '0.5.0' } })
  const copy = vi.fn(async (_text: string) => true)
  const context = createTestContext({ rest: backend.rest, writeClipboard: copy }); bindContext(context.ctx as any)
  registerAvailabilityGate(context.ctx as any, value => $available.set(value))
  render(<CloudFilesPage />); await flush()
  act(() => host.state.profile.set('B')); await flush()
  fireEvent.click(screen.getByText('Copy diagnostics')); await flush()
  expect(copy).toHaveBeenLastCalledWith('Cloud Files desktop unknown\nAgent side: unknown\nGoogle Drive: unknown\nSort by date: unknown\nFolders configured: unknown\nLast error: none')
  act(() => host.state.profile.set('default')); await flush()
  await act(async () => release({ version: '9.9.9' })); await flush()
  fireEvent.click(screen.getByText('Copy diagnostics')); await flush()
  expect(copy).toHaveBeenLastCalledWith('Cloud Files desktop unknown\nAgent side: 0.5.0\nGoogle Drive: available\nSort by date: supported\nFolders configured: 1\nLast error: none')
  act(() => context.dispose())
})
it.each([false, 'reject'])('diagnostics uses clipboard failure handling (%s)', async result => {
  const b = setup(files(1)); await flush()
  const notify = vi.spyOn(host, 'notify')
  vi.spyOn(b.ctx.os, 'writeClipboard').mockImplementation(async () => { if (result === 'reject') throw new Error('clipboard'); return false })
  fireEvent.click(screen.getByText('Copy diagnostics')); await flush()
  expect(notify).toHaveBeenCalledWith({ kind: 'error', message: "Couldn't copy to the clipboard" })
})
