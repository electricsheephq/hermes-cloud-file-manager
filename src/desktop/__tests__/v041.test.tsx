// v0.4.1: read-only previews of images, PDFs and code/data files through GET /file/preview. Save stays md/txt only.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { createTestContext, host, resetHost, resetQueryCache, setDownloadCapture } from './sdk-mock'
import { fakeBackend } from './fake-backend'
import { $available, $driveAvailable, bindContext } from '../api'
import { $drafts, openDoc, useOpenDoc } from '../editor'
import { isEditable, isOpenable, parseDelimited, PREVIEW_EXTS, previewKind } from '../format'
import { $batch, CloudFilesPage } from '../page'
import { Preview } from '../preview'
import { S } from '../strings'

const MiB = 1024 * 1024
const flush = async (rounds = 10) => {
  for (let i = 0; i < rounds; i++) await act(() => new Promise(resolve => setTimeout(resolve, 0)))
}
const file = (rel: string, extra = {}) => ({ name: rel.split('/').pop()!, rel, abs: `/home/agent/${rel}`, is_dir: false, size: 1, mtime: 0, ...extra })
const FILES = ['data.json', 'table.csv', 'pic.png', 'doc.pdf', 'readme.md', 'big.png', 'bin.log', 'conf.yaml'].map(name => file(name))
const row = (name: string) => screen.getByText(name).closest('[role=option]') as HTMLElement
const button = (name: string) => screen.queryByRole('button', { name })
const ipcError = (status: number) => new Error(`Error invoking remote method 'hermes:api': Error: ${status}: {"detail":"Not Found"}`)

type Answer = Record<string, unknown> | (() => unknown)
/** The page over a folder of `FILES`; `answers` replace the fake gateway's /file/preview answer by rel path. */
function page(answers: Record<string, Answer> = {}) {
  const backend = fakeBackend({ '/list': () => ({ ok: true, entries: FILES, total: FILES.length, truncated: false }) })
  const rest = async (full: string, opts?: any) => {
    const result = await backend.rest(full, opts)
    const rel = new URLSearchParams(full.split('?')[1] ?? '').get('path') ?? ''
    if (!full.startsWith('/file/preview?') || !(rel in answers)) return result
    const answer = answers[rel]
    return typeof answer === 'function' ? answer() : answer
  }
  bindContext(createTestContext({ rest }).ctx as any)
  const previews = () => backend.calls.filter(c => c.path === '/file/preview')
  return { ...backend, previews, view: render(<CloudFilesPage />) }
}
const open = async (name: string) => {
  fireEvent.doubleClick(await screen.findByText(name))
  await flush()
}
function captures() {
  const saves: Array<ReturnType<typeof vi.fn>> = []
  setDownloadCapture(vi.fn(() => {
    const save = vi.fn(async () => undefined)
    saves.push(save)
    return save
  }))
  return saves
}

let urls = 0
beforeEach(() => {
  resetQueryCache(); resetHost(); setDownloadCapture(undefined)
  $available.set(true); $driveAvailable.set(null); $batch.set(null); $drafts.set(new Map())
  urls = 0
  Object.assign(URL, { createObjectURL: vi.fn(() => `blob:test/${++urls}`), revokeObjectURL: vi.fn() })
})
afterEach(() => { setDownloadCapture(undefined); vi.restoreAllMocks() })

