import React from "react";
import { PipelineTelemetry } from "../types/spatial";

export interface CursorReadout {
  easting: number;
  northing: number;
  elevation: number;
  lat: number;
  lon: number;
}

interface StatusBarProps {
  cursor: CursorReadout | null;
  scaleDenominator: number;
  epsg: number;
  crsName: string;
  featureCount: number;
  selectedCount: number;
  scenarioTitle: string;
  telemetries: PipelineTelemetry[];
  totalDurationMs: number;
}

/** Round to 3 significant figures — surveying convention for scale denominators. */
const sig3 = (n: number) => {
  if (n <= 0) return 0;
  const d = Math.ceil(Math.log10(n));
  const p = 3 - d;
  return Math.round(n * 10 ** p) / 10 ** p;
};

const fmt = (v: number, dp = 2) =>
  v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

/**
 * Application status bar — persistent instrument strip.
 * Left: job identity + data counts. Right: live geodetic cursor readout,
 * view scale and active CRS. Mimics ArcGIS Pro / QGIS status bars.
 */
export const StatusBar: React.FC<StatusBarProps> = ({
  cursor,
  scaleDenominator,
  epsg,
  crsName,
  featureCount,
  selectedCount,
  scenarioTitle,
  telemetries,
  totalDurationMs,
}) => {
  const pipelineSummary = telemetries
    .map((t) => `${t.stepName.includes(". ") ? t.stepName.split(". ")[1] : t.stepName} ${t.durationMs}ms`)
    .join("  ·  ");

  return (
    <footer className="h-[26px] shrink-0 bg-panel border-t border-line flex items-center px-3 gap-4 text-[11px] text-ink-2 overflow-hidden select-none">
      {/* Job identity */}
      <span className="text-ink-3 truncate max-w-[280px]" title={scenarioTitle}>
        {scenarioTitle}
      </span>

      <span className="w-px h-3.5 bg-line-strong shrink-0" />

      {/* Data counts */}
      <span className="tnum shrink-0">
        {featureCount} pts
        {selectedCount > 0 && <span className="text-accent"> · {selectedCount} selected</span>}
      </span>

      {/* Pipeline timing (hover for stage breakdown) */}
      <span
        className="tnum text-ink-3 shrink-0 cursor-default"
        title={`Pipeline stages — ${pipelineSummary}`}
      >
        pipeline {totalDurationMs} ms
      </span>

      {/* Right cluster — live geodetic readout */}
      <div className="ml-auto flex items-center gap-4 shrink-0">
        {cursor && (
          <span className="tnum whitespace-nowrap" title="Cursor position — grid easting/northing">
            <span className="text-ink-3">E</span> {fmt(cursor.easting)}
            <span className="text-ink-3 mx-1.5">·</span>
            <span className="text-ink-3">N</span> {fmt(cursor.northing)}
            <span className="text-ink-3 mx-1.5">·</span>
            <span className="text-ink-3">H</span> {fmt(cursor.elevation)} m
          </span>
        )}
        {cursor && cursor.lat !== 0 && (
          <span className="tnum whitespace-nowrap" title="Cursor position — WGS 84 geographic">
            <span className="text-ink-3">φ</span> {cursor.lat.toFixed(6)}°
            <span className="text-ink-3 mx-1.5">·</span>
            <span className="text-ink-3">λ</span> {cursor.lon.toFixed(6)}°
          </span>
        )}

        <span className="w-px h-3.5 bg-line-strong shrink-0" />

        {/* View scale */}
        <span className="tnum whitespace-nowrap" title="Approximate view scale (96 dpi)">
          1:{sig3(scaleDenominator).toLocaleString("en-US")}
        </span>

        <span className="w-px h-3.5 bg-line-strong shrink-0" />

        {/* Active CRS */}
        <span className="whitespace-nowrap max-w-[260px] truncate" title={crsName}>
          <span className="text-ink-3">EPSG:</span>
          <span className="tnum ml-1">{epsg}</span>
          <span className="text-ink-3 ml-1.5">{crsName}</span>
        </span>
      </div>
    </footer>
  );
};
