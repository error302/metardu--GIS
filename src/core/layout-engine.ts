/**
 * MetaRDU GIS Studio - Cartographic Print Layout Engine (QGIS / ArcGIS Pro Parity)
 * Pure client-side sheet layout composition, metric scale calculations, and vector export.
 */

import { PipelineResult, SurveyPoint } from "../types/spatial";

export type PageFormat = "A4_LANDSCAPE" | "A4_PORTRAIT" | "A3_LANDSCAPE" | "A3_PORTRAIT" | "A1_LANDSCAPE";

export interface PageDimension {
  widthMm: number;
  heightMm: number;
  name: string;
}

export const PAGE_DIMENSIONS: Record<PageFormat, PageDimension> = {
  A4_LANDSCAPE: { widthMm: 297, heightMm: 210, name: "A4 Landscape (297 x 210 mm)" },
  A4_PORTRAIT: { widthMm: 210, heightMm: 297, name: "A4 Portrait (210 x 297 mm)" },
  A3_LANDSCAPE: { widthMm: 420, heightMm: 297, name: "A3 Landscape (420 x 297 mm)" },
  A3_PORTRAIT: { widthMm: 297, heightMm: 420, name: "A3 Portrait (297 x 420 mm)" },
  A1_LANDSCAPE: { widthMm: 841, heightMm: 594, name: "A1 Engineering Sheet (841 x 594 mm)" },
};

export interface LayoutMetadata {
  projectTitle: string;
  parcelId: string;
  locality: string;
  county: string;
  surveyorName: string;
  registrationNumber: string;
  date: string;
  scaleRatio: number; // e.g. 1000 for 1:1,000
  notes: string;
}

export interface LayoutOptions {
  format: PageFormat;
  metadata: LayoutMetadata;
  showGraticule: boolean;
  showLegend: boolean;
  showCoordinateTable: boolean;
  showScaleBar: boolean;
  showNorthArrow: boolean;
  showTitleBlock: boolean;
  showContours: boolean;
  showBuffers: boolean;
}

/**
 * Computes standard engineering scales and optimal scale ratio to fit boundary in map frame.
 */
export function calculateOptimalScale(
  points: SurveyPoint[],
  frameWidthMm: number,
  frameHeightMm: number
): number {
  if (points.length === 0) return 1000;

  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  for (const p of points) {
    if (p.easting < minE) minE = p.easting;
    if (p.easting > maxE) maxE = p.easting;
    if (p.northing < minN) minN = p.northing;
    if (p.northing > maxN) maxN = p.northing;
  }

  const spanEM = (maxE - minE) * 1.3 || 100;
  const spanNM = (maxN - minN) * 1.3 || 100;

  // Real ground meters per millimeter in frame
  const scaleE = (spanEM * 1000) / frameWidthMm;
  const scaleN = (spanNM * 1000) / frameHeightMm;
  const rawRatio = Math.max(scaleE, scaleN);

  // Snap to standard engineering scale ratios
  const standardScales = [250, 500, 1000, 1250, 1500, 2000, 2500, 5000, 10000, 20000, 50000];
  for (const s of standardScales) {
    if (s >= rawRatio) return s;
  }
  return Math.ceil(rawRatio / 1000) * 1000;
}

/**
 * Generates standalone, publication-grade Vector SVG for the complete print sheet.
 */
