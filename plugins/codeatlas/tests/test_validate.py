from __future__ import annotations

import copy

from atlas.anchors import stamp
from atlas.validate import validate_map


def errors(issues):
    return [i.message for i in issues if i.level == "error"]


def warnings(issues):
    return [i.message for i in issues if i.level == "warning"]


def test_minimal_map_has_no_errors(atlas):
    assert errors(validate_map(atlas)) == []


def test_rejects_non_object_map():
    assert errors(validate_map([])) != []


def test_rejects_missing_title(atlas):
    del atlas["title"]
    assert any("title" in m for m in errors(validate_map(atlas)))


def test_rejects_unsupported_version(atlas):
    atlas["version"] = 2
    assert any("version" in m for m in errors(validate_map(atlas)))


def test_rejects_empty_nodes(atlas):
    atlas["nodes"] = []
    assert any("nodes" in m for m in errors(validate_map(atlas)))


def test_rejects_duplicate_ids(atlas):
    atlas["nodes"].append(copy.deepcopy(atlas["nodes"][1]))
    assert any("duplicate" in m for m in errors(validate_map(atlas)))


def test_rejects_malformed_id(atlas):
    atlas["nodes"][2]["id"] = "Engine Fee"
    assert any("id" in m for m in errors(validate_map(atlas)))


def test_rejects_unknown_parent(atlas):
    atlas["nodes"][1]["parent"] = "nope"
    assert any("parent" in m for m in errors(validate_map(atlas)))


def test_rejects_parent_cycle(atlas):
    atlas["nodes"][0]["parent"] = "engine.step"
    assert any("cycle" in m for m in errors(validate_map(atlas)))


def test_rejects_unknown_kind(atlas):
    atlas["nodes"][0]["kind"] = "widget"
    assert any("kind" in m for m in errors(validate_map(atlas)))


def test_rejects_anchor_without_symbol_or_lines(atlas):
    atlas["nodes"][0]["anchors"] = [{"file": "src/engine.py"}]
    assert any("symbol" in m for m in errors(validate_map(atlas)))


def test_rejects_anchor_escaping_the_repo(atlas):
    atlas["nodes"][0]["anchors"] = [{"file": "../x.py", "symbol": "A"}]
    assert any("relative" in m for m in errors(validate_map(atlas)))
    atlas["nodes"][0]["anchors"] = [{"file": "/etc/passwd", "symbol": "A"}]
    assert any("relative" in m for m in errors(validate_map(atlas)))


def test_rejects_inverted_line_range(atlas):
    atlas["nodes"][0]["anchors"] = [
        {"file": "src/engine.py", "startLine": 9, "endLine": 3}
    ]
    assert any("startLine" in m for m in errors(validate_map(atlas)))


def test_rejects_half_a_line_range(atlas):
    atlas["nodes"][0]["anchors"] = [{"file": "src/engine.py", "startLine": 9}]
    assert any("endLine" in m for m in errors(validate_map(atlas)))


def test_rejects_edge_to_unknown_node(atlas):
    atlas["edges"].append({"from": "engine.step", "to": "ghost"})
    assert any("ghost" in m for m in errors(validate_map(atlas)))


def test_rejects_self_loop(atlas):
    atlas["edges"].append({"from": "engine.step", "to": "engine.step"})
    assert any("itself" in m for m in errors(validate_map(atlas)))


def test_warns_on_unknown_key(atlas):
    atlas["nodes"][0]["start_line"] = 3
    issues = validate_map(atlas)
    assert errors(issues) == []
    assert any("start_line" in m for m in warnings(issues))


def test_warns_on_crowded_view(atlas):
    for index in range(14):
        atlas["nodes"].append(
            {
                "id": f"engine.extra{index}",
                "parent": "engine",
                "kind": "step",
                "title": f"Extra {index}",
                "planned": True,
            }
        )
    assert any("children" in m for m in warnings(validate_map(atlas)))


def test_warns_on_unanchored_leaf_unless_planned(atlas):
    atlas["nodes"][2]["anchors"] = []
    assert any("anchor" in m for m in warnings(validate_map(atlas)))
    atlas["nodes"][2]["planned"] = True
    assert not any("no anchor" in m for m in warnings(validate_map(atlas)))


def test_strict_requires_stamped_anchors(atlas, repo):
    assert any("hash" in m for m in errors(validate_map(atlas, root=repo, strict=True)))
    stamped = stamp(atlas, repo).atlas
    assert errors(validate_map(stamped, root=repo, strict=True)) == []


def test_strict_reports_missing_file_and_out_of_range_lines(atlas, repo):
    stamped = stamp(atlas, repo).atlas
    stamped["nodes"][1]["anchors"][0]["file"] = "src/gone.py"
    stamped["nodes"][2]["anchors"][0]["endLine"] = 9999
    found = errors(validate_map(stamped, root=repo, strict=True))
    assert any("does not exist" in m for m in found)
    assert any("past the end" in m for m in found)


def test_issue_path_points_at_the_offending_node(atlas):
    atlas["nodes"][1]["kind"] = "widget"
    issue = next(i for i in validate_map(atlas) if i.level == "error")
    assert issue.path == "nodes[1].kind"


def _with_notes(atlas: dict, count: int) -> dict:
    notes = [{"id": f"note.{i}", "parent": None, "kind": "note", "title": f"Note {i}"} for i in range(count)]
    return {**atlas, "nodes": [*atlas["nodes"], *notes]}


def test_a_users_note_needs_no_explanation_or_anchor(atlas):
    before = [str(issue) for issue in validate_map(atlas, strict=True)]

    after = [str(issue) for issue in validate_map(_with_notes(atlas, 1), strict=True)]

    assert after == before


def test_users_notes_do_not_count_against_the_size_of_a_view(atlas):
    before = [issue.message for issue in validate_map(atlas)]

    after = [issue.message for issue in validate_map(_with_notes(atlas, 40))]

    assert [message for message in after if "children" in message] == [m for m in before if "children" in m]


def test_a_user_edge_is_accepted_and_its_flag_must_be_a_boolean(atlas):
    first, second = atlas["nodes"][0]["id"], atlas["nodes"][1]["id"]
    good = {**atlas, "edges": [*atlas.get("edges", []), {"from": first, "to": second, "user": True}]}
    bad = {**atlas, "edges": [*atlas.get("edges", []), {"from": first, "to": second, "user": "yes"}]}

    assert [issue for issue in validate_map(good) if ".user" in issue.path] == []
    assert any(issue.path.endswith(".user") and issue.level == "error" for issue in validate_map(bad))
