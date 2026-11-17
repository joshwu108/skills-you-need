from __future__ import annotations

import base64
import hashlib
import json
import re
from pathlib import Path

import pytest

import codeatlas
from atlas.anchors import stamp
from atlas.hook import run_hook
from atlas.model import MapError, find_map, load_map, save_map
from atlas.viewer import build_html

from conftest import PY_SOURCE


@pytest.fixture
def assets(tmp_path: Path) -> Path:
    directory = tmp_path / "assets"
    directory.mkdir()
    (directory / "viewer.js").write_text("console.info('</script>');", encoding="utf-8")
    (directory / "viewer.css").write_text("body{margin:0}", encoding="utf-8")
    return directory


@pytest.fixture
def mapped_repo(repo: Path, atlas: dict) -> Path:
    """The sample repository with a stamped map saved in it."""
    save_map(repo / ".codeatlas" / "map.json", stamp(atlas, repo).atlas)
    return repo


def edit_payload(repo: Path, file: str = "src/engine.py") -> dict:
    return {
        "hook_event_name": "PostToolUse",
        "tool_name": "Edit",
        "cwd": str(repo),
        "tool_input": {"file_path": str(repo / file)},
    }


# --- viewer -----------------------------------------------------------------


def embedded_data(html: str) -> dict:
    match = re.search(r'<script id="atlas-data" type="application/json">(.*?)</script>', html, re.S)
    return json.loads(match.group(1))


def test_viewer_embeds_map_and_root(atlas, repo, assets):
    html = build_html(atlas, repo, assets)
    data = embedded_data(html)
    assert data["map"] == atlas
    assert data["root"] == str(repo.resolve())


def test_viewer_escapes_markup_inside_the_map(atlas, repo, assets):
    atlas["nodes"][0]["explanation"] = "</script><img src=x onerror=alert(1)>"
    atlas["title"] = "<b>T</b>"
    html = build_html(atlas, repo, assets)
    assert "<img src=x" not in html
    assert "<b>T</b>" not in html
    assert embedded_data(html)["map"]["nodes"][0]["explanation"].startswith("</script>")


def test_viewer_script_cannot_close_its_own_tag(atlas, repo, assets):
    html = build_html(atlas, repo, assets)
    assert html.count("</script>") == 2


def test_viewer_policy_allows_only_the_inlined_script_and_style(atlas, repo, assets):
    html = build_html(atlas, repo, assets)
    script = re.search(r"<script>(.*?)</script>", html, re.S).group(1)
    digest = base64.b64encode(hashlib.sha256(script.encode("utf-8")).digest()).decode()
    assert f"script-src 'sha256-{digest}'" in html
    assert "default-src 'none'" in html
    assert "unsafe-inline" not in html


def test_viewer_reports_missing_assets(atlas, repo, tmp_path):
    with pytest.raises(MapError, match="viewer.js"):
        build_html(atlas, repo, tmp_path / "nowhere")


# --- map files --------------------------------------------------------------


def test_find_map_walks_up_from_a_nested_file(mapped_repo):
    assert find_map(mapped_repo / "src" / "engine.py") == mapped_repo / ".codeatlas" / "map.json"


def test_find_map_returns_none_without_a_map(tmp_path):
    assert find_map(tmp_path) is None


def test_load_map_explains_bad_json(tmp_path):
    path = tmp_path / "map.json"
    path.write_text("{nope", encoding="utf-8")
    with pytest.raises(MapError, match="not valid JSON"):
        load_map(path)
    path.write_text("[]", encoding="utf-8")
    with pytest.raises(MapError, match="JSON object"):
        load_map(path)
    with pytest.raises(MapError, match="cannot read"):
        load_map(tmp_path / "absent.json")


# --- hook -------------------------------------------------------------------


def test_hook_is_silent_when_the_edit_changes_nothing_mapped(mapped_repo):
    assert run_hook(edit_payload(mapped_repo)) is None


def test_hook_is_silent_without_a_map(repo):
    assert run_hook(edit_payload(repo)) is None


def test_hook_is_silent_for_payloads_without_a_file(mapped_repo):
    assert run_hook({"cwd": str(mapped_repo), "tool_input": {}}) is None
    assert run_hook({}) is None


def test_hook_marks_stale_nodes_and_tells_claude(mapped_repo):
    path = mapped_repo / "src" / "engine.py"
    path.write_text(PY_SOURCE.replace("x + 1", "x + 2"), encoding="utf-8")
    map_path = mapped_repo / ".codeatlas" / "map.json"
    saved = load_map(map_path)
    saved["nodes"].append(
        {"id": "helper", "parent": None, "kind": "function", "title": "Helper",
         "anchors": [{"file": "src/engine.py", "startLine": 6, "endLine": 7, "hash": "0" * 16,
                      "symbol": "helper"}]}
    )
    save_map(map_path, saved)

    output = run_hook(edit_payload(mapped_repo))

    context = output["hookSpecificOutput"]["additionalContext"]
    assert output["hookSpecificOutput"]["hookEventName"] == "PostToolUse"
    assert "helper" in context
    helper = next(n for n in load_map(map_path)["nodes"] if n["id"] == "helper")
    assert helper["stale"] is True


