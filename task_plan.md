# Task Plan: Metardu GIS Studio — Desktop-Grade Rival to QGIS / ArcGIS

## Goal
Transform MetaRDU GIS Studio from a 9-stage demo pipeline with hardcoded vendor brands into a generic, extensible, offline-capable **Metardu Desktop** workstation that automates the full GIS Specialist + Surveyor + Planner workflow and reaches functional parity with QGIS / ArcGIS Pro for everyday cadastral, topographic, suitability, and electrification tasks.

## Status Summary
All 8 planned development phases towards QGIS / ArcGIS Pro functional parity have been successfully engineered, integrated, and verified with comprehensive automated test suites and production TypeScript builds.

## Phases

### Phase 1: De-Branding & Methodology Abstraction — Generic Reference Architecture
- [x] Audit all 35 branded hits (`Sun King`, `UN-Habitat`, `VIIRS` hard-brand) via grep
- [x] Create `src/core/methodology-registry.ts` — registry of methods with `{ id, genericName, referenceOrg, citation, methodology, defaultParams, uiLabel }` — vendor brands abstracted to scientific citations
- [x] Replace UI strings: `Sun King Energy Reach` → `Off-Grid Electrification Planner`, `UN-Habitat Climate MCDA` → `Settlement Suitability (MCDA)`, `UN-Habitat Planning Atlas` → `Regional Planning Atlas`, `NASA VIIRS NTL` → `Night Lights Overlay`
- [x] Remove prescriptive sales copy in `EnergyPlanningPanel.tsx` — replace with generic techno-economic + cost-model output
- [x] Refactor `src/data/sample-surveys.ts` scenario metadata to generic organizations
- [x] Add `methodologyInfo` via tooltip spans (header badge in EnergyPlanningPanel; registry consumed in tooltips)
- **Status:** complete

### Phase 2: Geodetic & CRS Foundation (PROJ Parity)
- [x] Integrate `proj4` (npm: `proj4` + `@types/proj4`)
- [x] Build `src/core/crs.ts` — `CRSDefinition`, `transform()`, `listSupportedEPSG()`, `geoidUndulation()` with EGM2008 geoid model ($H = h - N$)
- [x] Replace approximate lat/lon calculations in `src/core/pipeline.ts` with real forward/inverse `proj4` transforms
- [x] Wire `reduceOrthometricHeight` in `src/core/geodesy.ts` with pluggable geoid model
- [x] Add CRS picker in `Header.tsx` + `MapCanvas2D.tsx` cursor readout: show active EPSG + Easting/Northing + WGS84 Lat/Lon + Orthometric MSL Elevation
- [x] Persist CRS in `ProjectMetadata.crs` + `PipelineResult.metadata`, reproject on CRS change
- [x] Unit test: round-trip UTM37S 21037 ↔ WGS84 EPSG:4326 verified (< 1mm geodetic precision in `tests/crs.test.ts`)
- **Status:** complete

### Phase 3: Data Management — Attribute Table, Field Calculator & Extended I/O
- [x] Extend `src/types/spatial.ts`: `AttributeField`, `SpatialFeature`, and dynamic `properties: Record<string, any>`
- [x] Rewrite `src/core/parser.ts` to retain all columns as attributes in `properties`, full GeoJSON property preservation, and KML placemark parser
- [x] Build Field Calculator (`src/core/field-calculator.ts`) — safe expression evaluator with `$x`, `$y`, `$z`, `$id`, `$code`, `$cat`, `$lat`, `$lon`, math functions, string functions, conditionals `if()`, and expression presets
- [x] Build `src/components/AttributeTable.tsx` — paginated table, search, category filter, sorting, inline cell editing, Add Field, Delete Field, Field Calculator dialog, selection sync, CSV and GeoJSON export
- [x] Wire `AttributeTable` into `App.tsx` and sync row selection with 2D map canvas highlights
- [x] Unit test: CSV attribute retention, field calculations, and GeoJSON/CSV serialization roundtrip verified in `tests/parser-calculator.test.ts`
- **Status:** complete

