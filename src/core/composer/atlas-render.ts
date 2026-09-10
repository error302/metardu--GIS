/**
 * Atlas Series — sheet rendering.
 *
 * Turns an AtlasPlan into print sheets:
 *  - renderAtlasSheet: one map sheet at the plan's uniform scale, with
 *    atlas furniture — identity header, graticule aligned to round ground
 *    steps (so grid lines continue across neighbouring sheets), edge
 *    coordinate labels, neighbour go-to tabs, north arrow, scale bar, and
 *    a factual footer. Cap compromises are disclosed on the sheet itself.
 *  - renderAtlasIndexSheet: the classic index-to-sheets overview — every
 *    sheet rectangle, labelled, with the project extent outlined.
 *
 * The map content itself is rendered by the composer's renderMapFrame at
 * an explicit extent (ComposerMapFrame.extentOverride) — every layer of
 * the standard frame (relief, contours, suitability, hazards…) comes
 * along for free, and the no-fabricated-figures contract is inherited.
 */

import { PipelineResult } from "../../types/spatial";
import { pageDimsMm, ComposerMapFrame } from "./template";
import {
  PX_PER_MM, RenderedSheet, renderMapFrame, renderNorthArrow, renderScaleBar,
  scaleDenominatorLabel,
} from "./render";
import { AtlasPlan, AtlasSheet } from "./atlas";

/* ------------------------------------------------------------------ */
/* Options                                                             */
/* ------------------------------------------------------------------ */

export interface AtlasLayerToggles {
  points: boolean;
  vectors: boolean;
  boundary: boolean;
  contours: boolean;
  relief: boolean;
  suitability: boolean;
  hazards: boolean;
  energy: boolean;
}

export const DEFAULT_ATLAS_LAYERS: AtlasLayerToggles = {
  points: true,
  vectors: true,
  boundary: true,
  contours: true,
  relief: true,
  suitability: false,
  hazards: false,
  energy: false,
};

