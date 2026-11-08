# Architecture

LithicAnalyst is a static web application (TypeScript + three.js) that builds into one
self-contained HTML file. All processing happens in the browser; nothing is uploaded.

```
ui/       header, toolbar, sidebar, dialogs, help (about, shortcuts), languages (depends on everything below)
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
6. **Interface text lives in `ui/strings.ts`** (the labels of fields and options in
   `core/fields.ts`) with English and Chinese for every key; a further language has a property of
   its own where it is translated, and English stands in where it is not (`t`, `tl`). Keep the
   interface lean: labels and controls, no explanatory paragraphs. The texts go to a spreadsheet
   and back with `npm run i18n` (see "Interface text" below).

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
  pulls a traced chain taut along the surface while holding feature points. Curve points snap with
  `snapToFeature`, which climbs along a feature to its most pronounced place; things that are points (the
  technical axis's start, fixed landmarks) with `snapToFeaturePoint`, which keeps abreast of the press: it takes
  the feature from `snapToFeature`, then the nearest vertex of its band, then goes uphill across it only.
* `tools/surfaceSnap.ts` ties these to one loaded mesh: adjacency and curvature come from the
  `CurvatureService` at the shading scale (what you see is what snaps), closest points from the BVH.
* `tools/drawCurveTool.ts` places points and shows the live stretch; `tools/selectTool.ts`
  drags curve points and retraces the two neighbouring stretches. It drags landmarks as well: a platform end along the outline (`ToolContext.onPlatformOutline`),
  the others to what `landmarkTarget` in `tools/landmarkTool.ts` finds; not `pop`, which goes with the technical axis.
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
retouch, present, compare; retouch only on a flake). A mode owns its tools and sidebar sections:
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
  used are hidden (`Section.visible`); without a model each section the mode would show is a grey
  title that does not open (`.panel-ghost`, by `Section.ofType` with `AppApi.moduleType()` where the
  type decides, else by `visible` on the empty project), and the folder's list while a folder is
  open. The data exports
  of a mode are one dialog (`App.openExport`, files from `App.exportables`; several files go
  into a stored ZIP, `io/zip.ts`).
* **Top bar**: the specimen button (ID and unit; its panel holds ID, unit, annotator, notes and
  the model file); the mode switch in the middle; the File menu, Save, undo and redo, the
  language menu (`LANGS` in `ui/i18n.ts`), the theme switch and Help (see About and credit). Where its words do not
  fit (a language with longer ones, a long specimen name), `fitTopbar` takes the narrow window's steps
  in turn, measured afresh whenever a part of the bar changes size: `.is-tight` (the modes' icons
  only), then `.is-tighter` (the header buttons' icons only). A change of language also redraws the
  view's labels (`App.rebuildChrome` → `syncAnnotations`). Menus and small
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
  the view. `App.updateCursor` puts the active tool in `data-tool` on the viewport: under the tools that place
  things on the model, the style sheet takes `pointer-events` from the labels, so a click reaches the model.

## Start page

`ui/startPage.ts` builds `#start-page`, once: a child of `.app` over everything (fixed, below the dialogs, the toasts and the tooltips); a change of language or theme only repaints its words and its icon (`StartPage.paint`), so the entrance, the focus and the drop outline stay. It is shown until a card is pressed or a model or a folder opens (`App.startShown`; `App.entered` is view state, never in the file). While it is shown the top bar is hidden, `main` is inert and the app's keys are off, so a card's Enter and Space are its own; the view stays under it at its size, so nothing has to be set up again when a model opens, and the WebGL canvas is never 0×0. The cards write the `specimenType` preference, which `App.newSpecimenType` reads for a new model and which the specimen panel also writes; the state's own type changes only with a model, and a project applied later (`applyProject`) brings its own. While it is shown the drop outline (`dropEl`) and the busy overlay (`openMeshFile`) go on it, since what is under it cannot be seen. `App.buildEmptyView` fills `#viewport-empty`, the ways to open something in the middle of the view, shown in the workspace with no model and no folder. The mode switch is hidden with no model (`updateMeshDependentUi`); `.top-actions` holds the grid's last column, so it stays put. `App.closeModel` clears `entered`, with or without a model.

