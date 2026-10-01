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
  const { ctx } = createTestContext({ rest: backend.rest })
  bindContext(ctx as any)
  render(<PickerHost />)
  return { ...backend, ctx }
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

describe('+ → Google Drive picker: the chat changes while it is open (fix rounds 1-3)', () => {
  /** /drive/import requests that answer only when the test releases them. */
  function held(fail: string[] = []) {
    const pending: Array<() => void> = []
    const route = (opts: any) =>
      new Promise(resolve =>
        pending.push(() =>
          resolve(fail.includes(opts.body.id) ? { ok: false, code: 'drive_error', message: 'x' } : { ok: true, entry: importedEntry(opts.body.id), renamed: false })
        )
      )
    return { pending, route }
  }
  const switchTo = (profile: string) =>
    act(() => {
      host.state.profile.set(profile)
      host.state.focusedSessionOwner.set({ connectionId: 'conn-1', profile })
    })

  /** Start an import of report.pdf + Budget and leave the final request in flight. */
  async function finalImportPending(fail: string[] = []) {
    const { pending, route } = held(fail)
    const backend = setup({ '/drive/import': route })
    const copy = vi.spyOn(backend.ctx.os, 'writeClipboard')
    const insertText = openDrive()
    await pickTwo()
    fireEvent.click(screen.getByRole('button', { name: 'Import and insert' }))
    await flush()
    pending[0]()
    await flush()
    expect(pending).toHaveLength(2)
    return { ...backend, copy, insertText, finish: async () => (pending[1](), await flush()) }
  }
  const BOTH = () => formatInsertText('default', [importedEntry('pdf1'), importedEntry('sheet1')])
  const IMPORTED_TO = "These files were imported to default's uploads/drive."

  it('R3: an untouched open inserts exactly once on completion (immediate-subscribe atoms)', async () => {
    const { insertText, copy, finish } = await finalImportPending()
    await finish()
    expect(insertText).toHaveBeenCalledTimes(1)
    expect(insertText).toHaveBeenCalledWith(BOTH())
    expect(copy).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('R3: the two-composer case (focused chat moves away and back) inserts nothing and offers Copy locations', async () => {
    const { insertText, copy, finish } = await finalImportPending()
    act(() => {
      host.state.activeSessionId.set('session-2')
      host.state.focusedSessionOwner.set({ connectionId: 'conn-1', profile: 'default' })
    })
    act(() => host.state.activeSessionId.set('session-1'))
    await finish()
    expect(insertText).not.toHaveBeenCalled()
    expect(screen.getByText(IMPORTED_TO)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Insert' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Copy locations' }))
    expect(copy).toHaveBeenCalledTimes(1)
    expect(copy).toHaveBeenCalledWith(BOTH())
    expect(insertText).not.toHaveBeenCalled()
  })

  it('R3: touched, then switched back to the identical snapshot, still inserts nothing', async () => {
    const { insertText, finish } = await finalImportPending()
    switchTo('agent-b')
    switchTo('default')
    await finish()
    expect(insertText).not.toHaveBeenCalled()
    expect(screen.getByText(IMPORTED_TO)).toBeTruthy()
    act(() => host.state.activeSessionId.set('session-1'))
    await flush()
    expect(insertText).not.toHaveBeenCalled()
  })

  it('R3: a mismatch at completion inserts nothing, and switching back alone inserts nothing', async () => {
    const { insertText, finish } = await finalImportPending()
    switchTo('agent-b')
    await finish()
    expect(insertText).not.toHaveBeenCalled()
    expect(screen.getByText(IMPORTED_TO)).toBeTruthy()
    switchTo('default')
    await flush()
    expect(insertText).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('R3: a partial failure while touched lists the failures and copies the successes only', async () => {
    const { insertText, copy, finish } = await finalImportPending(['sheet1'])
    act(() => host.state.activeSessionId.set('session-2'))
    await finish()
    expect(insertText).not.toHaveBeenCalled()
    expect(screen.getByText("Budget: Google Drive couldn't finish that. Try again.")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy locations' }))
    expect(copy).toHaveBeenCalledWith(formatInsertText('default', [importedEntry('pdf1')]))
  })

  it('R3: closing after a change inserts nothing', async () => {
    const { insertText, finish } = await finalImportPending()
    switchTo('agent-b')
    await finish()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    switchTo('default')
    await flush()
    expect(insertText).not.toHaveBeenCalled()
  })

  it('P4: pauses imports while the focused chat belongs to another agent, and resumes after (then offers Copy)', async () => {
    const { pending, route } = held()
    const { calls } = setup({ '/drive/import': route })
    const insertText = openDrive()
    await pickTwo()
    fireEvent.click(screen.getByRole('button', { name: 'Import and insert' }))
    await flush()
    act(() => host.state.focusedSessionOwner.set({ connectionId: 'conn-1', profile: 'research' }))
    pending[0]()
    await flush()
    expect(imports(calls)).toHaveLength(1)
    expect(screen.getByText(/This chat belongs to research/)).toBeTruthy()
    act(() => host.state.focusedSessionOwner.set({ connectionId: 'conn-1', profile: 'default' }))
    await flush()
    expect(imports(calls)).toHaveLength(2)
    pending[1]()
    await flush()
    expect(insertText).not.toHaveBeenCalled() // the focused chat changed while open: copy, never insert
    expect(screen.getByRole('button', { name: 'Copy locations' })).toBeTruthy()
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
