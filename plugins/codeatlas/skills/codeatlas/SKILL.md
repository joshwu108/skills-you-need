---
name: codeatlas
description: Build and maintain a clickable visual map of a codebase - flow diagrams the reader can drill into, where every box is explained and linked to its lines of code. Use when the user asks for a visual walkthrough, a flow or architecture diagram of their code, a code map, a visual explanation of a file, function or line, a map kept alongside a feature being built from scratch, or to refresh a map after the code changed.
argument-hint: "[map [path] | explain <file[:line] or symbol> | plan <task> | refresh]"
allowed-tools: Bash(python3 ${CLAUDE_SKILL_DIR}/scripts/codeatlas.py *)
---

# CodeAtlas

You write one file, `.codeatlas/map.json`, at the root of the user's repository. It is a tree of nodes (service, then module, then function, then step) with edges between them, and each node carries an explanation and anchors to real lines of code. Two readers consume it:

- A standalone page, `.codeatlas/atlas.html`, which you build with the script below. It shows the top-level flow, opens a sub-flow when a box is clicked, and opens the code in the reader's editor.
- The CodeAtlas VS Code extension, which reads the same file to show a node's visual from a line of code.

The script is `python3 ${CLAUDE_SKILL_DIR}/scripts/codeatlas.py`, called `codeatlas.py` below. It needs only the Python standard library. Run it from inside the repository: it finds the nearest `.codeatlas/map.json` at or above the working directory, and treats the folder holding `.codeatlas` as the repository root. To keep the map somewhere else, pass `--map <file> --root <repository>` to any command except `symbols`.

## Pick the mode

| The user wants | Mode |
|---|---|
| A map of the repository or of a directory | **map** |
| One file, function, or line explained visually | **explain** |
| A map kept alongside a task they are starting | **plan** |
| The map brought up to date after code changes, or a hook reported stale nodes | **refresh** |

If a map already exists, extend it. Never start over unless the user asks. Run `codeatlas.py status` first: it says whether a map exists and lists what is stale.

## map

