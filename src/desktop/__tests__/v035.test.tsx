// v0.3.5 (#39, #37): keyboard focus, announcements, the no_roots state, picker and Drive details, host tokens,
// and the upload drawer paths the audit found untested (hidden inputs, Retry, gone, Cancel, Clear).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { createTestContext, host, resetHost, resetQueryCache } from './sdk-mock'
import { fakeBackend, ROOTS } from './fake-backend'
import { $available, $driveAvailable, bindContext } from '../api'
import { SETTINGS_PATH } from '../browser'
import { $driveJob } from '../drive'
import { $drafts } from '../editor'
import { $batch, CloudFilesPage } from '../page'
import { $pickerOpen, cloudProvider, PickerHost } from '../picker'

function setup(overrides?: Parameters<typeof fakeBackend>[0]) {
  const backend = fakeBackend(overrides)
  const t = createTestContext({ rest: backend.rest })
  bindContext(t.ctx as any)
  const view = render(<CloudFilesPage />)
  return { ...backend, ctx: t.ctx, view }
}

const flush = async (rounds = 10) => {
  for (let i = 0; i < rounds; i++) await act(() => new Promise(resolve => setTimeout(resolve, 0)))
}
const rowOf = (name: string) => screen.getByText(name).closest('[role=listitem]') as HTMLElement
const focusedEntry = () => document.activeElement?.getAttribute('data-entry')
const fileInputs = (container: HTMLElement) => [...container.querySelectorAll<HTMLInputElement>('input[type=file]')]
const NO_ROOTS = {
  ...ROOTS,
  roots: [],
  code: 'no_roots',
  reason: "None of the folders in Cloud Files settings can be shown on this machine. Check the paths in the plugin's settings."
}
const UPLOADS = {
  '/uploads/start': (opts: any) => ({ ok: true, upload_id: `u:${opts.body.path}`, chunk_bytes: 4 * 1024 * 1024, max_file_bytes: 1e9 }),
  '/uploads/chunk': (opts: any) => ({ ok: true, size: opts.body.offset + atob(opts.body.data).length }),
  '/uploads/finish': (opts: any) => ({ ok: true, renamed: false, entry: { name: opts.body.path, rel: opts.body.path } }),
  '/uploads/abort': () => ({ ok: true })
}

/** Pick files through the hidden "Upload files" input (index 0) or "Upload folder" input (index 1). */
function pick(container: HTMLElement, files: File[], index = 0) {
  const input = fileInputs(container)[index]
  Object.defineProperty(input, 'files', { configurable: true, value: files })
  fireEvent.change(input)
  return input
}

beforeEach(() => {
  resetQueryCache()
  resetHost()
  $available.set(null)
  $batch.set(null)
  $drafts.set(new Map())
  $driveJob.set(null)
  $driveAvailable.set(null)
})
afterEach(() => {
  $pickerOpen.set(false)
  vi.restoreAllMocks()
})

describe('D1 visible keyboard focus', () => {
  it('a focused file row gets the hover background and an inset accent ring', async () => {
    setup()
    await screen.findByText('docs')
    const row = rowOf('notes.txt')
    expect(row.getAttribute('style')).not.toContain('box-shadow')
    fireEvent.focus(row)
    expect(row.getAttribute('style')).toContain('box-shadow: inset 0 0 0 1px var(--ui-accent, currentColor)')
    expect(row.getAttribute('style')).toContain('var(--ui-row-hover-background)')
    fireEvent.blur(row)
    expect(row.getAttribute('style')).not.toContain('box-shadow')
  })

  it('a focused Drive row gets the same ring', async () => {
    setup()
    act(() => $driveAvailable.set(true))
    await screen.findByText('notes.txt')
    fireEvent.click(screen.getAllByRole('option').find(el => el.textContent === 'Google Drive')!)
    await screen.findByText('report.pdf')
    const row = rowOf('report.pdf')
    fireEvent.focus(row)
    expect(row.getAttribute('style')).toContain('box-shadow: inset 0 0 0 1px')
  })
})

