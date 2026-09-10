/**
 * OSINT Sources — pull open ground context (OpenStreetMap via Overpass)
 * around the working extent and ingest it as coded survey vertices, with
 * the fetch recorded into the provenance registry (service, endpoint,
 * license, timestamp, feature count).
 *
 * Doctrine: OSINT is indicative context, never survey-grade evidence.
 * The panel states that on the record — in the UI, in the import notes,
 * and in every provenance graph the session produces.
 */

import React, { useMemo, useState } from "react";
import { Satellite, Search, Download, AlertTriangle, RefreshCw, Trash2, Check, MapPin, Landmark, LocateFixed, Layers } from "lucide-react";
import { SurveyPoint } from "../types/spatial";
import {
  OVERPASS_PRESETS,
  OVERPASS_PRESET_ORDER,
  OverpassPreset,
  OverpassBbox,
  expandBboxRadius,
  validateBbox,
  bboxSizeKm,
  describeQueryScope,
  fetchOverpassFeatures,
  OverpassFetchResult,
  featuresToSurveyPoints,
  OSM_SERVICE,
  OSM_LICENSE,
  OSM_ATTRIBUTION,
} from "../core/osint/overpass";
import {
  searchPlaces,
  validateGeocodeQuery,
  describeGeocodeResult,
  GeocodeResult,
  NOMINATIM_SERVICE,
  NOMINATIM_LICENSE,
  NOMINATIM_ATTRIBUTION,
} from "../core/osint/geocode";
import {
  fetchBoundaryContext,
  GBFetchResult,
  GB_SERVICE,
  GB_ATTRIBUTION,
  ADM_LEVELS,
  AdmLevel,
} from "../core/osint/boundaries";
import { recordExternalSource, clearExternalSources } from "../core/osint/registry";
import {
  S2_YEARS,
  S2Year,
  S2_SERVICE_PREFIX,
  S2_LICENSE,
  S2_ATTRIBUTION,
  S2_DISCLOSURE,
  s2EndpointPrefix,
  runChangeDetection,
  ChangeRunResult,
  changeCellsToCsv,
  changeCellsToGeoJson,
} from "../core/osint/sentinel2";

interface OsintPanelProps {
  /** Document extent in WGS84 lon/lat (computed by App from the working CRS). */
  wgs84Bbox: OverpassBbox | null;
  onImportPoints: (points: SurveyPoint[], layerName: string, notes: string[]) => void;
  /** Recenter the 2D canvas on a WGS84 point (place search). */
  onLocate?: (lon: number, lat: number, label: string) => void;
}

const RADIUS_OPTIONS = [1, 2, 5, 10, 25];
const DEFAULT_PRESETS: OverpassPreset[] = ["buildings", "roads", "water"];
const FETCH_LIMIT = 20000;