1. Survey before writing: the README, the entry points (CLI, server, jobs, tests that drive the system), and the package layout.
2. Choose the top level: 3 to 9 boxes, counting everything in the view, that are the system's runtime responsibilities. Folders are not automatically boxes; draw what a new engineer would sketch on a whiteboard. Add `external` nodes for things outside the repository that the flow depends on (a database, an API, a file drop).
3. Draw the edges in the direction the work moves: from a caller to what it calls, from a producer to what consumes its output. Where those disagree (a caller that mostly receives data back), draw the direction the data travels. The label is what travels, as a short noun phrase (`orders`, `parsed config`).
4. Go one level down inside each top-level box. Go deeper only where the core logic lives or where the user asked. Read the code for every node before you describe it.
5. Write the map, then run `codeatlas.py build --open`. Fix every error it prints and run it again. (`--open` shows the page in the user's browser; leave it off when nobody is at the machine.)
6. Tell the user where the viewer is, what the map covers, and which areas you left shallow.

On a large repository, map one subsystem at a time and say so. A shallow, correct map that the user can ask you to deepen is better than a deep map written from skimmed code.

## explain

1. Find the node that covers the code (`"file"` in the map). If there is none, create it with the right parent, creating the parents too if the map is new.
2. Read the code and go one level deeper than the map already goes. For a function, add `step` children anchored by line ranges, with edges showing the order and the branches (label a branch with its condition, such as `if empty`).
3. Run `codeatlas.py build --open`, then tell the user which node to look at. The viewer opens on a node with `atlas.html#/<node id>`.

## plan

Use this when the code does not exist yet.

1. Design the flow first. Write the nodes with `"planned": true` and no anchors, build, and show the user the diagram before writing code. This is the design review.
2. As each part lands, add its anchors, write its explanation from the code you actually wrote, remove `planned`, and build again.
3. Finish with no planned nodes left, or tell the user which remain and why.

## refresh

1. Run `codeatlas.py refresh`. Code that only moved is followed automatically. Nodes whose code changed are listed as stale.
2. For each stale node, read the current code and rewrite its `summary` and `explanation`. Add, remove, or re-anchor child nodes if the structure changed. If the code is gone, remove the node and its edges.
3. Run `codeatlas.py stamp --node <id>` for each node you rewrote (repeat `--node`), then `codeatlas.py build`.

When the plugin's hook reports stale nodes during other work, finish that work first, then do this for the nodes it named.

## The map file

```json
{
  "version": 1,
  "title": "Orderbook",
  "summary": "Markdown shown on the overview. What the system is for, in two or three sentences.",
  "nodes": [
    {
      "id": "engine",
      "parent": null,
      "kind": "service",
      "title": "Matching engine",
      "summary": "Matches incoming orders against the book.",
      "explanation": "Markdown. See the writing rules below.",
      "anchors": [{ "file": "src/engine.py", "symbol": "Engine" }]
    },
    {
      "id": "engine.step.validate",
      "parent": "engine.step",
      "kind": "step",
      "title": "Reject bad orders",
      "summary": "Drops orders with a non-positive size.",
      "explanation": "...",
      "anchors": [{ "file": "src/engine.py", "startLine": 41, "endLine": 47 }]
    }
  ],
  "edges": [{ "from": "api", "to": "engine", "label": "orders" }]
}
```

- `id`: lowercase letters, digits, `.`, `_`, `-`. Mirror the hierarchy with dots (`engine.step.validate`). Ids are permanent; the reader's links and the extension use them.
- `parent`: the id of the containing node, or `null` at the top level. A node's children are its sub-flow.
- `kind`: `service` (a runtime responsibility), `module` (a file or package), `function` (a function, method, or class with behaviour), `step` (a stage inside a function), `data` (a schema, table, file format, or a class that only carries data), `external` (outside the repository).
- `anchors`: a node may have several, and a parent may anchor the same file as its children. Prefer `symbol`. Python symbols are resolved exactly and may be qualified (`Engine.step`); a decorated definition starts at its first decorator. Other languages use a text search, so check with `codeatlas.py symbols <file>` (the path is relative to the working directory); anything it lists can be an anchor, including constants. Fall back to `startLine`/`endLine` if the symbol is not listed. Use line ranges for steps inside a function: they are 1-based and inclusive, may leave gaps, and should not overlap their siblings. `file` is relative to the repository root with forward slashes.
- Never write `hash`, `stale` or `staleReason` yourself. `build` and `stamp` fill in line ranges and hashes; `refresh` sets the stale flags.
- `edges` may connect nodes at any depth. The viewer lifts each edge to whatever level is on screen, so connect the most specific nodes you know and do not repeat the edge between their parents.
- Aim for 3 to 9 boxes in a view. `build` warns above 12; group the children under a new parent when it does. A node with two natural parts is fine as it is; never invent a box to reach a number.

The full schema is `${CLAUDE_SKILL_DIR}/schema/map.schema.json`.

## Writing a node

The reader clicks a box because they do not understand that code yet. Write for them.

- `title`: one to four words, the name a teammate would use.
- `summary`: one sentence under 160 characters saying what it does. It appears on hover and in lists.
- `explanation`: roughly 60 to 200 words of Markdown (a guide; nothing enforces it), in this order:
  1. What it does and why it exists.
  2. How it works: the main moves in order, naming real identifiers in backticks.
  3. What goes in and what comes out.
  4. What the code does not make obvious: invariants, ordering constraints, units, failure behaviour, the reason for a surprising choice.
- Explain; do not paraphrase the code line by line. If a sentence would still be true of any codebase, delete it.
- Say only what you read in the code. If you did not open the file, do not describe it.
- Supported Markdown: paragraphs, `#` headings, `-` and `1.` lists, fenced code, `inline code`, `**bold**`, `*italic*`, and `[links](https://...)`. Tables, images and HTML are not rendered.

## Commands

| Command | Use |
|---|---|
| `codeatlas.py build [--open]` | Stamp new anchors, refresh the rest, validate strictly, write `.codeatlas/atlas.html`. Run after every change to the map. It prints any stale nodes. |
| `codeatlas.py status` | List stale nodes. Changes nothing. |
| `codeatlas.py refresh` | Follow moved code and mark changed nodes stale. |
| `codeatlas.py stamp --node <id>` | Re-stamp a node you rewrote and clear its stale flag. |
| `codeatlas.py symbols <file>` | List the symbols that can be used as anchors, with their line ranges. |
| `codeatlas.py validate [--strict]` | Check the map without building. |

Exit code 1 means the map needs attention and the output says what; fix it and rerun. Exit code 2 means the command could not run (no map, unreadable file).

## Files and version control

- `.codeatlas/map.json` uses relative paths and is meant to be committed with the code. Commit it only when the user asks.
- `.codeatlas/atlas.html` embeds absolute paths for editor links, so `build` adds it to `.codeatlas/.gitignore`. Regenerate it; never commit it.
