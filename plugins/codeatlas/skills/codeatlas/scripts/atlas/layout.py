"""Hand-placed box positions (`.codeatlas/layout.json`).

The viewer writes this file when a reader drags boxes; the map tools only
carry it into the standalone page. It is cosmetic, so reading it never fails
a build: anything that is not a well-formed layout is dropped.
"""

from __future__ import annotations

import json
import math
import stat
from pathlib import Path
from typing import Any, Optional

LAYOUT_FILE = "layout.json"
LAYOUT_VERSION = 1
MAX_COORDINATE = 20_000
MAX_VIEWS = 2_000
MAX_NODES_PER_VIEW = 500
MAX_FILE_BYTES = 1_000_000


def _point(value: Any) -> Optional[dict]:
    if not isinstance(value, dict):
        return None
    x, y = value.get("x"), value.get("y")
    return None if _coordinate(x) is None or _coordinate(y) is None else {"x": _coordinate(x), "y": _coordinate(y)}


def _coordinate(number: Any) -> Optional[int]:
    # bool is an int in Python; a layout never contains one.
    if isinstance(number, bool) or not isinstance(number, (int, float)):
        return None
    # Compared before any conversion: an integer of hundreds of digits cannot become a float.
    if isinstance(number, float) and not math.isfinite(number):
        return None
    return min(MAX_COORDINATE, max(0, round(min(MAX_COORDINATE, max(-1, number)))))


def clean_layout(data: Any) -> Optional[dict]:
    """Return the usable part of a parsed layout, or None when there is none."""
    if not isinstance(data, dict) or data.get("version") != LAYOUT_VERSION:
        return None
    views = data.get("views")
    if not isinstance(views, dict):
        return None
    cleaned = {}
    for key, positions in list(views.items())[:MAX_VIEWS]:
        if not isinstance(positions, dict):
            continue
        points = {node: _point(value) for node, value in list(positions.items())[:MAX_NODES_PER_VIEW]}
        kept = {node: point for node, point in points.items() if point is not None}
        if kept:
            cleaned[key] = kept
    return {"version": LAYOUT_VERSION, "views": cleaned} if cleaned else None


def load_layout(path: Path) -> Optional[dict]:
    """Read a layout file. Missing, unreadable, oversized or malformed files give None.

    Only a regular file is read: a repository can commit this path as a link
    to a device or to something enormous.
    """
    try:
        status = path.lstat()
        if not stat.S_ISREG(status.st_mode) or status.st_size > MAX_FILE_BYTES:
            return None
        return clean_layout(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, ValueError, ArithmeticError, RecursionError, MemoryError):
        return None
