"""Cloud File Manager backend, mounted by the Hermes dashboard at ``/api/plugins/hermes-cloud-file-manager/``.

The dashboard loads this file by path (no parent package), so the whole backend lives in this one module.
Authentication and the per-request profile scope come from the dashboard; this module adds none of its own.
"""

from __future__ import annotations

from fastapi import APIRouter

PLUGIN_NAME = "hermes-cloud-file-manager"
VERSION = "0.1.0"

router = APIRouter()


@router.get("/available")
def available() -> dict:
    """Desktop feature detection: 200 here means the backend is installed, enabled and mounted."""
    return {"ok": True, "plugin": PLUGIN_NAME, "version": VERSION}
