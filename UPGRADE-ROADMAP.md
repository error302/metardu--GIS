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

### Phase A — Front-end GIS hardening (next 2–4 weeks)

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

### Phase B — Connected when available, offline-first always (weeks 4–8)

- **Basemap tiles:** OSM raster + optional satellite URL templates with graceful
  offline fallback to the current vector basemaps; Service Worker tile cache.
- **Real geoid:** ship EGM2008 grid subset (East Africa tile, ~2–6MB compressed)
  loaded lazily; replaces the sinusoidal mock with statutory-grade H = h − N.
- **Elevation tiles:** Terrarium/Mapzen DEM tiles for regional context beyond
  the surveyed TIN footprint.
- **CRS expansion:** PROJ search + paste-EPSG UX (the proj4 registry is already
  there; the UI should accept any EPSG string, not a fixed list).

### Phase C — Desktop-grade (months 2–4)

- **PROJ WASM** for pipeline datum transformations beyond the towgs84 pair.
- **GDAL WASM** (or a Tauri sidecar, as prior findings suggested) for
  read/write across the full format zoo, including GeoPackage transactional
  editing.
- **Print composer v2:** template-driven layouts (user-placed map frames,
  legends, tables) generating the Form 4 and Atlas from templates instead of
  bespoke SVG strings — same visual standard, user-configurable.
- **PostGIS connection** for municipal deployments (read-mostly sync).

### Phase D — The divergence (months 4+)

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

### Sequencing principle

Each phase must leave the statutory-output bar *higher*, not merely add
features. The document standard set in Part I is the contract: any new feature
that renders on a map or a sheet must arrive with decluttered labels, computed
figures only, and provenance.
