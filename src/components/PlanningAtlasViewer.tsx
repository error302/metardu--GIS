/**
 * Planning Atlas — Decision Dossier view (Phase D: decision documents).
 *
 * The sheet is the primary artifact: planners can stress the suitability
 * model live (MCDA weight sliders) and the atlas re-renders with the chosen
 * weights disclosed in the method & limitations note. Class distribution
 * updates in real time — every recomputation is a true engine evaluation,
 * never a visual approximation.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Download, Printer, RotateCcw, SlidersHorizontal, Loader2, Image as ImageIcon } from "lucide-react";
import { downloadSheetPng } from "../core/export/png-export";
import { PipelineResult, McdaWeights } from "../types/spatial";
import { renderTemplate } from "../core/composer/render";
import { atlasPreset } from "../core/composer/presets";
import {
  DEFAULT_MCDA_WEIGHTS,
  evaluateSuitabilityGrid,
  buildSuitabilityIndexContext,
} from "../core/mcda-suitability";

interface PlanningAtlasViewerProps {
  result: PipelineResult;
}

export const PlanningAtlasViewer: React.FC<PlanningAtlasViewerProps> = ({ result }) => {
  const [weights, setWeights] = useState<McdaWeights>(DEFAULT_MCDA_WEIGHTS);
  const [effective, setEffective] = useState<PipelineResult>(result);
  const [recomputing, setRecomputing] = useState(false);
  const debounceRef = useRef<number | null>(null);

  // Indexes amortized per terrain/feature snapshot — slider drags only
  // re-evaluate the suitability cells (warm evaluation, indexed).
  const ctx = useMemo(
    () => buildSuitabilityIndexContext(result.tin, result.vectors),
    [result.tin, result.vectors],
  );

  // Document reset when the underlying document changes.
  useEffect(() => {
    setWeights(DEFAULT_MCDA_WEIGHTS);
    setEffective(result);
  }, [result]);

  const recompute = (w: McdaWeights) => {
    if (!result.tin || result.suitability.length === 0) return;
    setRecomputing(true);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      const cells = evaluateSuitabilityGrid(result.tin, result.vectors, w, 20, ctx);
      setEffective({ ...result, suitability: cells });
      setRecomputing(false);
    }, 140);
  };

  const onWeight = (key: keyof McdaWeights, v: number) => {
    const next = { ...weights, [key]: v };
    setWeights(next);
    recompute(next);
  };

  const weightsAdjusted = useMemo(
    () =>
      weights.slopeWeight !== DEFAULT_MCDA_WEIGHTS.slopeWeight ||
      weights.roadAccessWeight !== DEFAULT_MCDA_WEIGHTS.roadAccessWeight ||
      weights.waterBufferWeight !== DEFAULT_MCDA_WEIGHTS.waterBufferWeight ||
      weights.socialInfraWeight !== DEFAULT_MCDA_WEIGHTS.socialInfraWeight ||
      weights.maxSlopeAllowed !== DEFAULT_MCDA_WEIGHTS.maxSlopeAllowed ||
      weights.riparianBufferM !== DEFAULT_MCDA_WEIGHTS.riparianBufferM,
    [weights],
  );

  const sheet = useMemo(
    () => renderTemplate(atlasPreset(), effective, { mcdaWeights: weights }),
    [effective, weights],
  );
  const svgXml = sheet.svg;

  // Live class distribution (from the effective state actually rendered).
  const dist = useMemo(() => {
    const n = effective.suitability.length || 1;
    const count = (k: string) => effective.suitability.filter((c) => c.category === k).length;
    return {
      optimal: count("optimal") / n,
      suitable: count("suitable") / n,
      moderate: count("moderate") / n,
      restricted: count("restricted") / n,
      hazard: count("hazard") / n,
    };
  }, [effective]);

  const handleDownloadSvg = () => {
    const blob = new Blob([svgXml], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Regional_Planning_Atlas_${result.metadata.title.replace(/\s+/g, "_")}${
      weightsAdjusted ? "_sensitivity" : ""
    }.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const [pngBusy, setPngBusy] = useState(false);
  const handleDownloadPng = async () => {
    setPngBusy(true);
    try {
      await downloadSheetPng(
        svgXml, sheet.widthPx, sheet.heightPx,
        `Regional_Planning_Atlas_${result.metadata.title.replace(/\s+/g, "_")}${
          weightsAdjusted ? "_sensitivity" : ""
        }_300dpi.png`,
      );
    } finally {
      setPngBusy(false);
    }
  };

  const handlePrint = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html>
        <head>
          <title>Regional Planning Atlas - ${result.metadata.title}</title>
          <style>
            @page { size: A3 landscape; margin: 0; }
            body { margin: 0; background: #141416; display: flex; justify-content: center; align-items: center; }
            svg { width: 100vw; height: 100vh; }
          </style>
        </head>
        <body>
          ${svgXml}
          <script>window.onload = () => { window.print(); window.close(); }</script>
        </body>
      </html>
    `);
    win.document.close();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Preview toolbar */}
      <div className="h-9 shrink-0 bg-panel border-b border-line px-3 flex items-center gap-3">
        <span className="ui-label">Regional Planning Atlas — Decision Dossier</span>
        {recomputing && (
          <span className="flex items-center gap-1.5 text-[11px] text-accent">
            <Loader2 className="w-3 h-3 animate-spin" />
            Recomputing…
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={handlePrint} className="ui-btn">
            <Printer className="w-3.5 h-3.5" />
            <span>Print A3</span>
          </button>
          <button onClick={handleDownloadSvg} className="ui-btn-accent">
            <Download className="w-3.5 h-3.5" />
            <span>Download SVG</span>
          </button>
          <button onClick={handleDownloadPng} disabled={pngBusy} className="ui-btn">
            <ImageIcon className="w-3.5 h-3.5" />
            <span>{pngBusy ? "Rasterising…" : "PNG · 300 DPI"}</span>
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Sensitivity rail */}
        <div className="w-[248px] shrink-0 border-r border-line bg-panel overflow-y-auto">
          <div className="px-3 py-2.5 border-b border-line flex items-center gap-2">
            <SlidersHorizontal className="w-3.5 h-3.5 text-ink-2" />
            <span className="ui-label">Sensitivity toggles</span>
            {recomputing && <Loader2 className="w-3 h-3 text-accent animate-spin ml-auto" />}
          </div>
          <div className="p-3 space-y-3.5">
            <Rail slider={
              <SliderRow label="Slope weight" value={weights.slopeWeight} onChange={(v) => onWeight("slopeWeight", v)} />
            } hint="Terrain steepness importance" />
            <Rail slider={
              <SliderRow label="Road access" value={weights.roadAccessWeight} onChange={(v) => onWeight("roadAccessWeight", v)} />
            } hint="Proximity to roads importance" />
            <Rail slider={
              <SliderRow label="Water setback" value={weights.waterBufferWeight} onChange={(v) => onWeight("waterBufferWeight", v)} />
            } hint="Flood-safety margin importance" />
            <Rail slider={
              <SliderRow label="Social infra" value={weights.socialInfraWeight} onChange={(v) => onWeight("socialInfraWeight", v)} />
            } hint="Nearby facilities importance" />
            <Rail slider={
              <SliderRow label="Max slope" value={weights.maxSlopeAllowed} onChange={(v) => onWeight("maxSlopeAllowed", v)} display={`${weights.maxSlopeAllowed}%`} />
            } hint="Hard geotechnical restriction" />
            <Rail slider={
              <SliderRow label="Riparian buffer" value={weights.riparianBufferM} onChange={(v) => onWeight("riparianBufferM", v)} display={`${weights.riparianBufferM} m`} />
            } hint="Hard environmental setback" />

            <div className="pt-2 border-t border-line">
              <div className="flex items-center justify-between mb-1.5">
                <span className="ui-label">Live class distribution</span>
              </div>
              <DistBar dist={dist} />
              <p className="text-[10px] text-ink-3 mt-2 leading-relaxed">
                {weightsAdjusted
                  ? "Weights adjusted for sensitivity review — disclosed on the printed sheet; undoable to defaults below."
                  : "Document defaults — matching the published model state."}
              </p>
              <button
                onClick={() => {
                  setWeights(DEFAULT_MCDA_WEIGHTS);
                  recompute(DEFAULT_MCDA_WEIGHTS);
                }}
                disabled={!weightsAdjusted}
                className="ui-btn w-full justify-center mt-2 disabled:opacity-40"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset to document defaults</span>
              </button>
            </div>
          </div>
        </div>

        {/* Sheet preview */}
        <div className="flex-1 overflow-auto p-8 min-w-0">
          <div
            className="mx-auto shadow-[0_2px_24px_rgba(0,0,0,0.5)] border border-line-strong"
            style={{ width: "100%", maxWidth: 1500 }}
          >
            <div
              className="[&>svg]:w-full [&>svg]:h-auto [&>svg]:block"
              dangerouslySetInnerHTML={{ __html: svgXml }}
            />
          </div>
          <p className="text-center text-[11px] text-ink-3 mt-3">
            A3 landscape composition — suitability choropleth, hazard exposure matrix and approval blocks.
          </p>
        </div>
      </div>
    </div>
  );
};

