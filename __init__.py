"""Hermes Cloud File Manager.

The plugin has no agent tools, hooks or middleware. Its backend lives in
``dashboard/plugin_api.py`` (mounted at ``/api/plugins/hermes-cloud-file-manager/``)
and its UI in ``desktop/plugin.js``. ``register`` adds:

- one read-only skill, the report-a-problem guide, so the agent can draft a bug report that the user approves
  before anything is filed;
- a short section in the agent's instructions, for Desktop chats only: which folders the user sees in Cloud Files,
  and how to hand the user a file as a card in the chat (``::cloud-file{path="..."}``, drawn by the Desktop half).

Skills and prompt sections are not declared capabilities, so the loader and the catalog capability probe still see
an empty capability set.
"""

from pathlib import Path

_REPORT_SKILL = "cloud-file-manager-report-problem"
_REPORT_DESC = "Cloud File Manager: report a bug or problem"
_SECTION_ID = "cloud-file-manager"
_MAX_ROOTS = 10
_MAX_ROOT_CHARS = 300


def _roots(ctx):
    """The configured folders as absolute path strings (the gateway applies its own guards to each)."""
    try:
        configured = ctx.get_config("roots", [])
    except Exception:
        return []
    if not isinstance(configured, list):
        return []
    roots = []
    for value in configured:
        if not isinstance(value, str) or len(value) > _MAX_ROOT_CHARS or any(c in value for c in "\r\n\"{}"):
            continue
        posix = value.startswith("/")
        drive = len(value) > 2 and value[0].isalpha() and value[1] == ":" and value[2] in "\\/"
        if posix or drive:
            roots.append(value)
        if len(roots) == _MAX_ROOTS:
            break
    return roots


def prompt_section(ctx, info):
    """Desktop chats only: other surfaces can't draw the card, and their users don't see Cloud Files."""
    if str(info.get("platform") or "") != "desktop":
        return ""
    roots = _roots(ctx)
    where = ("these folders on this machine: " + ", ".join(roots)) if roots else "the agent's working folder"
    return (
        "Cloud Files: the user has a Cloud Files panel in Hermes Desktop that shows " + where + ". "
        "Files you create or change there appear in it marked New or Updated. Files the user uploads land in "
        "whichever folder they had open, and the user can edit .md and .txt files there and save them, so re-read a "
        "file before changing it if the user may have edited it.\n"
        "When you create or update a file in those folders that the user should look at, put "
        "::cloud-file{path=\"/absolute/path/to/file\"} on its own line after you mention it. Desktop shows it as a "
        "card with Open, Preview, Download and Add to chat. Use absolute paths, one line per file, at most five, and "
        "only for files inside those folders."
    )


def register(ctx):
    # Hosts without plugin skills just skip it. Hermes does not read a plugin skill's frontmatter, so pass both.
    if hasattr(ctx, "register_skill"):
        path = Path(__file__).parent / "skills" / _REPORT_SKILL / "SKILL.md"
        ctx.register_skill(_REPORT_SKILL, path, description=_REPORT_DESC,
                           frontmatter={"name": _REPORT_SKILL, "description": _REPORT_DESC})
    # Hosts without plugin prompt sections (before 0.23) keep working without the card instructions.
    if hasattr(ctx, "register_system_prompt_section"):
        try:
            ctx.register_system_prompt_section(_SECTION_ID, lambda info: prompt_section(ctx, info), max_chars=1500)
        except (TypeError, ValueError):
            pass
    return None
