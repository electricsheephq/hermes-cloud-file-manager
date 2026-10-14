"""Hermes Cloud File Manager.

The plugin has no agent tools, hooks or middleware. Its backend lives in
``dashboard/plugin_api.py`` (mounted at ``/api/plugins/hermes-cloud-file-manager/``)
and its UI in ``desktop/plugin.js``. ``register`` adds one read-only skill, the
report-a-problem guide, so the agent can draft a bug report that the user approves
before anything is filed. Skills are not a declared capability, so the loader and
the catalog capability probe still see an empty capability set.
"""

from pathlib import Path

_REPORT_SKILL = "cloud-file-manager-report-problem"
_REPORT_DESC = "Cloud File Manager: report a bug or problem"


def register(ctx):
    # Hosts without plugin skills just skip it. Hermes does not read a plugin skill's frontmatter, so pass both.
    if not hasattr(ctx, "register_skill"):
        return None
    path = Path(__file__).parent / "skills" / _REPORT_SKILL / "SKILL.md"
    ctx.register_skill(_REPORT_SKILL, path, description=_REPORT_DESC,
                       frontmatter={"name": _REPORT_SKILL, "description": _REPORT_DESC})
    return None
