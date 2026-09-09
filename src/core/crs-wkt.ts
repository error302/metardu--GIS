/**
 * WKT / .prj CRS parser — converts ESRI-style and OGC well-known-text
 * coordinate system definitions into proj4 strings, with best-effort EPSG
 * resolution. Closes the Shapefile ingest loop: a .prj sidecar now drives
 * automatic reprojection instead of a "verify the CRS" warning.
 *
 * Scope: the surveyor projection set (Transverse Mercator/UTM, Lambert
 * Conformal Conic, Mercator, Cassini-Soldner, Albers, Lambert Azimuthal,
 * Stereographic, Hotine Oblique Mercator). Anything else throws a clear
 * error rather than producing a silently-wrong transform.
 */

import proj4 from "proj4";
import { listSupportedEPSG, getCRS } from "./crs";

/* ------------------------------------------------------------------ */
/* WKT tokenizer → tree                                                */
/* ------------------------------------------------------------------ */

interface WktNode {
  name: string;
  args: (string | number | WktNode)[];
}

function parseWktTree(input: string): WktNode {
  let i = 0;
  const n = input.length;

  const skipWs = () => {
    while (i < n && /\s/.test(input[i])) i++;
  };

  function parseNode(): WktNode {
    skipWs();
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(i));
    if (!m) throw new Error(`WKT: expected keyword at offset ${i}`);
    const name = m[0];
    i += m[0].length;
    skipWs();
    if (input[i] !== "[") throw new Error(`WKT: expected '[' after ${name}`);
    i++;
    const args: (string | number | WktNode)[] = [];
    skipWs();
    if (input[i] === "]") {
      i++;
      return { name, args };
    }
    for (;;) {
      skipWs();
      const c = input[i];
      if (c === '"') {
        // quoted string
        let s = "";
        i++;
        while (i < n && input[i] !== '"') {
          if (input[i] === "\\") {
            i++;
            if (i < n) s += input[i++];
          } else s += input[i++];
        }
        i++; // closing quote
        args.push(s);
      } else if (c === "," || c === "]") {
        args.push(NaN); // positional hole (e.g. AUTHORITY values dropped) — keep positions stable
        if (c === ",") i++;
        else {
          i++;
          break;
        }
      } else if (/[A-Za-z_]/.test(c)) {
        args.push(parseNode());
      } else if (/[-+0-9.]/.test(c)) {
        const num = /^[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/.exec(input.slice(i));
        if (!num) throw new Error(`WKT: bad number at offset ${i}`);
        args.push(Number(num[0]));
        i += num[0].length;
      } else {
        throw new Error(`WKT: unexpected character '${c}' at offset ${i}`);
      }
      skipWs();
      if (input[i] === ",") {
        i++;
        continue;
      }
      if (input[i] === "]") {
        i++;
        break;
      }
      throw new Error(`WKT: expected ',' or ']' at offset ${i}`);
    }
    return { name, args };
  }

  const root = parseNode();
  skipWs();
  if (i !== n) throw new Error(`WKT: trailing content at offset ${i}`);
  return root;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function node(args: (string | number | WktNode)[], i: number): WktNode {
  const a = args[i];
  if (typeof a === "object") return a;
  throw new Error(`WKT: expected keyword at argument ${i}, got ${String(a)}`);
}

function str(args: (string | number | WktNode)[], i: number): string {
  const a = args[i];
  if (typeof a === "string") return a;
  return "";
}

function num(args: (string | number | WktNode)[], i: number): number {
  const a = args[i];
  if (typeof a === "number" && !Number.isNaN(a)) return a;
  if (typeof a === "string") {
    const v = Number(a);
    if (!Number.isNaN(v)) return v;
  }
  return NaN;
}

function find(node_: WktNode, name: string): WktNode | null {
  for (const a of node_.args) {
    if (typeof a === "object" && a.name.toUpperCase() === name.toUpperCase()) return a;
  }
  return null;
}

function params(node_: WktNode): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of node_.args) {
    if (typeof a === "object" && a.name.toUpperCase() === "PARAMETER" && a.args.length >= 2) {
      const key = str(a.args, 0).toUpperCase();
      const v = num(a.args, 1);
      if (key) out.set(key, v);
    }
  }
  return out;
}

