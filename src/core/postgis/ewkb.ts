/**
 * PostGIS EWKB parser — decodes HexEWKB / binary EWKB produced by
 * ST_AsEWKB / ST_AsHexEWKB into the same geometry shapes the GeoPackage
 * reader emits, so a PostGIS layer routes through the identical ingest path.
 *
 * EWKB (PostGIS) flags in the type word: 0x20000000 = SRID follows,
 * 0x80000000 = Z, 0x40000000 = M. Collections nest complete WKB values
 * (each with its own byte-order byte).
 */

import { WkbGeom, WkbCoord } from "../ingest/gpkg-types";

const EWKB_SRID = 0x20000000;
const EWKB_Z = 0x80000000;
const EWKB_M = 0x40000000;

export interface EwkbResult {
  /** SRID from the outer geometry (null when absent). */
  srid: number | null;
  /** One geometry per top-level value; collections flatten into members. */
  geoms: WkbGeom[];
}

function readCoords(view: DataView, off: number, le: boolean, count: number, dims: number): { coords: WkbCoord[]; off: number } {
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

function readGeom(view: DataView, off: number): { geoms: WkbGeom[]; off: number; srid: number | null } {
  const le = view.getUint8(off) === 1;
  off += 1;
  let typeRaw = view.getUint32(off, le);
  off += 4;
  let srid: number | null = null;
  if ((typeRaw & EWKB_SRID) !== 0) {
    srid = view.getInt32(off, le);
    off += 4;
  }
  const hasZ = (typeRaw & EWKB_Z) !== 0;
  const hasM = (typeRaw & EWKB_M) !== 0;
  const dims = 2 + (hasZ ? 1 : 0) + (hasM ? 1 : 0);
  const type = typeRaw & 0xff;

  const geoms: WkbGeom[] = [];
  switch (type) {
    case 1: {
      const { coords, off: o } = readCoords(view, off, le, 1, dims);
      geoms.push({ kind: "point", coord: coords[0] });
      off = o;
      break;
    }
    case 2: {
      const count = view.getUint32(off, le);
      off += 4;
      const { coords, off: o } = readCoords(view, off, le, count, dims);
      geoms.push({ kind: "line", points: coords });
      off = o;
      break;
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
      geoms.push({ kind: "polygon", rings });
      break;
    }
    case 4:
    case 5:
    case 6:
    case 7: {
      const count = view.getUint32(off, le);
      off += 4;
      for (let i = 0; i < count; i++) {
        const sub = readGeom(view, off);
        geoms.push(...sub.geoms);
        off = sub.off;
      }
      break;
    }
    default:
      throw new Error(`unsupported EWKB geometry type ${type}`);
  }
  return { geoms, off, srid };
}

export function parseEwkb(buf: ArrayBuffer): EwkbResult {
  if (buf.byteLength < 5) throw new Error("EWKB buffer too small");
  const view = new DataView(buf);
  let geoms: WkbGeom[];
  let srid: number | null;
  try {
    const r = readGeom(view, 0);
    geoms = r.geoms;
    srid = r.srid;
  } catch (err) {
    if (err instanceof RangeError) throw new Error("truncated EWKB — geometry body exceeds buffer");
    throw err;
  }
  return { srid, geoms };
}

export function parseEwkbHex(hex: string): EwkbResult {
  const clean = hex.trim().replace(/^0x/i, "").replace(/\s+/g, "");
  if (clean.length < 10 || clean.length % 2 !== 0) throw new Error("malformed HexEWKB");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(bytes[i])) throw new Error("malformed HexEWKB (non-hex character)");
  }
  return parseEwkb(bytes.buffer);
}
