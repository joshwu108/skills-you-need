from __future__ import annotations

import copy

from atlas.anchors import hash_lines, refresh, stamp

from conftest import PY_SOURCE


def node(atlas, node_id):
    return next(n for n in atlas["nodes"] if n["id"] == node_id)


def statuses(result):
    return {(r.node_id, r.status) for r in result.reports}


def test_hash_ignores_trailing_whitespace():
    assert hash_lines(["a = 1", "b = 2"]) == hash_lines(["a = 1   ", "b = 2\t"])
    assert hash_lines(["a = 1"]) != hash_lines(["a = 2"])
    assert len(hash_lines(["a"])) == 16


def test_stamp_fills_lines_and_hash_from_symbol(atlas, repo):
    result = stamp(atlas, repo)
    anchor = node(result.atlas, "engine.step")["anchors"][0]
    assert result.errors == []
    assert (anchor["startLine"], anchor["endLine"]) == (20, 22)
    assert anchor["hash"] == hash_lines(PY_SOURCE.splitlines()[19:22])


def test_stamp_does_not_mutate_its_input(atlas, repo):
    before = copy.deepcopy(atlas)
    stamp(atlas, repo)
    assert atlas == before


def test_stamp_keeps_explicit_lines_when_there_is_no_symbol(atlas, repo):
    atlas["nodes"][2]["anchors"] = [
        {"file": "src/engine.py", "startLine": 3, "endLine": 3}
    ]
    anchor = node(stamp(atlas, repo).atlas, "engine.fee")["anchors"][0]
    assert (anchor["startLine"], anchor["endLine"]) == (3, 3)
    assert anchor["hash"] == hash_lines(["FEE_RATE = 0.001"])


def test_stamp_reports_unresolvable_symbol(atlas, repo):
    atlas["nodes"][1]["anchors"][0]["symbol"] = "Engine.missing"
    result = stamp(atlas, repo)
    assert any("Engine.missing" in e for e in result.errors)


def test_stamp_reports_missing_file(atlas, repo):
    atlas["nodes"][1]["anchors"][0]["file"] = "src/none.py"
    assert any("src/none.py" in e for e in stamp(atlas, repo).errors)


def test_stamp_skips_already_stamped_anchors_unless_forced(atlas, repo):
    stamped = stamp(atlas, repo).atlas
    node(stamped, "engine.step")["anchors"][0]["hash"] = "0" * 16
    node(stamped, "engine.step")["stale"] = True

    untouched = stamp(stamped, repo).atlas
    assert node(untouched, "engine.step")["anchors"][0]["hash"] == "0" * 16
    assert node(untouched, "engine.step")["stale"] is True

    forced = stamp(stamped, repo, node_ids=["engine.step"]).atlas
    assert node(forced, "engine.step")["anchors"][0]["hash"] != "0" * 16
    assert "stale" not in node(forced, "engine.step")
    assert "staleReason" not in node(forced, "engine.step")


def test_stamp_rejects_unknown_node_id(atlas, repo):
    assert any("nope" in e for e in stamp(atlas, repo, node_ids=["nope"]).errors)


def test_refresh_on_unchanged_code_reports_ok(atlas, repo):
    stamped = stamp(atlas, repo).atlas
    result = refresh(stamped, repo)
    assert {status for _, status in statuses(result)} == {"ok"}
    assert result.atlas == stamped


def test_refresh_follows_code_that_moved(atlas, repo):
    stamped = stamp(atlas, repo).atlas
    path = repo / "src" / "engine.py"
    path.write_text("# new header\n# second line\n" + PY_SOURCE, encoding="utf-8")

    result = refresh(stamped, repo)

    anchor = node(result.atlas, "engine.step")["anchors"][0]
    assert ("engine.step", "moved") in statuses(result)
    assert (anchor["startLine"], anchor["endLine"]) == (22, 24)
    assert "stale" not in node(result.atlas, "engine.step")


def test_refresh_marks_changed_code_stale_and_re_resolves_the_symbol(atlas, repo):
    stamped = stamp(atlas, repo).atlas
    path = repo / "src" / "engine.py"
    changed = PY_SOURCE.replace(
        "        self.book.append(order)\n",
        "        if order is None:\n            return 0\n        self.book.append(order)\n",
    )
    path.write_text(changed, encoding="utf-8")

    result = refresh(stamped, repo)

    step = node(result.atlas, "engine.step")
    assert ("engine.step", "changed") in statuses(result)
    assert step["stale"] is True
    assert "src/engine.py" in step["staleReason"]
    assert (step["anchors"][0]["startLine"], step["anchors"][0]["endLine"]) == (20, 24)
    # The untouched sibling is still current.
    assert ("engine.fee", "ok") in statuses(result)
    assert "stale" not in node(result.atlas, "engine.fee")


def test_refresh_does_not_report_the_same_change_twice(atlas, repo):
    stamped = stamp(atlas, repo).atlas
    path = repo / "src" / "engine.py"
    path.write_text(PY_SOURCE.replace("x + 1", "x + 2"), encoding="utf-8")
    atlas_with_helper = copy.deepcopy(stamped)
    atlas_with_helper["nodes"].append(
        {
            "id": "helper",
            "parent": None,
            "kind": "function",
            "title": "Helper",
            "anchors": [{"file": "src/engine.py", "symbol": "helper"}],
        }
    )
    path.write_text(PY_SOURCE, encoding="utf-8")
    atlas_with_helper = stamp(atlas_with_helper, repo).atlas
    path.write_text(PY_SOURCE.replace("x + 1", "x + 2"), encoding="utf-8")

    first = refresh(atlas_with_helper, repo)
    second = refresh(first.atlas, repo)

    assert ("helper", "changed") in statuses(first)
    assert ("helper", "ok") in statuses(second)
    # Staleness survives until the node is stamped again.
    assert node(second.atlas, "helper")["stale"] is True


