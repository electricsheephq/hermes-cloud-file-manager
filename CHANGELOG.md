# Changelog

All notable changes to this plugin are recorded here. Versions follow semantic versioning.

## [0.3.7] - 2026-10-12

Desktop half only. The agent's side is unchanged, so 0.3.5 on the agent works with it.

### Fixed
- Switching to an agent without Cloud Files (or without Google Drive) no longer closes a **+ → Cloud** or
  **+ → Google Drive** picker you opened on the previous agent, or stops its import. It stays open, offers
  **Copy locations**, and closes when you close it.

## [0.3.6] - 2026-10-12

Desktop half only. The agent's side is unchanged, so 0.3.5 on the agent works with it.

### Fixed
- Reopening the app on the Cloud Files page no longer asks the agent for its folders before it knows the agent has
  the plugin, and no longer shows "needs an update" on an agent where Cloud Files isn't set up. The page waits, then
  shows the files or the set-up note.
- Switching to another agent hides **Cloud Files** and **+ → Cloud** until that agent answers, instead of keeping
  the previous agent's answer. An open **+ → Cloud** picker stays open across the switch and offers **Copy
  locations**, as before.
- Disabling the plugin stops any upload or Google Drive import still running or paused.

## [0.3.5] - 2026-10-11

Faster big folders, clearer messages and keyboard use. Both halves changed: after updating, restart the agent's gateway
and reopen Hermes. Checked against Hermes v0.21.6 and evaOS Desktop es.16.

### Changed
- Big folders open much faster. A 20,000-item folder lists in about a tenth of the time it took, and **Load more**
  reuses the folder it already read instead of reading it again, so going from 500 to 2,500 items takes a fraction of
  a second instead of several seconds. The listing is the same as before, item for item. A file changed in place
  outside Cloud Files can take up to 5 seconds to show its new size and date.
- Settings have plain labels in Hermes Desktop: **Folders to show**, **Folder notes** and **Largest upload (MiB)**.
  **Largest upload** accepts decimals (rounded down) instead of silently using 100.
- The install guide leads with the Hermes plugin catalog, which installs the reviewed release, and says how to update.
  On Hermes 0.21.6 or later, enabling the plugin needs no gateway restart.

### Fixed
- Errors say what went wrong: a folder the agent's user can't open or change, a full disk, or a read-only location,
  instead of "The filesystem operation failed." Every error the agent's machine can return now has a plain message.
- If none of the folders in **Folders to show** can be shown, Cloud Files says so and offers **Open settings**, instead
  of "Something went wrong".
- Keyboard users can see which row has focus, and focus stays in the list after opening a folder or closing a file.
  Upload, import and save progress, and dialog errors, are announced to screen readers.
- An upload into a folder the agent can write to but not read (a "drop box") no longer fails.
- A folder spelled with different capitals from the disk (on macOS) no longer treats links inside it as outside.
- Finished uploads no longer keep their files referenced until **Clear**.
- The **+ → Cloud** picker no longer suggests uploading into an empty folder, and the Google Drive view hides its size
  column when Drive gives no sizes.
- A Drive import interrupted by a gateway crash no longer leaves its hidden staging folder forever: it is removed after
  24 hours. **New folder** refuses the two names Cloud Files keeps for its own temporary files, so that cleanup never
  removes a folder you made.

## [0.3.4] - 2026-10-03

Big folders and the **+ → Cloud** picker. Only the Desktop half changed: reopen Hermes after updating. The agent's
gateway needs no restart.

### Fixed
- A folder with more than 500 items now says how many it holds, for example "Showing 500 of 812 items", and offers
  **Load more**, which adds the next 500. Before, it showed the first 500 with no sign of the rest. This works in
  Cloud Files and in the **+ → Cloud** picker. A folder with more than 20,000 items still lists only the first 20,000,
  and the notice points to **Search files**.
- The **+ → Cloud** picker keeps its folder, search and selection when Hermes moves the chat composer while the picker
  is open. Before, they were reset. Closing the picker or switching agents still starts fresh.
- The picker leaves out a name that contains a line break, because a chat message can't show it exactly. It says
  how many it left out; with nothing else selected, **Insert locations** and **Copy locations** stay off.
- A save that fails after you closed the file and chose **Discard** no longer shows a "wasn't saved" notification.
  There is nothing left to save.

## [0.3.3] - 2026-10-03

Editor fixes. None of these lost text before; each left you with a wrong or missing signal. After updating, restart
the agent's gateway once.

### Fixed
- A Save that finishes while you briefly leave Cloud Files now lands on the page you come back to. Before, the file
  showed as unsaved against the old version, and the next Save was refused as a conflict.
- A save that fails after you chose **Back to editing**, or left the page, now shows a notification. Before, the error
  was only kept for the closed Review dialog.
- Switching agents while no file is open brings back that agent's unsaved draft, as reopening the page does.
- A file that changes while it is being opened or saved is refused as changed, so you never see a torn mix of the
  two versions.

## [0.3.2] - 2026-10-03

Google Drive gives the agent's skill only what it needs. After updating, restart the agent's gateway once.

### Changed
- The `google-workspace` scripts now get only the environment they need: the path, home and temp folders, locale,
  proxy and CA-bundle settings, and Python's own settings. Before, they got the gateway's whole environment, which
  also holds the agent's keys and tokens.
