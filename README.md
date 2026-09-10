# MetaRDU GIS Studio

> **Autonomous Spatial Intelligence, Cadastral Automation & Decentralized Electrification Workstation**

MetaRDU GIS Studio is a high-performance, offline-capable geospatial workstation engineered for professional GIS specialists, licensed land surveyors, municipal urban planners, and off-grid energy engineers. It bridges the gap between raw field surveys, statutory cadastral governance, multi-criteria planning, and decentralized electrification—operating with sub-second execution speeds and zero server roundtrips.

The full 50,000-point processing pipeline runs in ~1.2 s off the main thread in a Web Worker, every figure on every statutory document is computed from live pipeline state (never fabricated), and the workstation reads and writes the exchange formats the African GIS economy actually uses—Shapefile, GeoPackage, DXF, LandXML, GeoJSON.

---

## Capabilities & Feature Matrix

### 1. Geodetic & Coordinate Reference System (CRS) Engine
* **PROJ Parity**: Real datum forward/inverse transformations via `proj4` registered with African and international datums:
  * **EPSG:21037**: Arc 1960 / UTM zone 37S (Survey of Kenya standard cadastre)
  * **EPSG:32637**: WGS 84 / UTM zone 37N (East Africa)
  * **EPSG:32636**: WGS 84 / UTM zone 36N (Western Kenya / Uganda / Ethiopia)
  * **EPSG:4326**: WGS 84 Geographic (Decimal Degrees / DMS)
  * **EPSG:3857**: Web Mercator (Global Basemaps)
* **Real-time Geodetic Cursor**: Displays active EPSG, Easting ($m$), Northing ($m$), Orthometric MSL Elevation ($m$), and converted WGS 84 Latitude/Longitude with sub-millimeter precision.
* **Geoid Undulation Model**: Pluggable EGM2008 geoid separation ($H = h - N$) converting GNSS ellipsoidal heights to statutory Mean Sea Level elevation.
* **On-the-Fly Reprojection**: Switch active CRS from the header toolbar to reproject all coordinates and geometry in real time.

### 2. GIS Attribute Table & Field Calculator
* **Full Attribute Retention**: Preserves all custom attribute columns upon ingestion from CSV, TSV, GeoJSON, and KML files.
* **QGIS-Style Virtual Table**: Paginated display, multi-column search, category filtering, column sorting, inline cell editing, and bi-directional selection synchronization with the 2D map canvas.
* **Schema Management**: Add new attribute columns (String, Number, Boolean) or delete custom fields on the fly.
* **GIS Field Calculator**: Evaluates expressions across dataset features:
  * **Geometric Variables**: `$x` (Easting), `$y` (Northing), `$z` (Elevation), `$id`, `$code`, `$cat`, `$lat`, `$lon`
  * **Mathematical Functions**: `round()`, `floor()`, `ceil()`, `sqrt()`, `pow()`, `abs()`, `min()`, `max()`
  * **String Functions**: `concat()`, `upper()`, `lower()`, `trim()`, `substr()`
  * **Conditionals**: `if(condition, trueValue, falseValue)`
  * **Expression Presets**: Pre-built templates for coordinate labels, kilometer conversion, elevation tiers, and setback buffers.

### 3. Layer Management & Symbology System
* **Layer Hierarchy**: Z-index stacking order with move up/down controls.
* **Dynamic Symbology**:
  * **Single Symbol**: Customizable stroke color, stroke width, fill color, and opacity.
  * **Categorized Symbology**: Attribute-driven thematic styling (e.g. boundary beacons, control monuments, rivers, roads).
  * **Graduated Symbology**: Quantile and equal-interval classes across numeric attributes with scientific color ramps (Viridis, Magma, Spectral, Blues, Greens, Reds, Amber).
* **Opacity Controls**: Interactive transparency sliders per layer (0% to 100%).

### 4. COGO (Coordinate Geometry) & Traverse Adjustment
* **Forward Polar Radiation**: Calculate station coordinates from instrument point, bearing, and slope/horizontal distance:
  $$E_2 = E_1 + D \sin(\theta), \quad N_2 = N_1 + D \cos(\theta)$$
