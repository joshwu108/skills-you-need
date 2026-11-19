"""The map file: constants, loading and saving.

A map is plain JSON. Functions elsewhere in this package take a map and
return a new one; nothing mutates a map it was given.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any, Optional

MAP_VERSION = 1
MAP_DIR = ".codeatlas"
MAP_FILE = "map.json"
VIEWER_FILE = "atlas.html"

NODE_KINDS = ("service", "module", "function", "step", "data", "external", "note")
# A box the user added from the diagram. It is theirs: held to none of the
# writing rules, and never counted against the size of a view.
USER_KIND = "note"
EDGE_KINDS = ("call", "data", "event")

ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
HASH_PATTERN = re.compile(r"^[0-9a-f]{16}$")


_LINE_BREAK = re.compile(r"\r\n|\r|\n")


def split_lines(text: str) -> list:
    """Split source text the way editors do: on CR, LF and CRLF only.

    `str.splitlines` also breaks on form feeds and Unicode separators, which
    would number lines differently from VS Code and from Python's own parser.
    """
    lines = _LINE_BREAK.split(text)
    if lines and lines[-1] == "":
        lines.pop()
    return lines


def read_source(path: Path) -> str:
    """Read a source file, dropping a byte order mark as editors do."""
    return path.read_text(encoding="utf-8-sig", errors="replace")


class MapError(Exception):
    """The map file could not be read or is not usable."""


def load_map(path: Path) -> dict:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        raise MapError(f"cannot read {path}: {error.strerror or error}") from error
    try:
        data = json.loads(text)
    except json.JSONDecodeError as error:
        raise MapError(
            f"{path} is not valid JSON (line {error.lineno}, column {error.colno}): {error.msg}"
        ) from error
    if not isinstance(data, dict):
        raise MapError(f"{path} must contain a JSON object")
    return data


def dump_map(atlas: dict) -> str:
    return json.dumps(atlas, indent=2, ensure_ascii=False) + "\n"


def write_text(path: Path, text: str) -> None:
    """Write a file atomically, and never through a symbolic link.

    A repository can commit `.codeatlas/atlas.html` as a link to any file the
    user can write. Following it would let a cloned repository overwrite that
    file, so a link in the way is an error, and the write replaces the path
    itself (temporary file, then rename) instead of writing into it.
    """
    if path.is_symlink():
        raise MapError(f"refusing to write {path}: it is a symbolic link")
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            stream.write(text)
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def save_map(path: Path, atlas: dict) -> None:
    write_text(path, dump_map(atlas))


def find_map(start: Path) -> Optional[Path]:
    """Return the nearest `.codeatlas/map.json` at or above `start`."""
    current = start if start.is_dir() else start.parent
    for directory in (current, *current.parents):
        candidate = directory / MAP_DIR / MAP_FILE
        # A linked `.codeatlas` would send every write outside the repository.
        if candidate.is_file() and not candidate.parent.is_symlink():
            return candidate
    return None


def nodes_of(atlas: Any) -> list:
    nodes = atlas.get("nodes") if isinstance(atlas, dict) else None
    return [n for n in nodes if isinstance(n, dict)] if isinstance(nodes, list) else []
