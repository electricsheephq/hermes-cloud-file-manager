import {
  COMPOSER_AREAS,
  type HermesPlugin,
  host,
  type PluginContext,
  type RouteContribution,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  type SidebarNavContribution
} from '@hermes/plugin-sdk'

import { $available, bindContext, isNotFoundError } from './api'
import { CloudFilesPage } from './page'
import { $insertText, $pickerOpen, cloudProvider, PickerHost } from './picker'
import { S } from './strings'

export const PLUGIN_ID = 'hermes-cloud-file-manager'
export const PAGE_PATH = '/cloud-files'
const PROBE_INTERVAL_MS = 60_000

export { isNotFoundError }

/** Sidebar row, "+ → Cloud" provider and the picker host only while the selected agent's backend answers
 *  /available; the route stays registered so a restored /cloud-files never falls through to the session
 *  route. Transport errors keep the last answer. */
export function registerAvailabilityGate(ctx: PluginContext, onChange?: (available: boolean) => void) {
  let removers: Array<() => void> | null = null
  let known: boolean | null = null
  let disposed = false

  const set = (available: boolean) => {
    if (disposed) return
    if (available !== known) {
      known = available
      onChange?.(available)
    }
    if (available && !removers) {
      removers = [
        ctx.register({
          id: 'nav',
          area: SIDEBAR_NAV_AREA,
          order: 45,
          data: { codicon: 'cloud', label: S.navLabel, path: PAGE_PATH } satisfies SidebarNavContribution
        }),
        ctx.register({ id: 'attach-cloud', area: COMPOSER_AREAS.attachments, data: cloudProvider }),
        ctx.register({ id: 'picker-host', area: COMPOSER_AREAS.underside, render: () => <PickerHost /> })
      ]
    } else if (!available && removers) {
      // Close the picker and forget the old composer's insertText first: otherwise the stale picker
      // would reopen on the next available flip and could insert into a composer that is gone.
      $pickerOpen.set(false)
      $insertText.set(null)
      removers.forEach(remove => remove())
      removers = null
    }
  }

  // Only the newest probe may change the row: when the agent changes mid-flight, a late answer about the
  // previous agent must not show or hide the row for the current one.
  let generation = 0
  const probe = () => {
    const mine = ++generation
    return ctx.rest('/available').then(
      () => {
        if (mine === generation) set(true)
      },
      error => {
        if (mine === generation && isNotFoundError(error)) set(false)
      }
    )
  }

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
    bindContext(ctx)
    ctx.register({
      id: 'page',
      area: ROUTES_AREA,
      data: { path: PAGE_PATH } satisfies RouteContribution,
      render: () => <CloudFilesPage />
    })
    registerAvailabilityGate(ctx, available => $available.set(available))
  }
}

export default plugin
