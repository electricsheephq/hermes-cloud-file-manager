// Generated from src/desktop by scripts/build-desktop.mjs. Do not edit by hand.

// src/desktop/plugin.tsx
import {
  COMPOSER_AREAS,
  host as host4,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA
} from "@hermes/plugin-sdk";

// src/desktop/api.ts
import { atom } from "@hermes/plugin-sdk";

// src/desktop/strings.ts
var mb = (bytes) => `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
var S = {
  title: "Cloud Files",
  navLabel: "Cloud Files",
  providerLabel: "Cloud",
  notSetUp: (agent) => `Cloud Files isn't set up on ${agent} yet. Install the plugin on the agent's gateway, add it to \`plugins.enabled\`, and restart the gateway.`,
  unsupportedTitle: "Cloud Files can't browse this agent's machine",
  loadFailed: "Couldn't load files",
  retry: "Retry",
  root: "Folder",
  search: "Search files",
  newFolder: "New folder",
  uploadFiles: "Upload files",
  uploadFolder: "Upload folder",
  copyPath: "Copy path",
  maxPerFile: (bytes) => `Up to ${mb(bytes)} per file`,
  emptyFolder: "This folder is empty \u2014 drop files here or use Upload",
  noResults: "No matching files",
  truncated: (n) => `Showing the first ${n} items`,
  dropTo: (folder) => `Drop to upload to ${folder}`,
  copied: (n) => n === 1 ? "Path copied" : `${n} paths copied`,
  copyFailed: "Couldn't copy to the clipboard",
  breadcrumbs: "Folder path",
  uploads: "Uploads",
  expand: "Show uploads",
  collapse: "Hide uploads",
  // New folder dialog
  folderName: "Folder name",
  create: "Create",
  cancel: "Cancel",
  nameRequired: "Enter a name",
  nameNoSlash: "A folder name cannot contain /",
  folderCreated: (name) => `Created ${name}`,
  // Upload drawer
  uploading: (n, total, sent, size) => `Uploading ${n} of ${total} \xB7 ${sent} of ${size}`,
  uploaded: (done, total, failed) => `Uploaded ${done} of ${total}${failed ? ` \xB7 ${failed} failed` : ""}`,
  canceled: "Upload canceled",
  paused: (profile) => `Switch back to ${profile} to continue uploading`,
  busyElsewhere: "Finish or cancel the current uploads first",
  queued: "Queued",
  done: "Done",
  savedAs: (name) => `Saved as "${name}"`,
  failed: (reason) => `Failed: ${reason}`,
  canceledItem: "Canceled",
  clear: "Clear",
  tooLarge: (max) => `Too large (max ${mb(max)})`,
  // Picker
  pickerTitle: "Attach from Cloud Files",
  selected: (n) => `${n} selected`,
  insert: "Insert locations",
  ownerMismatch: (owner, profile) => `This chat belongs to ${owner}. Cloud Files is showing ${profile}'s files \u2014 switch to ${owner} in the sidebar first.`,
  insertHeader: (profile) => `Cloud files on ${profile}'s machine:`
};
var CODE_TEXT = {
  exists_file: "A file with that name already exists",
  bad_path: "That name or path is not allowed",
  protected: "That location is protected",
  outside_root: "That location is outside the agent\u2019s folders",
  too_large: "The file is too large",
  bad_data: "The upload data was corrupted",
  gone: "The upload expired on the server",
  size_mismatch: "The file size changed during upload",
  unsupported_backend: "This agent\u2019s storage is not supported",
  unknown_root: "That folder is no longer available",
  not_a_dir: "That is not a folder",
  is_link: "That item is a link outside the agent\u2019s folders",
  bad_query: "That search is not valid"
};
var codeText = (code, message) => code && CODE_TEXT[code] || message || code || "Something went wrong";

// src/desktop/api.ts
var ApiError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
};
var bound = null;
var $available = atom(null);
function bindContext(ctx) {
  bound = ctx;
}
function pluginCtx() {
  if (!bound) throw new Error("Cloud Files is not registered");
  return bound;
}
function rest(path, opts) {
  return pluginCtx().rest(path, opts);
}
async function call(path, opts) {
  const res = await rest(path, opts);
  if (res && res.ok === false && res.code !== "unsupported_backend") throw new ApiError(res.code ?? "error", codeText(res.code, res.message));
  return res;
}
var query = (path, params) => `${path}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}`;
var errorText = (error) => error instanceof Error ? error.message : String(error);

// src/desktop/page.tsx
import {
  atom as atom2,
  Button as Button2,
  Codicon as Codicon2,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState as EmptyState2,
  ErrorState as ErrorState2,
  host as host2,
  Input,
  Skeleton as Skeleton2,
  useQueryClient,
  useValue as useValue2
} from "@hermes/plugin-sdk";
import { useEffect as useEffect2, useRef, useState as useState2, useSyncExternalStore } from "react";

// src/desktop/browser.tsx
import {
  Button,
  Checkbox,
  Codicon,
  EmptyState,
  ErrorState,
  host,
  SearchField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  useQuery,
  useValue
} from "@hermes/plugin-sdk";
import { useEffect, useMemo, useState } from "react";

// src/desktop/format.ts
var TICK = "`";
function formatLocation({ abs, is_dir }) {
  const path = is_dir && !abs.endsWith("/") ? `${abs}/` : abs;
  const [open, close2] = path.includes(TICK) ? [`${TICK}${TICK} `, ` ${TICK}${TICK}`] : [TICK, TICK];
  return `- ${open}${path}${close2}`;
}
function formatInsertText(profile, items) {
  return `
${S.insertHeader(profile)}
${items.map(formatLocation).join("\n")}`;
}
function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
function shortDate(mtime, now = /* @__PURE__ */ new Date()) {
  const date = new Date(mtime * 1e3);
  if (Number.isNaN(date.getTime())) return "";
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString(void 0, { hour: "numeric", minute: "2-digit" });
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(void 0, { month: "short", day: "numeric", ...sameYear ? {} : { year: "numeric" } });
}
function joinPath(...parts) {
  return parts.flatMap((part) => part.split("/")).filter(Boolean).join("/");
}
function parentPath(rel) {
  const parts = rel.split("/").filter(Boolean);
  return parts.slice(0, -1).join("/");
}
function baseName(rel) {
  const parts = rel.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}