describe('format: what opens where', () => {
  it('previewKind follows the gateway table; md, markdown and txt are editable, never previewed', () => {
    for (const [ext, mime] of Object.entries(PREVIEW_EXTS.image)) {
      expect(previewKind(`a.${ext.toUpperCase()}`)).toBe('image')
      expect(mime.startsWith('image/')).toBe(true)
    }
    expect(Object.keys(PREVIEW_EXTS.image)).toEqual(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg'])
    expect(previewKind('report.PDF')).toBe('pdf')
    expect(PREVIEW_EXTS.pdf).toEqual(['pdf'])
    expect(PREVIEW_EXTS.text.join(' ')).toBe('json jsonl ndjson yaml yml toml ini cfg conf properties csv tsv log xml html htm css scss less js mjs cjs ' +
      'ts tsx jsx py rb go rs java kt swift c h cc cpp hpp cs php sh bash zsh fish ps1 sql r lua pl dart scala vue svelte graphql proto tf diff patch rst tex adoc srt vtt')
    for (const ext of PREVIEW_EXTS.text) expect(previewKind(`f.${ext}`)).toBe('text')
    for (const name of ['a.md', 'b.markdown', 'c.txt', 'd.exe', 'e.heic', 'noext', '.json', 'toString', 'a.constructor']) expect(previewKind(name)).toBeNull()
  })

  it('isOpenable: editable or previewable files; never folders or outside links; isEditable unchanged', () => {
    const e = (name: string, extra = {}) => ({ name, is_dir: false, ...extra })
    expect(['a.md', 'b.TXT', 'c.json', 'd.png', 'e.pdf', 'f.csv'].map(n => isOpenable(e(n)))).toEqual([true, true, true, true, true, true])
    expect(['a.json', 'b.png'].map(n => isEditable(e(n)))).toEqual([false, false])
    expect(isEditable(e('a.md'))).toBe(true)
    for (const extra of [{ is_dir: true }, { link_outside: true }]) {
      expect(isOpenable(e('a.json', extra))).toBe(false)
      expect(isOpenable(e('a.md', extra))).toBe(false)
    }
    expect(isOpenable(e('a.exe'))).toBe(false)
  })

  it('parseDelimited: quoted fields, doubled quotes, line breaks in quotes, CRLF, tabs and a row cap', () => {
    expect(parseDelimited('a,b\r\n"x, y","say ""hi"""\n"two\nlines",\n', ',', 10)).toEqual({
      rows: [['a', 'b'], ['x, y', 'say "hi"'], ['two\nlines', '']],
      more: false
    })
    expect(parseDelimited('a\tb,c\n1\t2', '\t', 10).rows).toEqual([['a', 'b,c'], ['1', '2']])
    expect(parseDelimited('1\n2\n3\n', ',', 2)).toEqual({ rows: [['1'], ['2']], more: true })
    expect(parseDelimited('1\n2', ',', 2)).toEqual({ rows: [['1'], ['2']], more: false })
    expect(parseDelimited('', ',', 2)).toEqual({ rows: [], more: false })
  })
})

describe('the read-only viewer', () => {
  it('double-click on a .json row shows its text in a <pre>, read-only: no Edit, Save or Review', async () => {
    const { previews } = page()
    await open('data.json')
    expect(document.querySelector('pre')?.textContent).toBe('{"a": 1}\n')
    expect(previews()).toHaveLength(1)
    expect(previews()[0].params).toEqual({ root: 'home', path: 'data.json' })
    expect(previews()[0].opts).toBeUndefined() // text: the default timeout
    expect(screen.getByText('/home/agent/data.json')).toBeTruthy()
    for (const name of ['Edit', 'Save', 'Review & save']) expect(button(name)).toBeNull()
    expect(button('Copy path')).toBeTruthy()
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('Enter on a row, and the toolbar Open, open the viewer too; Close returns to the list', async () => {
    page()
    await screen.findByText('conf.yaml')
    fireEvent.keyDown(row('data.json'), { key: 'Enter' })
    await flush()
    expect(document.querySelector('pre')?.textContent).toBe('{"a": 1}\n')
    fireEvent.click(button('Close')!)
    await flush()
    fireEvent.click(await screen.findByText('pic.png'))
    fireEvent.click(button('Open')!)
    await flush()
    expect(document.querySelector('img')?.getAttribute('src')).toBe('blob:test/1')
  })

  it('md and txt keep opening in the editor through /file', async () => {
    const { calls } = page()
    await open('readme.md')
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeTruthy()
    expect(calls.filter(c => c.path === '/file').map(c => c.params.path)).toEqual(['readme.md'])
    expect(calls.some(c => c.path === '/file/preview')).toBe(false)
  })

  it('a CSV shows as a table with a header row, and the toggle switches to text and back', async () => {
    page({ 'table.csv': { ok: true, kind: 'text', text: 'name,note\nann,"a, b"\nbob,"say ""hi"""\n', truncated: false, size: 40 } })
    await open('table.csv')
    expect([...document.querySelectorAll('th')].map(th => th.textContent)).toEqual(['name', 'note'])
    expect([...document.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent))).toEqual([['ann', 'a, b'], ['bob', 'say "hi"']])
    fireEvent.click(button(S.showAsText)!)
    expect(document.querySelector('table')).toBeNull()
    expect(document.querySelector('pre')?.textContent).toContain('ann,"a, b"')
    fireEvent.click(button(S.showAsTable)!)
    expect(document.querySelector('table')).toBeTruthy()
  })

  it('a table shows at most 1,000 rows and 50 columns, and says so', async () => {
    const wide = Array.from({ length: 60 }, (_, i) => `c${i}`).join(',')
    const text = [wide, ...Array.from({ length: 1005 }, (_, i) => `r${i}`)].join('\n')
    page({ 'table.csv': { ok: true, kind: 'text', text, truncated: false, size: text.length } })
    await open('table.csv')
    expect(document.querySelectorAll('th')).toHaveLength(50)
    expect(document.querySelectorAll('tbody tr')).toHaveLength(1000)
    expect(screen.getByText('Showing the first 1,000 rows and 50 columns.')).toBeTruthy()
  })

  it('a truncated text says how much is shown', async () => {
    page({ 'bin.log': { ok: true, kind: 'text', text: 'x'.repeat(100), truncated: true, size: 3 * MiB } })
    await open('bin.log')
    expect(screen.getByText('Showing the first 1 MB of 3.0 MB. Download it to see the rest.')).toBeTruthy()
    expect(document.querySelector('pre')?.textContent).toBe('x'.repeat(100))
  })

  it('an image renders as <img> from a blob: URL with the returned type, read with a 60 s timeout; Close revokes it', async () => {
    const { previews } = page()
    await open('pic.png')
    const img = document.querySelector('img')!
    expect(img.getAttribute('src')).toBe('blob:test/1')
    expect(img.getAttribute('alt')).toBe('pic.png')
    expect(previews()[0].opts).toEqual({ timeoutMs: 60000 })
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    expect(blob.type).toBe('image/png')
    expect(blob.size).toBe(9)
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    fireEvent.click(button('Close')!)
    await flush()
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:test/1')
  })

  it('unmounting the page revokes the URL', async () => {
    const { view } = page()
    await open('doc.pdf')
    expect(document.querySelector('iframe')?.getAttribute('src')).toBe('blob:test/1')
    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:test/1')
  })

  it('a pdf renders in a plain <iframe> from a blob: URL, without a sandbox attribute', async () => {
    page()
    await open('doc.pdf')
    const frame = document.querySelector('iframe')!
    expect(frame.getAttribute('src')).toBe('blob:test/1')
    expect(frame.getAttribute('title')).toBe('doc.pdf')
    expect(frame.hasAttribute('sandbox')).toBe(false)
    expect((vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob).type).toBe('application/pdf')
  })

  it('Download calls the save captured with the read, with the abs path and name', async () => {
    const saves = captures()
    page()
    await open('pic.png')
    expect(saves).toHaveLength(2) // the listing, then the read
    fireEvent.click(button('Download')!)
    expect(saves[1]).toHaveBeenCalledExactlyOnceWith('/home/agent/pic.png', 'pic.png')
    expect(saves[0]).not.toHaveBeenCalled()
  })
})

describe('preview errors', () => {
  it('a gateway half without the route (404) says to update Cloud Files, and Download stays', async () => {
    const saves = captures()
    page({ 'data.json': () => { throw ipcError(404) } })
    await open('data.json')
    expect(screen.getByText('Previews need Cloud Files 0.4.1 or newer on the agent.')).toBeTruthy()
    fireEvent.click(button('Download')!)
    expect(saves[1]).toHaveBeenCalledExactlyOnceWith('/home/agent/data.json', 'data.json')
  })

  it('names the agent in the 404 message', async () => {
    act(() => host.state.profile.set('eva'))
    page({ 'data.json': () => { throw ipcError(404) } })
    await open('data.json')
    expect(screen.getByText('Previews need Cloud Files 0.4.1 or newer on eva.')).toBeTruthy()
  })

  it('too_large and not_text have their own sentences; other codes use the usual file text', async () => {
    page({
      'big.png': { ok: false, code: 'too_large', message: 'too large', max_bytes: 10 * MiB, size: 12 * MiB },
      'bin.log': { ok: false, code: 'not_text', message: 'binary' },
      'conf.yaml': { ok: false, code: 'not_found', message: 'gone' }
    })
    await open('big.png')
    expect(screen.getByText('12 MB is too large to preview here. Download it instead.')).toBeTruthy()
    fireEvent.click(button('Close')!)
    await open('bin.log')
    expect(screen.getByText("This file isn't text, so it can't be previewed.")).toBeTruthy()
    fireEvent.click(button('Close')!)
    await open('conf.yaml')
    expect(screen.getByText('This file no longer exists.')).toBeTruthy()
  })
})

describe('the pinned agent and the open file', () => {
  function Harness() {
    const [doc, setDoc] = useOpenDoc()
    harness.setDoc = setDoc
    return doc ? <Preview doc={doc} onClose={() => setDoc(null)} setDoc={setDoc} /> : null
  }
  const harness: { setDoc?: Parameters<typeof openDoc>[3] } = {}

  it('sends no /file/preview while another agent is selected; reads once its own agent is back', async () => {
    const backend = fakeBackend()
    bindContext(createTestContext({ rest: backend.rest }).ctx as any)
    render(<Harness />)
    act(() => host.state.profile.set('eva'))
    act(() => openDoc(file('data.json'), { id: 'home', label: 'Home', path: '/home/agent' }, { connectionId: 'conn-1', profile: 'default' }, harness.setDoc!))
    await flush()
    expect(backend.calls.filter(c => c.path === '/file/preview')).toHaveLength(0)
    expect(screen.getByRole('status').textContent).toBe('This file is on default. Switch back to view it.')
    expect(document.querySelector('[aria-busy]')).toBeNull()
    act(() => host.state.profile.set('default'))
    await flush()
    expect(backend.calls.filter(c => c.path === '/file/preview').map(c => c.profile)).toEqual(['default'])
    expect(document.querySelector('pre')?.textContent).toBe('{"a": 1}\n')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('another file opened in its place revokes the old URL', async () => {
    bindContext(createTestContext({ rest: fakeBackend().rest }).ctx as any)
    render(<Harness />)
    const root = { id: 'home', label: 'Home', path: '/home/agent' }
    act(() => openDoc(file('pic.png'), root, { connectionId: 'conn-1', profile: 'default' }, harness.setDoc!))
    await flush()
    expect(document.querySelector('img')?.getAttribute('src')).toBe('blob:test/1')
    act(() => openDoc(file('doc.pdf'), root, { connectionId: 'conn-1', profile: 'default' }, harness.setDoc!))
    await flush()
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:test/1')
    expect(document.querySelector('iframe')?.getAttribute('src')).toBe('blob:test/2')
  })

  it('a loaded preview stays on screen across an agent switch, with the banner and no new read', async () => {
    const { previews } = page()
    await open('pic.png')
    act(() => host.state.profile.set('eva'))
    await flush()
    // The page body remounts per agent: the viewer makes a new URL for the same file and revokes the old one.
    expect(document.querySelector('img')?.getAttribute('src')).toBe('blob:test/2')
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:test/1')
    expect(screen.getByText('This file is on default. Switch back to view it.')).toBeTruthy()
    act(() => host.state.profile.set('default'))
    await flush()
    expect(previews()).toHaveLength(1)
  })

  it('Google Drive rows never open a file', async () => {
    const { calls } = page()
    act(() => $driveAvailable.set(true))
    await screen.findByText('data.json')
    fireEvent.click(screen.getAllByRole('option').find(el => el.textContent === 'Google Drive')!)
    const pdf = (await screen.findByText('report.pdf')).closest('[role=listitem]') as HTMLElement
    fireEvent.doubleClick(pdf)
    fireEvent.keyDown(pdf, { key: 'Enter' })
    await flush()
    expect(calls.some(c => c.path === '/file/preview' || c.path === '/file')).toBe(false)
    await waitFor(() => expect(pdf.getAttribute('aria-selected')).toBe('true'))
  })
})
