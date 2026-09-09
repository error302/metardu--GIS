/**
 * GeoPackage (.gpkg) writer — OGC-standard SQLite container, written via
 * sql.js (the same lazy WASM engine the reader uses).
 *
 * Exports the pipeline document as three feature tables:
 *   mr_beacons  (POINT)    — every surveyed station with elevation + code
 *   mr_vectors  (LINESTRING) — field-to-finish vector chains
 *   mr_boundary (POLYGON)  — adjusted parcel boundary
 *
 * Spec conformance: application_id "GPKG", user_version 10300 (v1.3),
 * gpkg_spatial_ref_sys with the mandatory rows (-1, 0, 4326) plus the
 * working CRS, gpkg_contents + gpkg_geometry_columns per feature table,
 * GP binary blobs with XY envelope and little-endian standard WKB.
 */

import { PipelineResult } from "../../types/spatial";
import { crsEpsgFromMetadata, getCRS } from "../crs";
import { openSqlDatabase, SqlJsDatabase as Db } from "../ingest/gpkg";

/* ---------------- WKB writer (standard, little-endian) ---------------- */

type XY = [number, number];

function wkbPoint(xy: XY): Uint8Array {
  const buf = new ArrayBuffer(21);
  const v = new DataView(buf);
  v.setUint8(0, 1); // little endian
  v.setUint32(1, 1, true); // POINT
  v.setFloat64(5, xy[0], true);
  v.setFloat64(13, xy[1], true);
  return new Uint8Array(buf);
}

function wkbLinestring(pts: XY[]): Uint8Array {
  const buf = new ArrayBuffer(9 + pts.length * 16);
  const v = new DataView(buf);
  v.setUint8(0, 1);
  v.setUint32(1, 2, true); // LINESTRING
  v.setUint32(5, pts.length, true);
  pts.forEach((p, i) => {
    v.setFloat64(9 + i * 16, p[0], true);
    v.setFloat64(9 + i * 16 + 8, p[1], true);
  });
  return new Uint8Array(buf);
}

function wkbPolygon(ring: XY[]): Uint8Array {
  const closed = ringClosed(ring);
  const buf = new ArrayBuffer(13 + closed.length * 16);
  const v = new DataView(buf);
  v.setUint8(0, 1);
  v.setUint32(1, 3, true); // POLYGON
  v.setUint32(5, 1, true); // one ring
  v.setUint32(9, closed.length, true);
  closed.forEach((p, i) => {
    v.setFloat64(13 + i * 16, p[0], true);
    v.setFloat64(13 + i * 16 + 8, p[1], true);
  });
  return new Uint8Array(buf);
}

function ringClosed(ring: XY[]): XY[] {
  if (ring.length < 3) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

/* ---------------- GP binary blob (header + WKB) ---------------- */

export function gpBlob(wkb: Uint8Array, srsId: number, env: [number, number, number, number]): Uint8Array {
  const headerLen = 8 + 4 * 8; // magic+ver+flags+srs + XY envelope
  const out = new Uint8Array(headerLen + wkb.length);
  const v = new DataView(out.buffer);
  out[0] = 0x47; // G
  out[1] = 0x50; // P
  out[2] = 0; // version
  out[3] = 0x03; // flags: LE (bit0) + envelope code 1 << 1 (XY)
  v.setInt32(4, srsId, true);
  v.setFloat64(8, env[0], true); // minx
  v.setFloat64(16, env[1], true); // maxx
  v.setFloat64(24, env[2], true); // miny
  v.setFloat64(32, env[3], true); // maxy
  out.set(wkb, headerLen);
  return out;
}

function envOf(pts: XY[]): [number, number, number, number] {
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const [x, y] of pts) {
    if (x < minx) minx = x;
    if (x > maxx) maxx = x;
    if (y < miny) miny = y;
    if (y > maxy) maxy = y;
  }
  return [minx, maxx, miny, maxy];
}

/* ---------------- helpers ---------------- */

