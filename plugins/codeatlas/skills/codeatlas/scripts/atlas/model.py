"""The map file: constants, loading and saving.

A map is plain JSON. Functions elsewhere in this package take a map and
return a new one; nothing mutates a map it was given.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Optional

MAP_VERSION = 1
MAP_DIR = ".codeatlas"
MAP_FILE = "map.json"
VIEWER_FILE = "atlas.html"

NODE_KINDS = ("service", "module", "function", "step", "data", "external")
EDGE_KINDS = ("call", "data", "event")

ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
HASH_PATTERN = re.compile(r"^[0-9a-f]{16}$")


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


def save_map(path: Path, atlas: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dump_map(atlas), encoding="utf-8")


def find_map(start: Path) -> Optional[Path]:
    """Return the nearest `.codeatlas/map.json` at or above `start`."""
    current = start if start.is_dir() else start.parent
    for directory in (current, *current.parents):
        candidate = directory / MAP_DIR / MAP_FILE
        if candidate.is_file():
            return candidate
    return None


def nodes_of(atlas: Any) -> list:
    nodes = atlas.get("nodes") if isinstance(atlas, dict) else None
    return [n for n in nodes if isinstance(n, dict)] if isinstance(nodes, list) else []
