/**
 * Print Composer v2 — SVG rendering engine.
 *
 * Renders a ComposerTemplate against a PipelineResult. Design contract
 * (UPGRADE-ROADMAP Part I): computed figures only, pure-SVG tables,
 * clipped data frames, method-and-limitations provenance, factual footers.
 * The engine has no access to any metric it cannot derive from `result`.
 */

import { PipelineResult, SurveyVector, McdaWeights } from "../../types/spatial";
import { getGeoidProvenance } from "../crs";
import { DEFAULT_MCDA_WEIGHTS } from "../mcda-suitability";
import {
  hillshadePaths, placeContourLabels, projectFacets, buildLocatorModel,
  suitabilityBreaksLines, SUITABILITY_CLASS_ORDER,
} from "../cartography";
import { buildProvenanceGraph, provenanceCompactRows } from "../provenance";
import {
  ComposerElement, ComposerMapFrame, ComposerTable, ComposerLocator, ResolveContext,
  resolveFieldValue, resolveFooter, pageDimsMm, ComposerTemplate,
} from "./template";
import { substituteTextTokens } from "./presets";

export const PX_PER_MM = 96 / 25.4;

export interface RenderedSheet {
  svg: string;
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
}

/** Optional render-time context (decision-document sensitivity disclosure). */
export interface RenderOptions {
  /** Active MCDA weights — disclosed in the method & limitations note. */
  mcdaWeights?: McdaWeights;
}

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

const esc = (s: unknown): string =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();
const f2 = (n: number) => n.toFixed(2);

/** 1/2/5 × 10ⁿ snap used for graticule steps and scale-bar segments. */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / mag;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * mag;
}

function scaleDenominatorLabel(pxPerMetre: number): number {
  // 1:N = ground metres per paper metre. One pixel is 1/PX_PER_MM mm of
  // paper, so N = (1/pxPerMetre) / (1/(PX_PER_MM·1000)) = PX_PER_MM·1000/pxPerMetre.
  const denom = (PX_PER_MM * 1000) / pxPerMetre;
  // 3 significant figures, matching the status bar convention.
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(denom)) - 2));
  return Math.round(denom / mag) * mag;
}

/* ------------------------------------------------------------------ */
/* Resolve context                                                     */
/* ------------------------------------------------------------------ */