var MEDIA = /* @__PURE__ */ new Set(["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "svg", "tif", "tiff", "mp4", "mov", "m4v", "webm", "mkv", "avi"]);
function entryIcon(entry) {
  if (entry.link_outside) return "link";
  if (entry.is_dir) return "folder";
  const dot = entry.name.lastIndexOf(".");
  return dot > 0 && MEDIA.has(entry.name.slice(dot + 1).toLowerCase()) ? "file-media" : "file";
}

// src/desktop/browser.tsx
import { jsx, jsxs } from "react/jsx-runtime";
var LIST_LIMIT = 500;
var SEARCH_LIMIT = 200;
var DEBOUNCE_MS = 300;
function useScope() {
  const connectionId = useValue(host.state.connectionId);
  const profile = useValue(host.state.profile);
  return [connectionId ?? "local", profile];
}
function useRoots() {
  const scope = useScope();
  return useQuery({ queryKey: ["hcfm", ...scope, "roots"], queryFn: () => call("/roots"), retry: 1 });
}
function useDebounced(value, ms) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
function useBrowser(roots, mode) {
  const [rootId, setRootId] = useState(roots.roots[0]?.id ?? "");
  const root = roots.roots.find((r) => r.id === rootId) ?? roots.roots[0];
  const [path, setPath] = useState("");
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search.trim(), DEBOUNCE_MS);
  const [selected, setSelected] = useState(/* @__PURE__ */ new Map());
  const navigate = (next) => {
    setPath(next);
    setSearch("");
    if (mode === "page") setSelected(/* @__PURE__ */ new Map());
  };
  return {
    roots,
    root,
    path,
    search,
    query: search.trim() ? debounced : "",
    selected,
    mode,
    setSearch,
    navigate,
    switchRoot: (id) => {
      setRootId(id);
      navigate("");
      setSelected(/* @__PURE__ */ new Map());
    },
    toggle: (entry) => setSelected((prev) => {
      const next = new Map(prev);
      if (!next.delete(entry.abs)) next.set(entry.abs, entry);
      return next;
    }),
    selectOnly: (entry) => setSelected(/* @__PURE__ */ new Map([[entry.abs, entry]]))
  };
}
var muted = { color: "var(--ui-text-tertiary)" };
var ellipsis = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
function RootSelect({ b }) {
  if (b.roots.roots.length < 2) return null;
  return /* @__PURE__ */ jsxs(Select, { onValueChange: b.switchRoot, value: b.root?.id, children: [
    /* @__PURE__ */ jsx(SelectTrigger, { "aria-label": S.root, size: "sm", children: /* @__PURE__ */ jsx(SelectValue, {}) }),
    /* @__PURE__ */ jsx(SelectContent, { children: b.roots.roots.map((root) => /* @__PURE__ */ jsx(SelectItem, { value: root.id, children: root.label }, root.id)) })
  ] });
}
function Breadcrumbs({ b }) {
  const parts = b.path.split("/").filter(Boolean);
  const crumbs = [{ label: b.root?.label ?? "", path: "" }, ...parts.map((part, i) => ({ label: part, path: parts.slice(0, i + 1).join("/") }))];
  return /* @__PURE__ */ jsx("nav", { "aria-label": S.breadcrumbs, style: { display: "flex", alignItems: "center", gap: 2, minWidth: 0, flex: 1, fontSize: 12, ...ellipsis }, children: crumbs.map((crumb, i) => {
    const last = i === crumbs.length - 1;
    return /* @__PURE__ */ jsxs("span", { style: { display: "inline-flex", alignItems: "center", gap: 2, minWidth: 0 }, children: [
      i > 0 && /* @__PURE__ */ jsx(Codicon, { name: "chevron-right", size: "0.75rem", style: muted }),
      last && !b.query ? /* @__PURE__ */ jsx("span", { style: { ...ellipsis, color: "var(--ui-text-primary)", fontWeight: 500 }, children: crumb.label }) : /* @__PURE__ */ jsx(Button, { onClick: () => b.navigate(crumb.path), size: "inline", variant: "text", children: crumb.label })
    ] }, crumb.path || "/");
  }) });
}
function BrowserSearch({ b }) {
  return /* @__PURE__ */ jsx("span", { onKeyDown: (event) => event.key === "Escape" && b.setSearch(""), children: /* @__PURE__ */ jsx(SearchField, { "aria-label": S.search, onChange: b.setSearch, placeholder: S.search, value: b.search }) });
}
function sortEntries(entries, highlights, atRoot) {
  const rank = (entry) => atRoot && entry.is_dir && highlights.includes(entry.name) ? highlights.indexOf(entry.name) : highlights.length;
  return [...entries].sort((a, b) => rank(a) - rank(b) || Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name));
}
function EntryList({ b, height }) {
  const [connectionId, profile] = useScope();
  const rootId = b.root?.id ?? "";
  const searching = Boolean(b.query);
  const listing = useQuery({
    queryKey: ["hcfm", connectionId, profile, "list", rootId, b.path],
    queryFn: () => call(query("/list", { root: rootId, path: b.path, offset: 0, limit: LIST_LIMIT })),
    enabled: Boolean(rootId) && !searching,
    retry: 1
  });
  const found = useQuery({
    queryKey: ["hcfm", connectionId, profile, "search", rootId, b.query],
    queryFn: () => call(query("/search", { root: rootId, q: b.query, limit: SEARCH_LIMIT })),
    enabled: Boolean(rootId) && searching,
    retry: 1
  });
  const active = searching ? found : listing;
  const entries = useMemo(() => {
    if (searching) return found.data?.results ?? [];
    return sortEntries(listing.data?.entries ?? [], b.roots.highlights ?? [], b.path === "");
  }, [searching, found.data, listing.data, b.roots.highlights, b.path]);
  const truncated = searching ? found.data?.truncated : listing.data?.truncated;
  const open = (entry) => {
    if (!entry.is_dir || entry.link_outside) return;
    b.navigate(entry.rel);
  };
  let body;
  if (active.error) {
    body = /* @__PURE__ */ jsx("div", { style: { padding: 32 }, children: /* @__PURE__ */ jsx(ErrorState, { description: errorText(active.error), title: S.loadFailed, children: /* @__PURE__ */ jsx(Button, { onClick: () => void active.refetch(), size: "sm", variant: "secondary", children: S.retry }) }) });
  } else if (!active.data) {
    body = /* @__PURE__ */ jsx("div", { "aria-busy": "true", style: { display: "grid", gap: 6, padding: "8px 12px" }, children: [0, 1, 2, 3, 4].map((i) => /* @__PURE__ */ jsx(Skeleton, { style: { height: 18, opacity: 1 - i * 0.15 } }, i)) });
  } else if (!entries.length) {
    body = /* @__PURE__ */ jsx(EmptyState, { title: searching ? S.noResults : S.emptyFolder });
  } else {
    body = /* @__PURE__ */ jsxs("div", { role: "list", children: [
      entries.map((entry) => /* @__PURE__ */ jsx(EntryRow, { b, entry, onOpen: open, searching }, entry.abs)),
      truncated && /* @__PURE__ */ jsx("div", { style: { ...muted, fontSize: 11, padding: "8px 12px" }, children: S.truncated(entries.length) })
    ] });
  }
  return /* @__PURE__ */ jsx("div", { style: { overflowY: "auto", overflowX: "hidden", ...height ? { height } : { flex: 1, minHeight: 0 } }, children: body });
}
function EntryRow({ b, entry, onOpen, searching }) {
  const [hover, setHover] = useState(false);
  const checked = b.selected.has(entry.abs);
  const note = !searching && b.path === "" ? b.root?.notes?.[entry.rel] ?? b.root?.notes?.[entry.name] : void 0;
  const secondary = searching ? parentPath(entry.rel) || b.root?.label : note;
  const click = () => {
    if (searching && entry.is_dir && !entry.link_outside) return onOpen(entry);
    if (b.mode === "pick") b.toggle(entry);
    else b.selectOnly(entry);
  };
  return /* @__PURE__ */ jsxs(
    "div",
    {
      "aria-selected": checked,
      "data-entry": entry.rel,
      onClick: click,
      onDoubleClick: () => onOpen(entry),
      onKeyDown: (event) => {
        if (event.key === "Enter") onOpen(entry);
        if (event.key === " ") {
          event.preventDefault();
          b.toggle(entry);
        }
      },
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
      role: "listitem",
      style: {
        display: "grid",
        gridTemplateColumns: "16px 16px minmax(0, 1fr) 72px 96px",
        alignItems: "center",
        gap: 8,
        minHeight: 28,
        padding: "3px 12px",
        fontSize: 12,
        cursor: "default",
        userSelect: "none",
        opacity: entry.link_outside ? 0.5 : 1,
        background: checked ? "var(--ui-row-active-background)" : hover ? "var(--ui-row-hover-background)" : void 0
      },
      tabIndex: 0,
      children: [
        /* @__PURE__ */ jsx("span", { onClick: (event) => event.stopPropagation(), style: { display: "inline-flex" }, children: /* @__PURE__ */ jsx(Checkbox, { "aria-label": entry.name, checked, onCheckedChange: () => b.toggle(entry) }) }),
        /* @__PURE__ */ jsx(Codicon, { name: entryIcon(entry), size: "0.875rem", style: { color: entry.is_dir ? "var(--ui-accent)" : "var(--ui-text-secondary)" } }),
        /* @__PURE__ */ jsxs("span", { style: { display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }, children: [
          /* @__PURE__ */ jsx("span", { style: { ...ellipsis, color: "var(--ui-text-primary)" }, children: entry.name }),
          secondary && /* @__PURE__ */ jsx("span", { style: { ...ellipsis, ...muted, fontSize: 11 }, children: secondary })
        ] }),
        /* @__PURE__ */ jsx("span", { style: { ...muted, textAlign: "right", fontVariantNumeric: "tabular-nums" }, children: entry.is_dir ? "" : humanSize(entry.size) }),
        /* @__PURE__ */ jsx("span", { style: { ...muted, textAlign: "right", fontVariantNumeric: "tabular-nums" }, children: shortDate(entry.mtime) })
      ]
    }
  );
}

