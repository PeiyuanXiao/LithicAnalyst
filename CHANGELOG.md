# Changelog

## Unreleased

- Retouch indices of flakes, worked out from the retouch regions and the edge with no further annotation: the estimated reduction (ERP, the volume removed, after Eren et al. 2005 and Morales et al. 2015: on each section the two original surfaces are fitted and extended until they meet), GIUR (Kuhn 1990), invasiveness (Clarkson 2002), the share of the edge retouched (dorsal, ventral and in all) and the curvature of the longest retouched stretch (R6/R3). `flakes.csv` ends with fifteen new columns; new exports `retouch_sections.csv` (a row per retouched station), `retouch_segments.csv` (a row per retouch region, with its chord and depth, also the diameter and depth of a notch) and `invasiveness.csv` (sixteen rows per flake), also for the whole folder; the parameters are in the project file and `manifest.json`. A flake with no retouch region counts as not retouched. New in the project file: `flake.retouch` (the fitted length, the frame of the plan, its direction) and `derived.retouchIndices`. No interface yet.

- The point of percussion and fixed landmarks now go to the nearest place of the ridge under the press, instead of sliding along it to its most pronounced place; dragging the technical axis's start snaps the same way (it did not snap at all), and shows where it will go. Shift still places them exactly.
- The platform line needs only two points, and the ventral line only some of the section within its band, so coarse meshes and small platforms no longer leave the EPAs and the IPA empty. `MIN_FIT_POINTS` and `PLATFORM_START_EDGES` are stored with the flake's parameters.
- An empty automatic measure of a flake says why when the pointer rests on its "—" (for the screen only: not in the file or the tables).
- Labels no longer catch clicks under the tools that place things on the model.

- Geometric morphometrics for flakes: a new GM configuration section says which points every flake has: the fixed landmarks (point of percussion, platform ends), curve semilandmarks along the edge and the three parts of the platform outline, and surface semilandmarks in grids over the ventral face, the dorsal face and the platform. They follow from the annotations and update as these change. A curve's ends are single points, shared with the fixed landmarks. A specimen that lacks something is told so and has no GM files. Exports: `gm_landmarks.tps`, `.fcsv`, `.csv`, and for geomorph's sliding `gm_curves.csv` and `gm_surfaces.csv`. A folder has one configuration (`LithicAnalyst/gm-config.json`); its summary recomputes the points that were made by another one, and lists the flakes it skips in the manifest. The Display panel can show the points.

