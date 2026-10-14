# AGENTS.md

Guidance for AI coding agents, and for people, working in this repository.

## What this is

Cloud File Manager is a Hermes Agent plugin that puts the gateway machine's files in Hermes Desktop. Its Python backend confines file access to configured folders; its Desktop UI browses, searches, uploads, downloads and edits files, and optionally imports from Google Drive. It registers no agent tools or hooks and has no web-dashboard UI.

## Layout

- `plugin.yaml` — plugin identity, compatibility and settings schema.
- `dashboard/plugin_api.py` — gateway API, path guards and optional Drive integration.
- `dashboard/manifest.json` and `dashboard/dist/index.js` — API mount metadata and the empty dashboard entry.
- `src/desktop/` — Desktop UI source and focused Vitest tests.
- `desktop/plugin.js` — committed generated Desktop bundle.
- `tests/` — Python backend tests using temporary fixtures.
- `scripts/` and `package.json` — build, bundle and SDK checks.
- `.github/workflows/ci.yml` — backend matrix, Desktop and pinned Hermes compatibility checks.

## Setup and checks

CI is `.github/workflows/ci.yml`.

Frontend (Node 24):

```bash
npm ci
npm run typecheck
npm test
npm run check:bundle   # the committed bundles must match the source
```

Backend (Python 3.12):

```bash
python -m pip install "fastapi==0.133.1" "starlette==1.3.1" httpx pytest
python -m pytest
```

CI also checks the Desktop SDK exports and runtime loader against pinned Hermes builds, and runs the tests inside a real Hermes
install. Leave those to CI.

## Rules

- Keep each change small and focused: one change per PR.
- Don't bump versions, create tags, or add CHANGELOG release headings. Maintainers cut releases.
- After Desktop source changes, regenerate `desktop/plugin.js` with `npm run build`. CI's `check:bundle` step rejects a stale bundle; never hand-edit it.
- Keep gateway authentication and per-profile isolation delegated to Hermes; preserve configured-root and Hermes-home path guards.
- Use mocked backends and temporary files in tests. Never use real Google credentials or billed API calls.
- Never commit secrets, tokens, real user data, or machine-specific paths.
- Tests use a temporary `HERMES_HOME`, never a real one.

## Filing issues

- Search first: `gh issue list -R electricsheephq/hermes-cloud-file-manager --state all --search "<key words>"`.
- Use the bug form headings: What happened, What you expected, Steps to reproduce, Plugin version, Hermes version, Where it happened, Operating system, Diagnostics, Relevant log lines.
- Maintainers filing from the CLI always pass labels: `--label bug,triage-pending` (or `triaged` once triaged), plus `agent-drafted` when an agent wrote it.

## Security

Report vulnerabilities privately: https://github.com/electricsheephq/hermes-cloud-file-manager/security/advisories/new