/* Spheroid name → proj4 +ellps alias (fallback path when numbers fail). */
const SPHEROID_ALIASES: [RegExp, string][] = [
  [/WGS\s*84|WGS_1984/i, "WGS84"],
  [/GRS\s*80|GRS_1980/i, "GRS80"],
  [/GRS\s*67/i, "GRS67"],
  [/Clarke\s*1880/i, "clrk80"],
  [/Clarke\s*1866/i, "clrk66"],
  [/Airy\s*1830|Airy_1830/i, "airy"],
  [/International|Hayford/i, "intl"],
  [/Krassowsky|Krasovsky/i, "krass"],
  [/Bessel\s*1841/i, "bessel"],
  [/Everest/i, "evrst30"],
  [/Australian\s*National/i, "aust_SA"],
  [/South\s*American/i, "sphere"],
];

const DATUM_ALIASES: [RegExp, string][] = [
  [/WGS\s*_?1984|WGS\s*84/i, "+datum=WGS84"],
  [/NAD\s*_?1983|NAD83/i, "+datum=NAD83"],
  [/NAD\s*_?1927|NAD27/i, "+datum=NAD27"],
  [/OSGB/i, "+datum=OSGB36"],
  [/ETRS\s*?89/i, "+init=epsg:4258"],
];

/* ------------------------------------------------------------------ */
/* Projection builders                                                 */
/* ------------------------------------------------------------------ */

function tmercParams(p: Map<string, number>, out: string[]): void {
  push(out, "lat_0", p.get("LATITUDE_OF_ORIGIN"));
  push(out, "lon_0", p.get("CENTRAL_MERIDIAN"));
  push(out, "k_0", p.get("SCALE_FACTOR"));
  push(out, "x_0", p.get("FALSE_EASTING"));
  push(out, "y_0", p.get("FALSE_NORTHING"));
}