- Retouch: curves and regions have a new type, Retouch, on cores and flakes (the user's own type moves one key on). A retouch region has a layer, 1 being the nearest the edge (Shift+1-5). Along an edge, each station's section is followed across the retouch regions it meets, and each layer gets its angles: from the edge to its outer end by three points and two lines, and its own face (`layer_face`). They are exported as `retouch_angles.csv`, with the distance along the surface, which is how deep the retouch goes; `regions.csv` ends with a new column `retouch_layer`.
- Sharp edge: a threshold on one series of the edge angles (by default three points at 2 mm; no default value) says which parts of an edge count as sharp. Type it, drag its line on the chart, or ask for a suggestion (Otsu's split, only when the angles fall into two clear groups). The stretches, their length and number follow at once, the curve can be drawn by them, and `edge_sharp.csv` lists them. A folder has one threshold for all its models (`LithicAnalyst/sharp-edge.json`).
- The chart of edge angles can show one line at a time, and the curve is coloured by it.
- An open curve that stops just short of another is joined to it, so the regions on either side stay apart.

- Regions in two layers. The upper layer holds the parts of a specimen, cut along the boundary curves alone: a core's flaking surfaces and platforms between its core edges, a flake's platform, ventral and dorsal faces between its edge and platform outline. The lower layer (scars, cortex, joint surfaces, damage, the user's own types) is cut along all the curves as before, so every lower region lies wholly in one part. `regions.csv` ends with a new column `parent_region`; a part keeps its whole area whatever lies in it, and a scar outline on a platform no longer cuts the platform. A scar crossing a boundary is two regions, which the new Scar choice in the region's details gives to one scar. With an edge and a technical axis, a flake's ventral and dorsal faces are found automatically (the piece under the axis, and the largest other); if the edge does not separate them, it says so.
- Regions take the user's own type, on cores and flakes. The user's own text is now always the last choice: on a flake the platform outline moves to key 5 and custom to key 6.
- Edge angles along curves, after Schunk et al. 2023 (3D-EdgeAngle): a new Measure edge angle switch on curves, on by default for a flake's edge and a core's edge. A section square to the curve every 1 mm; the angle at 2, 5 and 10 mm from the edge by three points and by two lines, all exported (`edge_angles.csv`, long format, also for the whole folder; the parameters in the project file and the manifest). In the measure mode the selected curve is coloured by its angles with a scale of its two ends, and a chart shows the angles along it. Not measured without a stated unit.
- Flakes: the Automatic measurements section of the measure mode is now the flake's own (the former Flake section). The toolbar puts the technical axis right after Select and the platform ends after the curve tool. A new button and key F turn the view to the technical axis: dorsal face toward the viewer, platform down; only the camera moves.
- Specimens have a type, core or flake (specimen panel; a new specimen starts as the last one; the folder list shows it and filters by it). Switching only changes what is shown: the other type's data stay in the project file and come back, and each type keeps its own frame. Curve types follow the type: a flake has Edge (`edge`, shown but not offered on a core; `core_edge` the other way round) and, after Custom, Platform outline (`platform_outline`, key 6, closed, one per flake). The new region type Platform (flakes): the smaller of the two pieces the outline makes becomes the platform region and follows the outline, unless the piece was typed by hand.
- Technical axis of flakes (key T): an arrow on the ventral face from the point of percussion distally, its start snapped as curve points are; drawn again it is replaced, its ends drag, it can be deleted. It sets `specimen.frame` (`technical_axis`; origin at the point of percussion, +Z dorsal, +Y distal, +X = Y × Z), shown as a small tag in the top bar, which also says why when no frame could be made. The landmark `pop` follows the start and is locked. Platform ends (key E): at most two, on the outline, exported as `platform_left` and `platform_right`.
- Flake measurements (measure mode, `flakes.csv`, also for the whole folder): technical and morphological length, width and thickness, the angle between the two lengths, platform width and depth (chord and along the surface within the platform region), platform area, EPA (three points and two lines at 1, 2 and 3 mm) and IPA, recomputed whenever their inputs change; the parameters are kept in the project file (`derived.flake`) and the manifest. `scar_vectors.csv` ends with a new column `tech_angle_deg` (empty for cores).
- Profile panel for flakes (Display): the longitudinal section and a cross-section to one scale with a scale bar; a slider, or a click or drag on the longitudinal section, moves the cross-section (its width and thickness are read out and its outline shown on the model); the longitudinal section carries the points and lines of the measurements.
- Fitted planes of flakes go by curve or by surface region (the new method `region`: the region's vertices, weighted by area).

- Volumetric configuration of cores (annotate mode, after the Logical Analytical System): each
  scar with an arrow goes to a face of the model's box (the specimen frame, else the principal
  axes) by its normal across the arrow, and gets as its platform the adjacent face it was struck
  from (facing back along the arrow, wherever the arrow starts); faces get roles (flaking,
  platform, both, unexploited) and flaking surfaces (F1, F2 …; faces worked round from one platform
  are one). A floating panel over the view (switched on in Display, moved, folded, its place
  remembered) gives facial character, flaking surfaces, their relation, platform relation, overall
  polarity, surface type (wide / narrow) and exploitation axis (long / short), with a sketch that
  can be turned and shows every scar's arrow (a click on one selects the scar), and a face card to
  correct roles, joins, type and axis; the polarity can be set by hand. Scars on a face set to
  platform or unexploited by hand make no platforms. A face that is both is drawn with a band in
  the platform colour. Corrections are undoable and cleared (with a notice) when the orientation
  changes. A view cube in the corner of the view turns with the camera; clicking a face there or in
  the sketch turns the view to it and fades the arrows elsewhere. New exports `configuration.csv`
  and `flaking_surfaces.csv` (with `also_platform`; also for the whole folder); `scar_vectors.csv`
  gains `platform_face` and `flaking_surface` before `unit`. Project files keep the corrections
  (`configuration`) and the result with its box and thresholds (`derived.configuration`).
- Bicone model of the volumetric configuration, for cores worked round one plane of intersection
  (Levallois, discoid, prepared, centripetal): the panel switches between Box and Bicone. With the
  only closed curve (or the only closed core edge) Bicone sets the volume split along it in the same
  undoable step; with several, an Edge curve list asks which, and stays there to change it. A split
  by a plane is replaced, with a notice. Two cones share the round base of the area the curve
  encloses, each as high as a cone of that base with its side's volume; scars go to a cone by their
  end, and each cone is a flaking surface or unflaked (correctable, kept by physical side). Only the
  facial character and the flaking surfaces are given (no polarity, no platforms). The sketch draws
  the cones with every scar's arrow bent along its cone, and the view cube becomes a small bicone;
  clicking a cone looks along the base's normal from that side. An open mesh or an invalid split
  shows only why. `configuration.csv` gains a `model` column (`box` / `bicone`); for the bicone,
  `flaking_surfaces.csv` has one row per flaking cone (`upper` / `lower`) and `platform_face` is
  empty.
- Upper and lower of a volume split can be swapped (`split.swap`) from the volume panel or the
  bicone's edge curve row; volumes, the measurement export and the bicone follow. Closed core-edge curves come
  first among the split candidates. A new split along a curve starts with the side with more scars
  up (as the view when even), not with the side it was seen from.
- Complete loop: an open curve along part of a core's edge (three anchors or more) is completed
  round the edge in one undoable step, along the model's outline seen across the curve's plane and
  snapped to the ridges, with an anchor about every 12° (more where the outline needs them); the
  filled-in part is dashed until its anchors are moved (`curve.completion`). A curve too short or straight, no edge found or no way round leaves the curve
  as it was, with a message.
- The configuration panel opens lower right, over the coordinate readout (a place already saved is
  kept), 320 px wide, with its title on one line, a short pill (PCA / 主轴) and the overall polarity on
  a row of its own. The bicone's sketch is framed by its outline (about 85 % of the width, from 35°
  above) and the view bicone centred on its own.
- The configuration panel no longer cuts its content off: in a low window the sketch gives way first
  (down to about 100 px), then the list of traits scrolls on its own, so the card stays in view. The
  face card is much lower (type and axis side by side, the joins in a row), the bicone's canvas is
  lower, swapping is a small button by the edge curve, and a panel moved low by hand goes up when its
  content grows, and back when it shrinks.
- Display panel: rows of one rank, shading, light, arrow colour, and the switches of the volumetric
  configuration and of the Harris matrix (moved here from the relations section; both in the annotate
  mode only). A light ball replaces the light direction and height sliders: the point on it is where
  the light comes from, by the same rule as holding L over the view; a double click goes back to the
  default. The arrow thickness setting is gone (fixed at 1.0). The panel now stays above the relation
  chip.
- Surface-to-Volume Ratio and Wadell sphericity are gone from the measure mode and from
  `measurements.csv` (columns after `volume` move up two places): both follow from `surface_area` and
  `volume`; the README gives the formulas.
- The bicone in the configuration sketch stays whole and centred however it is turned, drawn smaller
  only when it must be. Switching between Box and Bicone goes back to the default view.
- Fewer words on buttons: delete, move up and down, flip, view along normal, swap, reset, next pair,
  download all and cancel show only their icon, with the name in a tooltip; add plane, sequence and
  semilandmarks show only a plus. Swap moved next to the split's list, download next to the workspace's
  navigation.
- Faster on large models: the measure pass after opening a 2-million-triangle model no longer blocks
  for more than a few tens of milliseconds at a time, and turning curves into mesh edges (volume split,
  regions) runs in slices. `npm run bench` times the heavy steps on a generated model.
- Curve types are now scar outline (`scar_boundary`), core edge, cortex and joint surface (keys
  1–4), or the annotator's own text (key 5, suggesting the texts used before); a new curve's type
  is not filled in. The older types edge, ridge and other are still read, shown and exported as
  they were. The annotate sidebar is ordered arrows, relations and sequences, curves, regions,
  landmarks.
- New sequences are ordered: their scars follow the relations at once (and `order_in_series` is
  filled) without ticking "Ordered within", which can still be switched off. Sequences in files
  keep their setting. With the whole folder as the export scope the dialog's button reads
  "Export"; the File button is no longer a main button when no model is open.
- Folders: subfolders are read (folders starting with "." and the app's own `LithicAnalyst/` are
  left out). The app keeps its files in `LithicAnalyst/`: projects in
  `projects/<model path>.lithicanalyst.json` (named with the model's extension, so `EXP03.ply` and
  `EXP03.stl` no longer share one), every export in a new `exports/<date_time>/` and figures in
  `figures/<date_time>/<subfolder>/`, with a `manifest.json`; nothing is overwritten. Projects kept
  next to the model by earlier versions are still read (when the checksum matches), never changed.
  Models sharing a file name get their paths as specimen IDs.
- The folder panel is a list (filter, a dot for models with a project, the open one marked) with
  "Next not started" (Shift+PageDown); it handles a thousand models.
- Export dialog: with a folder open, the scope is this specimen or the whole folder (the summary
  export, formerly "Measure all"); figures for the whole folder are a switch next to PNG / SVG.
  Both batch runs skip models that cannot be read or measured, list them (`failures.csv`, the
  manifest) and report "N done, M failed"; their progress shows the time left.
- The summary export runs in a background worker (it goes on in a background window), reads each
  project file once, and uses the results a project stored instead of reading its model when they
  were written by this version. Figures for the whole folder keep the screen on and pause while the
  page is in the background.
- `measurements.csv` has a `file` column (the model, its path in a folder). Project files store
  the vertices' principal axes (`derived.vertices`).
- Read-only folders (Firefox, Safari): edits are kept for the session, "Download all project files
  (zip)" saves them in the folder's layout, exports come as one ZIP of that layout, and leaving the
  page with edits not downloaded asks first.
- Compare mode: "Add the folder's project files" loads the other project files of the model.
- Relations (B): the order of the clicks is the order of the words — clicking A, then B records
  "A cuts B" at once (and rewrites what the pair had). A small bar next to the second click shows
  it and offers Reverse (2), Cannot tell (3) and Delete; 1 brings back "A cuts B". The bar takes
  nothing away from the tool and goes at the next press in the view, a change of tool, Esc or
  another selection. Nothing is ever recorded as "cannot tell" unasked. While the tool is in use,
  the borders of scars whose regions meet and have no relation yet are drawn dashed (white with a
  dark outline), and the sidebar counts them with a "Next pair" button that turns the view there.
- Sequences (Q): a new tool. A bar under the toolbar lists Q1, Q2 … (colour and number of scars);
  1–9 choose the current sequence, N or "+" makes a new one. A click on a scar (arrow or region)
  puts it into the current sequence, or takes it out again. Meanwhile arrows are coloured by
  sequence and scars in none are faded. The Harris matrix shows itself while the relation or
  sequence tool is in use.
- The order of the sequences, and of the scars within ordered ones, follows the relations
  (chained through other scars as well); what the relations do not decide keeps its order, and a
  cycle keeps the order it had. The reordering is part of the same undo step as the change. Moves
  in the sidebar that the relations rule out are disabled and say why ("S3 cuts S2"); between
  members a solid line marks an order held by the relations, a dashed one an order set by hand.
- Completeness: a sixth code, `proximal_missing` (point of percussion missing, termination
  present), third in the list; the keys are now 1–6 in the order shown (codes unchanged).
- Termination: a new arrow field (`termination`: `feather`, `step`, `hinge`, `overshot`, `na`),
  set with Shift+1–5; empty until judged, apart from `na` (looked at, no termination). A
  completeness without a termination sets it to `na` and locks it; back to one with a
  termination, `na` is cleared. The arrow CSV has a `termination` column after `completeness`;
  agreement includes it (pairs with an unfilled side are left out).
- File menu: Close puts the model away (and leaves the folder), back to the empty view. It asks
  first only when edits could be lost: a read-only folder with edits not downloaded, or an
  autosave that failed.
- PLY files whose triangles each have vertices of their own are joined at coincident corners on
  reading, so snapping, curvature and regions work on them; the checksum is still that of the file.
- Appearance: light and dark shells, switched from the top bar (moon / sun) and remembered; the
  first visit follows the system setting. Warm stone neutrals with an amber accent; yellow now
  only marks the selection (items being drawn take their layer's colour; plane P3, a scar-region,
  a sequence and an observer colour that were yellow changed, and cortex is brown). The 3D view
  has a neutral grey background, slightly darker at the top, that follows the theme (figures
  unchanged: PNGs keep their transparent background), and corner marks.
- The interface starts in English; the language menu in the top bar (English, 中文) switches
  and remembers the choice.
- Tools and modes are icon buttons (the current tool shows its name; tooltips give name and
  key); in windows narrower than 1200 px the modes show icons only. The specimen is one button in
  the top bar (ID and unit; its panel holds ID, unit, annotator, notes, model file and mesh size).
  Models, folders and projects open from the File menu or the empty view only.
- Display panel: shading, light direction and height, arrow thickness and colour, and three
  switches (background, fill light and gloss are gone; the last two keep their defaults).
- Orientation panel: rows for front view (current view, or a plane from a menu), vertical (an
  arrow from a menu), turning (±90° buttons and fine turn), with the source as a translated tag.
- "Add" entries are dashed buttons at the end of their lists. The compare mode hides groups
  neither observer has anything in. The shortcuts dialog has two columns and fits on one screen.
- Camera moves (H, view specimen, view along a plane, turning the frame, focusing an item) take a
  short transition; any press, wheel or key that moves the view stops it. The select tool shows
  what a click would select (a little thicker, a pointer, and its label and kind after a pause).
  Panels, menus and dialogs fade in. Nothing moves when the system asks for reduced motion.
- Plane sections on the model are thinner. Numbers are right-aligned with their units in a
  column of their own; each kind of quantity has one number of decimals (lengths and
  coordinates 3, areas and volumes 2, angles 1, ratios 3), missing values show "—". Exports are
  unchanged.
- Interface: the top bar holds the specimen ID and unit (annotator, notes and the model file
  in a small panel), a File menu (open model, project or folder), Save, and the mode switch in
  the middle; the main button is File until a model is open, then Save. Display settings are a
  panel over the view (Display button). The sidebar follows the tools: choosing a tool opens its
  section and folds the others (the folder's stays), selecting an object opens its section and scrolls to it; empty
  and unusable sections are trimmed; it can be resized from its left edge. Each mode's data
  files are exported from one Export dialog (several files in one ZIP); file names and columns
  are unchanged. The shortcuts dialog is grouped by mode; saving without an annotator shows a
  reminder.
- View: measure mode fades the annotations; present mode hides labels and shows the layers
  the figure shows; labels that would overlap move apart or hide; fitted-plane discs are barely
  visible unless selected; region colours keep the relief visible (figures unchanged).
- The Harris matrix panel can be moved, resized and folded, stays above the labels, and lists
  scars without "cuts" relations apart. The agreement table is grouped by object, with
  pairing counts, named metrics and units; a click shows the most different pair in 3D.
- The IBM Plex fonts are bundled into the HTML file (no requests to Google Fonts).
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
  no hole filling). Manual measurements (D / G / N):
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
- Folders: open a folder of models (Open folder); step through them (PageUp / PageDown or the
  list). In Chrome and Edge each model's project is saved next to it
  (`<model>.lithicanalyst.json`) and read back; other browsers read the folder only, and files
  are downloaded. Measure all: the automatic measurements of every model with the derived
  results of its project, every CSV kind merged into one file per kind (and one TPS), plus the
  ICC(2,1) per measure when the folder holds several observers' project files per model.
  Figures for all: the same figure settings for every model (PNG or SVG). One model at a time,
  with progress and cancel.
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