export function buildResolveContext(result: PipelineResult): ResolveContext {
  const b = result.boundary;
  const suitability = result.suitability;
  let gridDims = "";
  if (suitability.length > 0) {
    const xs = new Set(suitability.map((c) => Math.round(c.x * 100)));
    const ys = new Set(suitability.map((c) => Math.round(c.y * 100)));
    gridDims = `${xs.size} × ${ys.size} grid`;
  }
  const geoid = getGeoidProvenance();
  return {
    metadata: result.metadata,
    boundary: b
      ? {
          parcelNo: b.parcelNo,
          areaHa: b.areaHa,
          areaAcres: b.areaAcres,
          perimeterM: b.perimeterM,
          precisionRatio: b.precisionRatio,
          precisionRating: b.precisionRating,
        }
      : null,
    computed: {
      featureCount: result.points.length,
      vectorCount: result.vectors.length,
      contourCount: result.contours.length,
      clusterCount: result.energyClusters.length,
      householdTotal: result.energyClusters.reduce((s, c) => s + c.householdCount, 0),
      capexTotal: result.energyClusters.reduce((s, c) => s + c.capexEstimateUsd, 0),
      sinkCount: result.hazardSinks.length,
      exposedCount: result.exposedAssets.length,
      geoidModel: geoid.statutory ? geoid.model : `${geoid.model} (parametric)`,
      adjustmentMethod: b
        ? `Bowditch compass-rule; misclosure ${f2(b.linearMisclosureM)} m (${b.precisionRating})`
        : "none — direct coordinates (no traverse closure applied)",
      gridDims,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Map frame projection                                                */
/* ------------------------------------------------------------------ */

interface FrameProj {
  pxPerM: number;
  toX: (e: number) => number;
  toY: (n: number) => number;
  inFrame: (x: number, y: number) => boolean;
  px: { x: number; y: number; w: number; h: number };
  bounds: { minE: number; maxE: number; minN: number; maxN: number };
}

function boundsForFit(result: PipelineResult, fit: ComposerMapFrame["fit"]) {
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  const grow = (e: number, n: number) => {
    if (e < minE) minE = e;
    if (e > maxE) maxE = e;
    if (n < minN) minN = n;
    if (n > maxN) maxN = n;
  };
  if (fit === "suitability") {
    for (const c of result.suitability) grow(c.x, c.y);
  } else if (fit === "boundary" && result.boundary) {
    for (const p of result.boundary.points) grow(p.easting, p.northing);
  } else {
    for (const p of result.points) grow(p.easting, p.northing);
    for (const v of result.vectors) for (const p of v.points) grow(p.easting, p.northing);
  }
  if (!isFinite(minE) || maxE <= minE || maxN <= minN) return null;
  return { minE, maxE, minN, maxN };
}

function buildFrameProj(result: PipelineResult, el: ComposerMapFrame): FrameProj | null {
  const bounds = boundsForFit(result, el.fit);
  const px = { x: el.x * PX_PER_MM, y: el.y * PX_PER_MM, w: el.w * PX_PER_MM, h: el.h * PX_PER_MM };
  if (!bounds) return null;
  const padE = (bounds.maxE - bounds.minE) * 0.12;
  const padN = (bounds.maxN - bounds.minN) * 0.12;
  const b = {
    minE: bounds.minE - padE, maxE: bounds.maxE + padE,
    minN: bounds.minN - padN, maxN: bounds.maxN + padN,
  };
  let pxPerM: number;
  if (el.scaleDenominator && el.scaleDenominator > 0) {
    // 1:N on paper at 96 dpi → ground metres per px → px per ground metre.
    const groundMPerPx = el.scaleDenominator / (1000 * PX_PER_MM);
    pxPerM = 1 / groundMPerPx;
  } else {
    pxPerM = Math.min(px.w / (b.maxE - b.minE), px.h / (b.maxN - b.minN));
  }
  const midE = (b.minE + b.maxE) / 2;
  const midN = (b.minN + b.maxN) / 2;
  const toX = (e: number) => px.x + px.w / 2 + (e - midE) * pxPerM;
  const toY = (n: number) => px.y + px.h / 2 - (n - midN) * pxPerM;
  const inFrame = (x: number, y: number) => x >= px.x - 40 && x <= px.x + px.w + 40 && y >= px.y - 40 && y <= px.y + px.h + 40;
  return { pxPerM, toX, toY, inFrame, px, bounds: b };
}

/* ------------------------------------------------------------------ */
/* Element renderers                                                   */
/* ------------------------------------------------------------------ */

const SUIT_FILL: Record<string, string> = {
  optimal: "#4d9a51",
  suitable: "#a3c95a",
  moderate: "#f2c257",
  restricted: "#e08b52",
  hazard: "#c85a4f",
};

/** Hairline cell borders — darker step of each class fill, keeps cells legible where they abut. */
const SUIT_STROKE: Record<string, string> = {
  optimal: "#3a753d",
  suitable: "#7d9c42",
  moderate: "#c29a3d",
  restricted: "#b26a38",
  hazard: "#9c423a",
};

/** Hypsometric contour inks — print-muted, index line carries more weight. */
const CONTOUR_MINOR = "#C8CFD6";
const CONTOUR_MAJOR = "#8E99A4";
const CONTOUR_LABEL_INK = "#4A555E";

function renderMapFrame(result: PipelineResult, el: ComposerMapFrame): string {
  const px = { x: el.x * PX_PER_MM, y: el.y * PX_PER_MM, w: el.w * PX_PER_MM, h: el.h * PX_PER_MM };
  const head = `
    <g id="${esc(el.id)}">
    <rect x="${f1(px.x)}" y="${f1(px.y)}" width="${f1(px.w)}" height="${f1(px.h)}" fill="#F8FAFC" stroke="#0F172A" stroke-width="1.5"/>`;
  const proj = buildFrameProj(result, el);
  if (!proj) {
    return `${head}
      <text x="${f1(px.x + px.w / 2)}" y="${f1(px.y + px.h / 2)}" font-size="11" fill="#94A3B8" text-anchor="middle">No data for this frame — run the pipeline</text>
    </g>`;
  }
  const clipId = `clip_${el.id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  const parts: string[] = [head];
  parts.push(`<clipPath id="${clipId}"><rect x="${f1(px.x)}" y="${f1(px.y)}" width="${f1(px.w)}" height="${f1(px.h)}"/></clipPath>`);
  parts.push(`<g clip-path="url(#${clipId})">`);

  const L = el.layers;

  // Shaded relief — TIN facet Lambertian shading (NW 315° / 45° sun),
  // bucketed into ≤18 gray paths. Drawn first so every thematic layer
  // reads on top of terrain form.
  if (L.relief !== false && result.tin && result.tin.triangles.length > 0) {
    const facets = projectFacets(
      result.tin.triangles,
      (e, n) => [proj.toX(e), proj.toY(n)] as [number, number],
      (x, y) => proj.inFrame(x, y),
    );
    for (const p of hillshadePaths(facets)) {
      parts.push(`<path d="${p.d}" fill="${p.fill}" fill-opacity="0.55"/>`);
    }
  }

  // Suitability choropleth (spatially positioned cells; hazard class last,
  // hairline borders in a darker step of each class fill)
  if (L.suitability && result.suitability.length > 0) {
    const cells = result.suitability;
    let sMinE = Infinity, sMaxE = -Infinity, sMinN = Infinity, sMaxN = -Infinity;
    for (const c of cells) {
      if (c.x < sMinE) sMinE = c.x;
      if (c.x > sMaxE) sMaxE = c.x;
      if (c.y < sMinN) sMinN = c.y;
      if (c.y > sMaxN) sMaxN = c.y;
    }
    const cellW = ((sMaxE - sMinE) / Math.sqrt(cells.length)) * proj.pxPerM;
    const cellPx = Math.max(2, cellW);
    const ordered = [
      ...cells.filter((c) => c.category !== "hazard"),
      ...cells.filter((c) => c.category === "hazard"),
    ];
    const strokeBatch: string[] = [];
    for (const c of ordered) {
      const cx = proj.toX(c.x);
      const cy = proj.toY(c.y);
      if (!proj.inFrame(cx, cy)) continue;
      const fill = SUIT_FILL[c.category] ?? SUIT_FILL.moderate;
      const stroke = SUIT_STROKE[c.category] ?? SUIT_STROKE.moderate;
      parts.push(
        `<rect x="${f1(cx - cellPx / 2)}" y="${f1(cy - cellPx / 2)}" width="${f1(cellPx)}" height="${f1(cellPx)}" fill="${fill}" fill-opacity="0.78"/>`,
      );
      if (cellPx >= 5) {
        strokeBatch.push(
          `<rect x="${f1(cx - cellPx / 2)}" y="${f1(cy - cellPx / 2)}" width="${f1(cellPx)}" height="${f1(cellPx)}" fill="none" stroke="${stroke}" stroke-width="0.4"/>`,
        );
      }
    }
    parts.push(...strokeBatch);
  }

  // Contours — index lines carry more weight than intermediates
  const contourLabels: { x: number; y: number; angleDeg: number; text: string }[] = [];
  if (L.contours && result.contours.length > 0) {
    const stride = Math.max(1, Math.ceil(result.contours.length / 300));
    for (let i = 0; i < result.contours.length; i += stride) {
      const c = result.contours[i];
      const pts = c.points
        .filter(([e, n]) => proj.inFrame(proj.toX(e), proj.toY(n)))
        .map(([e, n]) => `${f1(proj.toX(e))},${f1(proj.toY(n))}`)
        .join(" ");
      if (pts) parts.push(`<polyline points="${pts}" fill="none" stroke="${c.isMajor ? CONTOUR_MAJOR : CONTOUR_MINOR}" stroke-width="${c.isMajor ? 1.1 : 0.6}"/>`);
    }
    // Index-contour elevation labels — halo text, upright, budgeted.
    contourLabels.push(...placeContourLabels(
      result.contours,
      (e, n) => [proj.toX(e), proj.toY(n)] as [number, number],
      (x, y) => proj.inFrame(x, y),
      { spacingPx: Math.max(90, px.w / 5), maxLabels: 40 },
    ));
  }

  // Survey vectors (data-driven layer colors)
  if (L.vectors && result.vectors.length > 0) {
    for (const v of result.vectors) {
      const color = vectorInk(v);
      for (const seg of splitVector(v)) {
        const pts = seg
          .filter(([e, n]) => proj.inFrame(proj.toX(e), proj.toY(n)))
          .map(([e, n]) => `${f1(proj.toX(e))},${f1(proj.toY(n))}`)
          .join(" ");
        if (pts) parts.push(`<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${Math.max(1, v.lineWidth)}" stroke-dasharray="${dashArray(v.lineType)}"/>`);
      }
    }
  }

  // Boundary polygon — white casing under the stroke for print contrast
  if (L.boundary && result.boundary && result.boundary.points.length >= 3) {
    const d = result.boundary.points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${f1(proj.toX(p.easting))} ${f1(proj.toY(p.northing))}`)
      .join(" ") + " Z";
    parts.push(`<path d="${d}" fill="#3B82F6" fill-opacity="0.08"/>`);
    parts.push(`<path d="${d}" fill="none" stroke="#FFFFFF" stroke-width="4.5" stroke-opacity="0.85" stroke-linejoin="round"/>`);
    parts.push(`<path d="${d}" fill="none" stroke="#1D4ED8" stroke-width="2.2" stroke-linejoin="round"/>`);
  }

  // Hazard sinks — dashed impact ring + core dot
  if (L.hazards && result.hazardSinks.length > 0) {
    for (const s of result.hazardSinks) {
      const cx = proj.toX(s.center[0]);
      const cy = proj.toY(s.center[1]);
      if (!proj.inFrame(cx, cy)) continue;
      const r = Math.max(8, Math.min(14, 6 + s.depthM));
      parts.push(
        `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}" fill="none" stroke="#c85a4f" stroke-width="1.2" stroke-dasharray="2,2"/>` +
        `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="3" fill="#c85a4f"/>` +
        `<text x="${f1(cx + r + 3)}" y="${f1(cy + 3)}" font-size="8" fill="#8a3a32" font-family="monospace">${esc(s.id)} −${f1(s.depthM)}m</text>`,
      );
    }
  }

  // Energy clusters — circle sized by household count
  if (L.energy && result.energyClusters.length > 0) {
    const maxHh = Math.max(...result.energyClusters.map((c) => c.householdCount), 1);
    for (const c of result.energyClusters) {
      const cx = proj.toX(c.centroid[0]);
      const cy = proj.toY(c.centroid[1]);
      if (!proj.inFrame(cx, cy)) continue;
      const r = 3 + 7 * Math.sqrt(c.householdCount / maxHh);
      parts.push(
        `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}" fill="none" stroke="#a06a1f" stroke-width="1.4"/>` +
        `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="1.8" fill="#a06a1f"/>`,
      );
    }
  }

  // Points — beacon badges within label budget, dot mode beyond
  if (L.points) {
    const pts = result.boundary && el.fit === "boundary" ? result.boundary.points : result.points;
    const labelBudget = el.labelLimit ?? 40;
    if (pts.length <= labelBudget) {
      for (const p of pts) {
        const sx = proj.toX(p.easting);
        const sy = proj.toY(p.northing);
        if (!proj.inFrame(sx, sy)) continue;
        const isBeacon = result.boundary?.points.some((bp) => bp.id === p.id) ?? false;
        if (isBeacon) {
          parts.push(
            `<g transform="translate(${f1(sx)},${f1(sy)})">` +
            `<circle r="4.5" fill="#EF4444" stroke="#FFFFFF" stroke-width="1.5"/><circle r="1.5" fill="#FFFFFF"/>` +
            `<rect x="6" y="-12" width="${Math.max(34, p.id.length * 6.2)}" height="15" fill="#0F172A" rx="2"/>` +
            `<text x="${f1(6 + Math.max(34, p.id.length * 6.2) / 2)}" y="-2" font-size="8.5" font-weight="700" fill="#FFFFFF" text-anchor="middle">${esc(p.id)}</text>` +
            `</g>`,
          );
        } else {
          parts.push(`<circle cx="${f1(sx)}" cy="${f1(sy)}" r="1.3" fill="#334155" fill-opacity="0.85"/>`);
        }
      }
    } else {
      // LOD dot mode — decimate to keep sheets legible
      const stride = Math.ceil(pts.length / 2000);
      for (let i = 0; i < pts.length; i += stride) {
        const p = pts[i];
        const sx = proj.toX(p.easting);
        const sy = proj.toY(p.northing);
        if (!proj.inFrame(sx, sy)) continue;
        parts.push(`<circle cx="${f1(sx)}" cy="${f1(sy)}" r="1" fill="#334155" fill-opacity="0.7"/>`);
      }
    }
  }

  parts.push("</g>"); // clip

  // Contour elevation labels — emitted above all geometry, still clipped
  // to the frame (halo keeps them legible over any underlying fill).
  if (contourLabels.length > 0) {
    parts.push(`<g clip-path="url(#${clipId})">`);
    for (const lb of contourLabels) {
      parts.push(
        `<text x="0" y="0" transform="translate(${f1(lb.x)},${f1(lb.y)}) rotate(${f1(lb.angleDeg)})" font-size="7" font-family="monospace" fill="${CONTOUR_LABEL_INK}" text-anchor="middle" paint-order="stroke" stroke="#F4F6F8" stroke-width="2.4" stroke-linejoin="round">${esc(lb.text)}</text>`,
      );
    }
    parts.push("</g>");
  }

  // Graticule — drawn over layers, ticks cross the frame edge, labels clear it
  if (L.graticule) {
    const rangeE = proj.bounds.maxE - proj.bounds.minE;
    const rangeN = proj.bounds.maxN - proj.bounds.minN;
    const stepE = niceStep(rangeE / 4);
    const stepN = niceStep(rangeN / 4);
    for (let e = Math.ceil(proj.bounds.minE / stepE) * stepE; e <= proj.bounds.maxE; e += stepE) {
      const sx = proj.toX(e);
      if (sx < px.x || sx > px.x + px.w) continue;
      parts.push(
        `<line x1="${f1(sx)}" y1="${f1(px.y)}" x2="${f1(sx)}" y2="${f1(px.y + px.h)}" stroke="#CBD5E1" stroke-width="0.75" stroke-dasharray="3,3"/>` +
        `<line x1="${f1(sx)}" y1="${f1(px.y)}" x2="${f1(sx)}" y2="${f1(px.y + 5)}" stroke="#475569" stroke-width="1.2"/>` +
        `<line x1="${f1(sx)}" y1="${f1(px.y + px.h - 5)}" x2="${f1(sx)}" y2="${f1(px.y + px.h)}" stroke="#475569" stroke-width="1.2"/>` +
        `<text x="${f1(sx)}" y="${f1(px.y - 5)}" font-size="8" font-family="monospace" fill="#64748B" text-anchor="middle">${Math.round(e).toLocaleString("en-US")}m E</text>`,
      );
    }
    for (let n = Math.ceil(proj.bounds.minN / stepN) * stepN; n <= proj.bounds.maxN; n += stepN) {
      const sy = proj.toY(n);
      if (sy < px.y || sy > px.y + px.h) continue;
      parts.push(
        `<line x1="${f1(px.x)}" y1="${f1(sy)}" x2="${f1(px.x + px.w)}" y2="${f1(sy)}" stroke="#CBD5E1" stroke-width="0.75" stroke-dasharray="3,3"/>` +
        `<line x1="${f1(px.x)}" y1="${f1(sy)}" x2="${f1(px.x + 5)}" y2="${f1(sy)}" stroke="#475569" stroke-width="1.2"/>` +
        `<line x1="${f1(px.x + px.w - 5)}" y1="${f1(sy)}" x2="${f1(px.x + px.w)}" y2="${f1(sy)}" stroke="#475569" stroke-width="1.2"/>` +
        `<text x="${f1(px.x - 6)}" y="${f1(sy + 3)}" font-size="8" font-family="monospace" fill="#64748B" text-anchor="end">${Math.round(n).toLocaleString("en-US")}m N</text>`,
      );
    }
  }

  // Frame scale caption (computed or fixed, disclosed)
  const denom = el.scaleDenominator ?? scaleDenominatorLabel(proj.pxPerM);
  parts.push(
    `<text x="${f1(px.x + px.w)}" y="${f1(px.y + px.h + 12)}" font-size="7.5" font-family="monospace" fill="#64748B" text-anchor="end">SCALE 1:${denom.toLocaleString("en-US")}${el.scaleDenominator ? " (fixed)" : " (fit)"} · ${esc(result.metadata.crs)}</text>`,
  );
  parts.push("</g>");
  return parts.join("\n");
}

