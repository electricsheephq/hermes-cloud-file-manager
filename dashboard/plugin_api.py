"""Cloud File Manager backend, mounted by the Hermes dashboard at ``/api/plugins/hermes-cloud-file-manager/``.

The dashboard loads this file by path (no parent package), so the whole backend lives in this one module.
Authentication and the per-request profile scope come from the dashboard; this module adds none of its own.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass, replace
import errno
import fnmatch
from functools import wraps
import os
from pathlib import Path
import re
import secrets
import stat
import sys
from threading import Lock
import time
from typing import Annotated
import unicodedata

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field, StrictInt

PLUGIN_NAME = "hermes-cloud-file-manager"
VERSION = "0.1.0"

router = APIRouter()

CHUNK_BYTES = 4 * 1024 * 1024
MAX_CHUNK_BYTES = 8 * 1024 * 1024
SCAN_LIMIT = 20000
SEARCH_VISIT_LIMIT = 50000
SEARCH_SECONDS = 5.0
TEMP_RE = re.compile(r"^\.cfm-[0-9a-f]{32}\.part$")
UPLOAD_RE = re.compile(r"^[0-9a-f]{32}$")
DEVICE_RE = re.compile(r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$", re.I)
SEARCH_SKIP = {".git", "node_modules", "__pycache__", ".venv", "venv", ".tox", ".mypy_cache", ".cache"}
_LAST_SWEEP = {}
_SWEEP_LOCK = Lock()


class GuardError(Exception):
    def __init__(self, code: str, message: str, **details):
        super().__init__(message)
        self.code, self.message, self.details = code, message, details


def _protocol(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except GuardError as exc:
            return {"ok": False, "code": exc.code, "message": exc.message, **exc.details}
        except OSError:
            return {"ok": False, "code": "io_error", "message": "The filesystem operation failed."}
    return wrapped


def _load_config():
    try:
        from hermes_cli.config import load_config
    except ImportError:
        return {}
    return load_config()


def _hermes_homes():
    homes = {Path.home() / ".hermes"}
    if os.environ.get("HERMES_HOME"):
        homes.add(Path(os.environ["HERMES_HOME"]))
    try:
        from hermes_constants import get_hermes_home, get_process_hermes_home, get_default_hermes_root
    except ImportError:
        return homes
    return homes | {Path(get_hermes_home()), Path(get_process_hermes_home()), Path(get_default_hermes_root())}


def _dict(value):
    return value if isinstance(value, dict) else {}


def _settings(cfg):
    return _dict(_dict(_dict(_dict(cfg.get("plugins")).get("entries")).get(PLUGIN_NAME)).get("settings"))


def _max_bytes(cfg):
    mb = _settings(cfg).get("max_file_mb", 100)
    return (mb if type(mb) is int and mb >= 1 else 100) * 1024 * 1024


@dataclass(frozen=True)
class Protection:
    homes: tuple[str, ...]
    excluded: frozenset[tuple[int, int]]


@dataclass(frozen=True)
class Root:
    id: str
    label: str
    path: Path
    protection: Protection | None = None
    is_home: bool | None = None


def _identity(path):
    try:
        info = path.stat()
        return (info.st_dev, info.st_ino) if stat.S_ISDIR(info.st_mode) else None
    except OSError:
        return None


def _excluded(homes=None):
    homes = _hermes_homes() if homes is None else homes
    return {identity for path in homes if (identity := _identity(Path(path))) is not None}


def _canonical(path):
    value = os.path.realpath(path)
    if sys.platform == "darwin":
        value = unicodedata.normalize("NFD", value)
    return value.casefold() if sys.platform in {"darwin", "win32"} else value


def _protection():
    homes = _hermes_homes()
    return Protection(tuple(_canonical(home) for home in homes), frozenset(_excluded(homes)))


def _home_path(path, protection):
    return _canonical(path) in protection.homes


def _roots(cfg=None):
    cfg = _dict(_load_config()) if cfg is None else cfg
    protection = _protection()
    home_identity = _identity(Path.home())
    configured = _settings(cfg).get("roots")
    if isinstance(configured, list) and configured:
        roots = []
        excluded = protection.excluded
        for index, value in enumerate(configured):
            if not isinstance(value, str) or not _encodable(value):
                continue
            path = Path(value)
            if not path.is_absolute() or not path.is_dir() or Path(os.path.realpath(path)).parent == Path(os.path.realpath(path)):
                continue
            identity = _identity(path)
            if identity in excluded or _home_path(path, protection):
                continue
            roots.append(Root(f"r{index}", path.name or str(path), path, protection,
                              identity is not None and identity == home_identity))
        return roots
    terminal = _dict(cfg.get("terminal"))
    workspace = Path.home()
    for value in (terminal.get("cwd"), os.environ.get("TERMINAL_CWD"), os.environ.get("MESSAGING_CWD")):
        if not isinstance(value, str) or not value or not _encodable(value) or value in {".", "auto", "cwd"}:
            continue
        path = Path(value).expanduser()
        if path.is_absolute() and path.is_dir() and Path(os.path.realpath(path)).parent != Path(os.path.realpath(path)):
            workspace = path
            break
    if _identity(workspace) in protection.excluded or _home_path(workspace, protection):
        workspace = workspace / "workspace"
        workspace.mkdir(exist_ok=True)
    if Path(os.path.realpath(workspace)).parent == Path(os.path.realpath(workspace)):
        raise GuardError("protected", "A filesystem root cannot be exposed.")
    identity = _identity(workspace)
    root = Root("workspace", "Workspace", workspace, protection,
                identity is not None and identity == home_identity)
    _resolve(root, "", for_write=False)
    return [root]


def _supported(cfg):
    return str(_dict(cfg.get("terminal")).get("backend") or "local").lower() == "local"


def _request_root(root_id):
    cfg = _dict(_load_config())
    if not _supported(cfg):
        raise GuardError("unsupported_backend", "Files are available only with the local terminal backend.")
    for root in _roots(cfg):
        if root.id == root_id:
            return root, cfg
    raise GuardError("unknown_root", "The requested root is unavailable.")


def _encodable(value):
    try:
        value.encode("utf-8")
        value.encode(sys.getfilesystemencoding())
        return True
    except UnicodeError:
        return False


def _segments(rel):
    if not _encodable(rel) or "\x00" in rel or rel.startswith(("/", "~")) or Path(rel).is_absolute():
        raise GuardError("bad_path", "Use a valid relative path.")
    parts = []
    for segment in rel.split("/"):
        if segment in {"", "."}:
            continue
        if segment == "..":
            raise GuardError("bad_path", "Parent traversal is not allowed.")
        parts.append(segment)
    return parts


def _portable(segment):
    if (any(ord(c) < 32 or ord(c) == 127 for c in segment) or "\\" in segment
            or any(c in segment for c in ':*?"<>|') or segment.endswith((".", " "))
            or DEVICE_RE.fullmatch(segment.split(".", 1)[0]) or len(segment.encode("utf-8")) > 255):
        raise GuardError("bad_path", "The path contains an invalid name to create.")


def _inside(path, root):
    try:
        return os.path.commonpath((str(path), str(root))) == str(root)
    except ValueError:
        return False


def _home_root(root):
    if root.is_home is not None:
        return root.is_home
    identity = _identity(root.path)
    return identity is not None and identity == _identity(Path.home())


def _check_protected(target, realroot, protection=None):
    canonical_target, canonical_root = _canonical(target), _canonical(realroot)
    if protection is None:
        protection = Protection(tuple(_canonical(home) for home in _hermes_homes()), frozenset(_excluded()))
    for canonical_home in protection.homes:
        # R1 permits a scoped root strictly inside a home, but never that home itself.
        scoped_inside = canonical_root != canonical_home and _inside(canonical_root, canonical_home)
        if not scoped_inside and _inside(canonical_target, canonical_home):
            raise GuardError("protected", "The Hermes home is protected.")
    excluded = protection.excluded
    identity = _identity(target)
    if identity is not None and identity in excluded:
        raise GuardError("protected", "The Hermes home is protected.")
    ancestor = target
    while not ancestor.exists() and ancestor != ancestor.parent:
        ancestor = ancestor.parent
    while _inside(ancestor, realroot):
        identity = _identity(ancestor)
        if identity is not None and identity in excluded:
            raise GuardError("protected", "The Hermes home is protected.")
        if ancestor == realroot:
            break
        ancestor = ancestor.parent


def _home_dot(root, resolved, realroot):
    return (_home_root(root) and _inside(resolved, realroot) and resolved != realroot
            and resolved.relative_to(realroot).parts[0].startswith("."))


def _resolve(root: Root, rel: str, *, for_write: bool) -> Path:
    parts = _segments(rel)
    realroot = Path(os.path.realpath(root.path))
    candidate = root.path
    for part in parts:
        candidate = candidate / part
        try:
            info = os.lstat(candidate)
        except FileNotFoundError:
            _portable(part)
            continue
        except NotADirectoryError:
            raise GuardError("exists_file" if for_write else "not_a_dir", "A parent path is not a directory.")
        except OSError as exc:
            if exc.errno == errno.ENAMETOOLONG:
                _portable(part)
            raise
        if stat.S_ISLNK(info.st_mode) and not _inside(Path(os.path.realpath(candidate)), realroot):
            raise GuardError("outside_root", "The path leaves the selected root.")
    resolved = Path(os.path.realpath(candidate))
    if not _inside(resolved, realroot):
        raise GuardError("outside_root", "The path leaves the selected root.")
    _check_protected(resolved, realroot, root.protection)
    if _home_root(root) and parts and parts[0].startswith("."):
        raise GuardError("protected", "Hidden entries in the home root are protected.")
    if _home_dot(root, resolved, realroot):
        raise GuardError("protected", "Hidden entries in the home root are protected.")
    if for_write:
        try:
            if stat.S_ISLNK(os.lstat(candidate).st_mode):
                raise GuardError("is_link", "Writing to a symbolic link is not allowed.")
        except FileNotFoundError:
            pass
    return candidate


def _rel(root, path):
    value = path.relative_to(root.path).as_posix()
    return "" if value == "." else value


def _entry(root, path):
    if not _encodable(str(path)) or TEMP_RE.fullmatch(path.name.lower()):
        return None
    if _home_root(root) and (_rel(root, path).split("/")[0].startswith(".")
            or (path.name.startswith(".") and _identity(path.parent) == _identity(root.path))):
        return None
    try:
        link_info = os.lstat(path)
        link = stat.S_ISLNK(link_info.st_mode)
        info = path.stat()
        is_dir = stat.S_ISDIR(info.st_mode)
        realpath = Path(os.path.realpath(path))
        realroot = Path(os.path.realpath(root.path))
        _check_protected(realpath, realroot, root.protection)
        if _home_dot(root, realpath, realroot):
            return None
        outside = link and not _inside(realpath, realroot)
        if outside:
            info = link_info
        return {"name": path.name, "rel": _rel(root, path), "abs": str(path),
                "is_dir": is_dir and not outside, "size": None if is_dir and not outside else info.st_size,
                "mtime": info.st_mtime, "link_outside": outside}
    except (OSError, GuardError):
        return None


def _mkdir(root, rel):
    final = _resolve(root, rel, for_write=True)
    created = False
    for n in range(1, len(parts := _segments(rel)) + 1):
        current_rel = "/".join(parts[:n])
        current = _resolve(root, current_rel, for_write=False)
        if current.is_dir():
            continue
        try:
            os.mkdir(current)
            created = n == len(parts)
        except FileExistsError:
            if not current.is_dir():
                raise GuardError("exists_file", "A file already occupies the folder path.")
        # Re-check with live protection, not the request snapshot: a home missing at request start has no
        # identity in the snapshot, and this folder may have just become it.
        _resolve(replace(root, protection=None), current_rel, for_write=False)
    final = _resolve(root, rel, for_write=True)
    if not final.is_dir():
        raise GuardError("exists_file", "A file already occupies the folder path.")
    return final, created


class Target(BaseModel):
    root: str
    path: str


class SizedTarget(Target):
    size: Annotated[StrictInt, Field(ge=0)]


class UploadTarget(Target):
    upload_id: str


class Chunk(UploadTarget):
    offset: Annotated[StrictInt, Field(ge=0)]
    data: str


class Finish(UploadTarget):
    size: Annotated[StrictInt, Field(ge=0)]


def _upload_target(root, rel):
    target = _resolve(root, rel, for_write=True)
    if target == root.path:
        raise GuardError("bad_path", "An upload path must include a filename.")
    return target


def _temp(body, *, required=True):
    if not UPLOAD_RE.fullmatch(body.upload_id):
        raise GuardError("bad_upload_id", "The upload identifier is invalid.")
    root, cfg = _request_root(body.root)
    target = _upload_target(root, body.path)
    temp = target.parent / f".cfm-{body.upload_id}.part"
    try:
        info = os.lstat(temp)
        if stat.S_ISREG(info.st_mode):
            return root, cfg, target, temp, info
    except FileNotFoundError:
        pass
    if required:
        raise GuardError("gone", "The upload is no longer available.")
    return root, cfg, target, temp, None


def _too_large(cap):
    raise GuardError("too_large", "The file exceeds the upload size limit.", max_file_bytes=cap)


@router.get("/available")
def available() -> dict:
    """Desktop feature detection: 200 here means the backend is installed, enabled and mounted."""
    return {"ok": True, "plugin": PLUGIN_NAME, "version": VERSION}


@router.get("/roots")
@_protocol
def roots():
    cfg = _dict(_load_config())
    notes = _dict(_settings(cfg).get("folder_notes"))
    notes = {k: v for k, v in notes.items() if isinstance(k, str) and isinstance(v, str) and len(k) <= 200 and len(v) <= 200}
    result = []
    for root in _roots(cfg):
        kept = {}
        for name, note in notes.items():
            try:
                if len(_segments(name)) != 1 or name in {"", "."} or "/" in name:
                    continue
                path = _resolve(root, name, for_write=False)
                if path.is_dir() and _entry(root, path) is not None:
                    kept[name] = note
            except GuardError:
                continue
        result.append({"id": root.id, "label": root.label, "path": str(root.path), "notes": kept})
    supported = _supported(cfg)
    return {"ok": True, "supported": supported, "reason": None if supported else "The terminal backend is not local.",
            "roots": result, "max_file_bytes": _max_bytes(cfg), "chunk_bytes": CHUNK_BYTES, "highlights": ["docs", "uploads"]}


@router.get("/list")
@_protocol
def list_files(root: str, path: str = "", offset: int = Query(0, ge=0), limit: int = Query(500, ge=1, le=2000)):
    selected, _ = _request_root(root)
    folder = _resolve(selected, path, for_write=False)
    if not folder.is_dir():
        raise GuardError("not_a_dir", "The selected path is not a directory.")
    entries, truncated = [], False
    with os.scandir(folder) as scan:
        for n, item in enumerate(scan):
            if n >= SCAN_LIMIT:
                truncated = True
                break
            entry = _entry(selected, Path(item.path))
            if entry is not None:
                entries.append(entry)
    entries.sort(key=lambda e: (not e["is_dir"], e["name"].lower(), e["name"]))
    return {"ok": True, "root": root, "path": _rel(selected, folder), "entries": entries[offset:offset + limit],
            "total": len(entries), "truncated": truncated}


@router.get("/search")
@_protocol
def search(root: str, q: str, limit: int = Query(100, ge=1, le=200)):
    selected, _ = _request_root(root)
    q = q.strip()
    if not q or len(q) > 200:
        raise GuardError("bad_query", "Use a search query between 1 and 200 characters.")
    stack, results, visited, skipped = [_resolve(selected, "", for_write=False)], [], 0, 0
    started = time.monotonic()
    pattern, lower = "*" in q or "?" in q, q.lower()
    while stack:
        folder = stack.pop()
        try:
            folder = _resolve(selected, _rel(selected, folder), for_write=False)
            with os.scandir(folder) as scan:
                for item in scan:
                    if visited >= SEARCH_VISIT_LIMIT or time.monotonic() - started >= SEARCH_SECONDS:
                        return {"ok": True, "results": results, "truncated": True, "visited": visited, "skipped": skipped}
                    visited += 1
                    entry = _entry(selected, Path(item.path))
                    if entry is None:
                        continue
                    if entry["is_dir"] and (item.name in SEARCH_SKIP or (item.name.startswith(".") and not q.startswith("."))):
                        continue
                    if fnmatch.fnmatch(item.name.lower(), lower) if pattern else lower in item.name.lower():
                        results.append(entry)
                        if len(results) >= limit:
                            return {"ok": True, "results": results, "truncated": True, "visited": visited, "skipped": skipped}
                    if entry["is_dir"] and not item.is_symlink():
                        stack.append(Path(item.path))
        except (GuardError, OSError):
            skipped += 1
    return {"ok": True, "results": results, "truncated": visited >= SEARCH_VISIT_LIMIT, "visited": visited, "skipped": skipped}


@router.post("/mkdir")
@_protocol
def mkdir(body: Target):
    root, _ = _request_root(body.root)
    path, created = _mkdir(root, body.path)
    return {"ok": True, "created": created, "entry": _entry(root, path)}


def _sweep(parent):
    key, now = os.path.realpath(parent), time.monotonic()
    with _SWEEP_LOCK:
        if now - _LAST_SWEEP.get(key, float("-inf")) < 3600:
            return
        _LAST_SWEEP[key] = now
    cutoff = time.time() - 24 * 3600
    with os.scandir(parent) as scan:
        for item in scan:
            if TEMP_RE.fullmatch(item.name):  # exact case: only names this plugin creates
                try:
                    info = os.lstat(item.path)
                    if stat.S_ISREG(info.st_mode) and info.st_mtime < cutoff:
                        os.unlink(item.path)
                except FileNotFoundError:
                    pass


@router.post("/uploads/start")
@_protocol
def upload_start(body: SizedTarget):
    root, cfg = _request_root(body.root)
    cap = _max_bytes(cfg)
    if body.size > cap:
        _too_large(cap)
    target = _upload_target(root, body.path)
    if not target.parent.is_dir():
        _mkdir(root, _rel(root, target.parent))
    target = _resolve(root, body.path, for_write=True)
    _sweep(target.parent)
    upload_id = secrets.token_hex(16)
    temp = target.parent / f".cfm-{upload_id}.part"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
    os.close(os.open(temp, flags, 0o666))
    return {"ok": True, "upload_id": upload_id, "chunk_bytes": CHUNK_BYTES, "max_file_bytes": cap}


@router.post("/uploads/chunk")
@_protocol
def upload_chunk(body: Chunk):
    _, cfg, _, temp, info = _temp(body)
    if len(body.data) > (MAX_CHUNK_BYTES * 4) // 3 + 8:
        raise GuardError("chunk_too_large", "The upload chunk is too large.")
    try:
        decoded = base64.b64decode(body.data, validate=True)
    except (binascii.Error, ValueError):
        raise GuardError("bad_data", "The chunk must contain valid base64 data.")
    if len(decoded) > MAX_CHUNK_BYTES:
        raise GuardError("chunk_too_large", "The upload chunk is too large.")
    if body.offset > info.st_size:
        raise GuardError("offset", "The offset is beyond the uploaded bytes.", size=info.st_size)
    if body.offset + len(decoded) > _max_bytes(cfg):
        _too_large(_max_bytes(cfg))
    fd = os.open(temp, os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0))
    try:
        os.lseek(fd, body.offset, os.SEEK_SET)
        remaining = memoryview(decoded)
        while remaining:
            written = os.write(fd, remaining)
            if written == 0:
                raise OSError("No write progress")
            remaining = remaining[written:]
    finally:
        os.close(fd)
    return {"ok": True, "size": os.lstat(temp).st_size}


def _final_name(name, number):
    if number == 0:
        return name
    path = Path(name)
    suffix, stem = path.suffix, path.stem
    tail = f" ({number}){suffix}"
    budget = 255 - len(tail.encode("utf-8"))
    if budget <= 0:
        raise GuardError("no_free_name", "The filename suffix leaves no room for a collision name.")
    stem = stem.encode("utf-8")[:budget].decode("utf-8", errors="ignore")
    if not stem:
        raise GuardError("no_free_name", "The filename suffix leaves no room for a collision name.")
    return stem + tail


@router.post("/uploads/finish")
@_protocol
def upload_finish(body: Finish):
    root, _, target, temp, info = _temp(body)
    if info.st_size != body.size:
        raise GuardError("size_mismatch", "The uploaded size differs from the expected size.", size=info.st_size)
    for number in range(1000):
        name = _final_name(target.name, number)
        if TEMP_RE.fullmatch(name.lower()):
            continue
        candidate = target.parent / name
        try:
            _resolve(root, _rel(root, candidate), for_write=False)
        except GuardError:
            continue
        try:
            fd = os.open(candidate, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o666)
        except FileExistsError:
            continue
        reserved = os.fstat(fd)
        os.close(fd)
        try:
            os.replace(temp, candidate)
        except OSError:
            try:
                current = os.lstat(candidate)
                if (current.st_dev, current.st_ino) == (reserved.st_dev, reserved.st_ino) and current.st_size == 0:
                    os.unlink(candidate)
            except FileNotFoundError:
                pass
            raise
        return {"ok": True, "entry": _entry(root, candidate), "renamed": candidate.name != target.name}
    raise GuardError("no_free_name", "No unused filename is available.")


@router.post("/uploads/abort")
@_protocol
def upload_abort(body: UploadTarget):
    _, _, _, temp, info = _temp(body, required=False)
    if info is not None:
        try:
            os.unlink(temp)
        except FileNotFoundError:
            pass
    return {"ok": True}
