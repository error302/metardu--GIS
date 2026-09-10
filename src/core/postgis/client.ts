/**
 * PostGIS read client — talks to a tiny read-only HTTP bridge
 * (bridge/postgis-bridge.mjs) that proxies parameterised SELECT queries to a
 * PostgreSQL/PostGIS server. Browser builds cannot speak the PostgreSQL wire
 * protocol directly; the bridge stays on the deploy side and enforces
 * read-only semantics. Geometry arrives as HexEWKB and is decoded here.
 */

import { SurveyPoint, FeatureCategory } from "../../types/spatial";
import { parseEwkbHex, EwkbResult } from "./ewkb";
import { geomToFeatureKind } from "../ingest/gpkg";
import { inferCategory, inferRawCode } from "../ingest/shapefile";

export interface PgTableInfo {
  table: string;
  geomCol: string;
  srid: number;
  type: string;
}

export interface PgLayer {
  name: string;
  srid: number;
  /** Survey-point projection of the fetched features. */
  points: SurveyPoint[];
  stats: { pointFeatures: number; lineFeatures: number; polygonFeatures: number };
  warnings: string[];
}

export interface BridgeConfig {
  /** e.g. http://localhost:8787 (the bridge, not Postgres itself). */
  bridgeUrl: string;
  timeoutMs?: number;
}

async function bridgeFetch(cfg: BridgeConfig, path: string, body?: unknown): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs ?? 15000);
  try {
    const res = await fetch(`${cfg.bridgeUrl.replace(/\/$/, "")}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`bridge ${res.status}: ${text || res.statusText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** List spatial tables via geometry_columns (bridge GET /tables). */
export async function listPgTables(cfg: BridgeConfig): Promise<PgTableInfo[]> {
  const rows = (await bridgeFetch(cfg, "/tables")) as Record<string, unknown>[];
  return rows.map((r) => ({
    table: String(r.f_table_name ?? r.table ?? ""),
    geomCol: String(r.f_geometry_column ?? r.geomCol ?? "geom"),
    srid: Number(r.srid ?? 0),
    type: String(r.type ?? "GEOMETRY"),
  }));
}

const MAX_LAYER_FEATURES = 50000;

/** Fetch a spatial table (SELECT with ST_AsHexEWKB) and decode to SurveyPoints. */
export async function fetchPgLayer(
  cfg: BridgeConfig,
  t: PgTableInfo,
  limit = 20000,
): Promise<PgLayer> {
  const warnings: string[] = [];
  const capped = Math.min(Math.max(1, limit), MAX_LAYER_FEATURES);
  const sql =
    `SELECT *, ST_AsHexEWKB("${t.geomCol.replace(/"/g, '""')}") AS __geom FROM "${t.table.replace(/"/g, '""')}" LIMIT ${capped}`;
  const reply = (await bridgeFetch(cfg, "/query", { sql })) as { columns: string[]; rows: Record<string, unknown>[] };
  const rows = reply.rows ?? [];
  if (rows.length === capped) {
    warnings.push(`result capped at ${capped} features — narrow the table or raise the limit`);
  }

  const points: SurveyPoint[] = [];
  const stats = { pointFeatures: 0, lineFeatures: 0, polygonFeatures: 0 };
  let vertexSeq = 0;

  for (const row of rows) {
    const hex = row["__geom"];
    if (typeof hex !== "string" || hex.length < 10) continue;
    let parsed: EwkbResult;
    try {
      parsed = parseEwkbHex(hex);
    } catch {
      warnings.push(`row skipped: malformed EWKB`);
      continue;
    }
    const props: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k === "__geom") continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") props[k] = v;
    }
    const category: FeatureCategory = inferCategory(props);
    const rawCode = inferRawCode(props);
    const name = String(props["name"] ?? props["NAME"] ?? t.table);

    for (const geom of parsed.geoms) {
      const shape = geomToFeatureKind(geom);
      const pushVertex = (x: number, y: number, z: number, desc: string) => {
        vertexSeq++;
        points.push({
          id: `${t.table}-${vertexSeq}`,
          easting: Number(x.toFixed(4)),
          northing: Number(y.toFixed(4)),
          elevation: Number(z.toFixed(3)),
          rawCode,
          category,
          description: desc,
          properties: props,
        });
      };
      switch (shape.kind) {
        case "point":
          stats.pointFeatures++;
          pushVertex(shape.x, shape.y, shape.z ?? 0, name);
          break;
        case "multipoint":
          shape.points.forEach(([x, y], vi) => pushVertex(x, y, 0, `${name} (v${vi + 1})`));
          break;
        case "polyline":
          stats.lineFeatures++;
          shape.parts.forEach((part, pi) =>
            part.forEach(([x, y], vi) => pushVertex(x, y, 0, `${name} (p${pi + 1}v${vi + 1})`)),
          );
          break;
        case "polygon":
          stats.polygonFeatures++;
          shape.rings.forEach((ring, ri) =>
            ring.forEach(([x, y], vi) => pushVertex(x, y, 0, `${name} (r${ri + 1}v${vi + 1})`)),
          );
          break;
      }
    }
  }

  if (points.length === 0) {
    warnings.push("no decodable geometry rows returned");
  }
  return { name: t.table, srid: t.srid, points, stats, warnings };
}
