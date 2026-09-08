import React from "react";
import { X, Download, FileCode, Globe, Map, FileSpreadsheet } from "lucide-react";
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

const ExportRow: React.FC<{
  icon: React.ElementType;
  format: string;
  description: string;
  onDownload: () => void;
}> = ({ icon: Icon, format, description, onDownload }) => (
  <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line last:border-b-0 hover:bg-raised/60 transition-colors group">
    <div className="flex items-center gap-3 min-w-0">
      <div className="w-8 h-8 rounded-[3px] border border-line-strong bg-sunken flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-ink-2" />
      </div>
      <div className="min-w-0">
        <strong className="text-[13px] text-ink block font-medium">{format}</strong>
        <span className="text-[11px] text-ink-3 block truncate">{description}</span>
      </div>
    </div>
    <button onClick={onDownload} className="ui-btn shrink-0 opacity-80 group-hover:opacity-100">
      <Download className="w-3.5 h-3.5" />
      <span>Download</span>
    </button>
  </div>
);

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
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-line-strong rounded-[4px] max-w-xl w-full shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ui-panel-head">
          <div>
            <h2 className="text-[14px] font-semibold text-ink">Export deliverables</h2>
            <p className="text-[11px] text-ink-3 mt-0.5">
              Statutory cadastre, CAD and interoperable spatial schemas.
            </p>
          </div>
          <button onClick={onClose} className="ui-btn-icon" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div>
          <ExportRow
            icon={FileSpreadsheet}
            format="Form 4 Deed Plan (SVG)"
            description="Statutory mutation sheet with graticule and beacon schedule."
            onDownload={() =>
              downloadFile(generateDeedPlanSvg(result), `Form4_${titleClean}.svg`, "image/svg+xml")
            }
          />
          <ExportRow
            icon={FileCode}
            format="AutoCAD DXF R2018"
            description="Layered CAD entities — boundaries, contours, beacons, setbacks."
            onDownload={() =>
              downloadFile(exportToDxf(result), `${titleClean}_AutoCAD2018.dxf`, "application/dxf")
            }
          />
          <ExportRow
            icon={Globe}
            format="GeoJSON (RFC 7946)"
            description="Interoperable format for QGIS, ArcGIS, PostGIS pipelines."
            onDownload={() =>
              downloadFile(exportToGeoJson(result), `${titleClean}.geojson`, "application/geo+json")
            }
          />
          <ExportRow
            icon={Map}
            format="LandXML 1.2 Cadastre"
            description="Digital lodgement schema for national land registries."
            onDownload={() =>
              downloadFile(exportToLandXml(result), `${titleClean}_Cadastre.xml`, "application/xml")
            }
          />
          <ExportRow
            icon={Globe}
            format="Regional Planning Atlas (SVG)"
            description="A3 decision dossier — suitability, hazards, approval blocks."
            onDownload={() =>
              downloadFile(
                generatePlanningAtlasSvg(result),
                `Regional_Planning_Atlas_${titleClean}.svg`,
                "image/svg+xml"
              )
            }
          />
        </div>
      </div>
    </div>
  );
};
