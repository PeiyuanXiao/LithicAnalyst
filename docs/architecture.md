# Architecture

LithicAnalyst is a static web application (TypeScript + three.js) that builds into one
self-contained HTML file. All processing happens in the browser; nothing is uploaded.

```
ui/       header, toolbar, sidebar, dialogs, shortcuts, two languages    (depends on everything below)
tools/    interaction tools: select, draw arrow, draw curve, relation, sequence … (one module each); surface snapping
render/   three.js viewer, raking light, mesh shading, arrow and curve layers
core/     data model, fields, commands + undo history, project format   (no DOM, no three.js)
compute/  pure geometry on typed arrays: curvature, surface paths, vertex welding, hashing
io/       PLY / STL / OBJ import, CSV and project export, autosave, file saving
──────────────────────────── project file (docs/project-format.md) ────────────────────────
analysis  outside this repository (R, Python, …) reads the CSV or the project file
```

## Rules that keep it extensible

1. **`core/` and `compute/` never import the DOM or three.js.** They are tested in Node
   (`npm test`) and can be reused by a command-line tool or another front end.
2. **Every change to project data is a Command** (`core/commands.ts`), executed through
   `store.history`. Undo/redo, autosave and change notifications follow automatically.
   UI code calls the functions in `core/actions.ts`, never the store's `_` methods.
3. **Stored coordinates are always original file coordinates.** The viewer re-centres the
   mesh for float precision (`LoadedMesh.offset`) and lifts arrows off the surface for
   display; neither touches the data.
4. **Fields live in one list** (`core/fields.ts`). The inspector, list summaries, colour modes
   and CSV columns are generated from it; adding a field there carries it through the app.
   `numberKeys` / `shiftNumberKeys` give a field the number keys (or Shift + number keys) of the
   selected item. A field that follows another is set through `withAttribute` (the termination
   is `na` and locked, `fieldLocked`, while the completeness says it is missing), which
   `setScarAttribute` applies in one undo step. An option marked `legacy` is read and shown but
   no longer offered (`offeredOptions`); a field with `allowCustom` also takes the user's own
   text, stored as the value (`customValue`, `isCustomValue`), and the number key after its
   options opens the box for it (`Sidebar.openCustomType`; suggestions from `App.customValues`:
   this specimen and the folder's project files already in `ProjectIndex`).
5. **Tools implement one interface** (`tools/tool.ts`) and are registered with the
   `ToolController`. The controller listens on the viewport in the capture phase, so a tool
   can claim a press before the camera controls see it.
6. **Interface text lives in `ui/strings.ts`** with Chinese and English for every key. Keep
   the interface lean: labels and controls, no explanatory paragraphs.

## Mesh geometry

`compute/meshGeometry.ts` holds whole-mesh geometry on typed arrays, each function with
known-answer tests (boxes, icospheres, open and non-manifold meshes in
`tests/meshGeometry.test.ts`):

* `surfaceArea`, `signedVolume` (divergence theorem; meaningful only for closed meshes);
* `buildEdges` (undirected edges with triangle counts) and `meshTopology`: boundary edges,
  boundary loops, non-manifold edges, connected pieces, `closed`;
* `vertexPca` (every vertex counted once) and `areaWeightedPca` (the surface itself, exact
  second moments of each triangle);
* `fitPlane`: total least-squares plane of a point set (direction of least variance);
* `intersectPlane`: the section of the mesh by a plane, as polylines;
* `partitionFaces`: connected regions of triangles separated by a set of mesh edges.

`compute/linalg.ts` has the symmetric 3×3 eigen solver they share. On a 2-million-triangle
scan the slowest of these (`buildEdges`) takes a few hundred milliseconds, so callers run them
off the interaction path (after loading, in idle time or a worker), never per pointer move.

## Curves and snapping

* `compute/surfacePath.ts` (pure): feature strength per vertex from signed mean curvature
  (ridge = convex, valley = concave), a lazily expanded Dijkstra search over mesh edges whose
  weights drop on features (`PathSearch`, live-wire style: the frontier is kept, so following
  the cursor is cheap), snapping a picked vertex onto a nearby crest, and `relaxPath`, which
  pulls a traced chain taut along the surface while holding feature points.
* `tools/surfaceSnap.ts` ties these to one loaded mesh: adjacency and curvature come from the
  `CurvatureService` at the shading scale (what you see is what snaps), closest points from the BVH.
* `tools/drawCurveTool.ts` places points and shows the live stretch; `tools/selectTool.ts`
  drags curve points and retraces the two neighbouring stretches.
* `render/curveLayer.ts` draws curves as screen-space lines (`Line2`) with a dark halo; the
  stretch a loop was completed with (`autoEdges` in `core/curveGeometry.ts`) is a second, dashed
  set of segments (`LineSegments2`) for the core line.
* **Complete loop**: `compute/completeLoop.ts` (pure, in steps) fits a plane to an open curve,
  takes the outline of the model over the gap seen along its normal (the vertex furthest from the
  centre in each stretch of about 2°), snaps those onto ridges (`snapToFeature`) and traces them
  (`PathSearch`, ridge costs) from the curve's end back to its start; then it keeps about one of
  those stops per 12° and traces again between them, keeping more where that runs more than two mean
  edge lengths from the dense line (splitting at the stop furthest from it). It returns vertex
  chains or why it could not. `App.completeLoop` runs it in slices (`runSliced`), pulls each chain taut
  (`SurfaceSnap.refine`) and applies it in one `completeCurveLoop` (an `UpdateCurveCommand`);
  nothing changes when it fails or the curve changed meanwhile. `setCurveShape` turns moved
  automatic anchors into the user's (`editedCompletion`).

## Adding a new annotation layer (e.g. landmarks)

Curves were added this way; use them as the worked example.

1. `core/types.ts`: add the item type (e.g. `Landmark { id, label, point, normal, attributes }`)
   and a list under `ProjectState`.
2. `core/commands.ts` + `core/actions.ts`: add/delete/update commands, mirroring the scar
   ones.
3. `core/schema.ts`: serialise under `annotations.landmarks`; old files simply lack the key.
   Bump `formatVersion` only if old readers would misread the file.
4. `render/`: a layer class that draws the items from state (see `ArrowLayer.sync`).
5. `tools/`: a tool that creates and edits them; register it in `ui/app.ts`.
6. `ui/sidebar.ts`: a section listing the items; `io/csv.ts`: an exporter.
7. Tests for the commands, the format round trip and the exporter.

## Work modes

The top bar switches between work modes (`AppMode` in `ui/appApi.ts`: annotate, measure,
present, compare). A mode owns its tools and sidebar sections:
`App.updateToolbar` shows the toolbar of the current mode, and `SECTIONS` in `ui/sidebar.ts`
lists which modes show each section. Outside the annotate mode the select tool only navigates
(`ToolContext.editable()`), and keys that change annotations are ignored. Switching modes
keeps the selection and the undo history.

* **Layers per mode** (`App.syncAnnotations`, `App.applyLayerVisibility`): the measure mode draws
  the annotation layers faded (`dimmed` on the arrow, curve, landmark and region layers; labels
  by CSS); the present mode shows the layers the figure's overlay switches show, without
  labels; the compare mode draws each observer's annotations instead of the open project's.
* **Sidebar** (`buildSidebar`): choosing a tool opens its section and folds the others but the
  folder's (`TOOL_SECTIONS`; these changes are not remembered, only the user's own); selecting an
  object opens its section and scrolls its inspector to the top (lists scroll only themselves;
  the narrow layout, where the whole work area scrolls, is left alone). Sections that cannot be
  used are hidden (`Section.visible`); without a model the sidebar is empty but for the folder's
  list while a folder is open (models open from the File menu or the empty view). The data exports
  of a mode are one dialog (`App.openExport`, files from `App.exportables`; several files go
  into a stored ZIP, `io/zip.ts`).
