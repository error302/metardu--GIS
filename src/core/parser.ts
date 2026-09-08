/**
 * Universal Raw Survey & GIS File Parser & Serializer
 * Delimiter auto-sniffing, coordinate column mapping, Leica GSI, GeoJSON, KML ingestion,
 * full attribute retention in properties, and round-trip exporters.
 */

import { SurveyPoint, FeatureCategory, AttributeField } from "../types/spatial";

export function parseRawSurveyText(content: string): SurveyPoint[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  // Check if GeoJSON
  if (trimmed.startsWith("{") && trimmed.includes('"type"')) {
    return parseGeoJson(trimmed);
  }

  // Check if KML / XML
  if (trimmed.startsWith("<") && (trimmed.includes("<kml") || trimmed.includes("<Placemark"))) {
    return parseKml(trimmed);
  }

  // Check if Leica GSI
  if (trimmed.startsWith("11....") || trimmed.includes("81..") || trimmed.includes("82..")) {
    return parseLeicaGsi(trimmed);
  }

  return parseDelimitedText(trimmed);
}

function detectDelimiter(lines: string[]): string {
  const sample = lines.slice(0, 5).join("\n");
  const commaCount = (sample.match(/,/g) || []).length;
  const tabCount = (sample.match(/\t/g) || []).length;
  const semiCount = (sample.match(/;/g) || []).length;

  if (tabCount > commaCount && tabCount > semiCount) return "\t";
  if (semiCount > commaCount) return ";";
  if (commaCount > 0) return ",";
  return "whitespace";
}

function parseDelimitedText(text: string): SurveyPoint[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(lines);
  const firstLine = lines[0].toLowerCase();
  const hasHeader =
    firstLine.includes("east") ||
    firstLine.includes("north") ||
    firstLine.includes("pt") ||
    firstLine.includes("id") ||
    firstLine.includes("elev") ||
    firstLine.includes("code") ||
    firstLine.includes("desc");

  let idCol = 0;
  let eastCol = 1;
  let northCol = 2;
  let elevCol = 3;
  let codeCol = 4;
  let catCol = -1;
  let descCol = -1;

  let headers: string[] = [];
  let startIndex = 0;

  if (hasHeader) {
    startIndex = 1;
    headers = splitLine(lines[0], delimiter);
    const headerTokens = headers.map((t) => t.toLowerCase().trim());
    headerTokens.forEach((tok, idx) => {
      const clean = tok.replace(/[^a-z0-9]/g, "");
      if (clean === "id" || clean === "pt" || clean === "point" || clean === "stn" || clean === "name" || clean === "stationid") {
        idCol = idx;
      } else if (clean === "easting" || clean === "east" || clean === "x" || clean === "lon" || clean === "longitude") {
        eastCol = idx;
      } else if (clean === "northing" || clean === "north" || clean === "y" || clean === "lat" || clean === "latitude") {
        northCol = idx;
      } else if (clean === "elevation" || clean === "elev" || clean === "height" || clean === "z" || clean === "h" || clean === "elevationmsl") {
        elevCol = idx;
      } else if (clean === "code" || clean === "rawcode" || clean === "feature" || clean === "feat") {
        codeCol = idx;
      } else if (clean === "category" || clean === "cat") {
        catCol = idx;
      } else if (clean === "description" || clean === "desc" || clean === "remark" || clean === "comment") {
        descCol = idx;
      }
    });
  }

  const standardCols = new Set([idCol, eastCol, northCol, elevCol, codeCol, catCol, descCol]);
  const points: SurveyPoint[] = [];

  for (let i = startIndex; i < lines.length; i++) {
    const tokens = splitLine(lines[i], delimiter);
    if (tokens.length < 3) continue;

    const id = tokens[idCol] || `P${i + 1}`;
    let easting = parseFloat(tokens[eastCol]);
    let northing = parseFloat(tokens[northCol]);
    let elevation = parseFloat(tokens[elevCol]) || 0;
    const rawCode = (tokens[codeCol] || "SL").trim().toUpperCase();
    const description = descCol >= 0 && tokens[descCol] ? tokens[descCol].trim() : rawCode;

    // Coordinate swap safeguard: in East Africa UTM 37S, Northing is ~9,800,000 to 10,000,000, Easting is ~200,000 to 400,000
    if (easting > 9000000 && northing < 1000000) {
      const temp = easting;
      easting = northing;
      northing = temp;
    }

    if (isNaN(easting) || isNaN(northing)) continue;

    // Extract all dynamic properties from non-standard columns
    const properties: Record<string, any> = {};
    tokens.forEach((val, idx) => {
      if (!standardCols.has(idx) && val !== undefined && val !== "") {
        const key = headers[idx] ? headers[idx].trim() : `field_${idx + 1}`;
        const numVal = parseFloat(val);
        properties[key] = !isNaN(numVal) && String(numVal) === val ? numVal : val;
      }
    });

    points.push({
      id,
      easting: Number(easting.toFixed(3)),
      northing: Number(northing.toFixed(3)),
      elevation: Number(elevation.toFixed(3)),
      rawCode,
      category: mapCodeToCategory(rawCode),
      description,
      properties: Object.keys(properties).length > 0 ? properties : undefined,
    });
  }

  return points;
}

