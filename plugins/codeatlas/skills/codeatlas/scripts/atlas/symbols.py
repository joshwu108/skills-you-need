"""Find where a named symbol is defined in a source file.

Python files are parsed, so spans and qualified names are exact. Every other
language uses a text search for definition keywords followed by brace or
indentation matching. That search is a heuristic: it can miss unusual
syntax, in which case callers fall back to explicit line ranges.

Lines are 1-based and spans are inclusive.
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from typing import Optional

# How many lines after a definition may pass before its opening brace.
BRACE_SEARCH_LINES = 5

_MODIFIERS = (
    r"(?:(?:export|default|declare|public|private|protected|internal|static|abstract|"
    r"final|override|async|unsafe|extern|inline|pub(?:\([^)]*\))?)\s+)*"
)
_DEFINITION = re.compile(
    r"^\s*" + _MODIFIERS
    + r"(?:function\*?|class|interface|type|enum|struct|trait|impl|fn|func(?:\s*\([^)]*\))?|"
    r"def|module|namespace|object|const|let|var|val)\s+(?P<name>[A-Za-z_$][\w$]*)"
)
_METHOD = re.compile(
    r"^\s*(?:(?:public|private|protected|static|async|override|readonly|get|set)\s+)*"
    r"(?P<name>[A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\("
)
_NOT_METHODS = {
    "if", "for", "while", "switch", "catch", "return", "function", "else",
    "do", "try", "new", "throw", "await", "typeof", "super",
}


@dataclass(frozen=True)
class Span:
    start: int
    end: int


def find_symbol(path: str, text: str, symbol: str) -> Optional[Span]:
    """Return the span of `symbol`, or None when it is absent or ambiguous.

    `symbol` may be qualified with dots (`Class.method`). An unqualified
    name matches a nested definition only when exactly one has that name.
    """
    symbols = list_symbols(path, text)
    exact = [span for name, span in symbols if name == symbol]
    if exact:
        return exact[0]
    suffix = [span for name, span in symbols if name.endswith("." + symbol)]
    if len(suffix) == 1:
        return suffix[0]
    if "." in symbol and not _is_python(path, text):
        return _find_nested(text.splitlines(), symbol.split("."))
    return None


def list_symbols(path: str, text: str) -> list:
    """Return `(qualified name, Span)` for each definition, in file order."""
    if path.endswith((".py", ".pyi")):
        parsed = _python_symbols(text)
        if parsed is not None:
            return parsed
    lines = text.splitlines()
    return [
        (match.group("name"), Span(index + 1, _block_end(lines, index) + 1))
        for index, match in _definitions(lines, 0, len(lines))
    ]


def _is_python(path: str, text: str) -> bool:
    return path.endswith((".py", ".pyi")) and _python_symbols(text) is not None


def _python_symbols(text: str) -> Optional[list]:
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError):
        return None
    return _python_walk(tree.body, prefix="", top_level=True)


def _python_walk(body: list, prefix: str, top_level: bool) -> list:
    found = []
    for statement in body:
        if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            name = prefix + statement.name
            first = min([statement.lineno, *(d.lineno for d in statement.decorator_list)])
            found.append((name, Span(first, statement.end_lineno or statement.lineno)))
            found.extend(_python_walk(statement.body, prefix=name + ".", top_level=False))
        elif top_level and isinstance(statement, (ast.Assign, ast.AnnAssign)):
            targets = statement.targets if isinstance(statement, ast.Assign) else [statement.target]
            for target in targets:
                if isinstance(target, ast.Name):
                    span = Span(statement.lineno, statement.end_lineno or statement.lineno)
                    found.append((target.id, span))
    return found


def _definitions(lines: list, start: int, stop: int) -> list:
    return [
        (index, match)
        for index in range(start, stop)
        for match in [_DEFINITION.match(lines[index])]
        if match
    ]


def _find_nested(lines: list, parts: list) -> Optional[Span]:
    """Resolve `Outer.inner` by searching for each part inside the previous one."""
    start, stop = 0, len(lines)
    span = None
    for depth, part in enumerate(parts):
        index = _first_definition(lines, part, start, stop, allow_methods=depth > 0)
        if index is None:
            return None
        end = _block_end(lines, index)
        span = Span(index + 1, end + 1)
        start, stop = index + 1, end + 1
    return span


def _first_definition(lines: list, name: str, start: int, stop: int, allow_methods: bool) -> Optional[int]:
    for index in range(start, stop):
        match = _DEFINITION.match(lines[index])
        if match is None and allow_methods and name not in _NOT_METHODS:
            match = _METHOD.match(lines[index])
        if match and match.group("name") == name:
            return index
    return None


def _block_end(lines: list, start: int) -> int:
    """Return the 0-based index of the last line of the block opening at `start`."""
    if lines[start].rstrip().endswith(":"):
        return _indented_end(lines, start)

    depth = 0
    opened = False
    for index in range(start, len(lines)):
        for char in lines[index]:
            if char == "{":
                depth += 1
                opened = True
            elif char == "}":
                depth -= 1
        if opened and depth <= 0:
            return index
        if not opened:
            if lines[index].rstrip().endswith(";"):
                return index
            if index - start >= BRACE_SEARCH_LINES:
                break
    return _indented_end(lines, start)


def _indented_end(lines: list, start: int) -> int:
    base = _indent(lines[start])
    end = start
    for index in range(start + 1, len(lines)):
        if lines[index].strip() == "":
            continue
        if _indent(lines[index]) <= base:
            break
        end = index
    return end


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip())