// src/desktop/upload.ts
var MIN_CHUNK = 256 * 1024;
var REQUEST_TIMEOUT_MS = 12e4;
var CONCURRENCY = 2;
var BACKOFF_MS = [1e3, 2e3, 4e3];
function readBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? "");
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}
function isShrinkError(error) {
  const text = error instanceof Error ? error.message : String(error);
  return /(^|\D)413(\D|$)/.test(text) || /timed?[ -]?out/i.test(text);
}
function transportText(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^Error invoking remote method \S+: /, "").replace(/^Error: /, "") || "Connection problem";
}
var Canceled = class extends Error {
};
var Shrink = class extends Error {
};
var UploadBatch = class {
  constructor(limits, deps) {
    this.limits = limits;
    this.deps = deps;
    this.readChunk = deps.readChunk ?? readBase64;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.snapshot = {
      profile: deps.state.profile.get(),
      connectionId: deps.state.connectionId.get(),
      items: [],
      running: false,
      paused: false,
      canceled: false
    };
  }
  limits;
  deps;
  snapshot;
  blobs = /* @__PURE__ */ new Map();
  inFlight = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  waiters = [];
  pool = null;
  nextId = 1;
  readChunk;
  sleep;
  getSnapshot = () => this.snapshot;
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  /** Queue files (and empty dirs) for a destination; oversize files fail before any request. */
  add(input, dest) {
    const items = [];
    for (const rel of input.dirs ?? []) {
      items.push({ id: this.nextId++, root: dest.root, path: joinPath(dest.folder, rel), size: 0, sent: 0, status: "queued", isDir: true });
    }
    for (const { file, rel } of input.files) {
      const id = this.nextId++;
      const tooBig = file.size > this.limits.max_file_bytes;
      this.blobs.set(id, file);
      items.push({
        id,
        root: dest.root,
        path: joinPath(dest.folder, rel),
        size: file.size,
        sent: 0,
        status: tooBig ? "failed" : "queued",
        ...tooBig ? { error: S.tooLarge(this.limits.max_file_bytes), retryable: false } : {}
      });
    }
    this.set({ items: [...this.snapshot.items, ...items] });
  }
  /** Run until every queued item is settled. Safe to call again (returns the running pool). */
  start() {
    if (this.pool) return this.pool;
    if (this.snapshot.canceled) return Promise.resolve();
    const wake = () => this.wake();
    const stops = [this.deps.state.connectionId.subscribe(wake), this.deps.state.profile.subscribe(wake)];
    this.set({ running: true });
    this.pool = this.drain().finally(() => {
      stops.forEach((stop) => stop());
      this.pool = null;
      this.set({ running: false, paused: false });
      if (!this.snapshot.canceled && this.snapshot.items.some((item) => item.status === "queued")) void this.start();
    });
    return this.pool;
  }
  retry(id) {
    const item = this.snapshot.items.find((it) => it.id === id);
    if (!item || item.status !== "failed" || item.retryable === false || this.snapshot.canceled) return;
    this.patch(id, { status: "queued", sent: 0, error: void 0 });
    void this.start();
  }
  cancel() {
    if (this.snapshot.canceled) return;
    this.set({
      canceled: true,
      items: this.snapshot.items.map((item) => item.status === "queued" || item.status === "uploading" ? { ...item, status: "canceled" } : item)
    });
    for (const id of [...this.inFlight.keys()]) this.abort(id);
    this.wake();
  }
  async drain() {
    for (const item of this.snapshot.items) {
      if (item.isDir && item.status === "queued") await this.guard(item.id, () => this.mkdir(item));
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => this.worker()));
  }
  async worker() {
    for (; ; ) {
      if (this.snapshot.canceled) return;
      const next = this.snapshot.items.find((item) => !item.isDir && item.status === "queued");
      if (!next) return;
      this.patch(next.id, { status: "uploading" });
      await this.guard(next.id, () => this.uploadFile(next));
    }
  }
  async guard(id, run) {
    try {
      await run();
    } catch (error) {
      if (error instanceof Canceled || this.snapshot.canceled) {
        this.abort(id);
        return;
      }
      this.fail(id, { error: transportText(error) });
    }
  }
  async mkdir(item) {
    const res = await this.send("/mkdir", { root: item.root, path: item.path }, false);
    if (res.ok) this.patch(item.id, { status: "done" });
    else this.fail(item.id, { error: codeText(res.code, res.message) });
  }
  async uploadFile(item) {
    const blob = this.blobs.get(item.id);
    const { root, path, size } = item;
    let chunk = Math.max(MIN_CHUNK, this.limits.chunk_bytes);
    let restarted = false;
    restart: for (; ; ) {
      this.patch(item.id, { sent: 0 });
      const started = await this.send("/uploads/start", { root, path, size }, false);
      if (!started.ok || !started.upload_id) return this.fail(item.id, { error: codeText(started.code, started.message) });
      const uploadId = started.upload_id;
      this.inFlight.set(item.id, uploadId);
      if (started.chunk_bytes) chunk = Math.min(chunk, Math.max(MIN_CHUNK, started.chunk_bytes));
      let offset = 0;
      for (; ; ) {
        if (offset >= size) {
          const fin = await this.send("/uploads/finish", { upload_id: uploadId, root, path, size }, false);
          if (fin.ok) {
            this.inFlight.delete(item.id);
            const finalName = baseName(fin.entry?.rel ?? fin.entry?.name ?? path);
            this.patch(item.id, { status: "done", sent: size, ...fin.renamed ? { savedAs: finalName } : {} });
            return;
          }
          if (fin.code === "size_mismatch" && typeof fin.size === "number" && fin.size < size) {
            offset = fin.size;
            this.patch(item.id, { sent: offset });
            continue;
          }
          if (fin.code === "gone" && !restarted) {
            restarted = true;
            this.inFlight.delete(item.id);
            continue restart;
          }
          return this.fail(item.id, { error: codeText(fin.code, fin.message) });
        }
        const data = await this.readChunk(blob.slice(offset, Math.min(size, offset + chunk)));
        let res;
        try {
          res = await this.send("/uploads/chunk", { upload_id: uploadId, root, path, offset, data }, chunk > MIN_CHUNK);
        } catch (error) {
          if (!(error instanceof Shrink)) throw error;
          chunk = Math.max(MIN_CHUNK, Math.floor(chunk / 2));
          continue;
        }
        if (res.ok && typeof res.size === "number" && res.size > offset) {
          offset = res.size;
          this.patch(item.id, { sent: offset });
        } else if (res.code === "offset" && typeof res.size === "number") {
          offset = res.size;
          this.patch(item.id, { sent: offset });
        } else if (res.code === "chunk_too_large" && chunk > MIN_CHUNK) {
          chunk = Math.max(MIN_CHUNK, Math.floor(chunk / 2));
        } else if (res.code === "gone" && !restarted) {
          restarted = true;
          this.inFlight.delete(item.id);
          continue restart;
        } else {
          return this.fail(item.id, { error: codeText(res.code, res.message) });
        }
      }
    }
  }
  /** POST with the agent pin, transport retries (1 s / 2 s / 4 s) and — for chunks above the floor — a
   *  Shrink signal on 413/timeout so the caller retries the same offset with half the chunk. */
  async send(path, body, canShrink) {
    for (let attempt = 0; ; attempt += 1) {
      await this.ready();
      try {
        return await this.deps.rest(path, { method: "POST", body, timeoutMs: REQUEST_TIMEOUT_MS });
      } catch (error) {
        if (this.snapshot.canceled) throw new Canceled();
        if (canShrink && isShrinkError(error)) throw new Shrink();
        if (attempt >= BACKOFF_MS.length) throw error;
        await this.sleep(BACKOFF_MS[attempt]);
      }
    }
  }
  matches() {
    return this.deps.state.connectionId.get() === this.snapshot.connectionId && this.deps.state.profile.get() === this.snapshot.profile;
  }
  /** Resolve once the pinned agent is selected again; throw if the batch is canceled meanwhile. */
  async ready() {
    while (!this.snapshot.canceled && !this.matches()) {
      if (!this.snapshot.paused) this.set({ paused: true });
      await new Promise((resolve) => this.waiters.push(resolve));
    }
    if (this.snapshot.canceled) throw new Canceled();
    if (this.snapshot.paused) this.set({ paused: false });
  }
  wake() {
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((resolve) => resolve());
  }
  /** Best-effort server-side cleanup of a temp upload; only while the pinned agent is selected. */
  abort(id) {
    const uploadId = this.inFlight.get(id);
    const item = this.snapshot.items.find((it) => it.id === id);
    this.inFlight.delete(id);
    if (!uploadId || !item || !this.matches()) return;
    void this.deps.rest("/uploads/abort", { method: "POST", body: { upload_id: uploadId, root: item.root, path: item.path } }).catch(() => void 0);
  }
  fail(id, { error }) {
    if (this.snapshot.canceled) return;
    this.abort(id);
    this.patch(id, { status: "failed", error });
  }
  patch(id, fields) {
    this.set({ items: this.snapshot.items.map((item) => item.id === id ? { ...item, ...fields } : item) });
  }
  set(fields) {
    this.snapshot = { ...this.snapshot, ...fields };
    this.listeners.forEach((listener) => listener());
  }
};
function summarize(snapshot) {
  const files = snapshot.items.filter((item) => !item.isDir);
  return {
    total: files.length,
    settled: files.filter((item) => item.status !== "queued" && item.status !== "uploading").length,
    done: files.filter((item) => item.status === "done").length,
    failed: files.filter((item) => item.status === "failed").length,
    sent: files.reduce((sum, item) => sum + item.sent, 0),
    size: files.reduce((sum, item) => sum + item.size, 0)
  };
}