* **Top bar**: the specimen button (ID and unit; its panel holds ID, unit, annotator, notes and
  the model file); the mode switch in the middle; the File menu, Save, undo and redo, the
  language menu (`LANGS` in `ui/i18n.ts`), the theme switch and the shortcuts. Menus and small
  panels (`ui/popover.ts`, one `Popovers` shared through `AppApi.popovers`) close on a press
  outside or Esc. The display settings are a panel over the view
  (`Sidebar.displayEl`, mounted by `App.buildDisplayControl`): rows of a label and its control, with
  the switches of the configuration and Harris panels (annotate mode) and of a flake's profile panel, and the light ball
  (`ui/lightBall.ts`, a 2D canvas drawn only when the light changes; it shares `lightFromDisc` in
  `render/lighting.ts` with the L key in `tools/toolController.ts`). The sidebar's left edge resizes
  it (`sidebarWidth` preference).
* **Labels**: after each render `render/labelLayout.ts` moves labels that would cover each
  other apart by priority (selected first, hidden-behind-the-surface last) and hides those
  without a free place. `.viewport-labels` is its own stacking context, below every panel over
  the view.

## Shell: theme, icons, tooltips, numbers

* **Theme** (`ui/theme.ts`): `<html data-theme="light|dark">` picks one of the two sets of colour
  variables in `styles.css`; the choice is kept in `localStorage` (`lithicanalyst:theme`), else the
  system's `prefers-color-scheme` is followed. An inline script in `index.html` (kept in
  `artifact.html` by `scripts/make-artifact.mjs`) sets it before the first frame. The WebGL canvas
  is cleared transparent: the view's background is the container's CSS gradient
  (`--viewport-bg-top` → `--viewport-bg-bottom`), so it follows the theme without touching the
  renderer. Figures render into their own transparent targets and are unaffected.
* **Icons**: `icon()` draws the 24-unit path icons of the top bar and sidebar; `icon20(markup)`
  draws the 20-unit icons of the view toolbar, the mode switch and the shell from SVG markup
  (`ICONS20` in `ui/dom.ts`; elements may carry their own fill or stroke width).
* **Tooltips** (`ui/tooltip.ts`): one shared `tips` instance. `tips.attach(el, content)` shows a
  name and a key cap below an element after 300 ms of hover (at once on keyboard focus);
  `tips.showAt(x, y, …)` shows one next to the cursor. Toolbar, mode and top-bar buttons use
  them instead of `title`, as do `iconButton` and `plusButton` (`ui/controls.ts`): a button whose
  icon says what it does shows no words; its name is in the tooltip and in `aria-label`.
* **Hover** (select tool): `SelectTool` picks at most once a frame with the same pick as a click
  (arrows, curves, landmarks, measurements; BVH rays only) and tells each layer
  (`setHoverItem`) and the app (`ToolContext.hovered`, which shows "label · kind" after a pause).
