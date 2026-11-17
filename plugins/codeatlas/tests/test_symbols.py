from __future__ import annotations

from atlas.symbols import Span, find_symbol, list_symbols

from conftest import PY_SOURCE

JS_SOURCE = """\
import x from 'x';

export function parse(input) {
  if (!input) {
    return null;
  }
  return input.trim();
}

export const double = (n) => {
  return n * 2;
};

class Router {
  constructor() {
    this.routes = [];
  }

  async handle(request) {
    return this.routes.find((r) => r.match(request));
  }
}

const LIMIT = 10;
"""

GO_SOURCE = """\
package book

type Book struct {
	bids []Order
}

func (b *Book) Add(o Order) {
	b.bids = append(b.bids, o)
}

func New() *Book {
	return &Book{}
}
"""


def test_python_function():
    assert find_symbol("a.py", PY_SOURCE, "helper") == Span(6, 7)


def test_python_class_spans_whole_body():
    assert find_symbol("a.py", PY_SOURCE, "Engine") == Span(10, 22)


def test_python_method_by_qualified_name():
    assert find_symbol("a.py", PY_SOURCE, "Engine.step") == Span(20, 22)


def test_python_decorator_is_part_of_the_span():
    assert find_symbol("a.py", PY_SOURCE, "Engine.fee") == Span(16, 18)


def test_python_module_constant():
    assert find_symbol("a.py", PY_SOURCE, "FEE_RATE") == Span(3, 3)


def test_python_unique_suffix_resolves():
    assert find_symbol("a.py", PY_SOURCE, "step") == Span(20, 22)


def test_python_ambiguous_suffix_is_not_guessed():
    source = "class A:\n    def run(self):\n        pass\n\nclass B:\n    def run(self):\n        pass\n"
    assert find_symbol("a.py", source, "run") is None
    assert find_symbol("a.py", source, "B.run") == Span(6, 7)


def test_python_missing_symbol():
    assert find_symbol("a.py", PY_SOURCE, "Engine.nope") is None


def test_python_with_syntax_error_falls_back_to_text_search():
    source = "def broken(:\n    return 1\n\ndef fine():\n    return 2\n"
    assert find_symbol("a.py", source, "fine") == Span(4, 5)


def test_javascript_function_uses_brace_matching():
    assert find_symbol("a.js", JS_SOURCE, "parse") == Span(3, 8)


def test_javascript_arrow_constant():
    assert find_symbol("a.js", JS_SOURCE, "double") == Span(10, 12)


def test_javascript_single_line_constant():
    assert find_symbol("a.js", JS_SOURCE, "LIMIT") == Span(24, 24)


def test_javascript_class_and_method():
    assert find_symbol("a.ts", JS_SOURCE, "Router") == Span(14, 22)
    assert find_symbol("a.ts", JS_SOURCE, "Router.handle") == Span(19, 21)


def test_go_method_with_receiver():
    assert find_symbol("a.go", GO_SOURCE, "Add") == Span(7, 9)
    assert find_symbol("a.go", GO_SOURCE, "Book") == Span(3, 5)


def test_list_symbols_reports_qualified_python_names():
    names = [name for name, _ in list_symbols("a.py", PY_SOURCE)]
    assert names == [
        "FEE_RATE",
        "helper",
        "Engine",
        "Engine.__init__",
        "Engine.fee",
        "Engine.step",
    ]


def test_list_symbols_for_other_languages():
    names = [name for name, _ in list_symbols("a.go", GO_SOURCE)]
    assert names == ["Book", "Add", "New"]
