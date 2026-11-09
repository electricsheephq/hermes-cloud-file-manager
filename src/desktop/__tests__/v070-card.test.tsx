import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { $available, $driveAvailable, $unreachable, bindContext, PAGE_PATH } from '../api'
import { $reveal, FileCard, REVEAL_TTL_MS } from '../card'
import { CloudFilesPage } from '../page'
import { S } from '../strings'
import { fakeBackend } from './fake-backend'
import { createTestContext, host, resetHost, resetQueryCache, setDownloadCapture } from './sdk-mock'

const README = { name: 'readme.md', rel: 'readme.md', abs: '/home/agent/readme.md', is_dir: false, size: 33, mtime: 1767225600, link_outside: false }
const located = (entry = README) => ({ ok: true, root: 'home', root_label: 'Home', root_path: '/home/agent', entry })

function setup(locate: (opts?: any) => any = () => located()) {
  const backend = fakeBackend({ '/locate': locate })
  bindContext(createTestContext({ rest: backend.rest }).ctx as any)
  const insertText = vi.fn().mockResolvedValue(true)
  host.composer = { insertText }
  return { backend, insertText, locates: () => backend.calls.filter(c => c.path === '/locate') }
}
const card = (path: string, extra: Partial<{ streaming: boolean; sessionId: null | string }> = {}) =>
  <FileCard attrs={{ path }} source={`::cloud-file{path="${path}"}`} streaming={false} sessionId="session-1" {...extra} />

beforeEach(() => {
  resetHost()
  resetQueryCache()
  setDownloadCapture(undefined)
  $available.set(true)
  $driveAvailable.set(false)
  $unreachable.set(null)
  $reveal.set(null)
})
afterEach(() => cleanup())

it('leaves an invalid path as the directive text and asks nothing', () => {
  const h = setup()
  render(card('relative/readme.md'))
  expect(screen.getByText('::cloud-file{path="relative/readme.md"}')).toBeTruthy()
  expect(h.locates()).toHaveLength(0)
})

it('waits for the message to finish streaming, then locates the path once', async () => {
  const h = setup()
  const view = render(card('/home/agent/readme.md', { streaming: true }))
  expect(screen.getByText('readme.md')).toBeTruthy()
  expect(h.locates()).toHaveLength(0)
  view.rerender(card('/home/agent/readme.md'))
  expect(await screen.findByRole('button', { name: S.open })).toBeTruthy()
  expect(h.locates().map(c => c.params.path)).toEqual(['/home/agent/readme.md'])
})

it('shows the file with Open, Preview, Download and Add to chat; Add to chat lands in this chat', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  setDownloadCapture(() => save)
  const h = setup()
  render(card('/home/agent/readme.md'))
  expect(await screen.findByText(/in Home/)).toBeTruthy()
  for (const name of [S.open, S.cardPreview, S.download, S.addToChat]) expect(screen.getByRole('button', { name })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: S.download }))
  expect(save).toHaveBeenCalledWith('/home/agent/readme.md', 'readme.md')
  fireEvent.click(screen.getByRole('button', { name: S.addToChat }))
  await waitFor(() => expect(h.insertText).toHaveBeenCalledWith('session-1', '@file:/home/agent/readme.md', { mode: 'inline' }))
})

it('a folder card offers Open and Add to chat only', async () => {
  setup(() => located({ ...README, name: 'docs', rel: 'docs', abs: '/home/agent/docs', is_dir: true, size: null as any }))
  render(card('/home/agent/docs'))
  expect(await screen.findByRole('button', { name: S.open })).toBeTruthy()
  expect(screen.queryByRole('button', { name: S.cardPreview })).toBeNull()
  expect(screen.queryByRole('button', { name: S.download })).toBeNull()
})

it.each([
  [{ ok: false, code: 'outside_root', message: 'x' }, S.cardOutside],
  [{ ok: false, code: 'not_found', message: 'x' }, S.cardGone]
])('explains a refused path (%o)', async (reply, text) => {
  setup(() => reply)
  render(card('/etc/passwd'))
  expect(await screen.findByText(text)).toBeTruthy()
  expect(screen.queryByRole('button', { name: S.open })).toBeNull()
})

it('asks for an update when the gateway half has no /locate yet', async () => {
  setup(() => { throw new Error('Error invoking remote method: Error: 404: {"detail":"Not Found"}') })
  render(card('/home/agent/readme.md'))
  expect(await screen.findByText(S.cardUpdate)).toBeTruthy()
})

it("does not look up another agent's file", () => {
  const h = setup()
  host.state.focusedSessionOwner.set({ connectionId: 'conn-1', profile: 'other' })
  render(card('/home/agent/readme.md'))
  expect(screen.getByText(S.cardOtherAgent('other'))).toBeTruthy()
  expect(h.locates()).toHaveLength(0)
})

it('Open and Preview hand the page a reveal and go to Cloud Files', async () => {
  setup()
  const navigate = vi.spyOn(host, 'navigate')
  render(card('/home/agent/readme.md'))
  fireEvent.click(await screen.findByRole('button', { name: S.cardPreview }))
  expect($reveal.get()).toMatchObject({ root: 'home', rootPath: '/home/agent', preview: true, pin: { connectionId: 'conn-1', profile: 'default' } })
  expect(navigate).toHaveBeenCalledWith(PAGE_PATH)
})

it('the page takes a Preview reveal once and opens the file', async () => {
  setup()
  $reveal.set({ pin: { connectionId: 'conn-1', profile: 'default' }, root: 'home', rootPath: '/home/agent', entry: README, preview: true, at: Date.now() })
  render(<CloudFilesPage />)
  expect(await screen.findByRole('button', { name: 'Edit' })).toBeTruthy()
  expect(screen.getAllByText(/Hello from the agent/).length).toBeGreaterThan(0)
  expect($reveal.get()).toBeNull()
})

it('the page ignores a stale reveal, and warns about one for another agent or a changed root', async () => {
  setup()
  const notify = vi.spyOn(host, 'notify')
  $reveal.set({ pin: { connectionId: 'conn-1', profile: 'default' }, root: 'home', rootPath: '/home/agent', entry: README, preview: true, at: Date.now() - REVEAL_TTL_MS - 1 })
  render(<CloudFilesPage />)
  expect(await screen.findByText('notes.txt')).toBeTruthy()
  expect(screen.queryByText('Hello from the agent.')).toBeNull()
  act(() => $reveal.set({ pin: { connectionId: 'conn-1', profile: 'other' }, root: 'home', rootPath: '/home/agent', entry: README, preview: true, at: Date.now() }))
  await waitFor(() => expect(notify).toHaveBeenCalledWith({ kind: 'warning', message: S.cardOtherAgent('other') }))
  act(() => $reveal.set({ pin: { connectionId: 'conn-1', profile: 'default' }, root: 'home', rootPath: '/elsewhere', entry: README, preview: true, at: Date.now() }))
  await waitFor(() => expect(notify).toHaveBeenCalledWith({ kind: 'warning', message: S.cardFolderChanged }))
  expect(screen.queryByText('Hello from the agent.')).toBeNull()
})

it('a card in a chat that is not the focused one does not look the file up', async () => {
  const h = setup()
  host.state.activeSessionId.set('another-session')
  render(card('/home/agent/readme.md'))
  expect(screen.getByText(S.cardFocusChat)).toBeTruthy()
  expect(h.locates()).toHaveLength(0)
  act(() => host.state.activeSessionId.set('session-1'))
  expect(await screen.findByRole('button', { name: S.open })).toBeTruthy()
})
