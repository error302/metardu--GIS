/**
 * Regional Terrain — Copernicus DEM GLO-30 context around the job.
 *
 * Fetches a regional elevation grid (Planetary Computer crop endpoint),
 * decodes it client-side, and reports the analysis products the surveyed
 * TIN cannot express beyond the job boundary: elevation statistics, Horn
 * slope distribution, an along-axis terrain profile, and regional contour
 * geometry. Every fetch is written to the provenance registry (service,
 * endpoint, licence, timestamp, coverage) and the panel states the
 * statutory boundary plainly: this is regional raster context, never a
 * substitute for surveyed elevations.
 */

import React, { useMemo, useState } from "react";
import { Mountain, Search, AlertTriangle, RefreshCw, Activity, BarChart3, Map as MapIcon, Check } from "lucide-react";
import {
  fetchDemGrid,
  DemFetchResult,
  Bbox,
  DEM_SERVICE,
  DEM_LICENSE,
  DEM_ATTRIBUTION,
} from "../core/dem/copernicus";
import {
  gridStats,
  gridSlope,
  slopeHistogram,
  terrainProfile,
  gridContours,
  SlopeHistogram,
  GridContour,
} from "../core/dem/analysis";
import { validateBbox } from "../core/osint/overpass";
import { recordExternalSource } from "../core/osint/registry";

interface DemPanelProps {
  /** Document extent in WGS84 lon/lat (computed by App from the working CRS). */
  wgs84Bbox: Bbox | null;
}

