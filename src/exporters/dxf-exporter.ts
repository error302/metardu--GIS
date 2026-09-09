/**
 * AutoCAD DXF R2018 Layered Exporter
 * Generates standards-compliant DXF files for AutoCAD, Civil 3D, and QGIS.
 */

import { PipelineResult } from "../types/spatial";

export function exportToDxf(result: PipelineResult): string {
  const lines: string[] = [];

  const add = (group: number, val: string | number) => {
    lines.push(group.toString());
    lines.push(val.toString());
  };

  // DXF Header
  add(0, "SECTION");
  add(2, "HEADER");
  add(9, "$ACADVER");
  add(1, "AC1027"); // AutoCAD 2013/2018 DXF version
  add(9, "$INSUNITS");
  add(70, 6); // Metres
  add(0, "ENDSEC");

  // TABLES (Layers)
  add(0, "SECTION");
  add(2, "TABLES");
  add(0, "TABLE");
  add(2, "LAYER");
  add(70, 6);

  const layers = [
    { name: "0", color: 7 },
    { name: "CADASTRE-BOUNDARY", color: 5 }, // Blue
    { name: "CADASTRE-BEACONS", color: 1 }, // Red
    { name: "CONTOURS-MAJOR", color: 30 }, // Orange/Brown
    { name: "CONTOURS-MINOR", color: 8 }, // Gray
    { name: "TIN-SURFACE", color: 9 }, // Light Gray
    { name: "INFRA-ROAD", color: 2 }, // Yellow
    { name: "HYDRO-RIVER", color: 4 }, // Cyan
    { name: "STRUCTURES-BLD", color: 1 }, // Red
    { name: "SETBACK-BUFFERS", color: 6 }, // Magenta
    { name: "ANNOTATIONS-TEXT", color: 7 }, // White
  ];

  for (const lyr of layers) {
    add(0, "LAYER");
    add(2, lyr.name);
    add(70, 0);
    add(62, lyr.color);
    add(6, "CONTINUOUS");
  }

  add(0, "ENDTAB");
  add(0, "ENDSEC");

  // ENTITIES
  add(0, "SECTION");
  add(2, "ENTITIES");

  // 1. Points (Beacons & Control)
  for (const pt of result.points) {
    add(0, "POINT");
    add(8, pt.category === "boundary" ? "CADASTRE-BEACONS" : "0");
    add(10, pt.easting);
    add(20, pt.northing);
    add(30, pt.elevation);

    // Text label
    add(0, "TEXT");
    add(8, "ANNOTATIONS-TEXT");
    add(10, pt.easting + 0.8);
    add(20, pt.northing + 0.8);
    add(30, pt.elevation);
    add(40, 1.2); // Text height in metres
    add(1, `${pt.id} (${pt.rawCode})`);
  }

  // 2. Feature Vectors (Polylines)
  for (const vec of result.vectors) {
    const pts = vec.points;
    if (pts.length < 2) continue;

    for (let i = 0; i < pts.length - 1; i++) {
      add(0, "LINE");
      add(8, vec.layer || "0");
      add(10, pts[i].easting);
      add(20, pts[i].northing);
      add(30, pts[i].elevation);
      add(11, pts[i + 1].easting);
      add(21, pts[i + 1].northing);
      add(31, pts[i + 1].elevation);
    }
  }

  // 3. Contours
  for (const c of result.contours) {
    const layer = c.isMajor ? "CONTOURS-MAJOR" : "CONTOURS-MINOR";
    for (let i = 0; i < c.points.length - 1; i++) {
      add(0, "LINE");
      add(8, layer);
      add(10, c.points[i][0]);
      add(20, c.points[i][1]);
      add(30, c.elevation);
      add(11, c.points[i + 1][0]);
      add(21, c.points[i + 1][1]);
      add(31, c.elevation);
    }
  }

  // 4. Corridor Buffers: closed reserve boundary (LWPOLYLINE, join-resolved
  //    geometry from the GEOS-parity engine) + the two edge paths as LINE
  //    entities for CAD editing convenience.
  for (const buf of result.buffers) {
    if (buf.polygon.length > 2) {
      add(0, "LWPOLYLINE");
      add(8, "SETBACK-BUFFERS");
      add(90, buf.polygon.length);
      add(70, 1); // closed
      for (const [x, y] of buf.polygon) {
        add(10, x);
        add(20, y);
      }
    }
    const drawOffset = (offsetPts: [number, number][]) => {
      for (let i = 0; i < offsetPts.length - 1; i++) {
        add(0, "LINE");
        add(8, "SETBACK-BUFFERS");
        add(10, offsetPts[i][0]);
        add(20, offsetPts[i][1]);
        add(30, 0);
        add(11, offsetPts[i + 1][0]);
        add(21, offsetPts[i + 1][1]);
        add(31, 0);
      }
    };
    drawOffset(buf.leftOffset);
    drawOffset(buf.rightOffset);
  }

  add(0, "ENDSEC");
  add(0, "EOF");

  return lines.join("\n");
}