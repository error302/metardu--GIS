/**
 * Statutory Survey Deed Plan (Form 4 / Mutation Sheet) Vector Composer
 * Generates an official, publication-grade vector SVG ready for direct printing or PDF conversion.
 */

import { PipelineResult } from "../types/spatial";

export function generateDeedPlanSvg(result: PipelineResult): string {
  const width = 1200;
  const height = 850;
  const b = result.boundary;
  const meta = result.metadata;

  // Calculate viewport transformation for the map window
  const mapLeft = 50;
  const mapTop = 130;
  const mapWidth = 720;
  const mapHeight = 560;

  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  const pointsToFit = b ? b.points : result.points;

  for (const p of pointsToFit) {
    if (p.easting < minE) minE = p.easting;
    if (p.easting > maxE) maxE = p.easting;
    if (p.northing < minN) minN = p.northing;
    if (p.northing > maxN) maxN = p.northing;
  }

  const rangeE = maxE - minE || 100;
  const rangeN = maxN - minN || 100;
  const padE = rangeE * 0.18;
  const padN = rangeN * 0.18;
  const boundsMinE = minE - padE;
  const boundsMaxE = maxE + padE;
  const boundsMinN = minN - padN;
  const boundsMaxN = maxN + padN;

  const scaleX = mapWidth / (boundsMaxE - boundsMinE);
  const scaleY = mapHeight / (boundsMaxN - boundsMinN);
  const scale = Math.min(scaleX, scaleY);

  const toScreenX = (e: number) => mapLeft + (e - boundsMinE) * scale;
  const toScreenY = (n: number) => mapTop + mapHeight - (n - boundsMinN) * scale;

  // Build boundary SVG path
  let boundaryPath = "";
  if (b && b.points.length >= 3) {
    boundaryPath = b.points
      .map((p, idx) => `${idx === 0 ? "M" : "L"} ${toScreenX(p.easting).toFixed(1)} ${toScreenY(p.northing).toFixed(1)}`)
      .join(" ") + " Z";
  }

  // Graticule ticks
  const graticuleLines: string[] = [];
  const stepE = Math.round(rangeE / 4 / 50) * 50 || 50;
  const stepN = Math.round(rangeN / 4 / 50) * 50 || 50;

  for (let e = Math.ceil(boundsMinE / stepE) * stepE; e <= boundsMaxE; e += stepE) {
    const sx = toScreenX(e);
    if (sx >= mapLeft && sx <= mapLeft + mapWidth) {
      graticuleLines.push(`
        <line x1="${sx.toFixed(1)}" y1="${mapTop}" x2="${sx.toFixed(1)}" y2="${mapTop + mapHeight}" stroke="#E2E8F0" stroke-width="0.75" stroke-dasharray="3,3"/>
        <text x="${sx.toFixed(1)}" y="${mapTop - 6}" font-size="9" font-family="monospace" fill="#64748B" text-anchor="middle">${e.toLocaleString()}m E</text>
        <text x="${sx.toFixed(1)}" y="${mapTop + mapHeight + 14}" font-size="9" font-family="monospace" fill="#64748B" text-anchor="middle">${e.toLocaleString()}m E</text>
      `);
    }
  }

  for (let n = Math.ceil(boundsMinN / stepN) * stepN; n <= boundsMaxN; n += stepN) {
    const sy = toScreenY(n);
    if (sy >= mapTop && sy <= mapTop + mapHeight) {
      graticuleLines.push(`
        <line x1="${mapLeft}" y1="${sy.toFixed(1)}" x2="${mapLeft + mapWidth}" y2="${sy.toFixed(1)}" stroke="#E2E8F0" stroke-width="0.75" stroke-dasharray="3,3"/>
        <text x="${mapLeft - 8}" y="${(sy + 3).toFixed(1)}" font-size="9" font-family="monospace" fill="#64748B" text-anchor="end">${n.toLocaleString()}m N</text>
      `);
    }
  }

  // Beacon Coordinate Schedule — pure SVG grid (renderer-independent, print-safe)
  const COLS = [
    { key: "beacon", label: "BEACON", w: 62, align: "start" as const },
    { key: "easting", label: "EASTING (m)", w: 68, align: "end" as const },
    { key: "northing", label: "NORTHING (m)", w: 68, align: "end" as const },
    { key: "elev", label: "H MSL (m)", w: 54, align: "end" as const },
    { key: "bearing", label: "BEARING", w: 62, align: "end" as const },
    { key: "dist", label: "DIST (m)", w: 46, align: "end" as const },
  ];
  const scheduleRows = (b?.bearingsDistances || []).map((bd) => {
    const pt = b?.points.find((p) => p.id === bd.fromId);
    return {
      beacon: bd.fromId,
      easting: pt ? pt.easting.toFixed(2) : "—",
      northing: pt ? pt.northing.toFixed(2) : "—",
      elev: pt ? pt.elevation.toFixed(2) : "—",
      bearing: bd.bearingDms,
      dist: bd.distanceM.toFixed(2),
    };
  });
  const ROW_H = 17;
  const TABLE_W = COLS.reduce((s, c) => s + c.w, 0); // 360
  const TABLE_X = 0;
  const TABLE_Y = 112;
  const TABLE_H = 24 + scheduleRows.length * ROW_H + 6;

  const scheduleCell = (
    x: number,
    w: number,
    y: number,
    text: string,
    opts: { align: "start" | "end"; bold?: boolean; mono?: boolean; fill?: string }
  ) => {
    const tx = opts.align === "end" ? x + w - 6 : x + 6;
    return `
      <text x="${tx}" y="${y}" font-size="8.5" ${opts.mono ? 'font-family="monospace"' : ''}
        ${opts.bold ? 'font-weight="700"' : ''} fill="${opts.fill || "#1E293B"}" text-anchor="${opts.align}">${text}</text>
    `;
  };

  let scheduleSvg = `
    <rect x="${TABLE_X}" y="${TABLE_Y}" width="${TABLE_W}" height="${TABLE_H}" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1"/>
    <rect x="${TABLE_X}" y="${TABLE_Y}" width="${TABLE_W}" height="22" fill="#E8EDF3"/>
    <line x1="${TABLE_X}" y1="${TABLE_Y + 22}" x2="${TABLE_X + TABLE_W}" y2="${TABLE_Y + 22}" stroke="#94A3B8" stroke-width="0.75"/>
  `;

  // header labels
  let hx = TABLE_X;
  for (const c of COLS) {
    scheduleSvg += scheduleCell(hx, c.w, TABLE_Y + 14.5, c.label, { align: c.align, bold: true, fill: "#334155", mono: false });
    if (c !== COLS[COLS.length - 1]) {
      const vx = hx + c.w;
      scheduleSvg += `<line x1="${vx}" y1="${TABLE_Y}" x2="${vx}" y2="${TABLE_Y + TABLE_H}" stroke="#E2E8F0" stroke-width="0.75"/>`;
    }
    hx += c.w;
  }

  // data rows
  scheduleRows.forEach((row, ri) => {
    const ry = TABLE_Y + 22 + ri * ROW_H;
    if (ri > 0) {
      scheduleSvg += `<line x1="${TABLE_X}" y1="${ry}" x2="${TABLE_X + TABLE_W}" y2="${ry}" stroke="#EDF1F5" stroke-width="0.75"/>`;
    }
    let cx = TABLE_X;
    for (const c of COLS) {
      scheduleSvg += scheduleCell(cx, c.w, ry + 12, (row as any)[c.key], {
        align: c.align,
        mono: c.key !== "beacon",
        bold: c.key === "beacon",
        fill: c.key === "beacon" ? "#0F172A" : "#334155",
      });
      cx += c.w;
    }
  });

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background-color: #FFFFFF; font-family: 'IBM Plex Sans', 'Segoe UI', Arial, sans-serif;">
  <defs>
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.1"/>
    </filter>
  </defs>

  <!-- Outer Statutory Border -->
  <rect x="25" y="25" width="${width - 50}" height="${height - 50}" fill="#FFFFFF" stroke="#0F172A" stroke-width="2.5"/>
  <rect x="32" y="32" width="${width - 64}" height="${height - 64}" fill="none" stroke="#64748B" stroke-width="0.75"/>

  <!-- Official Header -->
  <g transform="translate(${width / 2}, 65)" text-anchor="middle">
    <text y="0" font-size="16" font-weight="800" letter-spacing="2" fill="#0F172A">REPUBLIC OF KENYA</text>
    <text y="20" font-size="13" font-weight="700" letter-spacing="1" fill="#334155">SURVEY REGULATIONS (FORM NO. 4) — CADASTRAL MUTATION PLAN</text>
    <text y="38" font-size="10" font-weight="500" fill="#64748B">LOCALITY: ${meta.locality.toUpperCase()} | COUNTY: NAIROBI | CRS: ${meta.crs}</text>
  </g>

  <!-- Map Window Box -->
  <rect x="${mapLeft}" y="${mapTop}" width="${mapWidth}" height="${mapHeight}" fill="#F8FAFC" stroke="#0F172A" stroke-width="1.5"/>

  <!-- Graticule Lines -->
  ${graticuleLines.join("")}

  <!-- Contours in Map -->
  ${result.contours.slice(0, 40).map((c) => `
    <polyline points="${c.points.map((pt) => `${toScreenX(pt[0]).toFixed(1)},${toScreenY(pt[1]).toFixed(1)}`).join(" ")}" fill="none" stroke="${c.isMajor ? "#CBD5E1" : "#E2E8F0"}" stroke-width="${c.isMajor ? 1.2 : 0.7}"/>
  `).join("")}

  <!-- Boundary Polygon -->
  ${boundaryPath ? `<path d="${boundaryPath}" fill="#3B82F6" fill-opacity="0.08" stroke="#1D4ED8" stroke-width="3" stroke-linejoin="round"/>` : ""}

  <!-- Boundary Bearing and Distance Labels along lines -->
  ${(b?.bearingsDistances || []).map((bd) => {
    const p1 = b?.points.find((p) => p.id === bd.fromId);
    const p2 = b?.points.find((p) => p.id === bd.toId);
    if (!p1 || !p2) return "";
    const mx = (toScreenX(p1.easting) + toScreenX(p2.easting)) / 2;
    const my = (toScreenY(p1.northing) + toScreenY(p2.northing)) / 2;
    return `
      <g transform="translate(${mx.toFixed(1)}, ${my.toFixed(1)})">
        <rect x="-42" y="-10" width="84" height="18" fill="#FFFFFF" fill-opacity="0.92" rx="2" stroke="#CBD5E1" stroke-width="0.5"/>
        <text y="2" font-size="8.5" font-weight="600" font-family="monospace" fill="#1E293B" text-anchor="middle">${bd.bearingDms}</text>
        <text y="14" font-size="8" font-family="monospace" fill="#2563EB" text-anchor="middle">${bd.distanceM.toFixed(1)}m</text>
      </g>
    `;
  }).join("")}

  <!-- Beacons and Labels -->
  ${(b ? b.points : result.points).map((p) => {
    const sx = toScreenX(p.easting);
    const sy = toScreenY(p.northing);
    return `
      <g transform="translate(${sx.toFixed(1)}, ${sy.toFixed(1)})">
        <circle r="4.5" fill="#EF4444" stroke="#FFFFFF" stroke-width="1.5"/>
        <circle r="1.5" fill="#FFFFFF"/>
        <rect x="6" y="-12" width="44" height="15" fill="#0F172A" rx="2"/>
        <text x="28" y="-2" font-size="8.5" font-weight="700" fill="#FFFFFF" text-anchor="middle">${p.id}</text>
      </g>
    `;
  }).join("")}

  <!-- North Arrow (Top Right of Map) -->
  <g transform="translate(${mapLeft + mapWidth - 45}, ${mapTop + 45})">
    <circle r="22" fill="#FFFFFF" stroke="#0F172A" stroke-width="1"/>
    <polygon points="0,-18 5,0 0,-3 -5,0" fill="#0F172A"/>
    <polygon points="0,18 5,0 0,3 -5,0" fill="#94A3B8"/>
    <text y="-21" font-size="10" font-weight="800" fill="#0F172A" text-anchor="middle">N</text>
  </g>

  <!-- Metric Graphic Scale Bar -->
  <g transform="translate(${mapLeft + 20}, ${mapTop + mapHeight - 25})">
    <rect x="-8" y="-14" width="160" height="28" fill="#FFFFFF" fill-opacity="0.9" rx="3" stroke="#CBD5E1" stroke-width="0.5"/>
    <rect x="0" y="0" width="35" height="5" fill="#0F172A"/>
    <rect x="35" y="0" width="35" height="5" fill="#FFFFFF" stroke="#0F172A" stroke-width="0.5"/>
    <rect x="70" y="0" width="35" height="5" fill="#0F172A"/>
    <rect x="105" y="0" width="35" height="5" fill="#FFFFFF" stroke="#0F172A" stroke-width="0.5"/>
    <text x="0" y="-3" font-size="7.5" font-family="monospace" fill="#0F172A">0</text>
    <text x="35" y="-3" font-size="7.5" font-family="monospace" fill="#0F172A">25</text>
    <text x="70" y="-3" font-size="7.5" font-family="monospace" fill="#0F172A">50</text>
    <text x="140" y="-3" font-size="7.5" font-family="monospace" fill="#0F172A">100m</text>
  </g>

  <!-- RIGHT SIDEBAR: Beacon Coordinate Table & Statutory Certification -->
  <g transform="translate(${mapLeft + mapWidth + 20}, ${mapTop})">
    <!-- Title & Parcel Identification -->
    <rect x="0" y="0" width="360" height="75" fill="#F1F5F9" stroke="#CBD5E1" stroke-width="1" rx="4"/>
    <text x="15" y="24" font-size="12" font-weight="800" fill="#0F172A">PARCEL NO: ${b ? b.parcelNo : "LR-209/145"}</text>
    <text x="15" y="44" font-size="10" font-weight="600" fill="#334155">AREA: ${b ? b.areaHa : "0.00"} HECTARES (${b ? b.areaAcres : "0.00"} ACRES)</text>
    <text x="15" y="62" font-size="9" font-family="monospace" fill="#2563EB">PRECISION RATIO: 1:${b ? b.precisionRatio.toLocaleString() : "N/A"} (${b ? b.precisionRating : "Class A"})</text>

    <!-- Beacon Coordinate Schedule Header -->
    <text x="0" y="102" font-size="11" font-weight="700" fill="#0F172A">BEACON COORDINATE SCHEDULE (Arc 1960 UTM 37S)</text>
    ${scheduleSvg}

    <!-- Surveyor Certification Block -->
    <g transform="translate(0, 262)">
      <rect x="0" y="0" width="360" height="110" fill="#FFFFFF" stroke="#0F172A" stroke-width="1" rx="4"/>
      <text x="12" y="18" font-size="9.5" font-weight="700" fill="#0F172A">LICENSED SURVEYOR CERTIFICATE</text>
      <text x="12" y="34" font-size="8" fill="#475569">I certify that this survey was executed under my personal</text>
      <text x="12" y="46" font-size="8" fill="#475569">direction in strict compliance with the Survey Act Cap 299.</text>
      <text x="12" y="70" font-size="8.5" font-weight="600" fill="#0F172A">SURVEYOR: ${meta.surveyorName.toUpperCase()}</text>
      <text x="12" y="84" font-size="8" font-family="monospace" fill="#64748B">MIS NUMBER: ${meta.registrationNo} | DATE: ${meta.date}</text>
      <line x1="220" y1="84" x2="345" y2="84" stroke="#94A3B8" stroke-width="1"/>
      <text x="282" y="98" font-size="7.5" fill="#94A3B8" text-anchor="middle">Official Seal &amp; Signature</text>
    </g>

    <!-- Director of Surveys Approval Stamp Box -->
    <g transform="translate(0, 385)">
      <rect x="0" y="0" width="360" height="75" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1" stroke-dasharray="4,4" rx="4"/>
      <text x="180" y="24" font-size="9" font-weight="700" fill="#64748B" text-anchor="middle">DIRECTOR OF SURVEYS — LODGEMENT APPROVAL</text>
      <text x="180" y="44" font-size="8" fill="#94A3B8" text-anchor="middle">AUTHENTICATION STAMP &amp; REGISTRATION ENTRY</text>
      <text x="180" y="60" font-size="8" font-family="monospace" fill="#94A3B8" text-anchor="middle">DEED PLAN NO: DP-${meta.title}-2026</text>
    </g>
  </g>

  <!-- Bottom Metadata Footer -->
  <g transform="translate(${width / 2}, ${height - 42})" text-anchor="middle">
    <text font-size="8" font-family="monospace" fill="#94A3B8">Form No. 4 — Survey Regulations · Sheet 1 of 1 · ${meta.crs} · Composed with MetaRDU GIS Studio</text>
  </g>
</svg>
`;
}