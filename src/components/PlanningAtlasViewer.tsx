import React, { useMemo } from "react";
import { Download, Printer, Globe } from "lucide-react";
import { PipelineResult } from "../types/spatial";
import { generatePlanningAtlasSvg } from "../exporters/planning-atlas-svg";

interface PlanningAtlasViewerProps {
  result: PipelineResult;
}

export const PlanningAtlasViewer: React.FC<PlanningAtlasViewerProps> = ({ result }) => {
  const svgXml = useMemo(() => generatePlanningAtlasSvg(result), [result]);

  const handleDownloadSvg = () => {
    const blob = new Blob([svgXml], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Regional_Planning_Atlas_${result.metadata.title.replace(/\s+/g, "_")}.svg`;
    a.click();
    URL.revokeObjectURL(url);
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
            body { margin: 0; background: #0B0F17; display: flex; justify-content: center; align-items: center; }
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
    <div className="flex flex-col h-[calc(100vh-125px)] bg-slate-950 text-slate-100">
      {/* Top Action Ribbon */}
      <div className="bg-slate-900 border-b border-slate-800 px-6 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-sky-400" />
          <span className="font-bold text-xs text-white uppercase tracking-wider font-['Plus_Jakarta_Sans']">
            REGIONAL GIS PLANNING ATLAS — SETTLEMENT &amp; HAZARD DECISION DOSSIER
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-3 py-1.5 rounded-md border border-slate-700 transition cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print to PDF (A3)</span>
          </button>
          <button
            onClick={handleDownloadSvg}
            className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold px-3 py-1.5 rounded-md transition cursor-pointer shadow-md shadow-sky-500/20"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Vector SVG</span>
          </button>
        </div>
      </div>

      {/* SVG Canvas Container */}
      <div className="flex-1 overflow-auto p-6 flex justify-center items-center bg-[#070A10]">
        <div
          className="shadow-2xl rounded-lg overflow-hidden bg-[#0F172A] max-w-5xl w-full border border-slate-800"
          dangerouslySetInnerHTML={{ __html: svgXml }}
        />
      </div>
    </div>
  );
};