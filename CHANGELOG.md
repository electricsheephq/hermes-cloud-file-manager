# Changelog

All notable changes to this plugin are recorded here. Versions follow semantic versioning.

## Unreleased

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
