# MetaRDU GIS — Upgrade Roadmap & Design Doctrine

> Companion document to the `ui-professionalism` branch. Two halves:
> **Part I** codifies the professional UI/data-representation standard now in force.
> **Part II** is the phased platform roadmap and the strategy for competing with —
> and diverging from — QGIS/ArcGIS.

---

## Part I — UI Professionalism Standard (this branch)

### What was wrong

The previous interface exhibited the recognizable failure modes of AI-assembled UI:
wrapping primary buttons, blue-gradient chrome, marketing badges, emoji glyphs,
a telemetry strip spending permanent vertical space to say "0ms", floating
unanchored toolbars, no status bar, colliding map labels, a cartoonish hazard
symbology, KPI stat-cards with rainbow text, an SaaS font pairing — and most
seriously, the statutory deed plan SVG overflowing its container with clipped text,
and a planning atlas containing **fabricated indicators** (a "96/100 statutory
compliance" score) and a choropleth drawn by array index rather than spatial
position.

### The doctrine now in force

**Design language:** professional GIS suite (ArcGIS Pro / QGIS density).
Near-black neutral chrome, hairline 1px borders, 3–4px radii, 12–13px UI text,
4px spacing grid. Color is reserved for **data layers and semantic state** —
never decoration. One accent (survey amber `#d9a441`) marks the single primary
action on any screen.

**Typography:** IBM Plex Sans (UI) / IBM Plex Mono (all data readouts),
tabular numerals everywhere numbers are compared vertically.

**Cartographic rules (map canvas):**
1. Persistent status bar: live cursor E/N/H, WGS 84 φ/λ, scale denominator
   (3 significant figures, 96 dpi convention), EPSG + CRS name, selection count.
2. Label decluttering: greedy screen-space collision avoidance with priority
   (bearing badges > selected points > boundary beacons > other beacons >
   contour labels > hazard/energy tags). Suppressed labels are preferred over
   overlapping labels.
3. Graticule labels must clear each other (≥ 90px horizontal, ≥ 18px vertical)
   and the tool rail.
4. Scale bar snaps to 1/2/5×10ⁿ values; north arrow is minimal line work,
   anchored bottom-right.
5. Hazards render as hatched impact discs with dashed outer rings — never
   flat cartoon blobs.
6. Selection is amber; boundary beacons desaturated red; everything else neutral
   or data-palette.

**Data-display rules (panels/tables/exports):**
1. Numbers right-aligned, tabular, with units in muted weight.
2. Section labels are small-caps 10px muted — not colored marketing badges.
3. Stat readouts are instrument strips (hairline-divided), not SaaS cards.
4. No color without meaning; risk chips are the only semantic color in tables.
5. **No fabricated numbers on any document.** Every figure must be derived from
   computed pipeline state. Removed: fake "96/100 statutory compliance" score,
   hardcoded investment prescriptions.
6. Statutory deliverables (Form 4 deed plan, planning atlas) render as
   **print-first light documents** with pure-SVG tables (no `foreignObject` HTML),
   fixed column metrics, clipped data frames, method-and-limitations notes, and
   factual footers (sheet, CRS, date, author).

### Files touched in this branch

| Area | Files |
|---|---|
| Design system | `src/index.css`, `index.html` |
| Application chrome | `src/components/Header.tsx`, `src/components/StatusBar.tsx` (new), `src/App.tsx` |
| Map canvas | `src/components/MapCanvas2D.tsx` (tool rail, basemap segmented control, decluttering, hazard symbology, click-select, scale report) |
| Panels | Energy, MCDA, Hazard, Terrain3D, DeedPlan, Atlas, AttributeTable, PointDataGrid, Toolbox, LayerPanel, ExportHub |
| Exporters | `deed-plan-svg.ts` (SVG-native schedule, layout, footer), `planning-atlas-svg.ts` (full rewrite: truthful choropleth, computed KPIs, method note) |

All four test suites pass; production build is green.

### Atlas cartography standard (v2, this branch)

Sheet output was upgraded from "correct" to atlas-grade. The rules now in
force for every composed sheet (Form 4, Planning Atlas, custom templates):

1. **Shaded relief** — TIN facet Lambertian hillshade (sun NW 315° / 45°),
   bucketed into ≤ 18 gray paths, drawn beneath thematic layers at 55 %
   strength. Terrain form is visible through the choropleth instead of a
   flat colored grid. Facet budget keeps 50k-mesh sheets printable.
2. **Index-contour labelling** — major contours carry their elevation in
   halo text, placed by arc length, rotated along the line, always upright,
   budgeted per frame. Suppressed beats overlapping.
3. **Point-label decluttering on sheets** — hazard and cluster labels pass
   a greedy screen-space collision pass (hazard wins; suppressed beats
   overlapping). Cluster labels disclose household counts.
4. **Boundary casing** — white casing under the parcel stroke so the legal
   boundary reads over any background fill.
5. **Graticule ticks** — solid ticks crossing the frame edge at every
   coordinate label, atlas convention.
6. **Locator (index) inset** — the parcel extent on an adaptive UTM grid
   (window ≈ 8× parcel diagonal, step from {5,10,20,50,100} km), zone
   captioned when the CRS encodes one. A reader can place the sheet in its
   zone without external data.
7. **Legend discloses its classification** — per-class counts (n=), the
   exact MCDA class breaks (from the engine's own constants), relief sun
   geometry, and symbol entries for every layer actually present.
8. **Scale bar** — subdivided first segment, bare numbers on inner ticks,
   unit on the final label, "grid metres" caption.
9. **Print-DPI raster export** — every sheet exports as PNG at 300 DPI with
   the IBM Plex web fonts embedded into the rasterisation (base64 woff2
   inside the SVG), so raster output carries the same type as the vector
   original. Falls back to system faces offline.

Verified by `tests/cartography.test.ts` (photometry, placement, zone
parsing, locator snapping, integration render) and visual QA renders of
both statutory presets over a 6k-point real-pipeline scenario.

### OSINT integration standard (v2, this branch)

The workstation now consults open intelligence sources under the same
contract as every other input: **disclosed, licensed, and never
survey-grade**. The rules now in force:

1. **Deterministic queries** — same document extent + same presets
   produce the same Overpass QL text (canonical preset order, global
   bbox, explicit element cap). A reviewer can re-run the query.
2. **Chain of custody** — every external fetch is recorded (service,
   endpoint, license, attribution, ISO timestamp, feature count, scope
   line) and appears as a `src:external-*` node in the provenance graph,
   which is embedded in GeoJSON, LandXML, GeoPackage and lodgement
   exports. Consulting an external source changes the integrity digest.
3. **Honesty about fidelity** — OSM data is labeled *indicative context,
   NOT survey-grade* in the panel, the import notes, and the provenance
   node. Relations are counted and skipped (never partially assembled);
   unresolvable ways are disclosed per fetch.
4. **Import parity** — OSINT features become ordinary coded survey
   vertices (stable OSM-id-derived point ids, tag-priority categories,
   names in descriptions), reprojected WGS84 → the active working CRS,
   so every downstream tool (canvas, attribute table, MCDA, composer)
   treats them as data.
5. **License hygiene** — ODbL attribution and the CC-BY-SA/OpenTopoMap
   and EOX/Copernicus credits render on-canvas and in panel disclosures.
6. **Scope honesty for geometry matching** — boundary context clips at
   RING level (a county containing the job is kept whole; vertex-level
   bbox filtering would silently drop exactly the jurisdiction that
   matters), and the DEM query window is padded to ≥ 3 km per axis
   (a small job at 30 m native resolution would otherwise decode a
   handful of pixels). Both behaviors are disclosed, not silent.

Delivered on this branch: `src/core/osint/overpass.ts` (query builder,
parser, tag mapping, failover fetch), `src/core/osint/geocode.ts`
(Nominatim client with a client-side 1 req/s floor per the OSMF policy),
`src/core/osint/boundaries.ts` (geoBoundaries gbOpen context: metadata
license recorded verbatim, CORS-direct GitHub LFS downloads with
published-URL fallback, ring-level scope clipping, vertex-cap
disclosure), `src/core/osint/registry.ts` (session evidence registry),
`OsintPanel` (scope, presets, preview, locate, jurisdictional context,
import), `src/core/dem/copernicus.ts` + `src/core/dem/analysis.ts`
(GLO-30 regional grids via the Planetary Computer crop endpoint with a
dependency-free GeoTIFF reader; Horn slope, terrain profiles, marching-
squares contours, statistics) with the `DemPanel` analysis sheet,
provenance integration, canvas focus framing, and two open basemaps
(Sentinel-2 cloudless via EOX, OpenTopoMap). Locked by
`tests/osint-overpass.test.ts` (60+ assertions),
`tests/osint-geocode.test.ts`, `tests/osint-boundaries.test.ts`,
`tests/dem-copernicus.test.ts` (byte-exact TIFF fixtures),
`tests/dem-analysis.test.ts`, and the external-source section of
`tests/provenance.test.ts`.

Deferred (documented scope, not forgotten): Sentinel-2 **change
detection** between two epochs (requires a scene-pair service such as
Copernicus Data Space or Sentinel Hub — API-key territory), FIRMS /
Global Forest Watch monitoring watchlists on tracked parcels, and
Overpass **multipolygon relation** assembly (needs a ring-assignment
engine with its own parity harness).

**Delivered since** (OSINT wave 3): all three deferrals above landed
key-free — **multipolygon assembly** (`src/core/osint/assembly.ts`:
endpoint-exact fragment chaining, containment classification for
role-less members, smallest-containing-outer hole assignment, RFC 7946
orientation, strict skip-and-count for unclosable data;
`tests/osint-assembly.test.ts`); **Sentinel-2 epoch change screens**
(`src/core/osint/sentinel2.ts`: EOX s2cloudless annual mosaics
2017–2024, verified live CORS-open — no scene-pair API needed; luma
differencing after histogram-matching radiometric normalization,
measurable ~300 m flag cells, CSV/GeoJSON evidence downloads;
`tests/osint-sentinel2.test.ts`); **FIRMS watchlists**
(`src/core/osint/firms.ts`: VIIRS/MODIS area-CSV client, deterministic
FNV-1a alert ids, persisted seen-ring monitors with exact new-alert
diffs, importable coded points; `tests/osint-firms.test.ts`).

---

## Part II — Platform Upgrade Roadmap

### Where the product is

MetaRDU is a genuinely differentiated tool: COGO + Bowditch adjustment, real
Delaunay TIN, MCDA, techno-economic electrification planning, and statutory
deliverables — all client-side, offline-capable, sub-second. Its wedge is the
**surveyor → planner pipeline in one instrument** for markets (East Africa first)
where connectivity, licensing costs, and fragmented workflows are the real
competitors — not QGIS.

The gaps, in order of severity:

1. **Performance ceiling.** The pipeline re-scans all vectors per grid cell
   (O(n·m)); the canvas redraws everything per frame; nothing is batched or
   off-thread. Fine at 21 points, dead at 50,000.
2. **Data ingress.** CSV/GeoJSON/KML/GSI only. No Shapefile/GeoPackage — the
   two formats the entire African GIS economy actually exchanges.
3. **Ground truth.** Simulated basemaps and a mock geoid. Useful for demos,
   not for production decisions.
4. **Editing depth.** Selection exists; true vertex editing, snapping, undo/redo,
   and feature creation do not.

### Phase A — Front-end GIS hardening (next 2–4 weeks) — ✅ DELIVERED

*Goal: unshakeable at field-data scale.*

- **Spatial indexing:** uniform grid or STRtree over points/vectors; MCDA
  distance queries become O(local) instead of O(n·m).
- **Web Workers:** move the pipeline (TIN, contours, MCDA, energy clustering)
  off the main thread with a progress protocol; the UI stays at 60fps during runs.
- **Canvas renderer v2:** dirty-rect invalidation, level-of-detail point/label
  culling beyond ~2k features, `OffscreenCanvas` tile caching for static layers.
- **Undo/redo command stack** over a single immutable document store
  (project file already models this state — formalize it).
- **Shapefile + GeoPackage ingest** (`shpjs` / `gpkg` WASM) with DBF field typing.
- **Benchmark harness:** synthetic 10k/50k-point scenarios with hard budgets
  (pipeline < 2s, pan/zoom < 16ms/frame) enforced in CI.
- **turf.js adoption** for buffer/dissolve/boolean-op correctness instead of the
  ad-hoc offset engine (keeps Bowditch/TIN bespoke code).

#### Phase A delivery notes (this branch)

| Commitment | Status | Implementation |
|---|---|---|
| Spatial indexing | ✅ | `src/core/spatial-index.ts` — uniform grid (points/triangles) + exact best-first `SegmentIndex` (cell-MBR A* search, bit-identical to brute force). Wired into MCDA distance fields, triangle-slope lookup, electrification clustering, and grid-line distance. Brute-force parity enforced by `tests/spatial-index.test.ts`. |
| Web Workers | ✅ | `src/workers/pipeline.worker.ts` + `pipelineService` promise client with per-stage progress protocol (9 stages) and transparent main-thread fallback. App renders a live stage/percent readout during runs. |
| Renderer v2 | ✅ | Static-scene cache (basemap→energy layers) keyed by view/basemap/layers/document signature, blitted under a dynamic pass (points, labels, furniture). Viewport culling on cells/TIN/contours/vectors/points; LOD dot-mode decimation beyond 2k visible features with label suppression; contour stride simplification; `ResizeObserver`-driven re-render. |
| Undo/redo | ✅ | `CommandHistory` (bounded 50, labeled commands) + `useHistoryState` binding; Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y; Header buttons with next-action tooltips. Scenario loads and imports open new documents; edits, reprojects, MCDA/Energy re-evals and re-runs are undoable commands. |
| Shapefile ingest | ✅ | Dependency-free `.shp` (types 1/3/5/8 + Z/M variants) and dBASE III `.dbf` reader with C/N/F/D/L field typing; GeoJSON reader; attribute-driven category/code inference. Multi-file Import in the toolbar. GeoPackage deferred to Phase B (WASM size vs. current need). |
| Benchmark harness | ✅ | `npm run bench` — deterministic 10k/50k generators, hard budgets, CI-exitable. Measured at 50k: pipeline 1.30 s (was 101.7 s — 78×), MCDA warm re-eval 203 ms, hazard 106 ms, energy 6 ms, query p99 0.12 ms. All budgets green. |
| Delaunay rebuild | ➕ (found by the harness) | The ad-hoc Bowyer-Watson was O(n²) and 99% of pipeline time. Replaced with `delaunator` sweep-hull (O(n)); bespoke face metrics/volumes kept. Contour stitching rewritten from O(S²) rescan to endpoint-hash chaining, plus elevation-band bucketing. |
| turf.js | ✅ closed (GEOS parity, no swap) | The deferred engine swap is resolved the stronger way: `scripts/golden_buffers.py` generates reference corridor polygons with **GEOS** (shapely — the engine behind QGIS/PostGIS) over 6 deterministic fixtures at 15 m/30 m widths, and `tests/buffer-parity.test.ts` proves the in-house engine matches (area within 0.5 %, boundary agreement within 0.10 m both ways, ring simplicity). turf.js itself was rejected on merits: cadastral corridors are planar grid-meter geometry, while turf buffers geodesically in degrees — the wrong model for projected CRS work. The parity exercise instead surfaced real v1 defects, fixed in `buffer-engine.ts` v2: per-segment offsets left wedge gaps or self-intersecting overlaps at every bend; v2 produces round joins (8 segments/quarter, GEOS `quad_segs=8`), inner miters, flat end caps, and a closed simple `polygon` ring rendered on canvas, exported to DXF (closed LWPOLYLINE) and GeoJSON (Polygon features, closing the gap where the GeoJSON header claimed buffer export but never shipped it). |

**Verification:** 7/7 test suites pass at Phase A scope (was 6; +buffer GEOS
parity — 19 suites across the repo today), `tsc` clean,
production build green, manual QA: worker-mode pipeline,
undo/redo round-trip, real Shapefile pair import (4 beacons + road polyline),
6k-point CSV ingest with LOD rendering.

### Phase B — Connected when available, offline-first always — ✅ DELIVERED

*Goal: real ground truth — live basemaps, a statutory-grade vertical datum, and the
other half of the data-ingress story — without giving up the offline promise.*

- **Basemap tiles:** OSM raster + optional satellite URL templates with graceful
  offline fallback to the current vector basemaps; Service Worker tile cache.
- **Real geoid:** ship EGM2008 grid subset (East Africa tile, ~2–6MB compressed)
  loaded lazily; replaces the sinusoidal mock with statutory-grade H = h − N.
- **Elevation tiles:** Terrarium/Mapzen DEM tiles for regional context beyond
  the surveyed TIN footprint.
- **CRS expansion:** PROJ search + paste-EPSG UX (the proj4 registry is already
  there; the UI should accept any EPSG string, not a fixed list).
- **GeoPackage ingest** (deferred from Phase A).

#### Phase B delivery notes (this branch)

| Commitment | Status | Implementation |
|---|---|---|
| Basemap tiles | ✅ | `src/core/tiles.ts` + MapCanvas2D — OSM streets and Esri World Imagery XYZ providers; tiles reprojected onto the working CRS (per-tile corner anchoring, sub-pixel residual at survey scales); rAF-coalesced epoch in the static-cache signature so basemap tiles arrive without blocking; overzoom (zoom-drop) fallback beyond z19; attribution credit line pinned lower-right; dark graticule/label ink + haloed labels on light streets tiles. **Offline:** fetch-through **Cache API** persistence (tiles survive sessions) + negative caching; when the network is gone the procedural vector basemap shows through and the canvas prints `OFFLINE — vector basemap fallback`. (A Service Worker proved unnecessary — the Cache API alone delivers repeat-session offline tiles.) |
| Real geoid | ✅ | `src/core/geoid/grid.ts` + `public/geoid/egm2008-ea-2p5.bin` — the official NGA **EGM2008 2.5′** grid (`us_nga_egm08_25`, PROJ CDN, converted from `egm08_25.gtx`) windowed to 10°N..8°S / 26..46°E (433×481 nodes, 417 KB int16-cm MTGEOD01 binary, no nodata), lazy-loaded at app mount. Corner-registered bilinear sampling with an exact-node fast path; H = h − N now statutory-grade across the whole pipeline. **The old mock had the wrong sign** (claimed N ≈ +10–25 m over Kenya; reality is −5 to −45 m — the region sits on the flank of the Indian Ocean geoid low). Verified: EGM2008 vs EGM96 mutual agreement ≤ 0.9 m at six anchor cities; parser/asset locked by `tests/geoid-grid.test.ts`. Provenance chip in the status bar (`Geoid EGM2008 2.5′`) with coverage/accuracy tooltip; pipeline telemetry names the active model. Fallback (asset fetch failure / outside window): inverse-distance over six EGM2008 anchor values, disclosed as `parametric*` and "NOT for statutory height work". |
| Elevation tiles | ✅ | `src/core/dem.ts` — Terrarium/Mapzen DEM sampling (zoom 8–14, ~10 m/px, bilinear in-tile) with a decoded-grid LRU. Map tool-rail probe (Mountain icon): click anywhere for regional elevation + ground-resolution + dataset credit, explicit `DEM unavailable` chip when offline/outside coverage — never a fabricated value. Scoped as context only; the surveyed TIN remains the statutory source of truth inside the job boundary. |
| CRS expansion | ✅ | `crs.ts` + `CrsPicker` — programmatic registry of **all 120 WGS84 UTM zones** plus the real Arc 1960 UTM codes (21035–37 S / 21095–97 N), deduped against hand-curated defs; scored full-text search; **paste-any-EPSG**: unknown codes fetch + validate their proj4 string from epsg.io (8 s timeout, garbage rejected) and persist to localStorage for offline reuse. Replaces the Phase A fixed dropdown. |
| GeoPackage ingest | ✅ | `src/core/ingest/gpkg.ts` — dependency-light reader on **sql.js** (SQLite WASM, lazy ~1 MB chunk fetched only when a .gpkg is imported; test path passes `wasmBinary` directly). GP binary blob header per spec (srs_id always present; bit 4 = empty-geometry flag) + recursive WKB reader (XY/Z/M, ISO Z/M type flags, multi-geometries). Routes through the same SurveyPoint pipeline as Shapefile/GeoJSON with category/code inference and typed attributes; Import accepts `.gpkg`. Byte-accurate fixture built by `scripts/build_gpkg_fixture.py` locks the roundtrip. |

**Verification:** 10/10 test suites pass (was 6), `tsc` clean, production build
 green, all 11 benchmark budgets honoured (pipeline @ 50k: 1.20 s). Manual QA:
 OSM/Esri tiles over the Nairobi job (overlay lands exactly on the real
 streets), offline pan with cached-tile continuity, CRS search + EPSG:32636
 pick, DEM probe chip, and a real `.gpkg` imported end-to-end in the UI
 (point + polyline + polygon + Z point → 10 vertices).

### Phase C — Desktop-grade (months 2–4) — ✅ DELIVERED (client-side scope)

*Goal: template-driven statutory output, write-side interoperability, and a
path into municipal databases — without breaking the offline promise.*

- **Print composer v2:** template-driven layouts (user-placed map frames,
  legends, tables) generating the Form 4 and Atlas from templates instead of
  bespoke SVG strings — same visual standard, user-configurable.
- **PROJ WASM** for pipeline datum transformations beyond the towgs84 pair.
- **GDAL WASM** (or a Tauri sidecar, as prior findings suggested) for
  read/write across the full format zoo, including GeoPackage transactional
  editing.
- **PostGIS connection** for municipal deployments (read-mostly sync).

#### Phase C delivery notes (this branch)

| Commitment | Status | Implementation |
|---|---|---|
| Print composer v2 | ✅ | `src/core/composer/` — versioned template schema (ISO A4–A1, mm-true geometry, 12 element kinds: map frame with fit/fixed-scale + layer toggles, computed tables, KPI strips, legends, method-note provenance block, certification/approval/signoff blocks, text with metadata tokens). `render.ts` renders any template against live pipeline state at 96 dpi — the engine physically cannot fabricate figures (every value resolves from `PipelineResult`, missing data renders as an em-dash). **Form 4 and Planning Atlas are now generated from templates** (`presets.ts`); the bespoke SVG exporters were deleted. New **Print Composer tab**: template/page/element rails, per-element properties (fit mode, fixed 1:N, layer toggles, text editing), live A-series preview, SVG download, direct print (`@page` sized), template save/load JSON. Both statutory viewers and the Export Hub route through the same engine — one code path, user-configurable. |
| GeoPackage write path | ✅ | `src/core/export/gpkg-writer.ts` — OGC-conformant writer on the shared lazy sql.js engine: `application_id 'GPKG'`, `user_version` 1.3, mandatory SRS rows (−1/0/4326) + working CRS with proj4 definition, `gpkg_contents` with computed extents, `gpkg_geometry_columns`, and three feature tables (`mr_beacons` POINT / `mr_vectors` LINESTRING / `mr_boundary` POLYGON) with typed attributes and GP binary blobs (XY envelope, little-endian WKB, closed rings). Export Hub row added; verified end-to-end **from the browser**: the downloaded file decodes with correct magic, application_id, contents rows, and geometry (21 beacons / 4 vectors / parcel polygon with attributes). |
| .prj / WKT CRS ingest | ✅ | `src/core/crs-wkt.ts` — dependency-free WKT tokenizer + projection builders (TM/UTM, LCC 1SP/2SP, Mercator 1SP/2SP, Cassini, Albers, LAEA, Stereographic, HOM, Krovak), datum/spheroid resolution (+a/+rf or +ellps aliases), TOWGS84 passthrough. EPSG recovery via AUTHORITY tags or parameter-matching against the built-in registry; when identified, the **canonical registry definition is adopted** so the real datum shift applies even though ESRI WKT omits `towgs84`. Every parse validates with a real proj4 round-trip. `ingestFiles` now returns `sourceCrs` and App reprojects to the working CRS automatically with a disclosed note (replaces the old "verify the CRS" warning). Real ESRI `Arc_1960_UTM_Zone_37S` and OGC bodies covered by tests. |
| PostGIS connection | ✅ (read path) | `src/core/postgis/` — EWKB parser (SRID/Z/M flags, collections with nested byte-order bytes, HexEWKB) + bridge client that fetches layers as `ST_AsHexEWKB` and routes them through the same ingest mapping as Shapefile/GeoPackage, with SRID-based reprojection on import. `bridge/postgis-bridge.mjs` — zero-dependency-except-`pg` **read-only** HTTP bridge (single SELECT/WITH statements only; stacked queries and write/DDL keywords rejected 403 before touching the pool; CORS; health/tables/query). **PostGIS Link panel** (Data tab): bridge endpoint (persisted), table listing via `geometry_columns`, per-layer import with disclosed reprojection. Bridge smoke-tested: write/stacked guards verified; error paths actionable. |
| PROJ WASM | ⏭ deferred | proj4 + WKT ingest covers the practical datum set for the target market (120 UTM zones, Arc 1960, paste-EPSG, .prj). Full PROJ grid shifts (NTv2) and exotic datums arrive with the desktop shell (Tauri sidecar), where PROJ runs natively — a 10 MB+ WASM for marginal coverage is the wrong trade today. |
| GDAL WASM | ⏭ deferred | The exchange formats that matter are now natively covered both ways — read: .shp/.dbf/.prj/.gpkg/GeoJSON; write: GeoPackage/DXF/LandXML/GeoJSON/SVG — with no 30 MB WASM. Revisit under the Tauri sidecar for the long tail (filegdb, coverage, raster IO). |

**Verification:** 14/14 test suites pass (was 10; +composer, +gpkg-writer
roundtrip, +crs-wkt, +ewkb), `tsc` clean, production build green, all 11
benchmark budgets honoured. Manual QA (screenshots `phaseC-01..17`): composer
Form 4 + Atlas templates live-edited and exported, both statutory tabs and
Export Hub render through the template engine, real .gpkg downloaded from the
browser and byte-verified, PostGIS panel connect/error paths, bridge
read-only guards.

### Phase D — The divergence (months 4+) — ✅ DELIVERED

This is where "revolutionize" stops being a word and becomes a moat:

1. **Provenance as a first-class feature.** Every exported number carries its
   method, inputs, and tolerances (expand `methodology-registry.ts` into a
   machine-readable provenance graph embedded in exports). Statutory reviewers
   can verify *how* a figure was produced, not just what it is. No incumbent
   does this well; survey markets will feel the difference immediately.
2. **Field-to-statute in one session.** The differentiator is already visible:
   GNSS file → adjusted traverse → Form 4 → atlas, offline, in minutes.
   Double down: guided traverse workflows, automatic misclosure diagnostics in
   plain language, one-click lodgement packages (LandXML + PDF + schedule).
3. **Decision documents, not maps.** Planners don't want layers; they want
   defensible dossiers. Make the atlas the primary artifact: uncertainty
   disclosure, sensitivity toggles (recompute MCDA weights live in the export
   preview), and versioned scenarios side-by-side.
4. **Edge-first collaboration.** When multi-user arrives, sync **project files**
   (CRDT over `.metardu.json`) rather than running a server product — matches
   the connectivity reality of the target market and keeps the offline promise.

#### Phase D delivery notes (this branch)

| Commitment | Status | Implementation |
|---|---|---|
| Provenance graph | ✅ | `src/core/provenance.ts` — a machine-readable source → process → figure graph built **only** from live pipeline state. Every figure node carries its method citation (registry-resolved), resolved inputs, and a stated tolerance/limitation — never bare. Deterministic FNV-1a integrity digest: any change to inputs, weights, or results changes it (tamper-evident). **Embedded in every export:** GeoJSON foreign member (RFC 7946 §6.1), LandXML comment block, GeoPackage `mr_provenance` attributes table (with digest header row), `.metardu.json` project file. A compact register renders on paper via a new composer **Provenance table element**. **Provenance tab** (Data group): digest, audited figures with expandable lineage, sources, processes with measured durations, JSON export. Locked by `tests/provenance.test.ts` (structure, referential integrity, digest determinism/tamper, project roundtrip, export embeds). |
| Guided traverse workflow | ✅ | **Traverse tab** (Analysis group): enter field observations or **load the boundary traverse from the document** (zero-length closure stubs skipped), adjust by Bowditch against class tolerances (1:10,000 / 1:5,000 / 1:2,500), then **promote adjusted coordinates into the document** as an undoable command. |
| Plain-language misclosure diagnostics | ✅ | `src/core/traverse-diagnostics.ts` — every sentence derived from the adjustment report: precision verdict against the class, misclosure in centimetres with error direction, east–west vs north–south axis bias with re-observation guidance, largest-correction leg, method disclosure. No fabricated guidance; failing traverses are told to re-observe, not to adjust past the failure. |
| One-click lodgement package | ✅ | `src/core/export/lodgement.ts` — dependency-free ZIP writer (store + CRC-32) bundling: LandXML (carrying the provenance block), `provenance.json`, beacon + adjusted-traverse schedules (CSV), print-ready Form 4 SVG, and a `MANIFEST.txt` quoting the digest and real figures. Export Hub row added. Verified twice: structural parse-back in `tests/field-to-statute.test.ts` (41 assertions) and **Python `zipfile` interop** (CRC valid, all six entries readable). |
| Sensitivity toggles in the export preview | ✅ | **Planning Atlas sensitivity rail** — MCDA weight/constraint sliders re-evaluate the suitability model live (indexed warm evaluation, debounced) and re-render the A3 sheet; live class-distribution bar; reset to document defaults; downloads are suffixed `_sensitivity` when weights differ. `renderTemplate` gained `RenderOptions`: the method & limitations note discloses the exact weights ("user-adjusted for sensitivity review" vs "document defaults") plus an explicit **uncertainty line** bounded by traverse precision. |
| Versioned scenarios side-by-side | ✅ | `src/core/scenario-compare.ts` + **Scenario Compare tab** — geometry-free metric snapshots (area, precision, suitability mix, sinks, exposed assets, households, CAPEX) frozen **with the weights that produced them**; side-by-side table with deltas judged by direction of merit against a re-assignable baseline. Session-scoped, computed at capture time. |
| Edge-first collaboration | ✅ | `src/core/crdt/crdt.ts` — dependency-free CRDT: LWW registers + add-wins point set under a total order on (lamport, replicaId); merge is idempotent, commutative, associative; tombstones with causal resurrection; bounded op-id memory. `project-crdt.ts` projects `.metardu.json` state to/from ops without inventing values. **Edge Sync tab** (Data group): persistent replica with incremental snapshot diffing (op ids unique forever), `.metardu-changes.json` export (idempotent replay), change-file merge, merged state becomes an undoable pipeline document. `bridge/sync-bridge.mjs` — zero-dependency in-memory op relay (health / `GET /ops?since=N` / `POST /ops` with dedup, 20 MB + 500k-op caps, envelope validation); memory-only, replicas stay authoritative, so offline always works. Locked by `tests/crdt.test.ts` (21 assertions incl. a two-replica concurrent-edit scenario: field crew vs office). |

**Verification:** 18/18 test suites pass (was 14; +provenance, +field-to-statute,
+decision-documents, +crdt), `tsc` clean, production build green, all 11
benchmark budgets honoured (pipeline @ 50k: 1.31 s). Manual QA (screenshots
`phaseD-01..09`): provenance register with lineage, traverse loaded from the
document boundary and adjusted (1:700,824 verdict with diagnostics), atlas
sensitivity slider with on-sheet weights disclosure, scenario snapshots with
delta table, Edge Sync replica export ("47 ops") and a live relay push
("Pushed 47 ops … relay head at 47"). The relay was additionally smoke-tested
with curl (accept, dedup, pull cursor, malformed-payload guards).

### Sequencing principle

Each phase must leave the statutory-output bar *higher*, not merely add
features. The document standard set in Part I is the contract: any new feature
that renders on a map or a sheet must arrive with decluttered labels, computed
figures only, and provenance.