function vectorInk(v: SurveyVector): string {
  return v.color || "#334155";
}
function dashArray(t: SurveyVector["lineType"]): string {
  switch (t) {
    case "dashed": return "6,4";
    case "dotted": return "1.5,3";
    case "dashdot": return "6,3,1.5,3";
    default: return "none";
  }
}
/** SurveyVectors store concatenated point chains; split closed rings at the closure vertex. */
function splitVector(v: SurveyVector): [number, number][][] {
  return [v.points.map((p) => [p.easting, p.northing] as [number, number])];
}

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

interface Col { label: string; w: number; align: "start" | "end"; mono?: boolean }

function renderTable(result: PipelineResult, el: ComposerTable): string {
  const w = el.w * PX_PER_MM;
  const maxRows = el.maxRows ?? 8;
  let cols: Col[] = [];
  let rows: string[][] = [];

  if (el.source === "beacons") {
    const b = result.boundary;
    cols = [
      { label: "BEACON", w: 62, align: "start" },
      { label: "EASTING (m)", w: 70, align: "end", mono: true },
      { label: "NORTHING (m)", w: 70, align: "end", mono: true },
      { label: "H MSL (m)", w: 56, align: "end", mono: true },
      { label: "BEARING", w: 64, align: "end", mono: true },
      { label: "DIST (m)", w: 52, align: "end", mono: true },
    ];
    rows = (b?.bearingsDistances ?? []).slice(0, maxRows).map((bd) => {
      const p = b?.points.find((q) => q.id === bd.fromId);
      return [
        bd.fromId,
        p ? f2(p.easting) : "—",
        p ? f2(p.northing) : "—",
        p ? f2(p.elevation) : "—",
        bd.bearingDms,
        f2(bd.distanceM),
      ];
    });
    if (!b) rows = [];
  } else if (el.source === "hazards") {
    cols = [
      { label: "ASSET", w: 170, align: "start" },
      { label: "RISK", w: 62, align: "start" },
      { label: "ELEV (MSL)", w: 60, align: "end", mono: true },
      { label: "DIST TO SINK", w: 66, align: "end", mono: true },
    ];
    rows = result.exposedAssets.slice(0, maxRows).map((a) => [
      a.name, a.hazardRisk.toUpperCase(), `${f1(a.elevation)} m`, `${Math.round(a.distanceToSinkM)} m`,
    ]);
  } else if (el.source === "energy") {
    cols = [
      { label: "CLUSTER", w: 90, align: "start" },
      { label: "HH", w: 42, align: "end", mono: true },
      { label: "PV (kWp)", w: 62, align: "end", mono: true },
      { label: "BATTERY (kWh)", w: 86, align: "end", mono: true },
      { label: "CAPEX (USD)", w: 86, align: "end", mono: true },
    ];
    rows = result.energyClusters.slice(0, maxRows).map((c) => [
      c.id, String(c.householdCount), String(c.recommendedSolarKw), String(c.batteryStorageKwh),
      c.capexEstimateUsd.toLocaleString("en-US"),
    ]);
  } else if (el.source === "provenance") {
    const graph = buildProvenanceGraph(result);
    cols = [
      { label: "FIGURE", w: 78, align: "start" },
      { label: "VALUE", w: 92, align: "start", mono: true },
      { label: "METHOD", w: 96, align: "start" },
      { label: "BASIS (inputs)", w: 110, align: "start" },
      { label: "TOLERANCE / LIMITATION", w: 168, align: "start" },
    ];
    rows = provenanceCompactRows(graph).map((r) => [
      r.figure, r.value, r.method, r.basis, r.tolerance,
    ]);
  } else {
    cols = [
      { label: "STAGE", w: 120, align: "start" },
      { label: "MS", w: 46, align: "end", mono: true },
      { label: "STATUS", w: 50, align: "start" },
      { label: "DETAILS", w: 144, align: "start" },
    ];
    rows = result.telemetries.slice(0, maxRows).map((t) => [
      t.stepName, String(Math.round(t.durationMs)), t.status.toUpperCase(), t.details,
    ]);
  }

  const totalW = cols.reduce((s, c) => s + c.w, 0);
  const scale = w / totalW;
  const colW = cols.map((c) => c.w * scale);
  const headH = 16;
  const rowH = 15;
  const tableH = headH + rows.length * rowH + (rows.length > 0 ? 6 : 0) + (el.title ? 16 : 0);
  const out: string[] = [`<g id="${esc(el.id)}">`];

  let y = el.y * PX_PER_MM;
  if (el.title) {
    out.push(`<text x="${f1(el.x * PX_PER_MM)}" y="${f1(y + 10)}" font-size="9.5" font-weight="700" fill="#0F172A">${esc(el.title)}</text>`);
    y += 16;
  }
  out.push(`<rect x="${f1(el.x * PX_PER_MM)}" y="${f1(y)}" width="${f1(w)}" height="${f1(tableH - (el.title ? 16 : 0))}" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1"/>`);
  out.push(`<rect x="${f1(el.x * PX_PER_MM)}" y="${f1(y)}" width="${f1(w)}" height="${headH}" fill="#E8EDF3"/>`);

  let cx = el.x * PX_PER_MM;
  cols.forEach((c, i) => {
    const tx = c.align === "end" ? cx + colW[i] - 5 : cx + 5;
    out.push(`<text x="${f1(tx)}" y="${f1(y + 11)}" font-size="7.5" font-weight="700" fill="#334155" text-anchor="${c.align}">${esc(c.label)}</text>`);
    if (i < cols.length - 1) out.push(`<line x1="${f1(cx + colW[i])}" y1="${f1(y)}" x2="${f1(cx + colW[i])}" y2="${f1(y + tableH - (el.title ? 16 : 0))}" stroke="#E2E8F0" stroke-width="0.75"/>`);
    cx += colW[i];
  });

  rows.forEach((r, ri) => {
    const ry = y + headH + ri * rowH;
    if (ri > 0) out.push(`<line x1="${f1(el.x * PX_PER_MM)}" y1="${f1(ry)}" x2="${f1(el.x * PX_PER_MM + w)}" y2="${f1(ry)}" stroke="#EDF1F5" stroke-width="0.75"/>`);
    cx = el.x * PX_PER_MM;
    cols.forEach((c, ci) => {
      const tx = c.align === "end" ? cx + colW[ci] - 5 : cx + 5;
      out.push(
        `<text x="${f1(tx)}" y="${f1(ry + 11)}" font-size="8" ${c.mono ? 'font-family="monospace"' : ""} fill="${ci === 0 ? "#0F172A" : "#334155"}" text-anchor="${c.align}">${esc(r[ci] ?? "—")}</text>`,
      );
      cx += colW[ci];
    });
  });

  const source = el.source === "beacons"
    ? result.boundary?.bearingsDistances.length ?? 0
    : el.source === "hazards" ? result.exposedAssets.length
    : el.source === "energy" ? result.energyClusters.length
    : el.source === "provenance"
    ? buildProvenanceGraph(result).nodes.filter((n) => n.kind === "figure").length
    : result.telemetries.length;
  if (source > rows.length) {
    out.push(`<text x="${f1(el.x * PX_PER_MM)}" y="${f1(y + headH + rows.length * rowH + 11)}" font-size="7" fill="#94A3B8">(+${source - rows.length} more rows omitted — see data table)</text>`);
  } else if (source === 0) {
    out.push(`<text x="${f1(el.x * PX_PER_MM + 5)}" y="${f1(y + headH + 16)}" font-size="7.5" fill="#64748B">No ${el.source === "beacons" ? "adjusted boundary traverse" : el.source === "hazards" ? "exposed assets — no assets inside delineated hazard footprints" : el.source === "energy" ? "clusters met the electrification thresholds" : el.source === "provenance" ? "computed figures — provenance register is empty" : "telemetry"} to report.</text>`);
  }
  out.push("</g>");
  return out.join("\n");
}

