/**
 * Provenance Graph — machine-readable "how was this number produced".
 *
 * Every figure the platform exports carries its method, its inputs, and its
 * stated tolerance, as a directed graph: source → process → figure. The graph
 * is embedded in exports (GeoJSON foreign member, LandXML comment block,
 * GeoPackage `mr_provenance` table, .metardu.json project) and rendered as a
 * composer table so a statutory reviewer can audit figures on paper.
 *
 * Integrity contract: every figure node is derived from `PipelineResult` —
 * the builder has no other inputs, so it cannot fabricate. The digest is a
 * deterministic FNV-1a hash over the canonical node serialization; any change
 * to inputs, weights, or results changes the digest.
 */

import { PipelineResult } from "../types/spatial";
import { getGeoidProvenance } from "./crs";
import { getMethodology } from "./methodology-registry";

export type ProvenanceNodeKind = "source" | "process" | "figure";

export interface ProvenanceNode {
  id: string;
  kind: ProvenanceNodeKind;
  label: string;
  /** figure only: formatted display value ("12.34 ha"). */
  value?: string;
  /** figure only: machine value where it is numeric. */
  numericValue?: number;
  /** figure only: registry id from methodology-registry.ts. */
  methodId?: string;
  /** figure only: human citation resolved from the registry at build time. */
  methodCitation?: string;
  /** figure only: ids of nodes consumed (sources + processes). */
  inputs?: string[];
  /** figure only: stated tolerance / limitation — never omitted. */
  tolerance?: string;
  /** source only: where the data came from. */
  origin?: string;
  /** process only: measured duration (ms) from pipeline telemetry. */
  durationMs?: number;
}

export interface ProvenanceGraph {
  format: "METARDU_PROVENANCE";
  version: "1.0.0";
  generatedAt: string;
  project: {
    id: string;
    title: string;
    crs: string;
    surveyorName: string;
    registrationNo: string;
    date: string;
  };
  nodes: ProvenanceNode[];
  /** Deterministic integrity digest (FNV-1a 32-bit, hex). */
  digest: string;
}

/* ------------------------------------------------------------------ */
/* Digest                                                              */
/* ------------------------------------------------------------------ */

