import React, { useMemo } from "react";
import { Download, Printer } from "lucide-react";
import { PipelineResult } from "../types/spatial";
import { renderTemplate } from "../core/composer/render";
import { atlasPreset } from "../core/composer/presets";

interface PlanningAtlasViewerProps {
  result: PipelineResult;
}

export const PlanningAtlasViewer: React.FC<PlanningAtlasViewerProps> = ({ result }) => {
  const svgXml = useMemo(() => renderTemplate(atlasPreset(), result).svg, [result]);

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
        <div className="ml-auto flex items-center gap-2">
          <button onClick={handlePrint} className="ui-btn">
            <Printer className="w-3.5 h-3.5" />
            <span>Print A3</span>
          </button>
          <button onClick={handleDownloadSvg} className="ui-btn-accent">
            <Download className="w-3.5 h-3.5" />
            <span>Download SVG</span>
          </button>
        </div>
      </div>

      {/* Sheet preview */}
      <div className="flex-1 overflow-auto p-8">
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
  );
};
