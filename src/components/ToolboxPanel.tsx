import React, { useState } from "react";
import {
  Wrench,
  Search,
  Play,
  CheckCircle,
  Clock,
  Layers,
  ChevronRight,
  Shield,
  Activity,
  Box,
  Sliders,
  Zap,
  Compass,
  X,
  Sparkles,
} from "lucide-react";
import {
  TOOLBOX_REGISTRY,
  GeoprocessingTool,
  ToolExecutionResult,
} from "../core/toolbox/registry";
import { PipelineResult } from "../types/spatial";

interface ToolboxPanelProps {
  pipeline: PipelineResult;
  onApplyToolResult?: (result: ToolExecutionResult) => void;
  onClose?: () => void;
}

export const ToolboxPanel: React.FC<ToolboxPanelProps> = ({
  pipeline,
  onApplyToolResult,
  onClose,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [activeTool, setActiveTool] = useState<GeoprocessingTool | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, any>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [executionResult, setExecutionResult] = useState<ToolExecutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Grouped Categories
  const categories = Array.from(new Set(TOOLBOX_REGISTRY.map((t) => t.category)));

  // Filtered tools
  const filteredTools = TOOLBOX_REGISTRY.filter((t) => {
    const matchesCat = selectedCategory === "all" || t.category === selectedCategory;
    if (!matchesCat) return false;
    if (!searchTerm) return true;
    const lower = searchTerm.toLowerCase();
    return (
      t.name.toLowerCase().includes(lower) ||
      t.description.toLowerCase().includes(lower) ||
      t.category.toLowerCase().includes(lower)
    );
  });

  const handleSelectTool = (tool: GeoprocessingTool) => {
    setActiveTool(tool);
    setError(null);
    setExecutionResult(null);

    // Initialize default parameters
    const initialParams: Record<string, any> = {};
    for (const p of tool.params) {
      initialParams[p.name] = p.defaultValue;
    }
    setParamValues(initialParams);
  };

  const handleRunTool = async () => {
    if (!activeTool) return;
    setIsRunning(true);
    setError(null);

    try {
      const res = await activeTool.run(pipeline, paramValues);
      setExecutionResult(res);
      if (onApplyToolResult) onApplyToolResult(res);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setIsRunning(false);
    }
  };

  const getToolIcon = (iconName: string) => {
    switch (iconName) {
      case "Shield": return <Shield className="w-4 h-4 text-emerald-400" />;
      case "Activity": return <Activity className="w-4 h-4 text-blue-400" />;
      case "Box": return <Box className="w-4 h-4 text-indigo-400" />;
      case "Sliders": return <Sliders className="w-4 h-4 text-amber-400" />;
      case "Zap": return <Zap className="w-4 h-4 text-yellow-400" />;
      case "CheckCircle": return <CheckCircle className="w-4 h-4 text-teal-400" />;
      case "Compass": return <Compass className="w-4 h-4 text-rose-400" />;
      default: return <Wrench className="w-4 h-4 text-ink-3" />;
    }
  };

  return (
    <div className="w-96 bg-panel border border-line-strong rounded-[4px] shadow-2xl flex flex-col text-xs overflow-hidden max-h-[85vh]">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-line bg-panel">
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4 text-ink-3" />
          <span className="ui-label">Geoprocessing Toolbox</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] tnum text-ink-3">
            {TOOLBOX_REGISTRY.length} tools
          </span>
          {onClose && (
            <button
              onClick={onClose}
              className="text-ink-3 hover:text-ink p-1 rounded transition cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main content: Tool List vs Tool Execution Form */}
      {!activeTool ? (
        <div className="flex flex-col flex-1 overflow-hidden p-3 space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-ink-3" />
            <input
              type="text"
              placeholder="Search tools by name, category..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="ui-input w-full pl-8"
            />
          </div>

          {/* Category Tabs */}
          <div className="flex gap-1 overflow-x-auto pb-1 text-[11px]">
            <button
              onClick={() => setSelectedCategory("all")}
              className={`px-2.5 py-1 rounded-[3px] shrink-0 transition cursor-pointer border ${
                selectedCategory === "all"
                  ? "bg-accent-dim text-accent border-accent/40 font-semibold"
                  : "bg-sunken text-ink-3 border-line hover:text-ink-2"
              }`}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded-[3px] shrink-0 transition cursor-pointer border ${
                  selectedCategory === cat
                    ? "bg-accent-dim text-accent border-accent/40 font-semibold"
                    : "bg-sunken text-ink-3 border-line hover:text-ink-2"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Tool Cards */}
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {filteredTools.map((tool) => (
              <div
                key={tool.id}
                onClick={() => handleSelectTool(tool)}
                className="bg-sunken/80 hover:bg-raised border border-line hover:border-line-strong p-2.5 rounded-[3px] transition cursor-pointer flex items-start justify-between gap-3 group"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="p-1.5 bg-panel rounded-[3px] shrink-0 mt-0.5 border border-line">
                    {getToolIcon(tool.iconName)}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-ink-2 group-hover:text-ink flex items-center gap-1.5">
                      <span>{tool.name}</span>
                    </div>
                    <p className="text-[11px] text-ink-3 line-clamp-2 mt-0.5">
                      {tool.description}
                    </p>
                    <span className="inline-block text-[9px] font-mono text-ink-3 mt-1 uppercase tracking-wider">
                      {tool.category}
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-ink-3 group-hover:text-ink shrink-0 self-center" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Active Tool Runner Form */
        <div className="flex flex-col flex-1 overflow-hidden p-4 space-y-3.5">
          {/* Back button & Title */}
          <div className="flex items-start justify-between gap-2 border-b border-line pb-2.5">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-sunken rounded-[3px] border border-line">
                {getToolIcon(activeTool.iconName)}
              </div>
              <div>
                <h4 className="font-semibold text-ink text-[13px]">{activeTool.name}</h4>
                <span className="text-[10px] text-ink-3 font-mono uppercase">
                  {activeTool.category}
                </span>
              </div>
            </div>
            <button
              onClick={() => setActiveTool(null)}
              className="text-xs text-accent hover:underline cursor-pointer"
            >
              Change Tool
            </button>
          </div>

          <p className="text-xs text-ink-2 leading-relaxed">{activeTool.description}</p>

          {/* Parameters Form */}
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {activeTool.params.length === 0 ? (
              <div className="p-3 bg-sunken/80 rounded-[3px] border border-line text-ink-3 text-xs text-center">
                This algorithm runs autonomously on the active pipeline dataset without custom arguments.
              </div>
            ) : (
              activeTool.params.map((param) => (
                <div key={param.name} className="space-y-1">
                  <label className="block text-ink-2 font-medium text-xs">
                    {param.label}
                  </label>

                  {param.type === "select" && param.options ? (
                    <select
                      value={paramValues[param.name]}
                      onChange={(e) =>
                        setParamValues({ ...paramValues, [param.name]: e.target.value })
                      }
                      className="ui-select w-full"
                    >
                      {param.options.map((opt) => (
                        <option key={opt.label} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : param.type === "number" ? (
                    <input
                      type="number"
                      value={paramValues[param.name]}
                      onChange={(e) =>
                        setParamValues({ ...paramValues, [param.name]: parseFloat(e.target.value) })
                      }
                      className="ui-input w-full"
                    />
                  ) : (
                    <input
                      type="text"
                      value={paramValues[param.name]}
                      onChange={(e) =>
                        setParamValues({ ...paramValues, [param.name]: e.target.value })
                      }
                      className="ui-input w-full"
                    />
                  )}

                  <p className="text-[10px] text-ink-3">{param.description}</p>
                </div>
              ))
            )}

            {/* Error Message */}
            {error && (
              <div className="p-2.5 bg-dt-red/10 border border-dt-red/30 rounded-[3px] text-dt-red text-xs">
                {error}
              </div>
            )}

            {/* Execution Result Box */}
            {executionResult && (
              <div className="p-3 bg-dt-green/10 border border-dt-green/30 rounded-[3px] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-dt-green flex items-center gap-1.5">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Completed
                  </span>
                  <span className="text-[10px] tnum text-dt-green/80 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {executionResult.durationMs} ms
                  </span>
                </div>
                <p className="text-[11px] text-ink-2">{executionResult.message}</p>

                {executionResult.metrics && (
                  <div className="grid grid-cols-2 gap-1.5 pt-1.5 border-t border-dt-green/20 tnum text-[10px]">
                    {Object.entries(executionResult.metrics).map(([k, v]) => (
                      <div key={k} className="bg-sunken/60 p-1.5 rounded-[3px]">
                        <span className="text-ink-3 block">{k}:</span>
                        <span className="text-ink font-medium">{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-2.5 border-t border-line">
            <button onClick={() => setActiveTool(null)} className="ui-btn">
              Back
            </button>
            <button
              onClick={handleRunTool}
              disabled={isRunning}
              className="ui-btn-accent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRunning ? (
                <>
                  <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  <span>Executing…</span>
                </>
              ) : (
                <>
                  <Play className="w-3 h-3 fill-current" />
                  <span>Run Tool</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
