# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub's
[private vulnerability reporting](https://github.com/electricsheephq/hermes-cloud-file-manager/security/advisories/new)
for this repository. Do not open a public issue. We aim to acknowledge reports within three working days and to
ship a fix or mitigation for confirmed issues as quickly as we can.

Please include the plugin version, your Hermes and Hermes Desktop versions, how the agent's gateway is reached
(local, remote with a token, remote with sign-in), and the smallest set of steps that shows the problem.

## What this plugin promises

- It never lists, reads, creates or writes anything inside the agent's Hermes home (settings, API keys,
  sessions), even when that folder sits inside a folder the plugin shows.
- It never touches paths outside the configured folders, never follows a symlink that leads outside them, and
  never writes through a symlink.
- Uploads never overwrite, rename or delete an existing file.
- It adds no authentication of its own: access is exactly the gateway's existing dashboard authentication.

A way to break any of these is a vulnerability we want to hear about.

## Out of scope

- Someone who already has a shell on the gateway machine racing the plugin by swapping folders for symlinks
  mid-request. That person can already read the agent's files directly.
- Anyone who can use the agent seeing the agent's files. That is the intended access model.
