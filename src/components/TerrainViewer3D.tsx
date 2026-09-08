import React, { useRef, useEffect, useState } from "react";
import { Rotate3d, Sliders, Layers, Mountain, Scissors } from "lucide-react";
import { PipelineResult } from "../types/spatial";

interface TerrainViewer3DProps {
  result: PipelineResult;
}

export const TerrainViewer3D: React.FC<TerrainViewer3DProps> = ({ result }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 3D Orbit & Perspective state
  const [azimuth, setAzimuth] = useState(45); // degrees
  const [pitch, setPitch] = useState(35); // degrees
  const [verticalExaggeration, setVerticalExaggeration] = useState(2.0);
  const [formationDatum, setFormationDatum] = useState(
    result.tin ? result.tin.datumElevation : 1680
  );
  const [showWireframe, setShowWireframe] = useState(true);
  const [showContours, setShowContours] = useState(true);

  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Recalculate cut/fill on datum change
  const { cutVol, fillVol } = React.useMemo(() => {
    if (!result.tin) return { cutVol: 0, fillVol: 0 };
    let cut = 0;
    let fill = 0;
    for (const tri of result.tin.triangles) {
      const avgZ = (tri.p1.elevation + tri.p2.elevation + tri.p3.elevation) / 3;
      const diff = avgZ - formationDatum;
      // Approximate 2D area
      const area = 250; // nominal
      if (diff > 0) cut += area * diff;
      else fill += area * Math.abs(diff);
    }
    return { cutVol: Math.round(cut), fillVol: Math.round(fill) };
  }, [result.tin, formationDatum]);

  // Center of the model
  const center = React.useMemo(() => {
    if (!result.tin || result.tin.vertices.length === 0) {
      return { x: 0, y: 0, z: 0, rangeX: 100, rangeY: 100, minZ: 0, maxZ: 100 };
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const v of result.tin.vertices) {
      if (v.easting < minX) minX = v.easting;
      if (v.easting > maxX) maxX = v.easting;
      if (v.northing < minY) minY = v.northing;
      if (v.northing > maxY) maxY = v.northing;
      if (v.elevation < minZ) minZ = v.elevation;
      if (v.elevation > maxZ) maxZ = v.elevation;
    }
    return {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: (minZ + maxZ) / 2,
      rangeX: maxX - minX || 100,
      rangeY: maxY - minY || 100,
      minZ,
      maxZ,
    };
  }, [result.tin]);

  // Render 3D Perspective Projection
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    const w = rect.width;
    const h = rect.height;

    // Clear dark background
    ctx.fillStyle = "#0B0F17";
    ctx.fillRect(0, 0, w, h);

    if (!result.tin || result.tin.triangles.length === 0) {
      ctx.fillStyle = "#64748B";
      ctx.font = "12px sans-serif";
      ctx.fillText("No 3D elevation TIN data available for this survey.", w / 2 - 120, h / 2);
      return;
    }

    // 3D Rotation Matrix math
    const azRad = (azimuth * Math.PI) / 180;
    const pitchRad = (pitch * Math.PI) / 180;
    const cosAz = Math.cos(azRad);
    const sinAz = Math.sin(azRad);
    const cosPitch = Math.cos(pitchRad);
    const sinPitch = Math.sin(pitchRad);

    const baseScale = Math.min(w, h) / (Math.max(center.rangeX, center.rangeY) * 1.3);

    const project3D = (e: number, n: number, elev: number): [number, number, number] => {
      const dx = e - center.x;
      const dy = n - center.y;
      const dz = (elev - center.z) * verticalExaggeration;

      // Rotate azimuth (around Z)
      const x1 = dx * cosAz - dy * sinAz;
      const y1 = dx * sinAz + dy * cosAz;
      const z1 = dz;

      // Rotate pitch (around X)
      const x2 = x1;
      const y2 = y1 * cosPitch - z1 * sinPitch;
      const z2 = y1 * sinPitch + z1 * cosPitch;

      // Screen projection
      const sx = w / 2 + x2 * baseScale;
      const sy = h / 2 - z2 * baseScale;

      return [sx, sy, y2]; // y2 is depth for z-sorting
    };

    // Sort triangles from back to front (Painter's algorithm)
    const sortedTriangles = [...result.tin.triangles].map((tri) => {
      const avgE = (tri.p1.easting + tri.p2.easting + tri.p3.easting) / 3;
      const avgN = (tri.p1.northing + tri.p2.northing + tri.p3.northing) / 3;
      const avgZ = (tri.p1.elevation + tri.p2.elevation + tri.p3.elevation) / 3;
      const p = project3D(avgE, avgN, avgZ);
      return { tri, depth: p[2] };
    });

    sortedTriangles.sort((a, b) => a.depth - b.depth);

    // Color gradient based on elevation
    const getElevColor = (elev: number) => {
      const t = Math.max(0, Math.min(1, (elev - center.minZ) / (center.maxZ - center.minZ || 1)));
      // Hypsometric tint: Cyan -> Green -> Amber -> Red/White
      if (t < 0.3) return `rgb(${Math.round(14 + t * 50)}, ${Math.round(165 + t * 100)}, ${Math.round(233)})`;
      if (t < 0.6) return `rgb(${Math.round(16 + (t - 0.3) * 300)}, ${Math.round(185)}, ${Math.round(129 - (t - 0.3) * 150)})`;
      if (t < 0.85) return `rgb(${Math.round(245)}, ${Math.round(158 - (t - 0.6) * 200)}, ${Math.round(11)})`;
      return `rgb(${Math.round(239)}, ${Math.round(68)}, ${Math.round(68)})`;
    };

    // Draw triangles
    for (const item of sortedTriangles) {
      const tri = item.tri;
      const p1 = project3D(tri.p1.easting, tri.p1.northing, tri.p1.elevation);
      const p2 = project3D(tri.p2.easting, tri.p2.northing, tri.p2.elevation);
      const p3 = project3D(tri.p3.easting, tri.p3.northing, tri.p3.elevation);

      const avgZ = (tri.p1.elevation + tri.p2.elevation + tri.p3.elevation) / 3;

      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.lineTo(p3[0], p3[1]);
      ctx.closePath();

      // Shading based on slope and lighting
      const lightFactor = Math.max(0.3, Math.min(1.0, 0.7 + (tri.normal[0] * 0.2 + tri.normal[2] * 0.4)));
      ctx.fillStyle = getElevColor(avgZ);
      ctx.globalAlpha = 0.85;
      ctx.fill();

      if (showWireframe) {
        ctx.strokeStyle = "#FFFFFF22";
        ctx.lineWidth = 0.5;
        ctx.globalAlpha = 0.4;
        ctx.stroke();
      }
      ctx.globalAlpha = 1.0;
    }

    // Draw 3D Contours draped over surface
    if (showContours) {
      for (const c of result.contours) {
        if (!c.isMajor) continue;
        ctx.strokeStyle = "#FACC15DD";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < c.points.length; i++) {
          const pt = c.points[i];
          const p = project3D(pt[0], pt[1], c.elevation);
          if (i === 0) ctx.moveTo(p[0], p[1]);
          else ctx.lineTo(p[0], p[1]);
        }
        ctx.stroke();
      }
    }

    // Draw Formation Datum Cut/Fill Waterline Plane
    const datumP1 = project3D(center.x - center.rangeX * 0.6, center.y - center.rangeY * 0.6, formationDatum);
    const datumP2 = project3D(center.x + center.rangeX * 0.6, center.y - center.rangeY * 0.6, formationDatum);
    const datumP3 = project3D(center.x + center.rangeX * 0.6, center.y + center.rangeY * 0.6, formationDatum);
    const datumP4 = project3D(center.x - center.rangeX * 0.6, center.y + center.rangeY * 0.6, formationDatum);

    ctx.beginPath();
    ctx.moveTo(datumP1[0], datumP1[1]);
    ctx.lineTo(datumP2[0], datumP2[1]);
    ctx.lineTo(datumP3[0], datumP3[1]);
    ctx.lineTo(datumP4[0], datumP4[1]);
    ctx.closePath();
    ctx.fillStyle = "#38BDF825";
    ctx.fill();
    ctx.strokeStyle = "#38BDF8";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }, [result.tin, azimuth, pitch, verticalExaggeration, formationDatum, showWireframe, showContours, center]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;

    setAzimuth((prev) => (prev + dx * 0.5) % 360);
    setPitch((prev) => Math.max(10, Math.min(85, prev - dy * 0.3)));
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = () => setIsDragging(false);

  return (
    <div className="relative w-full h-[calc(100vh-125px)] bg-[#0B0F17] flex">
      {/* 3D Canvas */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="w-full h-full cursor-grab active:cursor-grabbing block"
      />

      {/* Control Panel (Floating Right) */}
      <div className="absolute top-4 right-4 w-72 bg-slate-900/95 backdrop-blur border border-slate-800 rounded-xl p-4 shadow-2xl z-10 text-xs font-['Plus_Jakarta_Sans'] flex flex-col gap-4">
        <div className="flex items-center gap-2 border-b border-slate-800 pb-2.5">
          <Mountain className="w-4 h-4 text-blue-400" />
          <h2 className="font-bold text-white tracking-wide">3D SURFACE &amp; TERRAIN</h2>
        </div>

        {/* Orbit Controls */}
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-slate-400 mb-1">
              <span>Azimuth Orbit</span>
              <span className="font-mono text-white">{Math.round(azimuth)}°</span>
            </div>
            <input
              type="range"
              min="0"
              max="360"
              value={azimuth}
              onChange={(e) => setAzimuth(Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
          </div>

          <div>
            <div className="flex justify-between text-slate-400 mb-1">
              <span>Pitch Tilt</span>
              <span className="font-mono text-white">{Math.round(pitch)}°</span>
            </div>
            <input
              type="range"
              min="10"
              max="85"
              value={pitch}
              onChange={(e) => setPitch(Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
          </div>

          <div>
            <div className="flex justify-between text-slate-400 mb-1">
              <span>Vertical Exaggeration</span>
              <span className="font-mono text-white">{verticalExaggeration.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="1.0"
              max="5.0"
              step="0.2"
              value={verticalExaggeration}
              onChange={(e) => setVerticalExaggeration(Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
          </div>
        </div>

        {/* Cut / Fill Earthwork Balancing */}
        <div className="border-t border-slate-800 pt-3 space-y-2">
          <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
            <Scissors className="w-3.5 h-3.5 text-amber-400" />
            <span>EARTHWORK CUT &amp; FILL</span>
          </div>

          <div>
            <div className="flex justify-between text-slate-400 mb-1">
              <span>Formation Datum Plane</span>
              <span className="font-mono text-sky-400">{formationDatum.toFixed(1)}m</span>
            </div>
            <input
              type="range"
              min={center.minZ - 5}
              max={center.maxZ + 5}
              step="0.5"
              value={formationDatum}
              onChange={(e) => setFormationDatum(Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-400"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[11px]">
            <div className="bg-slate-950 p-2 rounded border border-slate-800">
              <span className="text-red-400 block text-[10px]">CUT (EXCAVATION)</span>
              <strong className="text-white">{cutVol.toLocaleString()} m³</strong>
            </div>
            <div className="bg-slate-950 p-2 rounded border border-slate-800">
              <span className="text-cyan-400 block text-[10px]">FILL (EMBANKMENT)</span>
              <strong className="text-white">{fillVol.toLocaleString()} m³</strong>
            </div>
          </div>
        </div>

        {/* Display Toggles */}
        <div className="border-t border-slate-800 pt-3 flex flex-col gap-2">
          <label className="flex items-center justify-between text-slate-300 cursor-pointer">
            <span>Show TIN Wireframe</span>
            <input
              type="checkbox"
              checked={showWireframe}
              onChange={(e) => setShowWireframe(e.target.checked)}
              className="rounded border-slate-700 text-blue-600 focus:ring-0 cursor-pointer"
            />
          </label>
          <label className="flex items-center justify-between text-slate-300 cursor-pointer">
            <span>Show 3D Contours</span>
            <input
              type="checkbox"
              checked={showContours}
              onChange={(e) => setShowContours(e.target.checked)}
              className="rounded border-slate-700 text-blue-600 focus:ring-0 cursor-pointer"
            />
          </label>
        </div>
      </div>
    </div>
  );
};