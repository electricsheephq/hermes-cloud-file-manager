import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AskAgent, buildRefs } from '../chat'
import plugin, { PAGE_PATH } from '../plugin'
import { S } from '../strings'
import { createTestContext, host, resetHost } from './sdk-mock'

const pin = { connectionId: 'conn-1', profile: 'default' }
const file = { abs: '/files/report.txt', is_dir: false }
const folder = { abs: '/files/archive', is_dir: true }
const outside = { ...file, abs: '/outside/link', link_outside: true }
const invalid = { ...file, abs: '/files/line\nbreak' }
const insertText = vi.fn()
beforeEach(() => {
  resetHost()
  insertText.mockReset().mockResolvedValue(true)
  host.composer = { insertText }
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const choose = async (label: string) => {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: label })) })
}

it.each([undefined, {}])('renders nothing without composer.insertText: %j', composer => {
  host.composer = composer as typeof host.composer
  expect(render(<AskAgent entries={() => [file]} pin={pin} />).container.innerHTML).toBe('')
})

it.each([[[], true], [[file], false], [[file, folder], true], [[outside], true]] as const)(
  'sets Rename eligibility for %j', (entries, disabled) => {
    render(<AskAgent entries={() => entries} pin={pin} />)
    expect(screen.getByRole('button', { name: S.askRename }).hasAttribute('disabled')).toBe(disabled)
  }
)

it('disables the Ask agent trigger when requested', () => {
  render(<AskAgent entries={() => []} pin={pin} disabled />)
  expect(screen.getByRole('button', { name: S.askAgent }).hasAttribute('disabled')).toBe(true)
})

it.each([
  [S.askRename, [file], 'Please rename @file:/files/report.txt to '],
  [S.askMove, [file, folder, outside, invalid], 'Please move @file:/files/report.txt @folder:/files/archive to the folder '],
  [S.askDelete, [file, folder, outside, invalid], "Please delete @file:/files/report.txt @folder:/files/archive. List what you'll delete and wait for my OK first."]
] as const)('drafts exact %s text, omitting outside links and warning on bad paths', async (label, entries, text) => {
  const notify = vi.spyOn(host, 'notify')
  render(<AskAgent entries={() => entries} pin={pin} sessionId="session-7" />)
  await choose(label)
  expect(insertText.mock.calls).toEqual([['session-7', text, { mode: 'inline' }]])
  expect(notify.mock.calls).toEqual([
    ...(label === S.askRename ? [] : [[{ kind: 'warning', message: S.refSkipped(1) }]]),
    [{ kind: 'success', message: S.askDrafted }]
  ])
})

it.each(['owner', 'profile', 'connection'] as const)('blocks a live %s mismatch', async mismatch => {
  const notify = vi.spyOn(host, 'notify')
  render(<AskAgent entries={() => [file]} pin={pin} />)
  if (mismatch === 'owner') host.state.focusedSessionOwner.set({ ...pin, profile: 'other' })
  if (mismatch === 'profile') host.state.profile.set('other')
  if (mismatch === 'connection') host.state.connectionId.set('conn-2')
  await choose(S.askMove)
  expect(insertText).not.toHaveBeenCalled()
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'warning' }))
})

it.each(['false', 'reject', 'throw'])('reports an unavailable chat on insert %s', async result => {
  const notify = vi.spyOn(host, 'notify')
  insertText.mockImplementation(() => {
    if (result === 'throw') throw new Error('unavailable')
    return result === 'reject' ? Promise.reject(new Error('unavailable')) : Promise.resolve(false)
  })
  render(<AskAgent entries={() => [file]} pin={pin} />)
  await choose(S.askMove)
  expect(insertText).toHaveBeenCalledWith(null, 'Please move @file:/files/report.txt to the folder ', { mode: 'inline' })
  expect(notify).toHaveBeenCalledWith({ kind: 'info', message: S.openChatFirst })
})

it.each([{ entries: [] }, { entries: [outside] }, { entries: [invalid] }])('does not insert when no usable refs remain: %j', async ({ entries }) => {
  const notify = vi.spyOn(host, 'notify')
  render(<AskAgent entries={() => entries} pin={pin} />)
  await choose(S.askDelete)
  expect(insertText).not.toHaveBeenCalled()
  expect(notify.mock.calls).toEqual(entries.includes(invalid) ? [[{ kind: 'warning', message: S.refSkipped(1) }]] : [])
})

it('builds the existing Add to chat refs, preserving quoting, order and skipped counts', () => {
  expect(buildRefs([file, folder, outside, invalid, { ...file, abs: '/files/all`"\'quotes' }, { ...file, abs: '/files/a b' }])).toEqual({
    refs: ['@file:/files/report.txt', '@folder:/files/archive', '@file:`/files/a b`'], skipped: 2
  })
})

it('registers Open Cloud Files in the palette and navigates to the page', async () => {
  const context = createTestContext()
  const navigate = vi.spyOn(host, 'navigate')
  try {
    await plugin.register(context.ctx as any)
    const row = context.live.get('open-cloud-files')
    expect(row).toMatchObject({ area: 'palette', data: { id: 'open-cloud-files', label: 'Open Cloud Files', keywords: ['files', 'cloud', 'upload', 'download', 'server'] } })
    row.data.run()
    expect(navigate).toHaveBeenCalledWith(PAGE_PATH)
  } finally { context.dispose() }
})
