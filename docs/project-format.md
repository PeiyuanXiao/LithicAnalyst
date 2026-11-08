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
| `specimen` | `{ id, annotator, unit, notes, frame, type }` | see below |
| `mesh` | object or `null` | `fileName`, `format`, `fileSize`, `sha256`, `vertexCount`, `triangleCount`, `bboxMin`, `bboxMax` |
| `annotations.scars` | array | in creation order |
| `annotations.curves` | array | in creation order |
| `annotations.measurements` | array | manual measurements, in creation order |
| `annotations.planes` | array | fitted planes (their inputs), in creation order |
| `annotations.regions` | array | surface regions as seeds (`{ id, label, seed, type, scarId }`) |
| `annotations.relations` | array | stratigraphic relations between scars (`{ id, a, b, kind }`), see below |
| `annotations.sequences` | array | removal sequences, earliest first (`{ id, label, scarIds, ordered }`), see below |
| `annotations.landmarks` | array | fixed landmarks in export order (`{ id, name, point, code? }`) |
| `annotations.semilandmarks` | array | curve semilandmark sets (`{ id, label, curveId, count, startLandmarkId, endLandmarkId }`), see below |
| `annotations.sections` | array | display sections (`{ id, label, point, normal, across, keep, fill, inFigure }`); no measurements |
| `split` | `{ source, id, upHint, swap }` or null | upper / lower volume split by a plane (`source: "plane"`) or a closed curve (`"curve"`); `upHint` orients the curve's normal (set when the split is chosen: toward the side of the curve's plane with more scars by their ends, when even toward the viewer); `swap: true` exchanges upper and lower (files without it: `false`) |
| `nodule` | `{ exclude, show }` | cortex regions left out of the sphere fit (ids), and whether the sphere is drawn |
| `configuration` | `{ roles, joins, surfaceType, axis, polarity, model, bicone }` | the model of the volumetric configuration and its manual corrections, see below; files without it: the box, no corrections |
| `flake` | `{ axis, otherFrame, retouch }` | a flake's own data, see "Flakes" and "Retouch indices"; files without it: none |
| `gm` | object | which points a specimen has for geometric morphometrics, see "Geometric morphometrics"; files without it: the default |
| `sharpEdge` | `{ method, distance, threshold }` | what counts as a sharp edge, see "Sharp edge"; files without it: three points at 2 mm, no threshold |
| `workingEdges` | array | stretches of the curves measured for edge angles, measured on their own, see "Working edges"; files without it: none |
| `derived` | object | latest computed results, see below |
| `nextLabelNumber` | integer | next automatic scar label (`S{n}`) |
| `nextCurveNumber` | integer | next automatic curve label (`C{n}`) |
| `nextWorkingEdgeNumber` | integer | next working edge label (`E{n}`) |
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
  "frame": { "matrix": [1, 0, 0, -12.5, 0, 1, 0, 3.2, 0, 0, 1, -8.1, 0, 0, 0, 1], "source": "view" },
  "type": "core"
}
```

* `annotator` is the observer. One project file = one annotator's annotation of one mesh.
* `unit` (`mm`, `cm`, `m`, `in`, or `""` for not stated) is a declaration only; coordinates
  are never scaled.
* `frame` is the specimen coordinate system used for display and for length, width and
  thickness, or `null` when none is set. `matrix` is a row-major 4×4 matrix (16 numbers) that
  maps original coordinates to specimen coordinates: +Z points toward the viewer of the main
  face, +Y is up on the page, +X is to the right; the origin is the centre of the mesh's
  bounding box. `source` records how it was set: `view`, or `plane:P1`, or `technical_axis` (a
  flake's technical frame, see "Flakes"), followed by `; vertical:S3` when an arrow set the
  vertical (pointing up, origin at the bottom) or `; turned` when a technical frame was turned on the page.
* `type`: `core`, `flake` or `generic`; files without it are read as `core`. It decides which tools, panels
  and exports the specimen has, nothing else: the other types' data stay in the file. Edge angles and working edges are a flake's, the volume split a core's: `edgeAngle` on a curve, `workingEdges`, `sharpEdge` and `split` are kept as they are on any type and read again when the type has them, while on another type `derived.edgeAngles`, `derived.retouchAngles`, `derived.sharpEdge`, `derived.workingEdges` and `derived.split` are empty, `edge_angles.csv`, `retouch_angles.csv`, `edge_sharp.csv` and `working_edges.csv` have no rows for it and `measurements.csv` leaves `volume_upper`, `volume_lower` and `volume_ratio` empty. On a `generic` specimen curve and region types
  are the annotator's own text (a preset code from another type stays as it is); a new region's type is `region` until changed, its `scarId` is
  null and it makes no scar, whatever its text says; all regions lie in one layer, cut by all the curves (a region typed `platform` is that word, not
  an upper region, and has `parent: null`), and those with `auto: true` are left aside as on a core. `derived.configuration`, `derived.flake`, `derived.nodule` and `derived.retouchAngles` are empty. Arrows keep
  their `attributes` in the file; `scar_vectors.csv` leaves those columns empty.

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
  only computed when the mesh is closed (otherwise null; holes are not filled). Files saved earlier
  also have `surfaceToVolumeRatio` and `wadellSphericity` here; `derived` is not read back, so they
  are simply gone when the file is saved again.
* `vertices`: the principal axes of all mesh vertices (`{ mean, axes, variances }`, original
  coordinates; the `all_vertices` plane and the plane frames use them), or null.
* `manualMeasurements`: the value of each manual measurement (length in the specimen unit, or
  degrees for angles).
* `regions`: each region as found on the mesh: `{ id, label, type, scarId, area, conflict, parent, retouchLayer }`
  (area in unit², null when the seed is off the mesh; `conflict` when another seed lies in the
  same piece of its layer; `parent`: the id of the upper region a lower region lies in, else null; `retouchLayer`: of a retouch region, else null).
  `regionTotals`: `{ scar, cortex, joint, damage, retouch, flaking_surface, platform, ventral, dorsal, cortexRatio }` — areas
  by type (in each layer, each piece counted once, for the first region in it; the layers overlap, so the sum means nothing; the annotator's
  own types have no total) and cortex area / total surface area.
* `nodule`: the sphere fitted to the chosen cortex regions: `{ center, radius, rms, count, regions }`
  (least squares on their vertices — algebraic fit, then Gauss–Newton on the distances; at most
  about 200 000 vertices, evenly picked), or null.
* `split`: `{ upper, lower, ratio }` (unit³; ratio = upper / lower), or null (always on a flake or a generic specimen). By a plane: each side
  is closed by the section; with a reference point on the plane the cap adds no volume, so the
  clipped triangles on each side are summed (divergence theorem). By a closed curve: the curve's
  mesh edges split the surface in two; each side is closed by a fan from the centre of the curve
  (no volume with that centre as the reference point). Upper = the side the normal points to
  (the plane's normal, or the normal of the plane fitted to the curve, oriented by `upHint`);
  with `split.swap` the two are exchanged (also `ratio`). Closed meshes only.
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

* `configuration`: the volumetric configuration of the core by the box or the bicone (null for a flake,
  without scars with an arrow, before the mesh is measured, or for the bicone without a split by a
  closed curve on a closed mesh), see the next section.
* `flake`: a flake's measurements, see "Flakes" (null for a core, or before they are computed).
* `edgeAngles`: the edge angles of the curves measured, see "Edge angles" (null: none).
* `retouchAngles`: the retouch layers along those curves, see "Retouch layers" (null: none).
* `retouchIndices`: a flake's retouch indices, see "Retouch indices" (absent for a core, or before they are computed).
* `measuredLines` (absent when there are none): the edges not measured along all of their curve, see "The line measured" under "Edge angles": `{ parameters: { EDGE_RIM_REACH_MM, EDGE_RIM_MIN_MM }, curves: [{ curveId, start, end }] }`.
* `sharpEdge`: their sharp stretches, see "Sharp edge" (null without a threshold, or without edge angles).
* `gm`: a specimen's points for geometric morphometrics, see "Geometric morphometrics" (null before they are computed, and for a core or a general specimen whose lists are empty).

## Volumetric configuration

After the Logical Analytical System (Carbonell et al. 1999; Lombao et al. 2023), seven basic traits
of a core. The automatic values are a starting point with no thresholds for counting a face (one
scar makes a flaking surface); every one can be corrected by hand. Only scars with an arrow take part.

**The box.** Three axes: the specimen frame's X, Y, Z when `specimen.frame` is set (`frame:
"specimen"`), else the surface's principal axes (Y the first, Z the third, X = Y × Z; `frame:
"principal"`, the same axes as length, width and thickness — this orientation is not written to
`specimen.frame`). The box is the range of the vertices along each axis. Its six faces:

| code | direction | | code | direction |
|---|---|---|---|---|
| `front` | +Z | | `back` | −Z |
| `right` | +X | | `left` | −X |
| `top` | +Y | | `bottom` | −Y |

"Face order" is front, back, left, right, top, bottom.

**Scars.** d = the arrow's unit direction (start → end). A scar is on the face its normal points to,
without the normal's component along the arrow (a scar runs in its own face, so that component says
nothing about the face; the start's normal, tilted toward the platform at the edge, no longer pulls
the scar onto it): n = the start and end normals added and normalised (else the start normal),
n⊥ = n − (n·d) d, and the face whose outward direction has the largest dot product with n⊥. When
|n⊥| < 0.2 (`minNormalAcross`), the end normal without its component along d is used; when that is
shorter than 0.2 too, the end normal itself. Its platform is the one of the four adjacent faces whose
outward direction has the largest dot product with −d (wherever the arrow starts, so also when the
point of percussion is missing). Ties go to the first in face order.

**Roles** (`roles`): `both` (scars on it, and the platform of other scars), `flaking` (scars only),
`platform` (a platform only), `none` (unexploited). The role used is the correction, else the
automatic role. Which faces are flaking surfaces comes first, with the corrections: a face corrected
to `flaking` or `both`, or, without a correction, a face with scars. Only the scars on those faces
make their platforms platforms (so the scars of a face set to `platform` or `none` by hand make
none). The automatic role of a face follows from its scars and from being such a platform.

**Flaking surfaces.** Faces with the role `flaking` or `both` are grouped: two adjacent (not
opposite) such faces are one surface when the correction in `joins` says so, or, without one, when a
face with the platform role is the platform of scars on both (flaking round the core). Surfaces are
named `F1`, `F2` … by their first face in face order; the main face of a surface has most scars
(the first in face order when tied). A face set to `flaking` by hand without scars is a surface
without platforms. The platforms a surface uses are its scars' platforms that have the role
`platform` or `both`; the platform faces are all faces with one of those roles. A surface is
`alsoPlatform` when one of its faces is a platform used by another surface.

| trait | key / codes | rule |
|---|---|---|
| facial character | `facialCharacter`: `unifacial`, `bifacial`, `multifacial` | 1, 2, ≥ 3 surfaces; without a surface every trait is null |
| flaking surface relation | `flakingSurfaceRelation`: `opposite`, `adjacent`, `mixed` | the main faces two by two: on one axis = opposite, else adjacent; all opposite, all adjacent or both; null with one surface |
| platform relation | `platformRelation`: `peripheral`, `single`, `opposite`, `adjacent`, `mixed` | a surface uses ≥ 3 platforms: peripheral; else one platform face: single; else the platform faces two by two as above; null without platform faces |
| overall polarity | `polarity` (and `autoPolarity`): `unipolar_longitudinal`, `bipolar_opposed`, `bipolar_orthogonal`, `multipolar_centripetal`, `multipolar_orthogonal`, `multipolar_multidirectional` | U = the platforms used by all surfaces. One: unipolar. Two: on one axis opposed, else orthogonal. Three or more: centripetal when a surface is; else orthogonal when ≥ 75 % of the scars (on surfaces) run, in their face, within 25° of a box axis; else multidirectional. Null without U |
| surface type | per surface `autoType` / `type`: `wide`, `narrow`, `unclear` | thickness axis = the box's shortest side; the shorter other side / thickness < 1.25: unclear; else the main face across the thickness axis: wide, otherwise narrow |
| exploitation axis | per surface `autoAxis` / `axis`: `long`, `short`, `na` | `na` when the surface is centripetal, uses no platform, or uses platforms on different axes; else a = the platforms' axis, b = the axis of the main face across a: long when the box is at least as long along a as along b |

A surface is centripetal when it is one face, uses ≥ 3 platforms and ≥ 75 % of its scars point to the
face's centre (in the face, the cosine between the scar's direction and start → centre exceeds 0.5).

**Corrections** (`configuration` at the top level):

```json
{ "roles": { "back": "flaking" }, "joins": { "front|right": false }, "surfaceType": { "front": "narrow" }, "axis": {}, "polarity": null, "model": "box", "bicone": { "roles": {} } }
```

* `roles`: face code → role. `joins`: two adjacent face codes in face order joined by `|` →
  whether they are one surface. `surfaceType` (`wide` / `narrow`) and `axis` (`long` / `short`):
  written to every face of the surface; a surface takes the value of its first face (in face order)
  that has one, else the automatic value. `polarity`: one of the polarity codes, or null.
* `model`: `box` (default; files without it) or `bicone`, see below. `bicone.roles`: the bicone's
  role corrections by physical side, `positive` / `negative` → `flaking` / `none`.
* Faces follow the box's orientation, so a change of `specimen.frame` (also setting or clearing it)
  clears `roles`, `joins`, `surfaceType` and `axis` in the same undo step; `polarity`, `model` and
  `bicone` stay.
* Unknown faces and codes are dropped when a file is read.

**Derived** (`derived.configuration`): `frame`; `axes` (X, Y, Z, unit vectors in original
coordinates) and `min` / `max` (the box: the vertices' range along each, as dot products with
original coordinates); `thresholds` (`centripetalShare` 0.75, `centripetalCos` 0.5,
`orthogonalToleranceDeg` 25, `orthogonalShare` 0.75, `wideRatio` 1.25, `minNormalAcross` 0.2); `scars` (`{ id, face,
platform, surface }`, `surface` null when the face is not a flaking surface); `faces` (`{ face,
autoRole, role, scars }`); `joins` (`{ faces, auto, joined }` for each pair of adjacent flaking
faces); `surfaces` (`{ id, faces, mainFace, platforms, alsoPlatform, scarIds, centripetal, autoType, type,
autoAxis, axis }`); and `facialCharacter`, `flakingSurfaceRelation`, `platformRelation`,
`autoPolarity`, `polarity`; `model` is `"box"`.

### The bicone model

For cores made of two surfaces round one plane of intersection (Levallois, discoid, prepared,
centripetal cores): two cones sharing one round base, as large as the volume split makes them. A
conceptual aid only: it does not tell discoid from Levallois, gives no polarity (taken as
centripetal) and no platforms. It can be chosen when the volume is split along a closed curve
(`split.source: "curve"`); it uses that split's volumes and nothing else is computed for it.

* **Base**: the plane fitted to the split curve's points (principal components, through their
  mean), its normal pointing to the upper side of the split (oriented by `split.upHint`, the other
  way when `split.swap`). The curve projected onto the plane gives the area A and its area centroid
  O (shoelace formula); R = √(A / π).
* **Heights**: h(upper) = 3 V(upper) / A, h(lower) = 3 V(lower) / A (cones on that base with the
  split's volumes). Stored as they are; the sketch draws each at least 0.1 R high.
* **Scars**: a scar is on the upper cone when its end is on the upper side of the plane through O
  (its start is on the rim and says nothing).
* **Roles** (codes `flaking`, `none`): a cone with a scar is `flaking`, else `none`; the role used is
  the correction, else the automatic role. Corrections are kept by physical side: `positive` is the
  side the curve's normal points to when oriented by `split.upHint` (the upper cone unless swapped),
  `negative` the other, so a correction stays with its cone when upper and lower are swapped.
* **Traits**: only the facial character (one flaking cone `unifacial`, two `bifacial`, none null)
  and the flaking surfaces: the flaking cones, upper first, `F1`, `F2`.
* "Up" in the base (`reference`): the specimen frame's Y projected onto the plane; without a frame
  (or when Y is nearly along the normal), the curve's first principal axis.

**Derived** (`derived.configuration` with `model: "bicone"`): `frame` (`specimen` when
`specimen.frame` is set, else `principal`); `plane` (`{ point, normal }`, the normal toward the
upper cone); `centre` (O); `area`; `radius`; `upperHeight`, `lowerHeight` (true values);
`reference`; `scars` (`{ id, cone, surface }`, `cone` `upper` / `lower`, `surface` null when the cone
is not flaking); `cones` (`{ cone, side, autoRole, role, scars }`, upper then lower); `surfaces`
(`{ id, cone, scarIds }`); `facialCharacter`.

## Flakes

A specimen of type `flake` has a technical axis, a platform and the measurements below. Switching
the type deletes nothing: the other type's data stay in the file and come back with it.

```json
"flake": {
  "axis": { "id": "…", "start": [0, 0, 0], "end": [0, 40, 0], "startNormal": [0, 0, -1], "endNormal": [0, 0, -1],
            "matrix": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], "failure": null, "createdAt": "…", "modifiedAt": "…" },
  "otherFrame": null,
  "retouch": { "fitLength": null, "axis": "auto", "flip": false }
}
```

* `axis` (null without one; one per flake): the arrow on the ventral face from the point of percussion
  P (`start`) toward the distal end A (`end`).
* `matrix`: the **technical frame**, row-major, from original to technical coordinates (null when none
  could be made; then `failure`: `short` — |PA| under 5 mean edge lengths of the mesh —, or `few` —
  fewer than 10 triangles left below). Origin P. n = the mean outward normal of the ventral strip:
  the triangles whose centroid is within `STRIP_HALF_WIDTH_RATIO` × |PA| of the segment PA, weighted by
  area; again without those at `STRIP_NORMAL_OUTLIER_DEG` or more from that mean. **Z** = −n (toward the
  dorsal face), **Y** = A − P without its Z component (distal), **X** = Y × Z (to the right when the dorsal face
  is toward the viewer and the platform down). It is stored because it needs the mesh; the mesh does not change.
* `specimen.frame` is set to it (`source: "technical_axis"`) when the axis is drawn or moved, and back
  to null when the axis is deleted or gives no frame. The standard views then show the dorsal face in
  front, the ventral at the back and the platform from below. `otherFrame`: the frame of the type not in use (a flake has its own; `core` and `generic` share one).
* The landmark `pop` (`code: "pop"`, named `pop`) is the arrow's start: it moves and goes with the axis
  and cannot be moved or deleted by itself.
* Platform ends: landmarks with `code: "platform_end"`, at most two, on the platform outline. With `auto: true` one follows the curves: it is the point of the outline nearest an end of the edge, off what runs along the outline (see "The line measured"; an end counts within 4 mean segments of the two curves; with several edges, the two points furthest apart), and it moves or goes with them in the same step. Moved by hand it loses the key and stays where it was put; a file without the key has its ends placed by hand, which take the nearest such point, and the rest come when the file is opened. No edge or no closed outline: none. In the landmark
  exports they are named `platform_left` (−X) and `platform_right` (+X) of the technical frame (with both on one
  side, by X), without an axis `platform_end`. Landmarks with a `code` are shown and exported only for flakes.
* The platform: the curve of type `platform_outline` (one per flake; a new one takes the place of the old in
  one step; closed) parts the surface in two. The region of type `platform` with `auto: true` is the smaller of the two. All
  regions of type `platform` make the platform region.
* The faces: with an `edge` curve and a technical frame, the regions of type `ventral` and `dorsal` with `auto: true`: among the pieces of the
  upper layer, the one under the axis's end, and the largest other than it and the platform (at least 5 % of the surface; else the edge and
  the platform outline leave a way round, and neither is assigned). So the edge is open with its ends on a platform outline, and closed where there is none.
* A region with `auto: true` follows those annotations, and its `seed` says nothing. Given another type by hand it becomes an ordinary region
  at that place; a region the user has typed in that piece stands instead. These regions are the flake's: a core neither shows nor exports them.

**Derived** (`derived.flake`): `parameters`, `frameSource`, `measures` and `geometry` (points of the measures, for the
profile panel and external readers, original coordinates: `P`, `E`, `platformLine`, `epaPoints`, `ventral`, `ventralLine`).

Lengths are in the coordinate unit. Millimetre parameters are converted by `specimen.unit`; without a stated unit
what needs them is not measured.

| `measures` | definition |
|---|---|
| `tech_length` | the vertices' largest Y (P is at 0) |
| `tech_width`, `tech_thickness` | the range of the vertices' X, Z |
| `morph_length` | the largest distance between two vertices (found on the convex hull's vertices) |
| `morph_width` | every vertex projected onto the plane perpendicular to `morph_length`: the largest distance in it |
| `morph_thickness` | the range perpendicular to both |
| `morph_tech_angle_deg` | the `morph_length` direction projected onto the technical XY plane: its angle with the Y axis, 0–90° |
| `platform_width_chord`, `platform_width_path` | between the two ends: the straight distance; the shortest path along the surface within the platform region |
| `platform_depth_chord`, `platform_depth_path` | between P and E: the same |
| `platform_area` | the area of the platform region's triangles |
| `epa_3pt_1mm`, `_2mm`, `_3mm` | EPA, three points: between E→P along the platform line and E→Q_d |
| `epa_2ln_1mm`, `_2mm`, `_3mm` | EPA, two lines: between E→P along the platform line and the tangent at Q_d, away from E |
| `ipa` | between the platform line (P→E) and the line fitted to the ventral profile |

* **S**, the longitudinal section: where the plane X = 0 cuts the mesh, the line nearest P.
* **The platform stretch**: the part of S on the platform region nearest P; its end nearer P must be within
  `PLATFORM_START_EDGES` (3) mean edge lengths of P, else there is none and no platform measure at all (nor
  without a platform region or an axis). **E**: its far end. **The platform line**: the stretch resampled
  to `FIT_RESAMPLE_COUNT` equally spaced points, total least squares, directed P→E.
* **Q_d**: from E along S away from the stretch (the dorsal side), arc length d in `EPA_DISTANCES_MM`. **The tangent** at Q_d:
  the chord between the points `TWO_LINES_LENGTH_MM` / 2 before and after it along S. Empty when S ends first.
* **IPA's line**: from the stretch's near end along S away from it (the ventral side), up to S's largest Y, the part with
  Y in `IPA_BAND` × `tech_length`, resampled and fitted the same way, directed +Y. It keeps off the bulb and the distal curve.
* A line takes `MIN_FIT_POINTS` (2) points before resampling: a platform stretch always gives one, as does any part of the ventral side within the band (with the points where the band begins and ends). No such part: no IPA. Fewer than two ends: the two widths are empty.
* **Paths** run on the region's triangles only: the shortest way over its mesh edges; then, on the triangles that way passes
  through, over 3 points on each side, those crossings pulled taut.
* `parameters`: `STRIP_HALF_WIDTH_RATIO` 0.1, `STRIP_NORMAL_OUTLIER_DEG` 60, `FIT_RESAMPLE_COUNT` 200,
  `EPA_DISTANCES_MM` [1, 2, 3], `TWO_LINES_LENGTH_MM` 0.5, `IPA_BAND` [0.25, 0.75], `MIN_FIT_POINTS` 2, `PLATFORM_START_EDGES` 3.

## Edge angles

After Schunk et al. 2023 (3D-EdgeAngle). On a flake only. Measured on curves with `edgeAngle: true`, or, without that key, on `edge` curves (and `core_edge` curves, which a specimen has from when it was a core).
Lengths are in the coordinate unit; without a stated unit nothing is measured.

* **The line measured**: the curve, but for a flake's `edge` with a closed `platform_outline`: a run of its points within `EDGE_RIM_REACH_MM` (1 mm) of the outline and at least `EDGE_RIM_MIN_MM` (2 mm) long lies along the platform and is no part of the edge. What is measured is the longest stretch off such runs, an open line, each end going on to where it comes nearest the outline; an edge merely reaching the outline keeps all its points. The stations, edge angles, sharp stretches, working edges and retouch indices all go by this line, positions along it. The curve in the file keeps its points and `closed`, and goes on cutting the regions.
* **Reference curve**: the curve resampled every 1 mm, then a moving average `SMOOTH_WINDOW_MM` long (a closed curve goes round; an open
  one takes fewer points near its ends, which stay). It only sets the sections' direction.
* **Stations**: every `EDGE_ANGLE_STEP_MM` along it from its start; once round a closed curve (⌈length / step⌉), to the end of an open one (⌊length / step⌋ + 1).
* **At each station**: the section by the plane through the reference point, square to the reference curve, within 1.5 × the largest distance of
  it. A: the plane's crossing of the original curve nearest the reference point, on the section line nearest it (the station has no values when there is
  no crossing, or the line is over 3 mean edge lengths away). Q1, Q2: arc length d from A along the line each way, d in `EDGE_ANGLE_DISTANCES_MM`.
* `three_points`: the angle Q1 A Q2. `two_lines`: the angle between the chords `TWO_LINES_LENGTH_MM` long centred on Q1 and Q2, pointing away from A.
* Empty (null) where the line ends before d, or, on a closed line, where the two ways would meet.

**Derived** (`derived.edgeAngles`): `parameters` (`SMOOTH_WINDOW_MM` 5, `EDGE_ANGLE_STEP_MM` 1, `EDGE_ANGLE_DISTANCES_MM` [2, 5, 10],
`TWO_LINES_LENGTH_MM` 0.5); `curves`: `{ curveId, distances, length, stations }`, `distances` and `length` (of the reference curve) in the coordinate unit, each station `{ position, point, three_points, two_lines }` (`position`
along the reference curve, `point` A in original coordinates, the angles in the order of `distances`).

## Retouch layers

On a flake, an open curve of type `retouch` with both ends within reach of an `edge` curve (`JOIN_REACH_EDGES`, 4, mean segments of those curves) has a region that follows it: `type: "retouch"`, `auto: true`, `curveId`: that curve, `retouchLayer`: 1 until changed. Its `seed` says nothing. It is what lies between the curve and the edge: of the two sides of the curve, on the surface cut along the boundary curves and this curve, the smaller. On the curve, `retouchSide: "larger"` takes the other side, and `retouchSide: "off"` says the curve has no such region: the user deleted it, or gave it another type, which makes it an ordinary region at that place. All the pieces of the lower layer on that side are one region; a piece a region typed by hand holds stays that region's, and a piece in the bands of two curves goes to the smaller. A file from before these curves gains none: on opening, a curve that would qualify and has no such region is marked `off`.

A region of type `retouch` has a `retouchLayer` (integer from 1; 1 is the layer nearest the edge). Along the curves measured for edge angles, at the same
stations: the whole section by the same plane, followed from A both ways across the retouch regions it meets, without leaving them. A stretch shorter than
2 mean edge lengths is no layer, and two regions of one layer in a row are one (region borders follow mesh edges, so the points are good to about one edge).
For each layer: Pk its outer end, s the length from A along the section, Q the point at s on the other side.

* `three_points`: the angle Pk A Q. `two_lines`: the angle between the chords `TWO_LINES_LENGTH_MM` long centred on Pk and Q, pointing away from A.
* `layer_face`: the angle between this layer's own chord (its inner end to Pk) and the chord A to Q.
* Null where the other side ends before s, or, on a closed line, where the two ways would meet. A station without a layer has no stretch for it.

**Derived** (`derived.retouchAngles`): `curves`: `{ curveId, stations }`, each station `{ position, point, stretches }`, each stretch `{ region, layer, distance, three_points, two_lines, layer_face }`
(`region`: the id of the region where the layer begins; `distance`: s).

## Retouch indices

Worked out from the retouch regions and the edge, with no further annotation; flakes only.

```json
"flake": { "retouch": { "fitLength": null, "axis": "auto", "flip": false } }
```

`fitLength`: w below, in mm (1 to 20, in steps of 0.5, out of range the nearest; null: the default, 5). `axis`: the frame of the plan, `auto` (the technical frame when there is one, else the longest axis), `technical` or `longest`. `flip`: the longest axis the other way round, the two ends exchanged. Files without it: these defaults.

Lengths are in the coordinate unit, millimetre parameters converted by `specimen.unit`. Without a stated unit there are no stations, and what needs them is empty.

**At a station.** The curves are those with edge angles, the stations theirs (one every 1 mm). A station is retouched when a layer lies on either side of it. A weight goes with each: the spacing; the two ends of an open curve half of it, so that 30 mm have 31 stations and weigh 30.

* A triangle's part of the flake: the type of the upper region it lies in (`dorsal`, `ventral`, `platform` or none). A side's part: where it first runs, stretches shorter than 2 mean edge lengths not counting (region borders follow mesh edges and the curve need not). One side must be dorsal and the other ventral, else the part is not told (`no_faces`).
* D: on a side, from the edge along the section to the outer end of its deepest layer, R; without retouch D = 0 and R = A.

**The original surface** (after Morales et al. 2015). On each side a line is fitted to the section from arc length D on, up to w further, stopping earlier where the side leaves its part, where other retouch begins (stretches of less than 2 mean edge lengths do not count) or at the end of the section. Then again, the stretch ending at the side's ridge as well: of the points of the side within its part, the one furthest from the other side's first line; peaks of that distance within a mean edge length of the highest are as high, and the last along the section is taken. A stretch shorter than `ORIGINAL_FIT_MIN_SHARE` × w gives no line (`no_original_surface`; so does a ridge before R). Lines: resampled to `FIT_RESAMPLE_COUNT` points, total least squares.

The two lines meet at A0. Each runs from F (R, or A without retouch) toward the edge; where they meet must lie at least −`MEET_TOLERANCE_EDGES` mean edge lengths along both, and they must be `MIN_MEET_DEG` apart or more, else `lines_do_not_meet`. The missing area: the polygon A0, F₁, along the section to A, along the section to F₂, by the shoelace formula in the section's plane. `original_angle_deg`: between the two lines. `recession`: from A to A0. No upper limit: nearly parallel lines give large values, as they are.

**The reduction** (Eren et al. 2005). A retouched station without a missing area takes one (`filled`) from the retouched stations on either side along the curve, by position (a closed curve goes round); from one side, that one; none on the curve, 0. `erp_filled_share`: filled stations / retouched stations. `removed_volume`: Σ weight × missing area. `erp`: `removed_volume` / (`removed_volume` + the model's volume).

**GIUR** (Kuhn 1990). The stations with retouch on one side only, dorsal or ventral (both sides: `bifacial`). The reference line: fitted to the ventral side, from R (A when it has no retouch) to where it leaves the ventral face; no such stretch: `no_original_surface`. t (`retouch_height`): the thickness where the retouch ends, from R on the dorsal side to that line; with the retouch on the ventral side, from the first point of the dorsal side straight above R. T (`thickness`): the largest distance to the line of the dorsal side, from A to where it leaves the dorsal face. `giur`: the mean of t/T over those stations, of both faces; `giur_stations`: how many.

**The plan.** `technical`: the technical frame, Y from 0 to the technical length (what lies below 0 goes to the first row). `longest`: Y along the morphological length, so that its dot product with the specimen frame's +Y is not negative (as the length's direction falls without a specimen frame), the other way with `flip`; Z the area-weighted mean normal of the dorsal triangles without its Y component (no dorsal face: of the ventral ones, turned round); X = Y × Z; Y from the vertices' smallest to their largest, the origin the origin of the file's coordinates. Fails (`frame_failed`) without a dorsal or a ventral face. Y: the range [y0, y1], L = y1 − y0.

**Invasiveness** (Clarkson 2002). Rows: ⌊5(y − y0)/L⌋, from 0 at the proximal end. The outline: the vertices in `OUTLINE_BINS` cells along y give xL and xR (mid, half width), along x they give yTop and yBot; empty cells between their neighbours. Each retouch triangle on the dorsal or ventral face goes by its centroid to a segment: row 1 is segment 1, row 5 segment 8, rows 2 to 4 left and right of mid(y) by the plan's X, 2 / 4 / 6 and 3 / 5 / 7. The ventral face is not mirrored: its segments are 8 more, 9 to 16. How far in (p, 0 to 1): from the sides, 1 − |x − mid(y)| / half width(y), which is p in rows 2 to 4; in row 5 the lesser of that and (yTop(x) − y) / (yTop(x) − (y0 + 0.8 L)); in row 1 the lesser of that and (y − yBot(x)) / ((y0 + 0.2 L) − yBot(x)); each limited to [0, 1], 1 where the divisor is not positive. A segment's p_max (`penetration`) is the largest of its triangles (none: 0). `score`: 0 without retouch, 0.5 up to `INVASIVE_BOUNDARY`, else 1. `invasiveness`: the sum of the scores / 16. `invasiveness_continuous`: the sum of p_max / 16.

**The perimeter** (Barton 1988; Brumm & McLaren 2011). Only curves of type `edge` with edge angles. `retouch_perimeter`: the weights of the retouched stations (each once) / of all the stations. `retouch_perimeter_dorsal`, `_ventral`: of the stations retouched on that side.

**The curvature** (R6/R3, Hiscock & Attenbrow 2003, 2005). Retouched stations next to each other along an `edge` curve, gaps of up to `RETOUCH_MERGE_GAP_MM` included, make a stretch; the one with most weight counts. Its A points on the plan: `edge_curvature_chord` (R3) from the first to the last; `edge_curvature_depth` (R6) the point furthest from that chord, positive away from the outline's centre (the mean of all the vertices; convex), negative toward it; `edge_curvature` = R6 / R3.

**A retouch region on a curve** (`segments`; a notch marked as a region of its own has its diameter and depth here): the stations where it is a stretch of the section. `start_position`, `end_position`: round a closed curve from behind its widest gap, so `start_position` may lie after `end_position`. `length`: their weights. `chord`, `depth`: as above over their A points; null where it goes all the way round. `face`: the side it mostly lies on.

**Not retouched.** A flake without any retouch region has 0 for all of these but the curvature, whatever else is missing, and sixteen rows of 0.

**Empty values.** The reasons are for the screen: neither in the file nor in the tables. In order: the reduction: `no_unit`, `no_retouch_on_edge`, `no_faces` (no retouched station is told), `too_many_gaps` (`erp_filled_share` above `ERP_MAX_FILLED_SHARE`), and for `erp` alone `mesh_open`. GIUR: `no_unit`, `no_retouch_on_edge`, `no_faces`, `no_unifacial_station`. Invasiveness: `no_faces`, `no_axis` (`technical` chosen, no technical frame), `frame_failed`. The perimeter: `no_unit`, `no_edge`; the two faces also `no_faces`. The curvature: `no_unit`, `no_retouch_on_edge`, `whole_edge`, `no_axis`, `frame_failed`.

**Derived** (`derived.retouchIndices`): `parameters` (`FIT_RESAMPLE_COUNT` 200, `ORIGINAL_FIT_MM` 5, `ORIGINAL_FIT_MIN_SHARE` 0.5, `MIN_MEET_DEG` 1, `MEET_TOLERANCE_EDGES` 1, `FIT_LENGTH_RANGE_MM` [1, 20], `ERP_MAX_FILLED_SHARE` 0.25, `OUTLINE_BINS` 200, `INVASIVE_BOUNDARY` 0.5, `RETOUCH_MERGE_GAP_MM` 2); `fitLength` (mm) and `axis` (`technical`, `longest` or null) as used; `frame` (`{ origin, x, y, z, y0, y1 }`, original coordinates; null: none); the values `removed_volume`, `erp`, `erp_filled_share`, `giur`, `giur_stations`, `invasiveness`, `invasiveness_continuous`, `retouch_perimeter`, `retouch_perimeter_dorsal`, `retouch_perimeter_ventral`, `edge_curvature`, `edge_curvature_chord`, `edge_curvature_depth`; `stations` (`{ curveId, station, position, segment, x, y, depth_dorsal, depth_ventral, removed_area, filled, original_angle_deg, recession, retouch_height, thickness, giur }`, the retouched ones); `segments` (`{ curveId, region, layer, face, start_position, end_position, length, chord, depth, middle }`, `region` by id; `middle`: where its middle station is along the curve); `penetration` (`{ face, segment, penetration, score }`, sixteen; none when they cannot be told).

## Working edges

A working edge is a stretch of a curve measured for edge angles (a flake's `edge` is one outline, on which geometric morphometrics and the faces depend; two edges of a scraper are stretches of it). A flake's: on another type they stay in the file with nothing measured on them.

```json
"workingEdges": [
  { "id": "…", "label": "E1", "name": "left side", "curveId": "…", "start": [12.1, 3.4, 0.2], "end": [-11.8, 4.0, 0.1], "createdAt": "…", "modifiedAt": "…" }
],
"nextWorkingEdgeNumber": 2
```

* `label`: `E{n}`, given in turn, never used again. `name`: the user's, may be empty. `curveId`: its curve; one on a curve the file does not have is dropped on reading.
* `start`, `end`: points on the curve, original coordinates. They are placed on the curve's reference curve (see "Edge angles": the nearest point) whenever they are used, so they follow the curve when it changes. Without a stated unit there is no reference curve, and positions are along the curve itself.
* **Its stretch**: on an open curve, between the two, in either order. Round a closed curve, from `start` in the curve's direction to `end`, which may go on past the curve's start; exchanging the two gives the other stretch.
* **Limits**: at least `WORKING_EDGE_MIN_MM` (2) long (no check of the length without a stated unit), and no overlap with another on the curve; they may share an end. A curve deleted takes its working edges with it. A curve no longer measured keeps them, and they take no part in anything until it is measured again.
* **A curve measured without any** counts as one implied working edge, its whole length. It is not in `workingEdges`; in the tables its `working_edge` is empty, and `curve_id` tells it. A curve with some has no implied edge: what lies outside them counts only for the specimen as a whole.
* **Stations**: each stands for the stretch from half a step before it to half a step after it, within the curve (round a closed curve the last, possibly shorter, gap is shared in its middle). A station's weight (see "Retouch indices") goes to the working edges by the share of that stretch in each, so that edges parting a curve add up exactly to it. A station belongs to the edge whose stretch holds its position; on the boundary of two, to the one that begins there; at the end of one with nothing after it, to that one. That is the `working_edge` of the per-station tables.

**What is measured** on each, with those weights; on a flake only, except the length and the sharp length:

* `removed_volume`: Σ weight × missing area, the missing areas as filled in along the whole curve. `erp_filled_share`: the weight of its filled stations / of its retouched stations; above `ERP_MAX_FILLED_SHARE` its `removed_volume` and `erp` are empty (`too_many_gaps`), whatever the specimen has. `erp`: `removed_volume` / (the specimen's `removed_volume` + the model's volume), so the edges' add up to the specimen's, less the stations in none; empty as the specimen's is, or when the specimen's `removed_volume` is.
* `giur`, `giur_stations`: as the specimen's, over the stations that belong to it. `retouched_length`: the weights of its retouched stations. `retouch_perimeter`, `_dorsal`, `_ventral`: those weights (of that side's) / its `length`.
* `edge_curvature`, `_chord`, `_depth`: R6 / R3, R3, R6 as the specimen's, over all the stations it takes in (both ends included, retouched or not) on the plan. An implied edge on a closed curve has none (`whole_edge`).
* A working edge with no retouched station counts as not retouched: 0 for all of these but the curvature.
* `length`: the weights of all its stations (the length of its stretch without stations). `sharp_length`: the part of the sharp stretches in it; empty without a threshold.

**Derived** (`derived.workingEdges`, absent while no curve is measured): `parameters` (`WORKING_EDGE_MIN_MM` 2); `edges`: per row of `working_edges.csv`, `{ id, label, name, curveId, start_position, end_position, length, sharp_length, retouched_length, retouch_perimeter, retouch_perimeter_dorsal, retouch_perimeter_ventral, removed_volume, erp, erp_filled_share, giur, giur_stations, edge_curvature, edge_curvature_chord, edge_curvature_depth }` (`id`: the curve's for an implied edge, whose `label` is empty). `start_position`, `end_position`: along the reference curve; round a closed curve the first may lie after the second. `segments` of `derived.retouchIndices` also have `middle`: the position of the region's middle station, which says its working edge.

## Sharp edge

```json
"sharpEdge": { "method": "three_points", "distance": 2, "threshold": 45 }
```

`method`: `three_points` or `two_lines`; `distance`: in mm, one of `EDGE_ANGLE_DISTANCES_MM`; `threshold`: degrees, the user's, null until set. In a folder the rule is the
folder's: `LithicAnalyst/sharp-edge.json` holds it, and it stands in for the value in each project, so every model is judged alike.

A station is sharp when its angle in that series is at most the threshold (no value: not sharp). Gaps of at most `SHARP_MERGE_GAP_MM` (2) are filled, then
stretches shorter than `SHARP_MIN_RUN_MM` (3) dropped; the ends of an open curve are no gaps. Round a closed curve a stretch may go on past the start (`start` after `end`).

**Derived** (`derived.sharpEdge`): `rule`, `parameters` (those two, and `SHARP_AUTO_BIN_DEG`, `SHARP_AUTO_MIN_GAP_DEG`, `SHARP_AUTO_MAX_VALLEY` of the suggested threshold), `curves`: `{ curveId, length, segments }`, each segment `{ start, end, length }` in the coordinate unit.

## Geometric morphometrics

```json
"gm": {
  "version": 2,
  "fixed": { "pop": true, "platform_left": true, "platform_right": true },
  "edge": { "on": true, "points": 50 },
  "platformOutline": { "on": true, "points": 10 },
  "ventral": { "on": true, "rows": 15, "cols": 10 },
  "dorsal": { "on": true, "rows": 15, "cols": 10 },
  "platform": { "on": true, "rows": 4, "cols": 8 },
  "surfaceMethod": "grid",
  "landmarks": [{ "name": "tip" }, { "name": "base" }],
  "curves": [
    { "curveType": "midline", "count": 20, "start": "tip", "end": "base" },
    { "curveType": "rim", "count": 30, "closed": true, "start": "tip", "via": "base" }
  ],
  "patches": [{ "regionType": "cortex", "count": 100 }],
  "template": {
    "file": "site1/A.ply",
    "sha256": "…",
    "seed": 1,
    "patches": [{ "regionType": "cortex", "points": [{ "face": 12, "bary": [0.2, 0.3, 0.5], "point": [1, 2, 3] }] }],
    "anchors": [[1, 2, 3]],
    "anchorsHash": "…",
    "regionsHash": "…"
  }
}
```

In a folder the configuration is the folder's: `LithicAnalyst/gm-config.json` holds it, and it stands in for the value in each project. Files without `version` (written before these lists) read as `grid` with empty lists and no template.

* A flake: `fixed` to `platform`. `points`: of a curve (`platformOutline`: of each of its three parts), both its ends among them, at least 2; `rows`, `cols`: at least 1; at most 500.
  `surfaceMethod`: `grid` (the rows and columns below) or `template` (`patches`, in place of the grids).
* A core or a general specimen: the three lists, whose order is the order of the export. No names are preset, and with the lists empty it has no points.
  * `landmarks`: matched by name to the specimen's landmarks.
  * `curves`: of `curveType`, `count` points equally spaced by arc length, both ends among them. Open: the stretch between the points nearest the landmarks `start` and `end`. `closed`: from the point nearest `start`, the way that reaches `via` sooner, once round; its end is its start. An end that is a listed landmark is that one point; any other is written once, where it is first needed.
  * `patches`: by the template. `count`: 10 to 2000.
* `template`: the specimen the points were laid on, by the model's path and checksum, and the `seed` they were laid by. `patches`: per item of `patches`, in order, each point's triangle and barycentric coordinates and its place in original coordinates (`point`; `face` is the triangle's number in the app's mesh, whose order may not be the file's). `anchors`: its fixed and curve points in order. The two hashes: of those anchors, and of the annotations the regions come from.

A landmark, curve or region type that a specimen lacks, or has more than one of, makes the specimen incomplete, with its reason.

The points, in their order. None can be moved on its own; a change of the configuration changes no annotation.

**A flake by the grid:**

1. **Fixed**: `pop`, `platform_left`, `platform_right` (as asked for), then the user's own landmarks.
2. **Curves**, equally spaced, both ends among them. A curve's end is a single point: the fixed landmark, or, when that is left out, a point (kind `curve`) written where it is first needed.
   * `edge`: from the left end, by the distal end, to the right end (clockwise with the dorsal face toward the viewer). A closed curve is cut at the points nearest the ends, and the part reaching further distally taken. Without platform ends it begins and ends at the point of percussion, clockwise.
   * `platform_left_pop`, `platform_pop_right` (the inner rim), `platform_right_left` (the outer rim): the closed platform outline, parted at the points nearest the three landmarks; each part ends on its landmark.
   * Then the user's own sets of semilandmarks.
3. **Surfaces**, row by row:
   * `ventral`, `dorsal`: in the technical frame. The polygon of the edge and the inner rim (a point platform: the edge alone) in the XY plane. Row i of R at Y = Ymin + i/(R+1) × (Ymax − Ymin); between the row's leftmost and rightmost crossings of the polygon, column j of C at i/(C+1). A line along Z there: the lowest crossing of the mesh for the ventral face, the highest for the dorsal.
   * `platform`: the plane fitted to the platform region's vertices, weighted by area, its normal n away from the flake's middle; u the direction from the left end to the right in it, v = n × u from the inner rim to the outer. Column j of C at j/(C+1) between the two ends' u; row i of R at i/(R+1) from the inner rim to the outer along v; down n onto the region's triangles.

**By a template** (a core, a general specimen, a flake by `template`): the fixed and curve points as above, or as the lists say, then the patches. A flake's anchors are its fixed landmarks and the curve points of the edge and the outline.

* **Laying**, on the template, region by region: `20 × count` candidates drawn by area with the seed (mulberry32; the n-th patch by `seed + n`), those nearer the region's boundary than `0.5 × s` left out (`s = sqrt(area / count)`), then farthest-point sampling (Euclidean), the first the first candidate left. The order taken is the points' order. Laying again goes on to the next seed. Parameters: `GM_TEMPLATE_PARAMETERS`.
* **Passing on**, to any other specimen: with at least 4 anchors, a similarity (Kabsch and one scale, never a mirror image) takes the template's anchors and points onto the specimen's; a thin-plate spline fits what is left at the anchors (the displacements; kernel `U(r) = r`; the affine part the least-norm solution by the pseudo-inverse, relative cutoff `1e-8`, so anchors in a plane leave what lies across it to the similarity); then each point goes to the nearest place on the triangles of its region. Pairs repeating an anchor count once. Parameters: `TPS_PARAMETERS`.
* **The check**: a point is flagged when it moved further than `0.5 × s` onto the region, or lies nearer another of its patch than `0.25 × s` (`s` by the region on this specimen). It is neither moved nor left out.
* The template's own points are those laid. Every specimen has the same rows; what it lacks has `missing: true` and no coordinates (`null` in the file, `NA` in the exports).

**Derived** (`derived.gm`): `config` (as above, of `template` only `file`, `sha256`, `seed`, the two hashes and `points`, how many), `complete`, `missing` (codes, below), `rows` (`{ index, name, kind, setId, point }`, original coordinates; `kind`: `fixed`, `curve` or `surface`), `curves` (`[before, slide, after]` by point number from 1), `surfaces` (point numbers). A result saved before the lists has in `config` the grid's fields alone. By a template also: `method: "template"`, `details` (`{ code, name }`: which landmark, curve or region a code is about), `flagged` (point numbers), `key` (a hash of what the points are made from: the template's points and anchors, the specimen's anchors, regions and mesh, the configuration's version; while it is the same a summary uses them), and in `rows` `setIndex` (the number within its curve), `flagged` and `missing`. By the grid `method: "grid"`.

`missing`: `technical_axis`, `platform_ends`, `edge`, `platform_outline` (a closed one), `platform_region`, `ventral_miss`, `dorsal_miss`, `platform_miss` (a point finds no triangle), `point_count`; `landmark_missing`, `landmark_ambiguous`, `curve_missing`, `curve_ambiguous`, `curve_ends` (a row without its ends), `region_missing`, `region_ambiguous`, `no_template`, `template_missing` (its model is not in the folder: nothing is passed on), `template_stale` (the lists no longer match what was laid), `too_few_anchors`, `no_fit`. By the grid a specimen lacking any of them has no GM exports; in a summary it is listed instead, with `point_count` for one whose number of points differs from the others' (the user's own landmarks). By a template it is exported with `NA` where it lacks, and listed in the manifest's `gmIncomplete`; only a specimen with no point at all is left out.

## Surface region

```json
{ "id": "…", "label": "R1", "seed": [12.1, -3.4, 8.8], "type": "cortex", "scarId": null, "createdAt": "…", "modifiedAt": "…" }
```

* The curves split the surface into pieces: each curve is turned into mesh edges (each point to
  its nearest vertex, gaps joined by shortest paths over mesh edges), and triangles are grouped
  across all other edges. A region is the piece that holds its `seed` (the clicked surface point).
* `type`, in two layers. **Lower** (the pieces between all the curves): `scar` (worked), `cortex`, `joint` (unworked surfaces), `damage`, `retouch` (see "Retouch layers"); **a value that is none of the codes is the annotator's own text**, a type of the lower layer. **Upper** (the pieces between the boundary curves alone): `flaking_surface` and `platform` on a core, whose boundary curves are its `core_edge` curves; `platform`, `ventral` and `dorsal` on a flake, whose boundary curves are its `edge` and `platform_outline` curves. The lower layer is cut along every curve the upper one is, so a lower region lies wholly in one upper piece; a scar crossing a boundary is two pieces (two regions, which may name the same `scarId`). Two regions in one piece of the same layer are a conflict; a region and the part it lies in are not. A scar region links
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

* Fixed landmarks: a surface point (snapped onto the nearest place of a ridge or valley when the snap setting
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
| `region` | least-squares plane of the vertices of the surface regions in `regionIds`, each weighted by a third of the area of its triangles there | the weighted mean |

A flake offers `curves` and `region`, a core the first four, a generic specimen `all_vertices`, `curves` and `region` (a plane made on another type keeps its method).

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
* `completion` (optional): the curve was closed by "Complete loop" —
  `{ "method": "outline", "firstAutoAnchor": n, "stepDeg": 2, "anchorStepDeg": 12 }`, and
  `userAnchors` (ascending indices) when some of them were moved since. The anchors from
  `firstAutoAnchor` on were placed automatically: the curve's points were fitted with a plane
  (rejected when the second principal variance is under 1 % of the first); the mesh's vertex
  centroid projected onto it is the centre; the curve had to go at least 90° round it. Seen along
  the plane's normal, the gap was sampled: cut into stretches of about `stepDeg` degrees (centred
  every step from the curve's end), and in each the vertex furthest from the centre taken (one more
  than 10 % nearer the centre than another within three stretches is left out). Each sample was
  snapped onto a ridge within 5 % of its distance from the centre, and they were joined by the curve
  tracing (ridge mode) from the curve's end round to its start. Then the anchors were thinned: the
  sample nearest each multiple of `anchorStepDeg` degrees stays, and the line is traced again between
  those; where it runs more than 2 mean edge lengths of the mesh from the line through all samples,
  the sample furthest from it stays too (and so on). Curves completed before this have no
  `anchorStepDeg`: an anchor for every sample. An automatic anchor the user moves is added to
  `userAnchors`; when all are there, `completion` is removed. Segments with an automatic anchor at either end are drawn dashed. A
  `completion` that does not fit the curve's anchors is dropped when the file is read.

### Curve attributes

| key | values |
|---|---|
| `type` | `scar_boundary` 片疤轮廓 / Scar outline · `core_edge` 石核边缘 / Core edge (offered for cores; bounds the upper layer of regions) · `edge` 边缘 / Edge (flakes; bounds it too) · `cortex` 石皮 / Cortex · `joint` 节理面 / Joint surface · `platform_outline` 台面轮廓 / Platform outline (flakes; closed, one per flake; bounds it too) · `retouch` 修理 / Retouch; empty: not filled in (new curves). Older codes `ridge` 棱脊 and `other` 其他 are read and written as they are but no longer offered; a code of the other type of specimen is shown but not offered. **A value that is none of these codes is the annotator's own text** (a custom type) |
| `note` | free text |

`edgeAngle` (optional, on the curve): whether its edge angles are measured; without it, as its type says (see "Edge angles").

A custom type is stored trimmed; text that is a code or a name (Chinese or English, any case) of one
of the four offered types is stored as that code. In the observer agreement, curves are matched
within one type, a custom text being a type of its own.

## CSV export

One row per scar that has a direction arrow (scars with `"vector": null` are left out;
`termination` is empty when not judged yet; `platform_face` is the scar's platform in the volumetric
configuration, a face code, and `flaking_surface` its flaking surface, e.g. `F1` — empty when the
scar's face is no flaking surface, and both empty before the mesh is measured or for a flake;
`tech_angle_deg`, for a flake with a technical frame: the arrow projected onto the frame's XY plane, +Y
being 0° and counter-clockwise as seen from the dorsal side positive, in (−180°, 180°]; else empty):

```
specimen_id,scar_id,start_x,start_y,start_z,end_x,end_y,end_z,length,completeness,termination,certainty,note,platform_face,flaking_surface,unit,tech_angle_deg
```

Flakes (`<specimen>_flakes.csv`, one row per flake, empty where there is no value; see "Flakes"; `frame_source` is
`specimen.frame.source`, or `principal` without a frame):

```
specimen_id,unit,frame_source,tech_length,tech_width,tech_thickness,morph_length,morph_width,morph_thickness,morph_tech_angle_deg,platform_width_chord,platform_width_path,platform_depth_chord,platform_depth_path,platform_area,epa_3pt_1mm,epa_3pt_2mm,epa_3pt_3mm,epa_2ln_1mm,epa_2ln_2mm,epa_2ln_3mm,ipa,retouch_axis,retouch_fit_length,removed_volume,erp,erp_filled_share,giur,giur_stations,invasiveness,invasiveness_continuous,retouch_perimeter,retouch_perimeter_dorsal,retouch_perimeter_ventral,edge_curvature,edge_curvature_chord,edge_curvature_depth
```

The last fifteen are the retouch indices, see "Retouch indices": `retouch_axis` `technical` or `longest`, empty without a frame; `retouch_fit_length` in mm; lengths in the unit, `removed_volume` in unit³; shares as decimals from 0 to 1.

Retouched stations (`<specimen>_retouch_sections.csv`, one row per retouched station; `station` counts from 0; `segment` the segment of A, 1 to 8, on the plan, whichever face; `x`, `y` A on the plan; `removed_area` in unit²; `filled` `true` when that area comes from the stations on either side, and then `original_angle_deg` and `recession` are empty; `retouch_height`, `thickness`, `giur` empty where the station takes no part in GIUR; `working_edge` the label of the working edge it belongs to, empty when in none or on a curve without any):

```
specimen_id,curve_id,station,position,segment,x,y,depth_dorsal,depth_ventral,removed_area,filled,original_angle_deg,recession,retouch_height,thickness,giur,working_edge
```

Retouch regions along the curves (`<specimen>_retouch_segments.csv`, one row per region and curve; `retouch_region` by label; `face` `dorsal` or `ventral`; `chord` and `depth` empty where it goes all round a closed curve; `working_edge` that of the region's middle station):

```
specimen_id,curve_id,retouch_region,retouch_layer,face,start_position,end_position,length,chord,depth,working_edge
```

Invasiveness (`<specimen>_invasiveness.csv`, sixteen rows per flake; `segment` 1 to 16, the ventral face's 9 to 16; `penetration` p_max; `score` 0, 0.5 or 1):

```
specimen_id,face,segment,penetration,score
```

Volumetric configuration (`<specimen>_configuration.csv`, one row; codes as in the project file,
empty where a trait has no value; `model` is `box` or `bicone`, written for both — the bicone
leaves the two relations and the polarity empty; with the bicone `platform_face` in the arrow CSV
is empty and `flaking_surface` is the scar's cone's surface):

```
specimen_id,model,frame,facial_character,flaking_surface_relation,platform_relation,polarity
```

Flaking surfaces (`<specimen>_flaking_surfaces.csv`, one row per surface; `faces` and `platforms`
are face codes joined by `;`; `also_platform` is `true` when one of its faces is a platform of
another surface's scars; for the bicone, one row per flaking cone, upper first, `faces` `upper` or
`lower` and `platforms`, `also_platform`, `surface_type`, `exploitation_axis` empty):

```
specimen_id,surface_id,faces,platforms,also_platform,n_scars,surface_type,exploitation_axis
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
specimen_id,unit,frame,length,width,thickness,surface_area,volume,closed
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

