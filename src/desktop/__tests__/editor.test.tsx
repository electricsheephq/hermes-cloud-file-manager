import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'

import { createTestContext, host, resetHost, resetQueryCache } from './sdk-mock'
import { fakeBackend, fakeSha, TEXTS } from './fake-backend'
import { $available, bindContext } from '../api'
import { $drafts, type Doc, Editor } from '../editor'
import { $batch, CloudFilesPage } from '../page'

const entry = (rel: string, is_dir = false) => ({
  name: rel,
  rel,
  abs: `/home/agent/${rel}`,
  is_dir,
  size: is_dir ? 0 : 100,
  mtime: 1767225600,
  link_outside: false
})
const ENTRIES = [entry('docs', true), entry('readme.md'), entry('notes.txt'), entry('other.md'), entry('script.py'), entry('crlf.md')]
const list = () => ({ ok: true, entries: ENTRIES, total: ENTRIES.length, truncated: false })

function setup(overrides: Parameters<typeof fakeBackend>[0] = {}, texts = TEXTS) {
  const backend = fakeBackend({ '/list': list, ...overrides }, texts)
  const t = createTestContext({ rest: backend.rest })
  bindContext(t.ctx as any)
  const view = render(<CloudFilesPage />)
  return { ...backend, ctx: t.ctx, view, saves: () => backend.calls.filter(c => c.path === '/file/save') }
}

const flush = async (rounds = 10) => {
  for (let i = 0; i < rounds; i++) await act(() => new Promise(resolve => setTimeout(resolve, 0)))
}
const textarea = () => document.querySelector('textarea')
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement
const dialog = () => screen.getByRole('dialog')
/** The props React rendered on a DOM node: lets a test call a handler captured before a re-render. */
const reactProps = (node: Element): any => Object.entries(node).find(([key]) => key.startsWith('__reactProps'))![1]

/** Open `name` from the list (double-click) and wait for its View. */
async function openFile(name: string) {
  fireEvent.doubleClick(await screen.findByText(name))
  await screen.findByRole('button', { name: 'Edit' })
  await waitFor(() => expect(button('Edit').disabled).toBe(false))
}
/** Open, press Edit and type `text` as the whole draft. */
async function editTo(name: string, text: string) {
  await openFile(name)
  fireEvent.click(button('Edit'))
  fireEvent.change(textarea()!, { target: { value: text } })
}

beforeEach(() => {
  resetQueryCache()
  resetHost()
  $available.set(null)
  $batch.set(null)
  $drafts.set(new Map())
})