// src/desktop/walk.ts
function collectDropEntries(transfer) {
  const entries = [];
  for (const item of Array.from(transfer.items ?? [])) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  return { entries, files: entries.length ? [] : Array.from(transfer.files ?? []) };
}
var readBatch = (reader) => new Promise((resolve, reject) => reader.readEntries(resolve, reject));
var fileOf = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));
async function walkEntries(entries) {
  const out = { files: [], dirs: [] };
  const visit = async (entry, prefix) => {
    const rel = joinPath(prefix, entry.name);
    if (entry.isFile && entry.file) {
      out.files.push({ file: await fileOf(entry), rel });
    } else if (entry.isDirectory && entry.createReader) {
      const reader = entry.createReader();
      let children = 0;
      for (let batch = await readBatch(reader); batch.length; batch = await readBatch(reader)) {
        children += batch.length;
        for (const child of batch) await visit(child, rel);
      }
      if (!children) out.dirs.push(rel);
    }
  };
  for (const entry of entries) await visit(entry, "");
  return out;
}
function filesFromInput(list) {
  return {
    files: Array.from(list).map((file) => ({
      file,
      rel: joinPath(file.webkitRelativePath || file.name)
    })),
    dirs: []
  };
}

// src/desktop/page.tsx
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var muted2 = { color: "var(--ui-text-tertiary)" };
var pad = "0 20px";
var $batch = atom2(null);
function enqueueUpload(input, dest, limits) {
  if (!input.files.length && !input.dirs?.length) return;
  const profile = host2.state.profile.get();
  const connectionId = host2.state.connectionId.get();
  let batch = $batch.get();
  const snap = batch?.getSnapshot();
  const sameAgent = snap?.profile === profile && snap?.connectionId === connectionId;
  if (snap?.running && !sameAgent) {
    host2.notify({ kind: "warning", message: S.busyElsewhere });
    return;
  }
  if (!batch || !snap || snap.canceled || !sameAgent) {
    batch = new UploadBatch(limits, { rest, state: host2.state });
    $batch.set(batch);
  }
  batch.add(input, dest);
  void batch.start();
}
function CloudFilesPage() {
  const available = useValue2($available);
  const profile = useValue2(host2.state.profile);
  const connectionId = useValue2(host2.state.connectionId);
  if (available === false) {
    return /* @__PURE__ */ jsx2(Frame, { profile, children: /* @__PURE__ */ jsx2("p", { style: { ...muted2, fontSize: 13, padding: pad, maxWidth: 560, lineHeight: 1.5 }, children: S.notSetUp(profile) }) });
  }
  return /* @__PURE__ */ jsx2(PageBody, { profile }, `${connectionId ?? "local"}::${profile}`);
}
function PageBody({ profile }) {
  const roots = useRoots();
  if (roots.error) {
    return /* @__PURE__ */ jsx2(Frame, { profile, children: /* @__PURE__ */ jsx2("div", { style: { padding: 32 }, children: /* @__PURE__ */ jsx2(ErrorState2, { description: errorText(roots.error), title: S.loadFailed, children: /* @__PURE__ */ jsx2(Button2, { onClick: () => void roots.refetch(), size: "sm", variant: "secondary", children: S.retry }) }) }) });
  }
  if (!roots.data) {
    return /* @__PURE__ */ jsx2(Frame, { profile, children: /* @__PURE__ */ jsx2("div", { "aria-busy": "true", style: { display: "grid", gap: 6, padding: pad }, children: [0, 1, 2].map((i) => /* @__PURE__ */ jsx2(Skeleton2, { style: { height: 18 } }, i)) }) });
  }
  if (roots.data.supported === false || roots.data.code === "unsupported_backend" || !roots.data.roots?.length) {
    return /* @__PURE__ */ jsx2(Frame, { profile, children: /* @__PURE__ */ jsx2(EmptyState2, { description: roots.data.reason ?? codeText(roots.data.code, roots.data.message), title: S.unsupportedTitle }) });
  }
  return /* @__PURE__ */ jsx2(Files, { profile, roots: roots.data });
}
function Frame({ children, profile, controls, onDropInput, dropLabel }) {
  const [over, setOver] = useState2(false);
  const depth = useRef(0);
  const dragOver = (event) => {
    event.preventDefault();
    if (onDropInput) event.dataTransfer.dropEffect = "copy";
  };
  const drop = (event) => {
    event.preventDefault();
    depth.current = 0;
    setOver(false);
    if (!onDropInput) return;
    const { entries, files } = collectDropEntries(event.dataTransfer);
    onDropInput(entries.length ? walkEntries(entries) : Promise.resolve(filesFromInput(files)));
  };
  return /* @__PURE__ */ jsxs2(
    "section",
    {
      onDragEnter: (event) => {
        event.preventDefault();
        depth.current += 1;
        if (onDropInput && event.dataTransfer.types.includes("Files")) setOver(true);
      },
      onDragLeave: () => {
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      },
      onDragOver: dragOver,
      onDrop: drop,
      style: { position: "relative", display: "flex", flexDirection: "column", height: "100%", minHeight: 0, color: "var(--ui-text-primary)" },
      children: [
        /* @__PURE__ */ jsxs2("header", { style: { display: "flex", alignItems: "center", gap: 10, padding: "18px 20px 10px" }, children: [
          /* @__PURE__ */ jsx2("h1", { style: { margin: 0, fontSize: 15, fontWeight: 600 }, children: S.title }),
          /* @__PURE__ */ jsx2("span", { style: { ...muted2, fontSize: 12 }, children: profile }),
          /* @__PURE__ */ jsx2("span", { style: { marginLeft: "auto" }, children: controls })
        ] }),
        children,
        over && /* @__PURE__ */ jsx2(
          "div",
          {
            style: {
              position: "absolute",
              inset: 8,
              display: "grid",
              placeItems: "center",
              border: "1.5px dashed var(--ui-accent)",
              borderRadius: 8,
              background: "color-mix(in srgb, var(--ui-accent) 8%, transparent)",
              color: "var(--ui-text-primary)",
              fontSize: 13,
              fontWeight: 500,
              pointerEvents: "none"
            },
            children: dropLabel
          }
        )
      ]
    }
  );
}
function Files({ profile, roots }) {
  const b = useBrowser(roots, "page");
  const queryClient = useQueryClient();
  const [newFolder, setNewFolder] = useState2(false);
  const filesInput = useRef(null);
  const folderInput = useRef(null);
  const rootId = b.root?.id ?? "";
  const limits = { max_file_bytes: roots.max_file_bytes, chunk_bytes: roots.chunk_bytes };
  const here = baseName(b.path) || b.root?.label || "";
  const dest = { root: rootId, folder: b.path };
  const fromInput = (input) => {
    if (!input?.files) return;
    enqueueUpload(filesFromInput(input.files), dest, limits);
    input.value = "";
  };
  const copyPaths = () => {
    const text = [...b.selected.keys()].join("\n");
    void pluginCtx().os.writeClipboard(text).then((ok) => host2.notify(ok ? { kind: "success", message: S.copied(b.selected.size) } : { kind: "error", message: S.copyFailed }));
  };
  return /* @__PURE__ */ jsxs2(
    Frame,
    {
      controls: /* @__PURE__ */ jsx2(RootSelect, { b }),
      dropLabel: S.dropTo(here),
      onDropInput: (pending) => void pending.then((input) => enqueueUpload(input, dest, limits), (error) => host2.notify({ kind: "error", message: errorText(error) })),
      profile,
      children: [
        /* @__PURE__ */ jsxs2("div", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "0 20px 8px", borderBottom: "1px solid var(--ui-stroke-tertiary)" }, children: [
          /* @__PURE__ */ jsx2(Breadcrumbs, { b }),
          /* @__PURE__ */ jsx2(BrowserSearch, { b }),
          /* @__PURE__ */ jsx2(ToolButton, { icon: "new-folder", label: S.newFolder, onClick: () => setNewFolder(true) }),
          /* @__PURE__ */ jsx2(ToolButton, { icon: "cloud-upload", label: S.uploadFiles, onClick: () => filesInput.current?.click() }),
          /* @__PURE__ */ jsx2(ToolButton, { icon: "file-directory-create", label: S.uploadFolder, onClick: () => folderInput.current?.click() }),
          /* @__PURE__ */ jsx2(ToolButton, { disabled: !b.selected.size, icon: "copy", label: S.copyPath, onClick: copyPaths }),
          /* @__PURE__ */ jsx2("input", { hidden: true, multiple: true, onChange: (event) => fromInput(event.currentTarget), ref: filesInput, type: "file" }),
          /* @__PURE__ */ jsx2(
            "input",
            {
              hidden: true,
              multiple: true,
              onChange: (event) => fromInput(event.currentTarget),
              ref: folderInput,
              type: "file",
              ...{ webkitdirectory: "" }
            }
          )
        ] }),
        /* @__PURE__ */ jsx2("div", { style: { ...muted2, fontSize: 11, padding: "4px 20px", textAlign: "right" }, children: S.maxPerFile(roots.max_file_bytes) }),
        /* @__PURE__ */ jsx2(EntryList, { b }),
        /* @__PURE__ */ jsx2(UploadDrawer, { onSettled: () => void queryClient.invalidateQueries({ queryKey: ["hcfm"] }) }),
        /* @__PURE__ */ jsx2(
          NewFolderDialog,
          {
            b,
            onCreated: () => void queryClient.invalidateQueries({ queryKey: ["hcfm"] }),
            onOpenChange: setNewFolder,
            open: newFolder
          }
        )
      ]
    }
  );
}
function ToolButton({ icon, label, onClick, disabled }) {
  return /* @__PURE__ */ jsxs2(Button2, { disabled, onClick, size: "sm", variant: "ghost", children: [
    /* @__PURE__ */ jsx2(Codicon2, { name: icon, size: "0.875rem" }),
    label
  ] });
}
function NewFolderDialog({ b, open, onOpenChange, onCreated }) {
  const [name, setName] = useState2("");
  const [error, setError] = useState2("");
  const [busy, setBusy] = useState2(false);
  useEffect2(() => {
    if (open) {
      setName("");
      setError("");
    }
  }, [open]);
  const submit = async (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError(S.nameRequired);
    if (trimmed.includes("/")) return setError(S.nameNoSlash);
    setBusy(true);
    try {
      await call("/mkdir", { method: "POST", body: { root: b.root?.id, path: joinPath(b.path, trimmed) } });
      onOpenChange(false);
      onCreated();
      host2.notify({ kind: "success", message: S.folderCreated(trimmed) });
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : errorText(failure));
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ jsx2(Dialog, { onOpenChange, open, children: /* @__PURE__ */ jsx2(DialogContent, { style: { maxWidth: 380 }, children: /* @__PURE__ */ jsxs2("form", { onSubmit: submit, style: { display: "grid", gap: 12 }, children: [
    /* @__PURE__ */ jsx2(DialogHeader, { children: /* @__PURE__ */ jsx2(DialogTitle, { children: S.newFolder }) }),
    /* @__PURE__ */ jsx2(Input, { "aria-label": S.folderName, autoFocus: true, onChange: (event) => setName(event.target.value), placeholder: S.folderName, value: name }),
    error && /* @__PURE__ */ jsx2("div", { style: { color: "var(--ui-red)", fontSize: 12 }, children: error }),
    /* @__PURE__ */ jsxs2(DialogFooter, { children: [
      /* @__PURE__ */ jsx2(Button2, { onClick: () => onOpenChange(false), type: "button", variant: "text", children: S.cancel }),
      /* @__PURE__ */ jsx2(Button2, { loading: busy, type: "submit", children: S.create })
    ] })
  ] }) }) });
}
var EMPTY = { profile: "", connectionId: null, items: [], running: false, paused: false, canceled: false };
var noop = () => () => void 0;
function useBatch(batch) {
  return useSyncExternalStore(batch?.subscribe ?? noop, batch?.getSnapshot ?? (() => EMPTY), batch?.getSnapshot ?? (() => EMPTY));
}
function Bar({ value, height = 3 }) {
  return /* @__PURE__ */ jsx2("div", { style: { height, borderRadius: height, background: "var(--ui-stroke-tertiary)", overflow: "hidden" }, children: /* @__PURE__ */ jsx2("div", { style: { height: "100%", width: `${Math.min(100, Math.max(0, value * 100))}%`, background: "var(--ui-accent)", transition: "width 150ms" } }) });
}
function UploadDrawer({ onSettled }) {
  const batch = useValue2($batch);
  const snap = useBatch(batch);
  const [collapsed, setCollapsed] = useState2(false);
  const wasRunning = useRef(false);
  useEffect2(() => {
    if (wasRunning.current && !snap.running) onSettled();
    wasRunning.current = snap.running;
  }, [snap.running, onSettled]);
  if (!batch || !snap.items.length) return null;
  const sum = summarize(snap);
  const headline = snap.canceled ? S.canceled : snap.paused ? S.paused(snap.profile) : snap.running ? S.uploading(Math.min(sum.total, sum.settled + 1), sum.total, humanSize(sum.sent), humanSize(sum.size)) : S.uploaded(sum.done, sum.total, sum.failed);
  return /* @__PURE__ */ jsxs2("div", { "aria-label": S.uploads, role: "region", style: { borderTop: "1px solid var(--ui-stroke-tertiary)", padding: "8px 20px", display: "grid", gap: 6 }, children: [
    /* @__PURE__ */ jsxs2("div", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 12 }, children: [
      /* @__PURE__ */ jsx2(Button2, { "aria-label": collapsed ? S.expand : S.collapse, onClick: () => setCollapsed(!collapsed), size: "icon-xs", variant: "ghost", children: /* @__PURE__ */ jsx2(Codicon2, { name: collapsed ? "chevron-up" : "chevron-down", size: "0.875rem" }) }),
      /* @__PURE__ */ jsx2("span", { style: { flex: 1, minWidth: 0 }, children: headline }),
      snap.running ? /* @__PURE__ */ jsx2(Button2, { onClick: () => batch.cancel(), size: "sm", variant: "text", children: S.cancel }) : /* @__PURE__ */ jsx2(Button2, { onClick: () => $batch.set(null), size: "sm", variant: "text", children: S.clear })
    ] }),
    /* @__PURE__ */ jsx2(Bar, { value: sum.size ? sum.sent / sum.size : sum.total ? sum.settled / sum.total : 0 }),
    !collapsed && /* @__PURE__ */ jsx2("div", { style: { maxHeight: 180, overflowY: "auto", display: "grid", gap: 4 }, children: snap.items.map((item) => /* @__PURE__ */ jsx2(UploadRow, { item, onRetry: () => batch.retry(item.id) }, item.id)) })
  ] });
}
function statusText(item) {
  if (item.status === "queued") return S.queued;
  if (item.status === "uploading") return `${item.size ? Math.floor(item.sent / item.size * 100) : 0}%`;
  if (item.status === "canceled") return S.canceledItem;
  if (item.status === "failed") return S.failed(item.error ?? "");
  return item.savedAs ? S.savedAs(item.savedAs) : S.done;
}
function UploadRow({ item, onRetry }) {
  return /* @__PURE__ */ jsxs2("div", { "data-upload": item.path, style: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "2px 8px", alignItems: "center", fontSize: 11 }, children: [
    /* @__PURE__ */ jsx2("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: item.path }),
    /* @__PURE__ */ jsxs2("span", { style: { display: "inline-flex", alignItems: "center", gap: 6, color: item.status === "failed" ? "var(--ui-red)" : "var(--ui-text-tertiary)" }, children: [
      statusText(item),
      item.status === "failed" && item.retryable !== false && /* @__PURE__ */ jsx2(Button2, { onClick: onRetry, size: "micro", variant: "textStrong", children: S.retry })
    ] }),
    !item.isDir && /* @__PURE__ */ jsx2(Bar, { height: 2, value: item.size ? item.sent / item.size : item.status === "done" ? 1 : 0 })
  ] });
}

