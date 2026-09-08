import React from "react";
import { X, Download, FileCode, Globe, Map, FileSpreadsheet, Check } from "lucide-react";
import { PipelineResult } from "../types/spatial";
import { exportToDxf } from "../exporters/dxf-exporter";
import { exportToGeoJson } from "../exporters/geojson-exporter";
import { exportToLandXml } from "../exporters/landxml-exporter";
import { generateDeedPlanSvg } from "../exporters/deed-plan-svg";
import { generatePlanningAtlasSvg } from "../exporters/planning-atlas-svg";

interface ExportHubModalProps {
  result: PipelineResult;
  onClose: () => void;
}

export const ExportHubModal: React.FC<ExportHubModalProps> = ({ result, onClose }) => {
  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const titleClean = result.metadata.title.replace(/\s+/g, "_");

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 space-y-5 shadow-2xl font-['Plus_Jakarta_Sans'] text-slate-100">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-base font-bold text-white tracking-wide">EXPORT STATUTORY &amp; GIS DELIVERABLES</h2>
            <p className="text-xs text-slate-400">1-Click generation of industry-standard cadastre, CAD, and spatial schemas.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-md transition cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          {/* DXF R2018 */}
          <div className="flex items-center justify-between p-3.5 bg-slate-950 border border-slate-800 rounded-xl hover:border-slate-700 transition">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center border border-blue-500/30">
                <FileCode className="w-4 h-4" />
              </div>
              <div>
                <strong className="text-sm text-white block">AutoCAD DXF R2018</strong>
                <span className="text-xs text-slate-400">Clean layered CAD entities (Boundaries, Contours, Beacons, Setbacks).</span>
              </div>
            </div>
            <button
              onClick={() => downloadFile(exportToDxf(result), `${titleClean}_AutoCAD2018.dxf`, "application/dxf")}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-3 py-1.5 rounded-md transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </button>
          </div>

          {/* GeoJSON RFC 7946 */}
          <div className="flex items-center justify-between p-3.5 bg-slate-950 border border-slate-800 rounded-xl hover:border-slate-700 transition">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-600/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
                <Globe className="w-4 h-4" />
              </div>
              <div>
                <strong className="text-sm text-white block">GeoJSON (RFC 7946)</strong>
                <span className="text-xs text-slate-400">Standard spatial format for QGIS, ArcGIS, Mapbox, and PostGIS.</span>
              </div>
            </div>
            <button
              onClick={() => downloadFile(exportToGeoJson(result), `${titleClean}.geojson`, "application/geo+json")}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3 py-1.5 rounded-md transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </button>
          </div>

          {/* LandXML 1.2 */}
          <div className="flex items-center justify-between p-3.5 bg-slate-950 border border-slate-800 rounded-xl hover:border-slate-700 transition">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center border border-indigo-500/30">
                <Map className="w-4 h-4" />
              </div>
              <div>
                <strong className="text-sm text-white block">LandXML 1.2 Digital Cadastre</strong>
                <span className="text-xs text-slate-400">Statutory LandXML schema for electronic national land registry lodgement.</span>
              </div>
            </div>
            <button
              onClick={() => downloadFile(exportToLandXml(result), `${titleClean}_Cadastre.xml`, "application/xml")}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1.5 rounded-md transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </button>
          </div>

          {/* Form 4 Deed Plan SVG */}
          <div className="flex items-center justify-between p-3.5 bg-slate-950 border border-slate-800 rounded-xl hover:border-slate-700 transition">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-600/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <div>
                <strong className="text-sm text-white block">Form 4 Deed Plan Vector SVG</strong>
                <span className="text-xs text-slate-400">Statutory Survey Deed Plan with coordinate graticule and beacon table.</span>
              </div>
            </div>
            <button
              onClick={() => downloadFile(generateDeedPlanSvg(result), `Form4_${titleClean}.svg`, "image/svg+xml")}
              className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold px-3 py-1.5 rounded-md transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </button>
          </div>

          {/* UN-Habitat Atlas SVG */}
          <div className="flex items-center justify-between p-3.5 bg-slate-950 border border-slate-800 rounded-xl hover:border-slate-700 transition">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-sky-600/20 text-sky-400 flex items-center justify-center border border-sky-500/30">
                <Globe className="w-4 h-4" />
              </div>
              <div>
                <strong className="text-sm text-white block">UN-Habitat Planning Atlas SVG</strong>
                <span className="text-xs text-slate-400">Executive Decision Atlas with suitability choropleth &amp; hazard exposure.</span>
              </div>
            </div>
            <button
              onClick={() => downloadFile(generatePlanningAtlasSvg(result), `UN_Habitat_Atlas_${titleClean}.svg`, "image/svg+xml")}
              className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold px-3 py-1.5 rounded-md transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};