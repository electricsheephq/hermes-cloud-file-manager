import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { createTestContext, host, resetHost, resetQueryCache } from './sdk-mock'
import { fakeBackend, importedEntry, ROOTS } from './fake-backend'
import { $available, $driveAvailable, bindContext } from '../api'
import { $driveJob } from '../drive'
import { shortDate } from '../format'
import { $batch, CloudFilesPage } from '../page'

function setup(overrides?: Parameters<typeof fakeBackend>[0], drive: boolean | null = true) {
  const backend = fakeBackend(overrides)
  bindContext(createTestContext({ rest: backend.rest }).ctx as any)
  act(() => $driveAvailable.set(drive))
  render(<CloudFilesPage />)
  return backend
}

const flush = async (rounds = 10) => {
  for (let i = 0; i < rounds; i++) await act(() => new Promise(resolve => setTimeout(resolve, 0)))
}
const option = (name: string) => screen.queryAllByRole('option').find(el => el.textContent === name)
const rows = () => screen.getAllByRole('listitem').map(row => row.getAttribute('data-entry'))
const imports = (calls: ReturnType<typeof fakeBackend>['calls']) => calls.filter(c => c.path === '/drive/import')

/** A /drive/import that answers only when the test releases it, one request at a time. */
function heldImports() {
  const held: Array<{ id: string; release: (reply?: unknown) => void }> = []
  const route = (opts: any) =>
    new Promise(resolve => held.push({ id: opts.body.id, release: reply => resolve(reply ?? { ok: true, entry: importedEntry(opts.body.id), renamed: false }) }))
  return { held, route }
}

async function openDrive() {
  await screen.findByText('notes.txt')
  fireEvent.click(option('Google Drive')!)
  await screen.findByText('report.pdf')
}

beforeEach(() => {
  resetQueryCache()
  resetHost()
  $available.set(null)
  $batch.set(null)
  $driveJob.set(null)
})

