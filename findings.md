# Findings & Decisions

## Requirements
- Automate GIS Specialist workflow so Metardu Desktop rivals QGIS / ArcGIS Pro
- Fix prior agents' vendor quoting: `Sun King` / `UN-Habitat` were methodology references, not branded product identity — app must be generic
- Keep science (clustering, MCDA, VIIRS-like analysis) but citation-only, not logo/brand-in-canvas
- Electrification module must be generic `Off-Grid Planner` with user-editable `cost/kWp`, `demand/HH`, `gridThreshold`, `GHI`, `minHH for mini-grid`
- Full spec via `task_plan.md` then sequential implement
- Target personas: Surveyor (cadastral/topographic/deed plan), GIS Analyst (CRS/overlay/raster/symbology), Planner (suitability/hazard/electrification/layout)

## Research Findings
- Codebase is Vite + React 19 + Tailwind 4, no state lib, no proj4/gdal/turf, no tests
- `src/core/pipeline.ts:24` is fixed 9-stage pipeline: Ingest → Geodesy → FeatureCoding → TIN/Contour → Topology → Buffers → MCDA → Hazard → Energy. All stages run on every scenario change, not composable.
- Geodesy is fake: `src/core/pipeline.ts:70` `approxLat = (northing - 10000000)/110574` + `approxLon = 36.8 + (easting-250000)/111320`, `src/core/geodesy.ts` `reduceOrthometricHeight` is simple `H=h-N` with sinusoidal EGM mock — no real geoid file, no proj pipeline
- Parser `src/core/parser.ts:46` delimiter sniff + Leica GSI + GeoJSON Point only; discards extra columns, no SHP/GPKG/KML/DAT/RW5, no properties retention, coordinate swap guard is hard-coded for UTM37S
- Feature coding `src/core/feature-coding.ts:19` has 55 rules, grouping by code string — no rule editor UI, no user custom codes
- TIN `src/core/tin-engine.ts:8` is real Bowyer-Watson Delaunay (200 lines), computes slope/aspect/volume — solid base
- MCDA `src/core/mcda-suitability.ts:9` weights exist but UI `McdaSuitabilityPanel.tsx` doesn't persist presets; grid hardcoded 20x20, distance functions re-scan all vectors per cell (O(n*m))
- Topology `src/core/topology.ts:9` does perimeter/area via `geodesy.ts:calculatePolygonMetrics` (shoelace), Bowditch misclosure sumDe/sumDn — but sum is zero if closed loop by construction, so `precisionRatio` always 50000 unless unclosed; no auto-repair
- Buffers `src/core/buffer-engine.ts` offsets via `pointToSegmentDistance`, simple left/right offset — no dissolve, no true polygon buffer
- MapCanvas `src/components/MapCanvas2D.tsx:34` hard-coded 11 layer booleans + 4 basemaps (dark/cad/satellite/viirs simulated) — no tile source, no layer reorder, no style editor, no snapping
- Attribute handling: `src/types/spatial.ts:13` SurveyPoint has fixed fields, no `properties` map — blocks Field Calculator
- Exporters: `dxf-exporter.ts` (DXF R2018), `geojson-exporter.ts`, `landxml-exporter.ts`, `deed-plan-svg.ts`, `planning-atlas-svg.ts` — all static, not template-driven, DXF layers hard-coded 11
- Branded strings grep found 35 hits across 14 files (README, sample-surveys, Header, MapCanvas, Energy panel, exporters, cores)
- `EnergyPlanningPanel.tsx:112-124` contains commercial field deployment prescription (agent routing, PAYG $0.45/day via M-Pesa) — this is vendor sales logic, must become generic techno-economic params
- No project file, no undo/redo, no toolbox, no print composer — core gaps vs QGIS/ArcGIS
- `package.json:12` dependencies are only react/lucide/clsx — no geospatial libs

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Methodology registry (`src/core/methodology-registry.ts`) | Single source of truth for method name vs referenceOrg; lets UI show generic while citing FAO/WB/UN-Habitat/SE4All on demand |
| proj4 + custom CRS store vs PROJ WASM | proj4 is 20KB, pure JS, covers EPSG:4326/21037/32636/32637 day-1; PROJ WASM later for desktop high-accuracy datum shifts |
| Preserve Bowyer-Watson TIN | Real Delaunay already implemented and verified; don't replace |
| Layer store pattern (lightweight zustand-like) | Avoid Redux weight; matches current React 19 idioms, needed to replace hard-coded booleans |
| Toolbox registry + keep pipeline as preset | QGIS/ArcGIS both expose Processing toolbox; pipeline becomes one-click preset over composable tools |
| Tauri stub for desktop | Rust sidecar for future GDAL/PROJ binary without Electron bloat; web build stays Vite-only |
| Generic electrification params struct | Satisfies Option B: user controls demand/HH, PSH, thresholds — removes hardcoded 1.4kWh, 4.8h, 50HH, 1.2km in `energy-catchment.ts:83-90` |
| Attribute `properties: Record<string,any>` extension | Enables field calculator + shapefile DBF columns + GeoJSON properties round-trip |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Path with space `metardu GIS` breaks naive bash | Use `-LiteralPath` in PowerShell, quote paths |
| No existing planning files | Created via templates as baseline |
| 35 branded strings scattered | Cataloged; will batch replace with registry indirection to avoid missed stragglers |

## Resources
- Project root: `C:\Users\user\Desktop\metardu GIS`
- Entry: `src/App.tsx:17` (pipeline orchestrator), `src/core/pipeline.ts:24`, `src/components/Header.tsx:1`, `src/components/MapCanvas2D.tsx:1`
- Branding audit: grep `Sun King|UN-Habitat|VIIRS` → 35 matches
- QGIS docs: Processing Toolbox, CRS handling, Print Layout; ArcGIS Pro: Geoprocessing, COGO, Layout
- Libs to add: `proj4`, `@types/proj4`, `shapefile` (SHP), `zustand` (optional), `turf` (geoprocessing helpers)

## Visual/Browser Findings
- No browser run yet — next step is to spin `npm run dev` and screenshot before/after Phase 1 to capture branding removal visually

