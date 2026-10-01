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
      `\nCloud files on default's machine:\n- ${TICK}/home/agent/notes.txt${TICK}\n- ${TICK}/home/agent/readme.md${TICK}\n- ${TICK}/home/agent/docs/a.pdf${TICK}`
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