const Rail: React.FC<{ slider: React.ReactNode; hint: string }> = ({ slider, hint }) => (
  <div>
    {slider}
    <span className="text-[10px] text-ink-3 block mt-0.5">{hint}</span>
  </div>
);

const SliderRow: React.FC<{
  label: string;
  value: number;
  onChange: (v: number) => void;
  display?: string;
}> = ({ label, value, onChange, display }) => (
  <div>
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[12px] text-ink-2">{label}</span>
      <span className="tnum text-[12px] text-ink whitespace-nowrap">{display ?? value}</span>
    </div>
    <input
      type="range"
      min={0}
      max={100}
      step={1}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full h-1 bg-line rounded-full appearance-none cursor-pointer accent-[#d9a441] mt-1"
    />
  </div>
);

const DistBar: React.FC<{ dist: { optimal: number; suitable: number; moderate: number; restricted: number; hazard: number } }> = ({ dist }) => {
  const segs: { key: string; pct: number; color: string; label: string }[] = [
    { key: "optimal", pct: dist.optimal, color: "#6fb07c", label: "Opt" },
    { key: "suitable", pct: dist.suitable, color: "#8ec498", label: "Suit" },
    { key: "moderate", pct: dist.moderate, color: "#d9a441", label: "Mod" },
    { key: "restricted", pct: dist.restricted, color: "#d97b7b", label: "Restr" },
    { key: "hazard", pct: dist.hazard, color: "#a04a4a", label: "Haz" },
  ];
  return (
    <div>
      <div className="flex h-3 rounded-[2px] overflow-hidden border border-line">
        {segs.map((s) => (
          <div key={s.key} style={{ width: `${s.pct * 100}%`, background: s.color }} title={`${s.label}: ${(s.pct * 100).toFixed(1)}%`} />
        ))}
      </div>
      <div className="flex justify-between mt-1">
        {segs.map((s) => (
          <span key={s.key} className="text-[9.5px] text-ink-3 tnum">
            {(s.pct * 100).toFixed(0)}%
          </span>
        ))}
      </div>
    </div>
  );
};
