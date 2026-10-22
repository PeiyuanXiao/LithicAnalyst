# Architecture

LithicAnalyst is a static web application (TypeScript + three.js) that builds into one
self-contained HTML file. All processing happens in the browser; nothing is uploaded.

```
ui/       header, toolbar, sidebar, dialogs, shortcuts, two languages    (depends on everything below)
tools/    interaction tools: select, draw arrow, draw curve (one module each); surface snapping
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
* `render/curveLayer.ts` draws curves as screen-space lines (`Line2`) with a dark halo.

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
  (`Sidebar.displayEl`, mounted by `App.buildDisplayControl`); the sidebar's left edge resizes
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
  them instead of `title`.
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
* `tools/relationTool.ts`: two clicks on scars (an arrow, else the scar region under the click);
  `App.relationPopover` then offers the choices next to the second click, on the side that
  leaves both scars and the first click in view, and takes the keyboard while open (1 / 2 / 3,
  Delete, Esc). `render/harris.ts` draws the matrix as SVG (shown in a viewport panel that can be
  moved, resized and folded, its place kept in the `harrisPanel` pref and fitted into the view;
  exported as is); `render/sequenceColor.ts` gives each sequence a hue and, in an ordered one,
  light (earliest) to dark (latest), used by the `sequence` colour mode for arrows and scar
  regions. Arrows and regions of a selected relation, or of the opened problems, are drawn
  highlighted (`ArrowLayer.setHighlight`, `App.emphasis`).

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

* `io/workspace.ts`: a folder of models and project files — writable through the File System
  Access API (`showDirectoryPicker`, Chrome / Edge, not inside frames), otherwise read-only from
  a directory upload (`<input webkitdirectory>`); only the files at the top of the folder count.
* The open model's project is written next to it (`<model>.lithicanalyst.json`, debounced like
  the autosave) and read back when the model is opened again; the browser's autosave still
  wins when it holds later edits of the same project.
* Batch measurements (`App.batchMeasure`) read, measure and drop one model at a time without
  the viewer (`centredMesh`, `surfaceMeasuresSteps`), take each model's project files by
  checksum, and merge the per-specimen CSVs by kind (`io/batch.ts`); with two or more
  observers per model it adds ICC(2,1) per measure. Batch figures open each model in the viewer,
  wait until regions and sections are computed (`App.settled`) and render the figure with the
  current settings. Results go into the folder, or are downloaded from a read-only one.

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
when the split, the planes or the curves change.

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

## Performance notes

* Ray picking uses three-mesh-bvh; a 2-million-triangle scan loads in a few seconds and
  picking stays well under a millisecond per pointer move.
* Curvature is linear in mesh size. Smoothing (0–100 passes) keeps every 10th level as a
  checkpoint, so moving the slider only recomputes the passes since the nearest one.
* The BVH build reorders the index buffer in place, so `buildLoadedMesh` always works on
  its own copy.

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
