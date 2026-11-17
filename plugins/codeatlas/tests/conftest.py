"""Shared fixtures: put the skill's scripts on the import path and build sample repos."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = PLUGIN_ROOT / "skills" / "codeatlas" / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

PY_SOURCE = '''\
"""Order engine."""

FEE_RATE = 0.001


def helper(x):
    return x + 1


class Engine:
    """Matches orders."""

    def __init__(self):
        self.book = []

    @staticmethod
    def fee(notional):
        return notional * FEE_RATE

    def step(self, order):
        self.book.append(order)
        return helper(len(self.book))
'''


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A tiny repository with one Python module."""
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "engine.py").write_text(PY_SOURCE, encoding="utf-8")
    return tmp_path


@pytest.fixture
def atlas() -> dict:
    """A minimal valid map over the sample repository, not yet stamped."""
    return {
        "version": 1,
        "title": "Sample",
        "nodes": [
            {
                "id": "engine",
                "parent": None,
                "kind": "service",
                "title": "Engine",
                "summary": "Matches orders.",
                "explanation": "Owns the book.",
                "anchors": [{"file": "src/engine.py", "symbol": "Engine"}],
            },
            {
                "id": "engine.step",
                "parent": "engine",
                "kind": "function",
                "title": "Step",
                "summary": "Adds one order.",
                "explanation": "Appends then counts.",
                "anchors": [{"file": "src/engine.py", "symbol": "Engine.step"}],
            },
            {
                "id": "engine.fee",
                "parent": "engine",
                "kind": "function",
                "title": "Fee",
                "summary": "Fee for a notional.",
                "explanation": "Flat rate.",
                "anchors": [{"file": "src/engine.py", "symbol": "Engine.fee"}],
            },
        ],
        "edges": [{"from": "engine.step", "to": "engine.fee", "label": "notional"}],
    }
