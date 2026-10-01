import { atom, type PluginContext, type PluginRestOptions } from '@hermes/plugin-sdk'

import { codeText } from './strings'

export interface Entry {
  name: string
  rel: string
  abs: string
  is_dir: boolean
  size: number
  mtime: number
  link_outside?: boolean
}

export interface Root {
  id: string
  label: string
  path: string
  notes?: Record<string, string>
}

export interface RootsResponse {
  ok: boolean
  supported?: boolean
  reason?: string
  roots: Root[]
  max_file_bytes: number
  chunk_bytes: number
  highlights?: string[]
  code?: string
  message?: string
}

export interface ListResponse {
  ok: boolean
  entries: Entry[]
  total: number
  truncated: boolean
}

export interface SearchResponse {
  ok: boolean
  results: Entry[]
  truncated: boolean
}

/** An in-band `{ok:false, code}` answer, raised so queries surface it as an error. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

let bound: null | PluginContext = null

/** Availability of the selected agent's backend: null until the first probe answers. */
export const $available = atom<boolean | null>(null)

export function bindContext(ctx: PluginContext) {
  bound = ctx
}

export function pluginCtx(): PluginContext {
  if (!bound) throw new Error('Cloud Files is not registered')
  return bound
}

export function rest<T>(path: string, opts?: PluginRestOptions): Promise<T> {
  return pluginCtx().rest<T>(path, opts)
}

/** GET/POST that turns an in-band failure into a thrown ApiError. */
export async function call<T extends { ok: boolean }>(path: string, opts?: PluginRestOptions): Promise<T> {
  const res = await rest<T & { code?: string; message?: string }>(path, opts)
  if (res && res.ok === false && res.code !== 'unsupported_backend') throw new ApiError(res.code ?? 'error', codeText(res.code, res.message))
  return res
}

export const query = (path: string, params: Record<string, number | string>) =>
  `${path}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}`

export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
