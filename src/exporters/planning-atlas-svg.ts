/**
 * Regional Planning Atlas Sheet Vector Composer — print-first A3 landscape.
 * All figures derived from computed pipeline results; no fabricated indicators.
 * Methodology refs: see methodology-registry.ts (suitability frameworks).
 */

import { PipelineResult } from "../types/spatial";

export function generatePlanningAtlasSvg(result: PipelineResult): string {
  const width = 1200;
  const height = 850;
  const meta = result.metadata;
  const b = result.boundary;

  const totalCells = result.suitability.length || 1;
  const optimalCount = result.suitability.filter((c) => c.category === "optimal").length;
  const suitableCount = result.suitability.filter((c) => c.category === "suitable").length;
  const moderateCount = result.suitability.filter((c) => c.category === "moderate").length;
  const restrictedCount = result.suitability.filter((c) => c.category === "restricted").length;
  const hazardCount = result.suitability.filter((c) => c.category === "hazard").length;

  const optimalPct = Math.round((optimalCount / totalCells) * 100);
  const suitablePct = Math.round((suitableCount / totalCells) * 100);
  const moderatePct = Math.round((moderateCount / totalCells) * 100);
  const restrictedPct = Math.round((restrictedCount / totalCells) * 100);
  const hazardPct = Math.round((hazardCount / totalCells) * 100);

  const areaHa = b?.areaHa ?? 0;
  const buildableHa = ((optimalPct + suitablePct) / 100 * areaHa).toFixed(2);
  const totalHh = result.energyClusters.reduce((s, c) => s + c.householdCount, 0);
  const totalCapex = result.energyClusters.reduce((s, c) => s + c.capexEstimateUsd, 0);

  /* ---- Map projection for the choropleth (spatially truthful) ---- */
  const mapLeft = 30;
  const mapTop = 210;
  const mapW = 640;
  const mapH = 400;

  // Bounds from suitability cells (they blanket the parcel extent)
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  for (const c of result.suitability) {
    if (c.x < minE) minE = c.x;
    if (c.x > maxE) maxE = c.x;
    if (c.y < minN) minN = c.y;
    if (c.y > maxN) maxN = c.y;
  }
  if (!isFinite(minE)) { minE = 0; maxE = 100; minN = 0; maxN = 100; }
  const spanE = maxE - minE || 1;
  const spanN = maxN - minN || 1;
  // Cell footprint in world units (regular grid assumed)
  const cellW = spanE / Math.sqrt(totalCells);
  const cellH = spanN / Math.sqrt(totalCells);
  const projX = (e: number) => mapLeft + ((e - minE) / spanE) * mapW;
  const projY = (n: number) => mapTop + mapH - ((n - minN) / spanN) * mapH;
  const cellPx = Math.max(2, (mapW / spanE) * cellW);

  // RdYlGn-derived suitability ramp (ColorBrewer), print-safe
  const classFill: Record<string, string> = {
    optimal: "#4d9a51",
    suitable: "#a3c95a",
    moderate: "#f2c257",
    restricted: "#e08b52",
    hazard: "#c85a4f",
  };

  // Boundary path over the choropleth
  let boundaryPath = "";
  if (b && b.points.length >= 3) {
    boundaryPath = b.points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${projX(p.easting).toFixed(1)} ${projY(p.northing).toFixed(1)}`)
      .join(" ") + " Z";
  }

  const kpiY = 118;
  const kpi = (x: number, w: number, label: string, value: string, sub: string) => `
    <rect x="${x}" y="${kpiY}" width="${w}" height="58" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1"/>
    <line x1="${x}" y1="${kpiY}" x2="${x}" y2="${kpiY + 58}" stroke="#0F172A" stroke-width="2.5"/>
    <text x="${x + 14}" y="${kpiY + 18}" font-size="8" font-weight="700" fill="#64748B" letter-spacing="1">${label}</text>
    <text x="${x + 14}" y="${kpiY + 42}" font-size="20" font-weight="700" fill="#0F172A" font-family="monospace">${value}</text>
    <text x="${x + 14 + value.length * 12}" y="${kpiY + 42}" font-size="9" fill="#64748B">${sub}</text>
  `;

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background-color: #FFFFFF; font-family: 'IBM Plex Sans', 'Segoe UI', Arial, sans-serif;">
  <defs>
    <clipPath id="mapClip">
      <rect x="${mapLeft}" y="${mapTop}" width="${mapW}" height="${mapH}"/>
    </clipPath>
  </defs>
  <!-- Sheet frame -->
  <rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF"/>
  <rect x="20" y="20" width="${width - 40}" height="${height - 40}" fill="none" stroke="#0F172A" stroke-width="1.5"/>
  <rect x="26" y="26" width="${width - 52}" height="${height - 52}" fill="none" stroke="#94A3B8" stroke-width="0.5"/>

  <!-- Header -->
  <g transform="translate(48, 72)">
    <text x="0" y="0" font-size="17" font-weight="700" fill="#0F172A" letter-spacing="0.5">REGIONAL PLANNING ATLAS</text>
    <text x="0" y="18" font-size="10" fill="#475569">Settlement suitability &amp; hazard exposure dossier — ${meta.title}</text>
    <text x="${width - 96}" y="0" font-size="9" fill="#64748B" text-anchor="end">Locality: ${meta.locality} · ${meta.country}</text>
    <text x="${width - 96}" y="15" font-size="9" font-family="monospace" fill="#64748B" text-anchor="end">CRS: ${meta.crs} · Date: ${meta.date}</text>
    <line x1="0" y1="28" x2="${width - 96}" y2="28" stroke="#0F172A" stroke-width="1"/>
  </g>

  <!-- KPI strip (all values computed) -->
  ${kpi(48, 258, "BUILDABLE ENVELOPE", `${buildableHa}`, `ha net of ${areaHa.toFixed(2)} ha`)}
  ${kpi(318, 258, "SUITABLE + OPTIMAL CELLS", `${optimalPct + suitablePct}`, "% of evaluation grid")}
  ${kpi(588, 258, "EXPOSED ASSETS", `${result.exposedAssets.length}`, `of ${result.points.length} surveyed features`)}
  ${kpi(858, 294, "ELECTRIFICATION CAPEX", `$${Math.round(totalCapex).toLocaleString("en-US")}`, `${totalHh} HH in ${result.energyClusters.length} cluster(s)`)}

  <!-- Choropleth map window -->
  <g>
    <rect x="${mapLeft - 1}" y="${mapTop - 1}" width="${mapW + 2}" height="${mapH + 2}" fill="#FBFBFA" stroke="#94A3B8" stroke-width="1"/>
    <text x="${mapLeft}" y="${mapTop - 10}" font-size="10" font-weight="700" fill="#0F172A">MCDA SUITABILITY CHOROPLETH</text>

    <g clip-path="url(#mapClip)">
    ${result.suitability.map((c) => {
      const x = projX(c.x) - cellPx / 2;
      const y = projY(c.y) - cellPx / 2;
      const fill = classFill[c.category] || classFill.moderate;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cellPx.toFixed(1)}" height="${cellPx.toFixed(1)}" fill="${fill}" fill-opacity="0.82"/>`;
    }).join("")}

    ${boundaryPath ? `<path d="${boundaryPath}" fill="none" stroke="#0F172A" stroke-width="2" stroke-linejoin="round"/>` : ""}
    </g>

    <!-- Hazard sinks -->
    ${result.hazardSinks.map((s) => {
      const sx = projX(s.center[0]);
      const sy = projY(s.center[1]);
      return `
        <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="9" fill="none" stroke="#c85a4f" stroke-width="1.2" stroke-dasharray="2,2"/>
        <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="3" fill="#c85a4f"/>
        <text x="${(sx + 12).toFixed(1)}" y="${(sy + 3).toFixed(1)}" font-size="8" fill="#8a3a32" font-family="monospace">${s.id} −${s.depthM.toFixed(1)}m</text>
      `;
    }).join("")}

    <!-- North arrow -->
    <g transform="translate(${mapLeft + mapW - 24}, ${mapTop + 26})">
      <line x1="0" y1="10" x2="0" y2="-8" stroke="#0F172A" stroke-width="1"/>
      <polygon points="0,-12 3.5,-4 0,-6.5 -3.5,-4" fill="#0F172A"/>
      <text x="0" y="22" font-size="9" font-weight="700" fill="#0F172A" text-anchor="middle">N</text>
    </g>

    <!-- Legend -->
    <g transform="translate(${mapLeft}, ${mapTop + mapH + 22})">
      <text x="0" y="8" font-size="8.5" font-weight="700" fill="#475569">SUITABILITY CLASS</text>
      <g transform="translate(0, 16)">
        <rect x="0" y="0" width="11" height="11" fill="${classFill.optimal}"/>
        <text x="16" y="9" font-size="8.5" fill="#475569">Optimal ${optimalPct}%</text>
        <rect x="86" y="0" width="11" height="11" fill="${classFill.suitable}"/>
        <text x="102" y="9" font-size="8.5" fill="#475569">Suitable ${suitablePct}%</text>
        <rect x="172" y="0" width="11" height="11" fill="${classFill.moderate}"/>
        <text x="188" y="9" font-size="8.5" fill="#475569">Moderate ${moderatePct}%</text>
        <rect x="276" y="0" width="11" height="11" fill="${classFill.restricted}"/>
        <text x="292" y="9" font-size="8.5" fill="#475569">Restricted ${restrictedPct}%</text>
        <rect x="380" y="0" width="11" height="11" fill="${classFill.hazard}"/>
        <text x="396" y="9" font-size="8.5" fill="#475569">Hazard ${hazardPct}%</text>
      </g>
      <text x="470" y="25" font-size="8" fill="#94A3B8" font-family="monospace">20 × 20 grid · weighted slope / road / riparian criteria</text>
    </g>
  </g>

  <!-- Right column: exposure + energy + method -->
  <g transform="translate(710, 210)">
    <!-- Hazard exposure schedule -->
    <text x="0" y="0" font-size="10" font-weight="700" fill="#0F172A">HAZARD EXPOSURE SCHEDULE</text>
    <rect x="0" y="10" width="442" height="24" fill="#EEF1F4"/>
    <text x="8" y="25" font-size="8" font-weight="700" fill="#475569">ASSET</text>
    <text x="220" y="25" font-size="8" font-weight="700" fill="#475569">RISK</text>
    <text x="268" y="25" font-size="8" font-weight="700" fill="#475569">ELEV (MSL)</text>
    <text x="352" y="25" font-size="8" font-weight="700" fill="#475569">DIST TO SINK</text>
    ${result.exposedAssets.slice(0, 6).map((a, i) => `
      <g transform="translate(0, ${34 + i * 20})">
        <line x1="0" y1="19" x2="442" y2="19" stroke="#E2E8F0" stroke-width="0.75"/>
        <text x="8" y="13" font-size="8.5" fill="#0F172A">${a.name}</text>
        <text x="220" y="13" font-size="8" font-weight="600" fill="${a.hazardRisk === "critical" ? "#c85a4f" : "#a06a1f"}">${a.hazardRisk.toUpperCase()}</text>
        <text x="268" y="13" font-size="8" font-family="monospace" fill="#334155">${a.elevation.toFixed(1)} m</text>
        <text x="352" y="13" font-size="8" font-family="monospace" fill="#334155">${a.distanceToSinkM} m</text>
      </g>
    `).join("")}
    ${result.exposedAssets.length === 0
      ? `<text x="8" y="50" font-size="8.5" fill="#64748B">No assets fall within a delineated inundation footprint.</text>`
      : ""}

    <!-- Electrification schedule -->
    <g transform="translate(0, 180)">
      <text x="0" y="0" font-size="10" font-weight="700" fill="#0F172A">ELECTRIFICATION PROGRAMME</text>
      <rect x="0" y="10" width="442" height="24" fill="#EEF1F4"/>
      <text x="8" y="25" font-size="8" font-weight="700" fill="#475569">CLUSTER</text>
      <text x="120" y="25" font-size="8" font-weight="700" fill="#475569">HH</text>
      <text x="170" y="25" font-size="8" font-weight="700" fill="#475569">PV (kWp)</text>
      <text x="250" y="25" font-size="8" font-weight="700" fill="#475569">BATTERY (kWh)</text>
      <text x="360" y="25" font-size="8" font-weight="700" fill="#475569">CAPEX (USD)</text>
      ${result.energyClusters.slice(0, 5).map((c, i) => `
        <g transform="translate(0, ${34 + i * 20})">
          <line x1="0" y1="19" x2="442" y2="19" stroke="#E2E8F0" stroke-width="0.75"/>
          <text x="8" y="13" font-size="8.5" fill="#0F172A">${c.id}</text>
          <text x="120" y="13" font-size="8" font-family="monospace" fill="#334155">${c.householdCount}</text>
          <text x="170" y="13" font-size="8" font-family="monospace" fill="#334155">${c.recommendedSolarKw}</text>
          <text x="250" y="13" font-size="8" font-family="monospace" fill="#334155">${c.batteryStorageKwh}</text>
          <text x="360" y="13" font-size="8" font-family="monospace" fill="#334155">${c.capexEstimateUsd.toLocaleString("en-US")}</text>
        </g>
      `).join("")}
      ${result.energyClusters.length === 0
        ? `<text x="8" y="50" font-size="8.5" fill="#64748B">No settlement clusters met the electrification modelling thresholds.</text>`
        : ""}
    </g>

    <!-- Method & limitations note — professional practice -->
    <g transform="translate(0, 360)">
      <rect x="0" y="0" width="442" height="92" fill="#FBFBFA" stroke="#CBD5E1" stroke-width="0.75"/>
      <text x="10" y="16" font-size="8.5" font-weight="700" fill="#475569">METHOD &amp; LIMITATIONS</text>
      <text x="10" y="32" font-size="7.5" fill="#64748B">Suitability: weighted overlay (slope, road proximity, riparian setback) on a 20 × 20 grid over the parcel TIN.</text>
      <text x="10" y="45" font-size="7.5" fill="#64748B">Hazard: inundation sinks delineated from TIN low-point drainage; exposure scored by 2D distance to sink.</text>
      <text x="10" y="58" font-size="7.5" fill="#64748B">Electrification: SE4All / ESMAP multi-tier techno-economic sizing; costs are planning-level estimates.</text>
      <text x="10" y="71" font-size="7.5" fill="#64748B">Figures are decision-support estimates, not a substitute for statutory detailed design.</text>
      <text x="10" y="84" font-size="7.5" font-family="monospace" fill="#94A3B8">CRS ${meta.crs} · Prepared with MetaRDU GIS Studio · Surveyor: ${meta.surveyorName}</text>
    </g>

    <!-- Signoff -->
    <g transform="translate(0, 486)">
      <line x1="0" y1="0" x2="180" y2="0" stroke="#475569" stroke-width="1"/>
      <text x="0" y="14" font-size="8" font-weight="600" fill="#0F172A">PROGRAMME MANAGER</text>
      <text x="0" y="26" font-size="7.5" fill="#64748B">Date: ${meta.date}</text>
      <line x1="242" y1="0" x2="442" y2="0" stroke="#475569" stroke-width="1"/>
      <text x="242" y="14" font-size="8" font-weight="600" fill="#0F172A">MUNICIPAL CHIEF PLANNER</text>
      <text x="242" y="26" font-size="7.5" fill="#64748B">Statutory endorsement</text>
    </g>
  </g>

  <!-- Footer -->
  <g transform="translate(${width / 2}, ${height - 34})" text-anchor="middle">
    <text font-size="8" font-family="monospace" fill="#94A3B8">Regional Planning Atlas · A3 landscape · ${meta.crs} · Sheet 1 of 1 · ${meta.organization}</text>
  </g>
</svg>
`;
}
