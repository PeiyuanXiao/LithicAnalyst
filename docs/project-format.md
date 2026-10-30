# LithicAnalyst project file — format version 2

A project file (`*.lithicanalyst.json`) holds everything one annotator (`specimen.annotator`)
recorded on one mesh in one session of annotation. It does not contain the mesh itself; it
records the mesh's SHA-256 so the app can tell when a project is opened on a different file.
Comparing annotators means loading several project files of the same mesh; a single file never
holds layers from several annotators.

The format is the long-lived contract of the tool. Any change that existing readers cannot
ignore needs a new `formatVersion` and a migration in `src/core/schema.ts`.

## Coordinates

* Every coordinate is in the **original coordinate system of the mesh file**, in the unit
  given by `specimen.unit` (coordinates are never rescaled).
* The app re-centres geometry internally for float precision; that offset never reaches the file.
* Orientations (the specimen frame, later the plane frames) are stored as matrices next to the
  data; they never change stored coordinates.

## Top level

| key | type | notes |
|---|---|---|
| `format` | `"lithicanalyst-project"` | required |
| `formatVersion` | `2` | required |
| `app` | `{ name, version }` | software that wrote the file |
| `savedAt`, `createdAt`, `modifiedAt` | ISO 8601 strings | |
| `specimen` | `{ id, annotator, unit, notes, frame }` | see below |
| `mesh` | object or `null` | `fileName`, `format`, `fileSize`, `sha256`, `vertexCount`, `triangleCount`, `bboxMin`, `bboxMax` |
| `annotations.scars` | array | in creation order |
| `annotations.curves` | array | in creation order |
| `annotations.measurements` | array | manual measurements, in creation order |
| `annotations.planes` | array | fitted planes (their inputs), in creation order |
| `annotations.regions` | array | surface regions as seeds (`{ id, label, seed, type, scarId }`) |
| `annotations.relations` | array | stratigraphic relations between scars (`{ id, a, b, kind }`), see below |
| `annotations.sequences` | array | removal sequences, earliest first (`{ id, label, scarIds, ordered }`), see below |
| `annotations.landmarks` | array | fixed landmarks in export order (`{ id, name, point }`) |
| `annotations.semilandmarks` | array | curve semilandmark sets (`{ id, label, curveId, count, startLandmarkId, endLandmarkId }`), see below |
| `annotations.sections` | array | display sections (`{ id, label, point, normal, across, keep, fill, inFigure }`); no measurements |
| `split` | `{ source, id, upHint }` or null | upper / lower volume split by a plane (`source: "plane"`) or a closed curve (`"curve"`); `upHint` orients the curve's normal |
| `nodule` | `{ exclude, show }` | cortex regions left out of the sphere fit (ids), and whether the sphere is drawn |
| `derived` | object | latest computed results, see below |
| `nextLabelNumber` | integer | next automatic scar label (`S{n}`) |
| `nextCurveNumber` | integer | next automatic curve label (`C{n}`) |
| `nextMeasureNumber` | integer | next measurement label (`M{n}`) |
| `nextPlaneNumber` | integer | next plane label (`P{n}`) |
| `nextSectionNumber` | integer | next section label (`X{n}`) |
| `nextRegionNumber` | integer | next region label (`R{n}`) |
| `nextSequenceNumber` | integer | next sequence label (`Q{n}`) |
| `nextLandmarkNumber` | integer | next default landmark name (`LM{n}`) |
| `nextSemilandmarkNumber` | integer | next semilandmark set label (`SL{n}`) |

Readers should ignore keys they do not know. Future annotation layers will be added next to
`scars` and `curves` inside `annotations`.

`mesh.sha256` is the checksum of the file's bytes; `vertexCount` and `triangleCount` describe the
mesh as the app uses it: vertices with identical coordinates merged (also in PLY files whose
faces each have vertices of their own) and degenerate triangles left out.

## Specimen

```json
{
  "id": "LB-1023",
  "annotator": "PX",
  "unit": "mm",
  "notes": "",
  "frame": { "matrix": [1, 0, 0, -12.5, 0, 1, 0, 3.2, 0, 0, 1, -8.1, 0, 0, 0, 1], "source": "view" }
}
```