export function generatePrintLayoutSvg(
  result: PipelineResult,
  options: LayoutOptions
): string {
  const page = PAGE_DIMENSIONS[options.format];
  const { widthMm, heightMm } = page;
  const { metadata } = options;

  // Scale: 1 mm = 3.7795 px at 96 DPI
  const pxPerMm = 3.779528;
  const svgW = widthMm * pxPerMm;
  const svgH = heightMm * pxPerMm;

  // Margin: 12 mm
  const marginMm = 12;
  const marginPx = marginMm * pxPerMm;

  // Calculate Map Frame bounds
  const mapX = marginPx;
  const mapY = marginPx;
  const mapW = svgW * 0.65;
  const mapH = svgH - marginPx * 2;

  // Sidebar bounds (Right side)
  const sideX = mapX + mapW + 15;
  const sideW = svgW - sideX - marginPx;
  const sideY = marginPx;

  // Center of data
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  for (const p of result.points) {
    if (p.easting < minE) minE = p.easting;
    if (p.easting > maxE) maxE = p.easting;
    if (p.northing < minN) minN = p.northing;
    if (p.northing > maxN) maxN = p.northing;
  }
  const midE = (minE + maxE) / 2;
  const midN = (minN + maxN) / 2;

  // Scale ratio: 1 meter on ground = (1000 / scaleRatio) mm on sheet
  const mmPerWorldM = 1000 / metadata.scaleRatio;
  const pxPerWorldM = mmPerWorldM * pxPerMm;

  const toMapX = (e: number) => mapX + mapW / 2 + (e - midE) * pxPerWorldM;
  const toMapY = (n: number) => mapY + mapH / 2 - (n - midN) * pxPerWorldM;

  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${svgW} ${svgH}">
  <defs>
    <style>
      .sheet-bg { fill: #FFFFFF; }
      .border-outer { fill: none; stroke: #0F172A; stroke-width: 2.5; }
      .border-inner { fill: none; stroke: #0F172A; stroke-width: 1.0; }
      .map-frame-border { fill: #F8FAFC; stroke: #0F172A; stroke-width: 1.5; }
      .graticule { stroke: #E2E8F0; stroke-width: 0.75; stroke-dasharray: 4,4; }
      .text-title { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 14px; font-weight: bold; fill: #0F172A; }
      .text-subtitle { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10px; font-weight: 600; fill: #334155; }
      .text-body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 8.5px; fill: #475569; }
      .text-mono { font-family: 'Courier New', monospace; font-size: 8px; fill: #0F172A; }
      .boundary-line { fill: #3B82F614; stroke: #1D4ED8; stroke-width: 2.5; }
      .contour-major { stroke: #B45309; stroke-width: 1.2; fill: none; }
      .contour-minor { stroke: #CBD5E1; stroke-width: 0.6; fill: none; }
      .buffer-reserve { fill: #F59E0B14; stroke: #D97706; stroke-width: 1; stroke-dasharray: 4,3; }
      .buffer-riparian { fill: #06B6D414; stroke: #0891B2; stroke-width: 1; stroke-dasharray: 4,3; }
      .beacon-circle { fill: #EF4444; stroke: #FFFFFF; stroke-width: 1.2; }
      .beacon-label { font-family: monospace; font-size: 8px; font-weight: bold; fill: #0F172A; }
      .table-header { font-family: sans-serif; font-size: 8px; font-weight: bold; fill: #1E293B; }
      .table-cell { font-family: monospace; font-size: 7.5px; fill: #334155; }
    </style>
  </defs>

  <!-- Sheet Background -->
  <rect x="0" y="0" width="${svgW}" height="${svgH}" class="sheet-bg" />

  <!-- Sheet Outer Border -->
  <rect x="8" y="8" width="${svgW - 16}" height="${svgH - 16}" class="border-outer" />
  <rect x="12" y="12" width="${svgW - 24}" height="${svgH - 24}" class="border-inner" />

  <!-- Map Frame Background & Border -->
  <rect x="${mapX}" y="${mapY}" width="${mapW}" height="${mapH}" class="map-frame-border" />
`;

  // Graticule Lines
  if (options.showGraticule) {
    const stepM = 100;
    const minVisE = midE - (mapW / 2) / pxPerWorldM;
    const maxVisE = midE + (mapW / 2) / pxPerWorldM;
    const minVisN = midN - (mapH / 2) / pxPerWorldM;
    const maxVisN = midN + (mapH / 2) / pxPerWorldM;

    const startE = Math.floor(minVisE / stepM) * stepM;
    for (let e = startE; e <= maxVisE; e += stepM) {
      const x = toMapX(e);
      if (x >= mapX && x <= mapX + mapW) {
        svg += `  <line x1="${x}" y1="${mapY}" x2="${x}" y2="${mapY + mapH}" class="graticule" />\n`;
        svg += `  <text x="${x + 2}" y="${mapY + mapH - 4}" class="text-mono">${e}m E</text>\n`;
      }
    }

    const startN = Math.floor(minVisN / stepM) * stepM;
    for (let n = startN; n <= maxVisN; n += stepM) {
      const y = toMapY(n);
      if (y >= mapY && y <= mapY + mapH) {
        svg += `  <line x1="${mapX}" y1="${y}" x2="${mapX + mapW}" y2="${y}" class="graticule" />\n`;
        svg += `  <text x="${mapX + 4}" y="${y - 2}" class="text-mono">${n}m N</text>\n`;
      }
    }
  }

  // Buffers
  if (options.showBuffers && result.buffers) {
    for (const buf of result.buffers) {
      const isRiparian = buf.featureName.includes("Reserve") && buf.reserveWidthM >= 30;
      const pts1 = buf.leftOffset;
      const pts2 = buf.rightOffset;
      if (pts1.length < 2 || pts2.length < 2) continue;

      let d = `M ${toMapX(pts1[0][0])} ${toMapY(pts1[0][1])}`;
      for (let i = 1; i < pts1.length; i++) d += ` L ${toMapX(pts1[i][0])} ${toMapY(pts1[i][1])}`;
      for (let i = pts2.length - 1; i >= 0; i--) d += ` L ${toMapX(pts2[i][0])} ${toMapY(pts2[i][1])}`;
      d += " Z";

      svg += `  <path d="${d}" class="${isRiparian ? "buffer-riparian" : "buffer-reserve"}" />\n`;
    }
  }

  // Contours
  if (options.showContours && result.contours) {
    for (const c of result.contours) {
      if (c.points.length < 2) continue;
      let d = `M ${toMapX(c.points[0][0])} ${toMapY(c.points[0][1])}`;
      for (let i = 1; i < c.points.length; i++) {
        d += ` L ${toMapX(c.points[i][0])} ${toMapY(c.points[i][1])}`;
      }
      svg += `  <path d="${d}" class="${c.isMajor ? "contour-major" : "contour-minor"}" />\n`;
    }
  }

  // Boundary Polygon
  if (result.boundary && result.boundary.points.length > 2) {
    let d = `M ${toMapX(result.boundary.points[0].easting)} ${toMapY(result.boundary.points[0].northing)}`;
    for (let i = 1; i < result.boundary.points.length; i++) {
      const p = result.boundary.points[i];
      d += ` L ${toMapX(p.easting)} ${toMapY(p.northing)}`;
    }
    d += " Z";
    svg += `  <path d="${d}" class="boundary-line" />\n`;

    // Boundary Bearing and Distance Callouts
    for (const bd of result.boundary.bearingsDistances) {
      const p1 = result.boundary.points.find((p) => p.id === bd.fromId);
      const p2 = result.boundary.points.find((p) => p.id === bd.toId);
      if (p1 && p2) {
        const mx = (toMapX(p1.easting) + toMapX(p2.easting)) / 2;
        const my = (toMapY(p1.northing) + toMapY(p2.northing)) / 2;
        svg += `  <g transform="translate(${mx}, ${my})">
          <rect x="-35" y="-10" width="70" height="20" fill="#FFFFFFEE" stroke="#334155" stroke-width="0.5" rx="2" />
          <text x="0" y="-1" text-anchor="middle" font-family="monospace" font-size="7px" fill="#0F172A">${bd.bearingDms}</text>
          <text x="0" y="7" text-anchor="middle" font-family="monospace" font-size="7px" font-weight="bold" fill="#1D4ED8">${bd.distanceM.toFixed(1)}m</text>
        </g>\n`;
      }
    }
  }

  // Survey Beacons
  for (const pt of result.points) {
    const sx = toMapX(pt.easting);
    const sy = toMapY(pt.northing);
    if (sx >= mapX && sx <= mapX + mapW && sy >= mapY && sy <= mapY + mapH) {
      const isBnd = pt.category === "boundary";
      svg += `  <circle cx="${sx}" cy="${sy}" r="${isBnd ? 3.5 : 2.5}" fill="${isBnd ? "#DC2626" : "#2563EB"}" stroke="#FFFFFF" stroke-width="1" />\n`;
      svg += `  <text x="${sx + 5}" y="${sy - 3}" class="beacon-label">${pt.id}</text>\n`;
    }
  }

  // Scale Bar (Inside map frame, bottom left)
  if (options.showScaleBar) {
    const scaleBarWorldM = 100;
    const scaleBarPx = scaleBarWorldM * pxPerWorldM;
    const sbX = mapX + 15;
    const sbY = mapY + mapH - 28;

    svg += `  <!-- Scale Bar -->
  <g transform="translate(${sbX}, ${sbY})">
    <rect x="-5" y="-15" width="${scaleBarPx + 30}" height="32" fill="#FFFFFFEE" stroke="#334155" stroke-width="0.5" rx="3" />
    <text x="0" y="-4" font-family="monospace" font-size="8px" font-weight="bold" fill="#0F172A">SCALE 1:${metadata.scaleRatio.toLocaleString()}</text>
    <rect x="0" y="2" width="${scaleBarPx / 2}" height="6" fill="#0F172A" />
    <rect x="${scaleBarPx / 2}" y="2" width="${scaleBarPx / 2}" height="6" fill="#E2E8F0" stroke="#0F172A" stroke-width="0.5" />
    <text x="0" y="18" font-family="monospace" font-size="7px" fill="#0F172A">0m</text>
    <text x="${scaleBarPx / 2 - 8}" y="18" font-family="monospace" font-size="7px" fill="#0F172A">${scaleBarWorldM / 2}m</text>
    <text x="${scaleBarPx - 10}" y="18" font-family="monospace" font-size="7px" fill="#0F172A">${scaleBarWorldM}m</text>
  </g>\n`;
  }

  // North Arrow (Inside map frame, top right)
  if (options.showNorthArrow) {
    const naX = mapX + mapW - 35;
    const naY = mapY + 35;

    svg += `  <!-- North Arrow -->
  <g transform="translate(${naX}, ${naY})">
    <circle cx="0" cy="0" r="18" fill="#FFFFFFEE" stroke="#334155" stroke-width="0.5" />
    <polygon points="0,-13 4,0 0,-2 -4,0" fill="#0F172A" />
    <polygon points="0,13 4,0 0,2 -4,0" fill="#94A3B8" />
    <text x="0" y="-15" text-anchor="middle" font-family="sans-serif" font-size="9px" font-weight="bold" fill="#0F172A">N</text>
  </g>\n`;
  }

  // Sidebar: Title Block & Certification (Top Right)
  if (options.showTitleBlock) {
    svg += `  <!-- Title Block -->
  <g transform="translate(${sideX}, ${sideY})">
    <rect x="0" y="0" width="${sideW}" height="145" fill="#F8FAFC" stroke="#0F172A" stroke-width="1.2" />
    <rect x="0" y="0" width="${sideW}" height="28" fill="#0F172A" />
    <text x="10" y="18" font-family="sans-serif" font-size="11px" font-weight="bold" fill="#FFFFFF">OFFICIAL CADASTRAL PLAN</text>

    <text x="10" y="45" class="table-header">PROJECT / PARCEL:</text>
    <text x="90" y="45" class="text-mono" font-weight="bold">${metadata.parcelId || "LR NO. 209/CADASTRAL-01"}</text>

    <text x="10" y="60" class="table-header">LOCALITY:</text>
    <text x="90" y="60" class="table-cell">${metadata.locality || "Field Survey Locality"}</text>

    <text x="10" y="75" class="table-header">COUNTY / REGION:</text>
    <text x="90" y="75" class="table-cell">${metadata.county || "East Africa Region"}</text>

    <text x="10" y="90" class="table-header">SURVEYOR:</text>
    <text x="90" y="90" class="table-cell">${metadata.surveyorName || "Licensed Land Surveyor"}</text>

    <text x="10" y="105" class="table-header">REGISTRATION NO:</text>
    <text x="90" y="105" class="text-mono">${metadata.registrationNumber || "MISK-CAD-402"}</text>

    <text x="10" y="120" class="table-header">DATE &amp; SCALE:</text>
    <text x="90" y="120" class="text-mono">${metadata.date || new Date().toISOString().split("T")[0]} | 1:${metadata.scaleRatio.toLocaleString()}</text>

    <text x="10" y="135" class="table-header">CRS / DATUM:</text>
    <text x="90" y="135" class="text-mono">${result.metadata.crs}</text>
  </g>\n`;
  }

  // Sidebar: Beacon Coordinate Schedule Table (Middle Right)
  if (options.showCoordinateTable && result.points.length > 0) {
    const tableY = sideY + 155;
    const rowH = 15;
    const maxRows = 12;
    const ptsToShow = result.points.slice(0, maxRows);

    svg += `  <!-- Beacon Coordinate Schedule -->
  <g transform="translate(${sideX}, ${tableY})">
    <rect x="0" y="0" width="${sideW}" height="${rowH * (ptsToShow.length + 1) + 8}" fill="#FFFFFF" stroke="#334155" stroke-width="0.8" />
    <rect x="0" y="0" width="${sideW}" height="${rowH}" fill="#E2E8F0" />
    <text x="8" y="11" class="table-header">BEACON</text>
    <text x="55" y="11" class="table-header">EASTING (m)</text>
    <text x="120" y="11" class="table-header">NORTHING (m)</text>
    <text x="185" y="11" class="table-header">ELEV (m)</text>
`;

    ptsToShow.forEach((p, idx) => {
      const y = (idx + 1) * rowH + 11;
      svg += `    <text x="8" y="${y}" class="text-mono" font-weight="bold">${p.id}</text>
    <text x="55" y="${y}" class="text-mono">${p.easting.toFixed(2)}</text>
    <text x="120" y="${y}" class="text-mono">${p.northing.toFixed(2)}</text>
    <text x="185" y="${y}" class="text-mono">${p.elevation.toFixed(1)}</text>\n`;
    });

    svg += `  </g>\n`;
  }

  // Sidebar: Legend Block (Bottom Right)
  if (options.showLegend) {
    const legY = svgH - marginPx - 130;
    svg += `  <!-- Legend Block -->
  <g transform="translate(${sideX}, ${legY})">
    <rect x="0" y="0" width="${sideW}" height="120" fill="#F8FAFC" stroke="#334155" stroke-width="0.8" />
    <text x="10" y="16" font-family="sans-serif" font-size="9px" font-weight="bold" fill="#0F172A">CARTOGRAPHIC LEGEND</text>

    <!-- Boundary -->
    <line x1="12" y1="32" x2="35" y2="32" stroke="#1D4ED8" stroke-width="2.5" />
    <text x="45" y="35" class="text-body">Cadastral Boundary</text>

    <!-- Beacons -->
    <circle cx="23" cy="48" r="3.5" fill="#DC2626" stroke="#FFFFFF" stroke-width="1" />
    <text x="45" y="51" class="text-body">Boundary Beacon (Iron Pin)</text>

    <!-- Major Contour -->
    <line x1="12" y1="64" x2="35" y2="64" stroke="#B45309" stroke-width="1.5" />
    <text x="45" y="67" class="text-body">Index Contour (5m)</text>

    <!-- Road Reserve -->
    <line x1="12" y1="80" x2="35" y2="80" stroke="#D97706" stroke-width="1.2" stroke-dasharray="4,2" />
    <text x="45" y="83" class="text-body">Road Reserve (15m)</text>

    <!-- Riparian Reserve -->
    <line x1="12" y1="96" x2="35" y2="96" stroke="#0891B2" stroke-width="1.2" stroke-dasharray="4,2" />
    <text x="45" y="99" class="text-body">Riparian Exclusion (30m)</text>
  </g>\n`;
  }

  svg += `</svg>`;
  return svg;
}