export interface AtlasRenderOptions {
  layers?: AtlasLayerToggles;
  /** Header title on every sheet (default "ATLAS SERIES"). */
  atlasTitle?: string;
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const esc = (s: unknown): string =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

const INK = "#0F172A";
const MUTED = "#64748B";
const FAINT = "#94A3B8";
const TICK = "#475569";
const GRID = "#B9C4CF";
const AMBER = "#B45309";

const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtScale = (denom: number) => `1:${denom.toLocaleString("en-US")}`;

/** Round ground steps that keep the atlas grid continuous across sheets. */
const GRATICULE_CANDIDATES = [
  50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000,
];

function graticuleStep(groundSpan: number): number {
  for (const s of GRATICULE_CANDIDATES) {
    if (groundSpan / s <= 7.5) return s;
  }
  return 200000;
}

/** Page chrome: white ground + statutory double neatline + header band. */
function chrome(
  W: number,
  H: number,
  pageWmm: number,
  leftTitle: string,
  leftSub: string,
  rightBig: string,
  rightSub: string,
): string[] {
  const out: string[] = [];
  out.push(`<rect x="0" y="0" width="${f1(W)}" height="${f1(H)}" fill="#FFFFFF"/>`);
  out.push(`<rect x="${f1(8 * PX_PER_MM)}" y="${f1(8 * PX_PER_MM)}" width="${f1(W - 16 * PX_PER_MM)}" height="${f1(H - 16 * PX_PER_MM)}" fill="none" stroke="${INK}" stroke-width="2.5"/>`);
  out.push(`<rect x="${f1(10 * PX_PER_MM)}" y="${f1(10 * PX_PER_MM)}" width="${f1(W - 20 * PX_PER_MM)}" height="${f1(H - 20 * PX_PER_MM)}" fill="none" stroke="${FAINT}" stroke-width="0.75"/>`);
  const xL = 14 * PX_PER_MM;
  const xR = (pageWmm - 14) * PX_PER_MM;
  out.push(
    `<text x="${f1(xL)}" y="${f1(21 * PX_PER_MM)}" font-size="15" font-weight="800" letter-spacing="2" fill="${INK}">${esc(leftTitle)}</text>` +
    `<text x="${f1(xL)}" y="${f1(27.5 * PX_PER_MM)}" font-size="8" font-family="monospace" fill="${MUTED}">${esc(leftSub)}</text>` +
    `<text x="${f1(xR)}" y="${f1(21 * PX_PER_MM)}" font-size="15" font-weight="800" letter-spacing="1.5" fill="${INK}" text-anchor="end">${esc(rightBig)}</text>` +
    `<text x="${f1(xR)}" y="${f1(27.5 * PX_PER_MM)}" font-size="8" font-family="monospace" fill="${MUTED}" text-anchor="end">${esc(rightSub)}</text>` +
    `<line x1="${f1(10 * PX_PER_MM)}" y1="${f1(30.5 * PX_PER_MM)}" x2="${f1(W - 10 * PX_PER_MM)}" y2="${f1(30.5 * PX_PER_MM)}" stroke="#CBD5E1" stroke-width="0.75"/>`,
  );
  return out;
}

/** Factual footer; atlas-plan compromises are disclosed here in amber. */
function footer(
  W: number,
  H: number,
  line: string,
  disclosure: string | null,
): string {
  let s =
    `<text x="${f1(W / 2)}" y="${f1(H - 9 * PX_PER_MM)}" font-size="8" font-family="monospace" fill="${FAINT}" text-anchor="middle">${esc(line)}</text>`;
  if (disclosure) {
    s +=
      `<text x="${f1(W / 2)}" y="${f1(H - 12.5 * PX_PER_MM)}" font-size="6.5" font-family="monospace" fill="${AMBER}" text-anchor="middle">${esc(disclosure)}</text>`;
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* Map sheet                                                           */
/* ------------------------------------------------------------------ */

/**
 * Render one atlas sheet. The sheet's map content is the standard frame
 * renderer at the planned extent + uniform scale; everything this module
 * adds is furniture around (and over) that frame.
 */
export function renderAtlasSheet(
  plan: AtlasPlan,
  sheet: AtlasSheet,
  result: PipelineResult,
  options?: AtlasRenderOptions,
): RenderedSheet {
  if (!plan.sheets.some((s) => s.label === sheet.label)) {
    throw new Error(`sheet "${sheet.label}" is not part of the supplied atlas plan`);
  }
  const L = { ...DEFAULT_ATLAS_LAYERS, ...(options?.layers ?? {}) };
  const title = options?.atlasTitle ?? "ATLAS SERIES";
  const dims = pageDimsMm(plan.page);
  const W = dims.w * PX_PER_MM;
  const H = dims.h * PX_PER_MM;
  const fb = plan.frameBox;
  const fx = fb.x * PX_PER_MM;
  const fy = fb.y * PX_PER_MM;
  const fw = fb.w * PX_PER_MM;
  const fh = fb.h * PX_PER_MM;
  const total = plan.sheets.length;
  const scaleTxt = fmtScale(plan.scaleDenominator);

  const body: string[] = [];
  body.push(...chrome(
    W, H, dims.w,
    title,
    `${result.metadata.locality} · ${result.metadata.country} · ${result.metadata.crs}`,
    `SHEET ${sheet.label}`,
    `Sheet ${sheet.index} of ${total} · ${scaleTxt}`,
  ));

  // Map content at the exact planned extent — uniform scale, no fitting.
  const frame: ComposerMapFrame = {
    kind: "map-frame",
    id: "atlas_map",
    x: fb.x, y: fb.y, w: fb.w, h: fb.h,
    fit: "features",
    scaleDenominator: plan.scaleDenominator,
    extentOverride: { ...sheet.extent },
    layers: {
      points: L.points, vectors: L.vectors, boundary: L.boundary,
      contours: L.contours, suitability: L.suitability, hazards: L.hazards,
      energy: L.energy, graticule: false, relief: L.relief,
    },
    labelLimit: 60,
  };
  body.push(renderMapFrame(result, frame));

  /* --- Atlas graticule — round ground steps, continuous across sheets --- */
  const stepE = graticuleStep(sheet.extent.maxE - sheet.extent.minE);
  const stepN = graticuleStep(sheet.extent.maxN - sheet.extent.minN);
  const grid: string[] = [];
  const firstE = Math.ceil(sheet.extent.minE / stepE) * stepE;
  for (let e = firstE; e <= sheet.extent.maxE + 1e-6; e += stepE) {
    const x = fx + ((e - sheet.extent.minE) / (sheet.extent.maxE - sheet.extent.minE)) * fw;
    grid.push(
      `<line x1="${f1(x)}" y1="${f1(fy)}" x2="${f1(x)}" y2="${f1(fy + fh)}" stroke="${GRID}" stroke-width="0.6" stroke-dasharray="4,4"/>` +
      `<line x1="${f1(x)}" y1="${f1(fy)}" x2="${f1(x)}" y2="${f1(fy + 5)}" stroke="${TICK}" stroke-width="1.2"/>` +
      `<line x1="${f1(x)}" y1="${f1(fy + fh - 5)}" x2="${f1(x)}" y2="${f1(fy + fh)}" stroke="${TICK}" stroke-width="1.2"/>`,
    );
    // Coordinate labels inside the frame, top and bottom edges.
    const t = `${fmtInt(e)} m E`;
    grid.push(
      `<text x="${f1(x)}" y="${f1(fy + 11)}" font-size="7.5" font-family="monospace" fill="${TICK}" text-anchor="middle" paint-order="stroke" stroke="#FFFFFF" stroke-width="2.2" stroke-linejoin="round">${esc(t)}</text>` +
      `<text x="${f1(x)}" y="${f1(fy + fh - 5)}" font-size="7.5" font-family="monospace" fill="${TICK}" text-anchor="middle" paint-order="stroke" stroke="#FFFFFF" stroke-width="2.2" stroke-linejoin="round">${esc(t)}</text>`,
    );
  }
  const firstN = Math.ceil(sheet.extent.minN / stepN) * stepN;
  for (let n = firstN; n <= sheet.extent.maxN + 1e-6; n += stepN) {
    const y = fy + ((sheet.extent.maxN - n) / (sheet.extent.maxN - sheet.extent.minN)) * fh;
    grid.push(
      `<line x1="${f1(fx)}" y1="${f1(y)}" x2="${f1(fx + fw)}" y2="${f1(y)}" stroke="${GRID}" stroke-width="0.6" stroke-dasharray="4,4"/>` +
      `<line x1="${f1(fx)}" y1="${f1(y)}" x2="${f1(fx + 5)}" y2="${f1(y)}" stroke="${TICK}" stroke-width="1.2"/>` +
      `<line x1="${f1(fx + fw - 5)}" y1="${f1(y)}" x2="${f1(fx + fw)}" y2="${f1(y)}" stroke="${TICK}" stroke-width="1.2"/>`,
    );
    const t = `${fmtInt(n)} m N`;
    grid.push(
      `<text x="${f1(fx + 5)}" y="${f1(y + 3)}" font-size="7.5" font-family="monospace" fill="${TICK}" text-anchor="start" paint-order="stroke" stroke="#FFFFFF" stroke-width="2.2" stroke-linejoin="round">${esc(t)}</text>`,
    );
  }
  body.push(`<g clip-path="url(#clip_atlas_map)">${grid.join("\n")}</g>`);

  /* --- Neighbour go-to tabs (inside the frame edges, tab wins over grid) --- */
  const tabW = 17 * PX_PER_MM;
  const tabH = 5.2 * PX_PER_MM;
  const cx = fx + fw / 2;
  const cy = fy + fh / 2;
  const tab = (x: number, y: number, text: string) =>
    `<g><rect x="${f1(x)}" y="${f1(y)}" width="${f1(tabW)}" height="${f1(tabH)}" rx="2" fill="${INK}" fill-opacity="0.9"/>` +
    `<text x="${f1(x + tabW / 2)}" y="${f1(y + tabH / 2 + 3)}" font-size="8.5" font-weight="700" font-family="monospace" fill="#FFFFFF" text-anchor="middle">${esc(text)}</text></g>`;
  if (sheet.neighbors.w) body.push(tab(fx + 2 * PX_PER_MM, cy - tabH / 2, `\u2190 ${sheet.neighbors.w}`));
  if (sheet.neighbors.e) body.push(tab(fx + fw - 2 * PX_PER_MM - tabW, cy - tabH / 2, `${sheet.neighbors.e} \u2192`));
  if (sheet.neighbors.n) body.push(tab(cx - tabW / 2, fy + 2 * PX_PER_MM, `\u2191 ${sheet.neighbors.n}`));
  if (sheet.neighbors.s) body.push(tab(cx - tabW / 2, fy + fh - 2 * PX_PER_MM - tabH, `\u2193 ${sheet.neighbors.s}`));

  /* --- North arrow (top-right inside the frame) --- */
  body.push(renderNorthArrow({
    kind: "north-arrow", id: "atlas_north",
    x: fb.x + fb.w - 10, y: fb.y + 10, sizeMm: 11,
  }));

  /* --- Scale bar (bottom-centre inside the frame, on a backing plate) --- */
  const pxPerM = (1000 * PX_PER_MM) / plan.scaleDenominator;
  const barWmm = 42;
  const barX = fb.x + fb.w / 2 - barWmm / 2;
  const barY = fb.y + fb.h - 8;
  body.push(
    `<rect x="${f1(barX * PX_PER_MM - 10)}" y="${f1(barY * PX_PER_MM - 17)}" width="${f1((barWmm + 16) * PX_PER_MM)}" height="${f1(26)}" rx="3" fill="#FFFFFF" fill-opacity="0.85"/>`,
  );
  body.push(renderScaleBar(
    { kind: "scale-bar", id: "atlas_scalebar", x: barX, y: barY, w: barWmm, mapFrameId: "atlas_map" },
    [{ id: "atlas_map", pxPerM }],
  ));

  body.push(footer(
    W, H,
    `${title} \u00b7 SHEET ${sheet.label} (${sheet.index} OF ${total}) \u00b7 ${scaleTxt} \u00b7 ${result.metadata.crs} \u00b7 ${result.metadata.organization} \u00b7 ${result.metadata.date}`,
    plan.disclosure,
  ));

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f1(W)} ${f1(H)}" width="${f1(W)}" height="${f1(H)}" style="background-color:#FFFFFF;font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif;">\n` +
    body.join("\n") +
    `\n</svg>`;
  return { svg, widthMm: dims.w, heightMm: dims.h, widthPx: Math.round(W), heightPx: Math.round(H) };
}

/* ------------------------------------------------------------------ */
/* Index sheet                                                         */
/* ------------------------------------------------------------------ */

/**
 * The index-to-sheets overview: every sheet rectangle labelled at fit
 * scale, the project extent outlined in amber, approximate scale
 * disclosed. Geometry comes from the plan — nothing is fabricated.
 */
export function renderAtlasIndexSheet(
  plan: AtlasPlan,
  result: PipelineResult,
  options?: AtlasRenderOptions,
): RenderedSheet {
  const title = options?.atlasTitle ?? "ATLAS SERIES";
  const dims = pageDimsMm(plan.page);
  const W = dims.w * PX_PER_MM;
  const H = dims.h * PX_PER_MM;
  const fb = plan.frameBox;
  const total = plan.sheets.length;
  const scaleTxt = fmtScale(plan.scaleDenominator);

  const body: string[] = [];
  body.push(...chrome(
    W, H, dims.w,
    title,
    `Index to the ${total}-sheet atlas \u00b7 ${scaleTxt} series \u00b7 ${Math.round(plan.overlapFrac * 100)}% sheet overlap`,
    "SHEET INDEX",
    `${total} sheets \u00b7 rows A\u2013${String.fromCharCode(64 + plan.rows)} \u00b7 ${plan.cols} \u00d7 ${plan.rows} grid`,
  ));

  // Fit the atlas coverage into the content box (4% pad), centred.
  const cov = plan.coverage;
  const covW = cov.maxE - cov.minE;
  const covH = cov.maxN - cov.minN;
  const bw = fb.w * PX_PER_MM;
  const bh = fb.h * PX_PER_MM;
  const pxPerM = Math.min((bw * 0.96) / covW, (bh * 0.96) / covH);
  const ox = fb.x * PX_PER_MM + (bw - covW * pxPerM) / 2;
  const oy = fb.y * PX_PER_MM + (bh - covH * pxPerM) / 2;
  const toX = (e: number) => ox + (e - cov.minE) * pxPerM;
  const toY = (n: number) => oy + (cov.maxN - n) * pxPerM;

  // Index frame
  body.push(
    `<rect x="${f1(fb.x * PX_PER_MM)}" y="${f1(fb.y * PX_PER_MM)}" width="${f1(bw)}" height="${f1(bh)}" fill="#F8FAFC" stroke="${"#0F172A"}" stroke-width="1.5"/>`,
  );

  // Project extent (amber, dashed) under the sheet rectangles
  const src = plan.sourceExtent;
  body.push(
    `<rect x="${f1(toX(src.minE))}" y="${f1(toY(src.maxN))}" width="${f1((src.maxE - src.minE) * pxPerM)}" height="${f1((src.maxN - src.minN) * pxPerM)}" fill="${AMBER}" fill-opacity="0.06" stroke="${AMBER}" stroke-width="1.8" stroke-dasharray="6,4"/>` +
    `<text x="${f1(toX(src.minE) + 5)}" y="${f1(toY(src.maxN) + 12)}" font-size="7" font-weight="700" letter-spacing="1" fill="${AMBER}">PROJECT EXTENT</text>`,
  );

  // Sheet rectangles — overlap makes the mosaic legible
  for (const s of plan.sheets) {
    const x = toX(s.extent.minE);
    const y = toY(s.extent.maxN);
    const w = plan.groundW * pxPerM;
    const h = plan.groundH * pxPerM;
    body.push(
      `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" fill="#FFFFFF" fill-opacity="0.55" stroke="${"#64748B"}" stroke-width="0.9"/>` +
      `<text x="${f1(x + w / 2)}" y="${f1(y + h / 2 + 3)}" font-size="8.5" font-weight="700" font-family="monospace" fill="${"#0F172A"}" text-anchor="middle">${esc(s.label)}</text>`,
    );
  }

  // North arrow + approximate-scale caption
  body.push(renderNorthArrow({
    kind: "north-arrow", id: "atlas_index_north",
    x: fb.x + fb.w - 10, y: fb.y + 10, sizeMm: 11,
  }));
  body.push(
    `<text x="${f1(fb.x * PX_PER_MM + bw)}" y="${f1(fb.y * PX_PER_MM + bh + 12)}" font-size="7.5" font-family="monospace" fill="${MUTED}" text-anchor="end">INDEX \u2014 approximate scale 1:${fmtInt(scaleDenominatorLabel(pxPerM))} (fit) \u00b7 ${result.metadata.crs}</text>`,
  );

  body.push(footer(
    W, H,
    `${title} \u00b7 SHEET INDEX (${total} SHEETS) \u00b7 ${scaleTxt} SERIES \u00b7 ${result.metadata.crs} \u00b7 ${result.metadata.organization} \u00b7 ${result.metadata.date}`,
    plan.disclosure,
  ));

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f1(W)} ${f1(H)}" width="${f1(W)}" height="${f1(H)}" style="background-color:#FFFFFF;font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif;">\n` +
    body.join("\n") +
    `\n</svg>`;
  return { svg, widthMm: dims.w, heightMm: dims.h, widthPx: Math.round(W), heightPx: Math.round(H) };
}
