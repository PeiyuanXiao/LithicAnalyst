# Changelog

## Unreleased

- Curves (P): trace edges, ridges and scar outlines on the surface. Each click adds a point that
  snaps onto a nearby ridge or valley, and the line between points follows that feature (S: ridge /
  valley / off; hold Shift to place a point without snapping). Traced stretches are pulled taut along
  the surface. Double-click, Enter or Esc finishes; clicking the first point closes the curve;
  Backspace removes the last point. In select mode, drag a point to move it.
- Curve fields: type (edge, ridge, scar boundary, other; keys 1–4) and note.
- Curve CSV (one row per point, with arc length) and `annotations.curves` in the project file
  (format version 1; older files open unchanged).
- A warning when the browser's autosave space is full.

## 0.1.0 — 2026-10-15

First version.

- PLY (ASCII/binary, with optional vertex colours), STL (ASCII/binary) and OBJ import; original coordinates kept.
- Scar vectors: press–drag–release or two clicks; automatic labels; undo/redo; endpoint dragging; delete.
- Fields: completeness (five categories, keys 1–5), direction certainty, note.
- Raking light (camera-relative, azimuth/elevation, L + mouse), curvature shading (scale 0–100, contrast), light or dark background.
- CSV export and project files (format version 1).
- Autosave in the browser, keyed by the mesh SHA-256; restore prompt on reopening a mesh.
- Chinese and English interface; light and dark themes.