function splitLine(line: string, delimiter: string): string[] {
  if (delimiter === "whitespace") {
    return line.split(/\s+/);
  }
  // Standard CSV handling that handles quotes
  if (delimiter === ",") {
    const result: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(cur.trim());
        cur = "";
      } else {
        cur += char;
      }
    }
    result.push(cur.trim());
    return result;
  }
  return line.split(delimiter).map((t) => t.trim());
}

function parseLeicaGsi(text: string): SurveyPoint[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const points: SurveyPoint[] = [];

  for (let i = 0; i < lines.length; i++) {
    const tokens = lines[i].split(/\s+/);
    let id = `P${i + 1}`;
    let easting = 0;
    let northing = 0;
    let elevation = 0;
    let code = "SL";

    for (const tok of tokens) {
      const tag = tok.substring(0, 2);
      const valStr = tok.substring(6);
      const sign = valStr.startsWith("-") ? -1 : 1;
      const num = parseInt(valStr.replace(/^[+-]/, ""), 10) / 1000.0;

      if (tag === "11") id = tok.substring(6).replace(/^0+/, "") || `P${i + 1}`;
      else if (tag === "81") easting = sign * num;
      else if (tag === "82") northing = sign * num;
      else if (tag === "83") elevation = sign * num;
      else if (tag === "71" || tag === "72") code = tok.substring(6).trim();
    }

    if (easting !== 0 && northing !== 0) {
      points.push({
        id,
        easting: Number(easting.toFixed(3)),
        northing: Number(northing.toFixed(3)),
        elevation: Number(elevation.toFixed(3)),
        rawCode: code.toUpperCase(),
        category: mapCodeToCategory(code),
        description: `Leica GSI Station ${id}`,
      });
    }
  }

  return points;
}

export function parseGeoJson(jsonStr: string): SurveyPoint[] {
  try {
    const geo = JSON.parse(jsonStr);
    const points: SurveyPoint[] = [];
    const features = geo.type === "FeatureCollection" ? geo.features : [geo];

    let counter = 1;
    for (const f of features) {
      if (f.geometry && f.geometry.type === "Point") {
        const [x, y, z] = f.geometry.coordinates;
        const props = { ...(f.properties || {}) };
        const code = props.code || props.name || props.feature || props.rawCode || "SL";
        const id = props.id || props.stationId || props.ptId || `GP${counter++}`;
        const desc = props.description || props.desc || String(code);

        points.push({
          id: String(id),
          easting: Number(x.toFixed(3)),
          northing: Number(y.toFixed(3)),
          elevation: Number((z || props.elevation || props.z || 0).toFixed(3)),
          rawCode: String(code).toUpperCase(),
          category: props.category || mapCodeToCategory(String(code)),
          description: String(desc),
          latitude: typeof y === "number" && Math.abs(y) <= 90 ? Number(y.toFixed(6)) : undefined,
          longitude: typeof x === "number" && Math.abs(x) <= 180 ? Number(x.toFixed(6)) : undefined,
          properties: Object.keys(props).length > 0 ? props : undefined,
        });
      }
    }
    return points;
  } catch {
    return [];
  }
}

export function parseKml(kmlStr: string): SurveyPoint[] {
  const points: SurveyPoint[] = [];
  const placemarkRegex = /<Placemark[\s\S]*?<\/Placemark>/gi;
  const nameRegex = /<name>([\s\S]*?)<\/name>/i;
  const descRegex = /<description>([\s\S]*?)<\/description>/i;
  const coordRegex = /<coordinates>([\s\S]*?)<\/coordinates>/i;

  let match: RegExpExecArray | null;
  let counter = 1;

  while ((match = placemarkRegex.exec(kmlStr)) !== null) {
    const pm = match[0];
    const cMatch = coordRegex.exec(pm);
    if (!cMatch) continue;

    const parts = cMatch[1].trim().split(",");
    if (parts.length < 2) continue;

    const lon = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    const alt = parts.length > 2 ? parseFloat(parts[2]) : 0;

    const nMatch = nameRegex.exec(pm);
    const dMatch = descRegex.exec(pm);

    const name = nMatch ? nMatch[1].trim() : `KML_PT_${counter++}`;
    const desc = dMatch ? dMatch[1].trim() : name;

    points.push({
      id: name,
      easting: Number(lon.toFixed(6)),
      northing: Number(lat.toFixed(6)),
      elevation: Number(alt.toFixed(3)),
      rawCode: "KML_POI",
      category: mapCodeToCategory("KML_POI"),
      description: desc,
      latitude: lat,
      longitude: lon,
    });
  }

  return points;
}

