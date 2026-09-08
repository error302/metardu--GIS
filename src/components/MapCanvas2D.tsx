import React, { useRef, useEffect, useState, useMemo } from "react";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Layers,
  Wrench,
  MousePointer2,
} from "lucide-react";
import { PipelineResult, SurveyPoint } from "../types/spatial";
import { crsEpsgFromMetadata, toWGS84 } from "../core/crs";
import { DEFAULT_LAYERS, LayerItem } from "../core/layer-store";
import { LayerPanel } from "./LayerPanel";
import { ToolboxPanel } from "./ToolboxPanel";
import { CursorReadout } from "./StatusBar";

interface MapCanvas2DProps {
  result: PipelineResult;
  selectedPointIds?: string[];
  onSelectPoint?: (id: string) => void;
  onCursorReadout?: (c: CursorReadout | null) => void;
  onScaleChange?: (scaleDenominator: number) => void;
}

export type BasemapMode = "dark" | "satellite" | "viirs" | "cad";

/* Data palette — mirrors CSS tokens (color belongs to data, never chrome) */
const C = {
  boundary: "#6aa1d8",
  boundaryFill: "rgba(106, 161, 216, 0.07)",
  beaconBoundary: "#d97b7b",
  beaconOther: "#6aa1d8",
  selected: "#d9a441",
  contourMinor: "#4c4c52",
  contourMajor: "#c9985b",
  roadBuffer: "#d99a5b",
  riparian: "#62bfc3",
  hazard: "#d97b7b",
  energy: "#d9c95e",
  ink: "#e8e8ea",
  ink2: "#a4a4aa",
  ink3: "#70707a",
  chipBg: "rgba(20, 20, 22, 0.85)",
  chipLine: "#3a3a40",
};

const BASEMAP_BG: Record<BasemapMode, string> = {
  dark: "#161619",
  satellite: "#15181a",
  viirs: "#0a0a0d",
  cad: "#f7f7f5",
};

