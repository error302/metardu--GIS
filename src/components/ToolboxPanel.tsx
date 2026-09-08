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
      default: return <Wrench className="w-4 h-4 text-slate-400" />;
    }
  };

  return (
    <div className="w-96 bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-xl shadow-2xl flex flex-col font-['Plus_Jakarta_Sans'] text-xs select-none overflow-hidden max-h-[85vh]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-950 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4 text-blue-400" />
          <span className="font-bold text-white tracking-wide">GEOPROCESSING TOOLBOX</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 font-mono">
            {TOOLBOX_REGISTRY.length} tools
          </span>
          {onClose && (
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded transition cursor-pointer"
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
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search tools by name, category..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-md pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
            />
          </div>

          {/* Category Tabs */}
          <div className="flex gap-1 overflow-x-auto pb-1 text-[11px]">
            <button
              onClick={() => setSelectedCategory("all")}
              className={`px-2.5 py-1 rounded-md shrink-0 transition cursor-pointer ${
                selectedCategory === "all"
                  ? "bg-blue-600/20 text-blue-400 border border-blue-500/30 font-semibold"
                  : "bg-slate-950 text-slate-400 hover:text-white"
              }`}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded-md shrink-0 transition cursor-pointer ${
                  selectedCategory === cat
                    ? "bg-blue-600/20 text-blue-400 border border-blue-500/30 font-semibold"
                    : "bg-slate-950 text-slate-400 hover:text-white"
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
                className="bg-slate-950/70 hover:bg-slate-800/80 border border-slate-800/80 hover:border-blue-500/40 p-2.5 rounded-lg transition cursor-pointer flex items-start justify-between gap-3 group"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="p-1.5 bg-slate-900 rounded-md shrink-0 mt-0.5 border border-slate-800">
                    {getToolIcon(tool.iconName)}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-200 group-hover:text-blue-400 flex items-center gap-1.5">
                      <span>{tool.name}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-2 mt-0.5">
                      {tool.description}
                    </p>
                    <span className="inline-block text-[9px] font-mono text-slate-500 mt-1 uppercase tracking-wider">
                      {tool.category}
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-blue-400 shrink-0 self-center" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Active Tool Runner Form */
        <div className="flex flex-col flex-1 overflow-hidden p-4 space-y-3.5">
          {/* Back button & Title */}
          <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-2.5">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-slate-950 rounded-md border border-slate-800">
                {getToolIcon(activeTool.iconName)}
              </div>
              <div>
                <h4 className="font-bold text-white text-sm">{activeTool.name}</h4>
                <span className="text-[10px] text-slate-500 font-mono uppercase">
                  {activeTool.category}
                </span>
              </div>
            </div>
            <button
              onClick={() => setActiveTool(null)}
              className="text-xs text-blue-400 hover:underline cursor-pointer"
            >
              Change Tool
            </button>
          </div>

          <p className="text-xs text-slate-300">{activeTool.description}</p>

          {/* Parameters Form */}
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {activeTool.params.length === 0 ? (
              <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 text-slate-400 text-xs text-center">
                This algorithm runs autonomously on the active pipeline dataset without custom arguments.
              </div>
            ) : (
              activeTool.params.map((param) => (
                <div key={param.name} className="space-y-1">
                  <label className="block text-slate-300 font-semibold text-xs">
                    {param.label}
                  </label>

                  {param.type === "select" && param.options ? (
                    <select
                      value={paramValues[param.name]}
                      onChange={(e) =>
                        setParamValues({ ...paramValues, [param.name]: e.target.value })
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
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
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                    />
                  ) : (
                    <input
                      type="text"
                      value={paramValues[param.name]}
                      onChange={(e) =>
                        setParamValues({ ...paramValues, [param.name]: e.target.value })
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  )}

                  <p className="text-[10px] text-slate-500">{param.description}</p>
                </div>
              ))
            )}

            {/* Error Message */}
            {error && (
              <div className="p-2.5 bg-rose-500/15 border border-rose-500/30 rounded text-rose-400 text-xs">
                {error}
              </div>
            )}

            {/* Execution Result Box */}
            {executionResult && (
              <div className="p-3 bg-emerald-950/40 border border-emerald-500/30 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Completed Successfully
                  </span>
                  <span className="text-[10px] font-mono text-emerald-300/80 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {executionResult.durationMs} ms
                  </span>
                </div>
                <p className="text-[11px] text-slate-300">{executionResult.message}</p>

                {executionResult.metrics && (
                  <div className="grid grid-cols-2 gap-1.5 pt-1.5 border-t border-emerald-800/40 font-mono text-[10px]">
                    {Object.entries(executionResult.metrics).map(([k, v]) => (
                      <div key={k} className="bg-slate-900/60 p-1.5 rounded">
                        <span className="text-slate-500 block">{k}:</span>
                        <span className="text-white font-bold">{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-800">
            <button
              onClick={() => setActiveTool(null)}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md transition cursor-pointer text-xs"
            >
              Back
            </button>
            <button
              onClick={handleRunTool}
              disabled={isRunning}
              className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold px-4 py-1.5 rounded-md shadow-md shadow-blue-600/30 transition disabled:opacity-50 cursor-pointer text-xs"
            >
              {isRunning ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>EXECUTING...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>RUN TOOL</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
