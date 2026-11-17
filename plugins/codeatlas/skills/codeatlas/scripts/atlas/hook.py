"""PostToolUse hook: keep the map honest after Claude edits a file.

Runs after every Edit or Write, so it does nothing unless the edited file
sits under a repository that has a map and that map anchors the file. Code
that only moved is followed quietly. Code that changed marks its nodes
stale and tells Claude which explanations now need rewriting.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from .anchors import refresh
from .model import MAP_DIR, VIEWER_FILE, find_map, load_map, nodes_of, save_map
from .viewer import build_html


def run_hook(payload: dict) -> Optional[dict]:
    """Return the hook's JSON output, or None when there is nothing to say."""
    tool_input = payload.get("tool_input")
    file_path = tool_input.get("file_path") if isinstance(tool_input, dict) else None
    if not isinstance(file_path, str) or not file_path:
        return None

    edited = Path(file_path)
    if not edited.is_absolute():
        edited = Path(str(payload.get("cwd") or ".")) / edited
    edited = edited.resolve()
    if MAP_DIR in edited.parts:
        return None

    map_path = find_map(edited)
    if map_path is None:
        return None
    root = map_path.parent.parent.resolve()
    try:
        relative = edited.relative_to(root).as_posix()
    except ValueError:
        return None

    atlas = load_map(map_path)
    if not _anchors_file(atlas, relative):
        return None

    result = refresh(atlas, root, only_file=relative)
    if result.atlas == atlas:
        return None
    save_map(map_path, result.atlas)
    _rebuild_viewer(map_path.parent / VIEWER_FILE, result.atlas, root)

    if not result.stale_ids:
        return None
    listed = ", ".join(result.stale_ids)
    return {
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": (
                f"CodeAtlas: the edit to {relative} changed code behind these map nodes: {listed}. "
                "They are marked stale in .codeatlas/map.json. When this change is finished, rewrite "
                "their explanations to match the new code and re-stamp them with the codeatlas skill."
            ),
        }
    }


def _anchors_file(atlas: dict, relative: str) -> bool:
    return any(
        isinstance(anchor, dict) and anchor.get("file") == relative
        for node in nodes_of(atlas)
        for anchor in node.get("anchors") or []
    )


def _rebuild_viewer(viewer_path: Path, atlas: dict, root: Path) -> None:
    """Refresh an already-built viewer so it shows the new stale flags."""
    if viewer_path.is_file():
        viewer_path.write_text(build_html(atlas, root), encoding="utf-8")
