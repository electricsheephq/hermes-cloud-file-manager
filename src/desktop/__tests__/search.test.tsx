import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { $available, $driveAvailable, bindContext, type SearchResponse } from '../api'
import { EntryList, useBrowser } from '../browser'
import { DriveList, useDriveBrowser } from '../drive-browser'
import { $batch, CloudFilesPage } from '../page'
import { cloudProvider, closePicker, PickerHost } from '../picker'
import { fakeBackend, ROOTS } from './fake-backend'
import { createTestContext, resetHost, resetQueryCache } from './sdk-mock'

const result = { name: 'match.txt', rel: 'docs/match.txt', abs: '/home/agent/docs/match.txt', is_dir: false, size: 1, mtime: 0 }
const stopped = `Search stopped after checking ${(12345).toLocaleString()} items, so some matches may be missing. Open a folder to search inside it.`
const search = () => fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'pdf' } })

function setup(response?: SearchResponse) {
  const backend = fakeBackend(response ? { '/search': () => response } : {})
  bindContext(createTestContext({ rest: backend.rest }).ctx as any)
  return backend
}

beforeEach(() => {
  resetQueryCache()
  resetHost()
  // these suites model an agent whose gateway answered /available
  $available.set(true)
  $driveAvailable.set(false)
  $batch.set(null)
})
afterEach(() => act(() => closePicker()))

it('sends the current subfolder from the page', async () => {
  const { calls } = setup()
  render(<CloudFilesPage />)
  fireEvent.doubleClick(await screen.findByText('docs'))
  await screen.findByText('a.pdf')
  search()
  await waitFor(() => expect(calls.find(c => c.path === '/search')?.params).toMatchObject({ path: 'docs', q: 'pdf' }))
})

it('keys cached searches by folder, including the empty root path', async () => {
  const { calls } = setup()
  function Browser() {
    const b = useBrowser(ROOTS as any, 'page')
    return <><button onClick={() => b.navigate('docs')}>Inside</button><button onClick={() => b.setSearch('txt')}>Search</button><EntryList b={b} /></>
  }
  render(<Browser />)
  fireEvent.click(screen.getByText('Search'))
  await screen.findByText('notes.txt')
  await waitFor(() => expect(calls.find(c => c.path === '/search')?.params.path).toBe(''))
  fireEvent.click(screen.getByText('Inside'))
  await screen.findByText('a.pdf')
  fireEvent.click(screen.getByText('Search'))
  await screen.findByText('No matching files')
  expect(calls.filter(c => c.path === '/search').map(c => c.params.path)).toEqual(['', 'docs'])
  expect(screen.queryByText('notes.txt')).toBeNull()
})

it('sends the current subfolder from the picker', async () => {
  const { calls } = setup()
  render(<PickerHost />)
  act(() => void cloudProvider.run({ insertText: vi.fn() }))
  fireEvent.doubleClick(await screen.findByText('docs'))
  await screen.findByText('a.pdf')
  search()
  await waitFor(() => expect(calls.find(c => c.path === '/search')?.params.path).toBe('docs'))
})

it.each([
  ['results', 'Showing the first match. Type more to narrow the search.'],
  ['time', stopped],
  ['visits', stopped],
  [undefined, 'Showing the first item'],
  [null, 'Showing the first item']
] as const)('shows truncation copy for reason %s', async (reason, copy) => {
  setup({ ok: true, results: [result], truncated: true, reason, visited: 12345 })
  render(<CloudFilesPage />)
  await screen.findByText('docs')
  search()
  expect(await screen.findByText(copy)).toBeTruthy()
})

it('uses the legacy plural for multiple matches', async () => {
  setup({ ok: true, results: [result, { ...result, name: 'other.txt', rel: 'other.txt', abs: '/home/agent/other.txt' }], truncated: true })
  render(<CloudFilesPage />)
  await screen.findByText('docs')
  search()
  expect(await screen.findByText('Showing the first 2 items')).toBeTruthy()
})

it.each(['time', 'visits'] as const)('explains an empty search stopped by %s', async reason => {
  setup({ ok: true, results: [], truncated: true, reason, visited: 12345 })
  render(<CloudFilesPage />)
  await screen.findByText('docs')
  search()
  expect(await screen.findByText('No matches found so far')).toBeTruthy()
  expect(screen.getByText(stopped)).toBeTruthy()
  expect(screen.queryByText('No matching files')).toBeNull()
})

it('words a search stopped before checking anything without a count', async () => {
  setup({ ok: true, results: [], truncated: true, reason: 'time', visited: 0 })
  render(<CloudFilesPage />)
  await screen.findByText('docs')
  search()
  expect(await screen.findByText('Search stopped early, so some matches may be missing. Open a folder to search inside it.')).toBeTruthy()
})

