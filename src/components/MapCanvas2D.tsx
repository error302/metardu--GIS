import React, { useRef, useEffect, useState, useMemo } from "react";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Layers,
  Eye,
  EyeOff,
  Compass,
  Sun,
  Moon,
  Globe,
} from "lucide-react";
import { PipelineResult } from "../types/spatial";

interface MapCanvas2DProps {
  result: PipelineResult;
}

export type BasemapMode = "dark" | "satellite" | "viirs" | "cad";

export const MapCanvas2D: React.FC<MapCanvas2DProps> = ({ result }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Viewport transformation
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [cursorCoord, setCursorCoord] = useState({ easting: 0, northing: 0, elevation: 0 });

  // Basemap & Layer toggles
  const [basemap, setBasemap] = useState<BasemapMode>("dark");
  const [layers, setLayers] = useState({
    boundary: true,
    bearings: true,
    beacons: true,
    roads: true,
    roadBuffer: true,
    riparianBuffer: true,
    rivers: true,
    tin: false,
    contours: true,
    suitability: false,
    hazards: true,
    energy: true,
  });

  const [showLayerPanel, setShowLayerPanel] = useState(false);

  // Calculate project bounds
  const bounds = useMemo(() => {
    let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
    for (const p of result.points) {
      if (p.easting < minE) minE = p.easting;
      if (p.easting > maxE) maxE = p.easting;
      if (p.northing < minN) minN = p.northing;
      if (p.northing > maxN) maxN = p.northing;
    }
    if (minE === Infinity) {
      minE = 250000; maxE = 251000; minN = 9850000; maxN = 9851000;
    }
    return { minE, maxE, minN, maxN, midE: (minE + maxE) / 2, midN: (minN + maxN) / 2 };
  }, [result]);

  // Fit to extents
  const handleFitBounds = () => {
    if (!canvasRef.current) return;
    const cw = canvasRef.current.width;
    const ch = canvasRef.current.height;
    const spanE = bounds.maxE - bounds.minE || 100;
    const spanN = bounds.maxN - bounds.minN || 100;

    const pad = 1.3;
    const scaleX = cw / (spanE * pad);
    const scaleY = ch / (spanN * pad);
    const fitScale = Math.min(scaleX, scaleY);

    setZoom(fitScale);
    setPan({
      x: cw / 2 - bounds.midE * fitScale,
      y: ch / 2 + bounds.midN * fitScale,
    });
  };

  useEffect(() => {
    handleFitBounds();
  }, [bounds]);

  // Transform helpers
  const toScreenX = (e: number) => e * zoom + pan.x;
  const toScreenY = (n: number) => -n * zoom + pan.y;
  const toWorldE = (sx: number) => (sx - pan.x) / zoom;
  const toWorldN = (sy: number) => -(sy - pan.y) / zoom;

  // Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Handle high DPI
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    const w = rect.width;
    const h = rect.height;

    // 1. Draw Basemap Background
    if (basemap === "dark") {
      ctx.fillStyle = "#0B0F17";
      ctx.fillRect(0, 0, w, h);
    } else if (basemap === "cad") {
      ctx.fillStyle = "#F8FAFC";
      ctx.fillRect(0, 0, w, h);
    } else if (basemap === "satellite") {
      // Simulated satellite aerial tone
      ctx.fillStyle = "#111827";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#064E3B22";
      ctx.fillRect(0, 0, w, h);
    } else if (basemap === "viirs") {
      // NASA VIIRS Black Marble nocturnal simulation
      ctx.fillStyle = "#030712";
      ctx.fillRect(0, 0, w, h);
      // Soft ambient light glow
      const grad = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w / 1.5);
      grad.addColorStop(0, "#F59E0B15");
      grad.addColorStop(1, "#00000000");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }

    // 2. Coordinate Graticule Grid (+)
    const graticuleStep = Math.max(20, Math.pow(10, Math.floor(Math.log10(200 / zoom))));
    const minVisE = toWorldE(0);
    const maxVisE = toWorldE(w);
    const minVisN = toWorldN(h);
    const maxVisN = toWorldN(0);

    ctx.lineWidth = 0.5;
    ctx.strokeStyle = basemap === "cad" ? "#E2E8F0" : "#1E293B";
    ctx.fillStyle = basemap === "cad" ? "#64748B" : "#475569";
    ctx.font = "9px monospace";

    const startE = Math.floor(minVisE / graticuleStep) * graticuleStep;
    for (let e = startE; e <= maxVisE; e += graticuleStep) {
      const sx = toScreenX(e);
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
      ctx.stroke();
      ctx.fillText(`${e.toLocaleString()}m E`, sx + 4, h - 8);
    }

    const startN = Math.floor(minVisN / graticuleStep) * graticuleStep;
    for (let n = startN; n <= maxVisN; n += graticuleStep) {
      const sy = toScreenY(n);
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
      ctx.stroke();
      ctx.fillText(`${n.toLocaleString()}m N`, 8, sy - 4);
    }

    // 3. MCDA Suitability Cells (Heatmap overlay)
    if (layers.suitability && result.suitability.length > 0) {
      for (const cell of result.suitability) {
        const sx = toScreenX(cell.x);
        const sy = toScreenY(cell.y);
        const cellPixelSize = Math.max(8, 25 * zoom);

        let color = "#10B98144";
        if (cell.category === "optimal") color = "#05966966";
        else if (cell.category === "suitable") color = "#10B98155";
        else if (cell.category === "moderate") color = "#F59E0B55";
        else if (cell.category === "restricted") color = "#EF444466";
        else if (cell.category === "hazard") color = "#991B1B77";

        ctx.fillStyle = color;
        ctx.fillRect(sx - cellPixelSize / 2, sy - cellPixelSize / 2, cellPixelSize, cellPixelSize);
      }
    }

    // 4. Corridor Buffers (15m Road / 30m Riparian)
    if (layers.roadBuffer || layers.riparianBuffer) {
      for (const buf of result.buffers) {
        const isRiparian = buf.featureName.includes("Reserve") && buf.reserveWidthM >= 30;
        if (isRiparian && !layers.riparianBuffer) continue;
        if (!isRiparian && !layers.roadBuffer) continue;

        ctx.fillStyle = isRiparian ? "#06B6D418" : "#F59E0B18";
        ctx.strokeStyle = isRiparian ? "#06B6D4" : "#F59E0B";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);

        const drawPolygon = (pts1: [number, number][], pts2: [number, number][]) => {
          if (pts1.length < 2 || pts2.length < 2) return;
          ctx.beginPath();
          ctx.moveTo(toScreenX(pts1[0][0]), toScreenY(pts1[0][1]));
          for (let i = 1; i < pts1.length; i++) {
            ctx.lineTo(toScreenX(pts1[i][0]), toScreenY(pts1[i][1]));
          }
          for (let i = pts2.length - 1; i >= 0; i--) {
            ctx.lineTo(toScreenX(pts2[i][0]), toScreenY(pts2[i][1]));
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        };

        drawPolygon(buf.leftOffset, buf.rightOffset);
        ctx.setLineDash([]);
      }
    }

    // 5. Delaunay TIN Triangles (Wireframe)
    if (layers.tin && result.tin) {
      ctx.strokeStyle = basemap === "cad" ? "#CBD5E1" : "#1E293B88";
      ctx.lineWidth = 0.6;
      for (const tri of result.tin.triangles) {
        ctx.beginPath();
        ctx.moveTo(toScreenX(tri.p1.easting), toScreenY(tri.p1.northing));
        ctx.lineTo(toScreenX(tri.p2.easting), toScreenY(tri.p2.northing));
        ctx.lineTo(toScreenX(tri.p3.easting), toScreenY(tri.p3.northing));
        ctx.closePath();
        ctx.stroke();
      }
    }

    // 6. Contours (1m minor / 5m major)
    if (layers.contours) {
      for (const c of result.contours) {
        ctx.strokeStyle = c.isMajor
          ? (basemap === "cad" ? "#B45309" : "#F59E0B")
          : (basemap === "cad" ? "#CBD5E1" : "#475569");
        ctx.lineWidth = c.isMajor ? 1.4 : 0.7;

        ctx.beginPath();
        c.points.forEach((pt, idx) => {
          const sx = toScreenX(pt[0]);
          const sy = toScreenY(pt[1]);
          if (idx === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.stroke();

        // Major contour elevation labels
        if (c.isMajor && c.points.length > 5) {
          const midPt = c.points[Math.floor(c.points.length / 2)];
          const lx = toScreenX(midPt[0]);
          const ly = toScreenY(midPt[1]);
          ctx.fillStyle = basemap === "cad" ? "#B45309" : "#F59E0B";
          ctx.font = "8.5px monospace";
          ctx.fillText(`${c.elevation}m`, lx + 3, ly - 3);
        }
      }
    }

    // 7. Feature Vectors (Roads, Rivers, Buildings)
    for (const vec of result.vectors) {
      if (vec.category === "boundary") continue; // drawn separately
      if (vec.category === "road" && !layers.roads) continue;
      if (vec.category === "water" && !layers.rivers) continue;

      ctx.strokeStyle = vec.color;
      ctx.lineWidth = vec.lineWidth;
      if (vec.lineType === "dashed") ctx.setLineDash([6, 4]);
      else if (vec.lineType === "dashdot") ctx.setLineDash([8, 3, 2, 3]);
      else ctx.setLineDash([]);

      ctx.beginPath();
      vec.points.forEach((pt, idx) => {
        const sx = toScreenX(pt.easting);
        const sy = toScreenY(pt.northing);
        if (idx === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      if (vec.isClosed) ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 8. Cadastral Boundary Polygon
    if (layers.boundary && result.boundary) {
      const b = result.boundary;
      ctx.fillStyle = "#3B82F614";
      ctx.strokeStyle = "#3B82F6";
      ctx.lineWidth = 2.5;

      ctx.beginPath();
      b.points.forEach((pt, idx) => {
        const sx = toScreenX(pt.easting);
        const sy = toScreenY(pt.northing);
        if (idx === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Bearing & Distance badges along boundary lines
      if (layers.bearings) {
        for (const bd of b.bearingsDistances) {
          const p1 = b.points.find((p) => p.id === bd.fromId);
          const p2 = b.points.find((p) => p.id === bd.toId);
          if (!p1 || !p2) continue;

          const mx = (toScreenX(p1.easting) + toScreenX(p2.easting)) / 2;
          const my = (toScreenY(p1.northing) + toScreenY(p2.northing)) / 2;

          ctx.fillStyle = basemap === "cad" ? "#FFFFFFEE" : "#0F172AEE";
          ctx.strokeStyle = basemap === "cad" ? "#CBD5E1" : "#334155";
          ctx.lineWidth = 0.5;

          const badgeW = 75;
          const badgeH = 22;
          ctx.fillRect(mx - badgeW / 2, my - badgeH / 2, badgeW, badgeH);
          ctx.strokeRect(mx - badgeW / 2, my - badgeH / 2, badgeW, badgeH);

          ctx.fillStyle = basemap === "cad" ? "#0F172A" : "#F8FAFC";
          ctx.font = "8px monospace";
          ctx.textAlign = "center";
          ctx.fillText(bd.bearingDms, mx, my - 2);
          ctx.fillStyle = "#3B82F6";
          ctx.fillText(`${bd.distanceM.toFixed(1)}m`, mx, my + 8);
          ctx.textAlign = "left";
        }
      }
    }

    // 9. Hazard Sinks & Exposed Assets
    if (layers.hazards) {
      for (const sink of result.hazardSinks) {
        const sx = toScreenX(sink.center[0]);
        const sy = toScreenY(sink.center[1]);
        const r = Math.max(15, sink.depthM * 10 * zoom);

        ctx.fillStyle = "#EF444422";
        ctx.strokeStyle = "#EF4444";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#EF4444";
        ctx.font = "bold 9px monospace";
        ctx.fillText(`! FLOOD SINK: -${sink.depthM}m`, sx + r + 4, sy);
      }
    }

    // 10. Sun King Energy Clusters
    if (layers.energy) {
      for (const ec of result.energyClusters) {
        const sx = toScreenX(ec.centroid[0]);
        const sy = toScreenY(ec.centroid[1]);
        const r = Math.max(18, (ec.clusterRadiusM / 10) * zoom);

        ctx.fillStyle = "#FACC1522";
        ctx.strokeStyle = "#FACC15";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = "#FDE047";
        ctx.font = "bold 9px monospace";
        ctx.fillText(`SOLAR: ${ec.recommendedType} (${ec.householdCount} HH)`, sx + r + 4, sy);
      }
    }

    // 11. Survey Points & Beacon Pins
    if (layers.beacons) {
      for (const pt of result.points) {
        const sx = toScreenX(pt.easting);
        const sy = toScreenY(pt.northing);

        const isBnd = pt.category === "boundary";
        ctx.fillStyle = isBnd ? "#EF4444" : "#3B82F6";
        ctx.beginPath();
        ctx.arc(sx, sy, isBnd ? 4.5 : 3, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Label
        ctx.fillStyle = basemap === "cad" ? "#0F172A" : "#F1F5F9";
        ctx.font = "8px sans-serif";
        ctx.fillText(pt.id, sx + 6, sy - 4);
      }
    }

    // 12. Cartographic HUD Elements (Scale Bar & North Arrow)
    // North Arrow
    ctx.save();
    ctx.translate(w - 40, 45);
    ctx.fillStyle = basemap === "cad" ? "#FFFFFFEE" : "#0F172AEE";
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = basemap === "cad" ? "#CBD5E1" : "#334155";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#0284C7";
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(4, 0);
    ctx.lineTo(0, -2);
    ctx.lineTo(-4, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = basemap === "cad" ? "#64748B" : "#94A3B8";
    ctx.beginPath();
    ctx.moveTo(0, 14);
    ctx.lineTo(4, 0);
    ctx.lineTo(0, 2);
    ctx.lineTo(-4, 0);
    ctx.closePath();
    ctx.fill();
    ctx.font = "bold 9px sans-serif";
    ctx.fillStyle = basemap === "cad" ? "#0F172A" : "#F8FAFC";
    ctx.textAlign = "center";
    ctx.fillText("N", 0, -16);
    ctx.restore();

    // Scale Bar (Bottom Left)
    const scaleBarWorldM = 100;
    const scaleBarPx = scaleBarWorldM * zoom;
    if (scaleBarPx > 40 && scaleBarPx < 300) {
      ctx.fillStyle = basemap === "cad" ? "#FFFFFFEE" : "#0F172AEE";
      ctx.fillRect(15, h - 35, scaleBarPx + 20, 24);
      ctx.strokeStyle = basemap === "cad" ? "#CBD5E1" : "#334155";
      ctx.strokeRect(15, h - 35, scaleBarPx + 20, 24);

      ctx.fillStyle = "#0284C7";
      ctx.fillRect(25, h - 22, scaleBarPx / 2, 4);
      ctx.fillStyle = basemap === "cad" ? "#0F172A" : "#FFFFFF";
      ctx.fillRect(25 + scaleBarPx / 2, h - 22, scaleBarPx / 2, 4);

      ctx.font = "8px monospace";
      ctx.fillStyle = basemap === "cad" ? "#0F172A" : "#F8FAFC";
      ctx.fillText("0", 23, h - 25);
      ctx.fillText(`${scaleBarWorldM / 2}m`, 25 + scaleBarPx / 2 - 8, h - 25);
      ctx.fillText(`${scaleBarWorldM}m`, 25 + scaleBarPx - 12, h - 25);
    }
  }, [zoom, pan, basemap, layers, result]);

  // Mouse interaction handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const worldE = toWorldE(mx);
    const worldN = toWorldN(my);

    // Approximate elevation from nearest vertex
    let nearestElev = 1680;
    let minD = Infinity;
    for (const p of result.points) {
      const d = Math.hypot(p.easting - worldE, p.northing - worldN);
      if (d < minD) {
        minD = d;
        nearestElev = p.elevation;
      }
    }

    setCursorCoord({
      easting: Number(worldE.toFixed(2)),
      northing: Number(worldN.toFixed(2)),
      elevation: Number(nearestElev.toFixed(2)),
    });

    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    const newZoom = Math.max(0.01, Math.min(50, zoom * zoomFactor));

    setPan({
      x: mouseX - (mouseX - pan.x) * (newZoom / zoom),
      y: mouseY - (mouseY - pan.y) * (newZoom / zoom),
    });
    setZoom(newZoom);
  };

  return (
    <div className="relative w-full h-[calc(100vh-125px)] bg-[#0B0F17] overflow-hidden flex">
      {/* 2D Canvas */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        className="w-full h-full cursor-crosshair block"
      />

      {/* Floating Canvas Controls (Top Left) */}
      <div className="absolute top-4 left-4 flex flex-col gap-2 z-10">
        {/* Basemap Switcher */}
        <div className="bg-slate-900/95 backdrop-blur border border-slate-800 rounded-lg p-1 flex items-center gap-1 shadow-xl">
          <button
            onClick={() => setBasemap("dark")}
            className={`px-2.5 py-1 text-xs font-semibold rounded transition cursor-pointer ${
              basemap === "dark" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
            }`}
            title="Dark Topographic Vector"
          >
            Dark Vector
          </button>
          <button
            onClick={() => setBasemap("satellite")}
            className={`px-2.5 py-1 text-xs font-semibold rounded transition cursor-pointer ${
              basemap === "satellite" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
            }`}
            title="True-Color Aerial Imagery"
          >
            Satellite
          </button>
          <button
            onClick={() => setBasemap("viirs")}
            className={`px-2.5 py-1 text-xs font-semibold rounded transition cursor-pointer ${
              basemap === "viirs" ? "bg-amber-600 text-white" : "text-slate-400 hover:text-white"
            }`}
            title="NASA VIIRS Night-Time Lights (Black Marble)"
          >
            NASA VIIRS NTL
          </button>
          <button
            onClick={() => setBasemap("cad")}
            className={`px-2.5 py-1 text-xs font-semibold rounded transition cursor-pointer ${
              basemap === "cad" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
            }`}
            title="Clean Engineering Blueprint"
          >
            CAD Light
          </button>
        </div>

        {/* Zoom & Fit Tools */}
        <div className="bg-slate-900/95 backdrop-blur border border-slate-800 rounded-lg p-1 flex items-center gap-1 shadow-xl">
          <button
            onClick={() => setZoom((z) => z * 1.25)}
            className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded transition cursor-pointer"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => setZoom((z) => z * 0.8)}
            className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded transition cursor-pointer"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={handleFitBounds}
            className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded transition cursor-pointer"
            title="Fit to Extents"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <div className="w-[1px] h-4 bg-slate-800 mx-0.5" />
          <button
            onClick={() => setShowLayerPanel((v) => !v)}
            className={`p-1.5 rounded transition cursor-pointer ${
              showLayerPanel ? "bg-blue-600/30 text-blue-400" : "text-slate-300 hover:text-white hover:bg-slate-800"
            }`}
            title="Layer Manager"
          >
            <Layers className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Layer Visibility Drawer */}
      {showLayerPanel && (
        <div className="absolute top-24 left-4 w-64 bg-slate-900/95 backdrop-blur border border-slate-800 rounded-lg p-3.5 shadow-2xl z-20 text-xs font-['Plus_Jakarta_Sans']">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2.5">
            <span className="font-bold text-white tracking-wide">VECTOR LAYERS</span>
            <span className="text-[10px] text-slate-400 font-mono">CADASTRE &amp; GIS</span>
          </div>

          <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
            {Object.entries(layers).map(([key, enabled]) => (
              <label
                key={key}
                className="flex items-center justify-between py-1 px-1.5 rounded hover:bg-slate-800/60 cursor-pointer text-slate-300 select-none"
              >
                <span className="capitalize">{key.replace(/([A-Z])/g, " $1")}</span>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setLayers((prev) => ({ ...prev, [key]: e.target.checked }))}
                  className="rounded border-slate-700 text-blue-600 focus:ring-0 cursor-pointer"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Bottom Live Cursor Coordinate Bar */}
      <div className="absolute bottom-2 right-4 bg-slate-900/90 backdrop-blur border border-slate-800 px-3.5 py-1.5 rounded-md text-[11px] font-mono text-slate-300 shadow-xl flex items-center gap-4 z-10">
        <span>E: <strong className="text-white">{cursorCoord.easting.toLocaleString()}m</strong></span>
        <span>N: <strong className="text-white">{cursorCoord.northing.toLocaleString()}m</strong></span>
        <span>H: <strong className="text-blue-400">{cursorCoord.elevation.toFixed(2)}m MSL</strong></span>
        <span className="text-slate-500">|</span>
        <span className="text-slate-400 font-sans text-[10px]">{result.metadata.crs}</span>
      </div>
    </div>
  );
};