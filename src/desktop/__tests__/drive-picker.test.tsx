import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { createTestContext, host, resetHost, resetQueryCache } from './sdk-mock'
import { fakeBackend, importedEntry } from './fake-backend'
import { bindContext } from '../api'
import { formatInsertText } from '../format'
import { $pickerOpen, cloudProvider, driveProvider, PickerHost } from '../picker'

const TICK = '`'
const flush = async (rounds = 10) => {
  for (let i = 0; i < rounds; i++) await act(() => new Promise(resolve => setTimeout(resolve, 0)))
}

function setup(overrides?: Parameters<typeof fakeBackend>[0]) {
  const backend = fakeBackend(overrides)
  bindContext(createTestContext({ rest: backend.rest }).ctx as any)
  render(<PickerHost />)
  return backend
}

function openDrive(insertText = vi.fn()) {
  act(() => void driveProvider.run({ insertText }))
  return insertText
}

const imports = (calls: ReturnType<typeof fakeBackend>['calls']) => calls.filter(c => c.path === '/drive/import')

/** Pick report.pdf at the root and Budget inside Projects. */
async function pickTwo() {
  await screen.findByText('report.pdf')
  fireEvent.click(screen.getByText('report.pdf'))
  fireEvent.click(screen.getByText('Projects'))
  await screen.findByText('Budget')
  fireEvent.click(screen.getByText('Budget'))
  expect(screen.getByText('2 selected')).toBeTruthy()
}

beforeEach(() => {
  resetQueryCache()
  resetHost()
})
afterEach(() => {
  act(() => $pickerOpen.set(false))
})

describe('+ → Google Drive picker', () => {
  it('is a Google Drive provider with the cloud-download codicon', () => {
    expect(driveProvider).toMatchObject({ label: 'Google Drive', icon: 'cloud-download' })
  })

  it('imports the picked files and inserts exactly formatInsertText(profile, entries)', async () => {
    const { calls } = setup()
    const insertText = openDrive()
    expect(await screen.findByText('Insert from Google Drive')).toBeTruthy()
    await pickTwo()
    fireEvent.click(screen.getByRole('button', { name: 'Import and insert' }))
    await waitFor(() => expect(insertText).toHaveBeenCalledTimes(1))
    expect(insertText).toHaveBeenCalledWith(formatInsertText('default', [importedEntry('pdf1'), importedEntry('sheet1')]))
    expect(insertText.mock.calls[0][0]).toContain(`- ${TICK}/home/agent/uploads/drive/report.pdf${TICK}`)
    expect(imports(calls).map(c => c.opts.body)).toEqual([
      { id: 'pdf1', root: 'home', dest: 'uploads/drive' },
      { id: 'sheet1', root: 'home', dest: 'uploads/drive' }
    ])
    expect(imports(calls).every(c => c.opts.timeoutMs >= 330_000)).toBe(true)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('inserts the successes and stays open listing the failures when some imports fail', async () => {
    setup({ '/drive/import': (opts: any) => (opts.body.id === 'sheet1' ? { ok: false, code: 'timeout', message: 'timed out' } : { ok: true, entry: importedEntry(opts.body.id), renamed: false }) })
    const insertText = openDrive()
    await pickTwo()
    fireEvent.click(screen.getByRole('button', { name: 'Import and insert' }))
    expect(await screen.findByText('Budget: Google Drive took too long. Try again.')).toBeTruthy()
    expect(insertText).toHaveBeenCalledTimes(1)
    expect(insertText).toHaveBeenCalledWith(formatInsertText('default', [importedEntry('pdf1')]))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('inserts nothing when every import fails', async () => {
    setup({ '/drive/import': () => ({ ok: false, code: 'is_folder', message: 'folder' }) })
    const insertText = openDrive()
    await pickTwo()
    fireEvent.click(screen.getByRole('button', { name: 'Import and insert' }))
    expect(await screen.findByText('report.pdf: Choose files, not folders.')).toBeTruthy()
    expect(screen.getByText('Budget: Choose files, not folders.')).toBeTruthy()
    expect(insertText).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('shows the owner mismatch and makes no Drive calls', async () => {
    host.state.focusedSessionOwner.set({ connectionId: 'conn-1', profile: 'research' })
    const { calls } = setup()
    openDrive()
    expect(await screen.findByText('Insert from Google Drive')).toBeTruthy()
    expect(await screen.findByText(/This chat belongs to research/)).toBeTruthy()
    await flush()
    expect(calls.filter(c => c.path.startsWith('/drive'))).toEqual([])
    expect(screen.queryByRole('button', { name: 'Import and insert' })).toBeNull()
  })

  it('makes no further requests after closing mid-import and inserts nothing', async () => {
    const held: Array<() => void> = []
    const { calls } = setup({
      '/drive/import': (opts: any) => new Promise(resolve => held.push(() => resolve({ ok: true, entry: importedEntry(opts.body.id), renamed: false })))
    })
    const insertText = openDrive()
    await pickTwo()
    fireEvent.click(screen.getByRole('button', { name: 'Import and insert' }))
    await flush()
    expect(screen.getByText('Importing 1 of 2…')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    held[0]()
    await flush()
    expect(imports(calls)).toHaveLength(1)
    expect(insertText).not.toHaveBeenCalled()
  })
})

describe('+ → Cloud is unchanged', () => {
  it('still opens the Cloud picker and inserts the same text after a Drive pick was opened and closed', async () => {
    setup()
    openDrive()
    await screen.findByText('Insert from Google Drive')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const insertText = vi.fn()
    act(() => void cloudProvider.run({ insertText }))
    expect(await screen.findByText('Attach from Cloud Files')).toBeTruthy()
    fireEvent.click(await screen.findByLabelText('notes.txt'))
    fireEvent.click(screen.getByRole('button', { name: 'Insert locations' }))
    expect(insertText).toHaveBeenCalledWith(`\nCloud files on the agent's machine:\n- ${TICK}/home/agent/notes.txt${TICK}`)
  })
})
