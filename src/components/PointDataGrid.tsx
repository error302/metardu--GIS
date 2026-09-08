import React, { useState } from "react";
import { Search, Upload, Plus, Download, Filter, MapPin } from "lucide-react";
import { PipelineResult, SurveyPoint } from "../types/spatial";

interface PointDataGridProps {
  result: PipelineResult;
  onUploadCustomSurvey: (content: string) => void;
  onUpdatePoints: (points: SurveyPoint[]) => void;
}

export const PointDataGrid: React.FC<PointDataGridProps> = ({
  result,
  onUploadCustomSurvey,
  onUpdatePoints,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const filteredPoints = result.points.filter((p) => {
    const matchesSearch =
      p.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.rawCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.description.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCategory = categoryFilter === "all" || p.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (text) onUploadCustomSurvey(text);
    };
    reader.readAsText(file);
  };

  const handleExportCsv = () => {
    const headers = "ID,Easting,Northing,ElevationMSL,Code,Category,Latitude,Longitude,Description\n";
    const rows = result.points
      .map(
        (p) =>
          `${p.id},${p.easting},${p.northing},${p.elevation},${p.rawCode},${p.category},${p.latitude || ""},${p.longitude || ""},"${p.description}"`
      )
      .join("\n");

    const blob = new Blob([headers + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `SurveyPoints_${result.metadata.title.replace(/\s+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4 text-slate-100 h-[calc(100vh-125px)] flex flex-col">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-3 rounded-xl">
        <div className="flex items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search station, code, or description..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-md pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Filter className="w-3.5 h-3.5" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-white focus:outline-none cursor-pointer"
            >
              <option value="all">All Categories ({result.points.length})</option>
              <option value="boundary">Boundary Beacons</option>
              <option value="road">Road &amp; Transport</option>
              <option value="water">Hydrology &amp; Riparian</option>
              <option value="building">Structures &amp; Buildings</option>
              <option value="settlement">Settlements &amp; Social</option>
              <option value="terrain">Topographic Spot Levels</option>
              <option value="control">Control &amp; Benchmarks</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition">
            <Upload className="w-3.5 h-3.5" />
            <span>Upload CSV / GSI</span>
            <input type="file" accept=".csv,.txt,.gsi,.geojson" onChange={handleFileUpload} className="hidden" />
          </label>

          <button
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition shadow-md shadow-blue-500/20"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Points Data Table */}
      <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 font-semibold sticky top-0 z-10">
              <tr>
                <th className="p-3">Station ID</th>
                <th className="p-3">Easting (m)</th>
                <th className="p-3">Northing (m)</th>
                <th className="p-3">MSL Elev (m)</th>
                <th className="p-3">Ellipsoid h</th>
                <th className="p-3">Geoid N</th>
                <th className="p-3">Code</th>
                <th className="p-3">Category</th>
                <th className="p-3">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {filteredPoints.map((p) => (
                <tr key={p.id} className="hover:bg-slate-800/50">
                  <td className="p-3 font-bold text-white flex items-center gap-1.5 font-sans">
                    <MapPin className="w-3 h-3 text-blue-400" />
                    <span>{p.id}</span>
                  </td>
                  <td className="p-3">{p.easting.toLocaleString()}</td>
                  <td className="p-3">{p.northing.toLocaleString()}</td>
                  <td className="p-3 text-emerald-400 font-bold">{p.elevation.toFixed(2)}m</td>
                  <td className="p-3 text-slate-400">{(p.ellipsoidHeight || p.elevation).toFixed(2)}m</td>
                  <td className="p-3 text-slate-400">{p.geoidN ? `${p.geoidN}m` : "-18.5m"}</td>
                  <td className="p-3 font-sans">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 border border-slate-700 text-white">
                      {p.rawCode}
                    </span>
                  </td>
                  <td className="p-3 capitalize font-sans text-slate-400">{p.category}</td>
                  <td className="p-3 font-sans text-slate-400">{p.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};