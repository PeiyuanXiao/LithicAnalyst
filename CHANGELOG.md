# Changelog

## Unreleased

- Fixed: a note or a label typed is one undo step however long the typing takes, as long as it does not pause for 1.5 s; on a slow computer a note could break into several steps, the window running from its first letter. After an undo or a redo the next change is a step of its own.
- Changed: measurement cards regrouped with clearer headings and tables. A group's title is set in the interface's type with a fine line between groups; a small table's heads are small monospaced type and its corner says what it measures and in what unit ("mm", "VI (mm)"). A flake's automatic measures are four groups: Dimensions (technological and morphological length, width and thickness as one table; the angle between their axes, the area, the volume), Platform (width and depth, chord and along the surface; its area), Proximal angles (EPA and the bulb angle by method and distance; IPA, PSIA) and Bulb (BSA at its level; VI). The mesh edge length round the point of percussion leaves the values: a warning by the card's title says when the mesh is sparse there (over 0.5 mm), its value in the tooltip. A group with nothing in it for one reason is one line that says why. The fields and the exported columns are unchanged.
- Changed: retouch card reduced to four indices: ERP, GIUR, invasiveness and the retouched perimeter in large cells, the sixteen segments by score (the score / p switch is gone), the edge curvature, and each working edge's own in one row. The volume removed, the share interpolated, the stations used, the continuous invasiveness, the perimeter by face, R3 and R6 leave the card and the retouch regions' table (now region, layer, face, length); all of them stay in the exports, whose columns are unchanged. The fitted length's plot has axes: what it shows and its unit, its range, the lengths' range and the length in use marked by a dashed line, a dot and its value.
- Changed: smoother hover and pin highlighting. A measure pointed at gets a faint neutral ground, a fixed one a pale amber ground in an amber ring, both 4 px rounded and in 140 ms, a row as one piece from its name to its unit; a table's cell lights its row's name and column's head. On the model only the measure in question is in the accent colour with its value; the other lines, the box's edges and dots are fainter (35%) and unlabelled, and the drawing fades out as it fades in.
- Changed: core and generic length, width and thickness no longer depend on the specimen frame (largest dimension; the `frame` column is gone from `measurements.csv`). They are measured as a flake's morphological ones: the largest distance between two vertices, the largest width across it, the thickness across both; the specimen frame still orients figures and a core's configuration box. The folder export and observer agreement use the new values; a project file's stored dimensions taken along a frame are measured again.
- Changed: the colour scales at the view's lower left stand above the status pills, never over them; in a tight top bar the frame's pill goes first (said in the specimen button's tooltip), then the buttons' words, and the modes' names last, the current mode keeping its own; the technical axis is one row like any object's; a region type with one region no longer repeats its area in the totals; the edge-angle list says "{n} stations"; buttons on a row of their own (Generate from retouch, View in specimen frame, Clear, Default …) have a border.
- Changed: fitted planes are drawn as rounded rectangles fitted to their section, with a thin outline; the selected plane shows a sparse grid and a slim normal. A plane is no longer a disc over the whole model’s box: its rectangle follows where it cuts the model (a nearly round section is turned along the specimen frame), a symmetry reference’s plane likewise (or along its curve); selecting or letting go of a plane fades in 150 ms (at once with reduced motion), and in the present mode the planes in the figure show their grid, without a normal.
- Added: symmetry about a plane the user chooses (a fitted plane, a closed curve or a frame’s mid-plane): volume, area and shape symmetry, each 0–1 without unit (1 symmetric) — the two sides’ volumes and areas as min / max, and shape as mirror overlap, the share of the specimen its mirror image covers (the flip test of Hardaker & Dunn 2005 in three dimensions) — with the sides’ volumes and areas and, as a supplement, the mirror deviation; a shading by deviation. Measure ▸ Symmetry, after the fitted planes, on every type of specimen: “+” offers the sources (valid fitted planes, closed curves, the technical frame’s X for a flake, the specimen frame’s X, Y, Z); each reference (S1, S2, …) has its label, source, “Swap A / B” and a note. Side A is the side the normal points to (for a curve, the side with more scars when it is made); swapping changes none of the three symmetries. The card shows the three symmetries in a row, then the raw values small, the mean mirror deviation, and RMS and 95 % folded away; the list shows each reference’s shape symmetry. The shape symmetry mirrors about 50 000 grid points inside the model (inside or not by rays along three fixed directions, the majority of them); the mirror deviation is the distance of the mirror image of 50 000 points sampled on the surface by area from the surface: mean, RMS and 95 %, in the coordinate unit, not scaled by size. Computed in the background (a worker; on the page in slices where there is none), part by part — the sides first, then the deviation, then the shape — with the progress shown over the values; the values before stay, faded, until the new ones come, and going back to a source used before shows its values at once. Hovering a value draws side A, the plane and where it parts the sides, and over the shape or the deviation its colours; Display ▸ Shading ▸ Symmetry colours the model by a reference’s deviation, 0 to its 95 % by default (a slider sets the upper end), with a scale at the bottom left (its progress until then). New file `symmetry.csv` (one row per reference); the project file keeps the references (`symmetry`) and their results and parameters (`derived.symmetry`; the parameters also in `manifest.json`).
- Added: left–right pairs of a flake’s grid semilandmarks for Procrustes asymmetry: `gm_land_pairs.csv` (`left,right`, by the point numbers of `gm_landmarks.csv`) with the grid’s GM exports, for geomorph’s `bilat.symmetry(…, object.sym = TRUE, land.pairs = …)` (Klingenberg et al. 2002); `docs/project-format.md` has an example in R.
- Changed: the upper and lower volumes are part of the symmetry card; `volume_upper`, `volume_lower`, `volume_ratio` move from `measurements.csv` to `symmetry.csv` (`volume_a`, `volume_b`, and `volume_symmetry` = min / max in place of the ratio), and `volume_ratio` leaves `icc.csv`. The bicone stands on a symmetry reference on its curve: choosing the curve in the configuration panel takes or makes it, and “Swap upper and lower” is its swap; the bicone’s results are unchanged. A project file’s upper / lower split opens as S1 (the bicone’s when it was along a curve).
- Added: the back of a core-edge (débordant) flake, a face of its own bounded by a back ridge curve; its cortex or scars are regions within it. Draw the ridge between the back and the dorsal face (curve type "Back ridge", key 7), its ends on the edge or the platform outline, and the back is found beside it, coloured, with its area in `regions.csv` and the region totals; a ridge that parts nothing says so in its details. Any part of the flake can also be typed "Back" by hand (key 8). For geometric morphometrics the back belongs to the dorsal face (the grid's points are the same with or without it; a template's dorsal patch takes it in), and for the retouch indices to the dorsal side.
- Changed: number key 0 picks the tenth option. A flake's region types are now 1 scar … 7 dorsal face, 8 back, 9 retouch, 0 the user's own type; its curve types 1 … 6 retouch, 7 back ridge, 8 the user's own.
- Changed: platform area and width no longer depend on the longitudinal section: they are measured from the platform region and the two ends whatever the section does. What the section gives (the platform depth, EPA, the bulb angle and IPA) needs the point of percussion within 1 mm of the platform (5 mean edge lengths without a unit), and says so when it is farther ("The point of percussion is too far from the platform").
- Changed: platform depth is measured from the platform's edge on the section (where the section's platform stretch starts, the vertex of the bulb angle too), not from the point of percussion.
- Changed: the BSA and VI use a robust plane fitted to the ventral face near the point of percussion (within 10 mm, at most half the technical length, retouch and damage left out, the bulb and outliers trimmed), not the plane of the whole ventral face, which on a twisted or curved flake tilts against the proximal end. Shading by height offers it as "Proximal ventral"; for the whole ventral face, fit a plane to its region and choose that. The bulb page shows the circle the plane was fitted in; hovering BSA shows it as a disc round the point of percussion.
- Changed: the BSA and VI are left empty when the bulb does not rise above the surface's noise (3 robust standard deviations of the plane fit) or is not closed at the sides (it reaches the ventral face's border more than 2 mm from the point of percussion); ends set by hand still give the angle of a bulb not closed at the sides. IPA takes its band's start from the bulb only when it is a bulb, and no longer depends on the BSA. The project file keeps the plane's reach and noise (`derived.flake.bsaReference`).
- Changed: IPA is taken from a plane fitted to a band of the ventral face, from the end of the bulb to 75% of the technical length, leaving out retouch, damage and outlying faces. Without a bulb (or without a stated unit) the band starts at 25% of the length; when too little of it is left, IPA is empty and says why. Changing the BSA's level moves the band's start. The profile panel marks the band's two ends on the section and draws where its plane meets it; hovering IPA shows the faces fitted and those left out, and the plane. The project file keeps the band (`derived.flake.ipaBand`); the IPA column of `flakes.csv` is unchanged in name and place.
- Added: PSIA (platform surface interior angle, McPherron et al. 2020) for flakes: the angle at the point of percussion between the lines to the two platform ends. It needs no unit.
- Added: the bulb angle at 1 mm (Li et al. 2022), by three points and by two lines, taken along the ventral side of the long section from the platform; the profile panel draws it on the section.
- Added: the bulb surface angle (BSA) and the vertical interval (VI) after Nagai (2026). The ventral face's least-squares plane is the reference; the bulb is the part of the face above a level of it (0.1 mm by default, −1 to 1 mm per specimen, undoable) next to the point of percussion, and BSA is the angle at that point between the ends of its outline. VI is the range of heights in strips 0.5, 1.0 and 1.5 mm wide from the point of percussion to the bulb's top. The mean mesh edge length within 2 mm of the point of percussion is listed with them. In Measure ▸ Flake the measures are grouped as technological axis, morphology, whole and proximal end; hovering a value draws how it was taken. `flakes.csv` ends with ten new columns: `psia`, `bulb_angle_3pt_1mm`, `bulb_angle_2ln_1mm`, `bsa`, `bsa_level_mm`, `bsa_ends_moved`, `vi_0_5mm`, `vi_1_0mm`, `vi_1_5mm`, `pop_mesh_edge`; the parameters are in the project file and `manifest.json`, and the project file keeps the level and any moved ends in `flake.bsa`.
- Added: shading by height above a plane (Display ▸ Shading ▸ Height): blue below, orange above, with lines of equal height; the reference is the ventral reference plane of a flake or any fitted plane, and the range can be set (0.25 mm by default). Over the ventral plane the BSA's level is drawn thicker.
- Added: the bulb page of the profile panel (Profiles ▸ Bulb): the bulb seen on its reference plane with lines of equal height, its outline at the level, the point of percussion, the two ends and the angle, the bulb's top and the VI strips, and its readings. The level can be typed in; the ends can be dragged along the outline (Shift: anywhere on the surface) and reset.
- Added: a flake's measures in observer agreement (Compare) and in `icc.csv`: those of `flakes.csv` but the retouch indices, the BSA's level and moved ends, and the mesh edge length. Another observer's are read from its project file, or computed from its own annotations when the file has none.
- Added: notes on regions, landmarks and working edges (and on a generic specimen's arrows), in their details like a curve's note; typing a note is one undo step. They are the last column of `regions.csv`, `landmarks.csv` (fixed landmarks) and `working_edges.csv`, and `scar_vectors.csv` writes a generic specimen's arrow notes. Older project files read with empty notes.
- Added: hide single annotations for the session: each row of the lists of arrows, curves, regions, fixed landmarks, semilandmark sets and working edges has an eye. A hidden object is not drawn, cannot be picked on the model and is left out of figures; it still counts everywhere else (a hidden curve still cuts the regions, a hidden region still has its area, the exports are unchanged). "n hidden" beside a list's title shows them all again. Hiding is not saved and not undone; opening another model or closing it shows everything again.
- Added: mean edge angles per working edge (on screen and in `working_edges.csv`): in Measure ▸ Edge angles a table of the means by method (three points, two lines) and distance (2, 5, 10 mm), over the whole curve or the working edge chosen above the chart, with the SD and number of stations in its tooltip. A click on a cell shows that method and distance in the chart and on the model, a click on a row's name all its distances; the table replaces the method and distance buttons. `working_edges.csv` gains six columns, `edge_angle_3pt_2mm` … `edge_angle_2ln_10mm`, the same means as grouping `edge_angles.csv` by `working_edge`, method and distance gives.
- Added: optional legend on figures (Present ▸ Figure ▸ Legend, off by default): the arrow categories (completeness, certainty or sequence), region types, curve types, planes and landmarks drawn on the figure, in the interface language, on the scale bar's row and below it. In SVG files it is `<g id="legend">` with text that other programs can edit; the setting goes into `manifest.json` as `options.figure.overlays.legend`.
- Added: export a region as a PLY mesh (the region's details ▸ PLY): its triangles and vertices in the model file's coordinates, binary PLY, with the program, specimen, region, unit and source model (name and SHA-256) in the header, for roughness or elevation analyses in CloudCompare, MeshLab or R.
- Fixed: Save overwrites the project file where the browser allows it, instead of downloading another copy every time (`name (1).lithicanalyst.json` …). In a folder opened in Chrome or Edge, Save writes the folder's project file at once, changed or not. A model or project on its own, in Chrome or Edge, is saved the first time into a file chosen in the save dialog, and then into that file without asking; a project opened through File ▸ Open project (or dropped onto the page) is saved back into its own file, after the browser has asked once for permission to write it. New: File ▸ Save as… (Ctrl+Shift+S) asks for a file (in a folder: a copy; the folder's file stays the project). A dialog closed without choosing does nothing; a file that cannot be written says so and leaves the changes unsaved. Browsers without these dialogs (Firefox, Safari) and read-only folders download as before; the first download says that this browser can only download.
- Fixed: figures have a white background by default, so image viewers that show transparency as black (such as Windows Photos) no longer hide the outlines and the scale bar; transparent is an option (Present ▸ Figure ▸ Background). The setting applies to the PNG and SVG figures, a section's drawing exported alone, the folder's figures (in `manifest.json` under `options.figure.background`), the Harris matrix SVG and the retouch mode's previews. The screen is unchanged.
- Added: section positions and labels on figures: each section in the figure is marked where it cuts the model, as a dashed line, on the views that look along it (within 30° of its plane; otherwise on the view nearest to that), with its label beyond both ends; each section drawing has its label above it. The marks can be turned off (Present ▸ Figure ▸ Section positions); the drawings keep their labels.
- Added: a section's label (X1, X2, …) can be changed in its details, and undone.
- Scar vectors drawn in another program can be imported from an IGES file (File ▸ Import scar vectors (IGES)…, on any type of specimen). The file's line segments become arrows: lines (110), polylines (106) and B-spline curves (126) by their two ends, under the transformation matrices (124) they refer to; lines written twice are kept once, and one written again the other way round is kept as it first came. Their unit is judged from where they lie, since a header's unit can be wrong: as they are, or as the header says, converted to the model's.
- Vectors that lie on the model are shown and imported as they are. Vectors that do not (the model was processed or replaced since they were drawn) open the "Align vectors" mode: drag one to three ends to where they belong on the model and the whole set follows (one end moves it, two turn it to their direction, three or more fit it by Kabsch), then "Auto fit" brings them onto the surface (trimmed point-to-plane ICP). The panel shows the distances to the surface; the unit can be changed, the vectors reversed and the fit taken back, and "Use previous transform" applies the placement confirmed last. Only the vectors move, never the model. Enter confirms, Esc leaves with nothing changed.
- Confirmed, each vector becomes a scar arrow with its ends on the surface, after the arrows there are; the import is one undo step. Arrows with an end that lay far from the surface have a warning dot in the list until they are edited. The project file records each import (`imports`: the file and its checksum, the unit, the 4×4 transformation, the pairs, the distances, the arrows); it is format 3 now, and older files open as before. `scar_vectors.csv` has a last column `source` (`iges:<file name>` for an imported arrow).
- In a folder, File ▸ Import matching IGES (whole folder) reads each model's IGES file of the same name in its folder: those that lie on their model are imported into their project files, the others are marked "To align" in the folder's list and open in the "Align vectors" mode with their file; Shift+PageDown counts them as not finished.
- The interface is also in German, Spanish and Vietnamese.
- The language menu lists English and 中文 first, then the others by their own names.
- The start page's language button opens the same menu as the top bar's, instead of going round the languages.
- Vietnamese letters are shown in IBM Plex: its Vietnamese subsets are bundled, so names typed in Vietnamese no longer mix fonts.
- Long tooltips (a status pill's explanation, the reason a value is empty) wrap inside their box instead of running out of it. The headings of the retouch tables and the GM panel's fixed landmarks go onto a second line where a language or a narrow window needs it, so the sidebar no longer scrolls sideways in the retouch mode; the specimen panel's unit column is as wide as its label.
- The reference gives LithicAnalyst's DOI on Zenodo, 10.5281/zenodo.24069150, which stands for all versions: "Zenodo. https://doi.org/…" in place of GitHub and the repository's address, on the About page and in the exports' `manifest.json`. `CITATION.cff` has the DOI too, so GitHub's "Cite this repository" gives it, and the README has its badge.

## 1.0.0 — 2026-11-08

- Ben Marwick is an author, after Peiyuan Xiao: in `CITATION.cff`, so in the reference (APA, also in the exports' `manifest.json`) and in GitHub's "Cite this repository". The About page lists the authors, read from `CITATION.cff`, and so do the built file's author meta and the manifest's `app.author`.
- The built file carries the licence of three-mesh-bvh in full, in a comment after the credit line, as its MIT licence asks of every copy (`dist/index.html`, `dist/artifact.html` and the page `npm run pages` makes). It is read from the package at build time.
- LithicAnalyst says who made it, and how to cite it. The "?" button opens Help, with two pages: About first (the logo, the version, the author, the source code on GitHub, where to send requests and problems — GitHub Issues or email —, the reference in APA style with a button to copy it, the MIT License and the third-party libraries), then the shortcuts; it opens on the page last looked at, and the ? key opens the shortcuts. The start page has "© 2026 Peiyuan Xiao · MIT License" under the version. The built file begins with a comment naming the program, its author, licence and address, and has an author meta tag. Every export's `manifest.json` names the author, licence and repository in `app`, with this version's reference in `app.citation`. The author, e-mail and repository are taken from `package.json`, the copyright from `LICENSE`.
- The repository has `CITATION.cff` (GitHub's "Cite this repository"), templates for a feature request and a bug report, and the author's name in `LICENSE`.
- LithicAnalyst can be installed like any program from a web site: `npm run pages` packs the built page with a web app manifest, a service worker and the app icons into `dist/pages/`, for GitHub Pages or any static host. Installed from Chrome or Edge, it has its icon and name in the Start menu, on the desktop and the taskbar, opens in a window of its own and works offline; a new version comes at the next launch, never in the middle of a session, and the title bar follows the light or dark appearance. `npm run pages -- --serve` serves it on `http://localhost:4173/` to try it. The single file `dist/index.html` is unchanged and still asks nothing of the network.
- The app icon: the small logo in ink on a paper tile, over the start page's four-colour bar (`src/assets/brand/app-icon/`, made by `scripts/app-icons.mjs`).
- The interface is also in Italian and French: choose them in the language menu; the start page's language button goes round all four. Everything is translated, the field labels too.
- The English and Chinese texts have been gone over (about 300 changes). Most visible: the technical axis is now the technological axis; the flake's edge curve is the flake edge (石片边缘); a working edge's column and the retouch table say Working edge, the table's chord and depth say R3 and R6, and its title is Retouch regions; the figure's views in Chinese are 正视 / 后视 / 左视 / 右视 / 俯视 / 仰视; "Cannot tell" is Indeterminate; error and status messages are shorter and alike. Codes in files and exports are unchanged.
- The top bar keeps every button in the window: where its words do not fit (a narrow window, a long specimen name or the longer words of a language), the modes show their icons only, then the File and Save buttons too, and the words come back when there is room. The volumetric configuration panel is a little wider (360 px), so its title and the frame's pill stay on one line in every language.
- The labels in the view (the technological axis, a flake's platform ends, a measure's drawing) change language with the rest of the interface, instead of at the next change.
- An arrow you draw is there whole at once; it no longer grows from its tail.
- The Harris matrix panel is drawn in the colours of the light or dark appearance, like every other panel, and changes with it; the selected scar is pale amber with an amber outline. The exported SVG keeps its fixed print colours.
- The interface text can be gone over and translated in a spreadsheet: `npm run i18n -- export` writes every text, English and Chinese side by side, to `i18n/texts.xlsx`, and `npm run i18n -- import` puts what was changed back. A language is added as a column of its own; what is not yet translated shows in English. Eleven texts the interface no longer used are gone.

- A quieter workspace, with motion where it helps. Nothing that is computed, stored or exported changes, nor any key.
  - The sidebar is flat cards on a ground of their own, plain in both themes; the lists in a card lose their frame, their rows apart by a fine line. A section with nothing in it has a grey title. Opening and closing a section eases.
  - Solid amber is kept for the current mode and for a panel's one main action. The tool chosen and a segment chosen are pale amber with an amber line, check boxes and slider thumbs ink, the view's corner marks grey; Save and the figure's PNG and SVG are plain buttons. Save has a small amber dot while there are changes not saved; it goes once the project is saved (or written into the folder), and when undo comes back to what was saved.
  - The automatic measurements come in groups: a flake's technical axis, morphology, platform and the whole; a core's and a general specimen's dimensions and the whole. Platform width and depth are a small table (chord, along the surface), the EPA another (three points, two lines; 1, 2, 3 mm), with the unit in the corner; each cell shows how it was measured on hover or focus, and a click holds it. An empty value is grey.
  - With no model, the view shows the module's drawing over a faint grid and rings, and the sidebar the mode's sections as grey titles. Toasts stand at the lower right of the view, above the coordinates, as cards like every panel over the view (a coloured bar for a warning or an error). Corners are 4 px, 6 px for large panels and dialogs.
  - The other theme comes in as a circle growing from its button. The mode's amber block slides to the mode chosen and the sidebar's cards come in; panels and dialogs grow from their button and fade as they go; menus drop in; a status pill made done ticks itself, and a measure you change flashes. While a model loads for more than a moment, the logo puts itself together over and over. A landmark you place pops in, and a measure's drawing fades in; a press on the view, a figure, loading, undo and redo show everything at once. With reduced motion, nothing moves.
- Surface semilandmarks by a template. Cores and general specimens now have the GM configuration too, as three ordered lists you fill yourself: fixed landmarks by name, curves between two landmarks (or closed, going round by a third), and surface patches by region type. Rows can be added, removed and moved, and their choices come from what the folder already holds. "Set as template" lays each patch's points evenly on the open specimen's region (10 to 2000 points, 100 by default; a fixed seed; "Lay again" takes the next one), and refuses, saying what is missing, if the specimen lacks anything asked for.
- Every other specimen of the folder gets those points by itself: a similarity and a thin-plate spline through its landmarks and curve points, then onto its own region of that type. Points that had to move far or end up crowded are flagged, with an amber ring on the model, "n points to check" in the panel and a GM pill that stays open; nothing is removed or corrected for you. If the template changes, the panel advises laying it again. If its model is gone from the folder, nothing is passed on and the panel says why. The status has a GM pill and the folder's list a GM mark once points are asked for, and "Show surface semilandmarks" draws them.
- A flake can use a template too (Grid or Template in the GM panel; 150, 150 and 32 points on the ventral face, dorsal face and platform to begin with, and you can add patches of your own). The grid stays the default and its exports are unchanged to the byte.
- Exports by a template: `gm_landmarks.csv` adds `set_index` and `flagged`, what a specimen lacks is `NA` (and it is listed in `gmIncomplete` in the manifest), and there are new files for Morpho's `slider3d`: `gm_smvector.csv`, `gm_outlines.csv`, `gm_surp.csv` and `gm_models.csv`. The manifest says how the points were made: `gm.surfaceMethod`, `configVersion`, `template`, `seed`.
- Fixed: a folder's sharp edge rule and GM configuration were written to `LithicAnalyst/` but not read back when the folder was opened again.

- Each type of specimen now has only what it uses. A flake has no volume split or upper and lower volumes. A core has no edge angles or working edges, and keeps its volume split, which the bicone needs. A general specimen has none of these. Their tools, panel rows, keys and entries in the shortcuts go with the type; `edge_angles.csv`, `retouch_angles.csv`, `edge_sharp.csv` and `working_edges.csv` have no rows for a type without them, and `measurements.csv` keeps `volume_upper`, `volume_lower` and `volume_ratio`, empty. Nothing is deleted: data in a project file stay there when it is saved, and show again when the type is changed back. A core made a flake shows the edge angles of its core edges.
- In the measure mode, a row of the automatic measurements now shows how it was measured. Hover for a moment (or reach it with the keyboard) and the view draws it: the technical axis, box, three dimension lines and extreme vertices for technical length, width and thickness; the farthest pair and the lines across for the morphological ones; the two axes and an arc for their angle; the straight line and the way over the surface for platform width and depth; the platform itself for its area; the section, the points, the lines or chord and an arc for EPA and IPA; the whole model for surface area and volume; the box along the specimen's orientation for a core's or a general specimen's dimensions; the splitting plane or curve and the two sides in two light colours for upper and lower volumes; a curve and its stations for a row of edge angles; the sharp stretches; the radius and circles of the cortex sphere. The current item is in the accent colour and the rest in grey, with the values at the middle of the lines. A click holds it, a second click or Esc lets go (a row of edge angles still selects its curve instead). An empty value draws nothing and still says why. The drawing is what the measuring functions returned, and the camera does not move.
- Landmarks can be seen again: a fixed landmark's radius is 0.5% of the model's diagonal, kept between 6 and 16 CSS pixels across on the screen; a semilandmark of a curve or a surface is two thirds of that, between 4 and 11 pixels. They look the same on high-density screens, and rest on the surface toward the camera, so the surface they mark no longer hides half of them. Picking (8 pixels) and figures (1.2 mm on the paper) are unchanged.

- A logo and a wordmark: a double cone from a discoidal core, solid above and running out into a mesh and a point cloud below. They stand at the top left of the top bar in every mode (the wordmark goes first in a narrow window) and on the new start page, and the logo is the page's icon. They are only a mark: they are not in figures, reports or CSV files. The version moves from the top bar to the start page.
- A new start page, in place of the one with the top bar and the buttons. The app opens on the logo, the version and three cards (Core, Flake, General), with the language and the appearance at the top right. A card goes into its module, by a press, or by Tab and Enter or Space; the card last chosen has the focus when the page comes up. Open model, Open folder and Open project now wait in the middle of the empty view of the workspace, and do what they did; dropping a model still works in both places. File ▸ Close comes back to the page, from an empty workspace too. An entrance plays the first time the page shows after the app opens; hovering over a card shows its arrows being struck, or its globe turning and landmarks appearing. With reduced motion neither plays. Nothing is fetched from the network: the wordmark and the words behind the cards are outlines of IBM Plex Sans Condensed (`scripts/gen-wordmark.py`), and a bold cut of that font is bundled for the cards' names.

- On a flake, an open retouch curve with both ends on the edge now makes what lies between it and the edge a retouch region by itself, in the same step, at layer 1, and the region follows the curve. It takes the smaller of the curve's two sides; Other side in the region's details takes the other. It stays one region however many curves, such as a scar's outline, cross it; a region already typed by hand in a piece keeps that piece; when one curve lies further in than another, it takes only what lies between them. The region tool still selects it and sets its layer (Shift+1-5). Deleted or given another type by hand, it stays that way until the curve is made a retouch curve anew. Closed retouch curves, curves not reaching the edge and cores work as before. Files from before keep the regions they have: their curves get none. New in the project file: `retouchSide` on a curve, `curveId` on a region. The Retouch regions pill now goes to the curve tool, with the next curve a retouch curve.
- The Platform ends pill is gone, since they come by themselves: a flake's count is now out of five. The Edge pill counts only when the edge's ends reach a closed platform outline; if they do not, it says so and a click selects the edge.
- The Select tool also drags the user's own landmarks, snapping as the Landmark tool does (Shift: exactly). The point of percussion still moves with the technical axis alone.
- The Retouch mode's Station button and its key J are gone: the mode has one tool, always on.

- A flake's platform ends now come by themselves, where the edge meets the platform outline, and follow the curves; the Platform end tool and its key E are gone. To adjust one, drag it with the Select tool (or the Landmark tool): it goes along the outline and stays where it is put, until the button in its panel sends it back. Ends placed by hand in earlier files stay as they are; a file with an edge and an outline and no ends gets them when it is opened. Without an edge there are no ends, and so no platform width, until one is drawn. `auto: true` on a landmark says it follows the curves.

- A flake's edge need not be closed. With a platform outline it is drawn open, with its ends on the outline; only without one does it have to close. A stretch of the edge running along the platform outline (within `EDGE_RIM_REACH_MM`, 1 mm, for at least `EDGE_RIM_MIN_MM`, 2 mm) is no longer measured as edge, so an edge drawn closed gives the same stations, edge angles, sharp stretches, working edges and retouch indices as one drawn open; the curve itself stays as drawn. This changes the numbers of edges already drawn along the platform: their stations there, and a retouch perimeter that counted them. The curve's panel shows the length measured when it differs, `derived.measuredLines` says where it runs, and Complete loop is no longer offered on an edge once there is a platform outline.
- An open edge stopping short of the platform outline now goes to the outline even when another curve, such as a scar's outline, lies nearer. Before, it joined the nearer curve and the dorsal and ventral faces ran together. The same for a core's edges.
- The Dorsal / ventral pill and the folder's count now go by whether the two faces are really apart on the mesh, not by the regions being there; the pill and the warning under the regions say what to do about it. A project file that stored no regions still goes by the regions being there.

- A start page in place of the view and the sidebar while no model is open: three cards, Core, Flake and General, say what a new model is (the choice is remembered), with the ways to open a model, a folder or a project below; dropping a model works as before. The top bar stays, without the modes and the specimen. A project file still says what it is. File ▸ Close comes back to it.
- A new type of specimen, General (code `generic`), for anything that needs none of the stone tool presets, such as bones or pottery. It has landmarks, arrows with a label alone, curves and regions typed in free text alone (key 1; what was typed before is suggested), one layer of regions cut by all the curves, distances, angles, sections, planes by all the vertices, curves or regions, the volume split, edge angles on the curves it is asked for, working edges, orientation, figures, the automatic measurements, the compare mode and folders. It has no scar attributes, relations, sequences, configuration, cortex sphere, sharp edge, retouch mode or anything of a flake's. Switching to it hides data and deletes nothing. Its exports leave out the files of the other types, and `scar_vectors.csv` keeps its columns with the scar attributes empty. Core and General share their orientation; a flake keeps its own.
- The annotation status: small pills at the bottom left of the view, in every mode, say what the specimen has so far (✓) and lacks (○), and what lacking it leaves empty when the pointer rests on them. A click goes to the annotate mode and to the tool that makes it; for a curve, the next one drawn has that type by itself, in one step. On a flake: unit, technical axis, edge, platform outline, dorsal / ventral, and retouch regions, which do not count. On a core: unit, scar arrows, core edge. On a general specimen: unit. A view narrower than 720 px shows the count alone until the pointer is over it. The folder's list shows the same count (4/5) beside each model, from the project files, with no model opened.
- Landmarks and curve semilandmarks are now a constant size on the screen (9 and 6 CSS pixels), so close up they no longer cover what they mark; a click within 8 pixels picks one. In figures a landmark is 1.2 mm across on paper, its outline included, at any scale and resolution.

- Working edges: stretches of a curve whose edge angles are measured, measured on their own, so a double scraper or a convergent edge need not be split into curves (a flake's edge stays one curve for geometric morphometrics and the faces). A new tool (W) takes two clicks on the curve; the select tool drags their ends, which stop at a neighbour's; a closed curve has "Other stretch"; on a flake, "From retouched stretches" makes one per retouched stretch to start from. A band and label in the annotate mode, a tick at each end in the measure and retouch modes.
- The edge angles and the retouch layers' charts mark the working edges along the axis and can show one alone. In the retouch mode the section's title says which one the station is in, the indices have a table of them (ERP, GIUR, the perimeter, the curvature; a press goes to its largest missing area and draws it and its chord on the plan), and the table of retouch regions has a column for it.
- New file `working_edges.csv`: a row per working edge, and per curve measured without any, with its length, sharp length and, on a flake, its retouch indices. `derived.workingEdges` holds them; the parameter is in the manifest.
- `edge_angles.csv`, `retouch_angles.csv`, `retouch_sections.csv`, `retouch_segments.csv` and `edge_sharp.csv` end with a new column, `working_edge`. A sharp stretch across the end of a working edge is now two rows of `edge_sharp.csv`, with the same `segment`; the sharp length does not change. Project files gain `workingEdges` and `nextWorkingEdgeNumber`; older files have none.

- GIUR now takes stations retouched on the ventral face as well; only a station retouched on both faces stays out. Both are measured from the line of the ventral face beyond the retouch: t is the thickness where the retouch ends, T the largest thickness.
- Invasiveness: in the two end segments, how far in a point lies is now the lesser of its distance from the end and from the side, as in a closed inner zone, so `invasiveness` and `invasiveness_continuous` can come out lower for retouch in the corners of those segments. The line between the outer zone and the inner is one closed line on the model and on the plan.
- A new work mode, Retouch, on flakes (the mode switch and M; annotating stays in the annotate mode). A current station, which starts where the missing area is largest, moves by a press or a drag along the edge, ← / → (Shift: ten stations), the section's slider, the layers' chart, the plan and the list of segments, and shows everywhere at once. Two preview panels open with the mode: the section at the station (layers, fitted stretches, original surface lines, missing area, t and T, with its readings) and the plan (outline, the sixteen segments, the retouch on either face, the longest stretch's R3 and R6). The frame can be chosen there and the longest axis's ends exchanged. On the model: the regions by layer with the rest faded, the station's section, the original edge and the segments' lines, each with a switch in Display. In the sidebar: the indices with a sixteen-cell grid (a cell shows its segment on the plan), the fitted length (previewed while dragged, written on letting go, with the removed volume over a range of lengths) and the retouch regions along the edge. An empty value says why when the pointer rests on it. Both previews export as SVG and PNG, in light colours on white, to the figure's scale and resolution.
- The retouch layers' chart moved from the measure mode to the retouch mode. The measure mode's edge angles show the distances only; `retouch_angles.csv` and the stored results do not change. A core has no retouch mode: its retouch layers are in the export only.

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