// src/desktop/picker.tsx
import {
  atom as atom3,
  Button as Button3,
  Dialog as Dialog2,
  DialogContent as DialogContent2,
  DialogFooter as DialogFooter2,
  DialogHeader as DialogHeader2,
  DialogTitle as DialogTitle2,
  EmptyState as EmptyState3,
  host as host3,
  useValue as useValue3
} from "@hermes/plugin-sdk";
import { useEffect as useEffect3, useRef as useRef2 } from "react";
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
var $pickerOpen = atom3(false);
var $insertText = atom3(null);
var $hostClaim = atom3(null);
var NO_OWNER = atom3(null);
var cloudProvider = {
  label: S.providerLabel,
  icon: "cloud",
  run(ctx) {
    $insertText.set(ctx.insertText);
    $pickerOpen.set(true);
  }
};
function ownerMismatch(owner, connectionId, profile) {
  if (!owner) return false;
  const a = String(owner.connectionId ?? "").trim();
  const b = String(connectionId ?? "").trim();
  return (owner.profile || "default") !== (profile || "default") || Boolean(a && b && a !== b);
}
function PickerHost() {
  const me = useRef2({}).current;
  const claim = useValue3($hostClaim);
  const open = useValue3($pickerOpen);
  useEffect3(() => {
    const tryClaim = () => {
      if ($hostClaim.get() === null) $hostClaim.set(me);
    };
    tryClaim();
    const stop = $hostClaim.subscribe(tryClaim);
    return () => {
      stop();
      if ($hostClaim.get() === me) $hostClaim.set(null);
    };
  }, [me]);
  if (claim !== me || !open) return null;
  return /* @__PURE__ */ jsx3(PickerDialog, {});
}
function close() {
  $pickerOpen.set(false);
  $insertText.set(null);
}
function PickerDialog() {
  const profile = useValue3(host3.state.profile);
  const connectionId = useValue3(host3.state.connectionId);
  const owner = useValue3(host3.state.focusedSessionOwner ?? NO_OWNER);
  const mismatch = ownerMismatch(owner, connectionId, profile);
  return /* @__PURE__ */ jsx3(Dialog2, { onOpenChange: (next) => !next && close(), open: true, children: /* @__PURE__ */ jsxs3(DialogContent2, { style: { maxWidth: 720, width: "92vw" }, children: [
    /* @__PURE__ */ jsx3(DialogHeader2, { children: /* @__PURE__ */ jsx3(DialogTitle2, { children: S.pickerTitle }) }),
    mismatch ? /* @__PURE__ */ jsx3("p", { style: { fontSize: 13, color: "var(--ui-text-secondary)", lineHeight: 1.5 }, children: S.ownerMismatch(owner.profile, profile) }) : /* @__PURE__ */ jsx3(PickerBody, { profile }, `${connectionId ?? "local"}::${profile}`),
    mismatch && /* @__PURE__ */ jsx3(DialogFooter2, { children: /* @__PURE__ */ jsx3(Button3, { onClick: close, variant: "text", children: S.cancel }) })
  ] }) });
}
function PickerBody({ profile }) {
  const roots = useRoots();
  if (roots.error || roots.data && (roots.data.supported === false || !roots.data.roots?.length)) {
    return /* @__PURE__ */ jsx3(EmptyState3, { description: roots.data?.reason ?? (roots.error instanceof Error ? roots.error.message : void 0), title: S.unsupportedTitle });
  }
  if (!roots.data) return /* @__PURE__ */ jsx3("div", { "aria-busy": "true", style: { height: 360 } });
  return /* @__PURE__ */ jsx3(PickerBrowser, { profile, roots: roots.data });
}
function PickerBrowser({ profile, roots }) {
  const b = useBrowser(roots, "pick");
  const insert = () => {
    const text = formatInsertText(profile, [...b.selected.values()]);
    $insertText.get()?.(text);
    close();
  };
  return /* @__PURE__ */ jsxs3("div", { style: { display: "grid", gap: 8, minWidth: 0 }, children: [
    /* @__PURE__ */ jsxs3("div", { style: { display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid var(--ui-stroke-tertiary)", paddingBottom: 6 }, children: [
      /* @__PURE__ */ jsx3(Breadcrumbs, { b }),
      /* @__PURE__ */ jsx3(BrowserSearch, { b }),
      /* @__PURE__ */ jsx3(RootSelect, { b })
    ] }),
    /* @__PURE__ */ jsx3(EntryList, { b, height: 360 }),
    /* @__PURE__ */ jsxs3(DialogFooter2, { style: { alignItems: "center" }, children: [
      /* @__PURE__ */ jsx3("span", { style: { marginRight: "auto", fontSize: 12, color: "var(--ui-text-tertiary)" }, children: S.selected(b.selected.size) }),
      /* @__PURE__ */ jsx3(Button3, { onClick: close, variant: "text", children: S.cancel }),
      /* @__PURE__ */ jsx3(Button3, { disabled: !b.selected.size, onClick: insert, children: S.insert })
    ] })
  ] });
}

