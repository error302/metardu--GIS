/**
 * Import orchestrator — groups a dropped/multi-selected file set by basename,
 * parses Shapefile (.shp/.dbf) and GeoJSON sources, and projects everything
 * onto the pipeline's SurveyPoint document: point geometries become stations,
 * line/polygon vertices become coded vertices that field-to-finish re-links
 * into vectors.
 */

import { SurveyPoint, FeatureCategory } from "../../types/spatial";
import {
  parseShp,
  parseDbf,
  inferCategory,
  inferRawCode,
  recordToProperties,
  DbfRecord,
} from "./shapefile";
import { parseGeoJson, geometryToParts, GeoJsonFeature } from "./geojson";
import { parseGpkg, configureSqlLoader, geomToFeatureKind, GpkgFeature } from "./gpkg";

/* sql.js WASM loading is platform-specific:
   - Browser: App calls ensureGpkgBrowserLoader() (see gpkg-browser.ts) before
     routing files here — Vite resolves the wasm as a hashed asset chunk.
   - Node/tests: call configureSqlLoader() with { wasmBinary } from node_modules.
   If neither happened, the import below fails with a clear message. */
async function ensureGpkgLoader(): Promise<void> {
  // No-op placeholder — the loader must have been configured by the host.
  // parseGpkg throws "sql.js loader not configured" otherwise.
}

export interface ImportResult {
  layerName: string;
  points: SurveyPoint[];
  stats: {
    pointFeatures: number;
    lineFeatures: number;
    polygonFeatures: number;
    vertices: number;
    attributes: number;
  };
  warnings: string[];
}

export type SourceRecord = DbfRecord | Record<string, unknown>;

function makePoint(
  id: string,
  easting: number,
  northing: number,
  elevation: number,
  category: FeatureCategory,
  rawCode: string,
  description: string,
  properties?: Record<string, string | number | boolean>
): SurveyPoint {
  return {
    id,
    easting: Number(easting.toFixed(4)),
    northing: Number(northing.toFixed(4)),
    elevation: Number(elevation.toFixed(3)),
    rawCode,
    category,
    description,
    ...(properties ? { properties } : {}),
  };
}

function featureFromShp(
  layerBase: string,
  fid: number,
  geometry: ReturnType<typeof parseShp>[number]["geometry"],
  record: DbfRecord
): SurveyPoint[] {
  const category = inferCategory(record);
  const rawCode = inferRawCode(record);
  const description = String(record["name"] ?? record["NAME"] ?? record["descrip"] ?? `${layerBase} #${fid + 1}`);
  const props = recordToProperties(record);
  const out: SurveyPoint[] = [];

  switch (geometry.kind) {
    case "point":
      out.push(
        makePoint(`${layerBase}-${fid + 1}`, geometry.x, geometry.y, geometry.z ?? 0, category, rawCode, description, props)
      );
      break;
    case "multipoint":
      geometry.points.forEach(([x, y], i) =>
        out.push(makePoint(`${layerBase}-${fid + 1}-${i + 1}`, x, y, 0, category, rawCode, description, props))
      );
      break;
    case "polyline":
      geometry.parts.forEach((part, pi) =>
        part.forEach(([x, y], vi) =>
          out.push(
            makePoint(
              `${layerBase}-${fid + 1}-${pi + 1}-${vi + 1}`,
              x,
              y,
              0,
              category,
              rawCode,
              `${description} (v${vi + 1})`
            )
          )
        )
      );
      break;
    case "polygon":
      geometry.rings.forEach((ring, ri) =>
        ring.forEach(([x, y], vi) =>
          out.push(
            makePoint(
              `${layerBase}-${fid + 1}-r${ri + 1}-${vi + 1}`,
              x,
              y,
              0,
              category,
              rawCode,
              `${description} (r${ri + 1}v${vi + 1})`
            )
          )
        )
      );
      break;
  }
  return out;
}