describe('editor: View and Edit', () => {
  it('opens a .md in the rendered View, with no textarea until Edit is pressed', async () => {
    const { calls } = setup()
    await openFile('readme.md')
    expect(calls.find(c => c.path === '/file')?.params).toEqual({ root: 'home', path: 'readme.md' })
    expect(screen.getByTestId('md').textContent).toBe(TEXTS['readme.md'])
    expect(textarea()).toBeNull()
    expect(screen.getByText('/home/agent/readme.md')).toBeTruthy()
    fireEvent.click(button('Edit'))
    expect(textarea()?.value).toBe(TEXTS['readme.md'])
    expect(screen.getByText('Editing')).toBeTruthy()
  })

  it('insets the rendered Markdown so list markers stay inside the text column', async () => {
    setup()
    await openFile('readme.md')
    expect((screen.getByTestId('md').parentElement as HTMLElement).style.paddingLeft).toBe('24px')
  })

  it('shows a .txt as preformatted text, and opens a selected file with the Open button', async () => {
    setup()
    fireEvent.click(await screen.findByText('notes.txt'))
    fireEvent.click(button('Open'))
    await waitFor(() => expect(document.querySelector('pre')?.textContent).toBe(TEXTS['notes.txt']))
    expect(screen.queryByTestId('md')).toBeNull()
  })

  it('does nothing on a .py double-click (no /file call)', async () => {
    const { calls } = setup()
    fireEvent.doubleClick(await screen.findByText('script.py'))
    fireEvent.click(screen.getByText('script.py'))
    await flush()
    expect(calls.some(c => c.path === '/file')).toBe(false)
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull()
    expect(screen.getByText('readme.md')).toBeTruthy()
  })

  it('enables Review & save only while the text differs', async () => {
    setup()
    await openFile('readme.md')
    fireEvent.click(button('Edit'))
    expect(button('Review & save').disabled).toBe(true)
    fireEvent.change(textarea()!, { target: { value: 'changed' } })
    expect(button('Review & save').disabled).toBe(false)
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    fireEvent.change(textarea()!, { target: { value: TEXTS['readme.md'] } })
    expect(button('Review & save').disabled).toBe(true)
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })

  it('maps a load error code to a plain sentence', async () => {
    setup({ '/file': () => ({ ok: false, code: 'too_large', max_bytes: 1024 * 1024 }) })
    fireEvent.doubleClick(await screen.findByText('readme.md'))
    expect(await screen.findByText('Too large to open here (over 1 MB).')).toBeTruthy()
    expect(button('Edit').disabled).toBe(true)
  })

  it('maps bad_path to a sentence and an unknown code to the server message', async () => {
    const answers = [{ ok: false, code: 'bad_path' }, { ok: false, code: 'brand_new', message: 'Server says no' }]
    setup({ '/file': () => answers.shift() })
    fireEvent.doubleClick(await screen.findByText('readme.md'))
    expect(await screen.findByText('That path isn’t allowed.')).toBeTruthy()
    fireEvent.click(button('Close'))
    fireEvent.doubleClick(await screen.findByText('other.md'))
    expect(await screen.findByText('Server says no')).toBeTruthy()
  })
})

