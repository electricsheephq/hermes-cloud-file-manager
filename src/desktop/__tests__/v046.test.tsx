// v0.4.6: Drive rows keep Enter and Space beside a chat, focus lands after a slow folder load, and breadcrumbs fit a narrow pane.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { createTestContext, resetHost, resetQueryCache } from './sdk-mock'
import { fakeBackend } from './fake-backend'
import { $available, $driveAvailable, bindContext } from '../api'
import { $driveJob } from '../drive'
import { $drafts } from '../editor'
import { $batch, CloudFilesPage } from '../page'
import { closePicker } from '../picker'

const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve() }) }
const focus = (element: HTMLElement) => act(() => element.focus())
const option = (name: string) => screen.getByText(name).closest('[role=option]') as HTMLElement
const item = (name: string) => screen.getByText(name).closest('[role=option][data-entry]') as HTMLElement

/** Hermes Desktop's soft keys (lib/keybinds/composer-focus-keys.ts, a capture-phase window listener): Enter or Space
 *  on anything it doesn't know handles them moves focus to a visible chat's message box. An excerpt of its list. */
const HOST_HANDLES_ENTER = 'a[href],button,input,textarea,select,[role="button"],[role="checkbox"],[role="option"],[role="tab"],[role="treeitem"]'
function hostComposer() {
  const composer = document.createElement('textarea')
  composer.setAttribute('aria-label', 'Message')
  document.body.append(composer)
  const soft = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement
    if ((event.key === 'Enter' || event.key === ' ') && target !== document.body && !target.closest(HOST_HANDLES_ENTER)) setTimeout(() => composer.focus(), 0)
  }
  window.addEventListener('keydown', soft, { capture: true })
  return { composer, dispose: () => { window.removeEventListener('keydown', soft, { capture: true }); composer.remove() } }
}

/** The page over the fake backend; requests matching `slow` wait until `release()`. */
function page(slow: (path: string) => boolean = () => false) {
  const backend = fakeBackend()
  const waiting: Array<() => void> = []
  const rest = async (path: string, opts?: any) => {
    if (slow(path)) await new Promise<void>(resolve => waiting.push(resolve))
    return backend.rest(path, opts)
  }
  bindContext(createTestContext({ rest }).ctx as any)
  render(<CloudFilesPage />)
  return { ...backend, release: () => act(() => waiting.splice(0).forEach(resolve => resolve())) }
}
async function openDrive() {
  await flush()
  act(() => $driveAvailable.set(true))
  fireEvent.click(screen.getAllByRole('option').find(el => el.closest('[data-select]') && el.textContent === 'Google Drive')!)
  await flush()
}

beforeEach(() => {
  resetQueryCache(); resetHost()
  $available.set(true); $driveAvailable.set(null); $batch.set(null); $driveJob.set(null); $drafts.set(new Map())
})
afterEach(() => { act(closePicker); cleanup(); vi.restoreAllMocks() })

describe('keyboard focus while a folder loads', () => {
  it('Drive rows are options in a listbox, so a visible chat never takes their Enter or Space', async () => {
    const host = hostComposer()
    try {
      const backend = page(path => path.startsWith('/drive/list') && path.includes('folder=fold1'))
      await openDrive()
      const box = item('Projects').closest('[role=listbox]') as HTMLElement
      expect(box.getAttribute('aria-multiselectable')).toBe('true')
      expect(box.getAttribute('aria-label')).toBe('Files in Google Drive')
      focus(item('Plan'))
      fireEvent.keyDown(item('Plan'), { key: ' ' })
      await flush()
      expect(item('Plan').getAttribute('aria-selected')).toBe('true')
      expect(document.activeElement).toBe(item('Plan'))
      focus(item('Projects'))
      fireEvent.keyDown(item('Projects'), { key: 'Enter' })
      await flush()
      expect(document.activeElement).not.toBe(host.composer)
      backend.release()
      await flush()
      expect(document.activeElement).toBe(item('Budget'))
    } finally {
      host.dispose()
    }
  })

  it('Cloud: Enter on a folder that loads slowly still focuses its first row', async () => {
    const backend = page(path => path.startsWith('/list') && path.includes('path=docs'))
    await flush()
    focus(option('docs'))
    fireEvent.keyDown(option('docs'), { key: 'Enter' })
    await flush()
    expect(screen.queryByText('a.pdf')).toBeNull()
    backend.release()
    await flush()
    expect(document.activeElement).toBe(option('a.pdf'))
  })

  it('a breadcrumb opened from the keyboard focuses the folder\'s first row', async () => {
    page()
    await flush()
    focus(option('docs'))
    fireEvent.keyDown(option('docs'), { key: 'Enter' })
    await flush()
    const crumb = screen.getByRole('button', { name: 'Home' })
    focus(crumb)
    fireEvent.click(crumb, { detail: 0 })
    await flush()
    expect(document.activeElement).toBe(option('docs'))
  })
})

