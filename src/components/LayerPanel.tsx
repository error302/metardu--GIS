import React, { useState } from "react";
import {
  Layers,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  Sliders,
  Maximize2,
  X,
  Palette,
  Check,
} from "lucide-react";
import { LayerItem, moveLayer } from "../core/layer-store";
import { SymbolStyle } from "../core/symbology";

interface LayerPanelProps {
  layers: LayerItem[];
  onChangeLayers: (layers: LayerItem[]) => void;
  onZoomToLayer?: (layerId: string) => void;
  onClose?: () => void;
}

export const LayerPanel: React.FC<LayerPanelProps> = ({
  layers,
  onChangeLayers,
  onZoomToLayer,
  onClose,
}) => {
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [editingSymbologyLayer, setEditingSymbologyLayer] = useState<LayerItem | null>(null);

  const handleToggleVisible = (id: string) => {
    onChangeLayers(
      layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l))
    );
  };

  const handleOpacityChange = (id: string, opacity: number) => {
    onChangeLayers(
      layers.map((l) => (l.id === id ? { ...l, opacity } : l))
    );
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    onChangeLayers(moveLayer(layers, index, index - 1));
  };

  const handleMoveDown = (index: number) => {
    if (index === layers.length - 1) return;
    onChangeLayers(moveLayer(layers, index, index + 1));
  };

  const handleUpdateStyle = (layerId: string, newStyle: Partial<SymbolStyle>) => {
    onChangeLayers(
      layers.map((l) => {
        if (l.id !== layerId) return l;
        return {
          ...l,
          symbology: {
            ...l.symbology,
            defaultStyle: {
              ...l.symbology.defaultStyle,
              ...newStyle,
            },
          },
        };
      })
    );
    if (editingSymbologyLayer && editingSymbologyLayer.id === layerId) {
      setEditingSymbologyLayer((prev) =>
        prev
          ? {
              ...prev,
              symbology: {
                ...prev.symbology,
                defaultStyle: {
                  ...prev.symbology.defaultStyle,
                  ...newStyle,
                },
              },
            }
          : null
      );
    }
  };

  return (
    <div className="w-80 bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-xl shadow-2xl flex flex-col font-['Plus_Jakarta_Sans'] text-xs select-none overflow-hidden max-h-[85vh]">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-blue-400" />
          <span className="font-bold text-white tracking-wide">LAYERS &amp; SYMBOLOGY</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-slate-500 font-mono">
            {layers.filter((l) => l.visible).length}/{layers.length} active
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

      {/* Layer List (Ordered by z-index top to bottom) */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60 p-1 space-y-0.5">
        {layers.map((layer, index) => {
          const isSelected = selectedLayerId === layer.id;
          const defaultColor = layer.symbology.defaultStyle.color || "#3B82F6";

          return (
            <div
              key={layer.id}
              onClick={() => setSelectedLayerId(layer.id)}
              className={`p-2 rounded-lg transition flex flex-col gap-1.5 cursor-pointer ${
                isSelected
                  ? "bg-slate-800/80 border border-slate-700"
                  : "hover:bg-slate-800/40 border border-transparent"
              }`}
            >
              {/* Row 1: Visibility, Color Swatch, Layer Name, Reorder Controls */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {/* Visibility Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleVisible(layer.id);
                    }}
                    className={`p-1 rounded transition cursor-pointer ${
                      layer.visible
                        ? "text-blue-400 hover:text-blue-300"
                        : "text-slate-600 hover:text-slate-400"
                    }`}
                    title={layer.visible ? "Hide Layer" : "Show Layer"}
                  >
                    {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>

                  {/* Symbology Color Swatch */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingSymbologyLayer(layer);
                    }}
                    style={{ backgroundColor: defaultColor }}
                    className="w-3.5 h-3.5 rounded shadow-sm border border-white/20 shrink-0 cursor-pointer hover:scale-110 transition"
                    title="Click to edit layer styling"
                  />

                  {/* Layer Name */}
                  <span
                    className={`font-semibold truncate text-[11px] ${
                      layer.visible ? "text-slate-200" : "text-slate-500 line-through"
                    }`}
                  >
                    {layer.name}
                  </span>
                </div>

                {/* Layer Quick Actions (Up/Down/Palette) */}
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    disabled={index === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMoveUp(index);
                    }}
                    className="p-1 text-slate-400 hover:text-white disabled:opacity-20 transition cursor-pointer"
                    title="Move Layer Up"
                  >
                    <ChevronUp className="w-3 h-3" />
                  </button>

                  <button
                    disabled={index === layers.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMoveDown(index);
                    }}
                    className="p-1 text-slate-400 hover:text-white disabled:opacity-20 transition cursor-pointer"
                    title="Move Layer Down"
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingSymbologyLayer(layer);
                    }}
                    className="p-1 text-slate-400 hover:text-blue-400 transition cursor-pointer"
                    title="Layer Symbology &amp; Style"
                  >
                    <Palette className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Categorized Rules Sub-Legend (if categorized) */}
              {layer.visible && layer.symbology.type === "categorized" && layer.symbology.categorizedRules && (
                <div className="pl-8 pr-1 py-1 space-y-1">
                  {layer.symbology.categorizedRules.map((rule) => (
                    <div key={rule.value} className="flex items-center gap-2 text-[10px] text-slate-400">
                      <span
                        style={{ backgroundColor: rule.style.color }}
                        className="w-2.5 h-2.5 rounded-full inline-block shrink-0 border border-white/20"
                      />
                      <span className="truncate">{rule.label}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Row 2 (When layer selected): Opacity Slider & Z-Index */}
              {isSelected && (
                <div className="flex items-center justify-between gap-3 pt-1 border-t border-slate-700/50 text-[10px] text-slate-400 pl-7">
                  <div className="flex items-center gap-2 flex-1">
                    <span className="shrink-0">Opacity:</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={layer.opacity}
                      onChange={(e) => handleOpacityChange(layer.id, parseFloat(e.target.value))}
                      className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                    <span className="font-mono text-white w-7 text-right">
                      {Math.round(layer.opacity * 100)}%
                    </span>
                  </div>

                  {onZoomToLayer && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onZoomToLayer(layer.id);
                      }}
                      className="p-1 text-slate-400 hover:text-white transition cursor-pointer"
                      title="Zoom to layer extents"
                    >
                      <Maximize2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Symbology Styling Modal ── */}
      {editingSymbologyLayer && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h4 className="font-bold text-white text-sm">Layer Symbology</h4>
                <p className="text-[11px] text-slate-400">{editingSymbologyLayer.name}</p>
              </div>
              <button
                onClick={() => setEditingSymbologyLayer(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {/* Primary Color Picker */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Primary Color</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={editingSymbologyLayer.symbology.defaultStyle.color || "#3B82F6"}
                    onChange={(e) =>
                      handleUpdateStyle(editingSymbologyLayer.id, {
                        color: e.target.value,
                        strokeColor: e.target.value,
                      })
                    }
                    className="w-8 h-8 rounded border border-slate-700 bg-slate-950 cursor-pointer"
                  />
                  <span className="font-mono text-white">
                    {editingSymbologyLayer.symbology.defaultStyle.color}
                  </span>
                </div>
              </div>

              {/* Stroke Width Slider */}
              <div>
                <div className="flex items-center justify-between text-slate-300 font-semibold mb-1">
                  <span>Stroke Width</span>
                  <span className="font-mono text-white">
                    {editingSymbologyLayer.symbology.defaultStyle.strokeWidth || 1}px
                  </span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="6"
                  step="0.5"
                  value={editingSymbologyLayer.symbology.defaultStyle.strokeWidth || 1}
                  onChange={(e) =>
                    handleUpdateStyle(editingSymbologyLayer.id, {
                      strokeWidth: parseFloat(e.target.value),
                    })
                  }
                  className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>

              {/* Fill Opacity Slider (if layer has fill) */}
              {editingSymbologyLayer.symbology.defaultStyle.fillOpacity !== undefined && (
                <div>
                  <div className="flex items-center justify-between text-slate-300 font-semibold mb-1">
                    <span>Fill Opacity</span>
                    <span className="font-mono text-white">
                      {Math.round((editingSymbologyLayer.symbology.defaultStyle.fillOpacity || 0) * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={editingSymbologyLayer.symbology.defaultStyle.fillOpacity || 0}
                    onChange={(e) =>
                      handleUpdateStyle(editingSymbologyLayer.id, {
                        fillOpacity: parseFloat(e.target.value),
                      })
                    }
                    className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setEditingSymbologyLayer(null)}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-xs font-semibold shadow transition cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