/** Trigger a client-side file download (blob -> object URL -> click). */
function downloadFile(name: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Per-preset feature counts using the same tag priority as the mapper. */
function countByPreset(result: OverpassFetchResult): Record<OverpassPreset, number> {
  const counts: Record<OverpassPreset, number> = {
    buildings: 0,
    roads: 0,
    water: 0,
    landuse: 0,
    places: 0,
  };
  for (const f of result.parse.features) {
    const t = f.tags;
    if (t.place) counts.places++;
    else if (t.building) counts.buildings++;
    else if (t.highway) counts.roads++;
    else if (t.waterway || t.natural === "water" || t.natural === "wetland") counts.water++;
    else if (t.landuse) counts.landuse++;
  }
  return counts;
}

export const OsintPanel: React.FC<OsintPanelProps> = ({ wgs84Bbox, onImportPoints, onLocate }) => {
  const [radiusKm, setRadiusKm] = useState(5);
  const [selected, setSelected] = useState<Set<OverpassPreset>>(new Set(DEFAULT_PRESETS));
  const [fetching, setFetching] = useState(false);
  const [result, setResult] = useState<OverpassFetchResult | null>(null);
  const [imported, setImported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryBbox = useMemo(
    () => (wgs84Bbox ? expandBboxRadius(wgs84Bbox, radiusKm) : null),
    [wgs84Bbox, radiusKm],
  );
  const bboxError = queryBbox ? validateBbox(queryBbox) : null;
  const size = queryBbox ? bboxSizeKm(queryBbox) : null;
  const presetsSelected = [...selected].filter(
    (p) => OVERPASS_PRESET_ORDER.includes(p),
  ) as OverpassPreset[];

  const togglePreset = (id: OverpassPreset) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runFetch = async () => {
    if (!queryBbox || presetsSelected.length === 0) return;
    setFetching(true);
    setError(null);
    setResult(null);
    setImported(false);
    try {
      const r = await fetchOverpassFeatures({
        bbox: queryBbox,
        presets: presetsSelected,
        limit: FETCH_LIMIT,
      });
      setResult(r);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFetching(false);
    }
  };

  const runImport = () => {
    if (!result) return;
    const notes: string[] = [
      `Source: ${OSM_SERVICE} — ${result.endpoint}`,
      `License: ${OSM_LICENSE} (${OSM_ATTRIBUTION})`,
      `Scope: ${describeQueryScope(queryBbox!, presetsSelected)}`,
      `Fetched: ${result.fetchedAt}`,
      "OSM is indicative context — NOT survey-grade. Do not use for statutory boundary determination.",
    ];
    if (result.parse.assembledRelations > 0)
      notes.push(
        `${result.parse.assembledRelations} multipolygon relation${
          result.parse.assembledRelations === 1 ? "" : "s"
        } assembled into rings${
          result.parse.orphanInners > 0
            ? `; ${result.parse.orphanInners} orphan inner ring(s) excluded`
            : ""
        }`,
      );
    if (result.parse.skippedRelations > 0)
      notes.push(
        `${result.parse.skippedRelations} relation${
          result.parse.skippedRelations === 1 ? "" : "s"
        } skipped — non-multipolygon or incomplete members (no partial geometry invented)`,
      );
    if (result.parse.unresolvedWays > 0)
      notes.push(`${result.parse.unresolvedWays} ways had no resolvable geometry and were skipped`);

    const pts = featuresToSurveyPoints(result.parse.features, "OSM");
    if (pts.length === 0) {
      setError("The fetch returned no mappable geometry inside the selected presets.");
      return;
    }

    // Chain of custody — recorded before the import so every provenance
    // graph built afterwards carries the source.
    recordExternalSource({
      service: OSM_SERVICE,
      endpoint: result.endpoint,
      license: OSM_LICENSE,
      attribution: OSM_ATTRIBUTION,
      fetchedAt: result.fetchedAt,
      featureCount: result.parse.features.length,
      note: describeQueryScope(queryBbox!, presetsSelected),
    });

    onImportPoints(pts, "OSM ground context", notes);
    setImported(true);
  };

  const presetCounts = result ? countByPreset(result) : null;
  const canFetch = !!queryBbox && !bboxError && presetsSelected.length > 0 && !fetching;

  /* ---------------- Locate (Nominatim place search) ---------------- */
  const [locQuery, setLocQuery] = useState("");
  const [locSearching, setLocSearching] = useState(false);
  const [locResults, setLocResults] = useState<GeocodeResult[] | null>(null);
  const [locError, setLocError] = useState<string | null>(null);

  const runLocate = async () => {
    const qErr = validateGeocodeQuery(locQuery);
    if (qErr) {
      setLocError(qErr);
      return;
    }
    setLocSearching(true);
    setLocError(null);
    try {
      const r = await searchPlaces(locQuery, { limit: 5 });
      setLocResults(r.results);
      // Chain of custody — the search itself is a consulted source.
      recordExternalSource({
        service: NOMINATIM_SERVICE,
        endpoint: r.endpoint,
        license: NOMINATIM_LICENSE,
        attribution: NOMINATIM_ATTRIBUTION,
        fetchedAt: r.fetchedAt,
        featureCount: r.results.length,
        note: `Place search "${locQuery.trim()}"`,
      });
    } catch (e) {
      setLocError((e as Error).message);
      setLocResults(null);
    } finally {
      setLocSearching(false);
    }
  };

  /* ---------------- Jurisdictional context (geoBoundaries) ---------------- */
  const [iso, setIso] = useState("KEN");
  const [adm, setAdm] = useState<AdmLevel>("ADM1");
  const [gbFetching, setGbFetching] = useState(false);
  const [gbResult, setGbResult] = useState<GBFetchResult | null>(null);
  const [gbImported, setGbImported] = useState(false);
  const [gbError, setGbError] = useState<string | null>(null);

  const runBoundaryFetch = async () => {
    setGbFetching(true);
    setGbError(null);
    setGbResult(null);
    setGbImported(false);
    try {
      // Clip to the document scope when the document has an extent.
      const r = await fetchBoundaryContext(iso.trim(), adm, wgs84Bbox);
      setGbResult(r);
    } catch (e) {
      setGbError((e as Error).message);
    } finally {
      setGbFetching(false);
    }
  };

  const runBoundaryImport = () => {
    if (!gbResult || gbResult.points.length === 0) return;
    const notes: string[] = [
      `Source: ${GB_SERVICE} — ${gbResult.endpoint}`,
      `Geometry: ${gbResult.geometryUrl}`,
      `License: ${gbResult.metadata.license} (${GB_ATTRIBUTION}) — boundary year ${gbResult.metadata.year}`,
      `Scope: ${gbResult.metadata.iso} ${gbResult.metadata.adm}, ${gbResult.unitNames.length} units, ${gbResult.points.length} vertices kept` +
        (wgs84Bbox ? `, clipped to the document scope (${gbResult.clippedVertices} dropped)` : " (unclipped)"),
    ];
    if (gbResult.truncated) {
      notes.push(`Vertex cap reached — geometry truncated at ${gbResult.points.length} vertices`);
    }
    notes.push(
      "Open boundary context is indicative — NOT survey-grade. Statutory boundary determination requires licensed cadastral products.",
    );
    recordExternalSource({
      service: GB_SERVICE,
      endpoint: gbResult.endpoint,
      license: gbResult.metadata.license,
      attribution: GB_ATTRIBUTION,
      fetchedAt: gbResult.fetchedAt,
      featureCount: gbResult.points.length,
      note:
        `${gbResult.metadata.iso} ${gbResult.metadata.adm} (${gbResult.metadata.year}) — ${gbResult.unitNames.length} units` +
        (wgs84Bbox ? `, clipped to scope (${gbResult.clippedVertices} dropped)` : ""),
    });
    onImportPoints(gbResult.points, `${gbResult.metadata.iso} ${gbResult.metadata.adm} boundaries`, notes);
    setGbImported(true);
  };

  /* ---------------- Sentinel-2 epoch change detection ---------------- */
  const [s2YearA, setS2YearA] = useState<S2Year>(2018);
  const [s2YearB, setS2YearB] = useState<S2Year>(2024);
  const [s2Threshold, setS2Threshold] = useState(30);
  const [s2FlagRatio, setS2FlagRatio] = useState(0.15);
  const [s2Running, setS2Running] = useState(false);
  const [s2Progress, setS2Progress] = useState<{ done: number; total: number } | null>(null);
  const [s2Result, setS2Result] = useState<ChangeRunResult | null>(null);
  const [s2Error, setS2Error] = useState<string | null>(null);

  const runS2 = async () => {
    if (!queryBbox || s2YearA === s2YearB) return;
    setS2Running(true);
    setS2Error(null);
    setS2Result(null);
    try {
      const r = await runChangeDetection({
        bbox: queryBbox,
        yearA: s2YearA,
        yearB: s2YearB,
        threshold: s2Threshold,
        flagRatio: s2FlagRatio,
        onProgress: (done, total) => setS2Progress({ done, total }),
      });
      setS2Result(r);
      // Chain of custody — one record per epoch layer consulted.
      const fetchedAt = new Date().toISOString();
      const size = bboxSizeKm(queryBbox);
      for (const year of [r.yearA, r.yearB]) {
        recordExternalSource({
          service: `${S2_SERVICE_PREFIX} ${year} (EOX)`,
          endpoint: s2EndpointPrefix(year),
          license: S2_LICENSE,
          attribution: S2_ATTRIBUTION,
          fetchedAt,
          featureCount: r.tilePairs,
          note:
            `Epoch change screen ${r.yearA} vs ${r.yearB} — bbox [${queryBbox.latMin.toFixed(4)}, ${queryBbox.lonMin.toFixed(4)}, ${queryBbox.latMax.toFixed(4)}, ${queryBbox.lonMax.toFixed(4)}] ≈ ${size.widthKm.toFixed(1)} × ${size.heightKm.toFixed(1)} km; ` +
            `${r.tilePairs} tile pairs at z${r.zoom} (${r.failedTiles} failed), ${r.summary.flaggedCells} flagged cells`,
        });
      }
    } catch (e) {
      setS2Error((e as Error).message);
    } finally {
      setS2Running(false);
      setS2Progress(null);
    }
  };

  const downloadS2Csv = () => {
    if (!s2Result) return;
    const flagged = s2Result.cells.filter((c) => c.flagged);
    downloadFile(
      `s2-change-${s2Result.yearA}-${s2Result.yearB}-flagged.csv`,
      changeCellsToCsv(flagged),
      "text/csv",
    );
  };

  const downloadS2GeoJson = () => {
    if (!s2Result) return;
    const gj = changeCellsToGeoJson(s2Result.cells, s2Result.summary, s2Result.yearA, s2Result.yearB);
    downloadFile(
      `s2-change-${s2Result.yearA}-${s2Result.yearB}-grid.geojson`,
      JSON.stringify(gj, null, 2),
      "application/geo+json",
    );
  };

  return (
    <div className="h-full flex bg-app">
      <div className="flex-1 flex flex-col items-center justify-start p-6 overflow-auto">
        <div className="w-full max-w-[560px]">
          {/* Header */}
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-[3px] border border-line-strong bg-sunken flex items-center justify-center">
              <Satellite className="w-4.5 h-4.5 text-ink-2" />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold text-ink leading-tight">OSINT Sources</h1>
              <p className="text-[11.5px] text-ink-3">
                Ground context, jurisdictional frames, epoch change screens
              </p>
            </div>
            <div className="flex-1" />
            <span
              className={`text-[10.5px] px-2 py-0.5 rounded-full border tnum ${
                fetching
                  ? "border-accent/50 text-accent"
                  : result
                    ? "border-accent/50 text-accent"
                    : "border-line-strong text-ink-3"
              }`}
            >
              {fetching ? "FETCHING" : result ? "PREVIEW" : "IDLE"}
            </span>
          </div>

          {/* Scope */}
          <div className="mt-4 bg-panel border border-line-strong rounded-[4px]">
            <div className="px-4 py-3 border-b border-line">
              <span className="ui-label">Query scope</span>
              {wgs84Bbox ? (
                <div className="mt-1.5 space-y-1">
                  <p className="text-[11.5px] text-ink-2 tnum">
                    Document extent (WGS84): [{wgs84Bbox.latMin.toFixed(4)}, {wgs84Bbox.lonMin.toFixed(4)}] — [
                    {wgs84Bbox.latMax.toFixed(4)}, {wgs84Bbox.lonMax.toFixed(4)}]
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-[11.5px] text-ink-3">Padding radius</span>
                    <select
                      className="ui-select text-[11.5px] w-[110px]"
                      value={radiusKm}
                      onChange={(e) => {
                        setRadiusKm(Number(e.target.value));
                        setResult(null);
                        setImported(false);
                      }}
                    >
                      {RADIUS_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {r} km
                        </option>
                      ))}
                    </select>
                    {size && (
                      <span className="text-[11px] text-ink-3 tnum">
                        ≈ {size.widthKm.toFixed(1)} × {size.heightKm.toFixed(1)} km query area
                      </span>
                    )}
                  </div>
                  {bboxError && (
                    <p className="text-[11px] text-risk-high flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {bboxError}
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-1.5 text-[11.5px] text-ink-3">
                  Open or import a survey first — the query scope follows the
                  document extent, reprojected to WGS84.
                </p>
              )}
            </div>

            {/* Presets */}
            <div className="px-4 py-3 border-b border-line">
              <span className="ui-label">Feature presets</span>
              <div className="mt-2 space-y-1.5">
                {OVERPASS_PRESET_ORDER.map((id) => {
                  const p = OVERPASS_PRESETS[id];
                  const on = selected.has(id);
                  return (
                    <label
                      key={id}
                      className="flex items-start gap-2.5 cursor-pointer group"
                      title={p.description}
                    >
                      <span
                        className={`mt-0.5 w-3.5 h-3.5 rounded-[2px] border flex items-center justify-center shrink-0 ${
                          on ? "bg-accent border-accent" : "border-line-strong group-hover:border-ink-3"
                        }`}
                      >
                        {on && <Check className="w-2.5 h-2.5 text-app" strokeWidth={3} />}
                      </span>
                      <input
                        type="checkbox"
                        className="hidden"
                        checked={on}
                        onChange={() => {
                          togglePreset(id);
                          setResult(null);
                          setImported(false);
                        }}
                      />
                      <span>
                        <span className="text-[12px] text-ink">{p.label}</span>
                        <span className="text-[11px] text-ink-3 block">{p.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Fetch action */}
            <div className="px-4 py-3 flex items-center gap-2">
              <button
                onClick={runFetch}
                disabled={!canFetch}
                className="ui-btn-accent text-[12px]"
                title={
                  presetsSelected.length === 0
                    ? "Select at least one preset"
                    : "Query the Overpass API around the document extent"
                }
              >
                {fetching ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Search className="w-3.5 h-3.5" />
                )}
                <span>{fetching ? "Querying…" : "Fetch context"}</span>
              </button>
              <span className="text-[10.5px] text-ink-3">
                Overpass API · POST · 30 s timeout · mirror failover
              </span>
            </div>

            {error && (
              <div className="px-4 py-2.5 border-t border-line bg-risk-high/5 flex gap-2">
                <AlertTriangle className="w-4 h-4 text-risk-high shrink-0 mt-0.5" />
                <p className="text-[11.5px] text-ink-2 leading-relaxed break-words">{error}</p>
              </div>
            )}

            {/* Results preview */}
            {result && (
              <div className="px-4 py-3 border-t border-line">
                <div className="flex items-center gap-2">
                  <span className="ui-label">Fetch result</span>
                  <div className="flex-1" />
                  <span className="text-[10.5px] text-ink-3 tnum break-all text-right">
                    {result.endpoint.replace("https://", "")}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {OVERPASS_PRESET_ORDER.map((id) => (
                    <div
                      key={id}
                      className="flex items-center justify-between bg-sunken border border-line rounded-[3px] px-2 py-1"
                    >
                      <span className="text-[11px] text-ink-2 truncate">{OVERPASS_PRESETS[id].label}</span>
                      <span className="text-[11px] tnum text-ink ml-2">{presetCounts![id]}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-ink-3 tnum">
                  {result.parse.features.length.toLocaleString("en-US")} features ·{" "}
                  {result.parse.assembledRelations} relation
                  {result.parse.assembledRelations === 1 ? "" : "s"} assembled ·{" "}
                  {result.parse.skippedRelations} skipped · {result.parse.unresolvedWays} unresolved
                </p>
                <button
                  onClick={runImport}
                  disabled={imported || fetching}
                  className="ui-btn-accent text-[12px] mt-2.5"
                  title="Ingest as coded survey vertices and record provenance"
                >
                  {imported ? <Check className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                  <span>{imported ? "Imported" : "Import into document"}</span>
                </button>
              </div>
            )}
          </div>

          {/* Locate — Nominatim */}
          <div className="mt-3 bg-panel border border-line-strong rounded-[4px]">
            <div className="px-4 py-3 border-b border-line">
              <div className="flex items-center gap-2">
                <LocateFixed className="w-4 h-4 text-ink-3" />
                <span className="ui-label">Locate a place</span>
                <div className="flex-1" />
                <span className="text-[10.5px] text-ink-3">Nominatim · ODbL</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  className="ui-input text-[12px] flex-1"
                  placeholder="e.g. Westlands, Nairobi"
                  value={locQuery}
                  onChange={(e) => setLocQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") runLocate();
                  }}
                />
                <button
                  onClick={runLocate}
                  disabled={locSearching}
                  className="ui-btn text-[12px]"
                  title="Search OpenStreetMap places (max 1 request/second)"
                >
                  {locSearching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                </button>
              </div>
              {locError && (
                <p className="mt-2 text-[11px] text-risk-high flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {locError}
                </p>
              )}
            </div>
            {locResults && (
              <div className="px-4 py-2">
                {locResults.length === 0 && (
                  <p className="text-[11.5px] text-ink-3 py-1">No matching places found.</p>
                )}
                {locResults.map((r) => (
                  <div
                    key={`${r.osmType}-${r.osmId}-${r.placeId}`}
                    className="flex items-center gap-2 py-1.5 border-b border-line last:border-b-0"
                  >
                    <MapPin className="w-3.5 h-3.5 text-ink-3 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11.5px] text-ink truncate">{r.label}</p>
                      <p className="text-[10.5px] text-ink-3 tnum">{describeGeocodeResult(r)}</p>
                    </div>
                    <button
                      className="ui-btn text-[11px]"
                      title="Recenter the 2D canvas on this place"
                      onClick={() => onLocate?.(r.lon, r.lat, r.label)}
                    >
                      <LocateFixed className="w-3 h-3" />
                      <span>Locate</span>
                    </button>
                  </div>
                ))}
                <p className="text-[10px] text-ink-3 mt-1">
                  Each search is recorded in the provenance registry; rate limited to 1 request/second.
                </p>
              </div>
            )}
          </div>

          {/* Jurisdictional context — geoBoundaries */}
          <div className="mt-3 bg-panel border border-line-strong rounded-[4px]">
            <div className="px-4 py-3 border-b border-line">
              <div className="flex items-center gap-2">
                <Landmark className="w-4 h-4 text-ink-3" />
                <span className="ui-label">Jurisdictional context</span>
                <div className="flex-1" />
                <span className="text-[10.5px] text-ink-3">geoBoundaries gbOpen</span>
              </div>
              <p className="mt-1 text-[11px] text-ink-3 leading-relaxed">
                Administrative boundary geometry around the document scope,
                clipped to the query extent when a document is open.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <input
                  className="ui-input text-[12px] w-[90px]"
                  placeholder="ISO3"
                  value={iso}
                  onChange={(e) => {
                    setIso(e.target.value.toUpperCase());
                    setGbResult(null);
                    setGbImported(false);
                  }}
                  maxLength={3}
                  title="ISO 3166-1 alpha-3 country code, e.g. KEN, TZA, UGA"
                />
                <select
                  className="ui-select text-[12px] w-[110px]"
                  value={adm}
                  onChange={(e) => {
                    setAdm(e.target.value as AdmLevel);
                    setGbResult(null);
                    setGbImported(false);
                  }}
                >
                  {ADM_LEVELS.map((a) => (
                    <option key={a} value={a}>
                      {a === "ADM0" ? "ADM0 — country" : a === "ADM1" ? "ADM1 — province" : "ADM2 — district"}
                    </option>
                  ))}
                </select>
                <button
                  onClick={runBoundaryFetch}
                  disabled={gbFetching || iso.trim().length !== 3}
                  className="ui-btn text-[12px]"
                  title="Fetch simplified boundary geometry clipped to the document scope"
                >
                  {gbFetching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  <span>{gbFetching ? "Fetching…" : "Fetch"}</span>
                </button>
              </div>
              {gbError && (
                <p className="mt-2 text-[11px] text-risk-high flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {gbError}
                </p>
              )}
            </div>
            {gbResult && (
              <div className="px-4 py-3 border-t border-line">
                <div className="flex items-center gap-2">
                  <span className="ui-label">Fetch result</span>
                  <div className="flex-1" />
                  <span className="text-[10.5px] text-ink-3 tnum">
                    {gbResult.metadata.iso} {gbResult.metadata.adm} · {gbResult.metadata.year}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  <div className="bg-sunken border border-line rounded-[3px] px-2 py-1">
                    <p className="text-[9.5px] uppercase tracking-wide text-ink-3">Units</p>
                    <p className="text-[12px] tnum text-ink">{gbResult.unitNames.length}</p>
                  </div>
                  <div className="bg-sunken border border-line rounded-[3px] px-2 py-1">
                    <p className="text-[9.5px] uppercase tracking-wide text-ink-3">Vertices kept</p>
                    <p className="text-[12px] tnum text-ink">{gbResult.points.length.toLocaleString("en-US")}</p>
                  </div>
                  <div className="bg-sunken border border-line rounded-[3px] px-2 py-1">
                    <p className="text-[9.5px] uppercase tracking-wide text-ink-3">Clipped</p>
                    <p className="text-[12px] tnum text-ink">{gbResult.clippedVertices.toLocaleString("en-US")}</p>
                  </div>
                  <div className="bg-sunken border border-line rounded-[3px] px-2 py-1">
                    <p className="text-[9.5px] uppercase tracking-wide text-ink-3">License</p>
                    <p className="text-[11px] text-ink truncate" title={gbResult.metadata.license}>
                      {gbResult.metadata.license}
                    </p>
                  </div>
                </div>
                {gbResult.truncated && (
                  <p className="mt-1.5 text-[11px] text-risk-high">Vertex cap reached — geometry was truncated.</p>
                )}
                {gbResult.points.length === 0 && (
                  <p className="mt-1.5 text-[11px] text-ink-2">
                    No {gbResult.metadata.adm} units intersect the document scope — widen the scope or pick a higher
                    admin level.
                  </p>
                )}
                <button
                  onClick={runBoundaryImport}
                  disabled={gbImported || gbFetching || gbResult.points.length === 0}
                  className="ui-btn-accent text-[12px] mt-2.5"
                  title="Ingest as coded boundary vertices and record provenance"
                >
                  {gbImported ? <Check className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                  <span>{gbImported ? "Imported" : "Import into document"}</span>
                </button>
              </div>
            )}
          </div>

          {/* Sentinel-2 epoch change detection — EOX s2cloudless */}
          <div className="mt-3 bg-panel border border-line-strong rounded-[4px]">
            <div className="px-4 py-3 border-b border-line">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-ink-3" />
                <span className="ui-label">Change detection (Sentinel-2)</span>
                <div className="flex-1" />
                <span className="text-[10.5px] text-ink-3">EOX s2cloudless · CC-BY-NC-SA</span>
              </div>
              <p className="mt-1 text-[11px] text-ink-3 leading-relaxed">
                Pixel-diff two annual cloudless mosaics over the query scope.
                Flagged cells are screening evidence — verify each against the
                imagery pair before acting on it.
              </p>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <select
                  className="ui-select text-[12px] w-[104px]"
                  value={s2YearA}
                  onChange={(e) => setS2YearA(Number(e.target.value) as S2Year)}
                  title="Before epoch"
                >
                  {S2_YEARS.map((y) => (
                    <option key={y} value={y}>
                      {y} (before)
                    </option>
                  ))}
                </select>
                <select
                  className="ui-select text-[12px] w-[104px]"
                  value={s2YearB}
                  onChange={(e) => setS2YearB(Number(e.target.value) as S2Year)}
                  title="After epoch"
                >
                  {S2_YEARS.map((y) => (
                    <option key={y} value={y}>
                      {y} (after)
                    </option>
                  ))}
                </select>
                <select
                  className="ui-select text-[12px] w-[150px]"
                  value={s2Threshold}
                  onChange={(e) => setS2Threshold(Number(e.target.value))}
                  title="Luma difference (0-255) that counts as a changed pixel"
                >
                  <option value={20}>Δ20 — sensitive</option>
                  <option value={30}>Δ30 — balanced</option>
                  <option value={45}>Δ45 — conservative</option>
                </select>
                <select
                  className="ui-select text-[12px] w-[128px]"
                  value={s2FlagRatio}
                  onChange={(e) => setS2FlagRatio(Number(e.target.value))}
                  title="Share of a cell's pixels that must change for the cell to flag"
                >
                  <option value={0.1}>10% cell</option>
                  <option value={0.15}>15% cell</option>
                  <option value={0.25}>25% cell</option>
                </select>
                <button
                  onClick={runS2}
                  disabled={!queryBbox || s2Running || s2YearA === s2YearB || !!bboxError}
                  className="ui-btn text-[12px]"
                  title={
                    s2YearA === s2YearB
                      ? "Pick two different epochs"
                      : "Fetch both epochs and diff the tile pairs"
                  }
                >
                  {s2Running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  <span>
                    {s2Running
                      ? s2Progress
                        ? `Diffing ${s2Progress.done}/${s2Progress.total}…`
                        : "Diffing…"
                      : "Run change screen"}
                  </span>
                </button>
              </div>
              {s2Error && (
                <p className="mt-2 text-[11px] text-risk-high flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span className="break-words">{s2Error}</span>
                </p>
              )}
            </div>

            {s2Result && (
              <div className="px-4 py-3 border-t border-line">
                <div className="flex items-center gap-2">
                  <span className="ui-label">Screen result</span>
                  <div className="flex-1" />
                  <span className="text-[10.5px] text-ink-3 tnum">
                    {s2Result.yearA} → {s2Result.yearB} · z{s2Result.zoom}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  <div className="bg-sunken border border-line rounded-[3px] px-2 py-1">
                    <p className="text-[9.5px] uppercase tracking-wide text-ink-3">Flagged cells</p>
                    <p className="text-[12px] tnum text-ink">
                      {s2Result.summary.flaggedCells.toLocaleString("en-US")}
                      <span className="text-ink-3 text-[10.5px]">
                        {" "}
                        ({s2Result.summary.flaggedPct.toFixed(1)}%)
                      </span>
                    </p>
                  </div>
                  <div className="bg-sunken border border-line rounded-[3px] px-2 py-1">
                    <p className="text-[9.5px] uppercase tracking-wide text-ink-3">Changed pixels</p>
                    <p className="text-[12px] tnum text-ink">{s2Result.summary.changedPct.toFixed(2)}%</p>
                  </div>
                  <div className="bg-sunken border border-line rounded-[3px] px-2 py-1">
                    <p className="text-[9.5px] uppercase tracking-wide text-ink-3">Cell size ≈</p>
                    <p className="text-[12px] tnum text-ink">{Math.round(s2Result.summary.approxCellMeters)} m</p>
                  </div>
                  <div className="bg-sunken border border-line rounded-[3px] px-2 py-1">
                    <p className="text-[9.5px] uppercase tracking-wide text-ink-3">Tile pairs</p>
                    <p className="text-[12px] tnum text-ink">
                      {s2Result.tilePairs}
                      {s2Result.failedTiles > 0 && (
                        <span className="text-risk-high text-[10.5px]"> ({s2Result.failedTiles} failed)</span>
                      )}
                    </p>
                  </div>
                </div>
                <img
                  src={s2Result.previewDataUrl}
                  alt={`Change preview ${s2Result.yearA} to ${s2Result.yearB}`}
                  className="mt-2.5 w-full rounded-[3px] border border-line"
                  title="Grayscale after-epoch mosaic; red cells are flagged change"
                />
                <p className="mt-1 text-[10px] text-ink-3">
                  Red = flagged change cell on the {s2Result.yearB} mosaic. Download the full
                  grid (GeoJSON) or the flagged schedule (CSV) below.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <button onClick={downloadS2Csv} className="ui-btn text-[11.5px]" title="Flagged cells as a CSV schedule">
                    <Download className="w-3.5 h-3.5" />
                    <span>CSV (flagged)</span>
                  </button>
                  <button
                    onClick={downloadS2GeoJson}
                    className="ui-btn text-[11.5px]"
                    title="Full cell grid as GeoJSON with flagged properties and source metadata"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>GeoJSON (grid)</span>
                  </button>
                </div>
                <p className="mt-2 text-[10.5px] text-ink-3 leading-relaxed">{S2_DISCLOSURE}</p>
              </div>
            )}
          </div>

          {/* Session record */}
          <div className="mt-3 flex items-center gap-2">
            <p className="text-[10.5px] text-ink-3 leading-relaxed flex-1">
              Imports land as coded vertices (OSM ids preserved) and reproject
              from WGS84 to the working CRS. Every fetch is written to the
              provenance registry with endpoint, license and scope — visible in
              the Provenance panel and embedded in exports.
            </p>
          </div>

          <p className="mt-1.5 text-[10.5px] text-ink-3 leading-relaxed">
            Data © OpenStreetMap contributors, {OSM_LICENSE}; boundary data
            under each dataset's published license (shown per fetch). OSM and
            open boundary geometry are community-mapped and indicative only —
            never a substitute for a licensed boundary survey.
          </p>
          <div className="mt-1">
            <button
              className="ui-btn text-[11px]"
              title="Forget this session's external-source records"
              onClick={() => {
                clearExternalSources();
                setImported(false);
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear session record</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
