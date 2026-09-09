/**
 * Shipped composer templates — the statutory Form 4 deed plan and the
 * Regional Planning Atlas, expressed as templates instead of bespoke SVG
 * strings. Element geometry is in mm on ISO A-series paper.
 */

import { ComposerTemplate } from "./template";

/* ------------------------------------------------------------------ */
/* Form 4 — Cadastral Mutation Plan (A3 landscape)                     */
/* ------------------------------------------------------------------ */

export function form4Preset(): ComposerTemplate {
  return {
    id: "preset-form4",
    title: "Form 4 — Cadastral Mutation Plan",
    version: 1,
    page: { size: "A3", orientation: "landscape" },
    header: {
      lines: [
        "REPUBLIC OF KENYA",
        "SURVEY REGULATIONS (FORM NO. 4) — CADASTRAL MUTATION PLAN",
        "LOCALITY: {LOCALITY} | CRS: {CRS}",
      ],
    },
    footer: "Form No. 4 — Survey Regulations · Sheet 1 of 1 · {crs} · Composed with MetaRDU GIS Studio",
    elements: [
      {
        kind: "map-frame",
        id: "map",
        x: 14, y: 34, w: 272, h: 240,
        fit: "boundary",
        scaleDenominator: null,
        layers: {
          points: true, vectors: true, boundary: true, contours: true,
          suitability: false, hazards: false, energy: false, graticule: true,
        },
        labelLimit: 40,
      },
      {
        kind: "title-block",
        id: "parcel",
        x: 294, y: 34, w: 112,
        title: "PARCEL IDENTIFICATION",
        fields: [
          { label: "PARCEL NO", value: { ref: "boundary.parcelNo" } },
          { label: "AREA", value: { ref: "boundary.areaHa" } },
          { label: "ACRES", value: { ref: "boundary.areaAcres" } },
          { label: "PRECISION", value: { ref: "boundary.precisionRatio" } },
          { label: "RATING", value: { ref: "boundary.precisionRating" } },
          { label: "LOCALITY", value: { ref: "meta.locality" } },
          { label: "CRS", value: { ref: "meta.crs" } },
        ],
      },
      {
        kind: "table",
        id: "schedule",
        x: 294, y: 76, w: 112,
        source: "beacons",
        title: "BEACON COORDINATE SCHEDULE",
        maxRows: 14,
      },
      { kind: "certification", id: "cert", x: 294, y: 152, w: 112, h: 32 },
      { kind: "approval-stamp", id: "stamp", x: 294, y: 190, w: 112, h: 22 },
      { kind: "north-arrow", id: "north", x: 266, y: 52, sizeMm: 11 },
      { kind: "scale-bar", id: "scalebar", x: 20, y: 262, w: 42, mapFrameId: "map" },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Regional Planning Atlas (A3 landscape)                              */
/* ------------------------------------------------------------------ */

export function atlasPreset(): ComposerTemplate {
  return {
    id: "preset-atlas",
    title: "Regional Planning Atlas",
    version: 1,
    page: { size: "A3", orientation: "landscape" },
    header: {
      lines: [
        "REGIONAL PLANNING ATLAS",
        "Settlement suitability & hazard exposure dossier",
        "", // locality/CRS line is supplied by the title strip below
      ],
    },
    footer: "Regional Planning Atlas · A3 landscape · {crs} · Sheet 1 of 1 · {org}",
    elements: [
      {
        kind: "text",
        id: "atlas-locality",
        x: 406, y: 21, w: 0,
        text: "{LOCALITY} · {COUNTRY} · {CRS} · {DATE}",
        sizePt: 8,
        mono: true,
        align: "end",
        color: "#64748B",
      },
      {
        kind: "kpi-strip",
        id: "kpis",
        x: 14, y: 30, w: 392,
        metrics: ["buildableHa", "suitablePct", "exposedAssets", "capexUsd", "households"],
      },
      {
        kind: "map-frame",
        id: "choropleth",
        x: 14, y: 58, w: 228, h: 142,
        fit: "suitability",
        scaleDenominator: null,
        layers: {
          points: false, vectors: false, boundary: true, contours: true,
          suitability: true, hazards: true, energy: true, graticule: false,
        },
      },
      { kind: "legend", id: "legend", x: 14, y: 210, w: 70, title: "MAP KEY" },
      {
        kind: "locator",
        id: "locator",
        x: 96, y: 210, w: 62, h: 48,
        title: "LOCATOR",
      },
      {
        kind: "scale-bar",
        id: "scalebar",
        x: 168, y: 242, w: 42,
        mapFrameId: "choropleth",
      },
      {
        kind: "table",
        id: "hazards",
        x: 252, y: 58, w: 154,
        source: "hazards",
        title: "HAZARD EXPOSURE SCHEDULE",
        maxRows: 7,
      },
      {
        kind: "table",
        id: "energy",
        x: 252, y: 112, w: 154,
        source: "energy",
        title: "ELECTRIFICATION PROGRAMME",
        maxRows: 6,
      },
      { kind: "method-note", id: "method", x: 252, y: 168, w: 154 },
      {
        kind: "signoff",
        id: "signoff",
        x: 252, y: 226, w: 154,
        leftRole: "PROGRAMME MANAGER",
        rightRole: "MUNICIPAL CHIEF PLANNER",
      },
      { kind: "north-arrow", id: "north", x: 228, y: 74, sizeMm: 8 },
    ],
  };
}

/** Dynamic text tokens the renderer substitutes for atlas header strip. */
export function substituteTextTokens(
  text: string,
  meta: { locality: string; country: string; crs: string; date: string },
): string {
  return text
    .replace("{LOCALITY}", meta.locality)
    .replace("{COUNTRY}", meta.country)
    .replace("{CRS}", meta.crs)
    .replace("{DATE}", meta.date);
}