describe('editor: never writes without an explicit Save', () => {
  it('sends no /file/save on Close + Discard, Cancel, ⌘S, an agent switch, or an unmount', async () => {
    const { saves, view } = setup()
    await editTo('readme.md', 'draft one')
    fireEvent.click(button('Close'))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Discard' }))
    await screen.findByText('notes.txt')

    await editTo('readme.md', 'draft two')
    fireEvent.click(button('Cancel'))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Discard' }))
    expect(textarea()).toBeNull()
    expect(screen.getByTestId('md').textContent).toBe(TEXTS['readme.md'])

    fireEvent.click(button('Edit'))
    fireEvent.change(textarea()!, { target: { value: 'draft three' } })
    fireEvent.keyDown(textarea()!, { key: 's', metaKey: true })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Back to editing' }))
    fireEvent.keyDown(textarea()!, { key: 's', ctrlKey: true })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Back to editing' }))

    act(() => host.state.profile.set('eva'))
    await screen.findByRole('status')
    act(() => host.state.profile.set('default'))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    view.unmount()
    await flush()
    expect(saves()).toEqual([])
  })

  it('opens the Review dialog on ⌘S with the diff and a line summary', async () => {
    const { saves } = setup()
    await editTo('readme.md', '# Readme\n\nHello from me.\n')
    fireEvent.keyDown(textarea()!, { key: 's', metaKey: true })
    const review = dialog()
    expect(within(review).getByText('Save changes to readme.md?')).toBeTruthy()
    expect(within(review).getByText('+1 −1 lines')).toBeTruthy()
    expect(review.querySelector('[data-diff=del]')?.textContent).toContain('Hello from the agent.')
    expect(review.querySelector('[data-diff=add]')?.textContent).toContain('Hello from me.')
    expect(saves()).toEqual([])
  })

  it('Save sends the opened sha256 and the text, then returns to View showing Saved', async () => {
    const { saves, files } = setup()
    await editTo('readme.md', '# New\n')
    fireEvent.click(button('Review & save'))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Saved')).toBeTruthy()
    expect(saves()).toHaveLength(1)
    expect(saves()[0].opts).toEqual({
      method: 'POST',
      body: { root: 'home', path: 'readme.md', base_sha256: fakeSha(TEXTS['readme.md']), text: '# New\n' }
    })
    expect(files.get('readme.md')).toBe('# New\n')
    expect(textarea()).toBeNull()
    expect(screen.getByTestId('md').textContent).toBe('# New\n')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('editor: text fidelity', () => {
  const raw = '\uFEFF# Title\r\nline a\r\nline b\r\n'

  it('saves a one-line edit of a CRLF + BOM file as CRLF + BOM with only that line changed', async () => {
    const { saves } = setup({}, { 'crlf.md': raw })
    await openFile('crlf.md')
    fireEvent.click(button('Edit'))
    expect(textarea()?.value).toBe('# Title\nline a\nline b\n')
    fireEvent.change(textarea()!, { target: { value: '# Title\nline A\nline b\n' } })
    fireEvent.click(button('Review & save'))
    expect(within(dialog()).getByText('+1 −1 lines')).toBeTruthy()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved')
    expect(saves()[0].opts.body.text).toBe('\uFEFF# Title\r\nline A\r\nline b\r\n')
    expect(saves()[0].opts.body.base_sha256).toBe(fakeSha(raw))
  })

  it('says a mixed-ending file becomes all CRLF, in Edit and in Review, and saves it so', async () => {
    const { saves } = setup({}, { 'crlf.md': 'a\r\nb\nc\r\n' })
    await openFile('crlf.md')
    fireEvent.click(button('Edit'))
    const note = 'This file mixes line endings; saving converts them all to CRLF.'
    expect(screen.getByText(note)).toBeTruthy()
    fireEvent.change(textarea()!, { target: { value: 'a\nb\nC\n' } })
    fireEvent.click(button('Review & save'))
    expect(within(dialog()).getByText(note)).toBeTruthy()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved')
    expect(saves()[0].opts.body.text).toBe('a\r\nb\r\nC\r\n')
  })

  it('shows no line-ending note for a uniform file', async () => {
    setup({}, { 'crlf.md': raw })
    await openFile('crlf.md')
    fireEvent.click(button('Edit'))
    expect(screen.queryByText(/mixes line endings/)).toBeNull()
  })

  it('cannot save an untouched file: Save is disabled and ⌘S does nothing', async () => {
    const { saves } = setup({}, { 'crlf.md': raw })
    await openFile('crlf.md')
    fireEvent.click(button('Edit'))
    expect(button('Review & save').disabled).toBe(true)
    fireEvent.keyDown(textarea()!, { key: 's', metaKey: true })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(saves()).toEqual([])
  })
})

describe('editor: conflict and gone', () => {
  it('Compare shows theirs → yours, and Save then sends their sha as the base', async () => {
    const { saves, files } = setup()
    await editTo('readme.md', 'mine\n')
    files.set('readme.md', 'theirs\n') // the agent changed it meanwhile
    fireEvent.click(button('Review & save'))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }))
    const conflict = await screen.findByText("readme.md changed on the agent's machine since you opened it.")
    fireEvent.click(within(conflict.closest('[role=dialog]') as HTMLElement).getByRole('button', { name: 'Compare with their version' }))
    const review = dialog()
    expect(within(review).getByText('Save changes to readme.md?')).toBeTruthy()
    expect(review.querySelector('[data-diff=del]')?.textContent).toContain('theirs')
    expect(review.querySelector('[data-diff=add]')?.textContent).toContain('mine')
    fireEvent.click(within(review).getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved')
    expect(saves().map(c => c.opts.body.base_sha256)).toEqual([fakeSha(TEXTS['readme.md']), fakeSha('theirs\n')])
    expect(files.get('readme.md')).toBe('mine\n')
  })

  it('sends nothing more when their version already equals mine after Compare', async () => {
    const { saves, files } = setup()
    await editTo('readme.md', 'same\n')
    files.set('readme.md', 'same\n')
    fireEvent.click(button('Review & save'))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Compare with their version' }))
    const review = dialog()
    expect(within(review).getByText('No changes')).toBeTruthy()
    const save = within(review).getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    reactProps(save).onClick() // even a direct call is refused for a clean document
    await flush()
    expect(saves()).toHaveLength(1)
  })

  it('disables Compare when the conflict carries no text', async () => {
    setup({ '/file/save': () => ({ ok: false, code: 'conflict', sha256: 'sha-other' }) })
    await editTo('readme.md', 'mine\n')
    fireEvent.click(button('Review & save'))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }))
    await screen.findByText(/changed on the agent's machine/)
    expect(button('Compare with their version').disabled).toBe(true)
    expect(button('Copy my text').disabled).toBe(false)
  })

  it('Discard mine and reload re-fetches and returns to View', async () => {
    const { files, calls } = setup()
    await editTo('readme.md', 'mine\n')
    files.set('readme.md', 'theirs\n')
    fireEvent.click(button('Review & save'))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Discard mine and reload' }))
    await waitFor(() => expect(screen.getByTestId('md').textContent).toBe('theirs\n'))
    expect(calls.filter(c => c.path === '/file')).toHaveLength(2)
    expect(textarea()).toBeNull()
  })

  it('shows the gone message and offers Copy my text', async () => {
    const { ctx } = setup({ '/file/save': () => ({ ok: false, code: 'gone' }) })
    const copy = vi.spyOn(ctx.os, 'writeClipboard')
    await editTo('readme.md', 'keep me\n')
    fireEvent.click(button('Review & save'))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }))
    const gone = await screen.findByText("readme.md was moved or deleted on the agent's machine.")
    fireEvent.click(within(gone.closest('[role=dialog]') as HTMLElement).getByRole('button', { name: 'Copy my text' }))
    expect(copy).toHaveBeenCalledWith('keep me\n')
  })
})

