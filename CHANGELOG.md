# Changelog

All notable changes to this plugin are recorded here. Versions follow semantic versioning.

## Unreleased

### Added
- Gateway editor routes: `GET /file` reads confined Markdown and text files with their SHA-256;
  `POST /file/save` explicitly saves an existing file only when its base SHA-256 still matches.

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