/* ------------------------------------------------------------------ */
/* KPI strip / legend / furniture                                      */
/* ------------------------------------------------------------------ */

function kpiValue(result: PipelineResult, metric: string): { v: string; sub: string } {
  const b = result.boundary;
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  switch (metric) {
    case "areaHa": return { v: b ? f2(b.areaHa) : "—", sub: "ha" };
    case "perimeterM": return { v: b ? f2(b.perimeterM) : "—", sub: "m" };
    case "precisionRatio": return { v: b && b.precisionRatio > 0 ? `1:${b.precisionRatio.toLocaleString("en-US")}` : "—", sub: b ? b.precisionRating : "" };
    case "buildableHa": {
      if (!b || result.suitability.length === 0) return { v: "—", sub: "needs boundary + MCDA" };
      const ok = result.suitability.filter((c) => c.category === "optimal" || c.category === "suitable").length;
      return { v: f2((ok / result.suitability.length) * b.areaHa), sub: `ha net of ${f2(b.areaHa)} ha` };
    }
    case "suitablePct": {
      if (result.suitability.length === 0) return { v: "—", sub: "no MCDA run" };
      const ok = result.suitability.filter((c) => c.category === "optimal" || c.category === "suitable").length;
      return { v: String(Math.round((ok / result.suitability.length) * 100)), sub: "% of grid" };
    }
    case "exposedAssets": return { v: String(result.exposedAssets.length), sub: `of ${result.points.length} features` };
    case "featureCount": return { v: result.points.length.toLocaleString("en-US"), sub: "surveyed points" };
    case "capexUsd": {
      const t = result.energyClusters.reduce((s, c) => s + c.capexEstimateUsd, 0);
      return { v: t > 0 ? `$${Math.round(t).toLocaleString("en-US")}` : "—", sub: `${result.energyClusters.length} cluster(s)` };
    }
    case "households": {
      const t = result.energyClusters.reduce((s, c) => s + c.householdCount, 0);
      return { v: t > 0 ? t.toLocaleString("en-US") : "—", sub: "households" };
    }
    default: return { v: "—", sub: "" };
  }
}

function renderKpiStrip(result: PipelineResult, el: Extract<ComposerElement, { kind: "kpi-strip" }>): string {
  const w = el.w * PX_PER_MM;
  const n = Math.max(1, el.metrics.length);
  const cw = w / n;
  const h = 46;
  const out: string[] = [`<g id="${esc(el.id)}">`];
  el.metrics.forEach((m, i) => {
    const x = el.x * PX_PER_MM + i * cw;
    const { v, sub } = kpiValue(result, m);
    const label = m.replace(/([A-Z])/g, " $1").toUpperCase();
    out.push(
      `<rect x="${f1(x)}" y="${f1(el.y * PX_PER_MM)}" width="${f1(cw - 6)}" height="${h}" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1"/>` +
      `<line x1="${f1(x)}" y1="${f1(el.y * PX_PER_MM)}" x2="${f1(x)}" y2="${f1(el.y * PX_PER_MM + h)}" stroke="#0F172A" stroke-width="2.5"/>` +
      `<text x="${f1(x + 10)}" y="${f1(el.y * PX_PER_MM + 13)}" font-size="7" font-weight="700" fill="#64748B" letter-spacing="1">${esc(label)}</text>` +
      `<text x="${f1(x + 10)}" y="${f1(el.y * PX_PER_MM + 33)}" font-size="16" font-weight="700" fill="#0F172A" font-family="monospace">${esc(v)}</text>` +
      `<text x="${f1(x + 14 + v.length * 9.4)}" y="${f1(el.y * PX_PER_MM + 33)}" font-size="8" fill="#64748B">${esc(sub)}</text>`,
    );
  });
  out.push("</g>");
  return out.join("\n");
}

