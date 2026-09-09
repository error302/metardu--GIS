/**
 * Print Composer v2 — template schema.
 *
 * A template is a page (ISO A-series, mm) plus a list of positioned elements.
 * Every element renders from *computed pipeline state* — the renderer has no
 * access to fabricated numbers, so a template cannot fabricate them either.
 *
 * Coordinates are millimetres relative to the top-left page corner, which
 * keeps templates unit-stable across printers and DPI. The renderer converts
 * mm → SVG px at 96 dpi.
 *
 * Version 1 — additive evolution only: new element kinds may appear, existing
 * fields keep their meaning.
 */

import { ProjectMetadata } from "../../types/spatial";

export type PageSizeKey = "A4" | "A3" | "A2" | "A1";
export type Orientation = "portrait" | "landscape";

/** ISO 216 A-series trimmed sizes in mm (w × h, portrait). */
export const PAGE_MM: Record<PageSizeKey, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
  A2: { w: 420, h: 594 },
  A1: { w: 594, h: 841 },
};

export function pageDimsMm(page: { size: PageSizeKey; orientation: Orientation }): { w: number; h: number } {
  const { w, h } = PAGE_MM[page.size];
  return page.orientation === "landscape" ? { w: h, h: w } : { w, h };
}

/* ------------------------------------------------------------------ */
/* Element kinds                                                       */
/* ------------------------------------------------------------------ */

export interface MapFrameLayers {
  points: boolean;
  vectors: boolean;
  boundary: boolean;
  contours: boolean;
  suitability: boolean;
  hazards: boolean;
  energy: boolean;
  graticule: boolean;
}

export interface ComposerMapFrame {
  kind: "map-frame";
  id: string;
  x: number; y: number; w: number; h: number; // mm
  /** Feature set used to compute the frame's ground extent. */
  fit: "boundary" | "features" | "suitability";
  /** Force a fixed 1:N denominator instead of fit-to-frame (null = fit). */
  scaleDenominator: number | null;
  layers: MapFrameLayers;
  /** Suppress beacon badges beyond this count (dot mode instead). */
  labelLimit?: number;
}

/** A resolved field row: literal text or a computed reference. */
export type FieldValue =
  | string
  | { ref: FieldRefKey };

export type FieldRefKey =
  | "meta.title" | "meta.locality" | "meta.country" | "meta.crs"
  | "meta.surveyorName" | "meta.registrationNo" | "meta.date" | "meta.scale"
  | "meta.organization"
  | "boundary.parcelNo" | "boundary.areaHa" | "boundary.areaAcres"
  | "boundary.perimeterM" | "boundary.precisionRatio" | "boundary.precisionRating"
  | "computed.featureCount" | "computed.vectorCount" | "computed.contourCount"
  | "computed.clusterCount" | "computed.householdTotal" | "computed.capexTotal"
  | "computed.sinkCount" | "computed.exposedCount"
  | "computed.geoidModel" | "computed.adjustmentMethod" | "computed.gridDims";

export interface ComposerTitleBlock {
  kind: "title-block";
  id: string;
  x: number; y: number; w: number; h?: number;
  title: string;
  fields: { label: string; value: FieldValue }[];
  /** Render a signature rule at the block foot. */
  signatureLine?: string;
}

export interface ComposerText {
  kind: "text";
  id: string;
  x: number; y: number; w?: number;
  text: string;
  sizePt: number;
  weight?: 400 | 500 | 600 | 700 | 800;
  tracking?: number;
  align?: "start" | "middle" | "end";
  mono?: boolean;
  color?: string;
}

export type TableSource = "beacons" | "hazards" | "energy" | "telemetry" | "provenance";

export interface ComposerTable {
  kind: "table";
  id: string;
  x: number; y: number; w: number;
  source: TableSource;
  title?: string;
  /** Max data rows before truncation note (schedules stay print-sized). */
  maxRows?: number;
}

export interface ComposerLegend {
  kind: "legend";
  id: string;
  x: number; y: number; w: number;
  title?: string;
}

export interface ComposerNorthArrow {
  kind: "north-arrow";
  id: string;
  x: number; y: number;
  sizeMm: number;
}

export interface ComposerScaleBar {
  kind: "scale-bar";
  id: string;
  x: number; y: number; w: number;
  /** Which map frame supplies the ground resolution (first frame on sheet). */
  mapFrameId?: string;
}

export type KpiMetric =
  | "areaHa" | "perimeterM" | "precisionRatio"
  | "buildableHa" | "suitablePct"
  | "exposedAssets" | "featureCount"
  | "capexUsd" | "households";

export interface ComposerKpiStrip {
  kind: "kpi-strip";
  id: string;
  x: number; y: number; w: number;
  metrics: KpiMetric[];
}