it('names the folder being searched below the root, keeping the field label', async () => {
  setup()
  render(<CloudFilesPage />)
  expect((await screen.findByLabelText('Search files')).getAttribute('placeholder')).toBe('Search files')
  fireEvent.doubleClick(await screen.findByText('docs'))
  await screen.findByText('a.pdf')
  expect(screen.getByLabelText('Search files').getAttribute('placeholder')).toBe('Search in docs')
})

it.each([
  [1, "1 folder couldn't be opened, so matches inside them may be missing."],
  [12345, `${(12345).toLocaleString()} folders couldn't be opened, so matches inside them may be missing.`]
] as const)('says when a complete search passed %s folders it could not open', async (skipped, copy) => {
  setup({ ok: true, results: [], truncated: false, reason: null, visited: 7, skipped })
  render(<CloudFilesPage />)
  await screen.findByText('docs')
  search()
  expect(await screen.findByText('No matching files')).toBeTruthy()
  expect(screen.getByText(copy)).toBeTruthy()
})

it('notes unopened folders under results too, but not when a cap or the limit already says matches are missing', async () => {
  setup({ ok: true, results: [result], truncated: false, reason: null, visited: 7, skipped: 2 })
  render(<CloudFilesPage />)
  await screen.findByText('docs')
  search()
  expect(await screen.findByText("2 folders couldn't be opened, so matches inside them may be missing.")).toBeTruthy()
  cleanup()
  resetQueryCache()
  setup({ ok: true, results: [], truncated: true, reason: 'time', visited: 12345, skipped: 2 })
  render(<CloudFilesPage />)
  await screen.findByText('docs')
  search()
  expect(await screen.findByText(stopped)).toBeTruthy()
  expect(screen.queryByText(/couldn't be opened/)).toBeNull()
})

it('keeps the plain empty state for an older gateway that capped an empty search without a reason', async () => {
  setup({ ok: true, results: [], truncated: true, visited: 12345, skipped: 3 })
  render(<CloudFilesPage />)
  await screen.findByText('docs')
  search()
  expect(await screen.findByText('No matching files')).toBeTruthy()
  expect(screen.queryByText(/Showing the first/)).toBeNull()
  expect(screen.queryByText(/couldn't be opened/)).toBeNull()
})

describe('the live region reads the search note after the count (#73)', () => {
  const live = () => document.querySelector('div[aria-live="polite"]:not([role])')?.textContent
  it.each<[string, SearchResponse, string]>([
    ['a complete search that passed folders it could not open', { ok: true, results: [], truncated: false, reason: null, visited: 7, skipped: 2 }, "0 results. 2 folders couldn't be opened, so matches inside them may be missing."],
    ['an empty search stopped by the time cap', { ok: true, results: [], truncated: true, reason: 'time', visited: 12345 }, `0 results. ${stopped}`],
    ['a search that hit the result limit', { ok: true, results: [result], truncated: true, reason: 'results', visited: 12345 }, '1 result. Showing the first match. Type more to narrow the search.'],
    ['an empty capped search from an older gateway (no note on screen, none read)', { ok: true, results: [], truncated: true, visited: 12345, skipped: 3 }, '0 results'],
    ['a complete search with nothing skipped', { ok: true, results: [result], truncated: false, reason: null, visited: 7 }, '1 result']
  ])('%s', async (_, response, text) => {
    setup(response)
    render(<CloudFilesPage />)
    await screen.findByText('docs')
    search()
    await waitFor(() => expect(live()).toBe(text))
  })
})

it('keeps the ordinary empty state for a complete search', async () => {
  setup({ ok: true, results: [], truncated: false, reason: null, visited: 7 })
  render(<CloudFilesPage />)
  await screen.findByText('docs')
  search()
  expect(await screen.findByText('No matching files')).toBeTruthy()
  expect(screen.queryByText('No matches found so far')).toBeNull()
})

it('the fake backend scopes descendants with a slash boundary and returns a reason', async () => {
  const { rest } = setup()
  expect(await rest('/search?q=pdf&path=docs')).toMatchObject({ reason: null, results: [expect.objectContaining({ rel: 'docs/a.pdf' }), expect.objectContaining({ rel: 'docs/b.pdf' })] })
  expect(await rest('/search?q=pdf&path=doc')).toMatchObject({ results: [] })
  expect(await rest('/search?q=docs&path=docs')).toMatchObject({ results: [] })
})

it('keeps the shared singular truncation copy in the Drive browser', async () => {
  const backend = fakeBackend({ '/drive/list': () => ({ ok: true, items: [{ id: 'one', name: 'Plan', is_folder: false, mime: 'text/plain', size: 1, mtime: null }], truncated: true }) })
  bindContext(createTestContext({ rest: backend.rest }).ctx as any)
  function DriveBrowser() {
    return <DriveList d={useDriveBrowser()} />
  }
  render(<DriveBrowser />)
  expect(await screen.findByText('Showing the first item')).toBeTruthy()
})
