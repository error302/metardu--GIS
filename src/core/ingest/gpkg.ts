/**
 * GeoPackage (.gpkg) reader — OGC standard SQLite container.
 *
 * Uses sql.js (SQLite compiled to WASM, lazy-loaded) to open the database,
 * introspects gpkg_contents / gpkg_geometry_columns, decodes GP geometry
 * blobs (magic "GP", flags byte, srs_id, envelope, standard WKB) and maps
 * them onto the same geometry shapes the Shapefile parser produces so the
 * import pipeline treats both identically.
 *
 * WASM strategy: browser builds resolve the binary through Vite's `?url`
 * import (hashed asset, cached); node/test builds pass `wasmBinary` directly.
 */

import type { FeatureKind, GpkgFeature, WkbCoord, WkbGeom } from "./gpkg-types";

export type { FeatureKind, GpkgFeature, WkbCoord, WkbGeom } from "./gpkg-types";

type SqlJsDatabase = {
  exec: (sql: string, params?: unknown[]) => { columns: string[]; values: unknown[][] }[];
  export: () => Uint8Array;
  close: () => void;
};

type SqlJsStatic = {
  Database: new (data?: Uint8Array | Buffer) => SqlJsDatabase;
};

export interface SqlInitOptions {
  /** Browser: function returning the URL of sql-wasm.wasm */
  locateFile?: (file: string) => string;
  /** Node/test: raw wasm binary */
  wasmBinary?: ArrayBuffer | Uint8Array | Buffer;
}

let initSqlJsFn: ((opts?: SqlInitOptions) => Promise<SqlJsStatic>) | null = null;
let enginePromise: Promise<SqlJsStatic> | null = null;

/** Configure the loader (call once before first parse; defaults to Vite import). */
export function configureSqlLoader(loader: (opts?: SqlInitOptions) => Promise<SqlJsStatic>) {
  initSqlJsFn = loader;
  enginePromise = null;
}

export type { SqlJsDatabase, SqlJsStatic };

async function getEngine(opts?: SqlInitOptions): Promise<SqlJsStatic> {
  if (!enginePromise) {
    if (!initSqlJsFn) {
      // Default browser path: dynamic import of the npm module + Vite ?url asset
      return Promise.reject(
        new Error("sql.js loader not configured — call configureSqlLoader() first"),
      );
    }
    enginePromise = initSqlJsFn(opts);
  }
  return enginePromise;
}

/**
 * Open a fresh (or in-memory) sql.js database through the shared lazy engine.
 * Used by the GeoPackage writer (export path) as well as the reader.
 */
export async function openSqlDatabase(
  data?: Uint8Array,
  opts?: SqlInitOptions,
): Promise<SqlJsDatabase> {
  const SQL = await getEngine(opts);
  return new SQL.Database(data);
}

/* ---------------- GP binary blob decoding ---------------- */

interface GpHeader {
  littleEndian: boolean;
  envelopeCode: number;
  srsId: number;
  offset: number; // where WKB starts
}

export function readGpHeader(view: DataView): GpHeader {
  if (view.byteLength < 8) throw new Error("GP blob too small");
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1));
  if (magic !== "GP") throw new Error(`bad GP magic: ${magic}`);
  const version = view.getUint8(2);
  if (version !== 0) throw new Error(`unsupported GP version ${version}`);
  const flags = view.getUint8(3);
  const littleEndian = (flags & 0x01) === 1;
  const envelopeCode = (flags >> 1) & 0x07;
  const emptyGeometry = (flags & 0x10) !== 0; // bit 4: no WKB follows
  // GPKG spec: srs_id is ALWAYS present right after the flags byte.
  let off = 4;
  const srsId = view.getInt32(off, littleEndian);
  off += 4;
  // envelope sizes: 0:none, 1:xy(4), 2:xyz(6), 3:xym(6), 4:xyzm(8) doubles
  const envDoubles = [0, 4, 6, 6, 8][envelopeCode] ?? 0;
  off += envDoubles * 8;
  if (emptyGeometry) off = view.byteLength; // nothing to parse
  return { littleEndian, envelopeCode, srsId, offset: off };
}