function fmtKm(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export const DemPanel: React.FC<DemPanelProps> = ({ wgs84Bbox }) => {
  const [fetching, setFetching] = useState(false);
  const [result, setResult] = useState<DemFetchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bboxError = wgs84Bbox ? validateBbox(wgs84Bbox) : null;

  const analysis = useMemo(() => {
    if (!result) return null;
    const { grid } = result;
    const stats = gridStats(grid);
    const slope = gridSlope(grid);
    let maxSlope = 0;
    for (let i = 0; i < slope.length; i++) {
      if (Number.isFinite(slope[i]) && slope[i] > maxSlope) maxSlope = slope[i];
    }
    const hist = slopeHistogram(slope);
    // Profile along the extent's long axis, through the centre.
    const cx = (grid.west * 2 + grid.width * grid.dLonDeg) / 2;
    const north = grid.north;
    const south = grid.north - grid.height * grid.dLatDeg;
    const east = grid.west + grid.width * grid.dLonDeg;
    const horizontal = east - grid.west >= north - south;
    const profile = horizontal
      ? terrainProfile(grid, { lon: grid.west, lat: (north + south) / 2 }, { lon: east, lat: (north + south) / 2 }, 160)
      : terrainProfile(grid, { lon: cx, lat: south }, { lon: cx, lat: north }, 160);
    const contours = gridContours(grid, 20, 5);
    return { stats, maxSlope, hist, profile, contours };
  }, [result]);

  const runFetch = async () => {
    if (!wgs84Bbox || bboxError) return;
    setFetching(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetchDemGrid(wgs84Bbox, { targetResM: 30 });
      setResult(r);
      const ids = [...new Set(r.tileBytes.map((t) => t.itemId))];
      const km = ((wgs84Bbox.lonMax - wgs84Bbox.lonMin) * 111.32).toFixed(1);
      recordExternalSource({
        service: DEM_SERVICE,
        endpoint: r.endpoint,
        license: DEM_LICENSE,
        attribution: DEM_ATTRIBUTION,
        fetchedAt: r.fetchedAt,
        featureCount: 1,
        note: `Regional DEM grid ${r.grid.width}x${r.grid.height} px @ ${r.effectiveResM.toFixed(0)} m/px over ≈${km} km; tiles: ${ids.join(", ")}`,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFetching(false);
    }
  };

  const stats = analysis?.stats;

  return (
    <div className="h-full flex bg-app">
      <div className="flex-1 flex flex-col items-center justify-start p-6 overflow-auto">
        <div className="w-full max-w-[880px]">
          {/* Header */}
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-[3px] border border-line-strong bg-sunken flex items-center justify-center">
              <Mountain className="w-4.5 h-4.5 text-ink-2" />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold text-ink leading-tight">Regional Terrain</h1>
              <p className="text-[11.5px] text-ink-3">
                Copernicus DEM GLO-30 — regional context beyond the survey
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
              {fetching ? "FETCHING" : result ? "READY" : "IDLE"}
            </span>
          </div>

          {/* Scope */}
          <div className="mt-4 bg-panel border border-line-strong rounded-[4px]">
            <div className="px-4 py-3">
              <span className="ui-label">Fetch scope</span>
              {wgs84Bbox ? (
                <div className="mt-1.5 space-y-1.5">
                  <p className="text-[11.5px] text-ink-2 tnum">
                    Document extent (WGS84): [{wgs84Bbox.latMin.toFixed(4)}, {wgs84Bbox.lonMin.toFixed(4)}] — [
                    {wgs84Bbox.latMax.toFixed(4)}, {wgs84Bbox.lonMax.toFixed(4)}]
                  </p>
                  <p className="text-[11px] text-ink-3 leading-relaxed">
                    One 30 m/px crop per intersecting 1° tile, mosaicked client-side.
                    Uncompressed float32 GeoTIFF over open CORS — no credentials,
                    no storage mirror trust beyond the disclosing endpoint below.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={runFetch}
                      disabled={fetching || !!bboxError}
                      className="ui-btn-accent text-[12px]"
                      title="Fetch the GLO-30 regional grid for the document extent"
                    >
                      {fetching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                      <span>{fetching ? "Fetching…" : "Fetch regional DEM"}</span>
                    </button>
                    <span className="text-[10.5px] text-ink-3">
                      Planetary Computer Data API · POST crop.tif · 90 s timeout
                    </span>
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
                  Open or import a survey first — the fetch scope follows the
                  document extent, reprojected to WGS84.
                </p>
              )}
            </div>

            {error && (
              <div className="px-4 py-2.5 border-t border-line bg-risk-high/5 flex gap-2">
                <AlertTriangle className="w-4 h-4 text-risk-high shrink-0 mt-0.5" />
                <p className="text-[11.5px] text-ink-2 leading-relaxed break-words">{error}</p>
              </div>
            )}

            {/* Stats strip */}
            {result && stats && (
              <div className="px-4 py-3 border-t border-line">
                <div className="flex items-center gap-2">
                  <span className="ui-label">Elevation summary</span>
                  <div className="flex-1" />
                  <span className="text-[10.5px] text-ink-3 tnum">
                    {result.grid.width}×{result.grid.height} px @ {result.effectiveResM.toFixed(0)} m/px
                    {result.plan.resampled ? " (resampled to pixel cap)" : ""}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-3 md:grid-cols-6 gap-1.5">
                  {[
                    ["Min", `${stats.minM.toFixed(1)} m`],
                    ["Mean", `${stats.meanM.toFixed(1)} m`],
                    ["Max", `${stats.maxM.toFixed(1)} m`],
                    ["Std dev", `${stats.stdDevM.toFixed(2)} m`],
                    ["Max slope", `${analysis!.maxSlope.toFixed(1)}°`],
                    ["Coverage", `${(stats.coverage * 100).toFixed(0)}%`],
                  ].map(([k, v]) => (
                    <div
                      key={k}
                      className="bg-sunken border border-line rounded-[3px] px-2 py-1.5"
                    >
                      <p className="text-[9.5px] uppercase tracking-wide text-ink-3">{k}</p>
                      <p className="text-[12px] tnum text-ink">{v}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-1.5 text-[10.5px] text-ink-3 tnum break-all">
                  {result.tileBytes.map((t) => `${t.itemId.split("_COG_10_")[1]?.replace("_DEM", "") ?? t.itemId} (${(t.bytes / 1024).toFixed(0)} KB)`).join(" · ")}
                  {" · "}
                  {(result.tileBytes.reduce((a, t) => a + t.bytes, 0) / 1024).toFixed(0)} KB total
                </p>
              </div>
            )}

            {/* Profile + histogram + mini-map */}
            {result && analysis && (
              <div className="px-4 py-3 border-t border-line grid md:grid-cols-2 gap-4">
                {/* Elevation profile */}
                <div>
                  <div className="flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5 text-ink-3" />
                    <span className="ui-label">Terrain profile — long axis</span>
                  </div>
                  <ProfileChart stations={analysis.profile} />
                </div>

                {/* Slope histogram */}
                <div>
                  <div className="flex items-center gap-2">
                    <BarChart3 className="w-3.5 h-3.5 text-ink-3" />
                    <span className="ui-label">Slope distribution</span>
                  </div>
                  <SlopeBars hist={analysis.hist} />
                </div>

                {/* Contour mini-map */}
                <div className="md:col-span-2">
                  <div className="flex items-center gap-2">
                    <MapIcon className="w-3.5 h-3.5 text-ink-3" />
                    <span className="ui-label">Regional contours — 20 m interval, index every 100 m</span>
                    <div className="flex-1" />
                    <span className="text-[10.5px] text-ink-3 tnum">
                      {analysis.contours.length} levels ·{" "}
                      {analysis.contours.reduce((a, c) => a + c.lines.length, 0)} polylines
                    </span>
                  </div>
                  <ContourMap
                    result={result}
                    contours={analysis.contours}
                    docBbox={wgs84Bbox}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Disclosure */}
          <div className="mt-3 space-y-1.5">
            <p className="text-[10.5px] text-ink-3 leading-relaxed">
              {DEM_ATTRIBUTION}. {DEM_LICENSE}. Regional raster context at the
              disclosed ground resolution — drainage, slope and reconnaissance
              insight beyond the survey footprint. It is NOT a statutory
              elevation source: inside the job boundary the surveyed TIN and
              its adjusted elevations remain the source of truth. Every fetch
              is recorded in the provenance registry and flows into exports.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* SVG chart pieces                                                    */
/* ------------------------------------------------------------------ */

const ProfileChart: React.FC<{ stations: { distM: number; elevM: number }[] }> = ({ stations }) => {
  const W = 400;
  const H = 130;
  const valid = stations.filter((s) => Number.isFinite(s.elevM));
  if (valid.length < 2) {
    return <div className="mt-2 text-[11px] text-ink-3">No valid profile samples in the fetched grid.</div>;
  }
  const minE = Math.min(...valid.map((s) => s.elevM));
  const maxE = Math.max(...valid.map((s) => s.elevM));
  const padE = Math.max(2, (maxE - minE) * 0.12);
  const lo = minE - padE;
  const hi = maxE + padE;
  const d0 = stations[0].distM;
  const d1 = stations[stations.length - 1].distM;
  const x = (d: number) => ((d - d0) / (d1 - d0 || 1)) * (W - 8) + 4;
  const y = (e: number) => H - 20 - ((e - lo) / (hi - lo || 1)) * (H - 34);

  let path = "";
  let open = false;
  for (const s of stations) {
    if (!Number.isFinite(s.elevM)) {
      open = false;
      continue;
    }
    path += `${open ? "L" : "M"}${x(s.distM).toFixed(1)},${y(s.elevM).toFixed(1)} `;
    open = true;
  }
  const area = `${path}L${x(valid[valid.length - 1].distM).toFixed(1)},${H - 20} L${x(valid[0].distM).toFixed(1)},${H - 20} Z`;

  return (
    <div className="mt-2 bg-sunken border border-line rounded-[3px] p-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {/* gridlines */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={4}
            x2={W - 4}
            y1={20 + f * (H - 40)}
            y2={20 + f * (H - 40)}
            stroke="#3a3a40"
            strokeWidth={0.5}
          />
        ))}
        <path d={area} fill="rgba(217,164,65,0.14)" />
        <path d={path} fill="none" stroke="#d9a441" strokeWidth={1.2} />
        <text x={4} y={10} fontSize={9} fill="#a4a4aa" className="tnum">
          {maxE.toFixed(0)} m
        </text>
        <text x={4} y={H - 24} fontSize={9} fill="#a4a4aa" className="tnum">
          {minE.toFixed(0)} m
        </text>
        <text x={W - 4} y={H - 6} fontSize={9} fill="#70707a" textAnchor="end" className="tnum">
          {fmtKm(d1)} →
        </text>
        <text x={4} y={H - 6} fontSize={9} fill="#70707a" className="tnum">
          {fmtKm(d0)}
        </text>
      </svg>
    </div>
  );
};

const SlopeBars: React.FC<{ hist: SlopeHistogram }> = ({ hist }) => {
  const W = 400;
  const H = 130;
  const maxC = Math.max(...hist.counts, 1);
  const bw = (W - 20) / hist.counts.length;
  const labels = hist.edges.slice(0, -1).map((e, i) => (i === hist.counts.length - 1 ? `≥${e}°` : `${e}–${hist.edges[i + 1]}°`));
  return (
    <div className="mt-2 bg-sunken border border-line rounded-[3px] p-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {hist.counts.map((c, i) => {
          const h = (c / maxC) * (H - 42);
          return (
            <g key={i}>
              <rect
                x={8 + i * bw + 1.5}
                y={H - 22 - h}
                width={bw - 3}
                height={Math.max(h, 0)}
                fill={i >= hist.counts.length - 3 ? "rgba(217,123,123,0.75)" : "rgba(217,164,65,0.6)"}
                stroke="#4a4a50"
                strokeWidth={0.5}
              />
              {c > 0 && (
                <text
                  x={8 + i * bw + bw / 2}
                  y={H - 26 - h}
                  fontSize={8}
                  fill="#a4a4aa"
                  textAnchor="middle"
                  className="tnum"
                >
                  {((c / (hist.evaluated || 1)) * 100).toFixed(0)}%
                </text>
              )}
              <text
                x={8 + i * bw + bw / 2}
                y={H - 8}
                fontSize={7.5}
                fill="#70707a"
                textAnchor="middle"
              >
                {labels[i]}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="text-[9.5px] text-ink-3 px-1">
        Horn slope over {hist.evaluated.toLocaleString("en-US")} evaluated cells · steeper classes tinted
      </p>
    </div>
  );
};

const ContourMap: React.FC<{
  result: DemFetchResult;
  contours: GridContour[];
  docBbox: Bbox | null;
}> = ({ result, contours, docBbox }) => {
  const { grid } = result;
  const W = 860;
  const H = 300;
  const x = (lon: number) => ((lon - grid.west) / (grid.width * grid.dLonDeg || 1)) * (W - 16) + 8;
  const y = (lat: number) => ((grid.north - lat) / (grid.height * grid.dLatDeg || 1)) * (H - 16) + 8;

  return (
    <div className="mt-2 bg-sunken border border-line rounded-[3px] p-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {contours.map((ct) =>
          ct.lines.map((line, li) => (
            <polyline
              key={`${ct.level}-${li}`}
              points={line.map(([lon, lat]) => `${x(lon).toFixed(1)},${y(lat).toFixed(1)}`).join(" ")}
              fill="none"
              stroke={ct.isIndex ? "#c9985b" : "#55555c"}
              strokeWidth={ct.isIndex ? 1.1 : 0.55}
            />
          )),
        )}
        {/* Document extent overlay */}
        {docBbox && docBbox.lonMax >= grid.west && docBbox.lonMin <= grid.west + grid.width * grid.dLonDeg && (
          <rect
            x={x(docBbox.lonMin)}
            y={y(docBbox.latMax)}
            width={Math.max(2, x(docBbox.lonMax) - x(docBbox.lonMin))}
            height={Math.max(2, y(docBbox.latMin) - y(docBbox.latMax))}
            fill="none"
            stroke="#d9a441"
            strokeWidth={1.2}
            strokeDasharray="5 3"
          />
        )}
        {/* Frame */}
        <rect x={0.5} y={0.5} width={W - 1} height={H - 1} fill="none" stroke="#3a3a40" strokeWidth={1} />
      </svg>
      <div className="flex items-center gap-3 px-1 pt-1">
        <span className="text-[9.5px] text-ink-3 tnum">
          W {grid.west.toFixed(4)}° · E {(grid.west + grid.width * grid.dLonDeg).toFixed(4)}°
        </span>
        <span className="text-[9.5px] text-ink-3 tnum">
          N {grid.north.toFixed(4)}° · S {(grid.north - grid.height * grid.dLatDeg).toFixed(4)}°
        </span>
        <div className="flex-1" />
        <span className="text-[9.5px] text-ink-3 flex items-center gap-1">
          <Check className="w-3 h-3 text-accent" /> amber box = document extent
        </span>
      </div>
    </div>
  );
};