function suitabilityPct(result: PipelineResult, cat: string): number | null {
  if (result.suitability.length === 0) return null;
  const n = result.suitability.filter((c) => c.category === cat).length;
  return Math.round((n / result.suitability.length) * 100);
}

function suitabilityCount(result: PipelineResult, cat: string): number | null {
  if (result.suitability.length === 0) return null;
  return result.suitability.filter((c) => c.category === cat).length;
}

function renderLegend(
  result: PipelineResult,
  el: Extract<ComposerElement, { kind: "legend" }>,
  sheetRelief: boolean,
): string {
  const out: string[] = [`<g id="${esc(el.id)}">`];
  const x0 = el.x * PX_PER_MM;
  let y = el.y * PX_PER_MM;
  if (el.title) {
    out.push(`<text x="${f1(x0)}" y="${f1(y + 8)}" font-size="8" font-weight="700" fill="#475569" letter-spacing="0.5">${esc(el.title)}</text>`);
    y += 16;
  }
  // Each entry: swatch drawn at current y, label vertically centred on it.
  if (result.boundary) {
    out.push(
      `<rect x="${f1(x0)}" y="${f1(y)}" width="12" height="12" fill="#3B82F6" fill-opacity="0.12" stroke="#1D4ED8" stroke-width="1.5"/>` +
      `<text x="${f1(x0 + 18)}" y="${f1(y + 9)}" font-size="8.5" fill="#475569">Parcel boundary (adjusted traverse)</text>`,
    );
    y += 15;
  }
  out.push(
    `<circle cx="${f1(x0 + 6)}" cy="${f1(y + 6)}" r="4" fill="#EF4444" stroke="#FFFFFF" stroke-width="1"/>` +
    `<text x="${f1(x0 + 18)}" y="${f1(y + 9)}" font-size="8.5" fill="#475569">Boundary beacon</text>`,
  );
  y += 15;
  if (result.contours.length > 0) {
    out.push(
      `<line x1="${f1(x0)}" y1="${f1(y + 3)}" x2="${f1(x0 + 12)}" y2="${f1(y + 3)}" stroke="#8E99A4" stroke-width="1.2"/>` +
      `<line x1="${f1(x0)}" y1="${f1(y + 8)}" x2="${f1(x0 + 12)}" y2="${f1(y + 8)}" stroke="#C8CFD6" stroke-width="0.7"/>` +
      `<text x="${f1(x0 + 18)}" y="${f1(y + 9)}" font-size="8.5" fill="#475569">Contours — index (labelled) · intermediate</text>`,
    );
    y += 15;
  }
  if (result.buffers.length > 0) {
    out.push(
      `<rect x="${f1(x0)}" y="${f1(y)}" width="12" height="12" fill="#d9a441" fill-opacity="0.15" stroke="#a07424" stroke-width="1" stroke-dasharray="3,2"/>` +
      `<text x="${f1(x0 + 18)}" y="${f1(y + 9)}" font-size="8.5" fill="#475569">Statutory corridor reserve</text>`,
    );
    y += 15;
  }
  if (result.hazardSinks.length > 0) {
    out.push(
      `<circle cx="${f1(x0 + 6)}" cy="${f1(y + 6)}" r="7" fill="none" stroke="#c85a4f" stroke-width="1.2" stroke-dasharray="2,2"/>` +
      `<circle cx="${f1(x0 + 6)}" cy="${f1(y + 6)}" r="2.2" fill="#c85a4f"/>` +
      `<text x="${f1(x0 + 18)}" y="${f1(y + 9)}" font-size="8.5" fill="#475569">Inundation sink</text>`,
    );
    y += 15;
  }
  if (result.energyClusters.length > 0) {
    out.push(
      `<circle cx="${f1(x0 + 6)}" cy="${f1(y + 6)}" r="6" fill="none" stroke="#a06a1f" stroke-width="1.3"/>` +
      `<circle cx="${f1(x0 + 6)}" cy="${f1(y + 6)}" r="1.6" fill="#a06a1f"/>` +
      `<text x="${f1(x0 + 18)}" y="${f1(y + 9)}" font-size="8.5" fill="#475569">Settlement cluster (radius ∝ households)</text>`,
    );
    y += 15;
  }
  if (sheetRelief) {
    out.push(
      `<rect x="${f1(x0)}" y="${f1(y)}" width="12" height="12" fill="url(#legend_relief_ramp)" stroke="#CBD5E1" stroke-width="0.5"/>` +
      `<text x="${f1(x0 + 18)}" y="${f1(y + 9)}" font-size="8.5" fill="#475569">Shaded relief (TIN, sun NW 315° / 45°)</text>`,
    );
    y += 15;
  }
  const anySuit = SUITABILITY_CLASS_ORDER.some((cat) => suitabilityPct(result, cat) !== null);
  if (anySuit) {
    for (const cat of SUITABILITY_CLASS_ORDER) {
      const pct = suitabilityPct(result, cat);
      if (pct === null) continue;
      const n = suitabilityCount(result, cat) ?? 0;
      out.push(
        `<rect x="${f1(x0)}" y="${f1(y)}" width="12" height="12" fill="${SUIT_FILL[cat]}" stroke="${SUIT_STROKE[cat]}" stroke-width="0.5"/>` +
        `<text x="${f1(x0 + 18)}" y="${f1(y + 9)}" font-size="8.5" fill="#475569">${cat[0].toUpperCase()}${cat.slice(1)} ${pct}% (n=${n.toLocaleString("en-US")})</text>`,
      );
      y += 15;
    }
    // Classification breaks — disclosed so every colour is re-derivable.
    for (const line of suitabilityBreaksLines()) {
      out.push(
        `<text x="${f1(x0)}" y="${f1(y + 9)}" font-size="6.3" font-family="monospace" fill="#64748B">${esc(line)}</text>`,
      );
      y += 9;
    }
  }
  out.push("</g>");
  return out.join("\n");
}

function renderNorthArrow(el: Extract<ComposerElement, { kind: "north-arrow" }>): string {
  const cx = el.x * PX_PER_MM;
  const cy = el.y * PX_PER_MM;
  const r = (el.sizeMm * PX_PER_MM) / 2;
  return `<g id="${esc(el.id)}" transform="translate(${f1(cx)},${f1(cy)})">
    <circle r="${f1(r)}" fill="#FFFFFF" stroke="#0F172A" stroke-width="1"/>
    <polygon points="0,${f1(-r * 0.82)} ${f1(r * 0.23)},0 0,${f1(-r * 0.14)} ${f1(-r * 0.23)},0" fill="#0F172A"/>
    <polygon points="0,${f1(r * 0.82)} ${f1(r * 0.23)},0 0,${f1(r * 0.14)} ${f1(-r * 0.23)},0" fill="#94A3B8"/>
    <text y="${f1(-r - 2)}" font-size="9" font-weight="800" fill="#0F172A" text-anchor="middle">N</text>
  </g>`;
}