* `annotator` is the observer. One project file = one annotator's annotation of one mesh.
* `unit` (`mm`, `cm`, `m`, `in`, or `""` for not stated) is a declaration only; coordinates
  are never scaled.
* `frame` is the specimen coordinate system used for display and for length, width and
  thickness, or `null` when none is set. `matrix` is a row-major 4×4 matrix (16 numbers) that
  maps original coordinates to specimen coordinates: +Z points toward the viewer of the main
  face, +Y is up on the page, +X is to the right; the origin is the centre of the mesh's
  bounding box. `source` records how it was set: `view`, or `plane:P1`, followed by
  `; vertical:S3` when an arrow set the vertical (pointing up, origin at the bottom).

## Derived results

`derived` holds the latest results computed from the mesh and the annotations, so that R or
Python can read them without recomputing. They are recomputed whenever their inputs change; when
a file is opened, the app ignores the stored values and computes them again. Later versions add
fitted planes, fitted spheres, volumes ….

```json
{
  "measurements": {
    "frame": "principal",
    "length": 61.204, "width": 38.551, "thickness": 14.093,
    "surfaceArea": 4410.25, "volume": 19873.6,
    "surfaceToVolumeRatio": 6.006, "wadellSphericity": 0.806,
    "closed": true
  },
  "manualMeasurements": [
    { "id": "…", "label": "M1", "type": "distance", "value": 23.412, "unit": "mm" }
  ]
}
```

* `measurements` (null until the mesh has been measured): length, width and thickness are the
  ranges of the model along three axes, the specimen frame's Y, X and Z when `specimen.frame` is
  set (`frame: "specimen"`), else the first, second and third principal axes of the surface
  (area-weighted PCA; `frame: "principal"`). `surfaceArea` is in unit², `volume` in unit³ and
  only computed when the mesh is closed (otherwise null, as are the two indices; holes are not
  filled). `surfaceToVolumeRatio` = A / V^(2/3) (dimensionless); `wadellSphericity` =
  π^(1/3) (6V)^(2/3) / A.
* `vertices`: the principal axes of all mesh vertices (`{ mean, axes, variances }`, original
  coordinates; the `all_vertices` plane and the plane frames use them), or null.
* `manualMeasurements`: the value of each manual measurement (length in the specimen unit, or
  degrees for angles).
* `regions`: each region as found on the mesh: `{ id, label, type, scarId, area, conflict }`
  (area in unit², null when the seed is off the mesh; `conflict` when another seed lies in the
  same piece). `regionTotals`: `{ scar, cortex, joint, damage, cortexRatio }` — areas by type
  (each piece counted once, for the first region in it) and cortex area / total surface area.
* `nodule`: the sphere fitted to the chosen cortex regions: `{ center, radius, rms, count, regions }`
  (least squares on their vertices — algebraic fit, then Gauss–Newton on the distances; at most
  about 200 000 vertices, evenly picked), or null.