describe('Cloud Files page: Google Drive source', () => {
  it('offers Google Drive in the root selector only when Drive is available, even with one cloud root', async () => {
    setup(undefined, false)
    await screen.findByText('notes.txt')
    expect(option('Google Drive')).toBeUndefined()
    expect(screen.queryAllByRole('option')).toHaveLength(0) // one root and no Drive: no selector at all
    act(() => $driveAvailable.set(true))
    expect(screen.getAllByRole('option').map(el => el.textContent)).toEqual(['Home', 'Google Drive'])
  })

  it('lists the cloud roots first, then Google Drive', async () => {
    const two = { ...ROOTS, roots: [...ROOTS.roots, { id: 'work', label: 'Work', path: '/work' }] }
    setup({ '/roots': () => two })
    await screen.findByText('notes.txt')
    expect(screen.getAllByRole('option').map(el => el.textContent)).toEqual(['Home', 'Work', 'Google Drive'])
  })

  it('lists Drive folders and files with a dash for a null size and a date from ISO', async () => {
    const { calls } = setup()
    await openDrive()
    expect(rows()).toEqual(['fold1', 'doc1', 'pdf1'])
    expect(calls.find(c => c.path === '/drive/list')?.params).toEqual({ folder: 'root' })
    const doc = screen.getByText('Plan').closest('[role=listitem]') as HTMLElement
    expect(within(doc).getByText('—')).toBeTruthy()
    expect(within(doc).getByText(shortDate(Date.parse('2024-03-04T10:00:00Z') / 1000))).toBeTruthy()
    const pdf = screen.getByText('report.pdf').closest('[role=listitem]') as HTMLElement
    expect(within(pdf).getByText('2.0 KB')).toBeTruthy()
    expect(doc.querySelector('[data-codicon]')?.getAttribute('data-codicon')).toBe('file-text')
    expect(pdf.querySelector('[data-codicon]')?.getAttribute('data-codicon')).toBe('file-pdf')
    expect(screen.getByRole('navigation').textContent).toContain('Google Drive')
  })

  it('opens a folder with a click (folder=<id>) and returns through the breadcrumbs', async () => {
    const { calls } = setup()
    await openDrive()
    fireEvent.click(screen.getByText('Projects'))
    await screen.findByText('Budget')
    expect(calls.some(c => c.path === '/drive/list' && c.params.folder === 'fold1')).toBe(true)
    expect(within(screen.getByRole('navigation')).getByText('Projects')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Google Drive' }))
    await screen.findByText('report.pdf')
  })

  it('searches Drive with q', async () => {
    const { calls } = setup()
    await openDrive()
    fireEvent.change(screen.getByLabelText('Search Google Drive'), { target: { value: 'bud' } })
    await screen.findByText('Budget', undefined, { timeout: 2000 })
    expect(calls.find(c => c.path === '/drive/list' && c.params.q)?.params).toMatchObject({ q: 'bud' })
  })

  it('shows the truncated hint', async () => {
    setup({ '/drive/list': () => ({ ok: true, items: [{ id: 'x1', name: 'x.txt', mime: 'text/plain', is_folder: false, size: 1, mtime: null }], truncated: true }) })
    await screen.findByText('notes.txt')
    fireEvent.click(option('Google Drive')!)
    expect(await screen.findByText('Showing the first 1 items')).toBeTruthy()
  })

  it('hides upload and new folder and ignores drops in Drive mode', async () => {
    const { calls } = setup()
    await screen.findByText('notes.txt')
    expect(screen.getByRole('button', { name: 'Upload files' })).toBeTruthy()
    fireEvent.click(option('Google Drive')!)
    await screen.findByText('report.pdf')
    for (const name of ['Upload files', 'Upload folder', 'New folder']) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.getByText('Imports go to Home/uploads/drive')).toBeTruthy()
    const file = new File(['hello'], 'a.txt')
    const dataTransfer = { types: ['Files'], items: [{ kind: 'file', webkitGetAsEntry: () => ({ name: 'a.txt', isFile: true, isDirectory: false, file: (ok: (f: File) => void) => ok(file) }) }], files: [file] }
    const page = screen.getByText('Cloud Files').closest('section')!
    fireEvent.dragEnter(page, { dataTransfer })
    expect(screen.queryByText(/Drop to upload/)).toBeNull()
    fireEvent.drop(page, { dataTransfer })
    await flush()
    expect(calls.some(c => c.path.startsWith('/uploads'))).toBe(false)
    expect($batch.get()).toBeNull()
  })

  it('switches back to the cloud root when Drive becomes unavailable', async () => {
    setup()
    await openDrive()
    act(() => $driveAvailable.set(false))
    await screen.findByText('notes.txt')
    expect(screen.queryByRole('button', { name: 'Upload files' })).toBeTruthy()
  })
})

