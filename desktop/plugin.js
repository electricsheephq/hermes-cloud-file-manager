// Generated from src/desktop by scripts/build-desktop.mjs. Do not edit by hand.

// src/desktop/plugin.tsx
import {
  host,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA
} from "@hermes/plugin-sdk";
import { jsx } from "react/jsx-runtime";
var PLUGIN_ID = "hermes-cloud-file-manager";
var PAGE_PATH = "/cloud-files";
var PROBE_INTERVAL_MS = 6e4;
function isNotFoundError(error) {
  const text = error instanceof Error ? error.message : String(error);
  return /(^|\D)404(\D|$)/.test(text);
}
function CloudFilesPage() {
  return /* @__PURE__ */ jsx("section", { style: { padding: 24, color: "var(--ui-text-secondary)" }, children: "Cloud Files" });
}
function registerAvailabilityGate(ctx, onChange) {
  let removeNav = null;
  let disposed = false;
  const set = (available) => {
    if (disposed) return;
    if (available && !removeNav) {
      removeNav = ctx.register({
        id: "nav",
        area: SIDEBAR_NAV_AREA,
        order: 45,
        data: { codicon: "cloud", label: "Cloud Files", path: PAGE_PATH }
      });
      onChange?.(true);
    } else if (!available && removeNav) {
      removeNav();
      removeNav = null;
      onChange?.(false);
    }
  };
  let generation = 0;
  const probe = () => {
    const mine = ++generation;
    return ctx.rest("/available").then(
      () => {
        if (mine === generation) set(true);
      },
      (error) => {
        if (mine === generation && isNotFoundError(error)) set(false);
      }
    );
  };
  void probe();
  ctx.setInterval(() => void probe(), PROBE_INTERVAL_MS);
  const unsubscribers = [host.state.profile.subscribe(() => void probe()), host.state.connectionId.subscribe(() => void probe())];
  ctx.onDispose(() => {
    disposed = true;
    unsubscribers.forEach((stop) => stop());
  });
  return { probe };
}
var plugin = {
  id: PLUGIN_ID,
  name: "Cloud File Manager",
  description: "Browse, search and bulk-upload files on the machine your agent runs on, and hand the agent file locations from the chat + menu.",
  register(ctx) {
    ctx.register({
      id: "page",
      area: ROUTES_AREA,
      data: { path: PAGE_PATH },
      render: () => /* @__PURE__ */ jsx(CloudFilesPage, {})
    });
    registerAvailabilityGate(ctx);
  }
};
var plugin_default = plugin;
export {
  PAGE_PATH,
  PLUGIN_ID,
  plugin_default as default,
  isNotFoundError,
  registerAvailabilityGate
};