describe('breadcrumbs in a narrow pane', () => {
  it('folder crumbs shrink before the current one (which keeps up to 70%), carry their full name and ellipsize inside the button', async () => {
    page()
    await flush()
    fireEvent.keyDown(option('docs'), { key: 'Enter' })
    await flush()
    const nav = screen.getByRole('navigation')
    // A real basis: the wrapping toolbar moves its tools to the next line rather than squeezing the path.
    expect(nav.style.flex).toBe('1 1 160px')
    const home = screen.getByRole('button', { name: 'Home' })
    expect(home.title).toBe('Home')
    expect(home.style.flexShrink).toBe('1')
    expect(home.style.minWidth).toBe('0px')
    expect((home.firstElementChild as HTMLElement).style.textOverflow).toBe('ellipsis')
    const [root, current] = [...nav.children] as HTMLElement[]
    expect(root.style.flex).toBe('0 100 auto')
    expect(root.style.minWidth).toBe('2em')
    expect(current.style.flex).toBe('0 0 auto')
    expect(current.style.maxWidth).toBe('70%')
    expect(current.querySelector('[title="docs"]')).toBeTruthy()
  })

  it('a crumb holding keyboard focus is sized like the current one, so it never sits shrunk out of sight', async () => {
    page()
    await flush()
    fireEvent.keyDown(option('docs'), { key: 'Enter' })
    await flush()
    const home = screen.getByRole('button', { name: 'Home' })
    const wrapper = home.parentElement as HTMLElement
    expect(wrapper.style.flex).toBe('0 100 auto')
    act(() => home.focus())
    expect(wrapper.style.flex).toBe('0 0 auto')
    expect(wrapper.style.maxWidth).toBe('70%')
    act(() => home.blur())
    expect(wrapper.style.flex).toBe('0 100 auto')
  })

  it('an ancestor activated from the keyboard is not left sized as focused after descending again', async () => {
    page()
    await flush()
    fireEvent.keyDown(option('docs'), { key: 'Enter' })
    await flush()
    const home = screen.getByRole('button', { name: 'Home' })
    focus(home)
    fireEvent.click(home, { detail: 0 })
    await flush()
    expect(document.activeElement).toBe(option('docs'))
    fireEvent.keyDown(option('docs'), { key: 'Enter' })
    await flush()
    const [root, current] = [...screen.getByRole('navigation').children] as HTMLElement[]
    expect(root.style.flex).toBe('0 100 auto')
    expect(current.style.flex).toBe('0 0 auto')
  })

  it('a crumb that keeps focus while a search settles keeps its size', async () => {
    page()
    await flush()
    fireEvent.keyDown(option('docs'), { key: 'Enter' })
    await flush()
    fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'a' } })
    const home = screen.getByRole('button', { name: 'Home' })
    focus(home)
    expect(home.parentElement!.style.flex).toBe('0 0 auto')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)) })
    await flush()
    // The search has settled: the current folder is now a crumb Button back out of the results.
    expect(screen.getByRole('button', { name: 'docs' })).toBeTruthy()
    expect(document.activeElement).toBe(home)
    expect(home.parentElement!.style.flex).toBe('0 0 auto')
  })

  it('Drive crumbs follow the same rules', async () => {
    page()
    await openDrive()
    fireEvent.keyDown(item('Projects'), { key: 'Enter' })
    await flush()
    const drive = screen.getAllByRole('navigation').find(nav => nav.textContent?.includes('Projects'))!
    expect(drive.style.flex).toBe('1 1 160px')
    const rootButton = [...drive.querySelectorAll('button')].find(button => button.title)!
    expect(rootButton.style.flexShrink).toBe('1')
    const [root, current] = [...drive.children] as HTMLElement[]
    expect(root.style.flex).toBe('0 100 auto')
    expect(current.style.flex).toBe('0 0 auto')
    expect(current.style.maxWidth).toBe('70%')
    expect(current.querySelector('[title="Projects"]')).toBeTruthy()
  })

  it('a Drive crumb that keeps focus while a search settles keeps its size', async () => {
    page()
    await openDrive()
    fireEvent.keyDown(item('Projects'), { key: 'Enter' })
    await flush()
    fireEvent.change(screen.getByLabelText('Search Google Drive'), { target: { value: 'a' } })
    const drive = screen.getAllByRole('navigation').find(nav => nav.textContent?.includes('Projects'))!
    const rootButton = [...drive.querySelectorAll('button')].find(button => button.title)!
    focus(rootButton)
    expect(rootButton.parentElement!.style.flex).toBe('0 0 auto')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)) })
    await flush()
    expect(screen.getByRole('button', { name: 'Projects' })).toBeTruthy()
    expect(document.activeElement).toBe(rootButton)
    expect(rootButton.parentElement!.style.flex).toBe('0 0 auto')
  })
})
