/**
 * Atlas Series panel — plan, preview, and export a multi-sheet print
 * atlas from the live pipeline result.
 *
 * Left rail: plan controls (page, sheet cap, overlap, scale series,
 * layer toggles) with a live plan summary. Centre: sheet strip (index +
 * every sheet) over a full-fidelity preview rendered by the same engine
 * that produces the exports. Right rail: sheet facts + export actions
 * (SVG / 300-dpi PNG per sheet, print, export-all).
 */

import React, { useMemo, useState } from "react";
import { Download, Printer, Image, Map as MapIcon, AlertTriangle } from "lucide-react";
import { PipelineResult } from "../types/spatial";
import { PageSizeKey, Orientation } from "../core/composer/template";
import {
  ATLAS_SCALE_SERIES, AtlasPlan, atlasExtentFromResult, planAtlasSeries,
} from "../core/composer/atlas";
import {
  AtlasLayerToggles, DEFAULT_ATLAS_LAYERS, renderAtlasSheet, renderAtlasIndexSheet,
} from "../core/composer/atlas-render";
import { downloadSheetPng } from "../core/export/png-export";

interface AtlasSeriesPanelProps {
  result: PipelineResult;
}

type SheetKey = "index" | string;

const OVERLAP_OPTIONS = [0, 0.05, 0.10, 0.15, 0.20, 0.25];
const CAP_OPTIONS = [1, 4, 9, 16, 25];

const LAYER_LABELS: { key: keyof AtlasLayerToggles; label: string }[] = [
  { key: "boundary", label: "Parcel boundary" },
  { key: "contours", label: "Contours" },
  { key: "relief", label: "Shaded relief" },
  { key: "vectors", label: "Vectors" },
  { key: "points", label: "Points" },
  { key: "suitability", label: "Suitability grid" },
  { key: "hazards", label: "Hazard sinks" },
  { key: "energy", label: "Energy clusters" },
];

const sanitize = (s: string) => s.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "atlas";

