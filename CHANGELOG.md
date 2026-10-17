# Changelog

All notable changes to this plugin are recorded here. Versions follow semantic versioning.

## [Unreleased]

### Fixed
- **Retry a preview after a temporary read failure.** A file changing during a read or a temporary I/O error
  left no way to try again. Both now offer Retry; permanent refusals still do not (#67).
- **The file list stays live behind other views.** Agent changes while a preview, editor or Google Drive view
  was open left cached rows on return. The page now keeps listening and refreshes the list when it returns (#67).
- **Page and picker share live refresh.** Opening both subscribed twice and repeated listing requests for each
  event. One subscription now serves both until the last view closes (#60).
- **Edited sizes catch up after the cache expires.** An in-place edit could leave the old size after a live
  refresh. One more listing refresh after 5.5 seconds now picks up the change (#60).
- **Missing files leave the selection.** Deleted or moved files kept selection actions enabled after their rows
  disappeared. Complete folder listings now clear those selections, keeping selections in other folders (#60).
- **Drag leaves ambiguous names out.** Names ending in punctuation or a line range could reach the chat as a
  different path. Drag now skips those and unrepresentable paths with a notice to use Add to chat (#67).
- **One unopened folder reads correctly.** The search note said "1 folder couldn't be opened, so matches inside
  them may be missing". It now says "inside it" for one folder.

## [0.4.7] - 2026-10-17

Desktop half only; the agent's side is unchanged from 0.4.6 apart from the version.

### Fixed
- **Search says when it passed folders it couldn't open.** A search that finished but had to pass folders the
  agent's user can't open (no permission, or macOS privacy protection for folders such as Desktop or Documents)
  looked complete: "No matching files", with nothing to say matches might be inside those folders. It now adds
  "N folders couldn't be opened, so matches inside them may be missing" under the results or the empty state, in
  Cloud Files and the + → Cloud picker (#71). The agent's side already counted these folders.
- **Search notes reach screen readers.** The live region read only the result count. It now reads the search's note
  after it: a stopped search, only the first matches shown, or folders that couldn't be opened (#73).

## [0.4.6] - 2026-10-15

Desktop half only; the agent's side is unchanged from 0.4.5 apart from the version.

### Fixed
- **Breadcrumbs in a narrow pane.** With Cloud Files open beside a chat, the folder path was squeezed to a few
  pixels and its names drew on top of each other. Now the toolbar's buttons move to a second line when the pane is
  narrow, the current folder keeps most of the path's width, the folders above it shrink first, and a shortened name
  shows in full on hover. The Google Drive path works the same way.
- **Google Drive keys beside a chat.** With a chat open next to Cloud Files, Enter (open a folder) and Space
  (select a file) on a Google Drive row no longer move keyboard focus to the chat's message box. Opening a folder
  lands on its first row, as in the Cloud list.

### Documentation
- The README says to answer No if the installer offers to install Node dependencies: `package.json` holds only
  build and test tools.

## [0.4.5] - 2026-10-15

Agent side only; the Desktop half is unchanged from 0.4.4.

### Added
- **Report a problem.** Ask the agent to report a problem with Cloud File Manager and it walks through a short,
  safe check, looks for an existing issue, and drafts a report with the same headings as this repository's bug form.
  It files the issue (or a comment on a matching one) with the GitHub CLI only after you have read the draft and said
  yes; otherwise it gives you the draft and the form link. Security problems go to the private advisory form instead,
  and a problem in Hermes itself to the Hermes issue tracker.
  Hosts without plugin skills load the plugin as before.

## [0.4.4] - 2026-10-14

Desktop half only; the agent's side is unchanged from 0.4.1.

### Added
- **The file list follows the agent.** While Cloud Files is open, a file the agent writes, moves or deletes shows up
  in the open folder or search within about a second, without Refresh. Only that agent's list refreshes, at most once
  a second, and not while the window is hidden (once when you come back). A file edited in place can show its old
  size for a few seconds. Needs a Hermes Desktop that passes tool events to plugins; without it, nothing changes.
- **Drive keyboard navigation** on the page and in the **+ → Google Drive** picker: one tab stop, arrow keys, Home and
  End, Page Up and Page Down, and Backspace (or Alt+Up) for the parent folder. Checkboxes are mouse-only, as in the
  Cloud list; Space and Enter work on the row.

## [0.4.3] - 2026-10-14

Desktop half only; the agent's side is unchanged from 0.4.1.

### Added
- **Show** on a finished upload opens its folder and puts the focus on the file, using the name it was saved under.
- **Add to chat** in the toolbar, and while viewing or editing a file: the same `@file:` / `@folder:` references as
  dragging, inserted into the chat beside Cloud Files, refused when that chat belongs to another agent. A path that
  no chat reference can hold (a line break, or all three quote characters) is skipped with a notice. It needs a
  Hermes Desktop with the composer API; without it the button doesn't show.
- **Retry** on a preview that failed to arrive (a timeout or network error). A refusal, such as a file that is too
  large, doesn't offer it.

### Changed
- **Import from Google Drive on the Cloud Files page** puts the files in the folder you were in, not always in
  `uploads/drive` of the first folder. The **+ → Google Drive** picker still imports into `uploads/drive`.

## [0.4.2] - 2026-10-13

Desktop half only; the agent's side is unchanged from 0.4.1.

### Added
- **Drag files into the chat.** Drag a file or folder row, or the current selection, from the Cloud Files page into
  a chat. It becomes the same `@file:` / `@folder:` reference Hermes's own Files tree makes. Hermes includes the
  contents of files in the agent's working folder; files elsewhere are passed by location with a note.
  - Cloud Files refuses the drag, with a notice, when the chat in focus belongs to a different agent than the files.
  - The **+ → Cloud** picker, Google Drive rows and links that point outside the shown folders can't be dragged.
  - Tip: right-click **Cloud Files** in the sidebar and choose **Open in split** to keep it beside the chat.

### Fixed
- Dragging something that isn't a file from your computer (such as a row) over the Cloud Files page no longer
  shows the upload highlight.

## [0.4.1] - 2026-10-13

Both halves. Previews need 0.4.1 on the agent too; with an older agent side, Cloud Files says so and everything else works as before.

### Added
- **Read-only previews** of images, PDFs, and code and data files. Double-click a file, or select it and choose **Open**.
  - Images: PNG, JPEG, GIF, WebP, BMP, ICO and SVG.
  - PDFs.
  - Text and code: JSON, YAML, TOML, CSV/TSV (shown as a table, or as text), logs, XML, HTML and most source languages. Previews of text and code show the first 1 MB.
  - Images and PDFs up to 10 MB. Larger files say so; use **Download** instead.
  - Previews are read-only. Only `.md`, `.markdown` and `.txt` files can be edited and saved, as before.
  - HTML and SVG are never run: HTML shows as text, and SVG shows as an image.

### Fixed
- The docs said Download needs Hermes v0.21.6. It works in every Hermes Desktop this plugin supports (v0.21.5 and newer).

## [0.4.0] - 2026-10-13

Desktop half only. The agent's side is unchanged, so 0.3.5 on the agent works with it.

### Added
- **Download** saves one file from the agent's machine to your computer. Select a file and choose **Download** in
  the toolbar, or open the file and use **Download** while viewing it.
  - It uses Hermes Desktop's own download, the same one its file tree uses, so it is exactly as private as your
    gateway.
  - It only offers files the list shows.
  - It appears only in Hermes Desktop builds that provide this download: Hermes v0.21.6 and newer, and evaOS
    Desktop 2026.10.6 and newer. On older builds the plugin works as before, without it.
  - Hermes Desktop's own limits apply, for example its file size cap.
  - Folders, Google Drive files and links to files outside the shown folders can't be downloaded.
- **Keyboard and screen reader use of the file list.**
  - The list is a single tab stop.
  - The arrow keys, Home, End, Page Up and Page Down move through it.
  - Alt+Up (or Backspace) goes to the parent folder.
  - Focus returns to the right row after you open a folder, go up a level or close a file.
  - Screen readers hear the item count, search results, Load more and load errors.

### Changed
- The **+ → Cloud** and **+ → Google Drive** pickers name the agent whose files they show (#51).
- If the agent can't be reached while a picker is open, the picker says so and offers **Retry**, instead of
  showing a blank placeholder until the next check a minute later (#51).
- The note shown when you switch to an agent without Cloud Files (or Google Drive) now says what happens: the
  picker picks up again if you switch back, and **Cancel** closes it (#51).

The **+ → Cloud** insert text is unchanged.

## [0.3.8] - 2026-10-12

Desktop half only. The agent's side is unchanged, so 0.3.5 on the agent works with it.

### Fixed
- A Google Drive picker kept open across two agent switches no longer shows "Google Drive isn't available" for the
  third agent while that agent's own answer is still pending. One agent's "no" no longer carries over to the next
  agent (#48).

## [0.3.7] - 2026-10-12

Desktop half only. The agent's side is unchanged, so 0.3.5 on the agent works with it.

### Fixed
- Switching to an agent without Cloud Files (or without Google Drive) no longer closes a **+ → Cloud** or
  **+ → Google Drive** picker you opened on the previous agent. It stays open with a note to switch back;
  an import already started on the previous agent continues when you switch back. Closing the picker closes it
  and stops its import.

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