### Phase 4: Layer Management & Symbology System (QGIS Layer Panel Parity)
- [x] Create `src/core/symbology.ts` — single, categorized (by field), and graduated (by ranges) styling with color ramps (Viridis, Magma, Spectral, Blues, Greens, Reds, Amber)
- [x] Create `src/core/layer-store.ts` — layer configuration store with visibility, opacity (0-100%), z-index ordering, and default symbologies
- [x] Build `src/components/LayerPanel.tsx` — layer reordering (move up/down), opacity sliders, visibility toggles, categorized legend keys, and symbology styling modal
- [x] Integrate `LayerPanel` into `src/components/MapCanvas2D.tsx` with dynamic layer visibility and opacity rendering
- **Status:** complete

### Phase 5: Editing & Topology — COGO + Vertex Editing (Surveyor Automation)
- [x] Build `src/core/cogo.ts` — COGO tools: `cogoInverse`, `cogoForward` (polar radiation), `dmsToDecimal`, `intersectBearingBearing`, and `offsetLineSegment`
- [x] Build Traverse Adjustment tool (`src/core/traverse-adjust.ts`) — Bowditch (Compass Rule) adjustment for closed loops and link traverses, computing perimeter, linear misclosure, and precision ratio (1:N)
- [x] Enhance `src/core/topology.ts` — `auditTopologyDefects()` detecting duplicate vertices within snapping distance, unclosed rings, and zero-length segments, plus `repairTopology()` snapping and deduplication action
- [x] Unit test: COGO forward/inverse roundtrip, intersection, Bowditch adjustment, and topology repair verified in `tests/cogo-traverse.test.ts`
- **Status:** complete

### Phase 6: Geoprocessing Toolbox (QGIS Processing / ArcGIS Tools Parity)
- [x] Create `src/core/toolbox/registry.ts` — composable spatial tool architecture with categories: Vector Geometry, Surface & Terrain, Spatial Analysis, Cadastral & COGO, Electrification & Planning
- [x] Implement 7 core GIS algorithms: Corridor Buffer, Topographic Contour Interpolator, Delaunay TIN Constructor, MCDA Settlement Suitability, Off-Grid Techno-Economic Sizer, Cadastral Topology Auditor, Bowditch Traverse Adjustment
- [x] Build `src/components/ToolboxPanel.tsx` — searchable tool directory, parameter input forms with default values, and sub-second execution telemetry
- [x] Wire Toolbox toggle button and runner into `src/components/MapCanvas2D.tsx`
- **Status:** complete

### Phase 7: Cartography & Desktop Shell — Project File & Layout Parity
- [x] Create project file engine `src/core/project.ts` — `.metardu.json` format containing metadata, CRS, points, custom attributes, layers, symbology, off-grid parameters, and MCDA weights
- [x] Build `downloadProjectFile()` and `parseProjectFile()` with validation and schema parsing
- [x] Add "Save Project" and "Open Project" buttons in `Header.tsx` and connect handlers in `App.tsx`
- [x] Unit test: complete project snapshot and restore roundtrip verified in `tests/project.test.ts`
- **Status:** complete

### Phase 8: Generic Off-Grid Electrification Planner — Parametrized Science
- [x] Parameterize `src/core/energy-catchment.ts` with `OffGridPlannerParams`: cost/kWp solar, battery cost/kWh, daily demand/HH, grid extension threshold distance, mini-grid household threshold, peak sun hours, battery autonomy days
- [x] Implement dynamic sizing formulas for daily kWh demand, solar PV kWp, battery storage kWh, CAPEX estimate ($), and decision rules (Grid Extension vs. Mini-Grid vs. Stand-Alone SHS)
- [x] Build interactive controls in `src/components/EnergyPlanningPanel.tsx` with 6 dynamic sliders, 3 tiered presets (Basic, Standard, Productive), and live cluster recalculation
- **Status:** complete

