# CodeAtlas for VS Code

See the visual explanation for the code under your cursor, and jump from a flow diagram to the lines behind each box.

CodeAtlas reads `.codeatlas/map.json`, a map of your codebase written by Claude using the [CodeAtlas skill for Claude Code](https://github.com/joshwu108/skills-you-need). This extension does not create the map and makes no network requests.

## What you get

- **From code to its explanation.** Explained code gets a link above it and a mark in the gutter. Click the link, or run **CodeAtlas: Explain This Code**, to open the map on that code.
- **A flow diagram beside your code.** The top level shows the system's main parts. Click a part to open the flow inside it.
- **From a box to its lines.** Click `</>` on a box, or a code link in the panel, to open the exact range in the editor.
- **The map follows your cursor.** While the map is open, moving through a file shows the explanation for wherever you are.
- **Honest about drift.** Each explanation records a hash of the code it describes. Code that has only moved is tracked, including unsaved edits. Code that has changed is marked *out of date* until Claude rewrites its explanation.

## Getting a map

Install the skill in Claude Code, then ask for a map:

```
/plugin marketplace add joshwu108/skills-you-need
/plugin install codeatlas@skills-you-need
/codeatlas:codeatlas map
```

The extension activates in any folder that contains `.codeatlas/map.json` and reloads when the file changes.

## Commands

| Command | What it does |
|---|---|
| **CodeAtlas: Open Map** | Opens the flow diagram beside the editor. Also on the status bar. |
| **CodeAtlas: Explain This Code** | Opens the map on the most specific explanation covering the cursor. Also in the editor context menu. |

## Settings

| Setting | Default | |
|---|---|---|
| `codeatlas.codeLens.enabled` | `true` | Show a link above explained code. |
| `codeatlas.gutter.enabled` | `true` | Mark explained code in the gutter. |
| `codeatlas.followCursor` | `true` | While the map is open, follow the cursor. |

## Security

Explanations are written by a model from repository content, so the extension treats the map as untrusted input. Text is rendered without ever being interpreted as HTML, the panel's content security policy allows only the extension's own script and stylesheet, and anchors that point outside the workspace folder are ignored.