function renderScaleBar(
  el: Extract<ComposerElement, { kind: "scale-bar" }>,
  frames: { id: string; pxPerM: number }[],
): string {
  const frame = frames.find((fr) => fr.id === el.mapFrameId) ?? frames[0];
  const w = el.w * PX_PER_MM;
  if (!frame) {
    return `<g id="${esc(el.id)}"><text x="${f1(el.x * PX_PER_MM)}" y="${f1(el.y * PX_PER_MM)}" font-size="7.5" fill="#94A3B8">scale bar — requires a map frame</text></g>`;
  }
  const segPx = w / 4;
  const segMetres = niceStep(segPx / frame.pxPerM); // px × ground-m-per-px = ground m
  const segGroundPx = segMetres * frame.pxPerM; // px on paper for S metres
  const barW = segGroundPx * 4;
  const segLabel = segMetres >= 1000 ? `${(segMetres / 1000).toLocaleString("en-US")}km` : `${segMetres.toLocaleString("en-US")}m`;
  const out: string[] = [`<g id="${esc(el.id)}" transform="translate(${f1(el.x * PX_PER_MM)},${f1(el.y * PX_PER_MM)})">`];
  // Alternating bar with the first segment subdivided into two half-steps
  // (classic atlas convention; the alternation stays unambiguous).
  const half = segGroundPx / 2;
  out.push(`<rect x="0" y="0" width="${f1(half)}" height="5" fill="#0F172A" stroke="#0F172A" stroke-width="0.5"/>`);
  out.push(`<rect x="${f1(half)}" y="0" width="${f1(half)}" height="5" fill="#FFFFFF" stroke="#0F172A" stroke-width="0.5"/>`);
  for (let i = 1; i < 4; i++) {
    out.push(
      `<rect x="${f1(i * segGroundPx)}" y="0" width="${f1(segGroundPx)}" height="5" fill="${i % 2 === 1 ? "#0F172A" : "#FFFFFF"}" stroke="#0F172A" stroke-width="0.5"/>`,
    );
  }
  // Ticks + labels at 0, ½, 1, 2, 3, 4 segment positions.
  const ticks: [number, string, "start" | "middle" | "end"][] = [
    [0, "0", "start"],
    [half, segMetres >= 1000 ? `${(segMetres / 2000).toLocaleString("en-US")}` : `${(segMetres / 2).toLocaleString("en-US")}`, "middle"],
    [segGroundPx, segLabel, "middle"],
    [2 * segGroundPx, segMetres >= 1000 ? `${((2 * segMetres) / 1000).toLocaleString("en-US")}km` : `${(2 * segMetres).toLocaleString("en-US")}`, "middle"],
    [3 * segGroundPx, segMetres >= 1000 ? `${((3 * segMetres) / 1000).toLocaleString("en-US")}km` : `${(3 * segMetres).toLocaleString("en-US")}`, "middle"],
    [4 * segGroundPx, segMetres >= 1000 ? `${((4 * segMetres) / 1000).toLocaleString("en-US")}km` : `${(4 * segMetres).toLocaleString("en-US")}`, "end"],
  ];
  for (const [tx, tv, anchor] of ticks) {
    out.push(`<text x="${f1(tx)}" y="-3" font-size="7.5" font-family="monospace" fill="#0F172A" text-anchor="${anchor}">${esc(tv)}</text>`);
  }
  out.push(
    `<text x="${f1(4 * segGroundPx + 8)}" y="5" font-size="6.5" fill="#64748B">grid metres</text>`,
  );
  out.push("</g>");
  return out.join("\n");
}

function renderMethodNote(
  result: PipelineResult,
  el: Extract<ComposerElement, { kind: "method-note" }>,
  options?: RenderOptions,
): string {
  const ctx = buildResolveContext(result);
  const w = el.w * PX_PER_MM;
  const lines: string[] = [];
  lines.push(`Adjustment: ${ctx.computed.adjustmentMethod}.`);
  lines.push(
    `Vertical datum: H = h − N, geoid ${ctx.computed.geoidModel}` +
    (getGeoidProvenance().statutory ? "." : " — NOT for statutory height work."),
  );
  if (result.suitability.length > 0) {
    lines.push(`Suitability: weighted overlay (slope, road proximity, riparian setback) on a ${ctx.computed.gridDims}.`);
    if (options?.mcdaWeights) {
      const w8 = options.mcdaWeights;
      const adjusted =
        w8.slopeWeight !== DEFAULT_MCDA_WEIGHTS.slopeWeight ||
        w8.roadAccessWeight !== DEFAULT_MCDA_WEIGHTS.roadAccessWeight ||
        w8.waterBufferWeight !== DEFAULT_MCDA_WEIGHTS.waterBufferWeight ||
        w8.socialInfraWeight !== DEFAULT_MCDA_WEIGHTS.socialInfraWeight;
      lines.push(
        `MCDA weights: slope ${w8.slopeWeight} · road ${w8.roadAccessWeight} · water ${w8.waterBufferWeight} · infra ${w8.socialInfraWeight}` +
        (adjusted ? " — user-adjusted for sensitivity review; digest reflects this state." : " — document defaults."),
      );
    }
  }
  if (result.hazardSinks.length > 0) {
    lines.push("Hazard: inundation sinks delineated from TIN low-point drainage; exposure scored by 2D distance to sink. Screening only — not a rainfall-runoff forecast.");
  }
  if (result.energyClusters.length > 0) {
    lines.push("Electrification: SE4All / ESMAP multi-tier techno-economic sizing; costs are planning-level estimates.");
  }
  if (result.boundary) {
    lines.push(`Uncertainty: parcel figures bounded by traverse precision 1:${result.boundary.precisionRatio.toLocaleString("en-US")} (${result.boundary.precisionRating}); planimetric, no slope correction.`);
  }
  lines.push(`All figures computed from ${result.points.length} surveyed features; none are hard-coded.`);
  const h = 24 + lines.length * 13;
  const out: string[] = [
    `<g id="${esc(el.id)}">`,
    `<rect x="${f1(el.x * PX_PER_MM)}" y="${f1(el.y * PX_PER_MM)}" width="${f1(w)}" height="${h}" fill="#FBFBFA" stroke="#CBD5E1" stroke-width="0.75"/>`,
    `<text x="${f1(el.x * PX_PER_MM + 8)}" y="${f1(el.y * PX_PER_MM + 15)}" font-size="8.5" font-weight="700" fill="#475569">METHOD &amp; LIMITATIONS</text>`,
  ];
  lines.forEach((l, i) => {
    out.push(`<text x="${f1(el.x * PX_PER_MM + 8)}" y="${f1(el.y * PX_PER_MM + 31 + i * 13)}" font-size="7.5" fill="#64748B">${esc(l)}</text>`);
  });
  out.push(
    `<text x="${f1(el.x * PX_PER_MM + 8)}" y="${f1(el.y * PX_PER_MM + 31 + lines.length * 13)}" font-size="7.5" font-family="monospace" fill="#94A3B8">CRS ${esc(result.metadata.crs)} · Prepared with MetaRDU GIS Studio · Surveyor: ${esc(result.metadata.surveyorName)}</text>`,
  );
  out.push("</g>");
  return out.join("\n");
}

/* ------------------------------------------------------------------ */
/* Statutory blocks                                                    */
/* ------------------------------------------------------------------ */

function renderTitleBlock(result: PipelineResult, el: Extract<ComposerElement, { kind: "title-block" }>): string {
  const ctx = buildResolveContext(result);
  const w = el.w * PX_PER_MM;
  const rowH = 13;
  const h = el.h ? el.h * PX_PER_MM : 20 + el.fields.length * rowH + (el.signatureLine ? 16 : 0);
  const out: string[] = [
    `<g id="${esc(el.id)}">`,
    `<rect x="${f1(el.x * PX_PER_MM)}" y="${f1(el.y * PX_PER_MM)}" width="${f1(w)}" height="${f1(h)}" fill="#F1F5F9" stroke="#CBD5E1" stroke-width="1"/>`,
    `<text x="${f1(el.x * PX_PER_MM + 10)}" y="${f1(el.y * PX_PER_MM + 15)}" font-size="9.5" font-weight="700" fill="#0F172A">${esc(el.title)}</text>`,
  ];
  el.fields.forEach((f, i) => {
    const y = el.y * PX_PER_MM + 30 + i * rowH;
    out.push(`<text x="${f1(el.x * PX_PER_MM + 10)}" y="${f1(y)}" font-size="8" font-weight="600" fill="#64748B">${esc(f.label)}</text>`);
    out.push(
      `<text x="${f1(el.x * PX_PER_MM + 118)}" y="${f1(y)}" font-size="8.5" font-family="monospace" fill="#0F172A">${esc(resolveFieldValue(f.value, ctx))}</text>`,
    );
  });
  if (el.signatureLine) {
    const y = el.y * PX_PER_MM + h - 8;
    out.push(`<line x1="${f1(el.x * PX_PER_MM + w * 0.55)}" y1="${f1(y)}" x2="${f1(el.x * PX_PER_MM + w - 12)}" y2="${f1(y)}" stroke="#94A3B8" stroke-width="1"/>`);
    out.push(`<text x="${f1(el.x * PX_PER_MM + w * 0.775)}" y="${f1(y + 10)}" font-size="7" fill="#94A3B8" text-anchor="middle">${esc(el.signatureLine)}</text>`);
  }
  out.push("</g>");
  return out.join("\n");
}

