# LithicAnalyst project file — format version 1

A project file (`*.lithicanalyst.json`) holds everything annotated on one mesh. It does not
contain the mesh itself; it records the mesh's SHA-256 so the app can tell when a project is
opened on a different file.

The format is the long-lived contract of the tool. Any change that existing readers cannot
ignore needs a new `formatVersion` and a migration in `src/core/schema.ts`.

## Coordinates

* Every coordinate is in the **original coordinate system of the mesh file**, in the unit
  given by `specimen.unit` (coordinates are never rescaled).
* The app re-centres geometry internally for float precision; that offset never reaches the file.

## Top level

| key | type | notes |
|---|---|---|
| `format` | `"lithicanalyst-project"` | required |
| `formatVersion` | `1` | required |
| `app` | `{ name, version }` | software that wrote the file |
| `savedAt`, `createdAt`, `modifiedAt` | ISO 8601 strings | |
| `specimen` | `{ id, annotator, unit, notes }` | |
| `mesh` | object or `null` | `fileName`, `format`, `fileSize`, `sha256`, `vertexCount`, `triangleCount`, `bboxMin`, `bboxMax` |
| `annotations.scarVectors` | array | in creation order |
| `nextLabelNumber` | integer | next automatic label (`S{n}`) |

Readers should ignore keys they do not know. Future annotation layers (landmarks, curves,
surface regions) will be added next to `scarVectors` inside `annotations`.

## Scar vector

```json
{
  "id": "6f0c1c2e-6b0e-4d3f-9a7e-3a1f2b9c8d10",
  "label": "S4",
  "start": [12.734, -3.118, 9.905],
  "end": [2.051, 1.877, 11.402],
  "startNormal": [0.12, -0.05, 0.99],
  "endNormal": [0.02, 0.01, 0.99],
  "attributes": { "completeness": "bulb_truncated", "certainty": "certain", "note": "" },
  "createdAt": "2026-10-15T20:31:02.114Z",
  "modifiedAt": "2026-10-15T20:31:40.551Z"
}
```

* `start` is the origin of the removal (point-of-percussion side); `end` is the termination.
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

## CSV export

One row per scar vector:

```
specimen_id,scar_id,start_x,start_y,start_z,end_x,end_y,end_z,length,completeness,certainty,note,unit
```

Enumerated fields are written as their codes, which are the same in every interface language.
Numbers use `.` as the decimal separator and up to six decimals. Text is quoted per RFC 4180.
The optional UTF-8 byte-order mark helps Excel read non-ASCII notes.
