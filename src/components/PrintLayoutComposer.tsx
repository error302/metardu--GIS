/**
 * MetaRDU GIS Studio - Visual Print Layout Composer (QGIS / ArcGIS Pro Parity)
 * Interactive cartographic page layout designer with live vector preview,
 * engineering scale controls, metadata title block editing, and high-DPI export.
 */

import React, { useState, useMemo, useRef } from "react";
import {
  Printer,
  Download,
  FileImage,
  Layers,
  Settings,
  Maximize2,
  Compass,
  FileText,
  Table,
  Check,
} from "lucide-react";
import { PipelineResult } from "../types/spatial";
import {
  PageFormat,
  PAGE_DIMENSIONS,
  LayoutMetadata,
  LayoutOptions,
  calculateOptimalScale,
  generatePrintLayoutSvg,
} from "../core/layout-engine";

interface PrintLayoutComposerProps {
  result: PipelineResult;
}

export const PrintLayoutComposer: React.FC<PrintLayoutComposerProps> = ({ result }) => {
  const [format, setFormat] = useState<PageFormat>("A4_LANDSCAPE");
  const [showGraticule, setShowGraticule] = useState(true);
  const [showLegend, setShowLegend] = useState(true);
  const [showCoordinateTable, setShowCoordinateTable] = useState(true);
  const [showScaleBar, setShowScaleBar] = useState(true);
  const [showNorthArrow, setShowNorthArrow] = useState(true);
  const [showTitleBlock, setShowTitleBlock] = useState(true);
  const [showContours, setShowContours] = useState(true);
  const [showBuffers, setShowBuffers] = useState(true);

  // Metadata
  const [metadata, setMetadata] = useState<LayoutMetadata>({
    projectTitle: result.metadata.title || "Cadastral Survey & Valuation Plan",
    parcelId: result.metadata.id || "LR NO. 209/CADASTRAL-01",
    locality: result.metadata.locality || "Central Sub-County",
    county: result.metadata.country || "East Africa Cadastre",
    surveyorName: result.metadata.surveyorName || "Licensed Land Surveyor",
    registrationNumber: result.metadata.registrationNo || "MISK-CAD-402",
    date: result.metadata.date || new Date().toISOString().split("T")[0],
    scaleRatio: 1000,
    notes: "All bearings are referred to True North. Distances are in meters.",
  });

  const previewContainerRef = useRef<HTMLDivElement>(null);

  // Auto-fit scale computation
  const handleAutoFitScale = () => {
    const page = PAGE_DIMENSIONS[format];
    const frameW = page.widthMm * 0.65;
    const frameH = page.heightMm - 24;
    const optimal = calculateOptimalScale(result.points, frameW, frameH);
    setMetadata((prev) => ({ ...prev, scaleRatio: optimal }));
  };

  const layoutOptions: LayoutOptions = useMemo(
    () => ({
      format,
      metadata,
      showGraticule,
      showLegend,
      showCoordinateTable,
      showScaleBar,
      showNorthArrow,
      showTitleBlock,
      showContours,
      showBuffers,
    }),
    [
      format,
      metadata,
      showGraticule,
      showLegend,
      showCoordinateTable,
      showScaleBar,
      showNorthArrow,
      showTitleBlock,
      showContours,
      showBuffers,
    ]
  );

  const svgContent = useMemo(
    () => generatePrintLayoutSvg(result, layoutOptions),
    [result, layoutOptions]
  );

  // Download SVG
  const handleExportSvg = () => {
    const blob = new Blob([svgContent], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Metardu_Layout_${metadata.parcelId.replace(/[^a-zA-Z0-9]/g, "_")}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export 300 DPI PNG
  const handleExportPng = () => {
    const page = PAGE_DIMENSIONS[format];
    const dpi = 300;
    const pxPerMm = dpi / 25.4;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(page.widthMm * pxPerMm);
    canvas.height = Math.round(page.heightMm * pxPerMm);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    const svgBlob = new Blob([svgContent], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);

      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `Metardu_Print_300DPI_${metadata.parcelId.replace(/[^a-zA-Z0-9]/g, "_")}.png`;
      a.click();
    };
    img.src = url;
  };

  // Browser Print
  const handlePrint = () => {
    const printWin = window.open("", "_blank");
    if (!printWin) return;
    printWin.document.write(`
      <html>
        <head>
          <title>${metadata.projectTitle} - Print Sheet</title>
          <style>
            @page { size: ${format.includes("LANDSCAPE") ? "landscape" : "portrait"}; margin: 0; }
            body { margin: 0; padding: 0; display: flex; justify-content: center; align-items: center; }
            svg { width: 100vw; height: 100vh; }
          </style>
        </head>
        <body>
          ${svgContent}
        </body>
      </html>
    `);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => {
      printWin.print();
    }, 400);
  };

  return (
    <div className="flex h-[calc(100vh-125px)] w-full bg-[#070A0F] text-slate-100 overflow-hidden font-['Plus_Jakarta_Sans'] select-none">
      {/* Center Layout Canvas Viewport */}
      <div
        ref={previewContainerRef}
        className="flex-1 overflow-auto bg-[#070A0F] p-8 flex items-center justify-center relative"
      >
        <div className="bg-white rounded shadow-2xl overflow-hidden max-w-full max-h-full border border-slate-700">
          <div
            dangerouslySetInnerHTML={{ __html: svgContent }}
            className="w-full h-auto block"
          />
        </div>
      </div>

      {/* Right Properties Panel & Cartographic Controls */}
      <aside className="w-84 bg-slate-900 border-l border-slate-800 flex flex-col justify-between shrink-0 overflow-y-auto">
        <div className="p-4 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Printer className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-white">
                PRINT COMPOSER
              </span>
            </div>
            <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded border border-blue-500/20 font-mono">
              QGIS PARITY
            </span>
          </div>

          {/* Page Setup */}
          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
              Page Sheet Format
            </label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as PageFormat)}
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              {Object.entries(PAGE_DIMENSIONS).map(([key, dim]) => (
                <option key={key} value={key}>
                  {dim.name}
                </option>
              ))}
            </select>
          </div>

          {/* Scale Setting */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                Engineering Scale
              </label>
              <button
                onClick={handleAutoFitScale}
                className="text-[10px] text-blue-400 hover:text-blue-300 transition cursor-pointer flex items-center gap-1"
              >
                <Maximize2 className="w-3 h-3" />
                <span>Auto-Fit</span>
              </button>
            </div>
            <select
              value={metadata.scaleRatio}
              onChange={(e) =>
                setMetadata((prev) => ({ ...prev, scaleRatio: Number(e.target.value) }))
              }
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value={250}>1:250 (Detailed Site Plan)</option>
              <option value={500}>1:500 (Cadastral Parcel)</option>
              <option value={1000}>1:1,000 (Standard Form 4)</option>
              <option value={1250}>1:1,250 (Estate Plan)</option>
              <option value={2000}>1:2,000 (Zonal Master Plan)</option>
              <option value={2500}>1:2,500 (Subdivision Block)</option>
              <option value={5000}>1:5,000 (Regional Topographic)</option>
              <option value={10000}>1:10,000 (Settlement Overview)</option>
            </select>
          </div>

          {/* Cartographic Elements Toggles */}
          <div className="space-y-2 border-t border-slate-800 pt-3">
            <label className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
              Layout Elements
            </label>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <label className="flex items-center gap-2 p-1.5 bg-slate-950 border border-slate-800 rounded cursor-pointer text-slate-300 hover:text-white">
                <input
                  type="checkbox"
                  checked={showGraticule}
                  onChange={(e) => setShowGraticule(e.target.checked)}
                  className="rounded border-slate-700 text-blue-600 focus:ring-0"
                />
                <span>Graticule (+)</span>
              </label>
              <label className="flex items-center gap-2 p-1.5 bg-slate-950 border border-slate-800 rounded cursor-pointer text-slate-300 hover:text-white">
                <input
                  type="checkbox"
                  checked={showLegend}
                  onChange={(e) => setShowLegend(e.target.checked)}
                  className="rounded border-slate-700 text-blue-600 focus:ring-0"
                />
                <span>Legend</span>
              </label>
              <label className="flex items-center gap-2 p-1.5 bg-slate-950 border border-slate-800 rounded cursor-pointer text-slate-300 hover:text-white">
                <input
                  type="checkbox"
                  checked={showScaleBar}
                  onChange={(e) => setShowScaleBar(e.target.checked)}
                  className="rounded border-slate-700 text-blue-600 focus:ring-0"
                />
                <span>Scale Bar</span>
              </label>
              <label className="flex items-center gap-2 p-1.5 bg-slate-950 border border-slate-800 rounded cursor-pointer text-slate-300 hover:text-white">
                <input
                  type="checkbox"
                  checked={showNorthArrow}
                  onChange={(e) => setShowNorthArrow(e.target.checked)}
                  className="rounded border-slate-700 text-blue-600 focus:ring-0"
                />
                <span>North Arrow</span>
              </label>
              <label className="flex items-center gap-2 p-1.5 bg-slate-950 border border-slate-800 rounded cursor-pointer text-slate-300 hover:text-white">
                <input
                  type="checkbox"
                  checked={showCoordinateTable}
                  onChange={(e) => setShowCoordinateTable(e.target.checked)}
                  className="rounded border-slate-700 text-blue-600 focus:ring-0"
                />
                <span>Beacon Table</span>
              </label>
              <label className="flex items-center gap-2 p-1.5 bg-slate-950 border border-slate-800 rounded cursor-pointer text-slate-300 hover:text-white">
                <input
                  type="checkbox"
                  checked={showContours}
                  onChange={(e) => setShowContours(e.target.checked)}
                  className="rounded border-slate-700 text-blue-600 focus:ring-0"
                />
                <span>Contours</span>
              </label>
            </div>
          </div>

          {/* Title Block Metadata */}
          <div className="space-y-2 border-t border-slate-800 pt-3">
            <label className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
              Title Block Details
            </label>
            <div className="space-y-2 text-xs">
              <div>
                <span className="text-[10px] text-slate-400">Parcel / Project ID:</span>
                <input
                  type="text"
                  value={metadata.parcelId}
                  onChange={(e) => setMetadata((p) => ({ ...p, parcelId: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <span className="text-[10px] text-slate-400">Locality:</span>
                <input
                  type="text"
                  value={metadata.locality}
                  onChange={(e) => setMetadata((p) => ({ ...p, locality: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <span className="text-[10px] text-slate-400">Surveyor Name:</span>
                <input
                  type="text"
                  value={metadata.surveyorName}
                  onChange={(e) => setMetadata((p) => ({ ...p, surveyorName: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <span className="text-[10px] text-slate-400">Registration Number:</span>
                <input
                  type="text"
                  value={metadata.registrationNumber}
                  onChange={(e) =>
                    setMetadata((p) => ({ ...p, registrationNumber: e.target.value }))
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Export Actions */}
        <div className="p-4 border-t border-slate-800 bg-slate-950 flex flex-col gap-2">
          <button
            onClick={handleExportSvg}
            className="flex items-center justify-center gap-2 w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded font-semibold text-xs transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-blue-400" />
            <span>Export Vector SVG</span>
          </button>
          <button
            onClick={handleExportPng}
            className="flex items-center justify-center gap-2 w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded font-semibold text-xs transition cursor-pointer"
          >
            <FileImage className="w-3.5 h-3.5 text-emerald-400" />
            <span>Export 300 DPI PNG</span>
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center justify-center gap-2 w-full py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded font-bold text-xs shadow-md transition cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Layout Sheet (PDF)</span>
          </button>
        </div>
      </aside>
    </div>
  );
};