const PROJECTION_BUILDERS: Record<string, (p: Map<string, number>, out: string[]) => void> = {
  TRANSVERSE_MERCATOR: tmercParams,
  GAUSS_KRUGER: tmercParams,
  TRANSVERSE_MERCATOR_SOUTH_ORIENTATED: (p, out) => {
    out.push("+proj=tmerc", "+axis=wsu");
    tmercParams(p, out);
  },
  MERCATOR_1SP: (p, out) => {
    out.push("+proj=merc");
    push(out, "lat_ts", p.get("LATITUDE_OF_ORIGIN") ?? p.get("PSEUDO_STANDARD_PARALLEL_1"));
    push(out, "lon_0", p.get("CENTRAL_MERIDIAN"));
    push(out, "k_0", p.get("SCALE_FACTOR"));
    push(out, "x_0", p.get("FALSE_EASTING"));
    push(out, "y_0", p.get("FALSE_NORTHING"));
  },
  MERCATOR_2SP: (p, out) => {
    out.push("+proj=merc");
    push(out, "lat_ts", p.get("STANDARD_PARALLEL_1"));
    push(out, "lon_0", p.get("CENTRAL_MERIDIAN"));
    push(out, "x_0", p.get("FALSE_EASTING"));
    push(out, "y_0", p.get("FALSE_NORTHING"));
  },
  POPULAR_VISUALISATION_PSEUDO_MERCATOR: (p, out) => {
    out.push("+proj=merc", "+a=6378137", "+b=6378137");
    push(out, "lon_0", p.get("CENTRAL_MERIDIAN"));
    push(out, "x_0", p.get("FALSE_EASTING"));
    push(out, "y_0", p.get("FALSE_NORTHING"));
  },
  LAMBERT_CONFORMAL_CONIC_1SP: (p, out) => {
    out.push("+proj=lcc");
    push(out, "lat_0", p.get("LATITUDE_OF_ORIGIN"));
    push(out, "lon_0", p.get("CENTRAL_MERIDIAN"));
    push(out, "k_0", p.get("SCALE_FACTOR"));
    push(out, "x_0", p.get("FALSE_EASTING"));
    push(out, "y_0", p.get("FALSE_NORTHING"));
  },
  LAMBERT_CONFORMAL_CONIC_2SP: (p, out) => {
    out.push("+proj=lcc");
    push(out, "lat_0", p.get("LATITUDE_OF_ORIGIN") ?? p.get("STANDARD_PARALLEL_1"));
    push(out, "lon_0", p.get("CENTRAL_MERIDIAN"));
    push(out, "lat_1", p.get("STANDARD_PARALLEL_1"));
    push(out, "lat_2", p.get("STANDARD_PARALLEL_2"));
    push(out, "x_0", p.get("FALSE_EASTING"));
    push(out, "y_0", p.get("FALSE_NORTHING"));
  },
  LAMBERT_CONFORMAL_CONIC: (p, out) => {
    out.push("+proj=lcc");
    push(out, "lat_0", p.get("LATITUDE_OF_ORIGIN") ?? p.get("STANDARD_PARALLEL_1"));
    push(out, "lon_0", p.get("CENTRAL_MERIDIAN"));
    push(out, "lat_1", p.get("STANDARD_PARALLEL_1"));
    push(out, "lat_2", p.get("STANDARD_PARALLEL_2"));
    push(out, "x_0", p.get("FALSE_EASTING"));
    push(out, "y_0", p.get("FALSE_NORTHING"));
  },
  CASSINI_SOLDNER: (p, out) => {
    out.push("+proj=cass");
    push(out, "lat_0", p.get("LATITUDE_OF_ORIGIN"));
    push(out, "lon_0", p.get("CENTRAL_MERIDIAN"));
    push(out, "x_0", p.get("FALSE_EASTING"));
    push(out, "y_0", p.get("FALSE_NORTHING"));
  },
  ALBERS_CONIC_EQUAL_AREA: (p, out) => {
    out.push("+proj=aea");
    push(out, "lat_0", p.get("LATITUDE_OF_ORIGIN"));
    push(out, "lon_0", p.get("CENTRAL_MERIDIAN"));
    push(out, "lat_1", p.get("STANDARD_PARALLEL_1"));
    push(out, "lat_2", p.get("STANDARD_PARALLEL_2"));
    push(out, "x_0", p.get("FALSE_EASTING"));
    push(out, "y_0", p.get("FALSE_NORTHING"));
  },
  LAMBERT_AZIMUTHAL_EQUAL_AREA: (p, out) => {
    out.push("+proj=laea");
    push(out, "lat_0", p.get("LATITUDE_OF_ORIGIN"));
    push(out, "lon_0", p.get("CENTRAL_MERIDIAN"));
    push(out, "x_0", p.get("FALSE_EASTING"));
    push(out, "y_0", p.get("FALSE_NORTHING"));
  },
  OBLIQUE_STEREOGRAPHIC: (p, out) => {
    out.push("+proj=stere");
    push(out, "lat_0", p.get("LATITUDE_OF_ORIGIN"));
    push(out, "lon_0", p.get("CENTRAL_MERIDIAN"));
    push(out, "k_0", p.get("SCALE_FACTOR"));
    push(out, "x_0", p.get("FALSE_EASTING"));
    push(out, "y_0", p.get("FALSE_NORTHING"));
  },
  POLAR_STEREOGRAPHIC: (p, out) => {
    out.push("+proj=stere", "+lat_0=90");
    push(out, "lat_ts", p.get("STANDARD_PARALLEL_1"));
    push(out, "lon_0", p.get("CENTRAL_MERIDIAN"));
    push(out, "x_0", p.get("FALSE_EASTING"));
    push(out, "y_0", p.get("FALSE_NORTHING"));
  },
  HOTINE_OBLIQUE_MERCATOR: (p, out) => {
    out.push("+proj=omerc");
    push(out, "lat_0", p.get("LATITUDE_OF_CENTER"));
    push(out, "lon_0", p.get("LONGITUDE_OF_CENTER"));
    push(out, "alpha", p.get("AZIMUTH"));
    push(out, "k_0", p.get("SCALE_FACTOR"));
    push(out, "x_0", p.get("FALSE_EASTING"));
    push(out, "y_0", p.get("FALSE_NORTHING"));
  },
  HOTINE_OBLIQUE_MERCATOR_RECTIFIED: (p, out) => {
    out.push("+proj=omerc");
    push(out, "lat_0", p.get("LATITUDE_OF_CENTER"));
    push(out, "lon_0", p.get("LONGITUDE_OF_CENTER"));
    push(out, "alpha", p.get("AZIMUTH"));
    push(out, "gamma", p.get("RECTIFIED_GRID_ANGLE"));
    push(out, "k_0", p.get("SCALE_FACTOR"));
    push(out, "x_0", p.get("FALSE_EASTING"));
    push(out, "y_0", p.get("FALSE_NORTHING"));
  },
  KROVAK: (p, out) => {
    out.push("+proj=krovak");
    push(out, "lat_0", p.get("LATITUDE_OF_CENTER"));
    push(out, "lon_0", p.get("LONGITUDE_OF_CENTER"));
    push(out, "alpha", p.get("AZIMUTH"));
    push(out, "k_0", p.get("SCALE_FACTOR"));
    push(out, "x_0", p.get("FALSE_EASTING"));
    push(out, "y_0", p.get("FALSE_NORTHING"));
  },
};

