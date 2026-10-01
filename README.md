# Cloud File Manager for Hermes

Manage the files your agent can reach on the machine it runs on, straight from Hermes Desktop — useful
whenever your agent runs on a remote gateway (a VPS, a home server, a hosted agent) rather than on your own
computer.

- **Cloud Files** tab in the left sidebar: browse the agent's folders, search by name, create folders, and
  bulk-upload files and whole folders (the folder structure is kept).
- **Cloud** in the chat **+** menu: pick files that are already on the agent's machine and drop their
  locations into your message. Nothing is uploaded again; the agent opens the files where they are.

> Status: under active development toward v0.1. See the milestone for progress.

## How it works

The plugin has two halves that ship in one package:

| Half | Runs on | What it is |
|---|---|---|
| `dashboard/plugin_api.py` | the agent's gateway | a small API mounted at `/api/plugins/hermes-cloud-file-manager/`; it is the only part that touches the filesystem |
| `desktop/plugin.js` | Hermes Desktop | the Cloud Files page, its sidebar row, and the **+ → Cloud** entry |

The Desktop half talks only to its own backend through the app's authenticated plugin channel; the plugin adds
no login, tokens or permission layer of its own. Every path the backend touches is confined to the agent's
folders and can never reach the agent's own Hermes home (settings and keys).

## Development

```bash
npm ci && npm run build && npm test && npm run typecheck   # desktop half
python -m pytest                                           # backend (needs fastapi, httpx, pytest)
```

`desktop/plugin.js` is generated from `src/desktop/` by `npm run build` and committed; CI fails if it is stale.

## License

MIT
