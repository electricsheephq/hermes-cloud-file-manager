import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { $available, $driveAvailable, bindContext, type SearchResponse } from '../api'
import { EntryList, useBrowser } from '../browser'
import { DriveList, useDriveBrowser } from '../drive-browser'
import { $batch, CloudFilesPage } from '../page'
import { cloudProvider, closePicker, PickerHost } from '../picker'
import { fakeBackend, ROOTS } from './fake-backend'
import { createTestContext, resetHost, resetQueryCache } from './sdk-mock'

const result = { name: 'match.txt', rel: 'docs/match.txt', abs: '/home/agent/docs/match.txt', is_dir: false, size: 1, mtime: 0 }
const stopped = 'Search stopped after checking 12,345 items, so some matches may be missing. Open a folder to search inside it.'
const search = () => fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'pdf' } })

function setup(response?: SearchResponse) {
  const backend = fakeBackend(response ? { '/search': () => response } : {})
  bindContext(createTestContext({ rest: backend.rest }).ctx as any)
  return backend
}

beforeEach(() => {
  resetQueryCache()
  resetHost()
  $available.set(null)
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
  ['results', 'Showing the first 1 matches. Type more to narrow the search.'],
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