* **Inverse Computation**: Calculates horizontal distance, forward grid bearing (DD°MM'SS"), and coordinate differences $(\Delta E, \Delta N)$.
* **Bearing-Bearing Intersection**: Computes coordinate intersection of two rays.
* **Parallel Line Offset**: Generates statutory corridor reservations parallel to baseline segments.
* **Bowditch Traverse Adjustment (Compass Rule)**: Evaluates closed polygon loops and link traverses:
  * Computes linear misclosure $\sqrt{e_E^2 + e_N^2}$, perimeter $P$, and relative precision ratio ($1:N$).
  * Distributes misclosure proportionally to leg distances, verifying statutory Class A ($1:10,000$) and Class B ($1:5,000$) tolerances.
* **Cadastral Topology Auditor & Repair**: Auto-detects duplicate vertices within snapping distance, unclosed loops, and applies topological vertex snapping.

### 5. Geoprocessing Toolbox
* Composable GIS processing registry with 7 core spatial algorithms:
  1. **Corridor & Setback Buffer**: Variable road reserves (15m/30m) and riparian exclusions (30m).
  2. **Topographic Contour Interpolator**: Interpolates continuous contour lines at customizable vertical intervals (0.5m, 1m, 2m, 5m).
  3. **Delaunay TIN Mesh Constructor**: 2.5D triangulated irregular network surface.
  4. **Settlement Suitability Modeler (MCDA)**: Multi-criteria raster evaluation based on slope, road access, and riparian setbacks.
  5. **Off-Grid Techno-Economic Sizer**: Parametric energy demand, solar PV array, battery storage, and CAPEX estimation.
  6. **Cadastral Topology Auditor & Repair**: Snaps close vertices and repairs boundary rings.
  7. **Bowditch Traverse Adjustment**: Closed polygon mathematical adjustment.

### 6. Generic Off-Grid Electrification Planner
* Decoupled from vendor-specific logic; conforms to SE4All / World Bank ESMAP methodology.
* User-configurable techno-economic parameters via dynamic sliders:
  * **Turnkey Solar PV Cost ($/kWp)**: Defaults to $1,100/kWp
  * **Battery Storage Cost ($/kWh)**: Defaults to $350/kWh (LiFePO4)
  * **Daily Household Demand (kWh/day)**: Tier 2 / Tier 3 consumption
  * **Grid Distance Cutoff (km)**: Threshold beyond which off-grid is least-cost
  * **Mini-Grid Household Threshold**: Minimum homestead count to justify mini-grid infrastructure
  * **Peak Sun Hours & Autonomy Days**: Solar irradiance and storage backup duration
* Tiered Presets: **Basic Lighting (Tier 1)**, **Standard Productive (Tier 2/3)**, and **Productive Agro-Processing (Tier 4)**.

### 7. Project Persistence (`.metardu.json`)
* Complete workspace state saving and restoration:
  * Project metadata & active CRS
  * Survey points & calculated attributes
  * Layer stack, visibility, opacity, and custom symbology
  * Off-grid electrification parameters
  * MCDA suitability weights
* 1-Click "Save Project" and "Open Project" from the application header.
* Optional CRDT change-set export (`.metardu-changes.json`) for field-to-office sync.

### 8. Data Ingress & Egress (Field-to-Office Interchange)
* **Read:** Shapefile (`.shp` + `.dbf` + `.shx` + `.prj`, shape types 1/3/5/8 with Z/M variants), dBASE III field typing (C/N/F/D/L), GeoJSON, CSV/TSV, KML, LandXML, GeoPackage (`.gpkg` via lazy sql.js WASM), and live PostGIS layers (read-only HTTP bridge with single-statement write guards).
* **Write:** GeoPackage (OGC-conformant, byte-verified), AutoCAD DXF R2018, LandXML 1.2, RFC 7946 GeoJSON, print-ready SVG sheets, CSV schedules, and one-click statutory lodgement ZIP bundles.
* `.prj` sidecars are parsed by a dependency-free WKT engine (TM/UTM, LCC, Mercator, Cassini, Albers, LAEA, Stereographic, HOM, Krovak) and geometry is auto-reprojected to the working CRS with a disclosed note.

### 9. Platform Architecture (Performance & Reliability)
* **Web Worker pipeline** with a 9-stage progress protocol; transparent main-thread fallback keeps the UI responsive during heavy runs.
* **Uniform-grid spatial index** (points/triangles/segments) with brute-force parity tests; MCDA distance queries drop from O(n·m) to O(local).
* **Renderer v2:** static-scene caching, viewport culling, LOD dot-mode beyond ~2,000 visible points.
* **Undo/redo command history** (Ctrl+Z / Ctrl+Shift+Z) over labeled document operations.
* **Benchmark harness** with hard, CI-exitable budgets over deterministic 10k/50k synthetic scenarios (`npm run bench`).
* **Machine-readable provenance graph** (FNV-1a digest, tamper-evident) embedded in every export—each figure carries its method citation, resolved inputs, and stated tolerance.
* **Edge-first CRDT** (LWW registers + add-wins sets) for offline-first multi-device project sync, with an optional zero-dependency LAN relay.
* **Live ground truth, offline-first:** XYZ raster basemaps (OSM / Esri / Sentinel-2 cloudless / OpenTopoMap) with Cache-API persistence, the official NGA EGM2008 2.5′ geoid grid for East Africa, Terrarium terrain-tile DEM probes, and Copernicus DEM GLO-30 regional grids (in-browser GeoTIFF reader, Planetary Computer crop endpoint).

### 10. Print Composer (Desktop-Grade Cartography)
* Versioned template schema (ISO A4–A1, mm geometry) with 13 composable element kinds: map frames (fit or fixed 1:N), computed tables, KPI strips, legends, method-note provenance, locator insets, certification and signoff blocks.
* Statutory Form 4 and Planning Atlas presets route through one render engine with live fit preview, SVG download, 300-DPI PNG rasterisation (fonts embedded), and @page-sized print.
* **Atlas Series (multi-sheet map book):** the project extent tiles into an atlas of sheets at ONE uniform scale drawn from a standard engineering/topographic series (1:250–1:1,000,000) — auto mode takes the largest scale fitting a sheet cap (1/4/9/16/25), fixed-scale mode is honoured with any cap breach disclosed on the plan and on the sheets themselves. Sheets tile on a common grid with a configurable overlap (default 10 %, centred symmetrically) so grid lines continue across neighbours; rows are lettered A (north) downward, columns numbered from the west; every sheet's frame edges carry neighbour go-to tabs. Each sheet renders with an absolute-value graticule (round 50 m–100 km steps), edge coordinate labels, north arrow, backed scale bar, identity header, and factual footer; a generated SHEET INDEX sheet shows every rectangle plus the amber project extent at disclosed approximate scale. Per-sheet SVG / 300-dpi PNG / print, plus export-all for the whole book including the index.
* **Atlas cartography:** TIN facet shaded relief (NW 315° / 45° sun) beneath the theme, index-contour elevation labels with halo text (arc-length placement, upright, budgeted), point-label decluttering (hazard > cluster), boundary casing, graticule ticks, and a locator inset placing the parcel on an adaptive UTM grid with the zone captioned.
* Legends disclose their classification: per-class counts and the exact MCDA class breaks from the engine's own constants — every colour on the sheet is re-derivable.
* Sensitivity analysis: MCDA weight sliders re-evaluate the composed decision sheet live, with exact weights and uncertainty disclosed on the sheet.

### 11. Field-to-Statute Workflow
* Guided traverse workflow: load a boundary, compute misclosure in plain language (verdict, axis bias, worst leg, class tolerance), apply Bowditch adjustment as an undoable document push.
* One-click lodgement package: LandXML + provenance JSON + beacon/traverse CSV schedules + Form 4 SVG in a single ZIP with a manifest.

### 12. OSINT Ground Context (Open-Source Intelligence)
* **Overpass connector:** query OpenStreetMap around the working extent (document bbox reprojected to WGS84, padding radius 1–25 km, 1°-per-axis area cap) for five feature presets — buildings, roads & tracks, watercourses, land use, named places (buildings/water/landuse also select their multipolygon relations). Deterministic query builder, `out geom` inline parsing, and endpoint failover (overpass-api.de → kumi mirror) with a 30 s timeout.
* **Multipolygon assembly:** OSM relations (the mapping form of land use blocks, water bodies and estates) assemble into real polygon geometry with holes — member ways chain into closed rings by exact endpoint matching, role-less members classify by containment, holes attach to their smallest containing outer, and rings normalize to RFC 7946 orientation. Anything that cannot be closed from the data is skipped and counted; member ways of assembled relations are consumed instead of duplicating as standalone features.
* **Import parity:** OSM features land as coded survey vertices (`place/building/highway/waterway/landuse` tag priority, names carried into descriptions, bounded 14-tag attribute subset, stable `OSM-n<id>`/`-w<id>-v<n>`/`-r<id>-v<n>` ids) and are reprojected from WGS84 into the **active** working CRS — the canvas, attribute table, MCDA, and composer treat them like any imported layer. A 10.4 × 10.4 km Nairobi pull (~20,000 features → ~149k vertices) runs the full pipeline in ~2.5 s.
* **Sentinel-2 epoch change screens:** pixel-difference two annual EOX s2cloudless mosaics (2017–2024, key-free, CORS-open) over the query scope. Epochs are radiometrically normalized by luma histogram matching before differencing (a live Nairobi 2018-vs-2024 screen dropped from 98.8% saturated to 25.2% flagged cells); changed pixels aggregate into measurable ~300 m cells that flag at a chosen ratio. Results land as a summary strip, a grayscale/red preview whose tint matches the stats exactly, a flagged-cell CSV schedule, and a GeoJSON grid carrying the license and method metadata — screening evidence to verify against the imagery pair, never a determination.
* **Active-fire watchlists (NASA FIRMS):** standing VIIRS (375 m, S-NPP/NOAA-20/NOAA-21) and MODIS (1 km) thermal-anomaly monitors over any saved scope, with a 1–10-day look-back per check and a free local MAP_KEY. Deterministic alert ids (FNV-1a over source|position|acquisition) make every check an exact set-difference against the persisted seen-ring — the panel badges “+N new” since the last look. Detections import as coded points carrying acquisition time, confidence and FRP; watchlists and seen-alert rings persist in the browser.
* **Regional terrain (Copernicus DEM GLO-30):** one-click 30 m elevation grid around the job through the Planetary Computer Data API crop endpoint (open CORS, no credentials): uncompressed float32 GeoTIFFs decoded in-browser (dependency-free reader), per-tile crops mosaicked into one WGS84 grid, query window padded to ≥ 3 km and resampling disclosed when the pixel cap bites. The Regional Terrain panel reports elevation statistics, Horn slope distribution, an along-axis terrain profile, and 20 m marching-squares contours with the document extent overlaid — regional raster context, never a statutory elevation source.
* **Place locate (Nominatim):** forward geocoding with a client-side 1 request/second floor (OSMF policy); a result reframes the 2D canvas to the combined document + place extent (1.6 km floor, 1:500 cap) with an amber focus marker, so the place is always seen relative to the job. Each search lands in the provenance registry.
* **Jurisdictional context (geoBoundaries):** ADM0/1/2 administrative geometry for any ISO-3 country, metadata license + year recorded verbatim, geometry fetched CORS-direct (GitHub LFS media host with published-URL fallback) and clipped at ring level — a county containing the job is kept whole rather than dropped by vertex filtering. Imports as boundary-category coded vertices with full clipped/truncated disclosure.
* **Honesty contract:** relations assemble completely or are skipped with the reason counted (missing member geometry, unclosable rings) — a partial geometry is never invented; orphan inner rings are excluded and disclosed; unresolved ways are disclosed; OSM, Sentinel-2 screens, fire detections, DEM rasters and open boundaries are labeled *indicative context — NOT survey-grade* in the UI, the import notes, and every provenance graph.
* **Chain of custody:** every fetch — Overpass, s2cloudless epochs, FIRMS windows, GLO-30 tiles, Nominatim searches, boundary downloads — is recorded in a session provenance registry (service, endpoint, license, attribution, timestamp, feature count, scope) that flows into the provenance graph as `src:external-*` nodes — embedded in GeoJSON, LandXML, GeoPackage, and lodgement exports.
* **Open basemaps:** Sentinel-2 cloudless mosaic (EOX, modified Copernicus data, ~10 m/px) and OpenTopoMap (OSM+SRTM, CC-BY-SA) join OSM and Esri imagery as XYZ basemaps with persistent offline caching and on-canvas attribution.

---

## 1-Click Statutory Deliverables Export

* **Official Form 4 Statutory Deed Plan (Mutation Sheet)**: Formatted with official survey border, title block, coordinate graticule grid, true north arrow, metric scale bar, and Beacon Coordinate Schedule Table.
* **Regional Planning Atlas**: Pre-composed decision dossier with executive KPI cards, suitability choropleth, hazard vulnerability matrix, and municipal approval blocks—every KPI computed from live pipeline state, with a method-and-limitations disclosure on the sheet.
* **GeoPackage (OGC)**: Conformant write path (application id, contents, geometry columns) for mr_beacons, mr_vectors, mr_boundary, and mr_provenance attribute tables.
* **Lodgement ZIP**: LandXML + provenance + CSV schedules + Form 4 sheet in one bundle with a manifest.
* **AutoCAD DXF R2018**: Layered CAD drawing (`BOUNDARIES`, `CONTOURS`, `BEACONS`, `BUFFERS` as closed LWPOLYLINE rings).
* **Standards-Compliant GeoJSON**: RFC 7946 with CRS header, dynamic attribute properties, embedded provenance, and corridor Polygon features.
* **LandXML 1.2 Digital Cadastre**: National land portal digital lodgement schema.
* **Attribute Table CSV**: Full coordinate mutation schedule with custom properties.

---

## Test Suite & Verification

Twenty-nine test suites verify geodetic accuracy, parser robustness, mathematical precision, spatial-index parity against brute force, Shapefile byte roundtrips, GeoPackage writer conformance, WKT CRS parsing, EWKB reading, provenance integrity (including OSINT chain of custody), CRDT convergence, GEOS-parity corridor geometry, atlas cartography, the atlas series planner and renderer (uniform-scale tiling, cap disclosure, overlap geometry, neighbour graph, sheet furniture, index sheet, explicit-extent frames), and the OSINT surface (Overpass query determinism and failover plus multipolygon ring assembly, Nominatim parsing and rate discipline, geoBoundaries clipping and URL failover, Sentinel-2 tile planning and radiometric normalization, FIRMS CSV parsing and watchlist diffing, GLO-30 GeoTIFF decoding against byte-exact fixtures, and DEM analysis against analytic ramps):

```bash
# Run all 29 test suites
npm test

# Performance benchmarks (hard budgets, CI-exitable)
npm run bench

# Type check + production build
npx tsc --noEmit
npm run build
```

Corridor buffers are validated against reference polygons generated with **GEOS** (shapely — the engine behind QGIS/PostGIS) over six deterministic fixtures at 15 m/30 m widths: area within 0.5 %, boundary agreement within 0.10 m both ways, ring simplicity enforced. All benchmark budgets honoured at head: 50k-point pipeline ≈ 1.2 s, MCDA warm re-evaluation ≈ 190 ms, undo/redo 1,000 ops ≈ 0.5 ms.

---

## Getting Started

### Installation

```bash
# Clone repository
git clone https://github.com/error302/metardu--GIS.git
cd metardu--GIS

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

Open `http://localhost:5173/` in your browser.

---

## Technology Stack

* **UI & Workstation Architecture**: React 19, TypeScript 5.7, Tailwind CSS v4, Lucide Icons, IBM Plex Sans/Mono, Web Workers
* **Geodesy & Projections**: `proj4`, dependency-free ESRI WKT parser, EGM2008 Geoid Model (official NGA grid), Vincenty Geodesy
* **Computational Geometry**: Delaunay triangulation (`delaunator` sweep-hull), Marching Squares, uniform-grid spatial indexing, Bowditch Least-Squares, GEOS-parity corridor joins
* **Data Interchange**: sql.js (GeoPackage read/write), dBASE III parser, EWKB (PostGIS), store+CRC-32 ZIP writer
* **Build System**: Vite 6, Rolldown

---

## License

MIT License. Designed for land surveyors, GIS specialists, and regional planners across Africa and emerging markets.