/* ---------------- WKB parsing ---------------- */

const WKB_Z = 0x80000000;
const WKB_M = 0x40000000;

function readCoords(
  view: DataView,
  off: number,
  le: boolean,
  count: number,
  dims: number,
): { coords: WkbCoord[]; off: number } {
  const coords: WkbCoord[] = [];
  for (let i = 0; i < count; i++) {
    const x = view.getFloat64(off, le);
    const y = view.getFloat64(off + 8, le);
    const z = dims >= 3 ? view.getFloat64(off + 16, le) : undefined;
    coords.push(z !== undefined ? { x, y, z } : { x, y });
    off += dims * 8;
  }
  return { coords, off };
}

/* Recursive WKB reader with explicit offsets. */
function readWkbBodyAt(view: DataView, off: number, le: boolean): { geom: WkbGeom; off: number } {
  const typeRaw = view.getUint32(off, le);
  off += 4;
  const hasZ = (typeRaw & WKB_Z) !== 0;
  const hasM = (typeRaw & WKB_M) !== 0;
  const type = typeRaw & 0xff;
  const dims = 2 + (hasZ ? 1 : 0) + (hasM ? 1 : 0);

  switch (type) {
    case 1: {
      const { coords, off: o } = readCoords(view, off, le, 1, dims);
      return { geom: { kind: "point", coord: coords[0] }, off: o };
    }
    case 2: {
      const count = view.getUint32(off, le);
      off += 4;
      const { coords, off: o } = readCoords(view, off, le, count, dims);
      return { geom: { kind: "line", points: coords }, off: o };
    }
    case 3: {
      const ringCount = view.getUint32(off, le);
      off += 4;
      const rings: WkbCoord[][] = [];
      for (let r = 0; r < ringCount; r++) {
        const count = view.getUint32(off, le);
        off += 4;
        const { coords, off: o } = readCoords(view, off, le, count, dims);
        rings.push(coords);
        off = o;
      }
      return { geom: { kind: "polygon", rings }, off };
    }
    case 4:
    case 5:
    case 6: {
      const count = view.getUint32(off, le);
      off += 4;
      const points: WkbCoord[] = [];
      const parts: WkbCoord[][] = [];
      const polygons: WkbCoord[][][] = [];
      for (let i = 0; i < count; i++) {
        const bo = view.getUint8(off);
        off += 1; // skip byte-order byte; off now at the sub-type word
        const sub = readWkbBodyAt(view, off, bo === 1);
        off = sub.off;
        if (sub.geom.kind === "point") points.push(sub.geom.coord);
        else if (sub.geom.kind === "line") parts.push(sub.geom.points);
        else if (sub.geom.kind === "polygon") polygons.push(sub.geom.rings);
      }
      if (type === 4) return { geom: { kind: "multipoint", points }, off };
      if (type === 5) return { geom: { kind: "multiline", parts }, off };
      return { geom: { kind: "multipolygon", polygons }, off };
    }
    default:
      throw new Error(`unsupported WKB type ${type}`);
  }
}

/* ---------------- GeoPackage table reading ---------------- */

/**
 * Parse a .gpkg buffer into flat features (geometry + attributes).
 * Non-feature tables (rasters, metadata) are skipped.
 */
