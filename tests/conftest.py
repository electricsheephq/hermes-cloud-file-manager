"""Load dashboard/plugin_api.py the way the Hermes dashboard does: by file path, with no parent package."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
API_PATH = PLUGIN_ROOT / "dashboard" / "plugin_api.py"
PREFIX = "/api/plugins/hermes-cloud-file-manager"


def load_plugin_api(module_name: str = "hermes_dashboard_plugin_hermes-cloud-file-manager"):
    spec = importlib.util.spec_from_file_location(module_name, API_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def api():
    return load_plugin_api()


@pytest.fixture
def client(api):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(api.router, prefix=PREFIX)
    return TestClient(app)
