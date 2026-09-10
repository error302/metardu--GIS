# MetaRDU GIS Studio

> **Autonomous Spatial Intelligence, Cadastral Automation & Decentralized Electrification Workstation**

MetaRDU GIS Studio is a high-performance, offline-capable geospatial workstation engineered for professional GIS specialists, licensed land surveyors, municipal urban planners, and off-grid energy engineers. It bridges the gap between raw field surveys, statutory cadastral governance, multi-criteria planning, and decentralized electrification—operating with sub-second execution speeds and zero server roundtrips.

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

### 8. Interactive On-Canvas Vector Digitizing & Cadastral COGO
* **On-Canvas Beacon Drop Tool**: Direct interactive point creation with automatic MSL elevation interpolation from terrain TIN / contours and auto-incrementing beacon IDs (`BK1`, `BK2`...).
* **Real-time Snapping Aperture Engine**: Magnetic snapping to both vertices and segment edges within a configurable screen-space tolerance (14px). Visual cyan snapping ring with crosshair and element type indicator.
* **COGO Metes & Bounds Traversal Ribbon**: Draft statutory boundary legs directly on the canvas by entering Bearing ($DD^\circ MM' SS"$) and Distance ($m$) with live rubber-band preview and inverse metric callouts.
* **Vertex Editor & Reshaping**: Interactive vertex drag-and-drop with real-time snapping to adjacent geometry and topological coordinates.
* **Command History & Undo/Redo Engine**: Memento pattern implementation with full undo/redo stack (`Ctrl+Z`, `Ctrl+Y`) and UI toolbar buttons.

### 9. Visual Print Layout Composer (QGIS Print Layout Parity)
* **Interactive Cartographic Sheet Designer**: Dedicated layout composition workspace supporting ISO standard page formats:
  * **A4 Landscape & Portrait** ($297 \times 210$ mm)
  * **A3 Landscape & Portrait** ($420 \times 297$ mm)
  * **A1 Engineering Sheet** ($841 \times 594$ mm)
* **Standard Engineering Scales**: 1:250, 1:500, 1:1,000, 1:1,250, 1:2,000, 1:2,500, 1:5,000, 1:10,000, plus automated "Auto-Fit" scale calculator.
* **Draggable & Configurable Layout Frames**:
  * Scaled Map Frame with metric coordinate border neatlines and graticule ticks (+)
  * Dynamic Layer Legend reflecting active symbology
  * Segmented Graphical Metric Scale Bar
  * Multi-blade Nautical North Arrow
  * Official Surveyor & Municipal Title Block with customizable registration credentials
  * Auto-populated Beacon Coordinate Schedule Table (ID, Easting, Northing, Orthometric Height)
* **High-Resolution Multi-Format Exporters**:
  * 1-Click Export to **Print-Ready Vector SVG**
  * **300 DPI High-Resolution PNG** rasterization for physical printing
  * Direct browser **Print-to-PDF** with CSS `@page` layout styling

### 10. Multi-Source Satellite & Remote Sensing Tile Streamer
* **Real Slippy Map Tile Renderer**: Client-side Web Mercator ($EPSG:3857$) tile streaming engine with on-the-fly geodetic reprojection and sub-pixel canvas blitting.
* **Supported Tile Providers**:
  * **ESRI World Imagery**: High-resolution true-color satellite aerial photography.
  * **OpenStreetMap Standard**: Regional street and infrastructure cartography.
  * **NASA GIBS Night-Time Lights (VIIRS Black Marble)**: Nocturnal satellite radiance data identifying un-electrified rural gaps.
  * **CartoDB Dark Matter**: Dark-slate cyber-cartographic vector base.
* **Tile Cache & Offline Resilience**: In-memory LRU tile cache with asynchronous image loading and smooth viewport panning.

### 11. Advanced Spatial Analysis & Geoprocessing Extensions
* Expanded processing toolbox with 11 production GIS algorithms:
  * **Thiessen / Voronoi Polygons**: Optimal service area catchment boundaries around facilities using half-plane clipping.
  * **Spatial Join (Point-in-Polygon Aggregation)**: Aggregates settlement points into cadastral parcels, computing point count, average elevation, and total daily electricity demand.
  * **Convex Hull Generator**: Minimal enclosing bounding polygon in $O(N \log N)$ time using Andrew's Monotone Chain algorithm.
  * **Cadastral Equal-Area Subdivision**: Splits a boundary parcel into $N$ equal-area sub-plots along the primary survey axis.

---

## 1-Click Statutory Deliverables Export

* **Official Form 4 Statutory Deed Plan (Mutation Sheet)**: Formatted with official survey border, title block, coordinate graticule grid, true north arrow, metric scale bar, and Beacon Coordinate Schedule Table.
* **Regional Planning Atlas**: Pre-composed decision dossier with executive KPI cards, suitability choropleth, hazard vulnerability matrix, and municipal approval blocks.
* **Print Layout Composer Deliverables**: Vector SVG, 300 DPI PNG, and print-ready PDF sheets.
* **AutoCAD DXF R2018**: Layered CAD drawing (`BOUNDARIES`, `CONTOURS`, `BEACONS`, `BUFFERS`).
* **Standards-Compliant GeoJSON**: RFC 7946 with CRS header and dynamic attribute properties.
* **LandXML 1.2 Digital Cadastre**: National land portal digital lodgement schema.
* **Attribute Table CSV**: Full coordinate mutation schedule with custom properties.

---

## Test Suite & Verification

The workstation includes 7 automated test suites verifying geodetic accuracy, parser robustness, mathematical precision, and spatial algorithms:

```bash
# Run all 7 test suites
npm test

# Production build
npm run build
```

1. `tests/crs.test.ts`: Round-trip geodetic datum transforms verified to $< 1$ mm precision.
2. `tests/parser-calculator.test.ts`: CSV attribute retention, expression evaluation, and roundtrip serialization verified.
3. `tests/cogo-traverse.test.ts`: COGO forward/inverse, ray intersections, Bowditch adjustment, and topology snapping verified.
4. `tests/project.test.ts`: Complete `.metardu.json` project snapshot and restore verified.
5. `tests/digitizing-cogo.test.ts`: Memento pattern undo/redo, point-to-segment distance, vertex & edge snapping, and COGO radiation verified.
6. `tests/tile-math.test.ts`: Web Mercator tile index conversions, bounding boxes, and dynamic zoom calculation verified.
7. `tests/geoprocessing-advanced.test.ts`: Shoelace area, Jordan ray-casting, convex hull, spatial join aggregation, Voronoi partitions, and equal-area subdivision verified.

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

* **UI & Workstation Architecture**: React 19, TypeScript 5.7, Tailwind CSS v4, Lucide Icons
* **Geodesy & Projections**: `proj4`, EGM2008 Geoid Model, Vincenty Geodesy
* **Computational Geometry**: Delaunay Triangulation, Marching Squares, Bowyer-Watson, Bowditch Least-Squares
* **Build System**: Vite 6, Rolldown

---

## License

MIT License. Designed for land surveyors, GIS specialists, and regional planners across Africa and emerging markets.