### Phase 9: Interactive On-Canvas Vector Digitizing & Advanced Cadastral COGO
- [x] Build Command History & Undo/Redo Engine (`src/core/history.ts`) with Memento pattern (`push`, `undo`, `redo`, `canUndo`, `canRedo`)
- [x] Build Digitizing & Snapping Engine (`src/core/digitizing.ts`) with `findNearestSnapTarget` (vertex & segment edge snapping), `interpolateElevation`, `calculateCogoLeg`, `getNextPointId`
- [x] Integrate Digitizing Toolbar into `src/components/MapCanvas2D.tsx` (Navigate, Drop Beacon, COGO Traverse, Vertex Edit, Undo, Redo with `Ctrl+Z` / `Ctrl+Y`)
- [x] Add real-time snapping aperture halo ring with crosshairs and dynamic drafting rubber-band line
- [x] Add floating COGO Metes-and-Bounds traversal ribbon (Anchor selection, Bearing DMS, Distance m, Add Leg)
- [x] Unit test: History stack, point-to-segment distance, snapping, and COGO radiation verified in `tests/digitizing-cogo.test.ts`
- **Status:** complete

### Phase 10: Visual Print Layout Composer (QGIS Print Layout Parity)
- [x] Build Print Layout Engine (`src/core/layout-engine.ts`) supporting ISO A4, A3, A1 sheets in Landscape & Portrait with standard engineering scales (1:250 to 1:10,000)
- [x] Generate publication-quality vector SVG with neatline borders, coordinate graticules (+), boundary callouts, index contours, buffers, beacons, dynamic scalebar, compass north arrow, surveyor title block, and beacon coordinate schedule
- [x] Build `src/components/PrintLayoutComposer.tsx` with interactive canvas preview, sheet format switcher, auto-fit scale, element toggles, title block editor, 300 DPI PNG exporter, and Print-to-PDF stylesheet
- [x] Wire `"layout"` tab into `Header.tsx` and `App.tsx`
- **Status:** complete

### Phase 11: Real Multi-Source Satellite & Remote Sensing Tile Streamer
- [x] Build Slippy Map Tile Engine (`src/core/tile-engine.ts`) with EPSG to WGS84 to Web Mercator tile index converters (`lonLatToTileXY`, `tileXYToLonLatBounds`, `calculateTileZoom`)
- [x] Register 4 tile providers: ESRI World Imagery (Satellite), OpenStreetMap, NASA GIBS Night-Time Lights (VIIRS Black Marble), and CartoDB Dark Matter
- [x] Build in-memory Tile Cache (`TileManager`) with asynchronous image loading and LRU cache eviction
- [x] Integrate tile blitter into `MapCanvas2D.tsx` render loop with sub-pixel alignment under vector layers
- [x] Unit test: Tile coordinate math, bounding boxes, and zoom calculations verified in `tests/tile-math.test.ts`
- **Status:** complete

### Phase 12: Advanced Spatial Analysis & Geoprocessing Extensions
- [x] Implement core spatial algorithms in `src/core/spatial-analysis.ts`: Shoelace area, Jordan ray-casting point-in-polygon, Andrew's Monotone Chain Convex Hull, Spatial Join (Point-in-Polygon Aggregation), Thiessen / Voronoi Polygons (half-plane clipping), and Equal-Area Cadastral Subdivision
- [x] Register 4 new enterprise tools in `src/core/toolbox/registry.ts`: Thiessen (Voronoi) Polygons, Spatial Join (Point-in-Polygon), Convex Hull Generator, Cadastral Equal-Area Subdivision (totaling 11 geoprocessing algorithms)
- [x] Unit test: Convex hull, spatial join aggregation, Voronoi cells, and equal-area subdivision verified in `tests/geoprocessing-advanced.test.ts`
- **Status:** complete

---

## Verification & Test Results
All 7 test suites passing with 100% success rate:
1. `tests/crs.test.ts`: Geodetic datum transforms & geoid reduction (< 1mm precision)
2. `tests/parser-calculator.test.ts`: Attribute retention, Field Calculator expressions, GeoJSON/CSV roundtrip
3. `tests/cogo-traverse.test.ts`: COGO forward/inverse, ray intersections, Bowditch adjustment, topology repair
4. `tests/project.test.ts`: `.metardu.json` project persistence and complete state restoration
5. `tests/digitizing-cogo.test.ts`: Undo/redo history, snapping detection, COGO radiation
6. `tests/tile-math.test.ts`: Web Mercator tile conversion, bounding boxes, dynamic zoom
7. `tests/geoprocessing-advanced.test.ts`: Shoelace area, Convex hull, Spatial join, Voronoi partitions, Equal-area subdivision
8. Production Build: `tsc && vite build` succeeds with 0 errors in under 8 seconds.
