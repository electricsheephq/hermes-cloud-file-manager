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

import { $available, $driveAvailable, $unreachable, bindContext, isNotFoundError } from './api'
import { $driveJob } from './drive'
import { $batch, CloudFilesPage } from './page'
import { $pickerOpen, $pickerSource, closePicker, cloudProvider, driveProvider, PickerHost, pickerPinnedElsewhere } from './picker'
import { S } from './strings'

export const PLUGIN_ID = 'hermes-cloud-file-manager'
export const PAGE_PATH = '/cloud-files'
const PROBE_INTERVAL_MS = 60_000

export { isNotFoundError }

/** Sidebar row and "+ → Cloud" provider only while the selected agent's backend answers /available; an open
 *  picker pinned elsewhere keeps its host even after a negative answer. The route stays registered so a restored
 *  /cloud-files never falls through to the session route. Transport errors keep the last answer only for the same agent. While it is available, /drive/available (same triggers, same
 *  newest-probe-wins rule) adds "+ → Google Drive" and the page's Drive source; a 404 there means an older
 *  gateway half without Drive. */
export function registerAvailabilityGate(ctx: PluginContext, onChange?: (available: boolean | null) => void) {
  let removers: Array<() => void> | null = null
  let pickerRemover: null | (() => void) = null
  let known: boolean | null = null
  let disposed = false
  let driveRemover: null | (() => void) = null

  const setDrive = (available: boolean) => {
    if (disposed) return
    if ($driveAvailable.get() !== available) $driveAvailable.set(available)
    // An agent switch already dropped the provider, so a "no" for the picker's own agent closes it either way.
    if (!available && $pickerOpen.get() && $pickerSource.get() === 'drive' && !pickerPinnedElsewhere()) closePicker()
    if (available && !driveRemover) {
      driveRemover = ctx.register({ id: 'attach-drive', area: COMPOSER_AREAS.attachments, data: driveProvider })
    } else if (!available && driveRemover) {
      driveRemover()
      driveRemover = null
    }
  }

  const set = (available: boolean | null) => {
    if (disposed) return
    if (available === false) setDrive(false)
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
        ctx.register({ id: 'attach-cloud', area: COMPOSER_AREAS.attachments, data: cloudProvider })
      ]
    } else if (!available && removers) {
      removers.forEach(remove => remove())
      removers = null
    }
    if (available && !pickerRemover) {
      pickerRemover = ctx.register({ id: 'picker-host', area: COMPOSER_AREAS.underside, render: () => <PickerHost /> })
    } else if (available === false && !pickerPinnedElsewhere()) {
      closePicker()
      pickerRemover?.()
      pickerRemover = null
    }
  }

  // Only the newest probe may change the row: when the agent changes mid-flight, a late answer about the
  // previous agent must not show or hide the row for the current one.
  let generation = 0
  const probe = (): Promise<void> => {
    const mine = ++generation
    // Answered (`ok`) or failed in transport, for the newest probe only: the open picker's error state follows it.
    const settle = (which: 'cloud' | 'drive', ok: boolean) => {
      if (mine !== generation || disposed) return
      if (!ok) $unreachable.set({ probe: which, retry: () => ($unreachable.set(null), void probe()) })
      else if ($unreachable.get()?.probe === which) $unreachable.set(null)
    }
    return ctx.rest('/available').then(
      () => {
        if (mine !== generation || disposed) return
        settle('cloud', true)
        set(true)
        return ctx.rest<{ available?: boolean }>('/drive/available').then(
          res => {
            settle('drive', true)
            if (mine === generation) setDrive(res?.available === true)
          },
          error => {
            settle('drive', isNotFoundError(error))
            if (mine === generation && isNotFoundError(error)) setDrive(false)
          }
        )
      },
      error => {
        settle('cloud', isNotFoundError(error))
        if (mine === generation && isNotFoundError(error)) set(false)
      }
    )
  }

  void probe()
  ctx.setInterval(() => void probe(), PROBE_INTERVAL_MS)
  // listen, not subscribe: Nano Stores' subscribe also fires at once, which would triple the first probe.
  // A new agent starts without Drive until its own probe answers: one agent's Drive answer never carries over
  // to another, even when the new probe is slow or fails in transport. An open Drive picker stays (pinned and
  // paused) even if the new agent has no Cloud Files or Drive; only its pinned agent's no closes it.
  const onAgentChange = () => {
    if (!disposed) {
      set(null)
      $unreachable.set(null)
      if ($driveAvailable.get() !== null) $driveAvailable.set(null)
      driveRemover?.()
      driveRemover = null
    }
    void probe()
  }
  const unsubscribers = [
    host.state.profile.listen(onAgentChange), host.state.connectionId.listen(onAgentChange),
    $pickerOpen.listen(open => {
      if (!open && known === false && !disposed) {
        pickerRemover?.()
        pickerRemover = null
      }
    })
  ]
  ctx.onDispose(() => {
    disposed = true
    unsubscribers.forEach(stop => stop())
    $unreachable.set(null)
    closePicker()
    $batch.get()?.cancel()
    $batch.set(null)
    $driveJob.get()?.cancel()
    $driveJob.set(null)
  })

  return { probe }
}

const plugin: HermesPlugin = {
  id: PLUGIN_ID,
  name: 'Cloud File Manager',
  description: 'Browse, search, upload and edit files on the machine your agent runs on, and hand the agent file locations from the chat + menu.',
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