function renderCertification(result: PipelineResult, el: Extract<ComposerElement, { kind: "certification" }>): string {
  const w = el.w * PX_PER_MM;
  const h = (el.h ?? 30) * PX_PER_MM;
  const x = el.x * PX_PER_MM;
  const y = el.y * PX_PER_MM;
  return `<g id="${esc(el.id)}">
    <rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" fill="#FFFFFF" stroke="#0F172A" stroke-width="1"/>
    <text x="${f1(x + 9)}" y="${f1(y + 15)}" font-size="8.5" font-weight="700" fill="#0F172A">LICENSED SURVEYOR CERTIFICATE</text>
    <text x="${f1(x + 9)}" y="${f1(y + 30)}" font-size="7.5" fill="#475569">I certify that this survey was executed under my personal</text>
    <text x="${f1(x + 9)}" y="${f1(y + 41)}" font-size="7.5" fill="#475569">direction in strict compliance with the Survey Act Cap 299.</text>
    <text x="${f1(x + 9)}" y="${f1(y + 60)}" font-size="8" font-weight="600" fill="#0F172A">SURVEYOR: ${esc(result.metadata.surveyorName.toUpperCase())}</text>
    <text x="${f1(x + 9)}" y="${f1(y + 73)}" font-size="7.5" font-family="monospace" fill="#64748B">MIS NUMBER: ${esc(result.metadata.registrationNo)} | DATE: ${esc(result.metadata.date)}</text>
    <line x1="${f1(x + w * 0.6)}" y1="${f1(y + 73)}" x2="${f1(x + w - 12)}" y2="${f1(y + 73)}" stroke="#94A3B8" stroke-width="1"/>
    <text x="${f1(x + w * 0.8)}" y="${f1(y + 84)}" font-size="7" fill="#94A3B8" text-anchor="middle">Official Seal &amp; Signature</text>
  </g>`;
}

function renderApprovalStamp(result: PipelineResult, el: Extract<ComposerElement, { kind: "approval-stamp" }>): string {
  const w = el.w * PX_PER_MM;
  const h = el.h * PX_PER_MM;
  const x = el.x * PX_PER_MM;
  const y = el.y * PX_PER_MM;
  const year = (result.metadata.date.match(/\d{4}/) ?? [""])[0];
  return `<g id="${esc(el.id)}">
    <rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1" stroke-dasharray="4,4"/>
    <text x="${f1(x + w / 2)}" y="${f1(y + h * 0.32)}" font-size="8.5" font-weight="700" fill="#64748B" text-anchor="middle">DIRECTOR OF SURVEYS — LODGEMENT APPROVAL</text>
    <text x="${f1(x + w / 2)}" y="${f1(y + h * 0.58)}" font-size="7.5" fill="#94A3B8" text-anchor="middle">AUTHENTICATION STAMP &amp; REGISTRATION ENTRY</text>
    <text x="${f1(x + w / 2)}" y="${f1(y + h * 0.8)}" font-size="7.5" font-family="monospace" fill="#94A3B8" text-anchor="middle">${esc(el.planNoPrefix ?? "DP")}-${esc(result.metadata.title)}-${esc(year)}</text>
  </g>`;
}

function renderSignoff(result: PipelineResult, el: Extract<ComposerElement, { kind: "signoff" }>): string {
  const w = el.w * PX_PER_MM;
  const x = el.x * PX_PER_MM;
  const y = el.y * PX_PER_MM;
  return `<g id="${esc(el.id)}">
    <line x1="${f1(x)}" y1="${f1(y)}" x2="${f1(x + w * 0.4)}" y2="${f1(y)}" stroke="#475569" stroke-width="1"/>
    <text x="${f1(x)}" y="${f1(y + 13)}" font-size="8" font-weight="600" fill="#0F172A">${esc(el.leftRole)}</text>
    <text x="${f1(x)}" y="${f1(y + 25)}" font-size="7.5" fill="#64748B">Date: ${esc(result.metadata.date)}</text>
    <line x1="${f1(x + w * 0.58)}" y1="${f1(y)}" x2="${f1(x + w)}" y2="${f1(y)}" stroke="#475569" stroke-width="1"/>
    <text x="${f1(x + w * 0.58)}" y="${f1(y + 13)}" font-size="8" font-weight="600" fill="#0F172A">${esc(el.rightRole)}</text>
    <text x="${f1(x + w * 0.58)}" y="${f1(y + 25)}" font-size="7.5" fill="#64748B">Statutory endorsement</text>
  </g>`;
}

function renderText(el: Extract<ComposerElement, { kind: "text" }>): string {
  return `<text id="${esc(el.id)}" x="${f1(el.x * PX_PER_MM)}" y="${f1(el.y * PX_PER_MM)}" font-size="${el.sizePt}" ${el.mono ? 'font-family="monospace"' : ""} font-weight="${el.weight ?? 400}" fill="${el.color ?? "#0F172A"}" ${el.tracking ? `letter-spacing="${el.tracking}"` : ""} text-anchor="${el.align ?? "start"}">${esc(el.text)}</text>`;
}

/* ------------------------------------------------------------------ */
/* Locator (index) inset                                                */
/* ------------------------------------------------------------------ */