/** Auto-generated provenance block — every line derived from live state. */
export interface ComposerMethodNote {
  kind: "method-note";
  id: string;
  x: number; y: number; w: number;
}

/** Surveyor certification (Survey Act style) with seal/signature rule. */
export interface ComposerCertification {
  kind: "certification";
  id: string;
  x: number; y: number; w: number; h?: number;
}

/** Dashed lodgement / approval stamp box. */
export interface ComposerApprovalStamp {
  kind: "approval-stamp";
  id: string;
  x: number; y: number; w: number; h: number;
  planNoPrefix?: string;
}

/** Two-party signoff with signature rules. */
export interface ComposerSignoff {
  kind: "signoff";
  id: string;
  x: number; y: number; w: number;
  leftRole: string;
  rightRole: string;
}

export type ComposerElement =
  | ComposerMapFrame
  | ComposerTitleBlock
  | ComposerText
  | ComposerTable
  | ComposerLegend
  | ComposerNorthArrow
  | ComposerScaleBar
  | ComposerKpiStrip
  | ComposerMethodNote
  | ComposerCertification
  | ComposerApprovalStamp
  | ComposerSignoff;

export interface ComposerTemplate {
  id: string;
  title: string;
  version: 1;
  page: { size: PageSizeKey; orientation: Orientation };
  /** Optional statutory header band (republic / form title / subcaption). */
  header?: { lines: [string, string, string] } | null;
  /** Footer template — "{crs}", "{date}", "{org}" tokens substituted. */
  footer?: string | null;
  elements: ComposerElement[];
}

/* ------------------------------------------------------------------ */
/* Field reference resolution                                          */
/* ------------------------------------------------------------------ */

export interface ResolveContext {
  metadata: ProjectMetadata;
  boundary: {
    parcelNo: string; areaHa: number; areaAcres: number; perimeterM: number;
    precisionRatio: number; precisionRating: string;
  } | null;
  computed: {
    featureCount: number; vectorCount: number; contourCount: number;
    clusterCount: number; householdTotal: number; capexTotal: number;
    sinkCount: number; exposedCount: number;
    geoidModel: string; adjustmentMethod: string; gridDims: string;
  };
}

/** Tokens replaced in footer strings. */
export function resolveFooter(text: string, ctx: ResolveContext): string {
  return text
    .replace("{crs}", ctx.metadata.crs)
    .replace("{date}", ctx.metadata.date)
    .replace("{org}", ctx.metadata.organization)
    .replace("{title}", ctx.metadata.title);
}

/**
 * Resolve a field reference to display text. Missing data resolves to an
 * em-dash — never to a fabricated value.
 */
export function resolveFieldValue(v: FieldValue, ctx: ResolveContext): string {
  if (typeof v === "string") return v;
  const b = ctx.boundary;
  const c = ctx.computed;
  const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
  switch (v.ref) {
    case "meta.title": return ctx.metadata.title;
    case "meta.locality": return ctx.metadata.locality;
    case "meta.country": return ctx.metadata.country;
    case "meta.crs": return ctx.metadata.crs;
    case "meta.surveyorName": return ctx.metadata.surveyorName;
    case "meta.registrationNo": return ctx.metadata.registrationNo;
    case "meta.date": return ctx.metadata.date;
    case "meta.scale": return ctx.metadata.scale;
    case "meta.organization": return ctx.metadata.organization;
    case "boundary.parcelNo": return b ? b.parcelNo : "—";
    case "boundary.areaHa": return b ? `${fmt(b.areaHa)} ha` : "—";
    case "boundary.areaAcres": return b ? `${fmt(b.areaAcres)} ac` : "—";
    case "boundary.perimeterM": return b ? `${fmt(b.perimeterM)} m` : "—";
    case "boundary.precisionRatio": return b && b.precisionRatio > 0 ? `1:${b.precisionRatio.toLocaleString("en-US")}` : "—";
    case "boundary.precisionRating": return b ? b.precisionRating : "—";
    case "computed.featureCount": return String(c.featureCount);
    case "computed.vectorCount": return String(c.vectorCount);
    case "computed.contourCount": return String(c.contourCount);
    case "computed.clusterCount": return String(c.clusterCount);
    case "computed.householdTotal": return String(c.householdTotal);
    case "computed.capexTotal": return c.capexTotal > 0 ? `$${Math.round(c.capexTotal).toLocaleString("en-US")}` : "—";
    case "computed.sinkCount": return String(c.sinkCount);
    case "computed.exposedCount": return String(c.exposedCount);
    case "computed.geoidModel": return c.geoidModel;
    case "computed.adjustmentMethod": return c.adjustmentMethod;
    case "computed.gridDims": return c.gridDims;
    default: return "—";
  }
}
