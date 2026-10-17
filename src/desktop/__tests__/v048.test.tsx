// Desktop follow-ups: transient previews, shared refresh lifetime/cache expiry, selection and safe drags.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createTestContext, host, resetHost, resetQueryCache, useQueryClient } from './sdk-mock'
import { fakeBackend } from './fake-backend'
import { $available, $driveAvailable, bindContext } from '../api'
import { $drafts } from '../editor'
import { $batch, CloudFilesPage } from '../page'
import { closePicker, cloudProvider, PickerHost } from '../picker'
import { TRANSIENT_PREVIEW_CODES } from '../preview'
import { LIST_CACHE_FOLLOWUP_MS } from '../browser'
import { formatRef } from '../format'
import { S } from '../strings'

const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve() }) }
const advance = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms) }); await flush() }
const file = (rel: string) => ({ name: rel.split('/').pop()!, rel, abs: `/home/agent/${rel}`, is_dir: false, size: 1, mtime: 0 })
const listing = (entries: ReturnType<typeof file>[], extra = {}) => ({ ok: true, entries, total: entries.length, truncated: false, ...extra })
const row = (name: string) => screen.getByText(name).closest('[role=option]') as HTMLElement
const event = () => ({ type: 'tool.complete', profile: 'default', connectionId: 'conn-1', payload: { name: 'write_file' } })
const lists = (backend: ReturnType<typeof fakeBackend>) => backend.calls.filter(c => c.path === '/list').length
function page(overrides: Parameters<typeof fakeBackend>[0] = {}) {
  const backend = fakeBackend(overrides)
  const context = createTestContext({ rest: backend.rest })
  const subscribe = vi.fn(context.ctx.onEvent!)
  context.ctx.onEvent = subscribe
  bindContext(context.ctx as any)
  return { ...backend, ...context, subscribe, view: render(<CloudFilesPage />) }
}
beforeEach(() => {
  vi.useFakeTimers(); resetQueryCache(); resetHost()
  host.composer = { insertText: vi.fn(async () => true) }
  $available.set(true); $driveAvailable.set(null); $batch.set(null); $drafts.set(new Map())
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
})
afterEach(() => { act(closePicker); cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

it.each(['changed', 'io_error', 'too_large', 'not_text', 'protected', 'unknown', '404'])('preview retry policy: %s', async code => {
  let attempts = 0
  const backend = page({ '/list': () => listing([file('data.json')]), '/file/preview': () => {
    if (++attempts > 1) return { ok: true, kind: 'text', text: 'retried', size: 7 }
    if (code === '404') throw new Error('404: not found')
    return { ok: false, code }
  } })
  await flush(); fireEvent.doubleClick(row('data.json')); await flush()
  if (['changed', 'io_error'].includes(code)) {
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(TRANSIENT_PREVIEW_CODES.has(code)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await flush()
    expect(screen.getByText('retried')).toBeTruthy()
    expect(backend.calls.filter(c => c.path === '/file/preview')).toHaveLength(2)
  } else expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
})

it.each(['preview', 'editor', 'drive'])('keeps refresh alive while %s replaces the list, refetching on return', async mode => {
  const backend = page({ '/list': () => listing([file('data.json'), file('notes.txt')]) })
  await flush()
  if (mode === 'drive') {
    act(() => $driveAvailable.set(true))
    fireEvent.click(screen.getAllByRole('option').find(el => el.closest('[data-select]') && el.textContent === 'Google Drive')!)
  } else fireEvent.doubleClick(row(mode === 'preview' ? 'data.json' : 'notes.txt'))
  await flush()
  const start = lists(backend)
  act(() => backend.emitEvent(event())); await advance(1000)
  expect(lists(backend)).toBe(start) // inactive queries are stale, not fetched
  if (mode === 'drive') fireEvent.click(screen.getAllByRole('option').find(el => el.closest('[data-select]') && el.textContent === 'Home')!)
  else fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  await flush(); expect(lists(backend)).toBe(start + 1)
})

it('shares one subscription/request with the picker, retains the page holder and finally disposes', async () => {
  const backend = page(); await flush()
  const picker = render(<PickerHost />)
  act(() => void cloudProvider.run({ insertText: vi.fn() })); await flush()
  expect(backend.subscribe).toHaveBeenCalledTimes(1)
  expect(backend.listeners.get('tool.complete')?.size).toBe(1)
  const start = lists(backend)
  act(() => backend.emitEvent(event())); await advance(1000)
  expect(lists(backend)).toBe(start + 1)
  picker.unmount(); expect(backend.eventDisposals()).toBe(0)
  act(() => backend.emitEvent(event())); await advance(1000)
  expect(lists(backend)).toBe(start + 2)
  backend.view.unmount(); expect(backend.eventDisposals()).toBe(1)
  expect(backend.listeners.get('tool.complete')?.size).toBe(0)
  await advance(5500); expect(lists(backend)).toBe(start + 2)
})

it.each([false, true])('follows up after 5.5 s, replacing pending follow-up on another event: %s', async twice => {
  const backend = page(); await flush()
  const start = lists(backend)
  act(() => backend.emitEvent(event())); await advance(1000)
  if (twice) { act(() => backend.emitEvent(event())); await advance(1000) }
  await advance(5499); expect(lists(backend)).toBe(start + (twice ? 2 : 1))
  await advance(1); expect(lists(backend)).toBe(start + (twice ? 3 : 2))
  await advance(5500); expect(lists(backend)).toBe(start + (twice ? 3 : 2))
  expect(LIST_CACHE_FOLLOWUP_MS).toBe(5500)
})

it('defers a hidden follow-up, does not follow up visibility/manual refreshes, and clears timers on dispose', async () => {
  const backend = page(); await flush()
  const start = lists(backend)
  act(() => backend.emitEvent(event())); await advance(1000)
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  await advance(5500); expect(lists(backend)).toBe(start + 1)
  visibility.mockReturnValue('visible'); fireEvent(document, new Event('visibilitychange')); await flush()
  expect(lists(backend)).toBe(start + 2)
  await advance(5500); expect(lists(backend)).toBe(start + 2)
  await act(async () => { await useQueryClient().invalidateQueries({ queryKey: ['hcfm', 'conn-1', 'default', 'list'] }) })
  await advance(5500); expect(lists(backend)).toBe(start + 3)
  act(() => backend.emitEvent(event())); await advance(1000)
  backend.view.unmount(); await advance(5500)
  expect(lists(backend)).toBe(start + 4)
})

it('follow-up invalidates list only, leaving active search alone', async () => {
  const backend = page(); await flush()
  fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'notes' } }); await advance(300)
  act(() => backend.emitEvent(event())); await advance(1000)
  const start = backend.calls.length
  await advance(5500); expect(backend.calls).toHaveLength(start)
  fireEvent.change(screen.getByLabelText('Search files'), { target: { value: '' } }); await flush()
  expect(backend.calls.slice(start).map(c => c.path)).toEqual(['/list'])
})

