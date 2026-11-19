"""Structural checks for a map.

Errors make the map unusable by the viewer or the extension. Warnings flag
maps that load but will read badly (crowded views, leaves with no code).
With `strict`, anchors must also resolve against the files under `root`.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Optional

from .model import (
    EDGE_KINDS,
    HASH_PATTERN,
    ID_PATTERN,
    MAP_VERSION,
    NODE_KINDS,
    USER_KIND,
    read_source,
    split_lines,
)

MAX_CHILDREN_PER_VIEW = 12
MAX_SUMMARY_LENGTH = 160

MAP_KEYS = {"$schema", "version", "title", "summary", "nodes", "edges"}
NODE_KEYS = {
    "id", "parent", "kind", "title", "summary", "explanation",
    "anchors", "planned", "stale", "staleReason",
}
ANCHOR_KEYS = {"file", "symbol", "startLine", "endLine", "hash"}
EDGE_KEYS = {"from", "to", "label", "kind", "user"}
# Kinds that describe something outside the repository, so no code is expected.
UNANCHORED_KINDS = {"external", "data", USER_KIND}


@dataclass(frozen=True)
class Issue:
    level: str  # "error" or "warning"
    path: str
    message: str

    def __str__(self) -> str:
        return f"{self.level}: {self.path}: {self.message}"


def validate_map(atlas: Any, root: Optional[Path] = None, strict: bool = False) -> list:
    """Return every problem found in `atlas`, errors first."""
    if not isinstance(atlas, dict):
        return [Issue("error", "$", "the map must be a JSON object")]

    issues = [
        *_check_header(atlas),
        *_check_nodes(atlas),
        *_check_edges(atlas),
    ]
    if strict and root is not None:
        issues.extend(_check_against_files(atlas, root))
    return sorted(issues, key=lambda issue: issue.level != "error")


def has_errors(issues: list) -> bool:
    return any(issue.level == "error" for issue in issues)


def _unknown_keys(value: dict, allowed: set, path: str) -> list:
    return [
        Issue("warning", f"{path}.{key}", f"unknown key '{key}' is ignored")
        for key in value
        if key not in allowed
    ]


def _is_text(value: Any) -> bool:
    return isinstance(value, str) and value.strip() != ""


def _is_line(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 1


def _check_header(atlas: dict) -> list:
    issues = _unknown_keys(atlas, MAP_KEYS, "$")
    if atlas.get("version") != MAP_VERSION:
        issues.append(Issue("error", "version", f"version must be {MAP_VERSION}"))
    if not _is_text(atlas.get("title")):
        issues.append(Issue("error", "title", "title must be a non-empty string"))
    if "summary" in atlas and not isinstance(atlas["summary"], str):
        issues.append(Issue("error", "summary", "summary must be a string"))
    return issues


def _check_nodes(atlas: dict) -> list:
    nodes = atlas.get("nodes")
    if not isinstance(nodes, list) or not nodes:
        return [Issue("error", "nodes", "nodes must be a non-empty list")]

    issues = []
    id_counts = Counter(n.get("id") for n in nodes if isinstance(n, dict))
    known_ids = {i for i in id_counts if isinstance(i, str)}
    for index, node in enumerate(nodes):
        path = f"nodes[{index}]"
        if not isinstance(node, dict):
            issues.append(Issue("error", path, "a node must be an object"))
            continue
        issues.extend(_check_node(node, path, known_ids))
        if id_counts[node.get("id")] > 1:
            issues.append(Issue("error", f"{path}.id", f"duplicate id '{node.get('id')}'"))

    issues.extend(_check_hierarchy(nodes))
    return issues


def _check_node(node: dict, path: str, known_ids: set) -> list:
    issues = _unknown_keys(node, NODE_KEYS, path)
    node_id = node.get("id")
    if not isinstance(node_id, str) or not ID_PATTERN.match(node_id):
        issues.append(Issue(
            "error", f"{path}.id",
            "id must be lowercase letters, digits, '.', '_' or '-', starting with a letter or digit",
        ))
    parent = node.get("parent")
    if parent is not None and parent not in known_ids:
        issues.append(Issue("error", f"{path}.parent", f"parent '{parent}' is not a node id"))
    if node.get("kind") not in NODE_KINDS:
        issues.append(Issue("error", f"{path}.kind", f"kind must be one of {', '.join(NODE_KINDS)}"))
    if not _is_text(node.get("title")):
        issues.append(Issue("error", f"{path}.title", "title must be a non-empty string"))
    for key in ("summary", "explanation", "staleReason"):
        if key in node and not isinstance(node[key], str):
            issues.append(Issue("error", f"{path}.{key}", f"{key} must be a string"))
    for key in ("planned", "stale"):
        if key in node and not isinstance(node[key], bool):
            issues.append(Issue("error", f"{path}.{key}", f"{key} must be true or false"))
    if len(node.get("summary") or "") > MAX_SUMMARY_LENGTH:
        issues.append(Issue(
            "warning", f"{path}.summary",
            f"summary is longer than {MAX_SUMMARY_LENGTH} characters; move detail to explanation",
        ))
    is_users = node.get("kind") == USER_KIND
    if not _is_text(node.get("explanation")) and not node.get("planned") and not is_users:
        issues.append(Issue("warning", f"{path}.explanation", "node has no explanation"))

    anchors = node.get("anchors", [])
    if not isinstance(anchors, list):
        issues.append(Issue("error", f"{path}.anchors", "anchors must be a list"))
        return issues
    for index, anchor in enumerate(anchors):
        issues.extend(_check_anchor(anchor, f"{path}.anchors[{index}]"))
    return issues


def _check_anchor(anchor: Any, path: str) -> list:
    if not isinstance(anchor, dict):
        return [Issue("error", path, "an anchor must be an object")]
    issues = _unknown_keys(anchor, ANCHOR_KEYS, path)

    file = anchor.get("file")
    if not _is_text(file):
        issues.append(Issue("error", f"{path}.file", "file must be a non-empty string"))
    elif not is_repo_relative(file):
        issues.append(Issue(
            "error", f"{path}.file",
            "file must be a relative path inside the repository, with forward slashes",
        ))

    has_symbol = "symbol" in anchor
    if has_symbol and not _is_text(anchor["symbol"]):
        issues.append(Issue("error", f"{path}.symbol", "symbol must be a non-empty string"))
    has_start, has_end = "startLine" in anchor, "endLine" in anchor
    if has_start != has_end:
        issues.append(Issue("error", path, "startLine and endLine must be given together"))
    elif has_start:
        start, end = anchor["startLine"], anchor["endLine"]
        if not _is_line(start) or not _is_line(end):
            issues.append(Issue("error", path, "startLine and endLine must be integers from 1"))
        elif start > end:
            issues.append(Issue("error", path, "startLine must not be after endLine"))
    elif not has_symbol:
        issues.append(Issue("error", path, "an anchor needs a symbol or a startLine/endLine range"))

    if "hash" in anchor and not (
        isinstance(anchor["hash"], str) and HASH_PATTERN.match(anchor["hash"])
    ):
        issues.append(Issue("error", f"{path}.hash", "hash must be 16 hex characters; let 'stamp' write it"))
    return issues


def is_repo_relative(file: str) -> bool:
    if "\\" in file or file.startswith("/") or ":" in file.split("/")[0]:
        return False
    return ".." not in PurePosixPath(file).parts


def _check_hierarchy(nodes: list) -> list:
    issues = []
    by_id = {n["id"]: n for n in nodes if isinstance(n, dict) and isinstance(n.get("id"), str)}
    children = Counter(
        n.get("parent") for n in by_id.values() if n.get("parent") is None or n.get("parent") in by_id
    )
    # The size limit is advice to whoever draws the map; the user's notes are not theirs to group.
    drawn = Counter(
        n.get("parent")
        for n in by_id.values()
        if n.get("kind") != USER_KIND and (n.get("parent") is None or n.get("parent") in by_id)
    )
    index_of = {id(n): i for i, n in enumerate(nodes)}

    for node_id, node in by_id.items():
        path = f"nodes[{index_of[id(node)]}]"
        seen = {node_id}
        parent = node.get("parent")
        while isinstance(parent, str) and parent in by_id:
            if parent in seen:
                issues.append(Issue("error", f"{path}.parent", f"parent chain of '{node_id}' forms a cycle"))
                break
            seen.add(parent)
            parent = by_id[parent].get("parent")

        is_leaf = children[node_id] == 0
        needs_code = node.get("kind") not in UNANCHORED_KINDS and not node.get("planned")
        if is_leaf and needs_code and not node.get("anchors"):
            issues.append(Issue("warning", f"{path}.anchors", f"leaf node '{node_id}' has no anchor to code"))
        if drawn[node_id] > MAX_CHILDREN_PER_VIEW:
            issues.append(Issue(
                "warning", path,
                f"'{node_id}' has {drawn[node_id]} children; group them so a view stays under "
                f"{MAX_CHILDREN_PER_VIEW + 1}",
            ))

    if children[None] == 0:
        issues.append(Issue("error", "nodes", "at least one node must have parent null"))
    elif drawn[None] > MAX_CHILDREN_PER_VIEW:
        issues.append(Issue(
            "warning", "nodes",
            f"the top level has {drawn[None]} children; group them so a view stays under "
            f"{MAX_CHILDREN_PER_VIEW + 1}",
        ))
    return issues


def _check_edges(atlas: dict) -> list:
    edges = atlas.get("edges", [])
    if not isinstance(edges, list):
        return [Issue("error", "edges", "edges must be a list")]
    known_ids = {n.get("id") for n in atlas.get("nodes", []) if isinstance(n, dict)}
    issues = []
    seen = set()
    for index, edge in enumerate(edges):
        path = f"edges[{index}]"
        if not isinstance(edge, dict):
            issues.append(Issue("error", path, "an edge must be an object"))
            continue
        issues.extend(_unknown_keys(edge, EDGE_KEYS, path))
        if "user" in edge and not isinstance(edge["user"], bool):
            issues.append(Issue("error", f"{path}.user", "user must be true or false"))
        for end in ("from", "to"):
            if edge.get(end) not in known_ids:
                issues.append(Issue("error", f"{path}.{end}", f"'{edge.get(end)}' is not a node id"))
        if edge.get("from") == edge.get("to"):
            issues.append(Issue("error", path, "an edge cannot connect a node to itself"))
        if "label" in edge and not isinstance(edge["label"], str):
            issues.append(Issue("error", f"{path}.label", "label must be a string"))
        if "kind" in edge and edge["kind"] not in EDGE_KINDS:
            issues.append(Issue("error", f"{path}.kind", f"kind must be one of {', '.join(EDGE_KINDS)}"))
        key = (edge.get("from"), edge.get("to"), edge.get("label"))
        if key in seen:
            issues.append(Issue("warning", path, "duplicate edge"))
        seen.add(key)
    return issues


def _check_against_files(atlas: dict, root: Path) -> list:
    issues = []
    line_counts: dict = {}
    for node_index, node in enumerate(atlas.get("nodes", [])):
        if not isinstance(node, dict) or not isinstance(node.get("anchors"), list):
            continue
        for anchor_index, anchor in enumerate(node["anchors"]):
            path = f"nodes[{node_index}].anchors[{anchor_index}]"
            if not isinstance(anchor, dict) or not _is_text(anchor.get("file")):
                continue
            file = anchor["file"]
            if not is_repo_relative(file):
                continue
            if file not in line_counts:
                line_counts[file] = _count_lines(root / file)
            if line_counts[file] is None:
                issues.append(Issue("error", f"{path}.file", f"'{file}' does not exist under {root}"))
                continue
            if "hash" not in anchor or not _is_line(anchor.get("endLine")):
                issues.append(Issue("error", path, "anchor has no line range and hash yet; run 'stamp'"))
            elif anchor["endLine"] > line_counts[file]:
                issues.append(Issue(
                    "error", path,
                    f"lines {anchor.get('startLine')}-{anchor['endLine']} run past the end of "
                    f"'{file}' ({line_counts[file]} lines); run 'refresh'",
                ))
    return issues


def _count_lines(path: Path) -> Optional[int]:
    try:
        return len(split_lines(read_source(path)))
    except OSError:
        return None