def test_refresh_marks_missing_file_stale(atlas, repo):
    stamped = stamp(atlas, repo).atlas
    (repo / "src" / "engine.py").unlink()
    result = refresh(stamped, repo)
    assert ("engine", "missing") in statuses(result)
    assert node(result.atlas, "engine")["stale"] is True


def test_refresh_marks_removed_symbol_missing(atlas, repo):
    stamped = stamp(atlas, repo).atlas
    path = repo / "src" / "engine.py"
    without_step = PY_SOURCE.split("    def step")[0]
    path.write_text(without_step, encoding="utf-8")
    result = refresh(stamped, repo)
    assert ("engine.step", "missing") in statuses(result)


def test_refresh_can_be_limited_to_one_file(atlas, repo):
    (repo / "src" / "other.py").write_text("def other():\n    return 1\n", encoding="utf-8")
    atlas["nodes"].append(
        {
            "id": "other",
            "parent": None,
            "kind": "function",
            "title": "Other",
            "anchors": [{"file": "src/other.py", "symbol": "other"}],
        }
    )
    stamped = stamp(atlas, repo).atlas
    result = refresh(stamped, repo, only_file="src/other.py")
    assert {r.node_id for r in result.reports} == {"other"}


def test_refresh_does_not_mutate_its_input(atlas, repo):
    stamped = stamp(atlas, repo).atlas
    before = copy.deepcopy(stamped)
    (repo / "src" / "engine.py").write_text("# moved\n" + PY_SOURCE, encoding="utf-8")
    refresh(stamped, repo)
    assert stamped == before


def test_refresh_stamps_anchors_that_were_never_hashed(atlas, repo):
    result = refresh(atlas, repo)
    assert ("engine.step", "ok") in statuses(result)
    assert "hash" in node(result.atlas, "engine.step")["anchors"][0]


def test_refresh_skips_the_moved_block_search_on_very_large_files(repo):
    from atlas import anchors

    body = [f"x{i} = {i}" for i in range(5000)]
    path = repo / "big.py"
    path.write_text("\n".join(body) + "\n", encoding="utf-8")
    big = {
        "version": 1,
        "title": "Big",
        "nodes": [{"id": "big", "parent": None, "kind": "module", "title": "Big",
                   "anchors": [{"file": "big.py", "startLine": 1, "endLine": 2500}]}],
    }
    stamped = stamp(big, repo).atlas
    assert (5000 - 2500 + 1) * 2500 > anchors.MAX_SEARCH_WORK
    path.write_text("# shifted\n" + "\n".join(body) + "\n", encoding="utf-8")

    result = refresh(stamped, repo)

    # The block only moved by one line, but finding that would cost too much.
    assert ("big", "changed") in statuses(result)


def test_lines_are_split_like_an_editor_and_a_bom_is_dropped(repo):
    from atlas.model import read_source, split_lines

    # A form feed and a Unicode separator are not line breaks in an editor.
    assert split_lines("a\x0cb\nc d\r\ne\rf\n") == ["a\x0cb", "c d", "e", "f"]
    assert split_lines("") == []
    path = repo / "bom.py"
    path.write_bytes(b"\xef\xbb\xbfx = 1\n")
    assert read_source(path) == "x = 1\n"


def test_anchor_after_a_form_feed_keeps_the_parsers_line_numbers(repo):
    (repo / "ff.py").write_text("a = 1\n\x0c\ndef f():\n    return 1\n", encoding="utf-8")
    atlas = {"version": 1, "title": "T", "nodes": [
        {"id": "f", "parent": None, "kind": "function", "title": "f", "anchors": [{"file": "ff.py", "symbol": "f"}]}]}
    anchor = stamp(atlas, repo).atlas["nodes"][0]["anchors"][0]
    assert (anchor["startLine"], anchor["endLine"]) == (3, 4)
    assert anchor["hash"] == hash_lines(["def f():", "    return 1"])


def test_hash_strips_only_spaces_and_tabs():
    assert hash_lines(["a \t"]) == hash_lines(["a"])
    assert hash_lines(["a\x0c"]) != hash_lines(["a"])


def test_wrongly_typed_fields_are_left_alone_not_rewritten(repo):
    for broken in (
        {"version": 1, "title": "T", "nodes": None},
        {"version": 1, "title": "T", "nodes": {"a": 1}},
        {"version": 1, "title": "T", "nodes": [{"id": "a", "anchors": "ab"}, "text", 7]},
    ):
        before = copy.deepcopy(broken)
        assert stamp(broken, repo).atlas == before
        assert refresh(broken, repo).atlas == before
        assert broken == before


def test_wrongly_typed_anchors_are_reported_not_crashed_on(repo):
    anchors = [
        {"file": ["x"], "symbol": "f"},
        {"file": "src/engine.py", "startLine": "1", "endLine": 2},
        {"file": "src/engine.py", "symbol": 5, "startLine": True, "endLine": 3},
        None,
    ]
    broken = {"version": 1, "title": "T", "nodes": [{"id": "a", "anchors": copy.deepcopy(anchors)}]}

    stamped = stamp(broken, repo)
    refreshed = refresh(broken, repo)

    assert len(stamped.errors) == 3
    assert stamped.atlas["nodes"][0]["anchors"] == anchors
    assert refreshed.atlas["nodes"][0]["anchors"] == anchors
    assert refreshed.atlas["nodes"][0]["stale"] is True
