import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { createTestContext, host, resetHost, resetQueryCache } from './sdk-mock'
import { fakeBackend } from './fake-backend'
import { bindContext } from '../api'
import { $hostClaim, $pickerOpen, cloudProvider, PickerHost } from '../picker'

const TICK = '`'

function open(insertText = vi.fn()) {
  act(() => void cloudProvider.run({ insertText }))
  return insertText
}

beforeEach(() => {
  resetQueryCache()
  resetHost()
  bindContext(createTestContext({ rest: fakeBackend().rest }).ctx as any)
})
afterEach(() => {
  $pickerOpen.set(false)
})

describe('+ → Cloud picker', () => {
  it('renders nothing until the provider opens it', () => {
    const { container } = render(<PickerHost />)
    expect(container.innerHTML).toBe('')
    expect(cloudProvider).toMatchObject({ label: 'Cloud', icon: 'cloud' })
  })

  it('inserts the locations of files picked across two folders, once', async () => {
    render(<PickerHost />)
    const insertText = open()
    expect(await screen.findByText('Attach from Cloud Files')).toBeTruthy()
    await screen.findByText('notes.txt')
    fireEvent.click(screen.getByLabelText('notes.txt'))
    fireEvent.click(screen.getByText('readme.md')) // a row click toggles in select mode
    fireEvent.doubleClick(screen.getByText('docs'))
    await screen.findByText('a.pdf')
    fireEvent.click(screen.getByLabelText('a.pdf'))
    expect(screen.getByText('3 selected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Insert locations' }))
    expect(insertText).toHaveBeenCalledTimes(1)
    expect(insertText).toHaveBeenCalledWith(
      `\nCloud files on the agent's machine:\n- ${TICK}/home/agent/notes.txt${TICK}\n- ${TICK}/home/agent/readme.md${TICK}\n- ${TICK}/home/agent/docs/a.pdf${TICK}`
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('lets folders be picked too (with a trailing slash)', async () => {
    render(<PickerHost />)
    const insertText = open()
    await screen.findByText('docs')
    fireEvent.click(screen.getByLabelText('docs'))
    fireEvent.click(screen.getByRole('button', { name: 'Insert locations' }))
    expect(insertText.mock.calls[0][0]).toContain(`- ${TICK}/home/agent/docs/${TICK}`)
  })

  it('warns instead of browsing when the focused chat belongs to another agent', async () => {
    host.state.focusedSessionOwner.set({ connectionId: 'conn-1', profile: 'research' })
    render(<PickerHost />)
    open()
    expect(
      await screen.findByText(
        "This chat belongs to research. Cloud Files is showing default's files — switch to research in the sidebar first."
      )
    ).toBeTruthy()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Insert locations' })).toBeNull()
  })

  it('warns when a local-owned chat (null connection) meets a selected remote agent (F6)', async () => {
    host.state.focusedSessionOwner.set({ connectionId: null, profile: 'default' })
    host.state.connectionId.set('conn-B')
    render(<PickerHost />)
    open()
    expect(await screen.findByText(/This chat belongs to default/)).toBeTruthy()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('renders one dialog however many composers are mounted, and hands over on unmount', async () => {
    const first = render(<PickerHost />)
    render(<PickerHost />)
    open()
    await screen.findByText('notes.txt')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    first.unmount()
    await screen.findByText('notes.txt')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect($hostClaim.get()).not.toBeNull()
  })
})

describe('+ → Cloud when the chat changes while it is open (fix round 3)', () => {
  function bindWithClipboard() {
    const t = createTestContext({ rest: fakeBackend().rest })
    bindContext(t.ctx as any)
    return vi.spyOn(t.ctx.os, 'writeClipboard')
  }

  it('R3: replaces Insert locations with Copy locations and inserts nothing', async () => {
    const copy = bindWithClipboard()
    render(<PickerHost />)
    const insertText = open()
    await screen.findByText('notes.txt')
    act(() => host.state.activeSessionId.set('session-2'))
    fireEvent.click(screen.getByLabelText('notes.txt'))
    expect(screen.queryByRole('button', { name: 'Insert locations' })).toBeNull()
    expect(screen.getByText("The chat changed while this was open, so the locations weren't inserted. Copy them instead.")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy locations' }))
    expect(copy).toHaveBeenCalledWith(`\nCloud files on the agent's machine:\n- ${TICK}/home/agent/notes.txt${TICK}`)
    expect(insertText).not.toHaveBeenCalled()
  })

  it('R3: stays touched after the chat returns to the same values', async () => {
    bindWithClipboard()
    render(<PickerHost />)
    const insertText = open()
    await screen.findByText('notes.txt')
    act(() => host.state.activeSessionId.set('session-2'))
    act(() => host.state.activeSessionId.set('session-1'))
    fireEvent.click(screen.getByLabelText('notes.txt'))
    expect(screen.queryByRole('button', { name: 'Insert locations' })).toBeNull()
    expect(insertText).not.toHaveBeenCalled()
  })

  it('R3: closing and reopening resets it', async () => {
    bindWithClipboard()
    render(<PickerHost />)
    open()
    await screen.findByText('notes.txt')
    act(() => host.state.activeSessionId.set('session-2'))
    expect(await screen.findByRole('button', { name: 'Copy locations' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const insertText = open()
    fireEvent.click(await screen.findByLabelText('notes.txt'))
    fireEvent.click(screen.getByRole('button', { name: 'Insert locations' }))
    expect(insertText).toHaveBeenCalledTimes(1)
  })

  it('R3: shows the copy-failed notice when the clipboard write rejects', async () => {
    const copy = bindWithClipboard()
    copy.mockRejectedValue(new Error('clipboard denied'))
    const notify = vi.spyOn(host, 'notify')
    render(<PickerHost />)
    open()
    await screen.findByText('notes.txt')
    act(() => host.state.activeSessionId.set('session-2'))
    fireEvent.click(screen.getByLabelText('notes.txt'))
    fireEvent.click(screen.getByRole('button', { name: 'Copy locations' }))
    await waitFor(() => expect(notify).toHaveBeenCalledWith({ kind: 'error', message: "Couldn't copy to the clipboard" }))
    notify.mockRestore()
  })
})
