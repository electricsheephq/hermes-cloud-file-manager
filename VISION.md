# Vision

## Goal

When your Hermes agent runs on another machine (a VPS, a home server, a hosted agent), its files should be as easy to
reach as your own. Cloud File Manager puts that machine's working folders one click away in Hermes Desktop. You can
find what the agent just made, preview it, edit it with a review before Save, upload to it, and hand files back to the
agent, all without a shell.

Two promises hold in every release:

- **It never deletes your files.** The only things it removes are its own reserved temporary files. Uploads never
  overwrite, and the editor replaces a file only when you press Save after reviewing the change.
- **It stays inside the agent's working folders.** It never exposes the agent's Hermes home, and it never follows links
  out of those folders.

## Users

- People who run a Hermes agent on a remote gateway and use Hermes Desktop to work with it.
- People who run Hermes locally and want a Desktop file view of the agent's folders.

## Coverage by Hermes surface

| Surface | What the plugin does there |
|---|---|
| Hermes Desktop | The whole user interface: the Cloud Files page, previews, the editor, uploads, Google Drive import, drag and Add to chat, Ask agent, and the file card the agent hands back in a reply. |
| Gateway (behind Desktop) | The file API that Desktop calls, under the gateway's existing authentication. In Desktop chats only, a short section in the agent's instructions names the shown folders and the file card. |
| Telegram and other messaging | Non-goal: no UI. The agent's own file tools already cover these chats. |
| CLI and TUI | Non-goal: no UI. Install and the report-a-problem skill work the same way. |
| API server and web dashboard | Non-goal: no UI. The plugin API routes exist for Desktop and are not a public API. |

The report-a-problem skill (`hermes-cloud-file-manager:cloud-file-manager-report-problem`) works on any surface that
runs skills.

## Non-goals

- Interfaces outside Hermes Desktop (see the table above).
- Deleting files, or a trash with restore. Trash would change the "never deletes your files" promise and needs an
  owner decision first (#66).
- Syncing, versioning or backups. Edits are explicit saves of one file.
- Writing to Google Drive. The Drive import is read-only.
- Agent tools or hooks of its own. The agent already has file tools; this plugin is the person's view of the files.
