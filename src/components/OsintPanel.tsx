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
import { Satellite, Search, Download, AlertTriangle, RefreshCw, Trash2, Check } from "lucide-react";
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
import { recordExternalSource, clearExternalSources } from "../core/osint/registry";

interface OsintPanelProps {
  /** Document extent in WGS84 lon/lat (computed by App from the working CRS). */
  wgs84Bbox: OverpassBbox | null;
  onImportPoints: (points: SurveyPoint[], layerName: string, notes: string[]) => void;
}

const RADIUS_OPTIONS = [1, 2, 5, 10, 25];
const DEFAULT_PRESETS: OverpassPreset[] = ["buildings", "roads", "water"];
const FETCH_LIMIT = 20000;

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

export const OsintPanel: React.FC<OsintPanelProps> = ({ wgs84Bbox, onImportPoints }) => {
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
    if (result.parse.skippedRelations > 0)
      notes.push(`${result.parse.skippedRelations} relations skipped (multipolygon assembly out of scope)`);
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
                Open ground context from public intelligence feeds
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
                  {result.parse.skippedRelations} relations skipped ·{" "}
                  {result.parse.unresolvedWays} unresolved ways
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
            Data © OpenStreetMap contributors, {OSM_LICENSE}. OSM geometry is
            community-mapped and indicative only — never a substitute for a
            licensed boundary survey.
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
