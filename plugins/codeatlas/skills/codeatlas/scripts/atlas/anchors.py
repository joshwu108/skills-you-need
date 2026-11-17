"""Tie map nodes to code ranges and notice when the code changes.

An anchor stores a line range plus a hash of those lines. `stamp` writes
both for anchors the author just created. `refresh` re-checks every anchor
against the working tree: code that only moved is followed silently, code
whose content changed marks its node stale so the explanation gets rewritten.

Invariant: after `refresh`, every resolvable anchor's hash matches the lines
it points at. Staleness therefore lives on the node (`stale: true`) and is
cleared only by stamping that node again.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional, Sequence

from .model import read_source, split_lines
from .symbols import Span, find_symbol
from .validate import is_repo_relative

HASH_LENGTH = 16
# Looking for a moved block hashes every window of the file, which costs
# (windows x block length) line reads. Above this the search is skipped and
# the anchor is resolved by symbol or reported as changed instead.
MAX_SEARCH_WORK = 400_000

OK, MOVED, CHANGED, MISSING = "ok", "moved", "changed", "missing"


@dataclass(frozen=True)
class AnchorReport:
    node_id: str
    file: str
    status: str
    detail: str


@dataclass(frozen=True)
class StampResult:
    atlas: dict
    errors: list
    stamped: int


@dataclass(frozen=True)
class RefreshResult:
    atlas: dict
    reports: list

    @property
    def stale_ids(self) -> list:
        return sorted({r.node_id for r in self.reports if r.status in (CHANGED, MISSING)})


def hash_lines(lines: Sequence[str]) -> str:
    """Hash a block of code, ignoring trailing spaces and tabs on each line.

    The VS Code extension computes the same hash (`hashLines` in resolve.ts);
    the two must agree byte for byte, so the stripped set is spelled out.
    """
    normalised = "\n".join(line.rstrip(" \t") for line in lines)
    return hashlib.sha256(normalised.encode("utf-8")).hexdigest()[:HASH_LENGTH]


class _Files:
    """Reads each source file at most once per run."""

    def __init__(self, root: Path) -> None:
        self._root = root
        self._cache: dict = {}

    def lines(self, file: object) -> Optional[list]:
        if not isinstance(file, str):
            return None
        if file not in self._cache:
            self._cache[file] = self._read(file)
        return self._cache[file]

    def _read(self, file: str) -> Optional[list]:
        if not is_repo_relative(file):
            return None
        try:
            return split_lines(read_source(self._root / file))
        except OSError:
            return None


def stamp(
    atlas: dict,
    root: Path,
    node_ids: Optional[Iterable[str]] = None,
    force: bool = False,
) -> StampResult:
    """Fill in line ranges and hashes.

    By default only anchors that have no hash yet are stamped. Naming nodes
    (or `force`) re-stamps all their anchors and clears their stale flag;
    use that after rewriting a stale node's explanation.
    """
    nodes = _node_list(atlas)
    selected = set(node_ids or [])
    known = {node.get("id") for node in nodes if isinstance(node, dict)}
    errors = [f"no node with id '{node_id}'" for node_id in sorted(selected - known)]
    files = _Files(root)
    stamped = 0
    new_nodes = []

    for node in nodes:
        if not isinstance(node, dict):
            new_nodes.append(node)
            continue
        restamp = force or node.get("id") in selected
        new_anchors = []
        for anchor in _anchor_list(node):
            if not isinstance(anchor, dict) or ("hash" in anchor and not restamp):
                new_anchors.append(anchor)
                continue
            new_anchor, error = _stamp_anchor(anchor, files)
            if error:
                errors.append(f"{node.get('id')}: {error}")
            else:
                stamped += 1
            new_anchors.append(new_anchor)
        new_node = {**node}
        if isinstance(node.get("anchors"), list):
            new_node["anchors"] = new_anchors
        if restamp:
            new_node.pop("stale", None)
            new_node.pop("staleReason", None)
        new_nodes.append(new_node)

    return StampResult(_with_nodes(atlas, new_nodes), errors, stamped)


def _node_list(atlas: dict) -> list:
    """The map's nodes, or nothing when the field is not a list.

    These functions may be handed a map that has not been validated. A field
    of the wrong type is left exactly as it was, never iterated or rewritten.
    """
    nodes = atlas.get("nodes")
    return nodes if isinstance(nodes, list) else []


def _anchor_list(node: dict) -> list:
    anchors = node.get("anchors")
    return anchors if isinstance(anchors, list) else []


def _with_nodes(atlas: dict, nodes: list) -> dict:
    return {**atlas, "nodes": nodes} if isinstance(atlas.get("nodes"), list) else atlas


def _is_line(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _stamp_anchor(anchor: dict, files: _Files) -> tuple:
    file = anchor.get("file")
    lines = files.lines(file)
    if lines is None:
        return anchor, f"cannot read '{file}'"

    span = None
    symbol = anchor.get("symbol")
    if isinstance(symbol, str) and symbol:
        span = find_symbol(file, "\n".join(lines), symbol)
    if span is None and _is_line(anchor.get("startLine")) and _is_line(anchor.get("endLine")):
        span = Span(anchor["startLine"], anchor["endLine"])
    if span is None:
        return anchor, (
            f"symbol '{symbol}' was not found in '{file}' (or is ambiguous); "
            "qualify it or give startLine/endLine"
        )
    if span.start < 1 or span.end > len(lines) or span.start > span.end:
        return anchor, f"lines {span.start}-{span.end} are outside '{file}' ({len(lines)} lines)"

    return _with_span(anchor, span, lines), None


def _with_span(anchor: dict, span: Span, lines: list) -> dict:
    return {
        **anchor,
        "startLine": span.start,
        "endLine": span.end,
        "hash": hash_lines(lines[span.start - 1 : span.end]),
    }


def refresh(atlas: dict, root: Path, only_file: Optional[str] = None) -> RefreshResult:
    """Re-resolve anchors against the working tree and flag stale nodes."""
    files = _Files(root)
    reports = []
    new_nodes = []

    for node in _node_list(atlas):
        if not isinstance(node, dict):
            new_nodes.append(node)
            continue
        new_anchors = []
        reasons = []
        for anchor in _anchor_list(node):
            if not isinstance(anchor, dict) or (only_file and anchor.get("file") != only_file):
                new_anchors.append(anchor)
                continue
            new_anchor, status, detail = _refresh_anchor(anchor, files)
            new_anchors.append(new_anchor)
            reports.append(AnchorReport(str(node.get("id")), str(anchor.get("file")), status, detail))
            if status in (CHANGED, MISSING):
                reasons.append(detail)
        new_node = {**node}
        if isinstance(node.get("anchors"), list):
            new_node["anchors"] = new_anchors
        if reasons:
            new_node["stale"] = True
            new_node["staleReason"] = "; ".join(reasons)
        new_nodes.append(new_node)

    return RefreshResult(_with_nodes(atlas, new_nodes), reports)


def _refresh_anchor(anchor: dict, files: _Files) -> tuple:
    file = anchor.get("file")
    lines = files.lines(file)
    if lines is None:
        return anchor, MISSING, f"{file} no longer exists"

    symbol = anchor.get("symbol")
    label = f"{file} ({symbol})" if symbol else str(file)
    old_hash = anchor.get("hash")
    start, end = anchor.get("startLine"), anchor.get("endLine")
    has_range = _is_line(start) and _is_line(end) and 1 <= start <= end

    if old_hash is None:
        stamped, error = _stamp_anchor(anchor, files)
        return (anchor, MISSING, error) if error else (stamped, OK, "stamped")

    if has_range and end <= len(lines) and hash_lines(lines[start - 1 : end]) == old_hash:
        return anchor, OK, ""

    if has_range:
        moved_to = _find_block(lines, end - start + 1, old_hash, near=start)
        if moved_to is not None:
            span = Span(moved_to, moved_to + end - start)
            return _with_span(anchor, span, lines), MOVED, f"{label} moved to line {moved_to}"

    if isinstance(symbol, str) and symbol:
        span = find_symbol(file, "\n".join(lines), symbol)
        if span is None:
            return anchor, MISSING, f"{label} was removed or renamed"
        return _with_span(anchor, span, lines), CHANGED, f"{label} changed"

    if not has_range or start > len(lines):
        return anchor, MISSING, f"{label} no longer has lines {start}-{end}"
    span = Span(start, min(end, len(lines)))
    return _with_span(anchor, span, lines), CHANGED, f"{label} changed at lines {span.start}-{span.end}"


def _find_block(lines: list, length: int, wanted: str, near: int) -> Optional[int]:
    """Return the 1-based start of the block with hash `wanted` closest to `near`."""
    windows = len(lines) - length + 1
    if windows <= 0 or windows * length > MAX_SEARCH_WORK:
        return None
    matches = [
        index + 1 for index in range(windows) if hash_lines(lines[index : index + length]) == wanted
    ]
    return min(matches, key=lambda line: abs(line - near)) if matches else None