export function mapCodeToCategory(code: string): FeatureCategory {
  const c = code.toUpperCase();
  if (c.startsWith("CTR") || c.startsWith("BM") || c.startsWith("TS") || c.startsWith("GNSS") || c.startsWith("PIP")) return "control";
  if (c.startsWith("BL") || c.startsWith("PB") || c.startsWith("IB") || c.startsWith("MB") || c.startsWith("BND")) return "boundary";
  if (c.startsWith("BLD") || c.startsWith("HOUSE") || c.startsWith("WALL") || c.startsWith("FENCE") || c.startsWith("FN")) return "building";
  if (c.startsWith("RD") || c.startsWith("ROAD") || c.startsWith("TRK") || c.startsWith("PATH")) return "road";
  if (c.startsWith("RIV") || c.startsWith("STR") || c.startsWith("WTR") || c.startsWith("DRAIN") || c.startsWith("CANAL")) return "water";
  if (c.startsWith("PWR") || c.startsWith("POLE") || c.startsWith("MH") || c.startsWith("PIPE") || c.startsWith("SEW")) return "utility";
  if (c.startsWith("TREE") || c.startsWith("VEG") || c.startsWith("BUSH") || c.startsWith("FOREST")) return "vegetation";
  if (c.startsWith("SET") || c.startsWith("VILL") || c.startsWith("HH") || c.startsWith("CLINIC") || c.startsWith("SCH")) return "settlement";
  if (c.startsWith("SOLAR") || c.startsWith("GRID") || c.startsWith("GEN") || c.startsWith("BATT")) return "energy";
  return "terrain";
}

/** Extract all unique attribute fields from a survey dataset */
export function extractAttributeFields(points: SurveyPoint[]): AttributeField[] {
  const fieldsMap = new Map<string, AttributeField>();

  fieldsMap.set("id", { name: "id", type: "string", alias: "Station ID" });
  fieldsMap.set("easting", { name: "easting", type: "number", alias: "Easting (m)" });
  fieldsMap.set("northing", { name: "northing", type: "number", alias: "Northing (m)" });
  fieldsMap.set("elevation", { name: "elevation", type: "number", alias: "Elevation MSL (m)" });
  fieldsMap.set("rawCode", { name: "rawCode", type: "string", alias: "Code" });
  fieldsMap.set("category", { name: "category", type: "string", alias: "Category" });
  fieldsMap.set("description", { name: "description", type: "string", alias: "Description" });

  for (const pt of points) {
    if (pt.properties) {
      for (const [key, val] of Object.entries(pt.properties)) {
        if (!fieldsMap.has(key)) {
          const type = typeof val === "number" ? "number" : typeof val === "boolean" ? "boolean" : "string";
          fieldsMap.set(key, { name: key, type });
        }
      }
    }
  }

  return Array.from(fieldsMap.values());
}

/** Serialize survey points into standard CSV with dynamic attributes */
export function serializePointsToCsv(points: SurveyPoint[]): string {
  const fields = extractAttributeFields(points);
  const headerRow = fields.map((f) => f.name).join(",");

  const rows = points.map((p) => {
    return fields
      .map((f) => {
        let val: any = undefined;
        if (f.name === "id") val = p.id;
        else if (f.name === "easting") val = p.easting;
        else if (f.name === "northing") val = p.northing;
        else if (f.name === "elevation") val = p.elevation;
        else if (f.name === "rawCode") val = p.rawCode;
        else if (f.name === "category") val = p.category;
        else if (f.name === "description") val = p.description;
        else if (p.properties && p.properties[f.name] !== undefined) val = p.properties[f.name];

        if (val === undefined || val === null) return "";
        if (typeof val === "string" && (val.includes(",") || val.includes('"') || val.includes("\n"))) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return String(val);
      })
      .join(",");
  });

  return [headerRow, ...rows].join("\n");
}

/** Serialize survey points into standard GeoJSON FeatureCollection */
export function serializePointsToGeoJson(points: SurveyPoint[], crsName?: string): string {
  const features = points.map((p) => {
    const coords = [p.easting, p.northing, p.elevation];
    const properties: Record<string, any> = {
      id: p.id,
      code: p.rawCode,
      category: p.category,
      elevation: p.elevation,
      description: p.description,
      ...(p.properties || {}),
    };
    if (p.latitude !== undefined) properties.latitude = p.latitude;
    if (p.longitude !== undefined) properties.longitude = p.longitude;

    return {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: coords,
      },
      properties,
    };
  });

  const fc: Record<string, any> = {
    type: "FeatureCollection",
    features,
  };

  if (crsName) {
    fc.crs = {
      type: "name",
      properties: {
        name: crsName,
      },
    };
  }

  return JSON.stringify(fc, null, 2);
}