interface PlacedRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const MapCanvas2D: React.FC<MapCanvas2DProps> = ({
  result,
  selectedPointIds = [],
  onSelectPoint,
  onCursorReadout,
  onScaleChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Viewport transformation
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [, setCursorTick] = useState(0); // triggers cursor readout reporting

  const activeEpsg = useMemo(() => crsEpsgFromMetadata(result.metadata.crs), [result.metadata.crs]);

  // Basemap & Layer toggles
  const [basemap, setBasemap] = useState<BasemapMode>("dark");
  const [layerItems, setLayerItems] = useState<LayerItem[]>(DEFAULT_LAYERS);

  const layerMap = useMemo(() => {
    const map: Record<string, LayerItem> = {};
    for (const l of layerItems) map[l.id] = l;
    return map;
  }, [layerItems]);

  const layers = useMemo(
    () => ({
      boundary: layerMap.boundary?.visible ?? true,
      bearings: layerMap.bearings?.visible ?? true,
      beacons: layerMap.beacons?.visible ?? true,
      roads: layerMap.roads?.visible ?? true,
      roadBuffer: layerMap.roadBuffer?.visible ?? true,
      riparianBuffer: layerMap.riparianBuffer?.visible ?? true,
      rivers: layerMap.rivers?.visible ?? true,
      tin: layerMap.tin?.visible ?? false,
      contours: layerMap.contours?.visible ?? true,
      suitability: layerMap.suitability?.visible ?? false,
      hazards: layerMap.hazards?.visible ?? true,
      energy: layerMap.energy?.visible ?? true,
    }),
    [layerMap]
  );

  const isCad = basemap === "cad";

  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [showToolbox, setShowToolbox] = useState(false);

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
    const cw = canvasRef.current.getBoundingClientRect().width;
    const ch = canvasRef.current.getBoundingClientRect().height;
    const spanE = bounds.maxE - bounds.minE || 100;
    const spanN = bounds.maxN - bounds.minN || 100;

    const pad = 1.35;
    const scaleX = cw / (spanE * pad);
    const scaleY = ch / (spanN * pad);
    const fitScale = Math.max(scaleX, scaleY) === 0 ? 1 : Math.min(scaleX, scaleY);

    setZoom(fitScale);
    setPan({
      x: cw / 2 - bounds.midE * fitScale,
      y: ch / 2 + bounds.midN * fitScale,
    });
  };

  useEffect(() => {
    handleFitBounds();
  }, [bounds]);

  // Report view scale to the global status bar (96 dpi assumption)
  useEffect(() => {
    onScaleChange?.(3779.5 / Math.max(zoom, 1e-6));
  }, [zoom, onScaleChange]);

  // Transform helpers
  const toScreenX = (e: number) => e * zoom + pan.x;
  const toScreenY = (n: number) => -n * zoom + pan.y;
  const toWorldE = (sx: number) => (sx - pan.x) / zoom;
  const toWorldN = (sy: number) => -(sy - pan.y) / zoom;

  /* ---------------- Render loop ---------------- */
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

    /* 1. Basemap */
    ctx.fillStyle = BASEMAP_BG[basemap];
    ctx.fillRect(0, 0, w, h);
    if (basemap === "satellite") {
      ctx.fillStyle = "rgba(38, 66, 48, 0.16)";
      ctx.fillRect(0, 0, w, h);
    } else if (basemap === "viirs") {
      const grad = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w / 1.4);
      grad.addColorStop(0, "rgba(217, 164, 65, 0.07)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }

    /* 2. Graticule — powers-of-ten grid, mono labels with collision spacing */
    const graticuleStep = Math.max(10, Math.pow(10, Math.floor(Math.log10(160 / zoom))));
    const minVisE = toWorldE(0);
    const maxVisE = toWorldE(w);
    const minVisN = toWorldN(h);
    const maxVisN = toWorldN(0);

    ctx.lineWidth = 0.5;
    ctx.strokeStyle = isCad ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.045)";
    ctx.font = "9px 'IBM Plex Mono', monospace";
    ctx.fillStyle = isCad ? "#8a8a90" : "#5b5b62";

    // Draw edge labels only when they have generous breathing room
    let lastELabelX = -Infinity;
    for (let e = Math.floor(minVisE / graticuleStep) * graticuleStep; e <= maxVisE; e += graticuleStep) {
      const sx = Math.round(toScreenX(e)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
      ctx.stroke();
      if (sx - lastELabelX >= 90) {
        ctx.textAlign = "left";
        ctx.fillText(`${e.toLocaleString()} E`, sx + 4, h - 22);
        lastELabelX = sx + 4 + ctx.measureText(`${e.toLocaleString()} E`).width;
      }
    }

    let lastNLabelY = -Infinity;
    for (let n = Math.floor(minVisN / graticuleStep) * graticuleStep; n <= maxVisN; n += graticuleStep) {
      const sy = Math.round(toScreenY(n)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
      ctx.stroke();
      if (lastNLabelY === -Infinity || sy - lastNLabelY >= 18) {
        ctx.textAlign = "left";
        ctx.fillText(`${n.toLocaleString()} N`, 38, sy - 4); // clear of the tool rail
        lastNLabelY = sy;
      }
    }
    ctx.textAlign = "center";

    /* 3. MCDA suitability cells */
    if (layers.suitability && result.suitability.length > 0) {
      const cellPx = Math.max(8, 25 * zoom);
      for (const cell of result.suitability) {
        const sx = toScreenX(cell.x);
        const sy = toScreenY(cell.y);
        let color: string;
        switch (cell.category) {
          case "optimal": color = "rgba(111, 176, 124, 0.42)"; break;
          case "suitable": color = "rgba(111, 176, 124, 0.30)"; break;
          case "moderate": color = "rgba(217, 164, 65, 0.30)"; break;
          case "restricted": color = "rgba(217, 123, 123, 0.34)"; break;
          default: color = "rgba(160, 60, 60, 0.42)";
        }
        ctx.fillStyle = color;
        ctx.fillRect(sx - cellPx / 2, sy - cellPx / 2, cellPx, cellPx);
      }
    }

    /* 4. Corridor buffers */
    if (layers.roadBuffer || layers.riparianBuffer) {
      for (const buf of result.buffers) {
        const isRiparian = buf.featureName.includes("Reserve") && buf.reserveWidthM >= 30;
        if (isRiparian && !layers.riparianBuffer) continue;
        if (!isRiparian && !layers.roadBuffer) continue;

        ctx.fillStyle = isRiparian ? "rgba(98, 191, 195, 0.09)" : "rgba(217, 154, 91, 0.09)";
        ctx.strokeStyle = isRiparian ? "rgba(98, 191, 195, 0.55)" : "rgba(217, 154, 91, 0.55)";
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);

        const drawPolygon = (pts1: [number, number][], pts2: [number, number][]) => {
          if (pts1.length < 2 || pts2.length < 2) return;
          ctx.beginPath();
          ctx.moveTo(toScreenX(pts1[0][0]), toScreenY(pts1[0][1]));
          for (let i = 1; i < pts1.length; i++) ctx.lineTo(toScreenX(pts1[i][0]), toScreenY(pts1[i][1]));
          for (let i = pts2.length - 1; i >= 0; i--) ctx.lineTo(toScreenX(pts2[i][0]), toScreenY(pts2[i][1]));
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        };
        drawPolygon(buf.leftOffset, buf.rightOffset);
        ctx.setLineDash([]);
      }
    }

    /* 5. TIN wireframe */
    if (layers.tin && result.tin) {
      ctx.strokeStyle = isCad ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.07)";
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

    /* 6. Contours — minor/major hierarchy */
    if (layers.contours) {
      for (const c of result.contours) {
        ctx.strokeStyle = c.isMajor ? C.contourMajor : C.contourMinor;
        ctx.globalAlpha = c.isMajor ? 0.9 : 0.55;
        ctx.lineWidth = c.isMajor ? 1.3 : 0.7;
        ctx.beginPath();
        c.points.forEach((pt, idx) => {
          const sx = toScreenX(pt[0]);
          const sy = toScreenY(pt[1]);
          if (idx === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    /* 7. Feature vectors */
    for (const vec of result.vectors) {
      if (vec.category === "boundary") continue;
      if (vec.category === "road" && !layers.roads) continue;
      if (vec.category === "water" && !layers.rivers) continue;

      ctx.strokeStyle = vec.color;
      ctx.globalAlpha = isCad ? 0.9 : 0.85;
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
      ctx.globalAlpha = 1;
    }

    /* 8. Cadastral boundary polygon */
    if (layers.boundary && result.boundary) {
      const b = result.boundary;
      ctx.fillStyle = C.boundaryFill;
      ctx.strokeStyle = C.boundary;
      ctx.lineWidth = 2;

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

      /* Bearing/distance annotations — drawn in the label pass below */
    }

    /* 9. Hazard sinks — cartographic: hatched impact disc + ring, no cartoon blobs */
    const hazardGeoms: { x: number; y: number; r: number; depth: number }[] = [];
    if (layers.hazards) {
      for (const sink of result.hazardSinks) {
        const sx = toScreenX(sink.center[0]);
        const sy = toScreenY(sink.center[1]);
        const r = Math.min(34, Math.max(10, sink.depthM * 10 * zoom));
        hazardGeoms.push({ x: sx, y: sy, r, depth: sink.depthM });

        // hatch pattern
        const pc = document.createElement("canvas");
        pc.width = 6; pc.height = 6;
        const pg = pc.getContext("2d");
        if (pg) {
          pg.strokeStyle = "rgba(217, 123, 123, 0.5)";
          pg.lineWidth = 1;
          pg.beginPath();
          pg.moveTo(-1, 7); pg.lineTo(7, -1);
          pg.moveTo(-1, 1); pg.lineTo(1, -1);
          pg.stroke();
          const pattern = ctx.createPattern(pc, "repeat");
          if (pattern) {
            ctx.beginPath();
            ctx.arc(sx, sy, r, 0, 2 * Math.PI);
            ctx.fillStyle = pattern;
            ctx.fill();
          }
        }

        ctx.strokeStyle = "rgba(217, 123, 123, 0.85)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, 2 * Math.PI);
        ctx.stroke();

        // impact ring
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = "rgba(217, 123, 123, 0.35)";
        ctx.beginPath();
        ctx.arc(sx, sy, r + 6, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    /* 10. Energy clusters */
    if (layers.energy) {
      for (const ec of result.energyClusters) {
        const sx = toScreenX(ec.centroid[0]);
        const sy = toScreenY(ec.centroid[1]);
        const r = Math.min(40, Math.max(14, (ec.clusterRadiusM / 10) * zoom));

        ctx.fillStyle = "rgba(217, 201, 94, 0.07)";
        ctx.strokeStyle = "rgba(217, 201, 94, 0.6)";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    /* 11. Survey points / beacons (geometry only — labels in pass below) */
    if (layers.beacons) {
      for (const pt of result.points) {
        const sx = toScreenX(pt.easting);
        const sy = toScreenY(pt.northing);
        const isSelected = selectedPointIds.includes(pt.id);
        const isBnd = pt.category === "boundary";

        if (isSelected) {
          ctx.beginPath();
          ctx.arc(sx, sy, 7, 0, 2 * Math.PI);
          ctx.fillStyle = "rgba(217, 164, 65, 0.18)";
          ctx.fill();
          ctx.strokeStyle = C.selected;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        ctx.fillStyle = isSelected ? C.selected : isBnd ? C.beaconBoundary : C.beaconOther;
        ctx.beginPath();
        ctx.arc(sx, sy, isBnd ? 4 : 2.8, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = isCad ? "#ffffff" : "#161619";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    /* ---------------- Label pass — greedy collision avoidance ----------------
       Priority order: bearing badges > selected points > boundary beacons >
       other beacons > contour labels > hazard tags > energy tags.
       Lower-priority labels that would overlap are suppressed. */
    const placed: PlacedRect[] = [];
    const tryPlace = (cx: number, cy: number, wPx: number, hPx: number): boolean => {
      const r: PlacedRect = { x1: cx - wPx / 2, y1: cy - hPx / 2, x2: cx + wPx / 2, y2: cy + hPx / 2 };
      for (const p of placed) {
        if (r.x1 < p.x2 && r.x2 > p.x1 && r.y1 < p.y2 && r.y2 > p.y1) return false;
      }
      placed.push(r);
      return true;
    };

    ctx.textAlign = "center";

    /* P1 — bearing & distance badges */
    if (layers.boundary && layers.bearings && result.boundary) {
      const b = result.boundary;
      ctx.font = "8.5px 'IBM Plex Mono', monospace";
      for (const bd of b.bearingsDistances) {
        const p1 = b.points.find((p) => p.id === bd.fromId);
        const p2 = b.points.find((p) => p.id === bd.toId);
        if (!p1 || !p2) continue;

        // offset badge perpendicular from the line midpoint
        const mx = (toScreenX(p1.easting) + toScreenX(p2.easting)) / 2;
        const my = (toScreenY(p1.northing) + toScreenY(p2.northing)) / 2;
        const dx = toScreenX(p2.easting) - toScreenX(p1.easting);
        const dy = toScreenY(p2.northing) - toScreenY(p1.northing);
        const len = Math.hypot(dx, dy) || 1;
        const off = 16;
        const px = mx + (-dy / len) * off;
        const py = my + (dx / len) * off;

        if (!tryPlace(px, py, 78, 24)) continue;

        ctx.fillStyle = C.chipBg;
        ctx.strokeStyle = C.chipLine;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(px - 38, py - 11, 76, 22, 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isCad ? "#3a3a40" : C.ink;
        ctx.fillText(bd.bearingDms, px, py - 1.5);
        ctx.fillStyle = C.boundary;
        ctx.fillText(`${bd.distanceM.toFixed(1)} m`, px, py + 8);
      }
    }

    /* P2/P3/P4 — beacon labels */
    if (layers.beacons) {
      const ordered: SurveyPoint[] = [
        ...result.points.filter((p) => selectedPointIds.includes(p.id)),
        ...result.points.filter((p) => !selectedPointIds.includes(p.id) && p.category === "boundary"),
        ...result.points.filter((p) => !selectedPointIds.includes(p.id) && p.category !== "boundary"),
      ];
      for (const pt of ordered) {
        const sx = toScreenX(pt.easting);
        const sy = toScreenY(pt.northing);
        const isSelected = selectedPointIds.includes(pt.id);
        const lw = ctx.measureText(pt.id).width;
        if (!tryPlace(sx + 6 + lw / 2, sy - 7, lw + 10, 12)) continue;

        ctx.font = isSelected
          ? "600 9px 'IBM Plex Mono', monospace"
          : "8.5px 'IBM Plex Mono', monospace";
        ctx.textAlign = "left";
        ctx.fillStyle = isSelected ? C.selected : isCad ? "#3a3a40" : C.ink2;
        ctx.fillText(pt.id, sx + 6, sy - 4);
        ctx.textAlign = "center";
      }
    }

    /* P5 — major contour elevation labels */
    if (layers.contours) {
      ctx.font = "8.5px 'IBM Plex Mono', monospace";
      for (const c of result.contours) {
        if (!c.isMajor || c.points.length < 6) continue;
        const midPt = c.points[Math.floor(c.points.length / 2)];
        const lx = toScreenX(midPt[0]);
        const ly = toScreenY(midPt[1]);
        const text = `${c.elevation} m`;
        if (!tryPlace(lx, ly, 40, 12)) continue;
        ctx.fillStyle = isCad ? "#8a6a3a" : C.contourMajor;
        ctx.fillText(text, lx, ly - 3);
      }
    }

    /* P6 — hazard tags */
    if (layers.hazards) {
      ctx.font = "8.5px 'IBM Plex Mono', monospace";
      for (const hz of hazardGeoms) {
        const tx = hz.x + hz.r + 8;
        const text = `sink −${hz.depth} m`;
        const tw = ctx.measureText(text).width;
        if (!tryPlace(tx + tw / 2, hz.y, tw + 10, 14)) continue;
        ctx.textAlign = "left";
        ctx.fillStyle = C.hazard;
        ctx.fillText(text, tx, hz.y + 3);
        ctx.textAlign = "center";
      }
    }

    /* P7 — energy tags */
    if (layers.energy) {
      ctx.font = "8.5px 'IBM Plex Mono', monospace";
      for (const ec of result.energyClusters) {
        const sx = toScreenX(ec.centroid[0]);
        const sy = toScreenY(ec.centroid[1]);
        const r = Math.min(40, Math.max(14, (ec.clusterRadiusM / 10) * zoom));
        const text = `${ec.recommendedType} · ${ec.recommendedSolarKw} kWp · ${ec.householdCount} HH`;
        const tw = ctx.measureText(text).width;
        if (!tryPlace(sx + r + 6 + tw / 2, sy, tw + 12, 14)) continue;
        ctx.textAlign = "left";
        ctx.fillStyle = C.energy;
        ctx.fillText(text, sx + r + 8, sy + 3);
        ctx.textAlign = "center";
      }
    }

    /* ---------------- Cartographic furniture ---------------- */

    /* North arrow — minimal, bottom-right */
    ctx.save();
    ctx.translate(w - 28, h - 78);
    ctx.strokeStyle = isCad ? "#3a3a40" : C.ink2;
    ctx.fillStyle = isCad ? "#3a3a40" : C.ink2;
    ctx.lineWidth = 1;
    // needle
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(3.5, 4);
    ctx.lineTo(0, 1.5);
    ctx.lineTo(-3.5, 4);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(0, 10);
    ctx.stroke();
    ctx.font = "600 9px 'IBM Plex Sans', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("N", 0, -16);
    ctx.restore();

    /* Scale bar — rounded nice value, anchored bottom-left */
    const niceCandidates = [1, 2, 5].flatMap((m) => [1, 2, 5].map((k) => k * Math.pow(10, m)));
    const allCandidates = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
    let barM = 100;
    for (const cand of allCandidates) {
      const px = cand * zoom;
      if (px >= 60 && px <= 190) { barM = cand; break; }
      void niceCandidates;
    }
    const barPx = barM * zoom;
    if (barPx > 20) {
      const bx = 16;
      const by = h - 26;
      ctx.save();
      // alternating fills
      ctx.fillStyle = isCad ? "#3a3a40" : C.ink;
      ctx.fillRect(bx, by, barPx / 2, 3);
      ctx.fillStyle = isCad ? "rgba(58,58,64,0.25)" : "rgba(232,232,234,0.35)";
      ctx.fillRect(bx + barPx / 2, by, barPx / 2, 3);
      // end ticks
      ctx.fillStyle = isCad ? "#3a3a40" : C.ink;
      ctx.fillRect(bx, by - 2, 1, 7);
      ctx.fillRect(bx + barPx, by - 2, 1, 7);
      ctx.font = "9px 'IBM Plex Mono', monospace";
      ctx.textAlign = "left";
      ctx.fillText("0", bx - 2, by - 5);
      ctx.textAlign = "center";
      ctx.fillText(`${barM / 2}`, bx + barPx / 2, by - 5);
      ctx.textAlign = "right";
      ctx.fillText(`${barM} m`, bx + barPx + 2, by - 5);
      ctx.restore();
    }
  }, [zoom, pan, basemap, layers, result, selectedPointIds, isCad]);

  /* ---------------- Interactions ---------------- */
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

    // Elevation from nearest vertex within the TIN footprint
    let nearestElev = 0;
    let minD = Infinity;
    for (const p of result.points) {
      const d = Math.hypot(p.easting - worldE, p.northing - worldN);
      if (d < minD) {
        minD = d;
        nearestElev = p.elevation;
      }
    }

    let lat = 0, lon = 0;
    try {
      [lon, lat] = toWGS84(activeEpsg, worldE, worldN);
    } catch {
      /* geographic readout unavailable */
    }

    onCursorReadout?.({
      easting: worldE,
      northing: worldN,
      elevation: nearestElev,
      lat,
      lon,
    });
    setCursorTick((t) => t + 1);

    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleMouseLeave = () => {
    setIsDragging(false);
    onCursorReadout?.(null);
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSelectPoint) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let bestId: string | null = null;
    let bestD = 10; // px hit radius
    for (const p of result.points) {
      const d = Math.hypot(toScreenX(p.easting) - mx, toScreenY(p.northing) - my);
      if (d < bestD) {
        bestD = d;
        bestId = p.id;
      }
    }
    if (bestId) onSelectPoint(bestId);
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    const newZoom = Math.max(0.005, Math.min(200, zoom * zoomFactor));

    setPan({
      x: mouseX - (mouseX - pan.x) * (newZoom / zoom),
      y: mouseY - (mouseY - pan.y) * (newZoom / zoom),
    });
    setZoom(newZoom);
  };

  const basemapOptions: { id: BasemapMode; label: string }[] = [
    { id: "dark", label: "Dark" },
    { id: "satellite", label: "Aerial" },
    { id: "viirs", label: "Night" },
    { id: "cad", label: "CAD" },
  ];

  return (
    <div className="relative w-full h-full bg-sunken overflow-hidden">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        onWheel={handleWheel}
        className="w-full h-full block cursor-crosshair"
        style={{ outline: "none" }}
      />

      {/* Docked tool rail — left */}
      <div className="absolute top-3 left-3 z-10 flex flex-col items-center bg-panel border border-line rounded-[4px] shadow-lg p-0.5 gap-0.5">
        <button className="ui-btn-icon" onClick={() => setZoom((z) => Math.min(z * 1.25, 200))} title="Zoom in">
          <ZoomIn className="w-4 h-4" />
        </button>
        <button className="ui-btn-icon" onClick={() => setZoom((z) => Math.max(z * 0.8, 0.005))} title="Zoom out">
          <ZoomOut className="w-4 h-4" />
        </button>
        <button className="ui-btn-icon" onClick={handleFitBounds} title="Fit to extents">
          <Maximize2 className="w-4 h-4" />
        </button>
        <div className="w-5 h-px bg-line-strong my-0.5" />
        <button
          className={`ui-btn-icon ${showLayerPanel ? "is-active" : ""}`}
          onClick={() => { setShowLayerPanel((v) => !v); setShowToolbox(false); }}
          title="Layers"
        >
          <Layers className="w-4 h-4" />
        </button>
        <button
          className={`ui-btn-icon ${showToolbox ? "is-active" : ""}`}
          onClick={() => { setShowToolbox((v) => !v); setShowLayerPanel(false); }}
          title="Geoprocessing toolbox"
        >
          <Wrench className="w-4 h-4" />
        </button>
        <div className="w-5 h-px bg-line-strong my-0.5" />
        <div className="ui-btn-icon cursor-default" title="Pan / navigate — drag to pan, scroll to zoom, click beacon to select">
          <MousePointer2 className="w-4 h-4" />
        </div>
      </div>

      {/* Basemap switcher — top right, segmented */}
      <div className="absolute top-3 right-3 z-10 flex items-center bg-panel border border-line rounded-[4px] shadow-lg overflow-hidden">
        <span className="ui-label px-2 border-r border-line">Basemap</span>
        <div className="flex">
          {basemapOptions.map((o) => (
            <button
              key={o.id}
              onClick={() => setBasemap(o.id)}
              className={`px-2.5 h-7 text-[11px] font-medium transition-colors cursor-pointer ${
                basemap === o.id
                  ? "bg-raised text-ink"
                  : "text-ink-3 hover:text-ink-2"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Layer manager — docked left */}
      {showLayerPanel && (
        <div className="absolute top-[calc(0.75rem+192px)] left-3 z-30 shadow-2xl">
          <LayerPanel
            layers={layerItems}
            onChangeLayers={setLayerItems}
            onZoomToLayer={handleFitBounds}
            onClose={() => setShowLayerPanel(false)}
          />
        </div>
      )}

      {/* Geoprocessing toolbox — docked right */}
      {showToolbox && (
        <div className="absolute top-3 right-3 z-30 shadow-2xl">
          <ToolboxPanel pipeline={result} onClose={() => setShowToolbox(false)} />
        </div>
      )}
    </div>
  );
};