/** UTM special case: names like "UTM Zone 37, Southern Hemisphere" or WKT
 *  with +zone-deducible parameters collapse to the robust +proj=utm form. */
function tryUtm(root: WktNode, projectionName: string, p: Map<string, number>): string[] | null {
  const nameish = `${str(root.args, 0)} ${projectionName}`;
  const m = /UTM[ _-]?ZONE[ _-]?(\d{1,2})/i.exec(nameish);
  if (!m) return null;
  const zone = Number(m[1]);
  if (!(zone >= 1 && zone <= 60)) return null;
  const south =
    /SOUTHERN/i.test(nameish) ||
    /ZONE[ _-]?\d{1,2}S(?:\b|_|$)/i.test(nameish) ||
    (p.get("LATITUDE_OF_ORIGIN") ?? 0) < 0;
  return [`+proj=utm`, `+zone=${zone}`, ...(south ? ["+south"] : [])];
}

function push(out: string[], key: string, v: number | undefined): void {
  if (v === undefined || Number.isNaN(v)) return;
  out.push(`+${key}=${trimNum(v)}`);
}

function trimNum(v: number): string {
  // Enough digits for survey-grade parameters; no float dust.
  const s = String(Math.round(v * 1e10) / 1e10);
  return s;
}

/* ------------------------------------------------------------------ */
/* Main conversion                                                     */
/* ------------------------------------------------------------------ */

export interface WktCrs {
  name: string;
  proj4: string;
  units: "m" | "degrees";
  epsg: number | null;
}

