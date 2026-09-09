/**
 * Minimal, dependency-free ESRI Shapefile reader (.shp geometry + .dbf
 * attributes). Covers shape types 1/3/5/8 (Point, PolyLine, Polygon,
 * MultiPoint) and their Z/M variants (11, 13, 15, 18, 21, 23, 25, 28).
 *
 * Field typing follows the dBASE III+ spec: C → string, N/F → number,
 * D → ISO date string, L → boolean, M → null (memo sidecars unsupported).
 */

import { SurveyPoint } from "../../types/spatial";

// ── Shape types ──────────────────────────────────────────────────────────────

const enum ShpType {
  Null = 0,
  Point = 1,
  PolyLine = 3,
  Polygon = 5,
  MultiPoint = 8,
  PointZ = 11,
  PolyLineZ = 13,
  PolygonZ = 15,
  MultiPointZ = 18,
  PointM = 21,
  PolyLineM = 23,
  PolygonM = 25,
  MultiPointM = 28,
}

export type ShpGeometry =
  | { kind: "point"; x: number; y: number; z: number | null }
  | { kind: "multipoint"; points: [number, number][] }
  | { kind: "polyline"; parts: [number, number][][] }
  | { kind: "polygon"; rings: [number, number][][] };

export interface ShpRecord {
  geometry: ShpGeometry;
  shapeType: number;
}

// ── .shp parsing ─────────────────────────────────────────────────────────────

export function parseShp(buffer: ArrayBuffer): ShpRecord[] {
  const view = new DataView(buffer);
  if (buffer.byteLength < 100) throw new Error(".shp file too small (missing 100-byte header)");
  const fileCode = view.getInt32(0, false);
  if (fileCode !== 9994) throw new Error("Not a valid .shp file (bad magic number)");

  const records: ShpRecord[] = [];
  let offset = 100;

  while (offset + 8 <= buffer.byteLength) {
    const contentWords = view.getInt32(offset + 4, false);
    const contentLength = contentWords * 2;
    const contentStart = offset + 8;
    if (contentStart + contentLength > buffer.byteLength) break;

    if (contentLength > 0) {
      const type = view.getInt32(contentStart, true);
      const geometry = parseGeometry(view, contentStart, contentLength, type);
      if (geometry) records.push({ geometry, shapeType: type });
    }
    offset = contentStart + contentLength;
  }

  return records;
}

function parseGeometry(
  view: DataView,
  base: number,
  length: number,
  type: number
): ShpGeometry | null {
  const end = base + length;
  switch (type) {
    case ShpType.Null:
      return null;
    case ShpType.Point:
    case ShpType.PointM:
    case ShpType.PointZ: {
      const x = view.getFloat64(base + 4, true);
      const y = view.getFloat64(base + 12, true);
      // PointZ stores [X, Y, Z, (M)]: Z lives at byte offset 20.
      let z: number | null = null;
      if (type === ShpType.PointZ && base + 28 <= end) z = view.getFloat64(base + 20, true);
      return { kind: "point", x, y, z };
    }
    case ShpType.PolyLine:
    case ShpType.Polygon:
    case ShpType.PolyLineZ:
    case ShpType.PolygonZ:
    case ShpType.PolyLineM:
    case ShpType.PolygonM: {
      // bbox(32) + numParts(4) + numPoints(4) → parts[] → points[]
      const numParts = view.getInt32(base + 36, true);
      const numPoints = view.getInt32(base + 40, true);
      const partsBase = base + 44;
      const pointsBase = partsBase + numParts * 4;

      const partStarts: number[] = [];
      for (let i = 0; i < numParts; i++) partStarts.push(view.getInt32(partsBase + i * 4, true));
      partStarts.push(numPoints);

      const coords: [number, number][] = [];
      for (let i = 0; i < numPoints; i++) {
        const p = pointsBase + i * 16;
        if (p + 16 > end) break;
        coords.push([view.getFloat64(p, true), view.getFloat64(p + 8, true)]);
      }

      const groups: [number, number][][] = [];
      for (let i = 0; i < numParts; i++) {
        groups.push(coords.slice(partStarts[i], partStarts[i + 1]));
      }
      return type === ShpType.Polygon || type === ShpType.PolygonZ || type === ShpType.PolygonM
        ? { kind: "polygon", rings: groups }
        : { kind: "polyline", parts: groups };
    }
    case ShpType.MultiPoint:
    case ShpType.MultiPointZ:
    case ShpType.MultiPointM: {
      const numPoints = view.getInt32(base + 36, true);
      const pointsBase = base + 40;
      const points: [number, number][] = [];
      for (let i = 0; i < numPoints; i++) {
        const p = pointsBase + i * 16;
        if (p + 16 > end) break;
        points.push([view.getFloat64(p, true), view.getFloat64(p + 8, true)]);
      }
      return { kind: "multipoint", points };
    }
    default:
      return null;
  }
}