function featureFromGeoJson(
  layerBase: string,
  fid: number,
  feature: GeoJsonFeature
): SurveyPoint[] {
  if (!feature.geometry) return [];
  const parts = geometryToParts(feature.geometry);
  if (!parts) return [];
  const record = feature.properties ?? {};
  const category = inferCategory(record);
  const rawCode = inferRawCode(record);
  const description = String(record["name"] ?? record["NAME"] ?? `${layerBase} #${fid + 1}`);
  const props: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(record)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") props[k] = v;
  }

  const out: SurveyPoint[] = [];
  let vertexSeq = 1;
  for (const part of parts.parts) {
    for (const [x, y] of part) {
      const isPoint = parts.kind === "point";
      out.push(
        makePoint(
          isPoint ? `${layerBase}-${fid + 1}` : `${layerBase}-${fid + 1}-${vertexSeq}`,
          x,
          y,
          0,
          category,
          rawCode,
          isPoint ? description : `${description} (v${vertexSeq})`,
          Object.keys(props).length ? props : undefined
        )
      );
      vertexSeq++;
    }
  }
  return out;
}

/** Entry point: parse any mix of .shp/.dbf/.geojson/.json files. */
export async function ingestFiles(fileList: File[]): Promise<ImportResult> {
  const warnings: string[] = [];
  const files = Array.from(fileList);
  if (files.length === 0) throw new Error("No files selected");

  const groups = new Map<string, Record<string, File>>();
  const singletons: File[] = [];

  for (const f of files) {
    const lower = f.name.toLowerCase();
    const dot = lower.lastIndexOf(".");
    const base = f.name.slice(0, dot);
    const ext = lower.slice(dot + 1);
    if (ext === "geojson" || ext === "json" || ext === "gpkg") {
      singletons.push(f);
      continue;
    }
    if (!["shp", "dbf", "shx", "prj"].includes(ext)) {
      warnings.push(`Skipped unsupported file: ${f.name}`);
      continue;
    }
    const group = groups.get(base) ?? {};
    group[ext] = f;
    groups.set(base, group);
  }

  const points: SurveyPoint[] = [];
  const stats: ImportResult["stats"] = {
    pointFeatures: 0,
    lineFeatures: 0,
    polygonFeatures: 0,
    vertices: 0,
    attributes: 0,
  };
  const layerNames: string[] = [];

  // Shapefile groups
  for (const [base, group] of groups) {
    if (!group.shp) {
      if (group.dbf) warnings.push(`${base}: .dbf present without .shp — skipped`);
      continue;
    }
    layerNames.push(base);
    const shpBuf = await group.shp.arrayBuffer();
    const records = parseShp(shpBuf);

    let records2: DbfRecord[] = [];
    if (group.dbf) {
      try {
        const dbf = parseDbf(await group.dbf.arrayBuffer());
        records2 = dbf.records;
        if (dbf.fields.length > 0) stats.attributes = Math.max(stats.attributes, dbf.fields.length);
      } catch (err) {
        warnings.push(`${base}: attributes skipped (${(err as Error).message})`);
      }
    } else {
      warnings.push(`${base}: no .dbf supplied — geometry imported without attributes`);
    }
    if (group.prj) {
      warnings.push(`${base}: verify the CRS — .prj detected but EPSG mapping is not applied automatically`);
    }

    records.forEach((rec, fid) => {
      const record = records2[fid] ?? {};
      const pts = featureFromShp(base.replace(/\s+/g, "_"), fid, rec.geometry, record);
      if (pts.length === 0) return;
      switch (rec.geometry.kind) {
        case "point":
          stats.pointFeatures++;
          break;
        case "multipoint":
          stats.pointFeatures += pts.length;
          break;
        case "polyline":
          stats.lineFeatures++;
          break;
        case "polygon":
          stats.polygonFeatures++;
          break;
      }
      points.push(...pts);
    });
  }

  // GeoPackage singletons
  for (const f of singletons.filter((x) => x.name.toLowerCase().endsWith(".gpkg"))) {
    await ensureGpkgLoader();
    const buf = await f.arrayBuffer();
    let parsed: Awaited<ReturnType<typeof parseGpkg>>;
    try {
      parsed = await parseGpkg(buf);
    } catch (err) {
      warnings.push(`${f.name}: ${(err as Error).message}`);
      continue;
    }
    const layerKey = (parsed.layerName || f.name.replace(/\.gpkg$/i, "")).replace(/\s+/g, "_");
    layerNames.push(layerKey);
    if (parsed.srsId && parsed.srsId !== 4326) {
      warnings.push(
        `${f.name}: layer is EPSG:${parsed.srsId} — reproject it to the working CRS if coordinates look shifted`,
      );
    }
    parsed.features.forEach((feat: GpkgFeature) => {
      const kindShape = geomToFeatureKind(feat.geom);
      const category = inferCategory(feat.properties as Record<string, unknown>);
      const rawCode = inferRawCode(feat.properties as Record<string, unknown>);
      const description = String(
        feat.properties["name"] ?? feat.properties["NAME"] ?? `${layerKey} #${feat.fid + 1}`,
      );
      const props: Record<string, string | number | boolean> = {};
      for (const [k, v] of Object.entries(feat.properties)) {
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") props[k] = v;
      }
      const pushPoint = (id: string, x: number, y: number, z: number, desc: string) => {
        points.push(
          makePoint(id, x, y, z, category, rawCode, desc, Object.keys(props).length ? props : undefined),
        );
        stats.vertices++;
      };

      switch (kindShape.kind) {
        case "point":
          stats.pointFeatures++;
          pushPoint(`${layerKey}-${feat.fid + 1}`, kindShape.x, kindShape.y, kindShape.z ?? 0, description);
          break;
        case "multipoint":
          stats.pointFeatures += kindShape.points.length;
          kindShape.points.forEach(([x, y], vi) =>
            pushPoint(`${layerKey}-${feat.fid + 1}-${vi + 1}`, x, y, 0, `${description} (v${vi + 1})`),
          );
          break;
        case "polyline":
          stats.lineFeatures++;
          kindShape.parts.forEach((part, pi) =>
            part.forEach(([x, y], vi) =>
              pushPoint(
                `${layerKey}-${feat.fid + 1}-${pi + 1}-${vi + 1}`,
                x,
                y,
                0,
                `${description} (p${pi + 1}v${vi + 1})`,
              ),
            ),
          );
          break;
        case "polygon":
          stats.polygonFeatures++;
          kindShape.rings.forEach((ring, ri) =>
            ring.forEach(([x, y], vi) =>
              pushPoint(
                `${layerKey}-${feat.fid + 1}-r${ri + 1}-${vi + 1}`,
                x,
                y,
                0,
                `${description} (r${ri + 1}v${vi + 1})`,
              ),
            ),
          );
          break;
      }
    });
  }

  // GeoJSON singletons (skip GeoPackage — handled above)
  for (const f of singletons.filter((x) => !x.name.toLowerCase().endsWith(".gpkg"))) {
    layerNames.push(f.name.replace(/\.(geo)?json$/i, ""));
    const text = await f.text();
    let doc: ReturnType<typeof parseGeoJson>;
    try {
      doc = parseGeoJson(text);
    } catch (err) {
      warnings.push(`${f.name}: ${(err as Error).message}`);
      continue;
    }
    const layerKey = (layerNames[layerNames.length - 1] ?? f.name).replace(/\s+/g, "_");
    doc.features.forEach((feature, fid) => {
      const pts = featureFromGeoJson(layerKey, fid, feature);
      if (pts.length === 0) return;
      const kind = feature.geometry ? geometryToParts(feature.geometry)?.kind : null;
      if (kind === "point") stats.pointFeatures += pts.length;
      else if (kind === "line") stats.lineFeatures++;
      else if (kind === "polygon") stats.polygonFeatures++;
      stats.vertices += pts.length;
      points.push(...pts);
    });
  }

  if (points.length === 0) {
    throw new Error(
      warnings.length > 0 ? warnings.join("; ") : "No importable geometry found in the selected files"
    );
  }

  stats.vertices = points.length;
  return {
    layerName: layerNames.length > 0 ? layerNames.join(", ") : "Imported data",
    points,
    stats,
    warnings,
  };
}
