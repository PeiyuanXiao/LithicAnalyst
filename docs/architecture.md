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
   vector ones.
3. `core/schema.ts`: serialise under `annotations.landmarks`; old files simply lack the key.
   Bump `formatVersion` only if old readers would misread the file.
4. `render/`: a layer class that draws the items from state (see `ArrowLayer.sync`).
5. `tools/`: a tool that creates and edits them; register it in `ui/app.ts`.
6. `ui/sidebar.ts`: a section listing the items; `io/csv.ts`: an exporter.
7. Tests for the commands, the format round trip and the exporter.

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