function nowIso(): string {
  // GeoPackage spec: ISO-8601 with fractional seconds + Z.
  return new Date().toISOString();
}

/* ---------------- Export ---------------- */

export interface GpkgExportOptions {
  srsId?: number;
  /** Layer table prefix (default "mr_"). */
  prefix?: string;
}

export async function exportGpkg(result: PipelineResult, opts?: GpkgExportOptions): Promise<Uint8Array> {
  const db = await openSqlDatabase();
  try {
    const epsg = opts?.srsId ?? crsEpsgFromMetadata(result.metadata.crs);
    const crsDef = getCRS(epsg);
    const prefix = opts?.prefix ?? "mr_";
    const ts = nowIso();

    db.exec("PRAGMA application_id = 1196444487;"); // 'GPKG'
    db.exec("PRAGMA user_version = 10300;"); // GeoPackage 1.3

    db.exec(`
      CREATE TABLE gpkg_spatial_ref_sys (
        srs_name TEXT NOT NULL, srs_id INTEGER PRIMARY KEY,
        organization TEXT NOT NULL, organization_coordsys_id INTEGER,
        definition TEXT NOT NULL, description TEXT);
      CREATE TABLE gpkg_contents (
        table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL,
        identifier TEXT UNIQUE, description TEXT DEFAULT '',
        last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER);
      CREATE TABLE gpkg_geometry_columns (
        table_name TEXT NOT NULL, column_name TEXT NOT NULL,
        geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL,
        z TINYINT NOT NULL, m TINYINT NOT NULL,
        CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name));
    `);

    const srsDef = crsDef?.proj4 ?? "+proj=longlat +datum=WGS84 +no_defs";
    db.exec(`INSERT INTO gpkg_spatial_ref_sys VALUES ('Undefined Cartesian SRS', -1, 'NONE', -1, 'undefined', 'undefined Cartesian coordinate reference system')`);
    db.exec(`INSERT INTO gpkg_spatial_ref_sys VALUES ('Undefined Geographic SRS', 0, 'NONE', 0, 'undefined', 'undefined geographic coordinate reference system')`);
    db.exec(`INSERT INTO gpkg_spatial_ref_sys VALUES ('WGS 84 geodetic', 4326, 'EPSG', 4326, 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]', 'longitude/latitude coordinates in decimal degrees on the WGS 84 spheroid')`);
    db.exec(
      `INSERT INTO gpkg_spatial_ref_sys VALUES (?, ?, 'EPSG', ?, ?, 'MetaRDU working CRS (proj4 definition)')`,
      [crsDef?.name ?? `EPSG:${epsg}`, epsg, epsg, srsDef],
    );

    const allXy: XY[] = [];

    /* ---- mr_beacons (points) ---- */
    if (result.points.length > 0) {
      const table = `${prefix}beacons`;
      db.exec(`CREATE TABLE "${table}" (fid INTEGER PRIMARY KEY AUTOINCREMENT, geom POINT, beacon_id TEXT, category TEXT, description TEXT, code TEXT, elev_m REAL)`);
      db.exec(`INSERT INTO gpkg_contents (table_name, data_type, identifier, description, last_change, srs_id) VALUES ('${table}', 'features', '${table}', 'Survey stations', '${ts}', ${epsg})`);
      db.exec(`INSERT INTO gpkg_geometry_columns VALUES ('${table}', 'geom', 'POINT', ${epsg}, 0, 0)`);
      let env: [number, number, number, number] | null = null;
      result.points.forEach((p) => {
        const blob = gpBlob(wkbPoint([p.easting, p.northing]), epsg, [p.easting, p.easting, p.northing, p.northing]);
        bindBlob(db, `INSERT INTO "${table}" (geom, beacon_id, category, description, code, elev_m) VALUES (?, ?, ?, ?, ?, ?)`,
          [blob, p.id, p.category, p.description, p.rawCode, p.elevation]);
        allXy.push([p.easting, p.northing]);
        env = env === null ? envOf([[p.easting, p.northing]]) : unionEnv(env, envOf([[p.easting, p.northing]]));
      });
      updateContentsExtent(db, table, env);
    }

    /* ---- mr_vectors (linestrings) ---- */
    if (result.vectors.length > 0) {
      const table = `${prefix}vectors`;
      db.exec(`CREATE TABLE "${table}" (fid INTEGER PRIMARY KEY AUTOINCREMENT, geom LINESTRING, name TEXT, category TEXT, code TEXT, closed INTEGER)`);
      db.exec(`INSERT INTO gpkg_contents (table_name, data_type, identifier, description, last_change, srs_id) VALUES ('${table}', 'features', '${table}', 'Survey vector chains', '${ts}', ${epsg})`);
      db.exec(`INSERT INTO gpkg_geometry_columns VALUES ('${table}', 'geom', 'LINESTRING', ${epsg}, 0, 0)`);
      let env: [number, number, number, number] | null = null;
      for (const v of result.vectors) {
        if (v.points.length < 2) continue;
        const xy = v.points.map((p) => [p.easting, p.northing] as XY);
        const e = envOf(xy);
        const blob = gpBlob(wkbLinestring(xy), epsg, e);
        bindBlob(db, `INSERT INTO "${table}" (geom, name, category, code, closed) VALUES (?, ?, ?, ?, ?)`,
          [blob, v.name, v.category, v.code, v.isClosed ? 1 : 0]);
        xy.forEach((c) => allXy.push(c));
        env = env === null ? e : unionEnv(env, e);
      }
      updateContentsExtent(db, table, env);
    }

    /* ---- mr_boundary (polygon) ---- */
    if (result.boundary && result.boundary.points.length >= 3) {
      const table = `${prefix}boundary`;
      const b = result.boundary;
      db.exec(`CREATE TABLE "${table}" (fid INTEGER PRIMARY KEY AUTOINCREMENT, geom POLYGON, parcel_no TEXT, name TEXT, perimeter_m REAL, area_ha REAL, precision_ratio REAL, precision_rating TEXT)`);
      db.exec(`INSERT INTO gpkg_contents (table_name, data_type, identifier, description, last_change, srs_id) VALUES ('${table}', 'features', '${table}', 'Adjusted parcel boundary', '${ts}', ${epsg})`);
      db.exec(`INSERT INTO gpkg_geometry_columns VALUES ('${table}', 'geom', 'POLYGON', ${epsg}, 0, 0)`);
      const xy = b.points.map((p) => [p.easting, p.northing] as XY);
      const e = envOf(xy);
      const blob = gpBlob(wkbPolygon(xy), epsg, e);
      bindBlob(db, `INSERT INTO "${table}" (geom, parcel_no, name, perimeter_m, area_ha, precision_ratio, precision_rating) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [blob, b.parcelNo, b.name, b.perimeterM, b.areaHa, b.precisionRatio, b.precisionRating]);
      updateContentsExtent(db, table, e);
    }

    if (allXy.length === 0) {
      throw new Error("Nothing to export — the document has no features");
    }

    return db.export() as Uint8Array;
  } finally {
    db.close();
  }
}

/* ---------------- helpers ---------------- */

function unionEnv(
  a: [number, number, number, number],
  b: [number, number, number, number],
): [number, number, number, number] {
  return [Math.min(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3])];
}

function updateContentsExtent(db: Db, table: string, env: [number, number, number, number] | null) {
  if (!env) return;
  db.exec(
    `UPDATE gpkg_contents SET min_x = ?, min_y = ?, max_x = ?, max_y = ? WHERE table_name = ?`,
    [env[0], env[2], env[1], env[3], table],
  );
}

/** exec() with a binary parameter (sql.js binds Uint8Array as a BLOB). */
function bindBlob(db: Db, sql: string, params: unknown[]): void {
  db.exec(sql, params);
}
