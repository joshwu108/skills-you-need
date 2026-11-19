# CodeAtlas for VS Code

See the visual explanation for the code under your cursor, and jump from a flow diagram to the lines behind each box.

CodeAtlas reads `.codeatlas/map.json`, a map of your codebase written by Claude using the [CodeAtlas skill for Claude Code](https://github.com/joshwu108/skills-you-need). This extension does not create the map and makes no network requests. It writes only what you ask for: the text of a box you edit, notes and links you add, and where you drag boxes to.

## What you get

- **From code to its explanation.** Explained code gets a link above it and a mark in the gutter. Click the link, or run **CodeAtlas: Explain This Code**, to open the map on that code.
- **A flow diagram beside your code.** The top level shows the system's main parts, each with a one-line summary. Click a part to open the flow inside it. Hover a box to pick out its arrows.
- **A walkthrough.** **Walk through** reads the map to you one box at a time, in the order the arrows run, with the right and left arrow keys. Tick *Show code as I go* and each step opens its code beside the diagram.
- **Find a box.** Press `/` and type part of a name.
- **Arrange it your way.** Drag a box to move it (or hold Alt and press an arrow key). Positions are saved to `.codeatlas/layout.json`, which you can commit so the whole team sees the same picture. **Tidy** puts a flow back to the automatic layout.
- **Fix the words.** **Edit** in the panel changes a box's name, kind, summary and explanation and saves them to `map.json`.
- **Add your own notes.** Select some code and run **CodeAtlas: Add Note for Selection** (or right-click the selection). The note is anchored to those lines, placed beside the box that covers them with an arrow to it, and opened for you to write in Markdown. **Add note** in the diagram adds one that is not tied to code. Notes get a code lens like any other box, and Claude is told never to rewrite or remove them.
- **Draw your own links.** In the panel's Connections section, pick a direction, another box and an optional label to add an arrow; the × beside a connection removes it.
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

The extension picks up `.codeatlas/map.json` in any open folder, including one created after the window opened, and reloads when the file changes.

`.codeatlas/atlas.html` is the same diagram as a page for a normal browser. Opened inside VS Code's built-in browser its code links cannot work; use **CodeAtlas: Open Map** instead.

## Commands

| Command | What it does |
|---|---|
| **CodeAtlas: Open Map** | Opens the flow diagram beside the editor. Also on the status bar, and on the right-click menu of the files in `.codeatlas/`. |
| **CodeAtlas: Explain This Code** | Opens the map on the most specific explanation covering the cursor. Also in the editor context menu. |
| **CodeAtlas: Add Note for Selection** | Starts a note of your own on the selected lines and opens it for writing. Also in the editor context menu. |

## Settings

| Setting | Default | |
|---|---|---|
| `codeatlas.codeLens.enabled` | `true` | Show a link above explained code. |
| `codeatlas.gutter.enabled` | `true` | Mark explained code in the gutter. |
| `codeatlas.followCursor` | `true` | While the map is open, follow the cursor. |

## Security

Explanations are written by a model from repository content, so the extension treats the map as untrusted input. Text is rendered without ever being interpreted as HTML, the panel's content security policy allows only the extension's own script and stylesheet, and anchors that point outside the workspace folder are ignored. Requests from the panel are checked before anything is written: an edit can change only a box's name, kind, summary and explanation, positions are plain coordinates, and the extension refuses to write through a symbolic link.