function renderLocator(result: PipelineResult, el: ComposerLocator): string {
  const w = el.w * PX_PER_MM;
  const h = el.h * PX_PER_MM;
  const x0 = el.x * PX_PER_MM;
  const y0 = el.y * PX_PER_MM;
  const out: string[] = [`<g id="${esc(el.id)}">`];

  let y = y0;
  if (el.title) {
    out.push(`<text x="${f1(x0)}" y="${f1(y + 8)}" font-size="8" font-weight="700" fill="#475569" letter-spacing="0.5">${esc(el.title)}</text>`);
    y += 16;
  }
  const frameH = h - (y - y0) - 14; // reserve a caption line

  // Feature extent: the adjusted boundary when present, else all surveyed points.
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  const grow = (e: number, n: number) => {
    if (e < minE) minE = e;
    if (e > maxE) maxE = e;
    if (n < minN) minN = n;
    if (n > maxN) maxN = n;
  };
  if (result.boundary) for (const p of result.boundary.points) grow(p.easting, p.northing);
  if (!isFinite(minE)) for (const p of result.points) grow(p.easting, p.northing);
  const model = isFinite(minE) && frameH > 10
    ? buildLocatorModel({ minE, maxE, minN, maxN }, result.metadata.crs)
    : null;

  if (!model) {
    out.push(
      `<rect x="${f1(x0)}" y="${f1(y)}" width="${f1(w)}" height="${f1(Math.max(14, frameH))}" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="0.75"/>` +
      `<text x="${f1(x0 + w / 2)}" y="${f1(y + Math.max(14, frameH) / 2 + 3)}" font-size="7" fill="#94A3B8" text-anchor="middle">Locator needs a boundary or points</text>`,
    );
    out.push("</g>");
    return out.join("\n");
  }

  // Aspect-true fit of the grid window into the element box.
  const win = model.window;
  const pxPerM = Math.min(w / (win.maxE - win.minE), frameH / (win.maxN - win.minN));
  const gw = (win.maxE - win.minE) * pxPerM;
  const gh = (win.maxN - win.minN) * pxPerM;
  const gx = x0 + (w - gw) / 2;
  const gy = y + (frameH - gh) / 2;
  const toX = (e: number) => gx + (e - win.minE) * pxPerM;
  const toY = (n: number) => gy + gh - (n - win.minN) * pxPerM;

  out.push(`<rect x="${f1(gx)}" y="${f1(gy)}" width="${f1(gw)}" height="${f1(gh)}" fill="#F8FAFC" stroke="#94A3B8" stroke-width="0.75"/>`);

  // 100 km grid with kilometre labels on the window edges.
  for (const e of model.eastings) {
    const sx = toX(e);
    if (sx < gx - 0.5 || sx > gx + gw + 0.5) continue;
    out.push(
      `<line x1="${f1(sx)}" y1="${f1(gy)}" x2="${f1(sx)}" y2="${f1(gy + gh)}" stroke="#C9D2DB" stroke-width="0.6"/>` +
      `<text x="${f1(sx)}" y="${f1(gy + gh + 9)}" font-size="5.8" font-family="monospace" fill="#64748B" text-anchor="middle">${Math.round(e / 1000)}</text>`,
    );
  }
  for (const n of model.northings) {
    const sy = toY(n);
    if (sy < gy - 0.5 || sy > gy + gh + 0.5) continue;
    out.push(
      `<line x1="${f1(gx)}" y1="${f1(sy)}" x2="${f1(gx + gw)}" y2="${f1(sy)}" stroke="#C9D2DB" stroke-width="0.6"/>` +
      `<text x="${f1(gx - 3)}" y="${f1(sy + 2)}" font-size="5.8" font-family="monospace" fill="#64748B" text-anchor="end">${Math.round(n / 1000)}</text>`,
    );
  }

  // Parcel extent box, labelled when a parcel number exists.
  if (model.extent) {
    const ex0 = toX(model.extent.minE);
    const ex1 = toX(model.extent.maxE);
    const ey0 = toY(model.extent.maxN);
    const ey1 = toY(model.extent.minN);
    out.push(
      `<rect x="${f1(ex0)}" y="${f1(ey0)}" width="${f1(Math.max(2.5, ex1 - ex0))}" height="${f1(Math.max(2.5, ey1 - ey0))}" fill="#EF4444" fill-opacity="0.25" stroke="#B91C1C" stroke-width="1"/>`,
    );
    if (result.boundary?.parcelNo && ex1 - ex0 > 8) {
      out.push(
        `<text x="${f1((ex0 + ex1) / 2)}" y="${f1(ey0 - 2.5)}" font-size="6" font-family="monospace" fill="#B91C1C" text-anchor="middle">${esc(result.boundary.parcelNo)}</text>`,
      );
    }
  }

  const zoneTxt = model.zone
    ? `UTM zone ${model.zone.zone}${model.zone.south ? "S" : "N"}`
    : "grid coordinates (CRS not UTM)";
  out.push(
    `<text x="${f1(x0)}" y="${f1(y + frameH + 11)}" font-size="6.5" font-family="monospace" fill="#64748B">100 km grid · ${esc(zoneTxt)} · extent box = parcel</text>`,
  );
  out.push("</g>");
  return out.join("\n");
}

/* ------------------------------------------------------------------ */
/* Sheet assembly                                                      */
/* ------------------------------------------------------------------ */

export function renderTemplate(template: ComposerTemplate, result: PipelineResult, options?: RenderOptions): RenderedSheet {
  const dims = pageDimsMm(template.page);
  const W = dims.w * PX_PER_MM;
  const H = dims.h * PX_PER_MM;

  const body: string[] = [];

  // Statutory double frame
  body.push(`<rect x="0" y="0" width="${f1(W)}" height="${f1(H)}" fill="#FFFFFF"/>`);
  body.push(`<rect x="${f1(8 * PX_PER_MM)}" y="${f1(8 * PX_PER_MM)}" width="${f1(W - 16 * PX_PER_MM)}" height="${f1(H - 16 * PX_PER_MM)}" fill="none" stroke="#0F172A" stroke-width="2.5"/>`);
  body.push(`<rect x="${f1(10 * PX_PER_MM)}" y="${f1(10 * PX_PER_MM)}" width="${f1(W - 20 * PX_PER_MM)}" height="${f1(H - 20 * PX_PER_MM)}" fill="none" stroke="#94A3B8" stroke-width="0.75"/>`);

  // Shared defs — relief ramp for the legend swatch.
  body.push(
    `<defs><linearGradient id="legend_relief_ramp" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="rgb(150,150,150)"/><stop offset="0.5" stop-color="rgb(210,210,210)"/><stop offset="1" stop-color="rgb(255,255,255)"/>` +
    `</linearGradient></defs>`,
  );

  // Header band (token-substituted with live metadata)
  if (template.header) {
    const cx = W / 2;
    const sub = template.header.lines.map((l) => substituteTextTokens(l, result.metadata));
    const [l1, l2, l3] = sub;
    body.push(
      `<g transform="translate(${f1(cx)}, ${f1(20 * PX_PER_MM)})" text-anchor="middle">` +
      `<text y="0" font-size="15" font-weight="800" letter-spacing="2" fill="#0F172A">${esc(l1)}</text>` +
      `<text y="19" font-size="12" font-weight="700" letter-spacing="1" fill="#334155">${esc(l2)}</text>` +
      (l3 ? `<text y="36" font-size="9" font-weight="500" fill="#64748B">${esc(l3)}</text>` : "") +
      `</g>`,
    );
  }

  // Elements — collect map-frame resolutions for scale bars
  const frameRes: { id: string; pxPerM: number }[] = [];
  let sheetRelief = false;
  for (const el of template.elements) {
    if (el.kind === "map-frame") {
      const proj = buildFrameProj(result, el);
      if (proj) frameRes.push({ id: el.id, pxPerM: proj.pxPerM });
      if (el.layers.relief !== false && result.tin && result.tin.triangles.length > 0) sheetRelief = true;
    }
  }

  for (const el of template.elements) {
    switch (el.kind) {
      case "map-frame": body.push(renderMapFrame(result, el)); break;
      case "table": body.push(renderTable(result, el)); break;
      case "kpi-strip": body.push(renderKpiStrip(result, el)); break;
      case "legend": body.push(renderLegend(result, el, sheetRelief)); break;
      case "north-arrow": body.push(renderNorthArrow(el)); break;
      case "scale-bar": body.push(renderScaleBar(el, frameRes)); break;
      case "method-note": body.push(renderMethodNote(result, el, options)); break;
      case "title-block": body.push(renderTitleBlock(result, el)); break;
      case "certification": body.push(renderCertification(result, el)); break;
      case "approval-stamp": body.push(renderApprovalStamp(result, el)); break;
      case "signoff": body.push(renderSignoff(result, el)); break;
      case "locator": body.push(renderLocator(result, el)); break;
      case "text": body.push(renderText({ ...el, text: substituteTextTokens(el.text, result.metadata) })); break;
    }
  }

  // Footer
  if (template.footer) {
    const ctx = buildResolveContext(result);
    body.push(
      `<g transform="translate(${f1(W / 2)}, ${f1(H - 9 * PX_PER_MM)})" text-anchor="middle">` +
      `<text font-size="8" font-family="monospace" fill="#94A3B8">${esc(resolveFooter(template.footer, ctx))}</text></g>`,
    );
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f1(W)} ${f1(H)}" width="${f1(W)}" height="${f1(H)}" style="background-color:#FFFFFF;font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif;">\n` +
    body.join("\n") +
    `\n</svg>`;

  return { svg, widthMm: dims.w, heightMm: dims.h, widthPx: Math.round(W), heightPx: Math.round(H) };
}

/** Quick structural sanity check used by tests and the composer panel. */
export function validateSheetSvg(svg: string): string[] {
  const problems: string[] = [];
  if (!svg.startsWith("<svg")) problems.push("missing svg root");
  if (/NaN|Infinity|undefined/.test(svg)) problems.push("NaN/Infinity/undefined leaked into output");
  if (svg.includes("compliance score")) problems.push("fabricated indicator detected");
  return problems;
}