export async function parseGpkg(
  buf: ArrayBuffer,
  opts?: SqlInitOptions,
): Promise<{ layerName: string; srsId: number; features: GpkgFeature[] }> {
  const SQL = await getEngine(opts);
  const db = new SQL.Database(new Uint8Array(buf));
  try {
    // Introspect feature tables
    const contents = db.exec(
      `SELECT c.table_name, c.data_type, g.column_name, g.srs_id
       FROM gpkg_contents c LEFT JOIN gpkg_geometry_columns g
       ON c.table_name = g.table_name WHERE c.data_type = 'features'`,
    );
    if (contents.length === 0) return { layerName: "", srsId: 0, features: [] };
    const row0 = contents[0];
    const tables: { name: string; geomCol: string | null; srsId: number }[] = [];
    const idx = (cols: string[], name: string) => cols.indexOf(name);
    for (const row of row0.values) {
      tables.push({
        name: String(row[idx(row0.columns, "table_name")]),
        geomCol: row[idx(row0.columns, "column_name")] != null ? String(row[idx(row0.columns, "column_name")]) : null,
        srsId: Number(row[idx(row0.columns, "srs_id")] ?? 0),
      });
    }

    const features: GpkgFeature[] = [];
    let firstTable = "";
    let firstSrs = 0;

    for (const t of tables) {
      if (!t.geomCol) continue;
      if (!firstTable) {
        firstTable = t.name;
        firstSrs = t.srsId;
      }
      // Attribute columns other than the geometry
      const pragma = db.exec(`PRAGMA table_info("${t.name.replace(/"/g, '""')}")`);
      const attrCols = pragma[0]
        ? pragma[0].values
            .map((r) => String(r[1]))
            .filter((c) => c !== t.geomCol && c !== "geom_id")
        : [];

      const sel = `SELECT rowid AS fid, "${t.geomCol.replace(/"/g, '""')}" AS g, ${attrCols
        .map((c) => `"${c.replace(/"/g, '""')}"`)
        .join(", ")} FROM "${t.name.replace(/"/g, '""')}"`;
      let res: { columns: string[]; values: unknown[][] }[];
      try {
        res = db.exec(sel);
      } catch {
        continue; // unreadable table — skip, others may parse
      }
      if (res.length === 0) continue;
      const cols = res[0].columns;
      const gIdx = cols.indexOf("g");
      const fidIdx = cols.indexOf("fid");
      for (const row of res[0].values) {
        const blob = row[gIdx] as Uint8Array | null;
        if (!blob || blob.byteLength < 8) continue;
        const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
        let header: GpHeader;
        try {
          header = readGpHeader(view);
        } catch {
          continue;
        }
        try {
          // header.offset points at the WKB byte-order byte; the reader
          // expects to start at the type word, so skip the byte-order byte.
          const { geom } = readWkbBodyAt(view, header.offset + 1, header.littleEndian);
          const properties: Record<string, string | number | boolean | null> = {};
          for (let c = 0; c < cols.length; c++) {
            if (c === gIdx || c === fidIdx) continue;
            const col = cols[c];
            if (col === "g") continue;
            const v = row[c];
            if (v === null || v === undefined) continue;
            properties[col] = typeof v === "number" || typeof v === "boolean" ? v : String(v);
          }
          features.push({
            fid: Number(row[fidIdx] ?? features.length),
            table: t.name,
            geom,
            properties,
          });
        } catch {
          // malformed geometry — skip feature
        }
      }
    }

    return { layerName: firstTable, srsId: firstSrs, features };
  } finally {
    db.close();
  }
}

/* ---------------- Geometry mapping (shared shape with SHP parser) ---------------- */

/** Map a decoded WKB geometry onto the parser-neutral feature kinds. */
export function geomToFeatureKind(geom: WkbGeom): FeatureKind {
  switch (geom.kind) {
    case "point":
      return { kind: "point", x: geom.coord.x, y: geom.coord.y, z: geom.coord.z };
    case "multipoint":
      return {
        kind: "multipoint",
        points: geom.points.map((p) => [p.x, p.y] as [number, number]),
      };
    case "line":
      return { kind: "polyline", parts: [geom.points.map((p) => [p.x, p.y] as [number, number])] };
    case "multiline":
      return {
        kind: "polyline",
        parts: geom.parts.map((p) => p.map((c) => [c.x, c.y] as [number, number])),
      };
    case "polygon":
      return {
        kind: "polygon",
        rings: geom.rings.map((r) => r.map((c) => [c.x, c.y] as [number, number])),
      };
    case "multipolygon":
      return {
        kind: "polygon",
        rings: geom.polygons.flatMap((poly) =>
          poly.map((ring) => ring.map((c) => [c.x, c.y] as [number, number])),
        ),
      };
  }
}