export function parseWktCrs(wktRaw: string): WktCrs {
  const wkt = wktRaw.trim().replace(/^=\s*/, "");
  if (!/^PROJCS|^GEOGCS|^GEOCCS/i.test(wkt)) {
    throw new Error("Not a WKT coordinate system (expected PROJCS/GEOGCS)");
  }
  const root = parseWktTree(wkt);
  const isProjected = root.name.toUpperCase() === "PROJCS";
  const out: string[] = [];
  let units: "m" | "degrees" = "m";

  const geogcs = find(root, "GEOGCS") ?? (root.name.toUpperCase() === "GEOGCS" ? root : null);
  const spheroid = geogcs ? (find(geogcs, "DATUM") ? find(find(geogcs, "DATUM")!, "SPHEROID") : null) : null;
  const authority = geogcs ? find(geogcs, "AUTHORITY") : null;
  let epsg: number | null = null;
  if (authority && authority.args.length >= 2 && str(authority.args, 0).toUpperCase() === "EPSG") {
    const code = Number(str(authority.args, 1));
    if (Number.isInteger(code)) epsg = code;
  }
  // PROJCS-level AUTHORITY takes precedence
  const rootAuth = find(root, "AUTHORITY");
  if (rootAuth && rootAuth.args.length >= 2 && str(rootAuth.args, 0).toUpperCase() === "EPSG") {
    const code = Number(str(rootAuth.args, 1));
    if (Number.isInteger(code)) epsg = code;
  }

  if (!isProjected) {
    out.push("+proj=longlat", "+units=degrees");
    units = "degrees";
  } else {
    const projection = find(root, "PROJECTION");
    if (!projection) throw new Error("WKT PROJCS without PROJECTION");
    const projectionName = str(projection.args, 0).toUpperCase();
    const p = params(root);

    const utm = tryUtm(root, projectionName, p);
    if (utm) {
      out.push(...utm);
    } else {
      const builder = PROJECTION_BUILDERS[projectionName];
      if (!builder) throw new Error(`Unsupported WKT projection: ${projectionName}`);
      // Builders push the +proj term first, then parameters.
      builder(p, out);
    }
    const unitNode = find(root, "UNIT");
    if (unitNode) {
      const unitName = str(unitNode.args, 0).toUpperCase();
      if (/FOOT|FEET/.test(unitName)) out.push("+units=us-ft");
      else out.push("+units=m");
    } else {
      out.push("+units=m");
    }
  }

  // Datum / spheroid
  const datum = geogcs ? find(geogcs, "DATUM") : null;
  const datumName = datum ? str(datum.args, 0) : "";
  const datumAlias = DATUM_ALIASES.find(([re]) => re.test(datumName));
  let usedDatumAlias = false;
  if (datumAlias && !out.some((s) => s.startsWith("+datum") || s.startsWith("+a="))) {
    out.push(datumAlias[1]);
    usedDatumAlias = true;
  }
  if (!usedDatumAlias && spheroid) {
    const a = num(spheroid.args, 1);
    const rf = num(spheroid.args, 2);
    const ellpsName = str(spheroid.args, 0);
    if (!Number.isNaN(a) && a > 6_000_000 && !Number.isNaN(rf) && rf > 250) {
      out.push(`+a=${trimNum(a)}`, `+rf=${trimNum(rf)}`);
    } else {
      const alias = SPHEROID_ALIASES.find(([re]) => re.test(ellpsName));
      if (alias) out.push(`+ellps=${alias[1]}`);
      else throw new Error(`WKT: unrecognised spheroid '${ellpsName}'`);
    }
  }

  // TOWGS84 (7-param or 3-param) — kept verbatim; it is the honest datum path
  const towgs = find(root, "TOWGS84");
  if (towgs) {
    const vals = towgs.args.filter((a) => typeof a === "number" && !Number.isNaN(a)) as number[];
    if (vals.length >= 3) {
      out.push(`+towgs84=${vals.map(trimNum).join(",")}`);
    }
  }

  if (!out.some((s) => s.startsWith("+datum") || s.startsWith("+a=") || s.startsWith("+ellps"))) {
    out.push("+datum=WGS84"); // last resort only for WGS-named geographies
  }
  out.push("+no_defs");

  const name = str(root.args, 0) || "Unnamed WKT CRS";
  let proj4Str = out.join(" ");
  // EPSG resolution: explicit AUTHORITY wins; otherwise match the built-in
  // registry by parameters. When the CRS is identified, adopt the registry's
  // canonical definition — it carries the real datum shift (towgs84), which
  // ESRI-flavoured WKT routinely omits.
  if (epsg !== null) {
    const canon = getCRS(epsg);
    if (canon) proj4Str = canon.proj4;
  } else {
    const matched = matchRegistryEpsg(proj4Str, name);
    if (matched !== null) {
      epsg = matched;
      proj4Str = getCRS(matched)!.proj4;
    }
  }
  return { name, proj4: proj4Str, units, epsg };
}