* **Numbers** (`core/format.ts`, no DOM): one number of decimals per kind of quantity
  (`DIGITS`), counts with thousands separators, "—" for missing values, and the unit of each
  kind (`quantityUnit`). Lists and tables put the unit in a column of its own (`.num-list` rows
  share their columns through CSS subgrid; `numRow` / `coordRow` in `ui/controls.ts` build
  `.num-grid` / `.coord-grid` rows). Exports keep their own formats.
* **Motion**: popovers, menus, dialogs and tooltips fade in by CSS; `prefers-reduced-motion`
  turns every animation and transition off (also the camera transitions below).

## Camera transitions

`Viewer.fitView` / `viewFrom` / `viewAll` take `animate`: the camera then moves in 280 ms
(cubic ease-in-out), the rotation centre and distance interpolated linearly and the orientation
by quaternion slerp, one step per animation frame in the render loop (rendering stays on
demand). A press on the view, the wheel, setting the rotation centre or a new move stops it.
The app animates H, viewing the specimen frame, viewing along a plane, frame changes from the
orientation panel (not the fine-turn slider, which follows the hand) and focusing an item; it
does not animate loading a model, stepping through a folder or rendering figures. Only the
camera moves: no coordinates change.

## Measurements

* `compute/measure.ts` measures a mesh once after loading (`surfaceMeasuresSteps`: area, volume,
  closedness, area-weighted principal axes) and derives length, width and thickness from the
  specimen frame or the principal axes (`autoMeasurementsSteps`). The app keeps the result and
  recomputes the dimensions when `specimen.frame` changes; `serializeProject` stores it under
  `derived.measurements`.
* Long computations are generators (`compute/steps.ts`): `runSync` runs them at once (tests),
  `runSliced` in slices of ~12 ms between frames, so a large scan never freezes the interface.
* Manual measurements are annotations (`ProjectState.measurements`, commands like the others).
  `tools/measureTool.ts` takes the points (three registered tools: distance, geodesic, angle);
  a geodesic is a `PathSearch` over mesh edges, pulled taut with `relaxPath` and kept on the
  surface (`SurfaceSnap.hug`). `render/measureLayer.ts` draws them (only in the measure mode).

## Specimen frame

`core/frame.ts` builds and changes the frame matrix (from a view direction and an up vector,
turning on the page, taking the vertical from a direction). The present mode sets it through
`App.setFrameFromView / setFrameFromPlane / setFrameVertical / turnFrame`; each button press is
one undo step, a fine-turn drag is one. `App.viewFrame` puts the camera on the frame (looking
along −Z, +Y up); nothing transforms the model or stored coordinates.

## Figures

`render/figure.ts` renders the standard views off screen with an orthographic camera per view
(the main scene with the annotation overlay hidden, the key light set to the upper left of the
page), into transparent render targets at the exact pixel scale. Annotations are projected into
each view as 2D polylines; a point counts as hidden when a ray from it toward the camera hits the
mesh. Arrows are drawn only in views their surface faces. The outline comes from the coverage of
the rendered image (`compute/contour.ts`, marching squares + simplification). PNG files get a
pHYs chunk with the dpi (`io/png.ts`); SVG files are sized in millimetres.

## Surface regions

* `compute/regions.ts`: `polylineEdges` turns a curve into mesh edges; `regionsSteps`
  partitions the triangles across them (in slices) and sums the areas; `resolveRegions` finds
  each seed's piece, flags two seeds in one piece and totals the areas by type.
* The app repartitions when curves change and re-resolves when regions or scars change. Seeds
  are located with the BVH (closest triangle). `render/regionLayer.ts` paints the pieces with
  one mesh each, sharing the scan's vertex buffer; it sits in the scene (not the annotation
  overlay), so figures can include the colours.
