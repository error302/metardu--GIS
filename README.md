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
* **Live ground truth, offline-first:** XYZ raster basemaps (OSM / Esri) with Cache-API persistence, the official NGA EGM2008 2.5′ geoid grid for East Africa, and Terrarium terrain-tile DEM probes.

### 10. Print Composer (Desktop-Grade Cartography)
* Versioned template schema (ISO A4–A1, mm geometry) with 13 composable element kinds: map frames (fit or fixed 1:N), computed tables, KPI strips, legends, method-note provenance, locator insets, certification and signoff blocks.
* Statutory Form 4 and Planning Atlas presets route through one render engine with live fit preview, SVG download, 300-DPI PNG rasterisation (fonts embedded), and @page-sized print.
* **Atlas cartography:** TIN facet shaded relief (NW 315° / 45° sun) beneath the theme, index-contour elevation labels with halo text (arc-length placement, upright, budgeted), point-label decluttering (hazard > cluster), boundary casing, graticule ticks, and a locator inset placing the parcel on an adaptive UTM grid with the zone captioned.
* Legends disclose their classification: per-class counts and the exact MCDA class breaks from the engine's own constants — every colour on the sheet is re-derivable.
* Sensitivity analysis: MCDA weight sliders re-evaluate the composed decision sheet live, with exact weights and uncertainty disclosed on the sheet.

### 11. Field-to-Statute Workflow
* Guided traverse workflow: load a boundary, compute misclosure in plain language (verdict, axis bias, worst leg, class tolerance), apply Bowditch adjustment as an undoable document push.
* One-click lodgement package: LandXML + provenance JSON + beacon/traverse CSV schedules + Form 4 SVG in a single ZIP with a manifest.

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

Twenty test suites verify geodetic accuracy, parser robustness, mathematical precision, spatial-index parity against brute force, Shapefile byte roundtrips, GeoPackage writer conformance, WKT CRS parsing, EWKB reading, provenance integrity, CRDT convergence, and GEOS-parity corridor geometry:

```bash
# Run all 20 test suites
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