Surface regions (`<specimen>_regions.csv`, one row each; `type` a code or the annotator's own text; `parent_region`: the upper region a lower one lies in, by its `region_id`, else empty):

```
specimen_id,region_id,type,scar_id,area,unit,parent_region,retouch_layer
```

`retouch_layer`: of a retouch region, else empty.

Retouch layers (`<specimen>_retouch_angles.csv`, long format: one row per station, layer and method; see "Retouch layers"; `retouch_region`: where the layer begins; `distance`: from the edge to the layer's outer end, along the section; `method` `three_points`, `two_lines` or `layer_face`; `working_edge` that of the station):

```
specimen_id,curve_id,station,position,retouch_region,retouch_layer,distance,method,angle_deg,working_edge
```

Geometric morphometrics (see "Geometric morphometrics"): the coordinates as the landmarks' (`<specimen>_gm_landmarks.tps`, `.fcsv`, `.csv`; `kind` also `surface`, `set_id` the curve or grid), and for geomorph's sliding:

```
before,slide,after      <specimen>_gm_curves.csv (by point number from 1; the ends of a curve do not slide)
index                   <specimen>_gm_surfaces.csv
```

By a template the table has two more columns, what is missing is `NA` in all three coordinate files, and there is what Morpho's `slider3d` takes:

```
specimen_id,index,name,kind,set_id,x,y,z,set_index,flagged     <specimen>_gm_landmarks.csv (name: the landmark, curve type or region type; index: the point's number in the specimen; set_index: within its curve or patch; flagged: 0 or 1)
index                   <specimen>_gm_smvector.csv (SMvector: the points that slide along a curve)
outline,index           <specimen>_gm_outlines.csv (outlines: each curve's points in order, ends included)
index                   <specimen>_gm_surp.csv (surp: the same as gm_surfaces.csv)
specimen_id,model       <specimen>_gm_models.csv (the path of each specimen's model, within the folder, for sur.path)
```

By the grid the files and their bytes are as they always were. The summary of a folder has one `gm_landmarks.csv` and `gm_landmarks.tps` of its specimens (all by the same way of making the points, and with as many), and one definition of each.

Working edges (`<specimen>_working_edges.csv`, one row per working edge of each curve measured, and one per such curve without any, `working_edge` empty; see "Working edges"; lengths in the coordinate unit, the volume in unit³, ratios as 0 to 1; those from `retouched_length` on empty for a core or a general specimen; in a folder's summary `sharp_length` is by the folder's rule):

```
specimen_id,working_edge,name,curve_id,start_position,end_position,length,sharp_length,retouched_length,retouch_perimeter,retouch_perimeter_dorsal,retouch_perimeter_ventral,removed_volume,erp,erp_filled_share,giur,giur_stations,edge_curvature,edge_curvature_chord,edge_curvature_depth
```

Sharp edge (`<specimen>_edge_sharp.csv`, one row per sharp stretch, under the rule, cut in two where a working edge begins or ends: the rows of one stretch have its `segment`, from 1, and their lengths add up to its length; see "Sharp edge"; `distance` in the coordinate unit; `working_edge` the working edge it lies in, empty when in none):

```
specimen_id,curve_id,method,distance,threshold_deg,segment,start_position,end_position,length,working_edge
```

Edge angles (`<specimen>_edge_angles.csv`, long format: one row per station, distance and method of each curve measured; `station` counts from 0, `position` along the reference curve, `distance` d in the coordinate unit; `method` `three_points` or `two_lines`; `angle_deg` empty where there is none; `working_edge` that of the station; see "Edge angles"):

```
specimen_id,curve_id,curve_type,station,position,distance,method,angle_deg,working_edge
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
    sharp-edge.json                               what counts as a sharp edge in this folder
    gm-config.json                                which points its specimens have for geometric morphometrics, and the template's
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
* `manifest.json`: `app` (`name`, `version`, `author`, `license`, `repository`, `citation`: how to cite
  this version, APA style), `createdAt`, `scope` (`specimen` or `folder`), `folder`, `kind`
  (`tables` or `figures`), `options`, `parameters` (`flake`, `edgeAngle`, `retouchIndex`, `sharpEdge`: the named parameters of the flake measurements, the edge angles, the retouch indices and the sharp edge, with its `rule`; `gm`: the configuration; `gmTemplate`, `tps`: the laying's and the spline's), `gm` (`surfaceMethod`, `configVersion`, `template`: the template's model, `seed`), `gmSkipped` (`file`, `id`, `missing`: specimens left out of the coordinates of a summary), `gmIncomplete` (the same: those in it with `NA` where they lack), `specimens` (`id`, `file` = model path, `sha256`, `project`
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

In the summary export, `flakes.csv` holds the flakes, from the `derived.flake` their project files stored
(the open model: as measured now). `configuration.csv` and `flaking_surfaces.csv` hold the cores that have a
configuration (arrows on a measured model) and end with a `file` column as well. A project's stored
box (`derived.configuration`) stands for its model like the other stored results; the bicone needs
no box and uses the project's stored split (`derived.split`).

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
| — | `specimen.type`, `flake`, `annotations.measurements`, `nextMeasureNumber`, `annotations.planes`, `nextPlaneNumber`, `annotations.sections`, `nextSectionNumber`, `annotations.regions`, `nextRegionNumber`, `annotations.relations`, `annotations.sequences`, `nextSequenceNumber`, `annotations.landmarks`, `annotations.semilandmarks`, `nextLandmarkNumber`, `nextSemilandmarkNumber`, `configuration` |
| `annotations.curves`, `nextCurveNumber` optional | always written |

The arrow CSV is unchanged.
