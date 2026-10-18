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
- Work modes in the top bar: Annotate, Measure, Present (M cycles through them). Each mode shows
  only its own tools and sidebar sections; the existing tools are under Annotate. Switching keeps
  the selection and the undo history, and the last mode is remembered.
- Measure mode. Automatic measurements when a model opens: length, width and thickness (along the
  specimen frame, or the principal axes of the surface), surface area, volume (closed meshes only;
  no hole filling), Surface-to-Volume Ratio and Wadell sphericity. Manual measurements (D / G / N):
  straight distance, distance along the surface and angle, labelled M1, M2 …, undoable and saved in
  the project file. Exports: `<specimen>_measurements.csv` and `<specimen>_manual_measurements.csv`.
- Fitted planes (measure mode): all vertices (Lin et al. 2024), scar directions (Xiao et al. 2026),
  scar origins (with a completeness filter) and curves. Planes are recomputed whenever their inputs
  change; each is drawn as a translucent disc with its section of the model and its normal, can be
  flipped, viewed along its normal and shown or hidden. Export: `<specimen>_planes.csv` with the
  centre, the normal and the 4×4 matrix to the plane frame.
- Specimen orientation (present mode): the main face is seen from the current view or along a
  plane's normal; an arrow can set the vertical (origin at the bottom); turn by 90° or fine-tune.
  Only the matrix is recorded (`specimen.frame`); the camera follows it, the model and the
  annotations keep their coordinates, and length, width and thickness use the frame.
- Figures (present mode): any of the six standard views, laid out by the European convention
  (ISO first-angle projection) at one scale; raking light from the upper left with adjustable
  height; overlays for scar arrows, curves, plane sections and a scale bar. PNG with a transparent
  background at a physical scale (1:2, 1:1, 2:1) and 300 / 600 / 1200 dpi (written into the file);
  SVG in millimetres with the shading embedded and arrows, curves, sections, scale bar and outline
  as vectors, hidden parts left out. Without a stated unit there is no scale bar or physical scale.
- Sections (present mode, X): drag a line across the model; the section is the plane through it
  and the view direction. The model can be cut open on one side, with the cut face solid or
  hatched; the section drawing exports to SVG / PNG on its own or joins the figure, to the right of
  the views. For display only: no measurements come from sections.
- Surface regions (R): curves split the surface into pieces (curve ends snap onto existing curves,
  so curves can enclose areas); click a piece and set its type with keys 1–4 (scar, cortex, joint
  surface, damage). Regions are stored as seeds and follow the curves when they change; a scar
  region is linked to the arrow that starts in it, or to a new scar without a direction; two
  seeds in one piece are reported. Region colours (display and figures), areas per region and
  type, cortex ratio; `<specimen>_regions.csv` and five new columns in the measurement CSV.
- Cortex sphere (measure mode): a least-squares sphere through the vertices of the chosen cortex
  regions (all by default; algebraic start, then geometric refinement): radius, centre, residual
  RMS; optional wireframe sphere; `nodule_radius` and `nodule_fit_rms` in the measurement CSV.
- Upper / lower volume (measure mode, closed meshes): split by a closed curve (e.g. the edge of a
  core) or a fitted plane; the upper side is where the normal points (swappable). `volume_upper`,
  `volume_lower` and `volume_ratio` in the measurement CSV.
- Relations and removal sequences (annotate mode, B): click two scars (their arrows or regions)
  and record "A cuts B" (A is later), "B cuts A" or "cannot tell", which is kept apart from pairs
  not judged yet; edit or delete relations in the sidebar. Sequences (Q1, Q2 …) are put in order,
  scars are assigned from the scar inspector, and the order within a sequence is optional.
  Live checks — cycles, contradictions with the order of the sequences and within an ordered
  sequence, scars in no sequence — show as a count; the list highlights the scars involved. A
  Harris matrix panel (later scars higher, direct relations only, cycles in red, sequences
  framed) follows every change, selects scars on click and exports to SVG. "By sequence" colours
  arrows and scar regions by sequence, light to dark from the earliest scar. Exports:
  `<specimen>_relations.csv` and `<specimen>_series.csv`. Deleting a scar removes its relations.
- Landmarks (annotate mode, K): click the surface to place a fixed landmark (snapped onto a nearby
  ridge or valley as the snap setting says; Shift places it exactly), drag it to move it, name it
  freely; the list order is the export order (drag rows or use the arrows). Optionally reuse the
  names of the last specimen: they are applied in turn as points are placed, and can be skipped.
  Curve semilandmarks: N points at equal arc length along a curve, optionally between a start and
  an end landmark, kept up to date when the curve or the landmarks change. Exports: TPS (LM3),
  3D Slicer `.fcsv`, `<specimen>_landmarks.csv` and the sliding definition
  `<specimen>_sliders.csv` (geomorph `curves`: before, slider, after) — all with the same point
  numbers. Landmarks can be drawn in figures.
- Compare mode: read the project files of other observers (or repeat sessions) of the same model
  next to the open one; each is drawn in its own colour. Arrows and curves are matched by distance
  (Hungarian method, with an adjustable limit), planes by method, landmarks by name,
  semilandmarks by set and number, regions per triangle. Results: direction angles and endpoint
  distances, unmatched counts, mean and Hausdorff curve distances, plane angles and centre
  distances, IoU and Dice of region types and scar regions, agreement and Cohen's / Fleiss' κ for
  scar attributes, region types and relations, landmark distances and measurement differences.
  Exports: `<specimen>_agreement.csv` (long table) and `<specimen>_agreement_summary.csv`.
- Project files are saved in format version 2: scars are objects of their own
  (`annotations.scars`) whose direction arrow (`vector`) is optional, the specimen can carry an
  orientation matrix (`specimen.frame`), and computed results go under `derived`. Files from
  earlier versions open unchanged and are converted when saved; the arrow CSV is unchanged.

## 0.1.0 — 2026-10-15

First version.

- PLY (ASCII/binary, with optional vertex colours), STL (ASCII/binary) and OBJ import; original coordinates kept.
- Scar vectors: press–drag–release or two clicks; automatic labels; undo/redo; endpoint dragging; delete.
- Fields: completeness (five categories, keys 1–5), direction certainty, note.
- Raking light (camera-relative, azimuth/elevation, L + mouse), curvature shading (scale 0–100, contrast), light or dark background.
- CSV export and project files (format version 1).
- Autosave in the browser, keyed by the mesh SHA-256; restore prompt on reopening a mesh.
- Chinese and English interface; light and dark themes.