* `split`: `{ upper, lower, ratio }` (unit³; ratio = upper / lower), or null. By a plane: each side
  is closed by the section; with a reference point on the plane the cap adds no volume, so the
  clipped triangles on each side are summed (divergence theorem). By a closed curve: the curve's
  mesh edges split the surface in two; each side is closed by a fan from the centre of the curve
  (no volume with that centre as the reference point). Upper = the side the normal points to
  (the plane's normal, or the normal of the plane fitted to the curve, oriented by `upHint`).
  Closed meshes only.
* `relations`: checks of the relations and sequences, by scar and sequence id:
  `{ cycles, cycleEdges, sequenceConflicts, orderConflicts, unassigned, count, direct }`.
  Only `a_cuts_b` relations take part (as `{ later, earlier }`). `cycles`: groups of scars whose
  relations go round in a circle (strongly connected components), `cycleEdges` the relations
  inside them. `sequenceConflicts`: A cuts B but A's sequence comes before B's
  (`laterSequence`, `earlierSequence`). `orderConflicts`: A cuts B in the same ordered sequence
  but A is listed first (`sequence`). `unassigned`: scars in no sequence (only when there are
  sequences). `count` = cycles + conflicts + 1 when some scars are unassigned. `direct`: the
  relations left after the transitive reduction (relations in a cycle are kept) — the lines of
  the Harris matrix.
* `landmarks`: every landmark point in export order, `{ rows, sliders, sets }`. `rows`:
  `{ index, name, kind, setId, point }` — the fixed landmarks (list order, `kind: "fixed"`), then
  each set's semilandmarks (`kind: "curve"`, named `<set>_<k>`); `index` counts from 1.
  `sliders`: `[before, slider, after]` by `index` (geomorph's `curves` matrix). `sets`:
  `{ id, label, curveId, valid, points }` (`valid` false, no points, when the curve is missing).
* `planes`: each fitted plane as computed from its inputs: `{ id, label, method, valid, center,
  normal, matrix, inputCount }`. `valid` is false when the inputs are not enough (then `center`,
  `normal` and `matrix` are null). `matrix` is row-major 4×4 and maps original coordinates to the
  plane frame (origin = centre, +Z = normal, +X = the model's first principal axis of the
  vertices projected onto the plane, or the second when the first is almost along the normal,
  with its largest component positive; +Y = Z × X).

## Surface region

```json
{ "id": "…", "label": "R1", "seed": [12.1, -3.4, 8.8], "type": "cortex", "scarId": null, "createdAt": "…", "modifiedAt": "…" }
```

* The curves split the surface into pieces: each curve is turned into mesh edges (each point to
  its nearest vertex, gaps joined by shortest paths over mesh edges), and triangles are grouped
  across all other edges. A region is the piece that holds its `seed` (the clicked surface point).
* `type`: `scar` (worked), `cortex`, `joint` (unworked surfaces), `damage`. A scar region links
  to a scar (`scarId`): the one whose arrow starts in it, or a scar without a direction created
  with the region.

## Relation and sequence

```json
{ "id": "…", "a": "<scar id>", "b": "<scar id>", "kind": "a_cuts_b", "createdAt": "…", "modifiedAt": "…" }
{ "id": "…", "label": "Q1", "scarIds": ["<scar id>", "…"], "ordered": true, "createdAt": "…", "modifiedAt": "…" }
```

* `kind`: `a_cuts_b` — scar `a` cuts scar `b` (a is later than b) — or `indeterminate` (looked
  at, cannot tell; kept apart from pairs not judged yet, which have no relation). One relation
  per pair of scars. On reading, relations with unknown scars and repeated pairs are dropped.
* Sequences are listed earliest first. A scar is in one sequence at most; within an `ordered`
  sequence `scarIds` runs from the earliest scar, otherwise their order means nothing.
* A sequence the app creates is `ordered: true` (its members follow the relations, in the order
  they were added where the relations decide nothing); the user can switch it off. Sequences read
  from a file keep the value written there (a missing `ordered` reads as `false`).
* The app keeps both orders as the relations have them (`orderSequences` in
  `src/compute/relations.ts`), whenever relations or memberships change: A is earlier than B when
  B cuts A through one or more `a_cuts_b` relations (also through scars in other sequences or
  none). Within an ordered sequence the scars are sorted so; sequence P comes before Q when a
  scar of Q is later than one of P and none of P is later than one of Q. What the relations do
  not decide keeps the order it had (set by hand), and scars or sequences in a cycle keep theirs.
  Files written otherwise (by hand, or by earlier versions) are read as they are.
* Deleting a scar removes its relations and takes it out of its sequence.

## Landmarks

```json
{ "id": "…", "name": "apex", "point": [12.1, -3.4, 8.8], "createdAt": "…", "modifiedAt": "…" }
{ "id": "…", "label": "SL1", "curveId": "…", "count": 10, "startLandmarkId": "…", "endLandmarkId": null, "createdAt": "…", "modifiedAt": "…" }
```

* Fixed landmarks: a surface point (snapped onto a ridge or valley vertex when the snap setting
  says so) and a free name. Their order in the list is the export order.
* Curve semilandmarks: `count` points at equal arc length along the curve's traced points. With a
  start and / or end landmark, the stretch runs between the points of the curve nearest to them,
  which are left out (they are fixed landmarks); the first and last semilandmarks slide against
  them. Without them, an open curve runs to its ends (included; with one landmark, to the end
  farther from it), and those end points do not slide; a closed curve goes once round from its
  first point and its points slide round the loop; with one landmark, once round from it; with two,
  from the start to the end in the direction the curve was drawn. The points follow the curve and
  the landmarks whenever they change. Deleting a landmark clears it from the sets.
* Sliding is done in R (`geomorph::gpagen(curves = …)`, `Morpho::procSym`); the app only writes
  the definition.

## Fitted plane

```json
{
  "id": "9a1b…",
  "label": "P1",
  "method": "scar_starts",
  "excludeCompleteness": ["both_missing"],
  "curveIds": [],
  "upHint": [0.12, -0.31, 0.94],
  "visible": true,
  "createdAt": "…",
  "modifiedAt": "…"
}
```

Only the inputs are stored; the plane is recomputed whenever they change.

| `method` | plane | centre |
|---|---|---|
| `all_vertices` (Lin et al. 2024) | least-squares plane of all mesh vertices, unweighted | mean of the vertices |
| `scar_directions` (Xiao et al. 2026) | normal = eigenvector of the smallest eigenvalue of T = Σ u uᵀ over the unit directions u of all scars with an arrow | mean of the arrows' midpoints |
| `scar_starts` | least-squares plane of the arrow origins, leaving out the completeness codes in `excludeCompleteness` | mean of the origins used |
| `curves` | least-squares plane of the curves in `curveIds`, resampled at equal arc length (256 points over all of them) | mean of the resampled points |

* A plane is invalid with fewer than 3 points, or (`scar_directions`) fewer than 2 non-parallel
  directions.
* The normal is taken on the side of `upHint`, which points toward the viewer when the plane is
  created; flipping the plane negates it.

## Manual measurement

```json
{
  "id": "5d2f…",
  "label": "M2",
  "type": "geodesic",
  "points": [[10.5, -4.2, 8.9], [22.1, 3.0, 7.6]],
  "path": [[10.5, -4.2, 8.9], [11.9, -3.4, 9.0], "…", [22.1, 3.0, 7.6]],
  "createdAt": "2026-10-17T20:41:12.502Z",
  "modifiedAt": "2026-10-17T20:41:12.502Z"
}
```

* `type`: `distance` (straight line between two points), `geodesic` (along the surface between
  two points) or `angle` (three points; the angle is at the middle one, in degrees).
* `points` are surface points in original coordinates; for `geodesic` they are mesh vertices.
* `path` (geodesic only, else null): the line along the surface, found as the shortest path over
  mesh edges, pulled taut along the surface (relaxPath) and kept on the surface where it crosses
  edges. The value is its length.

## Scar

```json
{
  "id": "6f0c1c2e-6b0e-4d3f-9a7e-3a1f2b9c8d10",
  "label": "S4",
  "vector": {
    "start": [12.734, -3.118, 9.905],
    "end": [2.051, 1.877, 11.402],
    "startNormal": [0.12, -0.05, 0.99],
    "endNormal": [0.02, 0.01, 0.99]
  },
  "attributes": { "completeness": "bulb_truncated", "termination": "na", "certainty": "certain", "note": "" },
  "createdAt": "2026-10-15T20:31:02.114Z",
  "modifiedAt": "2026-10-15T20:31:40.551Z"
}
```

* A scar is an object of its own. Its direction arrow (`vector`) is optional: a scar known only
  by its surface area, whose direction cannot be read, has `"vector": null`.
* `vector.start` is the origin of the removal (point-of-percussion side); `vector.end` is the
  termination.
* `startNormal` / `endNormal` are unit surface normals at the picked points (facing the viewer
  when picked); the app uses them only to lift arrows off the surface for display.
* `id` is permanent; `label` is editable and need not be unique.

### Attributes

Defined in `src/core/fields.ts`.

| key | values |
|---|---|
| `completeness` | `point_complete` 可见打击点+尾端完整 · `bulb_complete` 可见负向打击泡+尾端完整 · `proximal_missing` 打击点缺失+尾端完整 · `point_truncated` 可见打击点+尾端缺失 · `bulb_truncated` 可见负向打击泡+尾端缺失 · `both_missing` 两端缺失 |
| `termination` | `feather` 羽状 · `step` 阶梯状 · `hinge` 铰链状 · `overshot` 过击 · `na` 缺失 (looked at: there is no termination) · `null` not judged yet |
| `certainty` | `certain` · `probable` · `uncertain` |
| `note` | free text |

* The codes are listed in the order the interface shows them (number keys 1–6 for the
  completeness, Shift + 1–5 for the termination). `proximal_missing` was added after the others;
  no code has changed.
* `termination` follows the completeness: with `point_truncated`, `bulb_truncated` or
  `both_missing` it is `na` (and cannot be set otherwise); when the completeness changes back to
  one with a termination, an `na` termination becomes `null` again. Files without the key (written
  before it existed) read as `null`, whatever their completeness.
* Readers should keep attribute keys they do not know; adding a field or a code needs no new
  `formatVersion`.

## Curve

```json
{
  "id": "0b8e6d1a-2f3c-4c55-9d1e-7a0c4b9e2f11",
  "label": "C2",
  "anchors": [[10.512, -4.208, 8.931], [11.204, -3.380, 9.112], [11.640, -2.215, 9.204]],
  "points": [
    [10.512, -4.208, 8.931], [10.861, -3.795, 9.020], [11.204, -3.380, 9.112],
    [11.433, -2.801, 9.170], [11.640, -2.215, 9.204]
  ],
  "anchorIndex": [0, 2, 4],
  "closed": false,
  "attributes": { "type": "ridge", "note": "" },
  "createdAt": "2026-10-15T20:41:12.502Z",
  "modifiedAt": "2026-10-15T20:43:05.007Z"
}
```

* `anchors` are the points placed by the annotator (after snapping), in drawing order. They are
  mesh vertices.
* `points` is the traced line through all anchors, in order. Every point lies on the surface.
  Between two anchors the line was found as the cheapest path over mesh edges, where edges on
  pronounced ridges (or valleys, or neither, depending on the snap setting) cost less, and was
  then pulled taut along the surface; points on the snapped feature are held in place.
* `anchorIndex[i]` is the position of `anchors[i]` in `points`.
* `closed`: the last point connects back to the first, which is not repeated.
* Coordinates are stored to 6 decimals.
* `points` are kept as traced: later versions of the tracing method do not change saved curves
  until an anchor is moved.

### Curve attributes

| key | values |
|---|---|
| `type` | `edge` 刃缘 · `ridge` 棱脊 · `scar_boundary` 片疤边界 · `other` 其他 |
| `note` | free text |

## CSV export

One row per scar that has a direction arrow (scars with `"vector": null` are left out;
`termination` is empty when not judged yet):

```
specimen_id,scar_id,start_x,start_y,start_z,end_x,end_y,end_z,length,completeness,termination,certainty,note,unit
```

One row per curve point (curve CSV), in order along each curve:

```
specimen_id,curve_id,point_index,x,y,z,arc_length,anchor,closed,length,type,note,unit
```

`arc_length` is the distance along the curve from its first point, `anchor` is `true` for
points placed by the annotator, and `length` is the whole curve (for a closed curve including
the segment back to the first point).

Automatic measurements (`<specimen>_measurements.csv`, one row):

```
specimen_id,unit,frame,length,width,thickness,surface_area,volume,surface_to_volume_ratio,wadell_sphericity,closed
```

Manual measurements (`<specimen>_manual_measurements.csv`, one row each; unused points empty,
angles with unit `deg`):

```
specimen_id,measure_id,type,value,unit,p1_x,p1_y,p1_z,p2_x,p2_y,p2_z,p3_x,p3_y,p3_z
```

Fitted planes (`<specimen>_planes.csv`, one row each; numbers empty for an invalid plane):

```
specimen_id,plane_id,method,center_x,center_y,center_z,normal_x,normal_y,normal_z,m00,m01,…,m33
```

Surface regions (`<specimen>_regions.csv`, one row each):

```
specimen_id,region_id,type,scar_id,area,unit
```

Relations (`<specimen>_relations.csv`, one row each; scars by label; `relation` is `a_cuts_b`
— scar_a is later than scar_b — or `indeterminate`):

```
specimen_id,scar_a,scar_b,relation
```

Sequences (`<specimen>_series.csv`, one row per scar in a sequence; `series_order` counts the
sequences from the earliest, 1; `order_in_series` counts the scars from the earliest, and is
empty when the sequence is not ordered):

```
specimen_id,series_id,series_order,scar_id,order_in_series
```

Landmarks — all four files list the same points in the same order (fixed landmarks in list order,
then each semilandmark set), numbered from 1:

* `<specimen>_landmarks.tps`: `LM3=<n>`, one `x y z` line per point, `ID=<specimen>`.
* `<specimen>_landmarks.fcsv`: 3D Slicer markups (`# Markups fiducial file version = 4.11`,
  `# CoordinateSystem = LPS`), label = name, description = set label; coordinates as in the mesh
  file (Slicer reads model files as LPS by default).
* `<specimen>_landmarks.csv`: `specimen_id,index,name,kind,set_id,x,y,z` (`kind` is `fixed` or
  `curve`).
* `<specimen>_sliders.csv`: `before,slider,after`, one row per sliding semilandmark, by `index`
  (geomorph's `curves` matrix: `as.matrix(read.csv(…))`).

Observer agreement (compare mode; not part of the project file):

* `<specimen>_agreement.csv`: `specimen_id,item_type,item_key,annotator_a,annotator_b,metric,value`
  — one row per value, for every pair of observers; with three or more, Fleiss' κ rows have
  `annotator_a = all` and an empty `annotator_b`. `item_type` / `metric`: `arrow` (per matched
  pair `item_key = <label a>|<label b>`: `angle_deg`, `start_distance`, `end_distance`; `all`:
  `matched`, `unmatched_a`, `unmatched_b`), `scar_attribute` (field key, e.g. `completeness`,
  `termination`: `agreement`, `cohen_kappa` / `fleiss_kappa`, `n_items`; scars an observer left
  unfilled are left out), `relation` (`all`: same), `curve` (pairs:
  `mean_distance`, `hausdorff`; `all`: counts), `plane` (pairs: `normal_angle_deg` 0–90,
  `center_distance`), `region` (type: `iou`, `dice` by area; scar region pairs likewise),
  `region_type` (`all`: `agreement`, kappa, `area` typed by both), `landmark` (name:
  `distance`), `semilandmark` (`<set>_<k>`: `distance`), `measurement` (`length`, `width`,
  `thickness`, `area_<type>`, `cortex_ratio`, manual labels: `difference` = b − a). Empty values
  are undefined (e.g. κ when only one category occurs).
* `<specimen>_agreement_summary.csv`: `specimen_id,item_type,metric,annotator_a,annotator_b,n,mean,sd,min,max`
  — the long table grouped by item type, metric and pair.

Matching: arrows by the mean distance of their two ends, curves (same type) by their mean
distance, both with the Hungarian method and a distance limit (default a tenth of the model's
diagonal); planes by method and angle; scars known only by their regions through the scar
regions' largest overlaps; landmarks by name; semilandmarks by set label and number; manual
measurements by label and type. Kappas: Cohen for two observers, Fleiss for all of them on
the scars of the first that every other has matched (relations: pairs of those scars that
someone related; regions: triangles typed by all, weighted by area).

Folders. When a folder is open, the app keeps its own files in `LithicAnalyst/` at the top of it:

```
<folder>/
  …models (in subfolders too; folders starting with "." are left out)
  LithicAnalyst/
    projects/<model path>.lithicanalyst.json     e.g. projects/site1/EXP03.ply.lithicanalyst.json
    exports/<YYYY-MM-DD_HHMMSS>/                  one new folder per export, never overwritten
      manifest.json, failures.csv (only when something failed)
      measurements.csv, scar_vectors.csv …        (whole folder)
      <specimen>_<kind>.csv …                     (one specimen)
    figures/<YYYY-MM-DD_HHMMSS>/<model's subfolder>/<specimen>_figure.png|svg, manifest.json
```

* A model's project file name keeps the model's extension, so `EXP03.ply` and `EXP03.stl` have
  one each. Projects are always written to `LithicAnalyst/projects/`. Earlier versions kept them
  next to the model as `<name without extension>.lithicanalyst.json`; such a file is still read
  when there is none in the new place, if its `mesh.sha256` is the model's, and is never changed
  or deleted (it can be removed by hand once the new one exists). Any other project file of the
  folder belongs to a model by `mesh.sha256` (other observers).
* Specimen IDs of models without a project: the file name without its extension; where two
  models share it (different subfolders or extensions), the path without the extension
  (`site1/EXP03`), and with the extension when that is still the same (`EXP03.ply`). The manifest
  lists these names (`duplicateNames`).
* A read-only folder (a directory upload) gets the same layout in one ZIP to unpack into it: the
  exports, and "Download all project files" (`LithicAnalyst/projects/…`).
* `manifest.json`: `app`, `createdAt`, `scope` (`specimen` or `folder`), `folder`, `kind`
  (`tables` or `figures`), `options`, `specimens` (`id`, `file` = model path, `sha256`, `project`
  = the project file used, `annotator`), `duplicateNames`, `failures` (`file`, `reason`) and
  `files` (the files of the export). `failures.csv`: `file,reason`.

Summary export (the whole folder): one file per kind with the same columns as the per-specimen
files (one measurement row per model, from its own project file, or from another project file of
the model, or a fresh project; `file` is the model's path), `landmarks.tps` (one block per
specimen), and — with several observers per model, told apart by `specimen.annotator` —
`icc.csv`: `measure,n_specimens,n_raters,icc` (ICC(2,1), two-way random, absolute agreement,
single rater; over the specimens every observer measured; measures: length, width, thickness
along each observer's frame, cortex_ratio, nodule_radius, volume_ratio from the stored derived
results, and manual measurements by label). A model that cannot be read or measured is left out
and listed in `failures`. The stored results of a model's project files are used instead of
reading the model when every one of them was written by the same version of the app and holds
`derived.measurements` (and `derived.vertices` when it has planes); the tables are the same
either way.

The measurement CSV ends with `area_scar,area_cortex,area_joint,area_damage,cortex_ratio,nodule_radius,nodule_fit_rms,volume_upper,volume_lower,volume_ratio,file` (`file`: the model, its path in a folder).

Enumerated fields are written as their codes, which are the same in every interface language.
Numbers use `.` as the decimal separator and up to six decimals. Text is quoted per RFC 4180.
The optional UTF-8 byte-order mark helps Excel read non-ASCII notes.

## Changes from format version 1

Files of format 1 (written by 0.1.0 and the curve update) open unchanged; the app converts them
when reading, and saving writes format 2.

| format 1 | format 2 |
|---|---|
| `annotations.scarVectors[]` with `start`, `end`, `startNormal`, `endNormal` at the top level of each item | `annotations.scars[]`; the four keys move into `vector`, which may be `null` |
| `specimen` without `frame` | `specimen.frame` (matrix or `null`) |
| no `derived` | `derived` (computed results) |
| — | `annotations.measurements`, `nextMeasureNumber`, `annotations.planes`, `nextPlaneNumber`, `annotations.sections`, `nextSectionNumber`, `annotations.regions`, `nextRegionNumber`, `annotations.relations`, `annotations.sequences`, `nextSequenceNumber`, `annotations.landmarks`, `annotations.semilandmarks`, `nextLandmarkNumber`, `nextSemilandmarkNumber` |
| `annotations.curves`, `nextCurveNumber` optional | always written |

The arrow CSV is unchanged.