describe('editor: leaving', () => {
  it('restores Edit with the draft after an unmount and remount', async () => {
    const { view } = setup()
    await editTo('readme.md', 'unsaved draft')
    view.unmount()
    render(<CloudFilesPage />)
    await waitFor(() => expect(textarea()?.value).toBe('unsaved draft'))
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    expect(button('Review & save').disabled).toBe(false)
  })

  it('settles a parked draft when a Save succeeds after the page unmounted: it comes back as the saved View', async () => {
    let answer: (value: unknown) => void = () => undefined
    const { view } = setup({ '/file/save': () => new Promise(resolve => (answer = resolve)) })
    await editTo('readme.md', 'saved text\n')
    fireEvent.click(button('Review & save'))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }))
    await flush(2)
    view.unmount()
    await act(async () => answer({ ok: true, sha256: fakeSha('saved text\n') }))
    render(<CloudFilesPage />)
    await waitFor(() => expect(screen.getByTestId('md').textContent).toBe('saved text\n'))
    expect(textarea()).toBeNull()
    expect(screen.queryByText('Unsaved changes')).toBeNull()
    fireEvent.click(button('Edit'))
    expect(button('Review & save').disabled).toBe(true)
  })

  it('keeps a newer parked draft when an older Save succeeds late', async () => {
    let answer: (value: unknown) => void = () => undefined
    const { view } = setup({ '/file/save': () => new Promise(resolve => (answer = resolve)) })
    await editTo('readme.md', 'sent\n')
    fireEvent.click(button('Review & save'))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }))
    await flush(2)
    view.unmount()
    const [key, parked] = [...$drafts.get()][0]
    $drafts.set(new Map([[key, { ...parked, draft: 'newer\n' }]])) // a different snapshot replaced it meanwhile
    await act(async () => answer({ ok: true, sha256: 'sha-sent' }))
    expect([...$drafts.get().values()][0]).toMatchObject({ draft: 'newer\n', mode: 'edit', sha: parked.sha })
  })

  it('does not restore a draft for another agent', async () => {
    const { view } = setup()
    await editTo('readme.md', 'unsaved draft')
    view.unmount()
    host.state.profile.set('eva')
    render(<CloudFilesPage />)
    await screen.findByText('notes.txt')
    expect(textarea()).toBeNull()
    expect($drafts.get().size).toBe(1) // still kept for its own agent
  })

  it('shows the other-agent banner and disables saving until switching back', async () => {
    const { calls } = setup()
    await editTo('readme.md', 'draft')
    act(() => host.state.profile.set('eva'))
    expect((await screen.findByRole('status')).textContent).toBe('This file is on default. Switch back to edit or save.')
    expect(button('Review & save').disabled).toBe(true)
    fireEvent.keyDown(textarea()!, { key: 's', metaKey: true })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(textarea()?.value).toBe('draft')
    act(() => host.state.profile.set('default'))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    expect(button('Review & save').disabled).toBe(false)
    expect(textarea()?.value).toBe('draft')
    expect(calls.filter(c => c.path === '/file' || c.path === '/file/save').map(c => c.profile)).toEqual(['default'])
  })

  it.each([
    ['connectionId', () => host.state.connectionId.set('conn-2'), () => host.state.connectionId.set('conn-1')],
    ['profile', () => host.state.profile.set('eva'), () => host.state.profile.set('default')]
  ])('Review Save is disabled and dispatches nothing while the %s differs from the pin', async (_dimension, away, back) => {
    const { calls } = setup()
    await screen.findByText('readme.md')
    const doc: Doc = {
      id: 99, pin: { connectionId: 'conn-1', profile: 'default' }, root: 'home', rootLabel: 'Home', path: 'readme.md',
      abs: '/home/agent/readme.md', name: 'readme.md', status: 'ready', base: TEXTS['readme.md'], sha: fakeSha(TEXTS['readme.md']),
      bom: false, crlf: false, mixed: false, draft: 'mine\n', mode: 'edit'
    }
    // The Editor alone (not under the page's per-agent key), so Review stays open across the switch.
    function Harness() {
      const [state, setState] = useState<Doc | null>(doc)
      return state && <Editor doc={state} leave={action => action()} onClose={() => setState(null)} setDoc={setState} />
    }
    render(<Harness />)
    const editors = screen.getAllByRole('button', { name: 'Review & save' })
    fireEvent.click(editors[editors.length - 1])
    const save = within(dialog()).getByRole('button', { name: 'Save' }) as HTMLButtonElement
    const retained = reactProps(save).onClick // the callback as rendered before the switch
    act(away)
    expect(save.disabled).toBe(true)
    fireEvent.click(save)
    retained()
    await flush()
    expect(calls.filter(c => c.path === '/file/save')).toEqual([])
    act(back)
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(calls.filter(c => c.path === '/file/save')).toHaveLength(1))
    expect(calls.find(c => c.path === '/file/save')).toMatchObject({ connectionId: 'conn-1', profile: 'default' })
  })

  it('asks before Close discards; Keep editing keeps the draft', async () => {
    setup()
    await editTo('readme.md', 'draft')
    fireEvent.click(button('Close'))
    expect(within(dialog()).getByText('Discard unsaved changes to readme.md?')).toBeTruthy()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(textarea()?.value).toBe('draft')
    fireEvent.click(button('Close'))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Discard' }))
    await screen.findByText('notes.txt')
    expect(textarea()).toBeNull()
  })

  it('hides the folder toolbar while a file is open, keeps the breadcrumbs, and brings it back on Close', async () => {
    setup()
    await openFile('readme.md')
    expect(screen.queryByLabelText('Search files')).toBeNull()
    for (const name of ['New folder', 'Upload files', 'Upload folder', 'Open']) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Copy path' })).toHaveLength(1) // the editor's own
    expect(screen.queryByText('Up to 100 MB per file')).toBeNull()
    expect(within(screen.getByRole('navigation')).getByText('readme.md')).toBeTruthy()
    fireEvent.click(button('Close'))
    await screen.findByText('notes.txt')
    expect(screen.getByLabelText('Search files')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Upload files' })).toBeTruthy()
    expect(screen.getByText('Up to 100 MB per file')).toBeTruthy()
  })

  it('asks before a breadcrumb leaves the file', async () => {
    setup()
    await editTo('readme.md', 'draft')
    fireEvent.click(screen.getByRole('button', { name: 'Home' }))
    expect(within(dialog()).getByText('Discard unsaved changes to readme.md?')).toBeTruthy()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Discard' }))
    await screen.findByText('notes.txt')
    expect(textarea()).toBeNull()
  })
})
