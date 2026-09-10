import React, { useMemo, useState } from "react";
import { Download, Printer, FileText, ZoomIn, ZoomOut } from "lucide-react";
import { PipelineResult } from "../types/spatial";
import { renderTemplate } from "../core/composer/render";
import { form4Preset } from "../core/composer/presets";

interface DeedPlanViewerProps {
  result: PipelineResult;
}

export const DeedPlanViewer: React.FC<DeedPlanViewerProps> = ({ result }) => {
  const svgXml = useMemo(() => renderTemplate(form4Preset(), result).svg, [result]);
  const [zoomPct, setZoomPct] = useState(100);

  const handleDownloadSvg = () => {
    const blob = new Blob([svgXml], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Form4_DeedPlan_${result.metadata.title.replace(/\s+/g, "_")}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html>
        <head>
          <title>Form 4 Deed Plan - ${result.metadata.title}</title>
          <style>
            @page { size: A4 landscape; margin: 0; }
            body { margin: 0; display: flex; justify-content: center; align-items: center; }
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
    <div className="flex flex-col h-full bg-sunken">
      {/* Preview toolbar */}
      <div className="h-9 shrink-0 bg-panel border-b border-line px-3 flex items-center gap-3">
        <div className="flex items-center gap-2 text-ink-2">
          <FileText className="w-3.5 h-3.5" />
          <span className="ui-label">Statutory Deed Plan — Form No. 4 · Mutation Sheet</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Zoom control */}
          <div className="flex items-center border border-line-strong rounded-[3px] overflow-hidden h-[26px]">
            <button
              className="ui-btn-icon w-7 h-[24px] rounded-none"
              onClick={() => setZoomPct((z) => Math.max(25, z - 10))}
              title="Zoom out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="tnum text-[11px] text-ink-2 w-11 text-center border-x border-line">
              {zoomPct}%
            </span>
            <button
              className="ui-btn-icon w-7 h-[24px] rounded-none"
              onClick={() => setZoomPct((z) => Math.min(300, z + 10))}
              title="Zoom in"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <button onClick={handlePrint} className="ui-btn">
            <Printer className="w-3.5 h-3.5" />
            <span>Print to PDF</span>
          </button>
          <button onClick={handleDownloadSvg} className="ui-btn-accent">
            <Download className="w-3.5 h-3.5" />
            <span>Download SVG</span>
          </button>
        </div>
      </div>

      {/* Paper preview — sheet floats on neutral backdrop, scales with zoom */}
      <div className="flex-1 overflow-auto p-8">
        <div
          className="mx-auto bg-white shadow-[0_2px_24px_rgba(0,0,0,0.5)] border border-line-strong"
          style={{ width: `${zoomPct}%`, maxWidth: 1500 }}
        >
          {/* The exported SVG carries fixed pixel dimensions; force fluid scaling */}
          <div
            className="[&>svg]:w-full [&>svg]:h-auto [&>svg]:block"
            dangerouslySetInnerHTML={{ __html: svgXml }}
          />
        </div>
        <p className="text-center text-[11px] text-ink-3 mt-3">
          Preview scaled to fit — exported SVG retains full vector fidelity at print resolution.
        </p>
      </div>
    </div>
  );
};
