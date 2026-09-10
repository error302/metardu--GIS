import React, { useState, useMemo } from "react";
import {
  Search,
  Filter,
  Plus,
  Calculator,
  Download,
  Upload,
  Trash2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CheckSquare,
  Square,
  RefreshCw,
  Code,
  Check,
  X,
  FileSpreadsheet,
} from "lucide-react";
import { PipelineResult, SurveyPoint, AttributeField } from "../types/spatial";
import {
  extractAttributeFields,
  serializePointsToCsv,
  serializePointsToGeoJson,
  parseRawSurveyText,
} from "../core/parser";
import {
  executeFieldCalculator,
  EXPRESSION_PRESETS,
  ExpressionPreset,
} from "../core/field-calculator";

interface AttributeTableProps {
  result: PipelineResult;
  selectedPointIds: string[];
  onSelectPoints: (ids: string[]) => void;
  onUpdatePoints: (points: SurveyPoint[]) => void;
  onUploadCustomSurvey: (content: string) => void;
}

export const AttributeTable: React.FC<AttributeTableProps> = ({
  result,
  selectedPointIds,
  onSelectPoints,
  onUpdatePoints,
  onUploadCustomSurvey,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortField, setSortField] = useState<string>("id");
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Dialog states
  const [showFieldCalc, setShowFieldCalc] = useState(false);
  const [showAddField, setShowAddField] = useState(false);

  // Add Field state
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<"string" | "number" | "boolean">("string");
  const [newFieldDefault, setNewFieldDefault] = useState("");

  // Field Calculator state
  const [calcTargetField, setCalcTargetField] = useState("");
  const [calcIsNew, setCalcIsNew] = useState(false);
  const [calcType, setCalcType] = useState<"string" | "number" | "boolean">("number");
  const [calcExpression, setCalcExpression] = useState("");
  const [calcOnlySelected, setCalcOnlySelected] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);

  // Inline editing cell state
  const [editingCell, setEditingCell] = useState<{ pointId: string; fieldName: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  // Dynamic field schema
  const fields = useMemo(() => extractAttributeFields(result.points), [result.points]);

  // Filtered & Sorted Points
  const filteredPoints = useMemo(() => {
    return result.points.filter((p) => {
      const matchesCategory = categoryFilter === "all" || p.category === categoryFilter;
      if (!matchesCategory) return false;

      if (!searchTerm) return true;
      const lower = searchTerm.toLowerCase();
      if (p.id.toLowerCase().includes(lower)) return true;
      if (p.rawCode.toLowerCase().includes(lower)) return true;
      if (p.description.toLowerCase().includes(lower)) return true;

      // Search inside properties
      if (p.properties) {
        for (const val of Object.values(p.properties)) {
          if (String(val).toLowerCase().includes(lower)) return true;
        }
      }
      return false;
    });
  }, [result.points, searchTerm, categoryFilter]);

  const sortedPoints = useMemo(() => {
    const sorted = [...filteredPoints];
    sorted.sort((a, b) => {
      let valA: any;
      let valB: any;

      if (sortField === "id") { valA = a.id; valB = b.id; }
      else if (sortField === "easting") { valA = a.easting; valB = b.easting; }
      else if (sortField === "northing") { valA = a.northing; valB = b.northing; }
      else if (sortField === "elevation") { valA = a.elevation; valB = b.elevation; }
      else if (sortField === "rawCode") { valA = a.rawCode; valB = b.rawCode; }
      else if (sortField === "category") { valA = a.category; valB = b.category; }
      else if (sortField === "description") { valA = a.description; valB = b.description; }
      else {
        valA = a.properties?.[sortField];
        valB = b.properties?.[sortField];
      }

      if (valA === valB) return 0;
      if (valA === undefined || valA === null) return sortAsc ? 1 : -1;
      if (valB === undefined || valB === null) return sortAsc ? -1 : 1;

      if (typeof valA === "number" && typeof valB === "number") {
        return sortAsc ? valA - valB : valB - valA;
      }
      return sortAsc
        ? String(valA).localeCompare(String(valB))
        : String(valB).localeCompare(String(valA));
    });
    return sorted;
  }, [filteredPoints, sortField, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(sortedPoints.length / pageSize));
  const currentPagePoints = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedPoints.slice(start, start + pageSize);
  }, [sortedPoints, page]);

  // Selection handlers
  const isAllPageSelected =
    currentPagePoints.length > 0 &&
    currentPagePoints.every((p) => selectedPointIds.includes(p.id));

  const handleToggleSelectAll = () => {
    if (isAllPageSelected) {
      const pageIds = new Set(currentPagePoints.map((p) => p.id));
      onSelectPoints(selectedPointIds.filter((id) => !pageIds.has(id)));
    } else {
      const union = new Set([...selectedPointIds, ...currentPagePoints.map((p) => p.id)]);
      onSelectPoints(Array.from(union));
    }
  };

  const handleToggleRow = (id: string) => {
    if (selectedPointIds.includes(id)) {
      onSelectPoints(selectedPointIds.filter((i) => i !== id));
    } else {
      onSelectPoints([...selectedPointIds, id]);
    }
  };

  const handleSort = (fieldName: string) => {
    if (sortField === fieldName) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(fieldName);
      setSortAsc(true);
    }
  };

  // Add Column / Field
  const handleAddFieldSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newFieldName.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
    if (!cleanName) return;

    let defaultVal: any = newFieldDefault;
    if (newFieldType === "number") defaultVal = Number(newFieldDefault) || 0;
    if (newFieldType === "boolean") defaultVal = newFieldDefault.toLowerCase() === "true";

    const updated = result.points.map((p) => ({
      ...p,
      properties: {
        ...(p.properties || {}),
        [cleanName]: defaultVal,
      },
    }));

    onUpdatePoints(updated);
    setNewFieldName("");
    setNewFieldDefault("");
    setShowAddField(false);
  };

  // Delete Column
  const handleDeleteField = (fieldName: string) => {
    if (["id", "easting", "northing", "elevation", "rawCode", "category", "description"].includes(fieldName)) {
      return;
    }
    const updated = result.points.map((p) => {
      if (!p.properties) return p;
      const copy = { ...p.properties };
      delete copy[fieldName];
      return { ...p, properties: copy };
    });
    onUpdatePoints(updated);
  };

  // Inline Cell Editing
  const handleStartEdit = (pointId: string, fieldName: string, currentVal: any) => {
    setEditingCell({ pointId, fieldName });
    setEditValue(currentVal !== undefined && currentVal !== null ? String(currentVal) : "");
  };

  const handleSaveEdit = () => {
    if (!editingCell) return;
    const { pointId, fieldName } = editingCell;

    const updated = result.points.map((p) => {
      if (p.id !== pointId) return p;

      const isCore = ["rawCode", "elevation", "description"].includes(fieldName);
      if (isCore) {
        if (fieldName === "rawCode") return { ...p, rawCode: editValue };
        if (fieldName === "elevation") return { ...p, elevation: Number(editValue) || p.elevation };
        if (fieldName === "description") return { ...p, description: editValue };
      }

      // Check field type from schema
      const fieldDef = fields.find((f) => f.name === fieldName);
      let parsedVal: any = editValue;
      if (fieldDef?.type === "number") {
        parsedVal = Number(editValue);
        if (isNaN(parsedVal)) parsedVal = 0;
      } else if (fieldDef?.type === "boolean") {
        parsedVal = editValue.toLowerCase() === "true" || editValue === "1";
      }

      return {
        ...p,
        properties: {
          ...(p.properties || {}),
          [fieldName]: parsedVal,
        },
      };
    });

    onUpdatePoints(updated);
    setEditingCell(null);
  };

  // Field Calculator Apply
  const handleApplyFieldCalc = () => {
    setCalcError(null);
    const targetName = calcTargetField.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
    if (!targetName) {
      setCalcError("Please specify a target field name.");
      return;
    }
    if (!calcExpression.trim()) {
      setCalcError("Expression cannot be empty.");
      return;
    }

    const calcResult = executeFieldCalculator(result.points, {
      fieldName: targetName,
      isNewField: calcIsNew,
      fieldType: calcType,
      expression: calcExpression,
      targetPointIds: calcOnlySelected ? selectedPointIds : undefined,
    });

    if (calcResult.error) {
      setCalcError(calcResult.error);
      return;
    }

    onUpdatePoints(calcResult.updatedPoints);
    setShowFieldCalc(false);
  };

  // Preset Selection for Field Calculator
  const handleSelectPreset = (preset: ExpressionPreset) => {
    setCalcTargetField(preset.targetField);
    setCalcType(preset.fieldType);
    setCalcExpression(preset.expression);
  };

  // Exports
  const handleExportCsv = () => {
    const csv = serializePointsToCsv(result.points);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `AttributeTable_${result.metadata.title.replace(/\s+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportGeoJson = () => {
    const geo = serializePointsToGeoJson(result.points, result.metadata.crs);
    const blob = new Blob([geo], { type: "application/geo+json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `AttributeTable_${result.metadata.title.replace(/\s+/g, "_")}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  };

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

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-3 text-ink h-full flex flex-col">
      {/* Top Application Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-panel border border-line p-3 rounded-[4px] shadow-lg">
        {/* Left: Search & Filter */}
        <div className="flex items-center gap-2.5 flex-1 min-w-[280px]">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-ink-2" />
            <input
              type="text"
              placeholder="Search station, code, attributes..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              className="w-full bg-sunken border border-line rounded-[3px] pl-9 pr-3 py-1.5 text-xs text-ink placeholder-ink-3 focus:outline-none focus:border-accent font-mono"
            />
          </div>

          <div className="flex items-center gap-1.5 text-xs text-ink-2">
            <Filter className="w-3.5 h-3.5" />
            <select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setPage(1);
              }}
              className="bg-sunken border border-line rounded-[3px] px-2.5 py-1.5 text-xs text-ink focus:outline-none cursor-pointer"
            >
              <option value="all">All Categories ({result.points.length})</option>
              <option value="boundary">Boundary Beacons</option>
              <option value="road">Road &amp; Transport</option>
              <option value="water">Hydrology &amp; Riparian</option>
              <option value="building">Structures &amp; Buildings</option>
              <option value="settlement">Settlements &amp; Social</option>
              <option value="terrain">Topographic Spot Levels</option>
              <option value="control">Control &amp; Benchmarks</option>
              <option value="utility">Utilities &amp; Power</option>
              <option value="energy">Energy Facilities</option>
            </select>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => {
              setCalcTargetField("");
              setCalcExpression("");
              setCalcError(null);
              setShowFieldCalc(true);
            }}
            className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover text-ink px-3 py-1.5 rounded-[3px] text-xs font-semibold shadow-md shadow transition cursor-pointer"
            title="Open GIS Field Calculator ($x, $y, $z, expressions)"
          >
            <Calculator className="w-3.5 h-3.5" />
            <span>Field Calculator</span>
          </button>

          <button
            onClick={() => setShowAddField(true)}
            className="flex items-center gap-1.5 bg-raised hover:bg-raised text-ink border border-line-strong px-3 py-1.5 rounded-[3px] text-xs font-semibold transition cursor-pointer"
            title="Add a new attribute column"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Field</span>
          </button>

          <label className="flex items-center gap-1.5 bg-raised hover:bg-raised text-ink border border-line-strong px-3 py-1.5 rounded-[3px] text-xs font-semibold cursor-pointer transition">
            <Upload className="w-3.5 h-3.5" />
            <span>Import CSV / GSI / KML</span>
            <input type="file" accept=".csv,.txt,.gsi,.geojson,.kml" onChange={handleFileUpload} className="hidden" />
          </label>

          <div className="flex items-center gap-1">
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-1 bg-raised hover:bg-raised text-ink border border-line-strong px-2.5 py-1.5 rounded-[3px] text-xs font-semibold transition cursor-pointer"
              title="Export Attribute Table to CSV"
            >
              <Download className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>
            <button
              onClick={handleExportGeoJson}
              className="flex items-center gap-1 bg-raised hover:bg-raised text-ink border border-line-strong px-2.5 py-1.5 rounded-[3px] text-xs font-semibold transition cursor-pointer"
              title="Export FeatureCollection to GeoJSON"
            >
              <Download className="w-3.5 h-3.5" />
              <span>GeoJSON</span>
            </button>
          </div>
        </div>
      </div>

      {/* Sub-Header Status Bar */}
      <div className="flex items-center justify-between px-2 text-[11px] text-ink-2 font-mono">
        <div className="flex items-center gap-4">
          <span>Total Features: <strong className="text-ink">{result.points.length}</strong></span>
          <span>Filtered: <strong className="text-ink">{filteredPoints.length}</strong></span>
          <span>
            Selected:{" "}
            <strong className={selectedPointIds.length > 0 ? "text-accent" : "text-ink-2"}>
              {selectedPointIds.length}
            </strong>
          </span>
          {selectedPointIds.length > 0 && (
            <button
              onClick={() => onSelectPoints([])}
              className="text-xs text-dt-blue hover:underline cursor-pointer font-sans"
            >
              Clear Selection
            </button>
          )}
        </div>
        <div>
          <span>CRS: <strong className="text-dt-blue">{result.metadata.crs}</strong></span>
        </div>
      </div>

      {/* Table Container */}
      <div className="flex-1 bg-panel border border-line rounded-[4px] overflow-hidden shadow-2xl flex flex-col">
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-sunken sticky top-0 z-10 border-b border-line text-[11px] font-semibold text-ink-2">
              <tr>
                {/* Select All Checkbox */}
                <th className="p-2.5 w-10 text-center border-r border-line">
                  <button onClick={handleToggleSelectAll} className="cursor-pointer text-ink-2 hover:text-ink">
                    {isAllPageSelected ? (
                      <CheckSquare className="w-4 h-4 text-accent" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </th>

                {/* Columns */}
                {fields.map((f) => {
                  const isCore = ["id", "easting", "northing", "elevation", "rawCode", "category", "description"].includes(f.name);
                  const isSorted = sortField === f.name;

                  return (
                    <th
                      key={f.name}
                      className="p-2.5 border-r border-line whitespace-nowrap group"
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <button
                          onClick={() => handleSort(f.name)}
                          className="flex items-center gap-1 hover:text-ink text-left font-mono"
                        >
                          <span>{f.alias || f.name}</span>
                          <span className="text-[9px] text-ink-3 font-sans uppercase">({f.type[0]})</span>
                          {isSorted ? (
                            sortAsc ? <ArrowUp className="w-3 h-3 text-dt-blue" /> : <ArrowDown className="w-3 h-3 text-dt-blue" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-60" />
                          )}
                        </button>

                        {!isCore && (
                          <button
                            onClick={() => handleDeleteField(f.name)}
                            className="text-ink-3 hover:text-dt-red p-0.5 rounded opacity-0 group-hover:opacity-100 transition"
                            title={`Delete field "${f.name}"`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody className="divide-y divide-line font-mono text-[11px]">
              {currentPagePoints.map((pt) => {
                const isSelected = selectedPointIds.includes(pt.id);

                return (
                  <tr
                    key={pt.id}
                    className={`transition ${
                      isSelected
                        ? "bg-amber-500/15 hover:bg-accent-dim"
                        : "hover:bg-raised/60 odd:bg-panel/50"
                    }`}
                  >
                    {/* Row Checkbox */}
                    <td className="p-2 text-center border-r border-line">
                      <button onClick={() => handleToggleRow(pt.id)} className="cursor-pointer">
                        {isSelected ? (
                          <CheckSquare className="w-3.5 h-3.5 text-accent" />
                        ) : (
                          <Square className="w-3.5 h-3.5 text-ink-3 hover:text-ink-2" />
                        )}
                      </button>
                    </td>

                    {/* Data Cells */}
                    {fields.map((f) => {
                      let cellVal: any;
                      if (f.name === "id") cellVal = pt.id;
                      else if (f.name === "easting") cellVal = pt.easting.toFixed(3);
                      else if (f.name === "northing") cellVal = pt.northing.toFixed(3);
                      else if (f.name === "elevation") cellVal = pt.elevation.toFixed(3);
                      else if (f.name === "rawCode") cellVal = pt.rawCode;
                      else if (f.name === "category") cellVal = pt.category;
                      else if (f.name === "description") cellVal = pt.description;
                      else cellVal = pt.properties?.[f.name];

                      const isEditing = editingCell?.pointId === pt.id && editingCell?.fieldName === f.name;

                      return (
                        <td
                          key={f.name}
                          onDoubleClick={() => handleStartEdit(pt.id, f.name, cellVal)}
                          className="p-2 border-r border-line whitespace-nowrap text-ink-2"
                        >
                          {isEditing ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={editValue}
                                autoFocus
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleSaveEdit();
                                  if (e.key === "Escape") setEditingCell(null);
                                }}
                                className="bg-sunken border border-accent px-1.5 py-0.5 rounded text-ink text-xs w-28 focus:outline-none"
                              />
                              <button onClick={handleSaveEdit} className="text-dt-green hover:text-dt-green">
                                <Check className="w-3 h-3" />
                              </button>
                              <button onClick={() => setEditingCell(null)} className="text-ink-3 hover:text-ink-2">
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <span
                              title="Double click to edit"
                              className="cursor-text block min-w-[20px]"
                            >
                              {cellVal !== undefined && cellVal !== null ? String(cellVal) : (
                                <span className="text-ink-3 italic">null</span>
                              )}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              {currentPagePoints.length === 0 && (
                <tr>
                  <td colSpan={fields.length + 1} className="p-8 text-center text-ink-3">
                    No features match current search and category criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="bg-sunken border-t border-line px-4 py-2 flex items-center justify-between text-xs text-ink-2">
          <div>
            Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, sortedPoints.length)} of {sortedPoints.length} features
          </div>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-2.5 py-1 bg-panel border border-line rounded disabled:opacity-40 hover:bg-raised transition cursor-pointer"
            >
              Previous
            </button>
            <span className="font-mono text-ink">
              {page} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-2.5 py-1 bg-panel border border-line rounded disabled:opacity-40 hover:bg-raised transition cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* ── Add Field Dialog ── */}
      {showAddField && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-panel border border-line rounded-[4px] p-5 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="font-bold text-ink text-sm tracking-wide flex items-center gap-2">
                <Plus className="w-4 h-4 text-dt-blue" />
                Add New Attribute Field
              </h3>
              <button onClick={() => setShowAddField(false)} className="text-ink-2 hover:text-ink">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddFieldSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-ink-2 font-semibold mb-1">Field Name</label>
                <input
                  type="text"
                  placeholder="e.g. soil_type, parcel_owner, voltage_kv"
                  value={newFieldName}
                  onChange={(e) => setNewFieldName(e.target.value)}
                  className="w-full bg-sunken border border-line rounded-[3px] px-3 py-2 text-ink placeholder-ink-3 focus:outline-none focus:border-accent font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-ink-2 font-semibold mb-1">Field Type</label>
                <select
                  value={newFieldType}
                  onChange={(e) => setNewFieldType(e.target.value as any)}
                  className="w-full bg-sunken border border-line rounded-[3px] px-3 py-2 text-ink focus:outline-none cursor-pointer"
                >
                  <option value="string">String (Text)</option>
                  <option value="number">Number (Integer / Real)</option>
                  <option value="boolean">Boolean (True / False)</option>
                </select>
              </div>

              <div>
                <label className="block text-ink-2 font-semibold mb-1">Default Initial Value</label>
                <input
                  type="text"
                  placeholder="Optional default value"
                  value={newFieldDefault}
                  onChange={(e) => setNewFieldDefault(e.target.value)}
                  className="w-full bg-sunken border border-line rounded-[3px] px-3 py-2 text-ink placeholder-ink-3 focus:outline-none focus:border-accent font-mono"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-line">
                <button
                  type="button"
                  onClick={() => setShowAddField(false)}
                  className="px-3 py-1.5 bg-raised hover:bg-raised text-ink-2 rounded-[3px] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-ink font-semibold rounded-[3px] shadow-md shadow transition cursor-pointer"
                >
                  Add Field
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── GIS Field Calculator Dialog ── */}
      {showFieldCalc && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-panel border border-line rounded-[4px] p-5 max-w-2xl w-full shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="font-bold text-ink text-base tracking-wide flex items-center gap-2">
                  <Calculator className="w-5 h-5 text-dt-blue" />
                  GIS Field Calculator
                </h3>
                <p className="text-xs text-ink-2">
                  Compute geometric, spatial, arithmetic and string attributes across dataset features.
                </p>
              </div>
              <button onClick={() => setShowFieldCalc(false)} className="text-ink-2 hover:text-ink">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Target Field Settings */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-sunken p-3 rounded-[3px] border border-line">
              <div>
                <label className="block text-ink-2 text-xs font-semibold mb-1">Target Field Name</label>
                <input
                  type="text"
                  placeholder="e.g. easting_km, label"
                  value={calcTargetField}
                  onChange={(e) => setCalcTargetField(e.target.value)}
                  className="w-full bg-panel border border-line rounded px-2.5 py-1.5 text-xs text-ink placeholder-ink-3 focus:outline-none focus:border-accent font-mono"
                />
              </div>

              <div>
                <label className="block text-ink-2 text-xs font-semibold mb-1">Output Type</label>
                <select
                  value={calcType}
                  onChange={(e) => setCalcType(e.target.value as any)}
                  className="w-full bg-panel border border-line rounded px-2.5 py-1.5 text-xs text-ink focus:outline-none cursor-pointer"
                >
                  <option value="number">Number</option>
                  <option value="string">String</option>
                  <option value="boolean">Boolean</option>
                </select>
              </div>

              <div className="flex flex-col justify-end">
                <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={calcOnlySelected}
                    onChange={(e) => setCalcOnlySelected(e.target.checked)}
                    className="rounded border-line-strong text-accent focus:ring-0 cursor-pointer"
                  />
                  <span>Only update selected ({selectedPointIds.length})</span>
                </label>
              </div>
            </div>

            {/* Expression Presets */}
            <div>
              <span className="block text-xs font-semibold text-ink-2 mb-1.5 uppercase tracking-wider">
                Common Expression Presets
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {EXPRESSION_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectPreset(p)}
                    className="text-left bg-sunken hover:bg-raised border border-line hover:border-accent/50 p-2 rounded text-xs transition cursor-pointer group"
                  >
                    <div className="font-semibold text-ink group-hover:text-dt-blue">{p.label}</div>
                    <div className="text-[10px] text-ink-3 font-mono truncate">{p.expression}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Expression Editor */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <label className="font-semibold text-ink-2">Expression</label>
                <span className="text-[11px] text-ink-3 font-mono">
                  Tokens: $x, $y, $z, $id, $code, $cat, $lat, $lon
                </span>
              </div>
              <textarea
                rows={3}
                placeholder="e.g. round($x / 1000, 3) or concat($id, ' - ', upper($code))"
                value={calcExpression}
                onChange={(e) => setCalcExpression(e.target.value)}
                className="w-full bg-sunken border border-line rounded-[3px] p-2.5 text-xs text-ink placeholder-ink-3 focus:outline-none focus:border-accent font-mono resize-none"
              />
            </div>

            {/* Function Helper Bar */}
            <div className="bg-sunken/50 p-2.5 rounded border border-line text-[11px] text-ink-2 space-y-1 font-mono">
              <div className="font-bold text-ink-2">Supported Functions:</div>
              <div className="grid grid-cols-2 gap-1 text-[10px]">
                <div>round(val, decimals), floor(x), ceil(x), sqrt(x), pow(x, y)</div>
                <div>concat(s1, s2, ...), upper(s), lower(s), trim(s), substr(s, start, len)</div>
                <div>if(condition, thenValue, elseValue)</div>
                <div>[existing_column_name] or direct field name</div>
              </div>
            </div>

            {calcError && (
              <div className="p-2.5 bg-dt-red/10 border border-dt-red/30 rounded text-dt-red text-xs">
                {calcError}
              </div>
            )}

            {/* Footer Buttons */}
            <div className="flex items-center justify-between pt-2 border-t border-line">
              <span className="text-[11px] text-ink-3">
                Target: {calcOnlySelected ? `${selectedPointIds.length} selected features` : `${result.points.length} features`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowFieldCalc(false)}
                  className="px-3 py-1.5 bg-raised hover:bg-raised text-ink-2 rounded-[3px] text-xs transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApplyFieldCalc}
                  className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-ink font-semibold rounded-[3px] text-xs shadow-md shadow transition cursor-pointer"
                >
                  Calculate &amp; Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