// ── .dbf parsing ─────────────────────────────────────────────────────────────

export interface DbfField {
  name: string;
  type: "string" | "number" | "boolean" | "date" | "memo";
  length: number;
  decimals: number;
}

export interface DbfRecord {
  [field: string]: string | number | boolean | null;
}

export interface DbfData {
  fields: DbfField[];
  records: DbfRecord[];
}

const textDecoder = new TextDecoder("utf-8");
const latinDecoder = new TextDecoder("latin1");

function decodeText(bytes: Uint8Array): string {
  try {
    return textDecoder.decode(bytes);
  } catch {
    return latinDecoder.decode(bytes);
  }
}

export function parseDbf(buffer: ArrayBuffer): DbfData {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  if (buffer.byteLength < 33) throw new Error(".dbf file too small");

  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  const recordCount = view.getInt32(4, true);

  // Field descriptors: 32 bytes each, starting at offset 32, terminated 0x0D.
  const fields: DbfField[] = [];
  let pos = 32;
  while (pos + 32 <= headerLength && bytes[pos] !== 0x0d) {
    const name = decodeText(bytes.slice(pos, pos + 11)).replace(/\0.*$/, "").trim();
    const typeChar = String.fromCharCode(bytes[pos + 11]);
    const length = bytes[pos + 16];
    const decimals = bytes[pos + 17];
    const type: DbfField["type"] =
      typeChar === "C" ? "string"
      : typeChar === "N" || typeChar === "F" ? "number"
      : typeChar === "L" ? "boolean"
      : typeChar === "D" ? "date"
      : "memo";
    if (name) fields.push({ name, type, length, decimals });
    pos += 32;
  }

  const records: DbfRecord[] = [];
  let recStart = headerLength;
  for (let r = 0; r < recordCount && recStart + recordLength <= buffer.byteLength; r++) {
    const rec = bytes.slice(recStart, recStart + recordLength);
    recStart += recordLength;
    if (rec[0] !== 0x20 && rec[0] !== 0x2a) continue; // not a valid deletion flag

    const record: DbfRecord = {};
    let fieldPos = 1;
    for (const f of fields) {
      const raw = decodeText(rec.slice(fieldPos, fieldPos + f.length)).trim();
      fieldPos += f.length;
      switch (f.type) {
        case "number": {
          const n = raw === "" ? null : Number(raw);
          record[f.name] = n !== null && Number.isNaN(n) ? null : n;
          break;
        }
        case "boolean":
          record[f.name] = /^[YyTt]$/.test(raw) ? true : /^[NnFf]$/.test(raw) ? false : null;
          break;
        case "date":
          record[f.name] = /^\d{8}$/.test(raw)
            ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
            : null;
          break;
        case "memo":
          record[f.name] = null;
          break;
        default:
          record[f.name] = raw;
      }
    }
    records.push(record);
  }

  return { fields, records };
}

// ── Attribute → SurveyPoint mapping ──────────────────────────────────────────

const CATEGORY_HINTS: [RegExp, SurveyPoint["category"]][] = [
  [/^(road|roadtype|road_type|class|highway)$/i, "road"],
  [/^(river|water|hydro|stream|drainage)$/i, "water"],
  [/^(parcel|plot|lr_no|lrno|title|block)$/i, "boundary"],
  [/^(building|structure|house|settlement|village)$/i, "settlement"],
  [/^(utility|power|grid|electricity)$/i, "utility"],
];

/** Heuristic category from the first matching attribute name/value pair. */
export function inferCategory(
  record: DbfRecord | Record<string, unknown>
): SurveyPoint["category"] {
  for (const [pattern, category] of CATEGORY_HINTS) {
    for (const key of Object.keys(record)) {
      if (pattern.test(key)) {
        const value = String(record[key] ?? "").toLowerCase();
        if (value && value !== "null" && value !== "0") return category;
      }
    }
  }
  return "terrain";
}

/** Pick a compact code-like string value to seed field-to-finish coding. */
export function inferRawCode(
  record: DbfRecord | Record<string, unknown>
): string {
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string" && value.length > 0 && value.length <= 12) {
      return value.toUpperCase().replace(/\s+/g, "_").slice(0, 12);
    }
  }
  return "SHP";
}

export function recordToProperties(record: DbfRecord): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(record)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}
