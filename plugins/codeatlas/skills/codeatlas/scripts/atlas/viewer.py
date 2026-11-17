"""Build the standalone viewer: one HTML file with the map inlined.

The page is opened from disk, so it cannot fetch anything. The map, script
and stylesheet are inlined, and a content security policy pins the page to
exactly that script and stylesheet by hash. Map text is model-written from
repository content, so it is embedded as inert JSON and never as markup.
"""

from __future__ import annotations

import base64
import hashlib
import html
import json
from pathlib import Path

from .model import MapError

DEFAULT_ASSETS = Path(__file__).resolve().parents[2] / "assets"

_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="{policy}">
<title>{title} · CodeAtlas</title>
<style>{style}</style>
</head>
<body>
<main id="atlas"></main>
<script id="atlas-data" type="application/json">{data}</script>
<script>{script}</script>
</body>
</html>
"""


def build_html(atlas: dict, root: Path, assets_dir: Path = DEFAULT_ASSETS) -> str:
    script = _read_asset(assets_dir / "viewer.js").replace("</script", "<\\/script")
    style = _read_asset(assets_dir / "viewer.css").replace("</style", "<\\/style")
    policy = (
        "default-src 'none'; "
        f"script-src '{_source_hash(script)}'; "
        f"style-src '{_source_hash(style)}'; "
        "img-src data:"
    )
    return _TEMPLATE.format(
        policy=policy,
        title=html.escape(str(atlas.get("title", "Code map"))),
        style=style,
        data=_inert_json({"map": atlas, "root": str(root.resolve())}),
        script=script,
    )


def _read_asset(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError as error:
        raise MapError(
            f"viewer asset {path} is missing; rebuild it with 'npm run build' in packages/viewer"
        ) from error


def _source_hash(source: str) -> str:
    digest = hashlib.sha256(source.encode("utf-8")).digest()
    return "sha256-" + base64.b64encode(digest).decode("ascii")


def _inert_json(value: dict) -> str:
    """Serialise so no character can end the surrounding script element."""
    return (
        json.dumps(value, ensure_ascii=False)
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
        .replace(" ", "\\u2028")
        .replace(" ", "\\u2029")
    )
