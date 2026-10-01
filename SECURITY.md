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
  - The one exception: a folder *inside* a Hermes home that the agent is set up to work in is shown as the root,
    with everything else in that home still refused. That folder is any of:
    - one set in `roots`;
    - the agent's `terminal.cwd`;
    - the `workspace/` folder used when the working folder would otherwise be the Hermes home itself (the usual
      Docker layout).

    The Hermes home itself is never shown as a root.
- It never browses into, uploads through or writes through a symlink that leads outside the configured
  folders, and never touches paths outside them otherwise.
  - A listing may show such a link as not openable, with the size and date its target reports.
  - A symlink that stays inside the shown folders works like the folder it points to.
  - The file an upload finally writes is never a symlink, and a name taken by a symlink is refused rather than
    written through.
- Uploads never overwrite, rename or delete an existing file. The one reserved name pattern,
  `.cfm-<32 lowercase hex>.part`, is the plugin's own temporary-file name:
  - an upload is never stored under it;
  - regular files with exactly that name that are older than 24 hours are removed from a folder when a new
    upload starts there.
- It adds no authentication of its own: access is exactly the gateway's existing dashboard authentication.

A way to break any of these is a vulnerability we want to hear about.

## Out of scope

- Someone who already has a shell on the gateway machine (including the agent itself) racing the plugin
  mid-request: swapping folders for symlinks, or deleting and replacing a file name the plugin has just reserved
  for an upload. That person can already read and write the agent's files directly.
- Anyone who can use the agent seeing the agent's files. That is the intended access model.