// src/desktop/plugin.tsx
import { jsx as jsx4 } from "react/jsx-runtime";
var PLUGIN_ID = "hermes-cloud-file-manager";
var PAGE_PATH = "/cloud-files";
var PROBE_INTERVAL_MS = 6e4;
function isNotFoundError(error) {
  const text = error instanceof Error ? error.message : String(error);
  return /(^|\D)404(\D|$)/.test(text);
}
function registerAvailabilityGate(ctx, onChange) {
  let removers = null;
  let known = null;
  let disposed = false;
  const set = (available) => {
    if (disposed) return;
    if (available !== known) {
      known = available;
      onChange?.(available);
    }
    if (available && !removers) {
      removers = [
        ctx.register({
          id: "nav",
          area: SIDEBAR_NAV_AREA,
          order: 45,
          data: { codicon: "cloud", label: S.navLabel, path: PAGE_PATH }
        }),
        ctx.register({ id: "attach-cloud", area: COMPOSER_AREAS.attachments, data: cloudProvider }),
        ctx.register({ id: "picker-host", area: COMPOSER_AREAS.underside, render: () => /* @__PURE__ */ jsx4(PickerHost, {}) })
      ];
    } else if (!available && removers) {
      removers.forEach((remove) => remove());
      removers = null;
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
  const unsubscribers = [host4.state.profile.subscribe(() => void probe()), host4.state.connectionId.subscribe(() => void probe())];
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
    bindContext(ctx);
    ctx.register({
      id: "page",
      area: ROUTES_AREA,
      data: { path: PAGE_PATH },
      render: () => /* @__PURE__ */ jsx4(CloudFilesPage, {})
    });
    registerAvailabilityGate(ctx, (available) => $available.set(available));
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
