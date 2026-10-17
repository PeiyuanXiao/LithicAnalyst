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
| `derived` | object | latest computed results, see below |
| `nextLabelNumber` | integer | next automatic scar label (`S{n}`) |
| `nextCurveNumber` | integer | next automatic curve label (`C{n}`) |
| `nextMeasureNumber` | integer | next measurement label (`M{n}`) |
| `nextPlaneNumber` | integer | next plane label (`P{n}`) |

Readers should ignore keys they do not know. Future annotation layers (landmarks, surface
regions, relations) will be added next to `scars` and `curves` inside `annotations`.

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
* `manualMeasurements`: the value of each manual measurement (length in the specimen unit, or
  degrees for angles).
* `planes`: each fitted plane as computed from its inputs: `{ id, label, method, valid, center,
  normal, matrix, inputCount }`. `valid` is false when the inputs are not enough (then `center`,
  `normal` and `matrix` are null). `matrix` is row-major 4×4 and maps original coordinates to the
  plane frame (origin = centre, +Z = normal, +X = the model's first principal axis of the
  vertices projected onto the plane, or the second when the first is almost along the normal,
  with its largest component positive; +Y = Z × X).

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
  "attributes": { "completeness": "bulb_truncated", "certainty": "certain", "note": "" },
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
| `completeness` | `point_complete` 可见打击点+尾端完整 · `bulb_complete` 可见负向打击泡+尾端完整 · `point_truncated` 可见打击点+尾端缺失 · `bulb_truncated` 可见负向打击泡+尾端缺失 · `both_missing` 两端缺失 |
| `certainty` | `certain` · `probable` · `uncertain` |
| `note` | free text |

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

One row per scar that has a direction arrow (scars with `"vector": null` are left out):

```
specimen_id,scar_id,start_x,start_y,start_z,end_x,end_y,end_z,length,completeness,certainty,note,unit
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
| — | `annotations.measurements`, `nextMeasureNumber`, `annotations.planes`, `nextPlaneNumber` |
| `annotations.curves`, `nextCurveNumber` optional | always written |

The arrow CSV is unchanged.
