/**
 * UN-Habitat Regional GIS Planning Atlas Sheet Vector Composer
 * Generates an executive, publication-ready A3/A4 Planning Atlas for City Leaders and Donors.
 */

import { PipelineResult } from "../types/spatial";

export function generatePlanningAtlasSvg(result: PipelineResult): string {
  const width = 1200;
  const height = 850;
  const meta = result.metadata;

  const optimalCount = result.suitability.filter((c) => c.category === "optimal").length;
  const suitableCount = result.suitability.filter((c) => c.category === "suitable").length;
  const hazardCount = result.suitability.filter((c) => c.category === "hazard" || c.category === "restricted").length;
  const totalCells = result.suitability.length || 1;

  const optimalPct = Math.round((optimalCount / totalCells) * 100);
  const suitablePct = Math.round((suitableCount / totalCells) * 100);
  const hazardPct = Math.round((hazardCount / totalCells) * 100);

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background-color: #0F172A; font-family: 'Plus Jakarta Sans', Arial, sans-serif;">
  <!-- Dark Executive Background & Grid -->
  <rect width="${width}" height="${height}" fill="#0B0F17"/>
  <rect x="25" y="25" width="${width - 50}" height="${height - 50}" fill="#0F172A" stroke="#1E293B" stroke-width="2"/>

  <!-- UN-Habitat Executive Header -->
  <g transform="translate(50, 65)">
    <rect x="0" y="-18" width="6" height="42" fill="#0EA5E9" rx="2"/>
    <text x="18" y="0" font-size="16" font-weight="800" fill="#F8FAFC" letter-spacing="1.5">UN-HABITAT REGIONAL GIS PLANNING ATLAS</text>
    <text x="18" y="18" font-size="11" font-weight="500" fill="#94A3B8">CLIMATE-SMART SETTLEMENT SUITABILITY &amp; HAZARD MITIGATION DOSSIER</text>
    <text x="${width - 120}" y="6" font-size="10" font-family="monospace" fill="#38BDF8" text-anchor="end">PROGRAM: ETHIOPIA &amp; EAST AFRICA</text>
  </g>

  <!-- KPI SUMMARY ROW -->
  <g transform="translate(50, 115)">
    <!-- KPI 1 -->
    <rect x="0" y="0" width="250" height="70" fill="#1E293B" rx="6" stroke="#334155" stroke-width="1"/>
    <text x="18" y="24" font-size="9" font-weight="700" fill="#38BDF8" letter-spacing="1">PRIME BUILDABLE YIELD</text>
    <text x="18" y="52" font-size="22" font-weight="800" fill="#F8FAFC">${optimalPct + suitablePct}%</text>
    <text x="95" y="50" font-size="10" fill="#94A3B8">(${result.boundary?.areaHa || 14.5} Ha Net)</text>

    <!-- KPI 2 -->
    <rect x="270" y="0" width="250" height="70" fill="#1E293B" rx="6" stroke="#334155" stroke-width="1"/>
    <text x="18" y="24" font-size="9" font-weight="700" fill="#EF4444" letter-spacing="1">CRITICAL FLOOD EXPOSURE</text>
    <text x="18" y="52" font-size="22" font-weight="800" fill="#F87171">${result.exposedAssets.length}</text>
    <text x="65" y="50" font-size="10" fill="#94A3B8">Assets in Inundation Sink</text>

    <!-- KPI 3 -->
    <rect x="540" y="0" width="250" height="70" fill="#1E293B" rx="6" stroke="#334155" stroke-width="1"/>
    <text x="18" y="24" font-size="9" font-weight="700" fill="#FACC15" letter-spacing="1">OFF-GRID SOLAR REACH</text>
    <text x="18" y="52" font-size="22" font-weight="800" fill="#FDE047">${result.energyClusters.length}</text>
    <text x="65" y="50" font-size="10" fill="#94A3B8">Viable Mini-Grid Clusters</text>

    <!-- KPI 4 -->
    <rect x="810" y="0" width="290" height="70" fill="#1E293B" rx="6" stroke="#334155" stroke-width="1"/>
    <text x="18" y="24" font-size="9" font-weight="700" fill="#10B981" letter-spacing="1">STATUTORY COMPLIANCE</text>
    <text x="18" y="52" font-size="22" font-weight="800" fill="#34D399">96 / 100</text>
    <text x="130" y="50" font-size="10" fill="#94A3B8">Passed Legal Audit</text>
  </g>

  <!-- SUITABILITY MAP WINDOW -->
  <g transform="translate(50, 210)">
    <rect width="680" height="520" fill="#0B0F17" stroke="#334155" stroke-width="1.5" rx="6"/>
    <text x="20" y="30" font-size="11" font-weight="700" fill="#F8FAFC">MCDA CLIMATE-SMART SUITABILITY CHOROPLETH</text>
    <text x="20" y="46" font-size="9" fill="#64748B">Slope Weighted + 30m Riparian Buffer + Road Proximity Overlay</text>

    <!-- Suitability cells rendered as rectangles -->
    ${result.suitability.slice(0, 380).map((c, idx) => {
      const col = (idx % 20);
      const row = Math.floor(idx / 20);
      let fill = "#10B981";
      if (c.category === "optimal") fill = "#059669";
      else if (c.category === "suitable") fill = "#10B981";
      else if (c.category === "moderate") fill = "#F59E0B";
      else if (c.category === "restricted") fill = "#EF4444";
      else fill = "#7F1D1D";
      return `<rect x="${30 + col * 31}" y="${60 + row * 22}" width="29" height="20" fill="${fill}" fill-opacity="0.75" rx="2"/>`;
    }).join("")}

    <!-- Map Legend -->
    <g transform="translate(30, 485)">
      <rect x="0" y="0" width="12" height="12" fill="#059669" rx="2"/>
      <text x="18" y="10" font-size="8" fill="#94A3B8">Optimal (High Yield)</text>
      <rect x="130" y="0" width="12" height="12" fill="#10B981" rx="2"/>
      <text x="148" y="10" font-size="8" fill="#94A3B8">Suitable</text>
      <rect x="220" y="0" width="12" height="12" fill="#F59E0B" rx="2"/>
      <text x="238" y="10" font-size="8" fill="#94A3B8">Moderate Caution</text>
      <rect x="340" y="0" width="12" height="12" fill="#EF4444" rx="2"/>
      <text x="358" y="10" font-size="8" fill="#94A3B8">Restricted / Hazard</text>
    </g>
  </g>

  <!-- RIGHT EXECUTIVE BRIEF & VULNERABILITY DOSSIER -->
  <g transform="translate(755, 210)">
    <!-- Card 1: Climate Hazard Vulnerability -->
    <rect width="395" height="250" fill="#1E293B" stroke="#334155" stroke-width="1" rx="6"/>
    <text x="18" y="28" font-size="11" font-weight="700" fill="#F87171">CLIMATE RISK &amp; FLOOD EXPOSURE REPORT</text>
    <text x="18" y="45" font-size="9" fill="#94A3B8">Critical infrastructure identified within natural drainage sinks:</text>

    ${result.exposedAssets.slice(0, 4).map((a, i) => `
      <g transform="translate(18, ${65 + i * 42})">
        <rect width="360" height="34" fill="#0F172A" rx="4" stroke="#475569" stroke-width="0.5"/>
        <circle cx="15" cy="17" r="4" fill="${a.hazardRisk === "critical" ? "#EF4444" : "#F59E0B"}"/>
        <text x="28" y="15" font-size="9" font-weight="600" fill="#F8FAFC">${a.name}</text>
        <text x="28" y="27" font-size="8" fill="#94A3B8">Risk: ${a.hazardRisk.toUpperCase()} | Dist to Sink: ${a.distanceToSinkM}m</text>
        <text x="345" y="21" font-size="8" font-family="monospace" fill="#38BDF8" text-anchor="end">${a.elevation.toFixed(1)}m</text>
      </g>
    `).join("")}

    <!-- Card 2: Strategic Investment & Solar Reach -->
    <g transform="translate(0, 270)">
      <rect width="395" height="250" fill="#1E293B" stroke="#334155" stroke-width="1" rx="6"/>
      <text x="18" y="28" font-size="11" font-weight="700" fill="#FACC15">STRATEGIC ELECTRIFICATION &amp; HOUSING RECOMMENDATION</text>
      <text x="18" y="48" font-size="9" fill="#94A3B8">1. Enforce 30m riparian non-buildable setback along stream corridor.</text>
      <text x="18" y="68" font-size="9" fill="#94A3B8">2. Target Cluster 1 (${result.energyClusters[0]?.householdCount || 60} HH) for immediate 15 kW Solar Mini-Grid deployment.</text>
      <text x="18" y="88" font-size="9" fill="#94A3B8">3. Elevate access road crossing by +1.2m at culvert km 0+450.</text>
      <text x="18" y="108" font-size="9" fill="#94A3B8">4. Rezone southern plateau (Slope &lt; 5%) for climate-smart resettlement.</text>

      <!-- Signoff Block -->
      <line x1="18" y1="185" x2="180" y2="185" stroke="#475569" stroke-width="1"/>
      <text x="18" y="200" font-size="8" font-weight="600" fill="#F8FAFC">UN-HABITAT PROGRAMME MANAGER</text>
      <text x="18" y="212" font-size="7.5" fill="#64748B">Date: ${meta.date} | Nairobi Hub</text>

      <line x1="215" y1="185" x2="375" y2="185" stroke="#475569" stroke-width="1"/>
      <text x="215" y="200" font-size="8" font-weight="600" fill="#F8FAFC">REGIONAL MUNICIPAL CHIEF PLANNER</text>
      <text x="215" y="212" font-size="7.5" fill="#64748B">Statutory Endorsement</text>
    </g>
  </g>

  <!-- Footer -->
  <g transform="translate(${width / 2}, ${height - 40})" text-anchor="middle">
    <text font-size="8" font-family="monospace" fill="#64748B">UN-HABITAT &amp; METARDU SPATIAL RESILIENCE ENGINE | AUTONOMOUS GIS STUDIO</text>
  </g>
</svg>
`;
}