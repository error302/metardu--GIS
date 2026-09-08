/**
 * Universal Raw Survey & GIS File Parser
 * Delimiter auto-sniffing, coordinate column mapping, Leica GSI, and GeoJSON ingestion.
 */

import { SurveyPoint, FeatureCategory } from "../types/spatial";

interface ParsedRow {
  id?: string;
  easting?: number;
  northing?: number;
  elevation?: number;
  code?: string;
  description?: string;
}

export function parseRawSurveyText(content: string): SurveyPoint[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  // Check if GeoJSON
  if (trimmed.startsWith("{") && trimmed.includes('"type"')) {
    return parseGeoJson(trimmed);
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
    firstLine.includes("code");

  let idCol = 0;
  let eastCol = 1;
  let northCol = 2;
  let elevCol = 3;
  let codeCol = 4;

  let startIndex = 0;
  if (hasHeader) {
    startIndex = 1;
    const headerTokens = splitLine(lines[0], delimiter).map((t) => t.toLowerCase().trim());
    headerTokens.forEach((tok, idx) => {
      if (tok === "id" || tok === "pt" || tok === "point" || tok === "stn" || tok === "name") idCol = idx;
      else if (tok.includes("east") || tok === "x" || tok === "lon") eastCol = idx;
      else if (tok.includes("north") || tok === "y" || tok === "lat") northCol = idx;
      else if (tok.includes("elev") || tok.includes("height") || tok === "z" || tok === "h") elevCol = idx;
      else if (tok.includes("code") || tok.includes("desc") || tok.includes("feature")) codeCol = idx;
    });
  }

  const points: SurveyPoint[] = [];

  for (let i = startIndex; i < lines.length; i++) {
    const tokens = splitLine(lines[i], delimiter);
    if (tokens.length < 3) continue;

    const id = tokens[idCol] || `P${i + 1}`;
    let easting = parseFloat(tokens[eastCol]);
    let northing = parseFloat(tokens[northCol]);
    let elevation = parseFloat(tokens[elevCol]) || 0;
    const rawCode = (tokens[codeCol] || "SL").trim().toUpperCase();

    // Coordinate swap safeguard: in East Africa UTM 37S, Northing is ~9,800,000 to 10,000,000, Easting is ~200,000 to 400,000
    // If coordinates were ordered Northing, Easting, swap them to canonical Easting, Northing
    if (easting > 9000000 && northing < 1000000) {
      const temp = easting;
      easting = northing;
      northing = temp;
    }

    if (isNaN(easting) || isNaN(northing)) continue;

    points.push({
      id,
      easting: Number(easting.toFixed(3)),
      northing: Number(northing.toFixed(3)),
      elevation: Number(elevation.toFixed(3)),
      rawCode,
      category: mapCodeToCategory(rawCode),
      description: rawCode,
    });
  }

  return points;
}

function splitLine(line: string, delimiter: string): string[] {
  if (delimiter === "whitespace") {
    return line.split(/\s+/);
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

function parseGeoJson(jsonStr: string): SurveyPoint[] {
  try {
    const geo = JSON.parse(jsonStr);
    const points: SurveyPoint[] = [];
    const features = geo.type === "FeatureCollection" ? geo.features : [geo];

    let counter = 1;
    for (const f of features) {
      if (f.geometry && f.geometry.type === "Point") {
        const [x, y, z] = f.geometry.coordinates;
        const code = (f.properties && (f.properties.code || f.properties.name || f.properties.feature)) || "SL";
        points.push({
          id: (f.properties && f.properties.id) || `GP${counter++}`,
          easting: Number(x.toFixed(3)),
          northing: Number(y.toFixed(3)),
          elevation: Number((z || 0).toFixed(3)),
          rawCode: String(code).toUpperCase(),
          category: mapCodeToCategory(String(code)),
          description: f.properties?.description || String(code),
        });
      }
    }
    return points;
  } catch {
    return [];
  }
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