export const AtlasSeriesPanel: React.FC<AtlasSeriesPanelProps> = ({ result }) => {
  const [title, setTitle] = useState("ATLAS SERIES");
  const [size, setSize] = useState<PageSizeKey>("A3");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [maxSheets, setMaxSheets] = useState(9);
  const [overlap, setOverlap] = useState(0.10);
  const [fixedScale, setFixedScale] = useState<number | null>(null);
  const [layers, setLayers] = useState<AtlasLayerToggles>({ ...DEFAULT_ATLAS_LAYERS });
  const [selected, setSelected] = useState<SheetKey>("index");
  const [busy, setBusy] = useState<string | null>(null);

  const extent = useMemo(() => atlasExtentFromResult(result), [result]);
  const plan = useMemo<AtlasPlan | null>(
    () =>
      extent
        ? planAtlasSeries({
            extent, page: { size, orientation }, scaleDenominator: fixedScale,
            maxSheets, overlapFrac: overlap,
          })
        : null,
    [extent, size, orientation, fixedScale, maxSheets, overlap],
  );

  const rendered = useMemo(() => {
    if (!plan) return null;
    try {
      if (selected === "index") return renderAtlasIndexSheet(plan, result, { layers, atlasTitle: title });
      const sheet = plan.sheets.find((s) => s.label === selected);
      if (!sheet) return null;
      return renderAtlasSheet(plan, sheet, result, { layers, atlasTitle: title });
    } catch {
      return null;
    }
  }, [plan, selected, result, layers, title]);

  const downloadSvg = () => {
    if (!rendered) return;
    const blob = new Blob([rendered.svg], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${sanitize(title)}_${selected}_${rendered.widthMm}x${rendered.heightMm}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const downloadPng = async () => {
    if (!rendered) return;
    setBusy("png");
    try {
      await downloadSheetPng(
        rendered.svg, rendered.widthPx, rendered.heightPx,
        `${sanitize(title)}_${selected}_${rendered.widthMm}x${rendered.heightMm}_300dpi.png`,
        { dpi: 300 },
      );
    } finally {
      setBusy(null);
    }
  };

  const exportAll = async (kind: "svg" | "png") => {
    if (!plan) return;
    setBusy(kind);
    try {
      const all = [
        { key: "index" as SheetKey, sheet: renderAtlasIndexSheet(plan, result, { layers, atlasTitle: title }) },
        ...plan.sheets.map((s) => ({
          key: s.label as SheetKey,
          sheet: renderAtlasSheet(plan, s, result, { layers, atlasTitle: title }),
        })),
      ];
      for (const { key, sheet } of all) {
        const base = `${sanitize(title)}_${key}_${sheet.widthMm}x${sheet.heightMm}`;
        if (kind === "svg") {
          const blob = new Blob([sheet.svg], { type: "image/svg+xml" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `${base}.svg`;
          a.click();
          URL.revokeObjectURL(a.href);
        } else {
          await downloadSheetPng(sheet.svg, sheet.widthPx, sheet.heightPx, `${base}_300dpi.png`, { dpi: 300 });
        }
        await new Promise((r) => setTimeout(r, 350)); // let the browser settle downloads
      }
    } finally {
      setBusy(null);
    }
  };

  const printSheet = () => {
    if (!rendered || !plan) return;
    const w = window.open("", "_blank", "width=980,height=760");
    if (!w) return;
    w.document.write(
      `<!doctype html><html><head><title>${title} — ${selected}</title><style>` +
      `@page { size: ${rendered.widthMm}mm ${rendered.heightMm}mm; margin: 0; }` +
      `html,body { margin:0; padding:0; background:#fff; } svg { width:100vw; height:auto; display:block; }` +
      `</style></head><body>${rendered.svg}<script>window.onload = () => window.print();</script></body></html>`,
    );
    w.document.close();
  };

  return (
    <div className="h-full flex overflow-hidden bg-app">
      {/* Left rail — plan controls */}
      <aside className="w-[230px] shrink-0 border-r border-line bg-panel flex flex-col overflow-y-auto">
        <div className="ui-panel-head">
          <div>
            <h2 className="text-[13px] font-semibold text-ink">Atlas Plan</h2>
            <p className="text-[10.5px] text-ink-3 mt-0.5">Uniform-scale sheet series</p>
          </div>
        </div>

        <div className="px-2.5 py-2 space-y-2.5">
          <div>
            <span className="ui-label">Atlas title</span>
            <input
              className="ui-input w-full mt-1 text-[12px]"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="ATLAS SERIES"
            />
          </div>

          <div>
            <span className="ui-label">Page</span>
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              <select className="ui-select text-[12px]" value={size} onChange={(e) => setSize(e.target.value as PageSizeKey)}>
                {(["A4", "A3", "A2", "A1"] as PageSizeKey[]).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <select className="ui-select text-[12px]" value={orientation} onChange={(e) => setOrientation(e.target.value as Orientation)}>
                <option value="landscape">Landscape</option>
                <option value="portrait">Portrait</option>
              </select>
            </div>
          </div>

          <div>
            <span className="ui-label">Sheet cap (auto scale)</span>
            <select
              className="ui-select w-full mt-1 text-[12px] tnum"
              value={maxSheets}
              onChange={(e) => setMaxSheets(Number(e.target.value))}
            >
              {CAP_OPTIONS.map((c) => (
                <option key={c} value={c}>{c === 1 ? "1 sheet" : `${c} sheets (${Math.sqrt(c)}×${Math.sqrt(c)})`}</option>
              ))}
            </select>
          </div>

          <div>
            <span className="ui-label">Scale</span>
            <select
              className="ui-select w-full mt-1 text-[12px] tnum"
              value={fixedScale ?? ""}
              onChange={(e) => setFixedScale(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Auto — largest series scale that fits</option>
              {ATLAS_SCALE_SERIES.map((d) => (
                <option key={d} value={d}>Fixed 1:{d.toLocaleString("en-US")}</option>
              ))}
            </select>
          </div>

          <div>
            <span className="ui-label">Sheet overlap</span>
            <select
              className="ui-select w-full mt-1 text-[12px] tnum"
              value={overlap}
              onChange={(e) => setOverlap(Number(e.target.value))}
            >
              {OVERLAP_OPTIONS.map((o) => (
                <option key={o} value={o}>{Math.round(o * 100)}%</option>
              ))}
            </select>
          </div>

          <div>
            <span className="ui-label">Layers</span>
            <div className="mt-1 space-y-1">
              {LAYER_LABELS.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 text-[12px] text-ink-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-[#d9a441]"
                    checked={layers[key]}
                    onChange={(e) => setLayers((l) => ({ ...l, [key]: e.target.checked }))}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="px-2.5 py-2 border-t border-line mt-auto">
          <span className="ui-label">Plan</span>
          {!extent && (
            <p className="mt-1.5 text-[11px] text-ink-3">
              No features in the document — import or digitise geometry first.
            </p>
          )}
          {extent && !plan && (
            <p className="mt-1.5 text-[11px] text-risk-high flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              Extent cannot be tiled sanely at the chosen settings.
            </p>
          )}
          {plan && (
            <div className="mt-1.5 text-[11px] text-ink-2 tnum space-y-0.5">
              <p>{plan.cols} × {plan.rows} = {plan.sheets.length} sheets at {`1:${plan.scaleDenominator.toLocaleString("en-US")}`}</p>
              <p className="text-ink-3">
                Sheet covers {plan.groundW.toLocaleString("en-US")} × {plan.groundH.toLocaleString("en-US")} m · overlap {Math.round(plan.overlapFrac * 100)}%
              </p>
              {plan.disclosure && (
                <p className="text-[10.5px] text-risk-high">{plan.disclosure}</p>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Centre — sheet strip + preview */}
      <section className="flex-1 min-w-0 flex flex-col">
        <div className="h-9 shrink-0 border-b border-line bg-panel flex items-center gap-1.5 px-3 overflow-x-auto">
          <span className="ui-label shrink-0">Sheets</span>
          {plan && (
            <div className="flex items-center gap-1">
              <SheetChip label="INDEX" active={selected === "index"} onClick={() => setSelected("index")} />
              {plan.sheets.map((s) => (
                <SheetChip key={s.label} label={`${s.label}`} sub={`${s.index}`} active={selected === s.label} onClick={() => setSelected(s.label)} />
              ))}
            </div>
          )}
          <div className="flex-1" />
          {rendered && (
            <span className="text-[11px] text-ink-3 tnum shrink-0">
              {rendered.widthMm}×{rendered.heightMm} mm
            </span>
          )}
        </div>
        <div className="flex-1 overflow-auto bg-sunken p-6 grid place-items-start">
          {rendered ? (
            <div
              className="bg-white shadow-lg max-w-full [&>svg]:w-full [&>svg]:h-auto"
              style={{ maxWidth: 1100 }}
              dangerouslySetInnerHTML={{ __html: rendered.svg }}
            />
          ) : (
            <div className="text-[12px] text-ink-3 self-center justify-self-center">
              {extent ? "Adjust the plan to generate sheets." : "Nothing to plot yet — the document has no geometry."}
            </div>
          )}
        </div>
      </section>

      {/* Right rail — sheet facts + export */}
      <aside className="w-[250px] shrink-0 border-l border-line bg-panel flex flex-col overflow-y-auto">
        <div className="ui-panel-head">
          <div>
            <h2 className="text-[13px] font-semibold text-ink">Deliver</h2>
            <p className="text-[10.5px] text-ink-3 mt-0.5">
              {selected === "index" ? "Index sheet" : `Sheet ${selected}`}
            </p>
          </div>
        </div>

        <div className="px-2.5 py-2.5 space-y-2 text-[11.5px] text-ink-2">
          {plan && selected !== "index" && (() => {
            const s = plan.sheets.find((x) => x.label === selected);
            if (!s) return null;
            const nb = [
              s.neighbors.n && `N ${s.neighbors.n}`, s.neighbors.e && `E ${s.neighbors.e}`,
              s.neighbors.s && `S ${s.neighbors.s}`, s.neighbors.w && `W ${s.neighbors.w}`,
            ].filter(Boolean).join(" · ");
            return (
              <>
                <p className="tnum">Sheet {s.index} of {plan.sheets.length} · row {s.row + 1}, column {s.col + 1}</p>
                <p className="tnum text-ink-3">
                  E {Math.round(s.extent.minE).toLocaleString("en-US")}…{Math.round(s.extent.maxE).toLocaleString("en-US")} ·
                  N {Math.round(s.extent.minN).toLocaleString("en-US")}…{Math.round(s.extent.maxN).toLocaleString("en-US")}
                </p>
                {nb && <p className="tnum text-ink-3">Adjacent: {nb}</p>}
              </>
            );
          })()}
          {plan && selected === "index" && (
            <p className="tnum">
              {plan.sheets.length} sheets at 1:{plan.scaleDenominator.toLocaleString("en-US")} ·
              coverage {Math.round(plan.coverage.maxE - plan.coverage.minE).toLocaleString("en-US")} ×
              {" "}{Math.round(plan.coverage.maxN - plan.coverage.minN).toLocaleString("en-US")} m
            </p>
          )}
        </div>

        <div className="px-2.5 py-2 space-y-1.5 border-t border-line">
          <button onClick={downloadSvg} disabled={!rendered} className="ui-btn w-full text-[11.5px] justify-start">
            <Download className="w-3.5 h-3.5" />
            <span>Export sheet SVG (vector)</span>
          </button>
          <button onClick={downloadPng} disabled={!rendered || busy !== null} className="ui-btn w-full text-[11.5px] justify-start">
            <Image className="w-3.5 h-3.5" />
            <span>{busy === "png" ? "Rasterising…" : "Export sheet PNG · 300 dpi"}</span>
          </button>
          <button onClick={printSheet} disabled={!rendered} className="ui-btn w-full text-[11.5px] justify-start">
            <Printer className="w-3.5 h-3.5" />
            <span>Print current sheet</span>
          </button>
        </div>

        <div className="px-2.5 py-2 space-y-1.5 border-t border-line">
          <button onClick={() => exportAll("svg")} disabled={!plan || busy !== null} className="ui-btn w-full text-[11.5px] justify-start">
            <MapIcon className="w-3.5 h-3.5" />
            <span>{busy === "svg" ? "Exporting…" : "Export ALL sheets — SVG"}</span>
          </button>
          <button onClick={() => exportAll("png")} disabled={!plan || busy !== null} className="ui-btn w-full text-[11.5px] justify-start">
            <Image className="w-3.5 h-3.5" />
            <span>{busy === "png" ? "Rasterising…" : "Export ALL sheets — PNG 300 dpi"}</span>
          </button>
          <p className="text-[10px] text-ink-3 leading-snug">
            The index sheet is included in export-all. PNG rasterisation embeds IBM Plex when
            reachable; offline export falls back to system fonts.
          </p>
        </div>

        <div className="px-2.5 py-2 mt-auto border-t border-line">
          <p className="text-[10px] text-ink-3 leading-snug">
            Sheets share one uniform scale and a common ground grid, so graticule lines continue
            across neighbours. Figures are computed from the live document — nothing is estimated.
          </p>
        </div>
      </aside>
    </div>
  );
};

const SheetChip: React.FC<{ label: string; sub?: string; active: boolean; onClick: () => void }> = ({ label, sub, active, onClick }) => (
  <button
    onClick={onClick}
    title={label}
    className={`shrink-0 px-2 py-1 rounded-[3px] border text-[11px] tnum ${
      active ? "border-accent/60 bg-accent/10 text-ink" : "border-transparent text-ink-2 hover:bg-raised"
    }`}
  >
    {label}{sub && <span className="text-ink-3 ml-1">{sub}</span>}
  </button>
);