describe('D2 focus follows keyboard navigation', () => {
  it('Enter on a folder focuses the first row of the opened folder', async () => {
    setup()
    await screen.findByText('docs')
    rowOf('docs').focus()
    fireEvent.keyDown(rowOf('docs'), { key: 'Enter' })
    await screen.findByText('a.pdf')
    await waitFor(() => expect(focusedEntry()).toBe('docs/a.pdf'))
  })

  it('Enter on an empty folder focuses the list itself', async () => {
    setup()
    await screen.findByText('zeta')
    fireEvent.keyDown(rowOf('zeta'), { key: 'Enter' })
    await screen.findByText('This folder is empty — drop files here or use Upload')
    await waitFor(() => expect(document.activeElement?.getAttribute('tabindex')).toBe('-1'))
    expect(document.activeElement?.textContent).toContain('This folder is empty')
  })

  it('a keyboard breadcrumb click focuses the first row; a mouse click leaves focus alone', async () => {
    setup()
    await screen.findByText('docs')
    fireEvent.keyDown(rowOf('docs'), { key: 'Enter' })
    await screen.findByText('a.pdf')
    fireEvent.click(screen.getByRole('button', { name: 'Home' }), { detail: 1 }) // mouse
    await screen.findByText('notes.txt')
    await flush()
    expect(focusedEntry()).not.toBe('docs')
    fireEvent.keyDown(rowOf('docs'), { key: 'Enter' })
    await screen.findByText('a.pdf')
    fireEvent.click(screen.getByRole('button', { name: 'Home' }), { detail: 0 }) // Enter/Space on the button
    await screen.findByText('notes.txt')
    await waitFor(() => expect(focusedEntry()).toBe('docs')) // highlighted folders sort first
  })

  it('closing the editor focuses the row of the file that was open', async () => {
    setup()
    fireEvent.doubleClick(await screen.findByText('readme.md'))
    await screen.findByRole('button', { name: 'Edit' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await screen.findByText('notes.txt')
    await waitFor(() => expect(focusedEntry()).toBe('readme.md'))
  })

  it('Enter on a Drive folder focuses its first row', async () => {
    setup()
    act(() => $driveAvailable.set(true))
    await screen.findByText('notes.txt')
    fireEvent.click(screen.getAllByRole('option').find(el => el.textContent === 'Google Drive')!)
    await screen.findByText('Projects')
    fireEvent.keyDown(rowOf('Projects'), { key: 'Enter' })
    await screen.findByText('Budget')
    await waitFor(() => expect(focusedEntry()).toBe('sheet1'))
  })
})

describe('D3 announcements', () => {
  it('the drawer headline is a polite status and both progress bars are labelled', async () => {
    let release!: () => void
    const { view } = setup({ ...UPLOADS, '/uploads/chunk': (opts: any) => new Promise(resolve => (release = () => resolve(UPLOADS['/uploads/chunk'](opts)))) })
    await screen.findByText('docs')
    pick(view.container, [new File(['hello'], 'a.txt')])
    const drawer = await screen.findByRole('region', { name: 'Uploads' })
    await waitFor(() => expect(screen.queryAllByRole('progressbar')).toHaveLength(2))
    expect(screen.getAllByRole('progressbar').map(bar => bar.getAttribute('aria-label'))).toEqual(['Upload progress', 'Upload progress for a.txt'])
    const status = within(drawer).getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toMatch(/^Uploading 1 of 1/)
    release()
    await waitFor(() => expect(status.textContent).toBe('Uploaded 1 of 1'))
  })

  it('a New folder error is an alert tied to the input', async () => {
    setup()
    await screen.findByText('docs')
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }))
    const input = screen.getByLabelText('Folder name')
    expect(input.getAttribute('aria-invalid')).toBe('false')
    fireEvent.change(input, { target: { value: 'a/b' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('A folder name cannot contain /')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe(alert.id)
  })

  it('a Review save error is an alert, and Saved is a polite status', async () => {
    let refuse = true
    setup({ '/file/save': (opts: any) => (refuse ? { ok: false, code: 'permission_denied', message: 'denied' } : { ok: true, sha256: 'new', size: opts.body.text.length }) })
    fireEvent.doubleClick(await screen.findByText('notes.txt'))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(document.querySelector('textarea')!, { target: { value: 'changed\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review & save' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe("The agent's user isn't allowed to open or change this.")
    refuse = false
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }))
    const saved = await screen.findByText('Saved')
    expect(saved.getAttribute('role')).toBe('status')
    expect(saved.getAttribute('aria-live')).toBe('polite')
  })

  it("the picker's selection count is a polite status", async () => {
    bindContext(createTestContext({ rest: fakeBackend().rest }).ctx as any)
    render(<PickerHost />)
    act(() => void cloudProvider.run({ insertText: vi.fn() }))
    await screen.findByText('notes.txt')
    fireEvent.click(screen.getByLabelText('notes.txt'))
    const status = screen.getByText('1 selected')
    expect(status.getAttribute('role')).toBe('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
  })
})

describe('D5 an all-invalid roots setting', () => {
  it('the page explains it and Open settings goes to the plugin settings', async () => {
    const navigate = vi.spyOn(host, 'navigate')
    setup({ '/roots': () => NO_ROOTS })
    expect(await screen.findByText('Cloud Files has no folder to show')).toBeTruthy()
    expect(screen.getByText(NO_ROOTS.reason)).toBeTruthy()
    expect(screen.queryByText("Cloud Files can't browse this agent's machine")).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
    expect(navigate).toHaveBeenCalledWith('/settings?tab=plugins&agent=hermes-cloud-file-manager&plugin=hermes-cloud-file-manager')
    expect(SETTINGS_PATH).toBe('/settings?tab=plugins&agent=hermes-cloud-file-manager&plugin=hermes-cloud-file-manager')
  })

  it('the picker shows the same state and closes when Open settings is pressed', async () => {
    const navigate = vi.spyOn(host, 'navigate')
    bindContext(createTestContext({ rest: fakeBackend({ '/roots': () => NO_ROOTS }).rest }).ctx as any)
    render(<PickerHost />)
    act(() => void cloudProvider.run({ insertText: vi.fn() }))
    expect(await screen.findByText('Cloud Files has no folder to show')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
    expect(navigate).toHaveBeenCalledWith(SETTINGS_PATH)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('D6 / D7 picker and Drive details', () => {
  it("the picker's empty folder does not suggest uploading", async () => {
    bindContext(createTestContext({ rest: fakeBackend().rest }).ctx as any)
    render(<PickerHost />)
    act(() => void cloudProvider.run({ insertText: vi.fn() }))
    fireEvent.doubleClick(await screen.findByText('zeta'))
    expect(await screen.findByText('This folder is empty')).toBeTruthy()
    expect(screen.queryByText(/drop files here/)).toBeNull()
  })

  it('Drive shows the size column only when some item has a size', async () => {
    setup()
    act(() => $driveAvailable.set(true))
    await screen.findByText('notes.txt')
    fireEvent.click(screen.getAllByRole('option').find(el => el.textContent === 'Google Drive')!)
    await screen.findByText('report.pdf')
    expect(screen.getByText('—')).toBeTruthy() // Plan has no size, report.pdf has one: the column is there
    fireEvent.keyDown(rowOf('Projects'), { key: 'Enter' })
    await screen.findByText('Budget') // a Sheet: no size anywhere in this folder
    expect(screen.queryByText('—')).toBeNull()
    expect(rowOf('Budget').children).toHaveLength(4)
    expect(rowOf('Budget').style.gridTemplateColumns).toBe('16px 16px minmax(0, 1fr) 96px')
  })
})

describe('D9 host tokens', () => {
  it('the editor uses only tokens the host defines, each with a fallback', async () => {
    const fs = await import('node:fs' as string)
    const source: string = fs.readFileSync('src/desktop/editor.tsx', 'utf8') // vitest runs from the repo root
    expect(source).not.toMatch(/--ui-warning-|--ui-font-mono/)
    expect(source).toContain("var(--font-mono, ui-monospace, monospace)")
    expect(source).toMatch(/var\(--ui-yellow, [^)]+\)/)
  })
})

describe('D11 upload drawer paths', () => {
  it('"Upload files" opens the hidden input, and its change uploads the picked files', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined)
    const { view, calls } = setup(UPLOADS)
    await screen.findByText('docs')
    fireEvent.click(screen.getByRole('button', { name: 'Upload files' }))
    expect(click.mock.contexts[0]).toBe(fileInputs(view.container)[0])
    const input = pick(view.container, [new File(['hello'], 'a.txt'), new File(['hi'], 'b.txt')])
    expect(await screen.findByText('Uploaded 2 of 2')).toBeTruthy()
    expect(calls.filter(c => c.path === '/uploads/start').map(c => c.opts.body)).toEqual([
      { root: 'home', path: 'a.txt', size: 5 },
      { root: 'home', path: 'b.txt', size: 2 }
    ])
    expect(input.value).toBe('')
  })

  it('"Upload folder" keeps the paths under the picked folder', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined)
    const { view, calls } = setup(UPLOADS)
    await screen.findByText('docs')
    fireEvent.click(screen.getByRole('button', { name: 'Upload folder' }))
    expect(click.mock.contexts[0]).toBe(fileInputs(view.container)[1])
    expect(fileInputs(view.container)[1].hasAttribute('webkitdirectory')).toBe(true)
    const file = new File(['x'], 'x.png')
    Object.defineProperty(file, 'webkitRelativePath', { value: 'pics/x.png' })
    pick(view.container, [file], 1)
    expect(await screen.findByText('Uploaded 1 of 1')).toBeTruthy()
    expect(calls.find(c => c.path === '/uploads/start')?.opts.body).toEqual({ root: 'home', path: 'pics/x.png', size: 1 })
  })

  it('Retry after a failed chunk sends the file again', async () => {
    let failures = 1
    const { view, calls } = setup({ ...UPLOADS, '/uploads/chunk': (opts: any) => (failures-- > 0 ? { ok: false, code: 'no_space', message: 'ENOSPC' } : UPLOADS['/uploads/chunk'](opts)) })
    await screen.findByText('docs')
    pick(view.container, [new File(['hello'], 'a.txt')])
    expect(await screen.findByText("Failed: The agent's machine is out of disk space.")).toBeTruthy()
    expect(screen.getByText('Uploaded 0 of 1 · 1 failed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Uploaded 1 of 1')).toBeTruthy()
    expect(calls.filter(c => c.path === '/uploads/chunk').map(c => c.opts.body.data)).toEqual([btoa('hello'), btoa('hello')])
  })

  it('a server `gone` restarts the upload once and it finishes', async () => {
    let gone = true
    const { view, calls } = setup({ ...UPLOADS, '/uploads/finish': (opts: any) => (gone ? ((gone = false), { ok: false, code: 'gone' }) : UPLOADS['/uploads/finish'](opts)) })
    await screen.findByText('docs')
    pick(view.container, [new File(['hello'], 'a.txt')])
    expect(await screen.findByText('Uploaded 1 of 1')).toBeTruthy()
    expect(calls.filter(c => c.path === '/uploads/start')).toHaveLength(2)
    expect(calls.filter(c => c.path === '/uploads/chunk').map(c => c.opts.body.offset)).toEqual([0, 0])
  })

  it('Cancel stops the batch and aborts the upload on the server; Clear removes the drawer', async () => {
    let settle!: (reply: unknown) => void
    const { view, calls } = setup({ ...UPLOADS, '/uploads/chunk': () => new Promise(resolve => (settle = resolve)) })
    await screen.findByText('docs')
    pick(view.container, [new File(['hello'], 'a.txt')])
    const drawer = await screen.findByRole('region', { name: 'Uploads' })
    await waitFor(() => expect(calls.some(c => c.path === '/uploads/chunk')).toBe(true))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(within(drawer).getByRole('status').textContent).toBe('Upload canceled'))
    expect(calls.find(c => c.path === '/uploads/abort')?.opts.body).toEqual({ upload_id: 'u:a.txt', root: 'home', path: 'a.txt' })
    expect(within(drawer).getByText('Canceled')).toBeTruthy()
    settle({ ok: true, size: 5 }) // the request in flight settles; nothing more is sent
    await waitFor(() => expect(within(drawer).getByRole('button', { name: 'Clear' })).toBeTruthy())
    expect(calls.some(c => c.path === '/uploads/finish')).toBe(false)
    fireEvent.click(within(drawer).getByRole('button', { name: 'Clear' }))
    expect(screen.queryByRole('region', { name: 'Uploads' })).toBeNull()
    expect($batch.get()).toBeNull()
  })
})