* **Motion.** The page's styles come from `design/brand-22a/startpage-reference.html`, with its own palette on `.start-page`. The entrance's animations apply under `.is-entering`, which `StartPage.leave` takes off for good, so the base state is the end state and there is nothing to undo; the rings' turning and the cards' hover states are apart from it. The rules that stop all motion under `prefers-reduced-motion` cover it.
* **The focus.** A card pressed or reached by keyboard looks the same (`:is(:hover, … :focus-visible)`). A browser counts the focus a script gives on opening as visible, which would light the last card with nothing done, so `.quiet-focus` holds that back until the first Tab.
* **The brand.** `src/assets/brand/` holds the drawings, inlined with `?raw` (`ui/brand.ts`). Each copy goes through `brandSvg`, which makes the placeholder `LAID` of its ids and `url(#…)` a prefix of its own (`brandEl`, `brandInner` for an icon placed in a card's disc). The wordmark and the ghost words are outlines from `scripts/gen-wordmark.py`, which is run by hand and whose output is committed: `.start-wm` and `.start-ghost` give them the box of the line of text they replace (in em, from what the script prints), so the layout is that of the text. `vite.config.ts` puts the small logo into the page's head as a data URI, in a fixed ink, which is why the icon needs no script.

## Annotation status

`core/annotationStatus.ts` is pure: `annotationStatus(state, found)` gives the items of the specimen's type, done or not, and the count without the optional ones. All go by the project but the faces, whose regions come as soon as there are an axis and an edge: those take `found`, the regions as found on the mesh (`area` null: no piece, so the two are not apart, `notApart`). The open model hands in `App.regions`; the folder's list (`App.workspaceInfo().completion`) the states and `derived.regions` in `ProjectIndex`, read in the background when the folder opens, with no model; a file that stored none goes by the regions being there. The edge counts when its ends reach a closed platform outline (`platformEndsOf`, kept per state of the list: `notMeeting` otherwise, and the pill selects that edge). `App.updateStatus` runs after each store change and redraws the pills (`#annotation-status`, `.viewport-ui`) only when the key changes; a change of the count also refreshes the folder's list. `App.goToStatus` is the click. `App.nextCurveType` is view state: `ToolContext.takeNextCurveType` hands it to `DrawCurveTool.finish`, which calls `addCurveOfType`: one `CompoundCommand` with what `setCurveType` would do (`typeChanges`: the outline it replaces, the regions that follow). Changing tool drops it. `App.fitStatus` follows the view's width by a `ResizeObserver` (`STATUS_COLLAPSE_PX`); a click on the count opens or closes the pills unless the pointer already holds them open.

## Generic specimens

The type is one code in `SPECIMEN_TYPES`, and what it means is said where each thing is decided:

* `core/fields.ts`: `offeredOptions` leaves a field that takes free text with nothing else, so `keyedOptions` gives `['custom']`, and `customValue` keeps what was typed; `isUpperRegion(type, specimen)` and `isBoundaryCurve` say there is no upper layer, `layerCurves` that the lower layer is cut by all the curves. `isCustomValue` knows nothing of the type: a preset code from another type keeps its label and is shown, not offered (`customField`), as older codes are.
* `hasEdgeAngles` and `hasVolumeSplit` (`core/fields.ts`) say what belongs to which type: edge angles and working edges to a flake, the split to a core. `measuresEdgeAngle` is false on any other type, so nothing downstream runs on them; `App.updateSplit` gives null there and `App.workingEdgeDetails` none. Their data stay in the state and the file (`edgeAngle` on a curve, `workingEdges`, `sharpEdge`, `split`), and come back with the type. `batchSpecimen` leaves out what a file stored under another type, so the tables say the same as the open model.
* `core/actions.ts`: `isScarRegion` keeps "scar" a word, with no scar made; `setSpecimenType` moves frames only across `flake`, so `core` and `generic` share one, and `updateSpecimen` clears a core's corrections by face whichever of the two turned it.
* `App.isCore`, `isGeneric` and the sections' `visible` choose tools, panels and exports (`App.exportables`, `batchOutputs`, whose kinds may name who they are for). `compute/planes.ts` holds `planeMethodsOf`. `arrowColorModeOf` falls back to one colour without changing the user's display setting, which comes back with the type. `App.inLowerLayer` keeps out the regions with `auto: true` that a flake left, which on a core go by being upper.

Nothing else needs to know the type: flake-only code already stops at `isFlake`. No field definition file: that was the removed "recording scheme".

## Shell: theme, icons, tooltips, numbers

* **Theme** (`ui/theme.ts`): `<html data-theme="light|dark">` picks one of the two sets of colour
  variables in `styles.css`; the choice is kept in `localStorage` (`lithicanalyst:theme`), else the
  system's `prefers-color-scheme` is followed. An inline script in `index.html` (kept in
  `artifact.html` by `scripts/make-artifact.mjs`) sets it before the first frame. The WebGL canvas
  is cleared transparent: the view's background is the container's CSS gradient
  (`--viewport-bg-top` → `--viewport-bg-bottom`), so it follows the theme without touching the
  renderer. Figures render into their own transparent targets and are unaffected. Both theme
  buttons call `toggleThemeFrom(button)`: in a view transition, `setTheme` in its update (the app's
  listener draws a frame at once, `Viewer.renderNow`), then a `clip-path` circle on
  `::view-transition-new(root)` from the button's middle to the farthest corner (`THEME_SWITCH`);
  `::view-transition` lets the pointer through, a second press skips the first. Without view
  transitions, or with reduced motion, `setTheme` at once. No element has a `view-transition-name`.
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
* **Motion**: see "Look and motion" below; `prefers-reduced-motion` turns every animation and
  transition off (also the camera transitions and the view's tweens below).

## Look and motion

The rules: flat fills, no gradients (but the 3D view's vertical one); corners of 4 px for cards and
buttons and 6 px for large panels and dialogs, capsules fully round; solid amber only for the current
mode and each panel's one main action, a selection pale amber with an amber outline. Interface
animations take 120–200 ms, overlays and panels at most 300 ms, all with `cubic-bezier(.2,.7,.2,1)`;
motion never blocks input or delays an action, and stops while the view is dragged; nothing loops in
the workspace but loading, and the 3D view asks for frames only while a tween runs; with
`prefers-reduced-motion: reduce` everything is shown as it ends. How they are kept:

* **Colours and corners** (`styles.css`): flat fills; `--radius` (4px: cards, buttons) and `--radius-lg`
  (6px: large panels, dialogs), capsules 999px. The sidebar is cards (`--card`) on a ground of its own
  (`--sidebar-bg`); lists in a card have no frame, their rows a soft line between them. Every panel over
  the view is one card (`--surface-pop`, a `--line` border, `--shadow`). Solid amber is the mode's
  block and a panel's one main action; what is selected is `--accent-soft` with an `--accent-line`;
  check boxes and slider thumbs are ink. `--ease` is the one easing.
* **Unsaved changes** (`core/commands.ts`): each state the history can return to has a number
  (`stateId`; a merge makes a new one), `markSaved(id)` records the one saved and `dirty` compares; so
  undoing back to what was saved is clean again. `clear` (a model or project opened) is clean. The app
  marks the state captured before a save once the save has gone through (Save, the folder's copy) and
  shows a dot on Save (`data-dirty`). `lastStep` says whether the last change was a command, an undo or
  redo, or a fresh start: only the first makes things flash (`App.userChanged`).
* **CSS motion**: cards open by `::details-content` with `interpolate-size` (`folding` keeps their
  content cut while they move); the mode's block (`.mode-thumb`, placed by `buildModeSwitch`, at once
  when it first shows or changes size); popovers, float panels and the display panel come in by
  `@starting-style` and leave by a `display` transition with `allow-discrete`; panels and dialogs
  grow from what opened them (`ui/motion.ts`: `growFrom`, `growWhenShown` sets the transform-origin
  from the focused button); the sidebar's cards come in on a change of mode (`Sidebar.enter`); a
  dialog answers at once and only fades. A status pill made done by the user ticks itself
  (`statusDone`); a measure's value changed by the user flashes (`valueFlash`, only while its list is
  in sight). Toasts stand over the coordinate reading of the view (`Feedback.anchor`); the busy
  overlay turns the logo (`fx-*` parts on a 1.5 s round of their own) only after `BUSY_LOGO_AFTER_MS`.
* **The view's tweens** (`render/viewer.ts`, `render/easing.ts`): `Viewer.tween(ms, step)` draws a
  frame every frame only while one runs, then rendering is on demand again; a press on the view and a
  figure (`makeFigure`) finish them (`finishTweens`), reduced motion gives the end at once. Only what
  the user does by hand starts one: a landmark placed (`LandmarkLayer.pop`, `EASE_POP`) and a
  measure's drawing coming into view (`HintLayer.show` with `fadeIn`). A drawn arrow is there whole
  at once. Loading, undo, redo, generated and imported annotations draw at once.

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

### How a measure was taken

A row of a measure in the measure mode shows on the model how it was taken. What is drawn is only what the measuring functions returned, so what is drawn is what was computed: they return the numbers and their construction together (`MorphDimensions.construction`, `TechDimensions.construction`, `FlakeResult.construction` in original coordinates, `FrameMeasures.box`, `SplitResult.parts`, the stations of `EdgeAngleResult`, `SharpResult.mask`, `SphereFit`). None of this is stored: `swappedSplit` hands on the volumes alone, and `computeDerived` picks what it stores from a `FlakeResult`.

* `compute/measureHint.ts` (pure) turns those into a `MeasureHint`: lines, dots, arcs and pieces of surface, each `current` (the measure of the row) or `other` (the rest of the drawing). An arc carries its vertex and its two directions, so the tests can read the angle back. An empty value gives null. `MEASURE_HINT_PARAMETERS` holds the delay and the shares that size arcs and such.
* `render/hintLayer.ts` draws one in the overlay (so figures leave it out): `Line2` lines of a constant width on the screen, point sprites, CSS labels that let the pointer through, all without a depth test and over everything else. Pieces of surface share the mesh's vertex buffer; the platform shows through the model, a whole model or a split's two sides are tinted where they are seen (seen through, they would only add up to a blur).
* `App`: `hoverHint` (after `HOVER_MS`), `focusHint` (the keyboard's, `:focus-visible`), `pinHint`; the first of hover, focus and pinned is drawn (`syncHint`, from `hintOf`, which goes by the key `group:item` the row has in `data-hint`). `refreshHint` runs when what it draws from changes; `clearHints` on another mode, specimen or type. `hintMuted` keeps a row just let go from coming straight back under the pointer. A curve's row of edge angles has no pin: a click selects the curve, as ever.
* `ui/sidebar.ts`: `hintRow` marks the cells of a row, `watchHints` listens on the list (rows are made anew on every refresh, so `rebuildHints` keeps the focus and `App.paintHintRows` the marks). The automatic measures are in groups (`measureGroup`; a flake's: technical axis, morphology, platform, whole; a core's and a generic specimen's: dimensions, whole); platform width and depth and the EPA are small tables (`measureTable`), each cell a measure of its own with its key and its focus. The export order is the order on screen.

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
* `App.curveChains` joins open curves to others they stop just short of (`joinOpenEndsSteps`), or the two sides would run together through the gap. An end of a boundary curve goes to another boundary curve when one is within reach, whatever lies nearer, or the upper layer would stay open; with none in reach it goes to what is, for the lower layer. Each chain keeps its links, and the lower layer takes them all, so it still holds all that the upper does.
* **Two layers**: the type says the layer (`isUpperRegion`). `App.updatePartition` cuts twice: the lower layer along all the curves' mesh edges,
  the upper along those of the boundary curves (`isBoundaryCurve`, by the specimen's type), kept while they do not change. Since one set of edges holds
  the other, each lower piece lies in one upper piece (`overPiecesSteps`), so a lower region has one parent. `App.seedComponent` and
  `App.upperComponent` hold the piece of each region in its own layer, −1 in the other; `resolveRegions` takes the upper layer as `UpperLayer`. A second, fainter
  `RegionLayer` paints the upper layer under the lower one (both under `regionRoot`, which figures show or hide). A click with the region
  tool on a part not divided further selects the part itself.
* Regions with `auto: true` are made and removed in the commands that complete or break their inputs (`autoRegionChanges`); their pieces are
  derived (`upperComponents`, `flakeFacePieces`, `outlineSeed`), so undo cannot set off a new command.
* A flake's retouch curve reaching the edge (`compute/retouchBand.ts`: `autoRetouchCurves`) has such a region too, with `curveId`. `App.updatePartition` finds each curve's side
  (`bandsOf`: the surface cut along the boundary curves and this one, the smaller side or `retouchSide`), and the pieces of the lower layer in it. `applyBands` runs when the regions are resolved,
  since it asks which pieces a region typed by hand holds (`taken`): `assignBands` gives each piece to the smallest band it lies in and `mergePieces` makes each band one piece of `App.partition`,
  so the paint, the areas, the retouch stations and the exports all see one piece, and a scar's outline across a band does not undercount the retouch. `rawLower` keeps the partition as cut.
  The compare mode does the same for each observer (`observerFaces`). The curve's `retouchSide` is the file's record of a band given up (`off`, by `bandGivenUp`) or flipped (`larger`, `otherRetouchSide`);
  `withRetouchCurvesKept` marks the curves of an older file `off` as it opens, so it gains none.
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
  in the `harrisPanel` pref and fitted into the view). One drawing, two palettes: the panel uses
  `HARRIS_SCREEN` (the shell's variables, so it follows the theme, with the selected scar in pale
  amber and an amber line), the exported file `HARRIS_PRINT` (fixed colours, clear ground); `render/sequenceColor.ts` gives each sequence a hue and, in an ordered one,
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

`specimen.type` (`core`, `flake`, `generic`) decides what a specimen shows: `App.isFlake` and the sections' `visible` choose
tools, panels and exports; nothing loads or goes when it changes. `setSpecimenType` is one `CompoundCommand` that also exchanges
`specimen.frame` with `flake.otherFrame`, so a flake and the others each keep their orientation and the core's corrections by face stay right
(`updateSpecimen` leaves them alone on a flake).

* **Technical axis** (`ProjectState.flake.axis`): the tool is a `DrawArrowTool` with options (the start goes to a mesh vertex by `pointVertex`, as it does when the select tool drags it);
  the select tool drags its ends through `ToolContext.moveAxisEnd`. `ArrowLayer.axis` draws and handles it like a scar's arrow, in a colour of
  its own. `App.applyAxis` finds the frame on the mesh (`compute/technicalFrame.ts`, in slices), then `setTechnicalAxis` makes one step of the
  axis with its matrix, the `pop` landmark and `specimen.frame`. The matrix is stored with the axis, so undo, the CSV angle (`techAngleDeg`) and
  left and right of the platform ends (`platformSides`) need no mesh.
* **Platform ends**: landmarks with a `code`, so the exports, the measurements and GM read them as ever. `platformEndsOf(curves)` (`compute/measuredLine.ts`, pure, no unit or mesh) says where the edge meets the outline. `syncPlatformEnds` keeps those with `auto: true` there, by id; the commands that change what they follow (`typeChanges`, `deleteCurve`, `reshapeCurve`, `setSpecimenType` to a flake) add it to their step through `endChanges`, as they do the regions that follow (`autoRegionChanges`), and `applyProject` calls `withPlatformEnds` for files from before. `moveLandmark` takes the mark off; `deleteLandmark` on an end moved by hand puts it back and places it again. There is no tool: the select tool moves them (`ToolContext.onPlatformOutline`), as the landmark tool does.
* **Sections**: `compute/meshSection.ts` cuts as `intersectPlane` does, and keeps the triangle of each stretch (`SectionLine.faces`), which says what
  is on the platform. It takes the triangles from `PlaneCandidates`: `render/bvhPlane.ts` hands them over from the BVH, tests and the batch do without.
* **Platform region**: `App.updatePlatformAuto` partitions along the outline alone (`smallerPieceSteps`: of the pieces the line touches); `upperComponents`
  takes the piece of the upper layer holding that point, unless a typed region is there. Scars drawn on the platform therefore do not cut it.
* **Measurements**: `compute/flake.ts` is pure. `morphDimensionsSteps` (`compute/convexHull.ts`; a point within 1e−4 of the set's size of the hull
  counts as inside, which also thins a smooth convex scan, and the result is settled on all the vertices) runs once per mesh; `flakeMeasuresSteps` takes
  the frame, the ends and the platform's triangles, and `platformProfile` does the section's part. `FlakeResult.reasons` says why each empty measure is empty (`FLAKE_EMPTY_REASONS`, the first that holds): the sidebar shows it over the "—"; it goes neither into the file nor into the tables. `compute/regionPath.ts` is the path within a region.
  `App.updateFlake` reruns it, in slices and debounced, on changes of the axis, regions, landmarks, type or unit; the result goes to the sidebar, the
  panel and `derived.flake`. The summary export reads `derived.flake` from the project files, as it does the regions.
* **Profile panel** (`ui/profilePanel.ts`, a `floatingPanel`): SVG drawings of `FlakeResult.section` and of the cross-section, one scale for both;
  `App.moveProfile` cuts at most once a frame (`crossSectionAt`), `ringLayer` (a solid `BorderLayer`) shows it on the model. Its place and the
  position of the slider are view state, never in the file.

## Edge angles

A flake's (`hasEdgeAngles`). `compute/edgeAngle.ts` is pure: `referenceCurve`, then per station a section (`sectionByPlane` with a `SectionReach`: the BVH, `render/bvhPlane.ts`, also prunes by the
sphere), A on it and the two ways along the line. `App.updateEdgeAngles` runs it in slices, per curve and only when the curve or the unit changed, and keeps the results
in `App.edgeResults`; they go to `derived.edgeAngles`, which the summary export reads as it does the regions. In the measure mode the selected curve is drawn by `render/edgeAngleLayer.ts` (`Line2`
with vertex colours, one hue, along the curve's own points by `valuesAlongCurve`: straight lines between stations would cut through the mesh; the curve layer then draws only its label, `drawnElsewhere`, since two lines at one depth fight) with a scale of two numbers (`#edge-legend`), and `ui/edgeAngleChart.ts` draws the angle along it in the section
of the edge angles.

**The line measured** (`compute/measuredLine.ts`, pure): `measuredLine(curve, state)` is what a curve is measured along: a flake's edge without what runs along the closed platform outline, any other curve as it is. It needs the state alone, no mesh, so the app, the tables and the summary export all get the same line, and it is kept per `points` array (curves change by being replaced). Everything that measures goes through it: the stations (`updateEdgeAngles`, `updateRetouchAngles`, `sectionAtStation`), `sharpOf`, the working edges (`edgeAxis`, `edgeLabels`, the actions and the layer), the colours along the curve. What cuts the regions or draws the curve itself reads the curve. `App.lineOf` is the shorthand. GM goes on cutting the edge at the platform ends itself (`edgeLine`).

## Retouch layers

`compute/retouchAngle.ts` is pure, and shares the stations with the edge angles (`stationPlan`). It takes the partition's piece of each triangle and the pieces in a layer: `SectionLine.faces` says which triangle each stretch of a section lies in, so a layer's ends come from the regions themselves, with no choice of curves to make. `App.updateRetouchAngles` runs after the regions are resolved, in slices, only for what changed (`partitionVersion` and the pieces are in the key), and only when there is a retouch region: the section there is the whole plane, not the sphere of the edge angles.

## Retouch indices

`compute/retouchIndex.ts` is pure and takes no mesh edges or regions as such: `faceOf` says which part of the flake each triangle lies in, `pieceOfFace` and `pieces` which are in a retouch layer, so tests hand them over triangle by triangle. `compute/retouchAngle.ts` keeps what it cut: `retouchSectionsSteps` returns, beside the angles, each retouched station's two ways along the section (`StationSection`: polyline, triangle of each stretch, arc lengths) and the layers along them. These stay in memory, in `App.retouchResults`, and never reach the file, so a change of the fitted length refits without cutting the mesh again. `App.updateRetouchIndices` runs after the retouch layers (`updateRetouchAngles` schedules it) and on changes of the flake's data or the specimen, in slices and keyed by all it reads; the frame of the plan and its outline (`segmentFrameSteps`, `segmentOutlineSteps`, each a pass over the mesh) and the triangles' parts (`faceOfTrianglesSteps`) are kept while their own inputs stay. `RetouchIndexResult` holds what is stored (`indices`), and what is only for the screen: `reasons`, and `details`, per station, with the reason and the fit. The settings are `flake.retouch`, changed by `setRetouchFitLength`, `setRetouchAxis` and `setRetouchFlip`; in the state the key is absent while they are the default (`retouchSettingsOf`), a file always has it. The summary export reads `derived.retouchIndices`, as it does the retouch layers.

## The retouch mode

`App.retouching` is the mode on a flake with a model. Annotating stays in the annotate mode; here one tool, `tools/stationTool.ts`, always on with no button or key, moves the current station (`App.retouchStation`: a curve and a station number, view state, never in the file), which goes by itself to the largest missing area until the user moves it (`stationAuto`). `App.syncStation` runs at most once a frame (`queueStation`) and tells everything that shows the station: the section's line and the mark on the model, the section panel, the plan's mark (moved, not drawn again), the chart's line (`sidebar.refresh('station')`). A station with no layer keeps no section, so its section is cut when asked for (`sectionAtStation`, one cached).

* **One drawing** (`render/retouchDrawing.ts`, no DOM): `sectionModel` lays a station's section out on the page's plane; `sectionDrawing` and `planDrawing` turn that and the plan into a list of primitives in a palette. The panels (`ui/retouchPanels.ts`) write them as SVG in `SCREEN_PALETTE` (the shell's variables, so the theme follows); an export takes the same primitives in `PRINT_PALETTE` to scale (`svgFile`, in mm), and `drawingPng` rasterises that SVG, or calls `drawPrims` on a canvas where the browser will not hand back one an SVG was drawn on.
* **The plan** (`compute/retouchPlan.ts`, pure): `planShape` from the outline's cells; `planRegionsSteps` projects the borders of the retouch regions, not their triangles, so the drawing stays small on any scan. `segmentLinesSteps` gives the same lines on the model as level lines of a field over the vertices (`isoLines`), kept while the frame stays. `penetrationAt` runs on across the rows, so the line between the zones is one level line and closes by itself: on the model over the vertices, on the plan over a grid of the outline's cells (`levelRings`). `drawnOutline` closes notches of three cells or less for drawing only: a cell holds the furthest vertex that falls into it, so with rim vertices further apart than the cells the raw outline is a saw. The indices use the raw cells.
* **The fitted length**: dragging its slider sets `App.fitPreview`, which `updateRetouchIndices` takes in place of the stored value, so the panels and the numbers follow with nothing written; letting go is one `setRetouchFitLength`. `removedVolumeCurveSteps` runs the stations' pass at each length of the small curve, again only when `retouchFitKey` (all the inputs but the length) changed.
* **The chart**: `ui/edgeAngleChart.ts` takes an id prefix, a cursor and a press; the measure mode's shows distances, this mode's the layers, each with its own method and series (`edgeMethod`, `retouchMethod`). `syncEdgeColors` colours the selected curve in the measure mode and the station's curve here.

## Working edges

`ProjectState.workingEdges` holds stretches of the curves measured, as two points each; `compute/workingEdge.ts` (pure) places them on the curve's reference line whenever they are used (`edgeAxis`, `placedEdges`), so a curve that changes takes them along with no change to the data. Every change is one `SetWorkingEdgesCommand` (the list and its counter), through `addWorkingEdge`, `updateWorkingEdge`, `otherWorkingEdgeStretch`, `deleteWorkingEdge` and `generateWorkingEdges`, which check them first (`refusalOf`, by label when it overlaps); `deleteCurve` and a replaced platform outline take theirs in the same step.

Nothing is cut or fitted again for them: `workingEdgeDetails` shares out what the stations already have (`stationWeights`, `ownerAt`). It needs the edge angles' stations and a finished `RetouchIndexResult`, and is cheap, so `App.workingEdgeDetails` keeps it until a store change or a new result clears it. `derived.workingEdges` holds its rows; the screen also takes the reasons, the chord on the plan and the station to go to, which are not stored. The per-station columns of the tables are worked out when they are written (`edgeLabels`, from the state alone), so a summary reads the same from stored results as the open model does; `working_edges.csv` judges `sharp_length` anew for the folder's rule, as `edge_sharp.csv` does (`sharpPieces`).

`tools/workingEdgeTool.ts` takes two clicks on a curve measured (`App.edgePlaceAt`: `CurveLayer.pickAmong`; near an end of another edge, that very point, so the two share it). The select tool drags ends through `ToolContext.edgeEnds`; `clampedEnd` keeps the end from passing its neighbour's (it stops on that point) or coming too close to its own other end. `render/workingEdgeLayer.ts` draws a band in the annotate mode and ticks in the measure and retouch modes, with the labels, and holds the handles. In the charts `EdgeAngleChart` takes `edges` (the strip over the axis) and `view` (one stretch, which may run on past the curve's start: `along`, `onAxis`); the choice is `edgeChoice` in the sidebar, view state of each chart. The row picked in the table of the indices (`App.planEdgeId`) puts that edge and its own chord on the plan (`PlanOptions.edge`).

## Sharp edge

`compute/sharpEdge.ts` is pure, and needs no mesh: the stretches come from the stored stations and the rule, so the summary export can judge every model by the folder's rule. `ProjectState.sharpEdge` is a Command like any other; in a folder `App.keepFolderSharp` copies it to `LithicAnalyst/sharp-edge.json` (read-only folder: `App.folderSharp` for the session, and in the ZIP of projects), and `applyProject` puts the folder's rule into each project opened, without marking it as edited. `ui/edgeAngleChart.ts` takes its lines as `ChartSeries`, built by the sidebar: distances in categorical hues, retouch layers in one ordered hue with dashes.

## Geometric morphometrics

`compute/gm.ts` is pure: `gmSteps` takes the annotations (`state.gm`, the frame, the landmarks, the curves) and the mesh, in slices. `GmMesh.candidates` hands over the triangles a line may cross (`bvhRayCandidates`; without it, all of them). `gmMissingInputs` tells what is lacking without a mesh. The app holds the result in `App.gm`, keyed by what it was made from (`gmKey`), and draws the semilandmarks with `render/gmLayer.ts` when asked. The curves' ends are single points (`anchorAt`), as the landmark table's sets do with their end landmarks.

`state.gm` is a Command; in a folder `App.keepFolderGm` copies it to `LithicAnalyst/gm-config.json`, and each project opened takes the folder's. Points depend on the mesh, so a summary cannot judge them from stored results as it does the sharp edge: `App.gmOfFolder` takes those stored with this configuration, and opens the others' models in turn (as the figures of a folder do); `gmOutputs` writes the complete ones and lists the rest.

**By a template** (`gmOfListsSteps` for a core or a general specimen, the end of `gmSteps` for a flake; both call `templatePointsSteps`):

* `compute/gmTemplate.ts` (pure): `layPatchSteps` lays a region's points; `gmInUse`, `usesTemplate`, `gmConfigSummary` (the configuration without the points, as results and manifests hold it), `gmManifest`, `gmCacheKey`, and the anchors' and regions' hashes.
* `compute/tps.ts` (pure): `similarityFit`, `tpsFitSteps`, `anchorWarpSteps`. The system is solved directly: `M = −ΠKΠ + cUUᵀ` on the space across the affine part (`Π` the projection across it, `U` its basis), by a Cholesky in blocks of columns with four dot products at a time, which takes half the time of the plain one and keeps 2000 anchors under a second (`scripts/bench.ts`, 11a, 11b). Conjugate gradients were tried: on anchors spread over a surface they took 80 to 200 iterations, slower than this.
* `compute/triangleBvh.ts` (pure, no three.js): an AABB tree over some of a mesh's triangles, for the nearest point. `GmRegionSource.find(type)` gives a region's triangles and its tree on demand; `App.gmRegions` keeps the trees while the pieces stay the same.
* `compute/projectRegions.ts` (pure): where a project's regions lie on a mesh, from its curves and seeds alone: `projectLayersSteps` is what `App` does with the view's tree and tools, with `TriangleBvh` in their place; `upperComponentsOf`, `bandGroupsOf` are shared by the two, so that what decides which piece a region is stands in one place. `gmOfProjectSteps` makes a specimen's points from a project and a mesh.
* The summary: `gmOfFolder` keeps what is stored while `gmCacheKey` is the same (`derived.gm.key`), the rest goes to the batch worker (`MeshJobs.gm`, job `gm`, `MeshMeasurer.gm`). Grid flakes still open their models in turn: their rays need the view's tree.
* `App.layGmTemplate` checks the anchors (`gmAnchorRows`, no mesh needed) and the regions, lays each patch in slices, and sets `state.gm.template` as one Command. `App.gmTemplateInfo` compares the template's hashes with its annotations, from the open project or the folder's index. The template's anchors are in the configuration, so passing on does not read its project or its model; `App.templateThere` looks only whether its model is listed.
* `App.gmSeen`: how points came out in this session, for the folder's list, since an unedited project is not saved. Cleared when the configuration changes.

The grid's path through `gmSteps` is as it was: `tests/gmTemplate.test.ts` holds the checksums of its exports as they were before the template.

## Landmarks

* `ProjectState.landmarks` (export order) and `semilandmarks` (sets: curve, count, end
  landmarks) change together through `SetLandmarksCommand`, which keeps both lists and their
  counters before and after.
* `compute/landmarks.ts`: `sampleCurve` (equal arc length between the curve points nearest the
  end landmarks), `landmarkTable` (every point in export order and the geomorph sliders). The app
  recomputes the table whenever landmarks or curves change; `io/landmarks.ts` writes TPS, Slicer
  `.fcsv`, the long CSV and the sliders from it, so all exports share one numbering.
* `tools/landmarkTool.ts` places (snapping like curve points) and drags landmarks;
  `render/landmarkLayer.ts` draws them with their names, and the semilandmarks, as spheres fitted on every camera change: `render/landmarkSize.ts` (no three.js) gives the diameter, a share of the model's diagonal held within limits in CSS pixels (`dotDiameterPx`), at `Viewer.worldPerPixel` of their own depth, and the ball rests one radius toward the camera along the line of sight, so the surface it marks hides none of it and its place on the screen stays. Real geometry, so other parts of the surface still hide them. `render/gmLayer.ts` does the same in its vertex shader, as point sprites of `renderer.getPixelRatio()` device pixels per CSS pixel. Hiding and picking go by
  screen pixels (`hiddenBeyond`, `LANDMARK_PICK_PX`). Figures draw them in 2D at `FIGURE_LANDMARK_MM` on the paper, the outline included. Names carried
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

A core's (`hasVolumeSplit`). `compute/split.ts`: `splitByPlaneSteps` sums signed tetrahedra from a point on the plane over the
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
  view (`Viewer.clearMesh`), leaves the folder and resets the store (which clears the history); the start page shows again.

## Performance notes

* Ray picking uses three-mesh-bvh; a 2-million-triangle scan loads in a few seconds and
  picking stays well under a millisecond per pointer move.
* Curvature is linear in mesh size. Smoothing (0–100 passes) keeps every 10th level as a
  checkpoint, so moving the slider only recomputes the passes since the nearest one.
* The BVH build reorders the index buffer in place, so `buildLoadedMesh` always works on
  its own copy.
* `npm run bench` (`scripts/bench.ts`) times the heavy steps on a generated core of about 2 million
  triangles, each with its total and its longest stretch between two yields: the measure pass, the
  box, the configuration, the volume split, the bicone, "Complete loop", a flake's frame, hull, sections and paths, and the edge angles along the edge, the retouch layers, the points for geometric morphometrics, the retouch indices and what the retouch mode draws. The longest stretch is what
  design principle 10 limits to about 100 ms.

## Interface text

`scripts/i18n.ts` (`npm run i18n -- export | import <file> | check`, bundled like the bench) with
`scripts/i18nTable.ts`, which `tests/i18n.test.ts` tests. It finds every literal of language codes
with English among them (`{ zh: '…', en: '…' }`) in `src/` with the TypeScript parser: in `STRINGS`
its id is its key, elsewhere the file, the variable and the `key` / `value` of the objects it is in
(`fields.scar.completeness.point_complete.short`). `export` writes `i18n/texts.xlsx` (not committed): a
column per language, every cell text (so Excel reads nothing as a number, date or formula), plus where
a text is seen, notes (placeholders to keep) and what the check found; the rows `@lang.name` and
`@lang.short` hold `LANGS`. `import` reads the sheet `texts` (shared strings, runs and phonetic
guides as Excel and WPS save them, by a small unzip over `node:zlib`), and rewrites only the literals
that changed, in their own layout; a new language column becomes a property in every literal it has a
text for and an entry in `LANGS`. An empty English or Chinese cell, placeholders unlike the English, or
a new language without its name stops it with nothing written. `check` lists placeholders that differ,
empty texts, keys the code asks for and the table lacks, keys no code names (whole, by a template
prefix, or by a prefix passed as a literal), and one English text said two ways in Chinese and back.

## About and credit

Who made the program, where to ask, how to cite it and its licence are written in one place: `package.json` (`author` with `name`, `email` and `url`; `repository`; `bugs`; `homepage`) and the copyright line of `LICENSE`. `vite.config.ts` reads them into `__APP_ABOUT__` (`author`, `email`, `repository` without `git+` and `.git`, `license`, `copyright`, and `year`, the build's year), declared in `src/env.d.ts`. From there:

* **Help.** The "?" button (`App.showHelp`) opens one dialog with a segmented control (`#help-tab-about`, `#help-tab-shortcuts`) over two pages: `aboutPanel()` in `ui/about.ts` (`#help-about`) and the shortcut columns (`#help-cols`). The page last looked at is `App.helpTab` (view state, about at first); the ? key opens the shortcuts. The about page is labels and links only: author, source, requests and issues (`ISSUES_URL`, mailto), the reference with a copy button (plain text through the clipboard; without one the reference is selected), the licence (`LICENSE_URL`) and the third-party libraries (`THIRD_PARTY`). Links open in a new tab.
* **The reference.** `core/citation.ts` writes it in APA 7 for software from the authors, the year, the version and the address (`apaCitationParts` gives the title apart, for italics). A DOI or a preprint later goes there and into `CITATION.cff`.
* **The start page.** `#start-credit` (`creditLine()`) sits under the version, right-aligned and out of the flow (`.start-title` is its containing block), so the page's layout is unchanged.
* **The file.** The `credit()` plugin in `vite.config.ts` puts a comment on the line after the doctype (`<!-- LithicAnalyst <version> · © <copyright> · MIT License · <repository> -->`) and an author meta in the head; `scripts/make-artifact.mjs` keeps both in `dist/artifact.html`.
* **Exports.** `manifest.json`'s `app` is `appInfo()`: name, version, author, licence, repository and this version's reference.

## Hosting

The wordmark and the cards' ghost words are outlines of IBM Plex Sans Condensed (SIL OFL 1.1), made once from the official release (`scripts/gen-wordmark.py`, no font file in the repository). The IBM Plex fonts (SIL OFL 1.1) come from `@fontsource`: `src/fonts.css` declares only the Latin
subset of the weights the interface uses, and the build inlines them, so the page requests
no font server. Chinese text uses the system fonts.

`npm run build` writes `dist/index.html` (complete page, works from `file://` and any static
host such as GitHub Pages) and `dist/artifact.html` (the same app without the document
skeleton, for hosts that wrap pages themselves). In the claude.ai artifact viewer plain
downloads are blocked, so `io/saveFile.ts` uses the viewer's `downloads` capability there
and falls back to a copy dialog.

`npm run pages` makes the built page an app that can be installed from a web site, in
`dist/pages/` (`scripts/pages.ts`, with `scripts/webApp.ts`): the page with four tags more in its
head, right after the theme script (the manifest; a `theme-color` meta that a small script keeps to
the shell's `data-theme`, so the window's title bar follows the appearance; the touch icon; the
service worker's registration), `manifest.webmanifest` (`id`, `start_url` and `scope` all `./`, so
the site can live in any folder), `sw.js` and `icons/`. The worker keeps every file from the first
visit on and answers from what it keeps while fetching the file again behind it (past the HTTP
cache): the app opens offline, and a new build is there at the next launch, never in the middle of
a session. Its first line carries the version and a hash of the site, so each build is installed
anew. The page must be kept; any other file the site lacks is skipped. `dist/index.html` is not
touched, so the file opened from the disk still asks nothing of the network. The icons in
`src/assets/brand/app-icon/` are made from `logo-small.svg` by `scripts/app-icons.mjs` (Playwright's
Chromium); run it again when the logo changes. `.github/workflows/pages.yml` (Release) runs on a
published release: it attaches `dist/index.html` to the release as `LithicAnalyst-<version>.html` and
publishes `dist/pages` to GitHub Pages, so the site is always a released version (it can also be run
by hand). Pushes to `main` only run the tests (`ci.yml`).

## Tests

* `tests/` (vitest, `npm test`): `core/`, `compute/` and `io/` in Node, checked against known answers.
* `e2e/` (Playwright, `npm run e2e`): drives the built `dist/index.html` in Chromium (WebGL on
  SwiftShader when there is no GPU). Test models are generated by `e2e/fixtures/meshes.ts`; the
  tests read the project state and map model coordinates to screen positions through
  `window.lithicanalyst` (end of `ui/app.ts`). Add methods there when a new feature needs them.
  Software rendering spreads each browser over all the cores, so more workers only compete:
  `playwright.config.ts` fixes 2 locally and 1 on CI (the measurements are in a comment there). Tests
  wait for a state (`expect.poll`, an element appearing), never a fixed time.
  `e2e/webApp.spec.ts` packs `dist/index.html` as `npm run pages` does and serves it over http
  (`serveDir`), the one test that does not open the file.