def test_hook_follows_moved_code_without_comment(mapped_repo):
    path = mapped_repo / "src" / "engine.py"
    path.write_text("# header\n" + PY_SOURCE, encoding="utf-8")
    map_path = mapped_repo / ".codeatlas" / "map.json"

    assert run_hook(edit_payload(mapped_repo)) is None

    step = next(n for n in load_map(map_path)["nodes"] if n["id"] == "engine.step")
    assert step["anchors"][0]["startLine"] == 21


def test_hook_ignores_files_outside_the_mapped_repo(mapped_repo, tmp_path_factory):
    elsewhere = tmp_path_factory.mktemp("elsewhere") / "x.py"
    elsewhere.write_text("x = 1\n", encoding="utf-8")
    payload = {"cwd": str(mapped_repo), "tool_input": {"file_path": str(elsewhere)}}
    assert run_hook(payload) is None


# --- command line -----------------------------------------------------------


def run_cli(*args: str) -> int:
    return codeatlas.main(list(args))


def test_cli_build_stamps_validates_and_writes_the_viewer(repo, atlas, capsys):
    map_path = repo / ".codeatlas" / "map.json"
    save_map(map_path, atlas)

    assert run_cli("build", "--map", str(map_path)) == 0

    assert "hash" in load_map(map_path)["nodes"][0]["anchors"][0]
    html = (repo / ".codeatlas" / "atlas.html").read_text(encoding="utf-8")
    assert "atlas-data" in html
    assert "atlas.html" in (repo / ".codeatlas" / ".gitignore").read_text(encoding="utf-8")
    assert "atlas.html" in capsys.readouterr().out


def test_cli_build_flags_nodes_whose_code_changed(mapped_repo, capsys):
    map_path = mapped_repo / ".codeatlas" / "map.json"
    (mapped_repo / "src" / "engine.py").write_text(
        "# header\n" + PY_SOURCE.replace("notional * FEE_RATE", "notional * FEE_RATE * 2"), encoding="utf-8"
    )

    assert run_cli("build", "--map", str(map_path)) == 0

    out = capsys.readouterr().out
    assert "Stale nodes still to rewrite: engine, engine.fee" in out
    nodes = {n["id"]: n for n in load_map(map_path)["nodes"]}
    assert nodes["engine.fee"]["stale"] is True
    assert nodes["engine.step"]["anchors"][0]["startLine"] == 21
    assert "stale" not in nodes["engine.step"]


def test_cli_build_refuses_an_invalid_map(repo, atlas, capsys):
    atlas["nodes"][1]["anchors"][0]["symbol"] = "Engine.nope"
    map_path = repo / ".codeatlas" / "map.json"
    save_map(map_path, atlas)

    assert run_cli("build", "--map", str(map_path)) == 1
    assert "Engine.nope" in capsys.readouterr().out
    assert not (repo / ".codeatlas" / "atlas.html").exists()


def test_cli_validate_reports_errors_with_exit_code(repo, atlas, capsys):
    atlas["nodes"][0]["kind"] = "widget"
    map_path = repo / ".codeatlas" / "map.json"
    save_map(map_path, atlas)
    assert run_cli("validate", "--map", str(map_path)) == 1
    assert "nodes[0].kind" in capsys.readouterr().out


def test_cli_refresh_then_status_lists_stale_nodes(mapped_repo, capsys):
    map_path = mapped_repo / ".codeatlas" / "map.json"
    (mapped_repo / "src" / "engine.py").write_text(
        PY_SOURCE.replace("notional * FEE_RATE", "notional * FEE_RATE * 2"), encoding="utf-8"
    )

    assert run_cli("refresh", "--map", str(map_path)) == 1
    assert "engine.fee" in capsys.readouterr().out
    assert run_cli("status", "--map", str(map_path)) == 1
    assert "engine.fee" in capsys.readouterr().out

    assert run_cli("stamp", "--map", str(map_path), "--node", "engine.fee", "--node", "engine") == 0
    capsys.readouterr()
    assert run_cli("status", "--map", str(map_path)) == 0


def test_cli_symbols_lists_definitions(repo, capsys):
    assert run_cli("symbols", str(repo / "src" / "engine.py")) == 0
    out = capsys.readouterr().out
    assert "Engine.step" in out and "20-22" in out


def test_cli_reports_a_missing_map(tmp_path, capsys):
    assert run_cli("validate", "--map", str(tmp_path / "none.json")) == 2
    assert "cannot read" in capsys.readouterr().err


def test_cli_hook_reads_the_payload_from_stdin(mapped_repo, monkeypatch, capsys):
    import io

    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(edit_payload(mapped_repo))))
    assert run_cli("hook") == 0
    assert capsys.readouterr().out == ""