* `App.curveChains` joins open curves to others they stop just short of (`joinOpenEndsSteps`), or the two sides would run together through the gap.
* **Two layers**: the type says the layer (`isUpperRegion`). `App.updatePartition` cuts twice: the lower layer along all the curves' mesh edges,
  the upper along those of the boundary curves (`isBoundaryCurve`, by the specimen's type), kept while they do not change. Since one set of edges holds
  the other, each lower piece lies in one upper piece (`overPiecesSteps`), so a lower region has one parent. `App.seedComponent` and
  `App.upperComponent` hold the piece of each region in its own layer, −1 in the other; `resolveRegions` takes the upper layer as `UpperLayer`. A second, fainter
  `RegionLayer` paints the upper layer under the lower one (both under `regionRoot`, which figures show or hide). A click with the region
  tool on a part not divided further selects the part itself.
* Regions with `auto: true` are made and removed in the commands that complete or break their inputs (`autoRegionChanges`); their pieces are
  derived (`upperComponents`, `flakeFacePieces`, `outlineSeed`), so undo cannot set off a new command.
* `addRegion` / `setRegionType` create a scar without a direction in the same undo step when a
  scar region has no arrow, and remove it again when it is no longer used (`CompoundCommand`).
* The curve tool snaps points onto existing curves (T-junctions) so curves can close regions.

## Relations and sequences

* `ProjectState.relations` (one per pair of scars, `a_cuts_b` or `indeterminate`) and
  `ProjectState.sequences` (earliest first) change through `SetRelationsCommand` /
  `SetSequencesCommand`, which keep the whole list before and after (the lists are short).
  `deleteScar` takes the scar out of both in the same undo step.
* `compute/relations.ts` is pure and works on ids: `checkRelations` (cycles by Tarjan's strongly
  connected components, contradictions with the order of the sequences and within ordered
  ones, scars in no sequence), `directRelations` (transitive reduction) and `harrisLayout`
  (rows by the longest chain of earlier scars, columns grouped by sequence; scars without a
  "cuts" relation go to a last column of their own, `unrelated`). The app recomputes them on
  every change (cheap) and stores the checks under `derived.relations`.
* **Order from the relations** (`compute/relations.ts`): `stratigraphy` is the transitive closure
  of the "cuts" relations (`later`, `before` — later one way and not also the other —, `chain` for
  the relations behind an order, `sequenceBefore`); `stableOrder` sorts so that constraints hold
  and everything else keeps its order (each step takes the first item nothing left must precede;
  constraints inside a strongly connected component are dropped, so cycles keep their order);
  `orderSequences` applies it to the members of ordered sequences and to the sequences. Every
  action that changes relations or memberships (`core/actions.ts`: set, reverse or delete a
  relation; add a scar to a sequence or take it out; add or delete a sequence; order a sequence)
  reorders in the same undo step (`CompoundCommand` of the relations and the sequences). Manual
  moves do not reorder; the sidebar disables those the relations rule out and gives the chain as
  the reason, and draws the link between two members solid (held by the relations) or dashed.
* `tools/relationTool.ts`: two clicks on scars (an arrow, else the scar region under the click);
  the first cuts the second (`App.recordRelation`, at once). `App.showRelationChip` then shows the
  relation in a small bar next to the second click, placed by `App.placeNear` on the side that
  leaves both scars and the first click in view; its keys (1 / 2 / 3, Delete, Esc) are handled in
  the app's key handler while it is shown, and it goes at the next press in the view, a change of
  tool, Esc or another selection — it never holds the tool up.
* `tools/sequenceTool.ts`: a click on a scar puts it into the app's current sequence or takes it
  out (`App.toggleInSequence`; the first click without any sequence starts one). The bar of
  sequences (`#sequence-bar`, `App.updateSequenceBar`) sits under the toolbar; digits and N go to
  it while the tool is active. Meanwhile `syncAnnotations` draws the arrows in the `sequence`
  colour mode and fades the scars in no sequence (`ArrowLayer.faded`, `RegionPaint.faded`)
  without touching the display settings. The Harris panel also shows while the relation or
  sequence tool is in use on scars (`App.harrisAuto`; closing it then lasts until the tool changes).
* **Borders not judged yet** (`compute/adjacency.ts`): `scarBordersSteps` walks the triangle sides
  once (in slices) and collects the mesh edges whose two triangles lie in the regions of two
  different scars; pairs sharing less than twice the mean edge length are left out. The app
  reruns it after the regions are found again (it reuses the partition) and filters out the pairs
  with any relation on every change; `chainEdges` joins a pair's edges into polylines, which
  `render/borderLayer.ts` draws dashed (white core, dark outline) while the relation tool is in
  use. "Next pair" turns the camera to the shared edge nearest the middle of a border.
* `render/harris.ts` draws the matrix as SVG (shown in a floating viewport panel,
  `ui/floatingPanel.ts`: moved by its title bar, resized from its corner and folded, its place kept
  in the `harrisPanel` pref and fitted into the view; exported as is); `render/sequenceColor.ts` gives each sequence a hue and, in an ordered one,
  light (earliest) to dark (latest), used by the `sequence` colour mode for arrows and scar
  regions. Arrows and regions of a selected relation, or of the opened problems, are drawn
  highlighted (`ArrowLayer.setHighlight`, `App.emphasis`).

## Volumetric configuration

* **The box** comes from the pass that measures length, width and thickness
  (`frameMeasuresSteps` in `compute/measure.ts`: the vertices' min and max along the specimen
  frame's X, Y, Z, or the principal axes with Y the first, Z the third and X = Y × Z), in the app
  (`App.updateAuto`, again when the frame changes) and in the batch worker (`MeshMeasures.boxes`).
  It reaches the derived results through `MeshResults.box`; the principal orientation is never
  written to `specimen.frame`.
* **Two models** (`configuration.model`): the box (below) and the bicone. `compute/bicone.ts` is
  pure: `computeBicone` takes the base from the split curve (`biconeBase`: PCA plane oriented like
  the split, shoelace area and centroid) and the heights from the split's volumes (already swapped),
  puts each scar on a cone by its end, and gives the cones' roles (corrections by physical side), the
  flaking cones and the facial character; `biconePolar` maps points over the base (angle, and the
  share of the way to the projected curve) for drawing. `coreConfiguration` picks the model; the
  derived results, the batch (with the project's stored split; no box needed) and the app all use
  it. The picked face is a `ConfigPick` (a face of the box or a cone); a pick of the other model is
  let go. `App.configStatus` says why the bicone shows nothing (its split still being computed, an
  open mesh, no valid split). Choosing the bicone from the panel needs no visit to the volume panel:
  `soleEdgeCurve` names the curve when it goes without saying, else the panel asks (`edgeCurves`);
  `App.useEdgeCurve` applies `setBiconeSplit` (split and model in one `CompoundCommand`), with
  `defaultUpHint` (the side with more scars up; when even, toward the viewer), which the volume panel
  uses too.
* `compute/configuration.ts` is pure: `placeScar` (face by the averaged normal without its
  component along the arrow, platform = the adjacent face facing back along the arrow),
  `computeConfiguration` (which faces are flaking surfaces first, with the corrections, so that
  only their scars make platforms; then the roles, joins of adjacent flaking faces by a shared
  platform, flaking surfaces by union–find with `alsoPlatform`, the seven traits) and
  `storedBox` (the box a project file kept, for the batch). The thresholds are named constants and
  are written with the result. The app recomputes it (cheap) on every change of scars, corrections
  or box (`App.updateConfiguration`).
* **Corrections** are `ProjectState.configuration`, changed by `SetConfigurationCommand` through
  `setConfigRole`, `setConfigJoin`, `setConfigSurfaceType`, `setConfigAxis` (both written to every
  face of the surface), `resetConfigFace` and `setConfigPolarity`. They name faces of the current
  orientation, so `updateSpecimen` clears all but the polarity in the same `SetSpecimenCommand`
  when the frame changes (merged steps of fine turning keep the first "before"), and returns whether
  it did (the app then says so once).
* **The panel** is a floating viewport panel (`ui/floatingPanel.ts`, the Harris matrix's too;
  place and fold in the `configPanel` pref, never in the project file) holding the sidebar module's
  configuration content (`Sidebar.configEl`, refreshed with the sidebar; the principal-axes pill
  `Sidebar.configPill` sits in its title bar). The display setting `configuration` switches it and
  the view cube on (`App.configShown`: annotate mode, a model, a scar with an arrow);
  `App.updateConfigPanel` shows or hides both, and lets go of the picked face when hidden or folded.
  Short of room, the content gives way before the panel scrolls: the panel, its body and the content
  are nested flex columns in which the sketch's wrapper shrinks first (to about 100 px; the canvas
  fills it absolutely and `ConfigSketch.resize` follows, framing the bicone again), then the traits,
  which scroll on their own; the card never shrinks. Moved by hand, it
  is placed from its remembered position again whenever its content changes (`fitConfigPanel`), so it
  goes up as far as needed and comes back; the remembered position does not change.
* **The sketch** (`render/configSketch.ts`) is a small canvas of its own in the panel, drawn only
  when its content changes or it is turned: a transparent `RoundedBoxGeometry` (inside, then near
  side, neither writing depth), the edge midlines as fat lines and, on faces that are both, a band
  in the platform colour (`edgeBand`; `render/configShape.ts`, shared with the cube), and one arrow
  per scar with an arrow floating over its face with a soft shadow (`sketchArrows`: the ends scaled
  from the box into the sketch's box, kept on the face's flat part). The arrows are instanced
  meshes, one per part, face and whether the scars count; the selected scar's arrow is coloured per
  instance. A click within a few pixels of an arrow (in screen space) selects its scar, elsewhere on
  a face picks the face. Colours are the theme's `--cfg-*` tokens, read again when the theme changes.
  For the bicone (`render/biconeShape.ts`, shared with the cube) it draws two transparent lathes of
  a profile with rounded rim and apexes, the rim as two half circles turned to face the viewer at
  each draw (moved in place, no new buffers), and each scar's arrow bent along its cone: the line
  between its ends over the base, sampled, raised onto the cone and off it along the cone's normal,
  as one merged mesh (tube, tail, head) coloured by its vertices, with a shadow ribbon on the cone.
  It is framed by its outline as projected now, again on every turn (`frameOutline`, `fitOutline` in
  `render/biconeShape.ts`): the camera moves sideways and back, never turns, so the outline stays
  centred; as large as in the default view (about 85 % of the canvas wide), smaller only as far as it
  must be to stay inside. Another model starts from its default view. The sketch is drawn only when its content changes or it is turned, never
  because the main view turned (`ConfigSketch.renders`, checked in the end-to-end tests); when it was
  hidden meanwhile the sidebar asks for a draw on showing it (a size that changes and changes back
  within a frame reaches no `ResizeObserver`).
* **The view cube** (`render/viewCube.ts`) has no WebGL context of its own: after each frame of the
  main view (`Viewer.onAfterRender`) the main renderer clears a scissored corner viewport and draws
  the cube there, posed as the box's axes are seen by the camera. A board under the transparent
  canvas makes the panel; a transparent `.viewport-ui` element over it takes the clicks (picked in
  the cube's own viewport). Clicking a face of the cube or the sketch picks it
  (`App.selectConfigFace`) and turns the view to it with the six views' directions
  (`viewAxes` in `render/figure.ts`); meanwhile `syncAnnotations` fades the arrows on other faces.
  With the bicone the cube is a small opaque bicone posed by the base (`biconeAxes`), its outline
  (the rim's ellipse and the apexes) centred in each pose; the picked cone is outlined by a slightly
  larger copy closed by a cap and seen from inside, and a click on a cone turns the view along the
  base's normal from that side, the base's `reference` up.

## Flakes

`specimen.type` (`core`, `flake`) decides what a specimen shows: `App.isFlake` and the sections' `visible` choose
tools, panels and exports; nothing loads or goes when it changes. `setSpecimenType` is one `CompoundCommand` that also exchanges
`specimen.frame` with `flake.otherFrame`, so each type keeps its orientation and the core's corrections by face stay right
(`updateSpecimen` leaves them alone on a flake).

* **Technical axis** (`ProjectState.flake.axis`): the tool is a `DrawArrowTool` with options (the start goes to a mesh vertex as curve points do, `curveVertex`);
  the select tool drags its ends through `ToolContext.moveAxisEnd`. `ArrowLayer.axis` draws and handles it like a scar's arrow, in a colour of
  its own. `App.applyAxis` finds the frame on the mesh (`compute/technicalFrame.ts`, in slices), then `setTechnicalAxis` makes one step of the
  axis with its matrix, the `pop` landmark and `specimen.frame`. The matrix is stored with the axis, so undo, the CSV angle (`techAngleDeg`) and
  left and right of the platform ends (`platformSides`) need no mesh.
* **Sections**: `compute/meshSection.ts` cuts as `intersectPlane` does, and keeps the triangle of each stretch (`SectionLine.faces`), which says what
  is on the platform. It takes the triangles from `PlaneCandidates`: `render/bvhPlane.ts` hands them over from the BVH, tests and the batch do without.
* **Platform region**: `App.updatePlatformAuto` partitions along the outline alone (`smallerPieceSteps`: of the pieces the line touches); `upperComponents`
  takes the piece of the upper layer holding that point, unless a typed region is there. Scars drawn on the platform therefore do not cut it.
* **Measurements**: `compute/flake.ts` is pure. `morphDimensionsSteps` (`compute/convexHull.ts`; a point within 1e−4 of the set's size of the hull
  counts as inside, which also thins a smooth convex scan, and the result is settled on all the vertices) runs once per mesh; `flakeMeasuresSteps` takes
  the frame, the ends and the platform's triangles, and `platformProfile` does the section's part. `compute/regionPath.ts` is the path within a region.
  `App.updateFlake` reruns it, in slices and debounced, on changes of the axis, regions, landmarks, type or unit; the result goes to the sidebar, the
  panel and `derived.flake`. The summary export reads `derived.flake` from the project files, as it does the regions.
* **Profile panel** (`ui/profilePanel.ts`, a `floatingPanel`): SVG drawings of `FlakeResult.section` and of the cross-section, one scale for both;
  `App.moveProfile` cuts at most once a frame (`crossSectionAt`), `ringLayer` (a solid `BorderLayer`) shows it on the model. Its place and the
  position of the slider are view state, never in the file.

## Edge angles

`compute/edgeAngle.ts` is pure: `referenceCurve`, then per station a section (`sectionByPlane` with a `SectionReach`: the BVH, `render/bvhPlane.ts`, also prunes by the
sphere), A on it and the two ways along the line. `App.updateEdgeAngles` runs it in slices, per curve and only when the curve or the unit changed, and keeps the results
in `App.edgeResults`; they go to `derived.edgeAngles`, which the summary export reads as it does the regions. In the measure mode the selected curve is drawn by `render/edgeAngleLayer.ts` (`Line2`
with vertex colours, one hue, along the curve's own points by `valuesAlongCurve`: straight lines between stations would cut through the mesh; the curve layer then draws only its label, `drawnElsewhere`, since two lines at one depth fight) with a scale of two numbers (`#edge-legend`), and `ui/edgeAngleChart.ts` draws the angle along it in the section
of the edge angles.

## Retouch layers

`compute/retouchAngle.ts` is pure, and shares the stations with the edge angles (`stationPlan`). It takes the partition's piece of each triangle and the pieces in a layer: `SectionLine.faces` says which triangle each stretch of a section lies in, so a layer's ends come from the regions themselves, with no choice of curves to make. `App.updateRetouchAngles` runs after the regions are resolved, in slices, only for what changed (`partitionVersion` and the pieces are in the key), and only when there is a retouch region: the section there is the whole plane, not the sphere of the edge angles.

## Sharp edge

`compute/sharpEdge.ts` is pure, and needs no mesh: the stretches come from the stored stations and the rule, so the summary export can judge every model by the folder's rule. `ProjectState.sharpEdge` is a Command like any other; in a folder `App.keepFolderSharp` copies it to `LithicAnalyst/sharp-edge.json` (read-only folder: `App.folderSharp` for the session, and in the ZIP of projects), and `applyProject` puts the folder's rule into each project opened, without marking it as edited. `ui/edgeAngleChart.ts` takes its lines as `ChartSeries`, built by the sidebar: distances in categorical hues, retouch layers in one ordered hue with dashes.

## Geometric morphometrics

`compute/gm.ts` is pure: `gmSteps` takes the annotations (`state.gm`, the frame, the landmarks, the curves) and the mesh, in slices. `GmMesh.candidates` hands over the triangles a line may cross (`bvhRayCandidates`; without it, all of them). `gmMissingInputs` tells what is lacking without a mesh. The app holds the result in `App.gm`, keyed by what it was made from (`gmKey`), and draws the semilandmarks with `render/gmLayer.ts` when asked. The curves' ends are single points (`anchorAt`), as the landmark table's sets do with their end landmarks.

`state.gm` is a Command; in a folder `App.keepFolderGm` copies it to `LithicAnalyst/gm-config.json`, and each project opened takes the folder's. Points depend on the mesh, so a summary cannot judge them from stored results as it does the sharp edge: `App.gmOfFolder` takes those stored with this configuration, and opens the others' models in turn (as the figures of a folder do); `gmOutputs` writes the complete ones and lists the rest.

## Landmarks

* `ProjectState.landmarks` (export order) and `semilandmarks` (sets: curve, count, end
  landmarks) change together through `SetLandmarksCommand`, which keeps both lists and their
  counters before and after.
* `compute/landmarks.ts`: `sampleCurve` (equal arc length between the curve points nearest the
  end landmarks), `landmarkTable` (every point in export order and the geomorph sliders). The app
  recomputes the table whenever landmarks or curves change; `io/landmarks.ts` writes TPS, Slicer
  `.fcsv`, the long CSV and the sliders from it, so all exports share one numbering.
* `tools/landmarkTool.ts` places (snapping like curve points) and drags landmarks;
  `render/landmarkLayer.ts` draws them with their names, and the semilandmarks. Names carried
  over from the last specimen are kept in local preferences keyed by mesh checksum
  (`App.previousNames`); the queue itself is session state, not project data.

## Workspace and batch runs

* `io/workspace.ts`: a folder of models and project files, read with its subfolders (paths
  relative to the folder, `/`) — writable through the File System Access API
  (`showDirectoryPicker`, Chrome / Edge, not inside frames; `write` makes the folders on the
  way), otherwise read-only from a directory upload (`<input webkitdirectory>`). `classify` says
  what counts: models anywhere but in folders starting with "." and in `LithicAnalyst/`; project
  files in `LithicAnalyst/projects/` and, from earlier versions, any `.json` next to the models.
  `specimenIds` names the models (file name; path where names are shared), `timeStamp` /
  `freshFolder` name export folders that never overwrite one.
* The app's files go into `LithicAnalyst/`: the open model's project is written to
  `projects/<model path>.lithicanalyst.json` (debounced like the autosave); when a model opens,
  its project is the first of: this session's copy (read-only folder), the new place, the old
  place next to the model — the first made on this very model (checksum). The browser's autosave
  still wins when it holds later edits. In a read-only folder the edited projects are kept in
  memory (`App.sessionProjects`) and downloaded as one ZIP of `LithicAnalyst/projects/…`; until
  then, leaving the page or the folder asks first (`beforeunload`, `App.lossOnLeaving`).
* `io/projectIndex.ts`: the folder's project files by checksum, each file read once, the first
  time a summary export or a comparison needs them; files the app writes are put in as written.
* **Summary export** (`App.exportFolder`, the export dialog's "whole folder"): for each model,
  one at a time and in a try/catch of its own (failures are listed, the rest goes on), the
  checksum finds its projects in the index. When all of them were written by this version and
  stored their measurements (and the vertices' axes for planes: `derived.vertices`), those are
  used (`savedResultsUsable`); else the model is parsed and measured along each project's frame.
  Both go through `batchSpecimen`, so they give the same tables. Hashing, parsing, joining
  vertices and measuring run in the batch worker (`io/batchWorker.ts`, imported with
  `?worker&inline` into the single file; `io/meshJobs.ts` is the shared work, `io/meshMeasurer.ts`
  the client); where no worker can be made or it does not answer, the same jobs run on the page in
  slices. The open model uses what is on screen.
* **Figures for the whole folder** (`App.batchFigures`, "whole folder" in the figure section)
  open each model in the viewer, wait until regions and sections are computed (`App.settled`) and
  render the figure with the current settings. They need the page in front: a wake lock keeps the
  screen on where allowed, and the run pauses while the page is hidden (`App.whileHidden`); the
  remaining time leaves the pauses out.
* Every export with a folder open goes into a new `LithicAnalyst/exports/<time>/` or
  `figures/<time>/` (`App.exportSink`) with a `manifest.json` (and `failures.csv` when something
  failed); a read-only folder gets one ZIP of that layout instead.
* The folder panel lists the models (filter, a dot for "has a project" from the listing alone,
  only the rows in view made) and steps through them (PageUp / PageDown, Shift+PageDown: next not
  started).

## Compare mode

* Observers are the open project plus project files of the same mesh (SHA-256), read with
  `parseProjectFile`; they live in the app only (`App.observers`), never in a project file.
* Each observer's arrows, curves and landmarks are drawn by its own `ArrowLayer`, `CurveLayer`
  and `LandmarkLayer` (`fixedColor`; labels only for the open project); the open project's
  normal layers step aside meanwhile.
* The sidebar groups the long table by object and observer pair. A click on a row of arrows,
  curves, landmarks or semilandmarks calls `App.focusAgreement`, which finds the pair (or point)
  with the largest value of that metric and draws it selected in both observers' layers.
* `App.updateAgreement` gathers what needs the mesh — fitted planes, length / width / thickness
  along each observer's frame, and the region type of every triangle (`partitionFor` with the
  observer's curves, cached by curves and seeds) — and hands it to `compute/agreement.ts`:
  `assign` (Hungarian method with a distance limit), `cohenKappa`, `fleissKappa`, `icc21`,
  `curveDistance`, `compareObservers` (the long table) and `summarize`. It reruns, debounced,
  after any change while the mode is shown.

## Cortex sphere

`compute/sphere.ts` fits a sphere (algebraic start, Gauss–Newton on the geometric residuals,
relative to the centroid). The app refits whenever the regions or `ProjectState.nodule` (which
cortex regions are left out, whether the sphere is drawn) change, using the vertices of the
chosen cortex pieces, and keeps the result for `derived.nodule` and the measurement CSV.

## Volume split

`compute/split.ts`: `splitByPlaneSteps` sums signed tetrahedra from a point on the plane over the
triangles (clipped at the plane) on its upper side; `splitByLoopSteps` partitions along a closed
chain of mesh edges and sums each side from the chain's centre. In both, the cap closing each
part has zero volume relative to that reference point, so no cap is built. The app recomputes
when the split, the planes or the curves change; `split.swap` only exchanges the two
(`swappedSplit`), so swapping reuses the last result (`App.splitRaw`). Its result feeds the bicone.
Turning a curve into mesh edges (`polylineEdgesSteps`, for the split and the regions) runs in
slices too.

## Sections

A `Section` (display only) is the plane through a line drawn on screen and the eye
(`tools/sectionTool.ts`). The app cuts the model with it in slices (`App.cutModel`, shared with
the planes) and, in the present mode only, clips the mesh material to the kept side
(`SectionLayer.clipPlanes`); `render/sectionLayer.ts` draws the outline and the cut face (loops
nested and triangulated in the plane, solid or hatched). Figures render the views without
clipping and add the section drawings (`sectionLoops2D`) to the right of the views.

## Fitted planes

* A `Plane` stores only its inputs (method, completeness filter, curves, `upHint`);
  `compute/planes.ts` (`computePlane`) derives centre, normal and frame matrix from them. The
  app recomputes all planes on every change of scars, curves or planes (cheap), and stores the
  results under `derived.planes` when saving.
* The `all_vertices` plane and the plane frames use the vertex PCA computed with the other
  mesh measurements. Sections of the model by each plane (`intersectPlaneSteps`, using the
  edge table kept from that pass) run in slices and are cached per plane position.
* `render/planeLayer.ts` draws discs, sections and normals in the measure and present modes.

## Data model

* **Scars are objects of their own** (`ProjectState.scars`). The direction arrow is optional
  (`scar.vector`, `null` for a scar known only by its area); the arrow layer, the arrow CSV and
  the endpoint handles only see scars that have one (`hasVector`).
* **Derived results** (`core/derived.ts`) are computed from the annotations and recomputed when
  their inputs change. `serializeProject` writes the latest values under `derived` for external
  readers; `parseProjectFile` ignores them. Later features add their results there.
* **Orientation is metadata.** `specimen.frame` is a matrix from original to specimen
  coordinates; nothing transforms stored coordinates.
* The project file format and its migrations live in `core/schema.ts`
  (`docs/project-format.md`); format 1 files are converted when read.

## Data flow

```
pointer event ─▶ ToolController ─▶ active Tool ─▶ core/actions ─▶ Command ─▶ ProjectStore
                                                                              │
             ArrowLayer.sync ◀── App.onStoreChange ◀── store.subscribe ◀──────┘
             Sidebar.refresh  ◀─┘          └─▶ autosave (localStorage, keyed by mesh SHA-256)
```

## Opening and closing a model

* `io/loadMesh.ts` turns every format into an indexed mesh with shared vertices: STL and OBJ are
  welded from triangle soup (`weldExact`), and an indexed PLY is welded too (`weldIndexed`:
  vertices with bit-identical coordinates merged, in the order of their first occurrence, the
  first colour kept), since some writers give every face vertices of its own; triangles that
  become degenerate are dropped. A mesh without repeated vertices comes back unchanged. The
  checksum is taken over the file's bytes before any of this.
* `App.releaseMesh` lets go of the model and of everything drawn or computed for it (snapping,
  curvature, layers, partition, regions, borders, cuts, observers); `installMesh` calls it before
  a new model, `App.closeModel` (File ▸ Close) to end with none: it cancels the tool, finishes the
  pending saves, asks only when edits would be lost (`unsaved` in a read-only folder — edits since
  the project file was last downloaded —, or `autosaveFailed`), then releases the model, clears the
  view (`Viewer.clearMesh`), leaves the folder and resets the store (which clears the history).

## Performance notes

* Ray picking uses three-mesh-bvh; a 2-million-triangle scan loads in a few seconds and
  picking stays well under a millisecond per pointer move.
* Curvature is linear in mesh size. Smoothing (0–100 passes) keeps every 10th level as a
  checkpoint, so moving the slider only recomputes the passes since the nearest one.
* The BVH build reorders the index buffer in place, so `buildLoadedMesh` always works on
  its own copy.
* `npm run bench` (`scripts/bench.ts`) times the heavy steps on a generated core of about 2 million
  triangles, each with its total and its longest stretch between two yields: the measure pass, the
  box, the configuration, the volume split, the bicone, "Complete loop", a flake's frame, hull, sections and paths, and the edge angles along the edge. The longest stretch is what
  design principle 10 limits to about 100 ms.

## Hosting

The IBM Plex fonts (SIL OFL 1.1) come from `@fontsource`: `src/fonts.css` declares only the Latin
subset of the weights the interface uses, and the build inlines them, so the page requests
no font server. Chinese text uses the system fonts.

`npm run build` writes `dist/index.html` (complete page, works from `file://` and any static
host such as GitHub Pages) and `dist/artifact.html` (the same app without the document
skeleton, for hosts that wrap pages themselves). In the claude.ai artifact viewer plain
downloads are blocked, so `io/saveFile.ts` uses the viewer's `downloads` capability there
and falls back to a copy dialog.

## Tests

* `tests/` (vitest, `npm test`): `core/`, `compute/` and `io/` in Node, checked against known answers.
* `e2e/` (Playwright, `npm run e2e`): drives the built `dist/index.html` in Chromium (WebGL on
  SwiftShader when there is no GPU). Test models are generated by `e2e/fixtures/meshes.ts`; the
  tests read the project state and map model coordinates to screen positions through
  `window.lithicanalyst` (end of `ui/app.ts`). Add methods there when a new feature needs them.
  Software rendering spreads each browser over all the cores, so more workers only compete:
  `playwright.config.ts` fixes 2 locally and 1 on CI (the measurements are in a comment there). Tests
  wait for a state (`expect.poll`, an element appearing), never a fixed time.