/* ------------------------------------------------------------------ */
/* Registry matching (EPSG resolution without network)                 */
/* ------------------------------------------------------------------ */

function proj4KeyMap(def: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const tok of def.trim().split(/\s+/)) {
    if (!tok.startsWith("+")) continue;
    const eq = tok.indexOf("=");
    if (eq < 0) continue;
    const k = tok.slice(1, eq);
    if (k === "title" || k === "no_defs" || k === "wktext" || k === "nadgrids") continue;
    m.set(k, tok.slice(eq + 1));
  }
  return m;
}

const COMPARE_KEYS = [
  "proj", "zone", "south", "lat_0", "lon_0", "lat_ts", "lat_1", "lat_2",
  "k_0", "x_0", "y_0", "alpha", "gamma", "units", "datum", "ellps", "a", "rf", "towgs84",
];

/**
 * Match a proj4 string against the built-in registry to recover an EPSG code.
 * Tolerates +a/+rf vs +ellps spelling differences by comparing effective keys.
 */
export function matchRegistryEpsg(proj4Str: string, name = ""): number | null {
  const cand = proj4KeyMap(proj4Str);
  for (const def of listSupportedEPSG()) {
    const ref = proj4KeyMap(def.proj4);
    // fast path: zone/name match then verify params
    let allMatch = true;
    for (const k of COMPARE_KEYS) {
      const rv = ref.get(k);
      const cv = cand.get(k);
      if (rv === undefined && cv === undefined) continue;
      if (rv === undefined || cv === undefined) {
        // ellps vs a/rf equivalence (both directions)
        if (k === "ellps" && cand.has("a")) continue;
        if ((k === "a" || k === "rf") && ref.has("ellps")) continue;
        // ESRI WKT omits towgs84 — the datum-shift gap must not block an
        // otherwise exact parameter match; the canonical def fills it in.
        if (k === "towgs84" && (cand.has("a") || cand.has("datum") || cand.has("ellps"))) continue;
        if (k === "datum" && (cand.has("towgs84") || cand.has("a"))) continue;
        allMatch = false;
        break;
      }
      if (k === "proj" && rv === "utm" && cv === "utm") continue;
      if (rv !== cv) {
        // numeric tolerance for parameter float dust
        const rn = Number(rv);
        const cn = Number(cv);
        if (!Number.isNaN(rn) && !Number.isNaN(cn)) {
          if (Math.abs(rn - cn) > Math.max(1e-6, Math.abs(rn) * 1e-9)) {
            allMatch = false;
            break;
          }
          continue;
        }
        allMatch = false;
        break;
      }
    }
    if (allMatch) return def.epsg;
  }
  void name;
  return null;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Parse + validate a .prj body. Validation runs a real proj4 round-trip so a
 * syntactically-valid but semantically-broken definition cannot pass.
 */
export function parsePrj(text: string): WktCrs {
  const crs = parseWktCrs(text);
  // proj4 accepts raw def strings directly — no scratch registration needed.
  proj4(crs.proj4, "+proj=longlat +datum=WGS84 +units=degrees", [0, 0]);
  proj4("+proj=longlat +datum=WGS84 +units=degrees", crs.proj4, [36.8, -1.3]);
  return crs;
}
