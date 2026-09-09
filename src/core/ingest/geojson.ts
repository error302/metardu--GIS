/**
 * GeoJSON ingest — RFC 7946 subset: Point / MultiPoint / LineString /
 * MultiLineString / Polygon / MultiPolygon with typed properties.
 */

export type GeoJsonGeometry = {
  type: string;
  coordinates: unknown;
};

export interface GeoJsonFeature {
  geometry: GeoJsonGeometry | null;
  properties: Record<string, unknown> | null;
}

export function parseGeoJson(text: string): { features: GeoJsonFeature[]; name?: string } {
  let doc: any;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new Error("Invalid GeoJSON: not parseable JSON");
  }

  if (doc?.type === "FeatureCollection") {
    const features = Array.isArray(doc.features)
      ? doc.features.filter((f: any) => f?.type === "Feature")
      : [];
    return { features, name: typeof doc.name === "string" ? doc.name : undefined };
  }
  if (doc?.type === "Feature") return { features: [doc] };
  if (doc?.type === "GeometryCollection") {
    return {
      features: (doc.geometries ?? []).map((g: any) => ({ geometry: g, properties: null })),
    };
  }
  if (doc?.type) return { features: [{ geometry: doc, properties: null }] };

  throw new Error("Invalid GeoJSON: missing FeatureCollection/Feature root");
}

/** Flatten any geometry into coordinate parts (rings/lines as [x,y] arrays). */
export function geometryToParts(
  geom: GeoJsonGeometry
): { kind: "point" | "line" | "polygon"; parts: [number, number][][] } | null {
  if (!geom || typeof geom.type !== "string") return null;
  const c = geom.coordinates as any;
  const isNum = (v: any) => typeof v === "number" && Number.isFinite(v);

  switch (geom.type) {
    case "Point":
      return Array.isArray(c) && isNum(c[0]) && isNum(c[1])
        ? { kind: "point", parts: [[c as [number, number]]] }
        : null;
    case "MultiPoint":
      return {
        kind: "point",
        parts: (c as [number, number][])
          .filter((p) => isNum(p[0]) && isNum(p[1]))
          .map((p) => [p] as [number, number][]),
      };
    case "LineString":
      return { kind: "line", parts: [c] };
    case "MultiLineString":
      return { kind: "line", parts: c };
    case "Polygon":
      return { kind: "polygon", parts: c };
    case "MultiPolygon":
      return { kind: "polygon", parts: c.flat() };
    default:
      return null;
  }
}
