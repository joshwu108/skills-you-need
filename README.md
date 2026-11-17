# skills-you-need

A Claude Code plugin marketplace. The first plugin is **CodeAtlas**.

## CodeAtlas

CodeAtlas gives a codebase a visual walkthrough that stays attached to the code.

- **A flow diagram you can drill into.** The top level shows the system's main parts. Click a part to open the flow inside it.
- **Every box is explained.** What it does, how, what goes in and out, and what the code does not make obvious.
- **Every box links to its lines.** Click through to the exact range in VS Code, Cursor or another fork.
- **It notices when it goes out of date.** Each explanation records a hash of the code it describes. When Claude edits that code, the node is marked stale and Claude is told to rewrite it.

Claude writes the map into `.codeatlas/map.json`. A standalone page and a VS Code extension both read that file.

### Install the skill

In Claude Code:

```
/plugin marketplace add joshwu108/skills-you-need
/plugin install codeatlas@skills-you-need
```

It needs `python3` (3.9 or later) on your `PATH`. There is nothing else to install.

### Use it

Ask in plain language, or call the skill directly:

| You say | What happens |
|---|---|
| `/codeatlas:codeatlas map` | Maps the repository: top-level flow, then one level inside each part. |
| `/codeatlas:codeatlas explain src/engine.py:120` | Explains that code one level deeper than the map already goes. |
| `/codeatlas:codeatlas plan add rate limiting` | Draws the design first, then fills in each box as the code is written. |
| `/codeatlas:codeatlas refresh` | Rewrites the explanations whose code has changed. |

Claude opens `.codeatlas/atlas.html` when the map is built. Choose your editor in the page header; clicking a code link opens it there.

Commit `.codeatlas/map.json` if you want teammates to have the map. `atlas.html` contains absolute paths, so it is ignored by git and rebuilt on each machine.

### How it stays accurate

An anchor is a file, a line range and a hash of those lines.

- Code that **moves** (lines added above it) is found again by its hash, and the range is updated silently.
- Code that **changes** is found again by its symbol name, and the node is marked stale.
- A stale node keeps its old explanation, flagged in the viewer, until Claude rewrites it.

The plugin's hook runs this check on each file Claude edits. Run `refresh` after editing by hand.

### VS Code extension

The extension adds the other direction, from a line of code to its visual, and shows the same diagram inside the editor. See [`extension/`](extension/).

## Repository layout

```
.claude-plugin/marketplace.json     the marketplace listing
plugins/codeatlas/                  the plugin
  skills/codeatlas/SKILL.md           what Claude reads
  skills/codeatlas/scripts/           map tools (Python, standard library only)
  skills/codeatlas/assets/            the built viewer (generated, committed)
  hooks/hooks.json                    marks nodes stale after edits
  tests/
packages/viewer/                    the viewer source (TypeScript)
extension/                          the VS Code extension
.codeatlas/map.json                 CodeAtlas's map of itself
```

## Development

```bash
# Map tools
python3 -m venv .venv && .venv/bin/pip install pytest pytest-cov
cd plugins/codeatlas && ../../.venv/bin/python -m pytest --cov=skills/codeatlas/scripts

# Viewer
npm install
npm test
npm run build        # rewrites the committed bundles; commit the result

# See the result on this repository's own map
python3 plugins/codeatlas/skills/codeatlas/scripts/codeatlas.py build --open
```

The viewer bundles under `assets/` are committed so that a plugin install needs no build step. CI rebuilds them and fails if they differ from the sources.

### Design notes

- Explanations are written by a model from repository content, so the viewer treats them as untrusted: Markdown is rendered by building DOM nodes, never by assigning HTML, and the generated page's content security policy allows only its own inlined script and stylesheet.
- Symbol lookup is exact for Python (parsed with `ast`) and a text heuristic for other languages. When a symbol cannot be found the tools say so and the anchor falls back to explicit lines.
- The viewer bundles [dagre](https://github.com/dagrejs/dagre) (MIT) for graph layout.

## Licence

MIT. See [LICENSE](LICENSE).