/** FNV-1a 32-bit over the canonical serialization (stable across runs). */
export function provenanceDigest(nodes: ProvenanceNode[]): string {
  const canonical = [...nodes]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((n) =>
      [
        n.id,
        n.kind,
        n.label,
        n.value ?? "",
        n.numericValue !== undefined ? String(n.numericValue) : "",
        n.methodId ?? "",
        (n.inputs ?? []).join(">"),
        n.tolerance ?? "",
        n.origin ?? "",
        n.durationMs !== undefined ? String(n.durationMs) : "",
      ].join("|"),
    )
    .join("\n");

  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/* ------------------------------------------------------------------ */
/* Formatting helpers (display only — values come from the result)     */
/* ------------------------------------------------------------------ */

const fmt = (n: number, d = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

/* ------------------------------------------------------------------ */
/* Graph builder                                                       */
/* ------------------------------------------------------------------ */

export function buildProvenanceGraph(result: PipelineResult): ProvenanceGraph {
  const nodes: ProvenanceNode[] = [];
  const push = (n: ProvenanceNode) => nodes.push(n);

  /* ── Sources ──────────────────────────────────────────────────── */

  const accuracyKnown = result.points.some((p) => typeof p.accuracyM === "number");
  push({
    id: "src:field-survey",
    kind: "source",
    label: "Field survey stations",
    origin: `${result.points.length} stations ingested${
      accuracyKnown
        ? `; instrument accuracy stated per point (worst ${fmt(
            Math.max(...result.points.map((p) => p.accuracyM ?? 0)),
            3,
          )} m)`
        : "; instrument accuracy not stated in source"
    }`,
  });

  const geoid = getGeoidProvenance();
  push({
    id: "src:geoid",
    kind: "source",
    label: "Vertical datum (geoid model)",
    origin: geoid.statutory
      ? `${geoid.model} — statutory-grade H = h − N`
      : `${geoid.model} — planning-grade fallback, NOT for statutory height work`,
  });

  push({
    id: "src:crs",
    kind: "source",
    label: "Horizontal CRS",
    origin: `${result.metadata.crs} (project metadata)`,
  });

  /* ── Processes (from pipeline telemetry — measured, not invented) ── */

  const stageNode = (step: number): string | null => {
    const t = result.telemetries[step - 1];
    if (!t) return null;
    const id = `proc:${step}`;
    push({
      id,
      kind: "process",
      label: t.stepName,
      durationMs: t.durationMs,
    });
    return id;
  };
  // Index the standard 9 stages; missing stages (empty docs) resolve to null.
  const stageIds = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(stageNode);

  /* ── Figures ──────────────────────────────────────────────────── */

  const mcda = getMethodology("settlement-suitability-mcda");
  const energy = getMethodology("offgrid-electrification");
  const hazard = getMethodology("hazard-exposure");
  const tin = getMethodology("tin-contouring");

  // Boundary area / perimeter / precision
  const b = result.boundary;
  if (b) {
    push({
      id: "fig:boundary-area",
      kind: "figure",
      label: "Parcel area",
      value: `${fmt(b.areaHa)} ha`,
      numericValue: b.areaHa,
      methodId: "cogo-shoelace",
      methodCitation:
        "Planimetric area by the coordinate (shoelace) method on adjusted boundary coordinates, split to hectares/acres.",
      inputs: ["src:field-survey", "src:crs", stageIds[4]].filter(Boolean) as string[],
      tolerance: `Bounded by traverse precision 1:${b.precisionRatio.toLocaleString("en-US")} (${b.precisionRating}); planimetric, no slope correction.`,
    });
    push({
      id: "fig:boundary-perimeter",
      kind: "figure",
      label: "Parcel perimeter",
      value: `${fmt(b.perimeterM)} m`,
      numericValue: b.perimeterM,
      methodId: "cogo-shoelace",
      methodCitation:
        "Sum of adjusted horizontal distances between consecutive boundary beacons.",
      inputs: ["src:field-survey", "src:crs", stageIds[4]].filter(Boolean) as string[],
      tolerance: `Bounded by traverse precision 1:${b.precisionRatio.toLocaleString("en-US")} (${b.precisionRating}).`,
    });
    push({
      id: "fig:boundary-precision",
      kind: "figure",
      label: "Traverse precision",
      value: `1:${b.precisionRatio.toLocaleString("en-US")}`,
      numericValue: b.precisionRatio,
      methodId: "bowditch-misclosure",
      methodCitation:
        "Linear misclosure of the closed boundary traverse (Bowditch/Compass Rule audit) expressed as perimeter:misclosure.",
      inputs: ["src:field-survey", stageIds[4]].filter(Boolean) as string[],
      tolerance: `Rating: ${b.precisionRating}. Classification thresholds: Class A ≥ 1:10,000 (urban), Class B ≥ 1:5,000 (rural).`,
    });
  }

  // Feature counts
  push({
    id: "fig:feature-count",
    kind: "figure",
    label: "Survey features",
    value: `${result.points.length} points / ${result.vectors.length} vector chains`,
    numericValue: result.points.length,
    methodId: "field-to-finish",
    methodCitation:
      "Field-to-finish feature coding: raw survey codes mapped to CAD layers (boundaries, roads, buildings, hydrology).",
    inputs: ["src:field-survey", stageIds[2]].filter(Boolean) as string[],
    tolerance: "Count of ingested features; no interpolation or generalization applied.",
  });

  // Contours
  push({
    id: "fig:contours",
    kind: "figure",
    label: "Contour isolines",
    value: `${result.contours.length} isolines`,
    numericValue: result.contours.length,
    methodId: "tin-contouring",
    methodCitation: tin?.citation ?? "Delaunay TIN interpolation with marching isolines.",
    inputs: ["src:field-survey", "src:geoid", stageIds[3]].filter(Boolean) as string[],
    tolerance: "Interpolated surface between surveyed stations; accuracy degrades with point spacing.",
  });

  // MCDA suitability distribution
  if (result.suitability.length > 0) {
    const counts: Record<string, number> = {};
    for (const c of result.suitability) counts[c.category] = (counts[c.category] ?? 0) + 1;
    const pct = (k: string) => `${((counts[k] ?? 0) / result.suitability.length * 100).toFixed(1)}%`;
    push({
      id: "fig:suitability-dist",
      kind: "figure",
      label: "Suitability class distribution",
      value: `optimal ${pct("optimal")} · suitable ${pct("suitable")} · moderate ${pct("moderate")} · restricted ${pct("restricted")} · hazard ${pct("hazard")} (n=${result.suitability.length} cells)`,
      methodId: "settlement-suitability-mcda",
      methodCitation: mcda?.citation ?? "Weighted linear combination MCDA.",
      inputs: ["src:field-survey", "src:crs", stageIds[3], stageIds[6]].filter(Boolean) as string[],
      tolerance:
        "Planning-grade screening, not a statutory determination; sensitive to MCDA weights (see sensitivity disclosure on decision documents).",
    });
  }

  // Hazard
  push({
    id: "fig:hazard",
    kind: "figure",
    label: "Hazard & flood exposure",
    value: `${result.hazardSinks.length} depression sinks · ${result.exposedAssets.length} exposed assets`,
    numericValue: result.hazardSinks.length,
    methodId: "hazard-exposure",
    methodCitation: hazard?.citation ?? "Depression sink detection from TIN + asset exposure radius.",
    inputs: ["src:field-survey", "src:geoid", stageIds[3], stageIds[7]].filter(Boolean) as string[],
    tolerance: "Hydrologic screening from surveyed terrain geometry only; not a rainfall-runoff forecast. Unsurveyed depressions outside the TIN footprint are not detected.",
  });

  // Energy
  if (result.energyClusters.length > 0) {
    const hh = result.energyClusters.reduce((s, c) => s + c.householdCount, 0);
    const capex = result.energyClusters.reduce((s, c) => s + c.capexEstimateUsd, 0);
    push({
      id: "fig:energy-households",
      kind: "figure",
      label: "Households in settlement clusters",
      value: `${hh.toLocaleString("en-US")} households in ${result.energyClusters.length} clusters`,
      numericValue: hh,
      methodId: "offgrid-electrification",
      methodCitation: energy?.citation ?? "Density clustering + techno-economic threshold classification.",
      inputs: ["src:field-survey", stageIds[8]].filter(Boolean) as string[],
      tolerance: "Population proxy from structure counts; clustering radius and thresholds are planner parameters.",
    });
    push({
      id: "fig:energy-capex",
      kind: "figure",
      label: "Electrification CAPEX estimate",
      value: `$${Math.round(capex).toLocaleString("en-US")}`,
      numericValue: capex,
      methodId: "offgrid-electrification",
      methodCitation: energy?.citation ?? "Demand/GHI sizing for Mini-Grid vs SHS vs Grid Extension.",
      inputs: ["src:field-survey", stageIds[8]].filter(Boolean) as string[],
      tolerance:
        "Techno-economic estimate from user unit costs and demand assumptions; excludes distribution network, land and logistics.",
    });
  }

  return {
    format: "METARDU_PROVENANCE",
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    project: {
      id: result.metadata.id,
      title: result.metadata.title,
      crs: result.metadata.crs,
      surveyorName: result.metadata.surveyorName,
      registrationNo: result.metadata.registrationNo,
      date: result.metadata.date,
    },
    nodes,
    digest: provenanceDigest(nodes),
  };
}

/* ------------------------------------------------------------------ */
/* Composer / export rendering helpers                                 */
/* ------------------------------------------------------------------ */

/** Compact method labels for print tables (full citations stay in the JSON/XML embeds). */
const METHOD_SHORT: Record<string, string> = {
  "settlement-suitability-mcda": "MCDA weighted overlay",
  "offgrid-electrification": "Clustering + techno-economic sizing",
  "hazard-exposure": "TIN depression + exposure audit",
  "tin-contouring": "Delaunay TIN isolines",
  "cogo-shoelace": "Coordinate (shoelace) method",
  "bowditch-misclosure": "Bowditch traverse audit",
  "field-to-finish": "Field-to-finish coding",
};

/** Truncate at a word boundary with an ellipsis — deterministic, print-safe. */
function shorten(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.lastIndexOf(" ", max);
  return `${s.slice(0, cut > 0 ? cut : max).replace(/[,;.]$/, "")}…`;
}

function methodShort(node: ProvenanceNode): string {
  if (node.methodId && METHOD_SHORT[node.methodId]) return METHOD_SHORT[node.methodId];
  return node.methodCitation ? shorten(node.methodCitation, 48) : "—";
}

/** One row per figure for composer tables and CSV schedules. */
export function provenanceRows(graph: ProvenanceGraph): {
  figure: string;
  value: string;
  method: string;
  methodCitation: string;
  inputs: string;
  tolerance: string;
}[] {
  return graph.nodes
    .filter((n) => n.kind === "figure")
    .map((n) => {
      const inputs = (n.inputs ?? [])
        .map((id) => {
          const src = graph.nodes.find((m) => m.id === id);
          if (!src) return id;
          if (src.kind === "process") return src.label.replace(/^\d+\.\s*/, "");
          return src.label;
        })
        .join("; ");
      return {
        figure: n.label,
        value: n.value ?? "—",
        method: methodShort(n),
        methodCitation: n.methodCitation ?? "—",
        inputs,
        tolerance: n.tolerance ?? "—",
      };
    });
}

/** Print-compact rows for the composer provenance table (no wrapping in SVG). */
export function provenanceCompactRows(graph: ProvenanceGraph): {
  figure: string;
  value: string;
  method: string;
  basis: string;
  tolerance: string;
}[] {
  return provenanceRows(graph).map((r) => ({
    figure: shorten(r.figure, 30),
    value: shorten(r.value, 34),
    method: r.method,
    basis: shorten(r.inputs, 44),
    tolerance: shorten(r.tolerance, 60),
  }));
}

/** Download helper shared by the provenance panel and export hub. */
export function serializeProvenance(graph: ProvenanceGraph): string {
  return JSON.stringify(graph, null, 2);
}
