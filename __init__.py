"""Hermes Cloud File Manager.

The plugin has no agent tools, hooks or middleware. Its backend lives in
``dashboard/plugin_api.py`` (mounted at ``/api/plugins/hermes-cloud-file-manager/``)
and its UI in ``desktop/plugin.js``. ``register`` is intentionally a no-op so the
loader and the catalog capability probe see an empty capability set.
"""


def register(ctx):  # noqa: ARG001 - the plugin registers nothing agent-side
    return None
