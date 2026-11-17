#!/usr/bin/env python3
"""Command line for CodeAtlas maps.

    codeatlas.py build      stamp new anchors, refresh, validate, write the viewer
    codeatlas.py validate   check the map's structure
    codeatlas.py stamp      (re)compute line ranges and hashes
    codeatlas.py refresh    follow moved code and mark changed nodes stale
    codeatlas.py status     list stale nodes without changing anything
    codeatlas.py symbols    list the definitions found in a source file
    codeatlas.py hook       PostToolUse entry point (reads JSON on stdin)

Exit codes: 0 success, 1 the map needs attention, 2 the command could not run.
"""

from __future__ import annotations

import argparse
import json
import sys
import webbrowser
from pathlib import Path
from typing import Optional, Sequence

from atlas.anchors import CHANGED, MISSING, MOVED, refresh, stamp
from atlas.hook import run_hook
from atlas.model import (
    MAP_DIR,
    MAP_FILE,
    VIEWER_FILE,
    MapError,
    find_map,
    load_map,
    nodes_of,
    read_source,
    save_map,
    write_text,
)
from atlas.symbols import list_symbols
from atlas.validate import has_errors, validate_map
from atlas.viewer import build_html

EXIT_OK, EXIT_ATTENTION, EXIT_FAILED = 0, 1, 2


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = _parser().parse_args(argv)
    try:
        return args.run(args)
    except MapError as error:
        print(f"codeatlas: {error}", file=sys.stderr)
        return EXIT_FAILED


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="codeatlas.py", description=__doc__.split("\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)

    def add(name: str, run, help_text: str) -> argparse.ArgumentParser:
        command = commands.add_parser(name, help=help_text)
        command.set_defaults(run=run)
        return command

    def with_map(command: argparse.ArgumentParser) -> argparse.ArgumentParser:
        command.add_argument("--map", type=Path, help=f"map file (default: nearest {MAP_DIR}/{MAP_FILE})")
        command.add_argument("--root", type=Path, help="repository root (default: the folder holding .codeatlas)")
        return command

    build = with_map(add("build", _build, "stamp new anchors, validate, write the viewer"))
    build.add_argument("--open", action="store_true", help="open the viewer in the default browser")
    build.add_argument("--output", type=Path, help=f"viewer path (default: {MAP_DIR}/{VIEWER_FILE})")

    validate = with_map(add("validate", _validate, "check the map's structure"))
    validate.add_argument("--strict", action="store_true", help="also check anchors against the files")

    stamp_command = with_map(add("stamp", _stamp, "(re)compute line ranges and hashes"))
    stamp_command.add_argument("--node", action="append", default=[], help="re-stamp this node and clear its stale flag")
    stamp_command.add_argument("--all", action="store_true", help="re-stamp every node")

    with_map(add("refresh", _refresh, "follow moved code and mark changed nodes stale"))
    with_map(add("status", _status, "list stale nodes without changing anything"))

    symbols = add("symbols", _symbols, "list the definitions found in a source file")
    symbols.add_argument("file", type=Path)

    add("hook", _hook, "PostToolUse entry point")
    return parser


def _locate(args: argparse.Namespace) -> tuple:
    """Resolve the map path and repository root from the arguments."""
    map_path = args.map or find_map(Path.cwd()) or Path.cwd() / MAP_DIR / MAP_FILE
    map_path = map_path.resolve()
    root = (args.root or map_path.parent.parent).resolve()
    return map_path, root


def _print_issues(issues: list) -> None:
    for issue in issues:
        print(issue)


def _load_sound(map_path: Path) -> Optional[dict]:
    """Load a map that is structurally sound, or print why it is not.

    stamp and refresh rewrite the file, so they only ever run on a map whose
    fields have the right types; otherwise the errors are shown and nothing is
    changed.
    """
    atlas = load_map(map_path)
    issues = validate_map(atlas)
    if has_errors(issues):
        _print_issues([issue for issue in issues if issue.level == "error"])
        print("The map was not changed. Fix the errors above first.")
        return None
    return atlas


def _build(args: argparse.Namespace) -> int:
    map_path, root = _locate(args)
    sound = _load_sound(map_path)
    if sound is None:
        return EXIT_ATTENTION
    stamped = stamp(sound, root)
    for error in stamped.errors:
        print(f"error: {error}")
    # Refresh after stamping so the page shows current line ranges and stale flags.
    atlas = stamped.atlas if stamped.errors else refresh(stamped.atlas, root).atlas
    issues = validate_map(atlas, root=root, strict=not stamped.errors)
    _print_issues(issues)
    if stamped.errors or has_errors(issues):
        print("The map was not built. Fix the errors above and run build again.")
        return EXIT_ATTENTION

    save_map(map_path, atlas)
    # Not resolved: a link at the output path must be seen and refused, not followed.
    output = (args.output or map_path.parent / VIEWER_FILE).absolute()
    write_text(output, build_html(atlas, root))
    _ignore_viewer(map_path.parent)

    stale = _stale_ids(atlas)
    print(f"Wrote {output} ({len(nodes_of(atlas))} nodes, {stamped.stamped} anchors stamped).")
    if stale:
        print(f"Stale nodes still to rewrite: {', '.join(stale)}")
    if args.open:
        webbrowser.open(output.as_uri())
    return EXIT_OK


def _ignore_viewer(map_dir: Path) -> None:
    """The viewer embeds absolute paths, so it must stay out of version control."""
    ignore = map_dir / ".gitignore"
    existing = ignore.read_text(encoding="utf-8") if ignore.is_file() else ""
    if VIEWER_FILE not in existing.splitlines():
        write_text(ignore, existing + VIEWER_FILE + "\n")


def _validate(args: argparse.Namespace) -> int:
    map_path, root = _locate(args)
    issues = validate_map(load_map(map_path), root=root, strict=args.strict)
    _print_issues(issues)
    if has_errors(issues):
        return EXIT_ATTENTION
    print(f"{map_path} is valid ({len(issues)} warnings).")
    return EXIT_OK


def _stamp(args: argparse.Namespace) -> int:
    map_path, root = _locate(args)
    sound = _load_sound(map_path)
    if sound is None:
        return EXIT_ATTENTION
    result = stamp(sound, root, node_ids=args.node, force=args.all)
    for error in result.errors:
        print(f"error: {error}")
    if result.errors:
        return EXIT_ATTENTION
    save_map(map_path, result.atlas)
    print(f"Stamped {result.stamped} anchors.")
    return EXIT_OK


def _refresh(args: argparse.Namespace) -> int:
    map_path, root = _locate(args)
    atlas = _load_sound(map_path)
    if atlas is None:
        return EXIT_ATTENTION
    result = refresh(atlas, root)
    if result.atlas != atlas:
        save_map(map_path, result.atlas)
    for report in result.reports:
        if report.status in (MOVED, CHANGED, MISSING):
            print(f"{report.status:8} {report.node_id}: {report.detail}")
    return _report_stale(result.atlas)


def _status(args: argparse.Namespace) -> int:
    map_path, _ = _locate(args)
    if not map_path.exists():
        # Asking "is there a map?" is a normal first question, not a failure.
        print(f"No map yet. A new one would be written to {map_path}.")
        return EXIT_OK
    return _report_stale(load_map(map_path))


def _stale_ids(atlas: dict) -> list:
    return [str(node.get("id")) for node in nodes_of(atlas) if node.get("stale")]


def _report_stale(atlas: dict) -> int:
    stale = [node for node in nodes_of(atlas) if node.get("stale")]
    if not stale:
        print("Every node is current.")
        return EXIT_OK
    print(f"{len(stale)} stale nodes:")
    for node in stale:
        print(f"  {node.get('id')}: {node.get('staleReason', 'code changed')}")
    return EXIT_ATTENTION


def _symbols(args: argparse.Namespace) -> int:
    try:
        text = read_source(args.file)
    except OSError as error:
        raise MapError(f"cannot read {args.file}: {error.strerror or error}") from error
    for name, span in list_symbols(args.file.name, text):
        print(f"{span.start}-{span.end}\t{name}")
    return EXIT_OK


def _hook(_: argparse.Namespace) -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as error:
        raise MapError(f"hook input is not JSON: {error.msg}") from error
    output = run_hook(payload if isinstance(payload, dict) else {})
    if output is not None:
        print(json.dumps(output))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
