// Test double for Hermes Desktop's '@hermes/plugin-sdk' (aliased in vitest.config.ts).
// Only what the plugin uses; behaviour mirrors the real SDK where tests depend on it.
import { createElement, useSyncExternalStore } from 'react'

type Listener<T> = (value: T) => void

export function atom<T>(initial: T) {
  let value = initial
  const listeners = new Set<Listener<T>>()
  return {
    get: () => value,
    set(next: T) {
      value = next
      listeners.forEach(fn => fn(value))
    },
    subscribe(fn: Listener<T>) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    }
  }
}

export function useValue<T>(store: ReturnType<typeof atom<T>>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

export const host = {
  state: {
    connectionId: atom<null | string>('conn-1'),
    profile: atom<string>('default'),
    focusedSessionOwner: atom<null | { connectionId: null | string; profile: string }>({ connectionId: 'conn-1', profile: 'default' })
  },
  notify: (_note: unknown) => undefined,
  navigate: (_path: string) => undefined
}

export const ROUTES_AREA = 'routes'
export const SIDEBAR_NAV_AREA = 'sidebar.nav'
export const COMPOSER_AREAS = { underside: 'composer.underside', attachments: 'composer.attachments' } as const

const passthrough = (tag: string) => (props: any) => createElement(tag, props, props?.children)
export const Button = passthrough('button')
export const Codicon = (props: any) => createElement('i', { 'data-codicon': props?.name })
export const EmptyState = passthrough('div')
export const SearchField = passthrough('input')

export interface TestContextOptions {
  rest?: (path: string, opts?: any) => Promise<any>
}

/** A PluginContext double that records live contributions and lets tests drive timers manually. */
export function createTestContext(options: TestContextOptions = {}) {
  const live = new Map<string, any>()
  const intervals: Array<() => void> = []
  const disposers: Array<() => void> = []
  const ctx = {
    register(contribution: any) {
      live.set(contribution.id, contribution)
      return () => live.delete(contribution.id)
    },
    onDispose: (fn: () => void) => disposers.push(fn),
    setTimeout: (fn: () => void) => (fn(), 0),
    setInterval: (fn: () => void) => (intervals.push(fn), intervals.length),
    rest: options.rest ?? (async () => ({ ok: true })),
    os: { writeClipboard: async () => true, openExternal: async () => true },
    storage: { get: () => undefined, set: () => undefined, remove: () => undefined }
  }
  return {
    ctx,
    live,
    tickIntervals: () => intervals.forEach(fn => fn()),
    dispose: () => disposers.forEach(fn => fn())
  }
}
