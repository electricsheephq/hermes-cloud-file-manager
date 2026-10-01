// Minimal hand-written types for the parts of Hermes Desktop's '@hermes/plugin-sdk' this plugin uses.
// The SDK is not published as a package; `npm run check:sdk` verifies every name imported from it is
// really exported by the pinned upstream and fork SDKs (apps/desktop/src/sdk/index.ts).
declare module '@hermes/plugin-sdk' {
  import type { ComponentType, ReactNode } from 'react'

  export interface ReadableAtom<T> {
    get(): T
    subscribe(listener: (value: T) => void): () => void
  }
  export interface WritableAtom<T> extends ReadableAtom<T> {
    set(value: T): void
  }
  export function atom<T>(initial: T): WritableAtom<T>
  export function useValue<T>(store: ReadableAtom<T>): T

  export interface Contribution<D = unknown> {
    id: string
    area: string
    title?: string
    order?: number
    render?: (props?: any) => ReactNode
    data?: D
  }

  export interface PluginRestOptions {
    method?: string
    body?: unknown
    timeoutMs?: number
  }

  export interface PluginOs {
    writeClipboard(text: string): Promise<boolean>
    openExternal(url: string): Promise<boolean>
  }

  export interface PluginStorage {
    get<T = unknown>(key: string): T | undefined
    set(key: string, value: unknown): void
    remove(key: string): void
  }

  export interface PluginContext {
    register(contribution: Contribution<any>): () => void
    onDispose(fn: () => void): void
    setTimeout(fn: () => void, ms: number): number
    setInterval(fn: () => void, ms: number): number
    rest<T = unknown>(path: string, opts?: PluginRestOptions): Promise<T>
    os: PluginOs
    storage: PluginStorage
  }

  export interface HermesPlugin {
    id: string
    name?: string
    description?: string
    defaultEnabled?: boolean
    register(ctx: PluginContext): void | Promise<void>
  }

  export interface FocusedSessionOwner {
    connectionId: null | string
    profile: string
  }

  export const host: {
    state: {
      connectionId: ReadableAtom<null | string>
      profile: ReadableAtom<string>
      focusedSessionOwner: ReadableAtom<FocusedSessionOwner | null>
    }
    notify(note: { kind?: 'info' | 'success' | 'warning' | 'error'; title?: string; message: string }): void
    navigate(path: string): void
  }

  export const ROUTES_AREA: 'routes'
  export const SIDEBAR_NAV_AREA: 'sidebar.nav'
  export const COMPOSER_AREAS: {
    readonly underside: 'composer.underside'
    readonly attachments: 'composer.attachments'
    readonly [key: string]: string
  }

  export interface RouteContribution {
    path: string
  }
  export interface SidebarNavContribution {
    codicon: string
    label: string
    path: string
    tier?: 'advanced'
  }
  export interface ComposerAttachmentContext {
    insertText(text: string): void
  }
  export interface ComposerAttachmentProvider {
    label: string
    icon?: string
    run(ctx: ComposerAttachmentContext): void | Promise<void>
  }

  // UI kit: loosely typed on purpose; the app owns the real props.
  export const Button: ComponentType<any>
  export const Codicon: ComponentType<any>
  export const EmptyState: ComponentType<any>
  export const SearchField: ComponentType<any>
}