it.each(['complete', 'partial', 'truncated', 'search'])('prunes a gone selection only from a complete non-search listing: %s', async mode => {
  let gone = false
  const backend = page({ '/list': () => listing(gone ? [] : [file('notes.txt')], {
    total: mode === 'partial' ? 600 : gone ? 0 : 1, truncated: mode === 'truncated'
  }), '/search': () => ({ ok: true, results: [], truncated: false }) })
  await flush(); fireEvent.click(row('notes.txt'))
  const add = () => screen.getByRole('button', { name: 'Add to chat' }) as HTMLButtonElement
  expect(add().disabled).toBe(false)
  if (mode === 'search') {
    fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'other' } }); await advance(300)
  }
  gone = true; act(() => backend.emitEvent(event())); await advance(1000)
  expect(add().disabled).toBe(mode === 'complete')
})

it('keeps a picker selection from another folder while pruning the current folder', async () => {
  const backend = page(); backend.view.unmount()
  const picker = render(<PickerHost />)
  act(() => void cloudProvider.run({ insertText: vi.fn() })); await flush()
  fireEvent.click(row('notes.txt')); fireEvent.doubleClick(row('docs')); await flush()
  fireEvent.click(row('a.pdf'))
  const original = backend.ctx.rest
  backend.ctx.rest = async (path, opts) => path.startsWith('/list?') ? listing([]) : original(path, opts)
  act(() => backend.emitEvent(event())); await advance(1000)
  expect(within(screen.getByRole('dialog')).getByText('1 selected')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Insert locations' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  picker.unmount()
})

it.each([true, false])('filters ambiguous drags; cancels when all are ambiguous: %s', async all => {
  const names = ['question?', 'report:12', 'notes;', 'report:12-20', 'line\nbreak', 'all`"\'quotes']
  const entries = names.map(file).concat(all ? [] : [file('ordinary.txt')])
  page({ '/list': () => listing(entries) }); await flush()
  for (const entry of entries) fireEvent.click(screen.getByLabelText(entry.name, { normalizer: value => value }))
  const notify = vi.spyOn(host, 'notify')
  const dataTransfer = { effectAllowed: 'uninitialized', setData: vi.fn() }
  expect(fireEvent.dragStart(row('question?'), { dataTransfer })).toBe(!all)
  expect(notify).toHaveBeenCalledExactlyOnceWith({ kind: 'warning', message: S.dragSkipped(names.length) })
  expect(dataTransfer.setData.mock.calls).toEqual(all ? [] : [
    ['application/x-hermes-paths', '[{"isDirectory":false,"path":"/home/agent/ordinary.txt"}]'],
    ['text/plain', '/home/agent/ordinary.txt']
  ])
})

it.each<[string, string | null]>([
  ['/home/a.txt', '/home/a.txt'], ['/home/a b', '`/home/a b`'], ['/home/a`b', '"/home/a`b"'],
  ['/home/(paren)', '`/home/(paren)`'], ['/home/a`"\'b', null], ['/home/a\nb', null], ['/home/a\rb', null],
  ['/home/a`"b', "'/home/a`\"b'"], ['/work/a:b', '/work/a:b'],
  ...[',', '.', ';', '!', '?', ':12', ':12-20'].map(end => [`/home/a${end}`, '`/home/a' + end + '`'] as [string, string])
])('keeps formatRef byte-identical for %s', (path, expected) => expect(formatRef(path)).toBe(expected))