describe('Cloud Files page: Import to Cloud Files', () => {
  it('imports the selection one file at a time with {id, root, dest} and a long timeout', async () => {
    const { held, route } = heldImports()
    const { calls } = setup({ '/drive/import': route })
    await openDrive()
    const button = screen.getByRole('button', { name: 'Import to Cloud Files' })
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByText('report.pdf'))
    fireEvent.click(screen.getByText('Projects'))
    await screen.findByText('Budget')
    fireEvent.click(screen.getByLabelText('Budget')) // the selection is kept across folders
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 to Cloud Files' }))
    await flush()
    expect(imports(calls)).toHaveLength(1)
    expect(imports(calls)[0].opts).toMatchObject({ method: 'POST', body: { id: 'pdf1', root: 'home', dest: 'uploads/drive' } })
    expect(imports(calls)[0].opts.timeoutMs).toBeGreaterThanOrEqual(330_000)
    expect(screen.getByText('Importing 1 of 2…')).toBeTruthy()
    held[0].release()
    await flush()
    expect(imports(calls).map(c => c.opts.body.id)).toEqual(['pdf1', 'sheet1'])
    expect(screen.getByText('Importing 2 of 2…')).toBeTruthy()
    held[1].release()
    expect(await screen.findByText('Imported 2 files')).toBeTruthy()
  })

  it('U1: labels the import button with the number of selected files, kept across folders', async () => {
    setup()
    await openDrive()
    expect(screen.getByRole('button', { name: 'Import to Cloud Files' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByText('report.pdf'))
    expect(screen.getByRole('button', { name: 'Import 1 to Cloud Files' }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByText('Projects'))
    await screen.findByText('Budget')
    fireEvent.click(screen.getByText('Budget'))
    expect(screen.getByRole('button', { name: 'Import 2 to Cloud Files' })).toBeTruthy()
    fireEvent.click(screen.getByText('Budget'))
    expect(screen.getByRole('button', { name: 'Import 1 to Cloud Files' })).toBeTruthy()
    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Google Drive' }))
    await screen.findByText('report.pdf')
    fireEvent.click(screen.getByText('report.pdf'))
    expect(screen.getByRole('button', { name: 'Import to Cloud Files' }).hasAttribute('disabled')).toBe(true)
  })

  it('lists failures with their code text', async () => {
    const { calls } = setup({
      '/drive/import': (opts: any) =>
        opts.body.id === 'doc1' ? { ok: false, code: 'drive_error', message: 'The Drive operation failed.' } : { ok: true, entry: importedEntry(opts.body.id), renamed: false }
    })
    await openDrive()
    fireEvent.click(screen.getByText('Plan'))
    fireEvent.click(screen.getByText('report.pdf'))
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 to Cloud Files' }))
    expect(await screen.findByText('Imported 1 file')).toBeTruthy()
    expect(screen.getByText("Plan: Google Drive couldn't finish that. Try again.")).toBeTruthy()
    expect(imports(calls)).toHaveLength(2)
  })

  it('Show switches to the first cloud root at uploads/drive', async () => {
    const { calls } = setup()
    await openDrive()
    fireEvent.click(screen.getByText('report.pdf'))
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 to Cloud Files' }))
    await screen.findByText('Imported 1 file')
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    await waitFor(() => expect(calls.some(c => c.path === '/list' && c.params.root === 'home' && c.params.path === 'uploads/drive')).toBe(true))
    expect(screen.getByRole('button', { name: 'Upload files' })).toBeTruthy()
    expect(within(screen.getByRole('navigation')).getByText('drive')).toBeTruthy()
  })

  it('stops before the next request when the agent changes mid-batch, and finishes after switching back', async () => {
    const { held, route } = heldImports()
    const { calls } = setup({ '/drive/import': route })
    await openDrive()
    fireEvent.click(screen.getByText('Plan'))
    fireEvent.click(screen.getByText('report.pdf'))
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 to Cloud Files' }))
    await flush()
    act(() => host.state.profile.set('other'))
    held[0].release()
    await flush()
    expect(imports(calls)).toHaveLength(1)
    expect(await screen.findByText('Switch back to default to finish importing')).toBeTruthy()
    act(() => host.state.profile.set('default'))
    await flush()
    expect(imports(calls).map(c => [c.opts.body.id, c.profile])).toEqual([
      ['doc1', 'default'],
      ['pdf1', 'default']
    ])
    held[1].release()
    expect(await screen.findByText('Imported 2 files')).toBeTruthy()
  })

  it('cancels a paused import from another agent, so it no longer blocks imports there', async () => {
    const { held, route } = heldImports()
    const { calls } = setup({ '/drive/import': route })
    await openDrive()
    fireEvent.click(screen.getByText('Plan'))
    fireEvent.click(screen.getByText('report.pdf'))
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 to Cloud Files' }))
    await flush()
    act(() => host.state.profile.set('other'))
    held[0].release()
    await flush()
    expect(await screen.findByText('Switch back to default to finish importing')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await flush()
    // The other agent's page is no longer blocked: the canceled import is not running, so its status bar is gone.
    expect(screen.queryByText('Switch back to default to finish importing')).toBeNull()
    act(() => host.state.profile.set('default'))
    await flush()
    expect(await screen.findByText('Import canceled after 1 file')).toBeTruthy()
    expect(imports(calls)).toHaveLength(1)
  })
})
