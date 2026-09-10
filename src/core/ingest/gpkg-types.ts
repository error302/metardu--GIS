/**
 * GeoPackage parser type contracts — kept separate so ingest/index.ts and
 * tests can import them without pulling in the sql.js loader.
 */

export type WkbCoord = {
  x: number;
  y: number;
  z?: number;
};

export type WkbGeom =
  | { kind: "point"; coord: WkbCoord }
  | { kind: "line"; points: WkbCoord[] }
  | { kind: "polygon"; rings: WkbCoord[][] }
  | { kind: "multipoint"; points: WkbCoord[] }
  | { kind: "multiline"; parts: WkbCoord[][] }
  | { kind: "multipolygon"; polygons: WkbCoord[][][] };

export type FeatureKind =
  | { kind: "point"; x: number; y: number; z?: number }
  | { kind: "multipoint"; points: [number, number][] }
  | { kind: "polyline"; parts: [number, number][][] }
  | { kind: "polygon"; rings: [number, number][][] };

export interface GpkgFeature {
  fid: number;
  table: string;
  geom: WkbGeom;
  properties: Record<string, string | number | boolean | null>;
}
