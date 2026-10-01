import {
  type HermesPlugin,
  host,
  type PluginContext,
  type RouteContribution,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  type SidebarNavContribution
} from '@hermes/plugin-sdk'

export const PLUGIN_ID = 'hermes-cloud-file-manager'
export const PAGE_PATH = '/cloud-files'
const PROBE_INTERVAL_MS = 60_000

/** True when `error` is the backend saying "this plugin is not mounted here" (a definite 404).
 *  HTTP status reaches the renderer only inside the IPC error text, e.g. "... Error: 404: {...}". */
export function isNotFoundError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error)
  return /(^|\D)404(\D|$)/.test(text)
}

function CloudFilesPage() {
  return <section style={{ padding: 24, color: 'var(--ui-text-secondary)' }}>Cloud Files</section>
}

/** Sidebar row only while the selected agent's backend answers /available; the route stays registered so a
 *  restored /cloud-files never falls through to the session route. Transport errors keep the last answer. */
export function registerAvailabilityGate(ctx: PluginContext, onChange?: (available: boolean) => void) {
  let removeNav: (() => void) | null = null
  let disposed = false

  const set = (available: boolean) => {
    if (disposed) return
    if (available && !removeNav) {
      removeNav = ctx.register({
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        order: 45,
        data: { codicon: 'cloud', label: 'Cloud Files', path: PAGE_PATH } satisfies SidebarNavContribution
      })
      onChange?.(true)
    } else if (!available && removeNav) {
      removeNav()
      removeNav = null
      onChange?.(false)
    }
  }

  const probe = () =>
    ctx.rest('/available').then(
      () => set(true),
      error => {
        if (isNotFoundError(error)) set(false)
      }
    )

  void probe()
  ctx.setInterval(() => void probe(), PROBE_INTERVAL_MS)
  const unsubscribers = [host.state.profile.subscribe(() => void probe()), host.state.connectionId.subscribe(() => void probe())]
  ctx.onDispose(() => {
    disposed = true
    unsubscribers.forEach(stop => stop())
  })

  return { probe }
}

const plugin: HermesPlugin = {
  id: PLUGIN_ID,
  name: 'Cloud File Manager',
  description: 'Browse, search and bulk-upload files on the machine your agent runs on, and hand the agent file locations from the chat + menu.',
  register(ctx) {
    ctx.register({
      id: 'page',
      area: ROUTES_AREA,
      data: { path: PAGE_PATH } satisfies RouteContribution,
      render: () => <CloudFilesPage />
    })
    registerAvailabilityGate(ctx)
  }
}

export default plugin
