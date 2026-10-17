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
present; compare comes with roadmap 5.1). A mode owns its tools and sidebar sections:
`App.updateToolbar` shows the toolbar of the current mode, and `SECTIONS` in `ui/sidebar.ts`
lists which modes show each section. Outside the annotate mode the select tool only navigates
(`ToolContext.editable()`), and keys that change annotations are ignored. Switching modes
keeps the selection and the undo history.

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
