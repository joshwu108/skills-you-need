# Changelog

## 0.2.0

- Walkthrough: step through the map in reading order, optionally opening each step's code beside the diagram.
- Drag boxes to rearrange a flow (Alt + arrow keys from the keyboard). Positions are saved to `.codeatlas/layout.json`; **Tidy** restores the automatic layout.
- Edit a box's name, kind, summary and explanation from the panel.
- Your own notes: **CodeAtlas: Add Note for Selection** (also on the editor's right-click menu) attaches a note to the selected lines and links it to the box that covers them; **Add note** in the diagram adds a free-standing one. Notes are drawn as yellow slips and Claude leaves them alone.
- Your own links: draw an arrow between any two boxes from the panel's Connections section, or remove one.
- A map that changes on disk updates in place: your level, zoom, walkthrough and any half-written edit are kept.
- Each box shows its one-line summary. Hovering or selecting a box picks out its arrows and neighbours.
- Search for a box by name with `/`. The panel lists what flows into and out of the selected box.
- The selected box is always brought into view.
- A map created after the window opened is picked up without a reload. **Open Map** is on the right-click menu of the files in `.codeatlas/`.
- The standalone page explains itself when it is opened in an editor's built-in browser, where code links cannot work, and when an editor link opens nothing.

## 0.1.0

- Code lenses, hovers and gutter marks on code that has an explanation in `.codeatlas/map.json`.
- The flow diagram in a panel beside the code, with drill-down into sub-flows.
- Click a box to jump to its lines; move the cursor to see that code's explanation.
- Anchors follow unsaved edits: moved code is tracked and changed code is flagged as out of date.