- The scripts come from `skills/productivity/google-workspace/scripts` in the agent's Hermes home, else from the
  copy bundled with Hermes. A copy anywhere else under `skills/`, or another profile's copy, is no longer used.

## [0.3.1] - 2026-10-02

Search that works on large agent workspaces. After updating, restart the agent's gateway once so the new search
code loads.

### Fixed
- **Search** no longer gives up early on large workspaces. It checks names first and runs the full path checks
  only on folders and on matches, so it covers far more of a big workspace in the same 5 seconds. It returns
  shallower matches first and searches the folder you are in and its subfolders; below the root, the search box
  names that folder. What it can return is unchanged.
- When a search stops early, Cloud Files now says how many items it checked and that some matches may be missing.
  This includes searches with no matches so far, which used to show a bare "No matching files". The result-limit
  note asks you to type more, and the folder-size note no longer says "Showing the first 1 items".

### Changed
- Requires Hermes **0.21.5 or newer** (`requires_hermes: ">=0.21.5"`, previously 0.21.1): the oldest release this
  plugin is tested against.
- `GET /search` takes an optional `path` (the folder to search under) and returns a `reason` (`results`, `time`,
  `visits` or `null`) next to `truncated`.

## [0.3.0] - 2026-10-02

Read and edit Markdown and text files, with an explicit Save. After updating, restart the agent's gateway once so
the new routes mount.

### Added
- **Open and edit** Markdown and text files from Cloud Files. A file opens read-only and rendered; **Edit** shows
  the source, **Changes** shows your edits line by line, and only **Save** in the **Review & save** dialog writes
  the file. No autosave: closing, leaving the page or switching agents never saves. If the file changed on the
  agent's machine since you opened it, Save is refused and you can compare with their version first.
- Gateway editor routes: `GET /file` reads confined Markdown and text files with their SHA-256;
  `POST /file/save` explicitly saves an existing file only when its base SHA-256 still matches.

### Security
- The editor's **Save** is the only write that replaces an existing file; uploads still never overwrite. A save
  replaces only an existing `.md`, `.markdown` or `.txt` file of at most 1 MiB, atomically and with its mode kept.
  It never creates, renames or deletes files. Links, hard links, mount points and other non-regular files are
  refused, and the agent's Hermes home stays out of reach as before.

## [0.2.0] - 2026-10-01

Google Drive, read-only, through the agent's own Google sign-in.

### Added
- Gateway API for a read-only **Google Drive** source, using the agent's own Google sign-in through its
  `google-workspace` skill: check availability, list a folder or search by name, and import one file at a time
  into `uploads/drive/` (Google Docs and Slides as PDF, Sheets as CSV, Drawings as PNG). Imports keep both files
  on a name clash, like uploads.
- **Google Drive** in Hermes Desktop, for agents whose `google-workspace` skill is signed in with Drive access:
  - a **Google Drive** source on the Cloud Files page, to browse or search the Drive and **Import to Cloud
    Files**;
  - **+ → Google Drive** in the chat, which imports the picked files and inserts their locations.

  Imports are pinned to the agent they started on. If you switch chats or agents while the picker is open, it
  offers **Copy locations** instead of inserting.

### Changed
- **+ → Cloud** inserts locations only if the chat and agent are unchanged since the picker opened; otherwise it
  offers **Copy locations**, so locations don't land in a chat you switched to.

### Fixed
- A retried upload whose first "finish" response was lost now gets the file it already created, instead of
  uploading it again as a duplicate `name (1).ext`.
- A link that leaves the shown folders is listed from the link itself: its own size and date, never the target's,
  and no `stat()` through it beyond the check of where it points. One whose target is missing is now listed (not
  openable) instead of hidden.

## [0.1.1] - 2026-10-01

Presentation-only release: no behaviour changes.

### Changed
- New banner and social card in the Hermes announcement style.

## [0.1.0] - 2026-10-01

First release.

### Added
- **Cloud Files** sidebar page in Hermes Desktop for the machine the agent runs on: browse folders, search by
  name or glob, create folders, and upload files and whole folders by drag-and-drop or from the toolbar.
- Chunked, retrying uploads (4 MiB chunks that shrink automatically behind strict proxies), two files at a time,
  with a progress drawer that survives leaving the page. Files over the limit (100 MB by default) are refused
  before anything is sent.
- Name clashes keep both files (`report (1).pdf`); nothing is ever overwritten.
- **+ → Cloud** in the chat composer: tick files in any folders and insert their locations into the message,
  without uploading again and without copying them into the chat.
- Uploads pause when you switch to another agent and continue when you switch back.
- Settings: `roots`, `folder_notes`, `max_file_mb`.
- The sidebar row and the **+ → Cloud** entry appear only for agents that have the gateway half enabled.

### Security
- All paths are confined to the configured folders.
- The agent's Hermes home (settings and keys) is excluded by file identity and by canonical path, so case
  variants, Unicode spellings and links cannot reach it. The only exception is a working folder inside it that the
  agent is set up to use (`roots`, `terminal.cwd` or the Docker `workspace/`); see SECURITY.md.
- When the shown folder is the gateway user's home, its hidden top-level entries are hidden and refused.
