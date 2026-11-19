from __future__ import annotations

import json
from pathlib import Path

import codeatlas
from atlas.layout import clean_layout, load_layout
from atlas.model import save_map
from atlas.anchors import stamp
from atlas.viewer import build_html


def embedded(html: str) -> dict:
    block = html.split('<script id="atlas-data" type="application/json">', 1)[1].split("</script>", 1)[0]
    return json.loads(block)


def test_clean_layout_keeps_well_formed_positions():
    layout = {"version": 1, "views": {":root": {"api": {"x": 40, "y": 80.4}}, "api": {"api.route": {"x": 0, "y": 8}}}}

    assert clean_layout(layout) == {
        "version": 1,
        "views": {":root": {"api": {"x": 40, "y": 80}}, "api": {"api.route": {"x": 0, "y": 8}}},
    }


def test_clean_layout_drops_what_is_not_a_position():
    layout = {
        "version": 1,
        "views": {
            ":root": {"a": {"x": "1", "y": 2}, "b": {"x": True, "y": 2}, "c": {"x": float("inf"), "y": 0}, "d": [1, 2]},
            "bad": "not a view",
            "ok": {"n": {"x": -50, "y": 10**9}},
        },
    }

    assert clean_layout(layout) == {"version": 1, "views": {"ok": {"n": {"x": 0, "y": 20000}}}}


def test_clean_layout_rejects_other_shapes_and_versions():
    assert clean_layout([]) is None
    assert clean_layout({"version": 2, "views": {":root": {"a": {"x": 1, "y": 1}}}}) is None
    assert clean_layout({"version": 1, "views": []}) is None
    assert clean_layout({"version": 1, "views": {}}) is None


def test_load_layout_treats_missing_and_broken_files_as_no_layout(tmp_path: Path):
    broken = tmp_path / "layout.json"
    broken.write_text("{not json", encoding="utf-8")

    assert load_layout(tmp_path / "absent.json") is None
    assert load_layout(broken) is None


def test_build_html_embeds_a_layout_only_when_given(repo: Path, atlas: dict, tmp_path: Path):
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "viewer.js").write_text("", encoding="utf-8")
    (assets / "viewer.css").write_text("", encoding="utf-8")
    layout = {"version": 1, "views": {":root": {"engine": {"x": 8, "y": 16}}}}

    assert "layout" not in embedded(build_html(atlas, repo, assets))
    assert embedded(build_html(atlas, repo, assets, layout=layout))["layout"] == layout


def test_cli_build_carries_the_layout_file_into_the_page(repo: Path, atlas: dict, capsys):
    map_dir = repo / ".codeatlas"
    save_map(map_dir / "map.json", stamp(atlas, repo).atlas)
    (map_dir / "layout.json").write_text(
        json.dumps({"version": 1, "views": {":root": {"engine": {"x": 48, "y": 96}}}}), encoding="utf-8"
    )

    assert codeatlas.main(["build", "--map", str(map_dir / "map.json")]) == 0

    page = (map_dir / "atlas.html").read_text(encoding="utf-8")
    assert embedded(page)["layout"]["views"][":root"]["engine"] == {"x": 48, "y": 96}


def test_cli_build_ignores_a_broken_layout_file(repo: Path, atlas: dict, capsys):
    map_dir = repo / ".codeatlas"
    save_map(map_dir / "map.json", stamp(atlas, repo).atlas)
    (map_dir / "layout.json").write_text("][", encoding="utf-8")

    assert codeatlas.main(["build", "--map", str(map_dir / "map.json")]) == 0
    assert "layout" not in embedded((map_dir / "atlas.html").read_text(encoding="utf-8"))


def test_clean_layout_survives_numbers_too_large_to_be_floats():
    huge = int("9" * 400)

    assert clean_layout({"version": 1, "views": {"v": {"n": {"x": huge, "y": -huge}}}}) == {
        "version": 1,
        "views": {"v": {"n": {"x": 20000, "y": 0}}},
    }


def test_clean_layout_caps_how_much_it_keeps():
    views = {f"v{i}": {f"n{j}": {"x": 0, "y": 0} for j in range(600)} for i in range(3)}

    cleaned = clean_layout({"version": 1, "views": views})

    assert all(len(positions) == 500 for positions in cleaned["views"].values())


def test_load_layout_reads_only_a_regular_file_of_sane_size(tmp_path: Path):
    real = tmp_path / "real.json"
    real.write_text(json.dumps({"version": 1, "views": {"v": {"n": {"x": 8, "y": 8}}}}), encoding="utf-8")
    link = tmp_path / "layout.json"
    link.symlink_to(real)
    big = tmp_path / "big.json"
    big.write_text(" " * 1_000_001, encoding="utf-8")
    deep = tmp_path / "deep.json"
    deep.write_text("[" * 100_000, encoding="utf-8")

    assert load_layout(real) is not None
    assert load_layout(link) is None
    assert load_layout(big) is None
    assert load_layout(deep) is None
    assert load_layout(tmp_path) is None
