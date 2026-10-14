// v0.4.6: keyboard focus waits on the list while a folder loads, and breadcrumbs shrink without overlapping.
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
const item = (name: string) => screen.getByText(name).closest('[role=listitem]') as HTMLElement
const list = () => document.activeElement?.hasAttribute('data-hcfm-list') ?? false

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
  it('Drive: Enter on a folder keeps focus on the list until it loads, then focuses the first row', async () => {
    const backend = page(path => path.startsWith('/drive/list') && path.includes('folder=fold1'))
    await openDrive()
    focus(item('Projects'))
    fireEvent.keyDown(item('Projects'), { key: 'Enter' })
    await flush()
    expect(screen.queryByText('Budget')).toBeNull()
    expect(list()).toBe(true)
    backend.release()
    await flush()
    expect(document.activeElement).toBe(item('Budget'))
  })

  it('Cloud: Enter on a folder keeps focus on the list until it loads, then focuses the first row', async () => {
    const backend = page(path => path.startsWith('/list') && path.includes('path=docs'))
    await flush()
    focus(option('docs'))
    fireEvent.keyDown(option('docs'), { key: 'Enter' })
    await flush()
    expect(screen.queryByText('a.pdf')).toBeNull()
    expect(list()).toBe(true)
    backend.release()
    await flush()
    expect(document.activeElement).toBe(option('a.pdf'))
  })

  it('a breadcrumb opened from the keyboard leaves focus alone until the folder loads', async () => {
    page()
    await flush()
    focus(option('docs'))
    fireEvent.keyDown(option('docs'), { key: 'Enter' })
    await flush()
    const crumb = screen.getByRole('button', { name: 'Home' })
    focus(crumb)
    fireEvent.click(crumb, { detail: 0 })
    expect(list()).toBe(false)
    await flush()
    expect(document.activeElement).toBe(option('docs'))
  })
})

describe('breadcrumbs in a narrow pane', () => {
  it('folder crumbs shrink before the current one, carry their full name and ellipsize inside the button', async () => {
    page()
    await flush()
    fireEvent.keyDown(option('docs'), { key: 'Enter' })
    await flush()
    const nav = screen.getByRole('navigation')
    const home = screen.getByRole('button', { name: 'Home' })
    expect(home.title).toBe('Home')
    expect(home.style.flexShrink).toBe('1')
    expect(home.style.minWidth).toBe('0px')
    expect((home.firstElementChild as HTMLElement).style.textOverflow).toBe('ellipsis')
    const [ancestor, current] = [...nav.children] as HTMLElement[]
    expect(ancestor.style.flex).toBe('0 100 auto')
    expect(current.style.flex).toBe('0 1 auto')
    expect(current.querySelector('[title="docs"]')).toBeTruthy()
  })

  it('Drive crumbs follow the same rules', async () => {
    page()
    await openDrive()
    fireEvent.keyDown(item('Projects'), { key: 'Enter' })
    await flush()
    const drive = screen.getAllByRole('navigation').find(nav => nav.textContent?.includes('Projects'))!
    const root = [...drive.querySelectorAll('button')].find(button => button.title)!
    expect(root.style.flexShrink).toBe('1')
    const [ancestor, current] = [...drive.children] as HTMLElement[]
    expect(ancestor.style.flex).toBe('0 100 auto')
    expect(current.style.flex).toBe('0 1 auto')
    expect(current.querySelector('[title="Projects"]')).toBeTruthy()
  })
})
