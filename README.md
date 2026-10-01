# Hermes Cloud File Manager

A Hermes plugin that lets a user manage the files their cloud agent can reach, from the evaOS Agent desktop app, without leaving the app.

## What it does (v0.1 target)

- **Cloud Files tab in the left sidebar.** It shows the folders the selected agent can access on its cloud VM. In that tab the user can:
  - browse folders;
  - search by name;
  - create folders;
  - bulk-upload many files and whole folders, keeping the folder structure.
- **"Cloud" in the chat "+" menu.** In any chat, the user opens the attach menu, picks **Cloud**, and selects one or more files from the agent's cloud folders. The message then carries the file **locations** (paths on the agent's machine). Nothing is uploaded again; the agent works on the files where they already are.

Example: a user bulk-uploads 200 product photos into `uploads/catalog-2026/` in Cloud Files. In chat they click **+ → Cloud**, select the folder or a few files, and tell the agent "resize these for the web store".

## Shape

One plugin package with two halves, following the upstream "one package, both SDKs" layout:

| Half | Where it runs | What it is |
|---|---|---|
| `dashboard/plugin_api.py` + `dashboard/manifest.json` | the agent's Hermes gateway (cloud VM) | small API: the accessible roots, search, and anything core does not already provide; mounted at `/api/plugins/cloud-files/` |
| `desktop/plugin.js` | evaOS Agent desktop app (renderer) | the sidebar tab (`sidebar.nav` + `routes`) and the composer "+" entry (`composer.attachments`) |
| `plugin.yaml` | gateway | plugin metadata; enabled per profile |

Core Hermes already provides list / read / download / upload / upload-stream / mkdir / delete under `/api/files*`. The plugin reuses them; it does not re-implement uploads.

## Status

Planning. See the milestone **v0.1 — Cloud Files MVP** and the handoff issue.

## Not in scope (v0.1)

- Syncing files from a user's device (that is Syncthing rebuilt; retired on purpose).
- Resumable/tus uploads (wait until someone hits the 100 MiB per-file limit).
- Sharing files across agents/profiles.
