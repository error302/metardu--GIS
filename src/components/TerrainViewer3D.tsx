import React, { useRef, useEffect, useState } from "react";
import { PipelineResult } from "../types/spatial";

interface TerrainViewer3DProps {
  result: PipelineResult;
}

/** Muted hypsometric ramp — ColorBrewer-informed, print-safe. */
function hypsometric(t: number): string {
  const stops: [number, [number, number, number]][] = [
    [0.0, [58, 82, 105]],
    [0.28, [88, 125, 102]],
    [0.52, [143, 158, 106]],
    [0.75, [194, 163, 107]],
    [0.92, [217, 203, 176]],
    [1.0, [236, 230, 218]],
  ];
  const tt = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    if (tt <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = (tt - t0) / (t1 - t0 || 1);
      return `rgb(${Math.round(c0[0] + (c1[0] - c0[0]) * f)}, ${Math.round(
        c0[1] + (c1[1] - c0[1]) * f
      )}, ${Math.round(c0[2] + (c1[2] - c0[2]) * f)})`;
    }
  }
  return "rgb(236, 230, 218)";
}

export const TerrainViewer3D: React.FC<TerrainViewer3DProps> = ({ result }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [azimuth, setAzimuth] = useState(45);
  const [pitch, setPitch] = useState(35);
  const [verticalExaggeration, setVerticalExaggeration] = useState(2.0);
  const [formationDatum, setFormationDatum] = useState(
    result.tin ? result.tin.datumElevation : 1680
  );
  const [showWireframe, setShowWireframe] = useState(true);
  const [showContours, setShowContours] = useState(true);

  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const { cutVol, fillVol } = React.useMemo(() => {
    if (!result.tin) return { cutVol: 0, fillVol: 0 };
    let cut = 0;
    let fill = 0;
    for (const tri of result.tin.triangles) {
      const avgZ = (tri.p1.elevation + tri.p2.elevation + tri.p3.elevation) / 3;
      const diff = avgZ - formationDatum;
      const area = 250;
      if (diff > 0) cut += area * diff;
      else fill += area * Math.abs(diff);
    }
    return { cutVol: Math.round(cut), fillVol: Math.round(fill) };
  }, [result.tin, formationDatum]);

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width;
    const h = rect.height;

    ctx.fillStyle = "#161619";
    ctx.fillRect(0, 0, w, h);

    if (!result.tin || result.tin.triangles.length === 0) {
      ctx.fillStyle = "#70707a";
      ctx.font = "12px 'IBM Plex Sans', sans-serif";
      ctx.fillText("No elevation TIN available for this survey.", w / 2 - 100, h / 2);
      return;
    }

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

      const x1 = dx * cosAz - dy * sinAz;
      const y1 = dx * sinAz + dy * cosAz;
      const z1 = dz;

      const x2 = x1;
      const y2 = y1 * cosPitch - z1 * sinPitch;
      const z2 = y1 * sinPitch + z1 * cosPitch;

      const sx = w / 2 + x2 * baseScale;
      const sy = h / 2 - z2 * baseScale;
      return [sx, sy, y2];
    };

    const sortedTriangles = [...result.tin.triangles].map((tri) => {
      const avgE = (tri.p1.easting + tri.p2.easting + tri.p3.easting) / 3;
      const avgN = (tri.p1.northing + tri.p2.northing + tri.p3.northing) / 3;
      const avgZ = (tri.p1.elevation + tri.p2.elevation + tri.p3.elevation) / 3;
      const p = project3D(avgE, avgN, avgZ);
      return { tri, depth: p[2] };
    });
    sortedTriangles.sort((a, b) => a.depth - b.depth);

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

      const t = (avgZ - center.minZ) / (center.maxZ - center.minZ || 1);
      const shade = Math.max(0.72, Math.min(1.08, 0.92 + (tri.normal[0] * 0.15 + tri.normal[2] * 0.3)));

      // base color shaded by slope-aspect lighting
      const base = hypsometric(t).match(/\d+/g);
      if (base) {
        const r = Math.round(Math.min(255, Number(base[0]) * shade));
        const g = Math.round(Math.min(255, Number(base[1]) * shade));
        const b = Math.round(Math.min(255, Number(base[2]) * shade));
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      } else {
        ctx.fillStyle = hypsometric(t);
      }
      ctx.fill();

      if (showWireframe) {
        ctx.strokeStyle = "rgba(22, 22, 25, 0.35)";
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }

    if (showContours) {
      for (const c of result.contours) {
        if (!c.isMajor) continue;
        ctx.strokeStyle = "rgba(232, 232, 234, 0.55)";
        ctx.lineWidth = 1.1;
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

    // Formation datum plane
    const d = center.rangeX * 0.6;
    const d2 = center.rangeY * 0.6;
    const corners: [number, number][] = [
      [center.x - d, center.y - d2],
      [center.x + d, center.y - d2],
      [center.x + d, center.y + d2],
      [center.x - d, center.y + d2],
    ].map(([e, n]) => {
      const p = project3D(e, n, formationDatum);
      return [p[0], p[1]];
    }) as [number, number][];

    ctx.beginPath();
    ctx.moveTo(corners[0][0], corners[0][1]);
    corners.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.closePath();
    ctx.fillStyle = "rgba(98, 191, 195, 0.08)";
    ctx.fill();
    ctx.strokeStyle = "rgba(98, 191, 195, 0.55)";
    ctx.lineWidth = 1;
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

  const OrbitSlider = ({
    label,
    value,
    display,
    min,
    max,
    step,
    onChange,
  }: {
    label: string;
    value: number;
    display: string;
    min: number;
    max: number;
    step: number;
    onChange: (v: number) => void;
  }) => (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] text-ink-2">{label}</span>
        <span className="tnum text-[12px] text-ink">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 bg-line rounded-full appearance-none cursor-pointer accent-[#d9a441]"
      />
    </div>
  );

  return (
    <div className="relative w-full h-full bg-sunken flex">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="w-full h-full cursor-grab active:cursor-grabbing block"
      />

      {/* Control panel — docked right */}
      <div className="absolute top-3 right-3 w-72 bg-panel/95 backdrop-blur border border-line rounded-[4px] shadow-2xl z-10 overflow-hidden">
        <div className="ui-panel-head">
          <span className="ui-label">3D surface</span>
          <span className="text-[10px] tnum text-ink-3">
            {center.minZ.toFixed(0)}–{center.maxZ.toFixed(0)} m
          </span>
        </div>

        <div className="p-3.5 flex flex-col gap-4 text-[12px]">
          <OrbitSlider label="Azimuth" value={azimuth} display={`${Math.round(azimuth)}°`} min={0} max={360} step={1} onChange={setAzimuth} />
          <OrbitSlider label="Pitch" value={pitch} display={`${Math.round(pitch)}°`} min={10} max={85} step={1} onChange={setPitch} />
          <OrbitSlider label="Vertical exaggeration" value={verticalExaggeration} display={`${verticalExaggeration.toFixed(1)}×`} min={1.0} max={5.0} step={0.2} onChange={setVerticalExaggeration} />

          <div className="border-t border-line pt-3.5 space-y-3">
            <span className="ui-label">Earthwork datum</span>
            <OrbitSlider label="Formation level" value={formationDatum} display={`${formationDatum.toFixed(1)} m`} min={center.minZ - 5} max={center.maxZ + 5} step={0.5} onChange={setFormationDatum} />
            <div className="grid grid-cols-2 gap-px bg-line border border-line rounded-[3px] overflow-hidden">
              <div className="bg-sunken p-2.5">
                <span className="ui-label block mb-0.5 text-dt-red">Cut</span>
                <span className="tnum text-[13px] text-ink">{cutVol.toLocaleString("en-US")} m³</span>
              </div>
              <div className="bg-sunken p-2.5">
                <span className="ui-label block mb-0.5 text-dt-cyan">Fill</span>
                <span className="tnum text-[13px] text-ink">{fillVol.toLocaleString("en-US")} m³</span>
              </div>
            </div>
          </div>

          <div className="border-t border-line pt-3 flex flex-col gap-2">
            <label className="flex items-center justify-between text-ink-2 cursor-pointer">
              <span>TIN wireframe</span>
              <input
                type="checkbox"
                checked={showWireframe}
                onChange={(e) => setShowWireframe(e.target.checked)}
                className="accent-[#d9a441] cursor-pointer"
              />
            </label>
            <label className="flex items-center justify-between text-ink-2 cursor-pointer">
              <span>Major contours</span>
              <input
                type="checkbox"
                checked={showContours}
                onChange={(e) => setShowContours(e.target.checked)}
                className="accent-[#d9a441] cursor-pointer"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};
