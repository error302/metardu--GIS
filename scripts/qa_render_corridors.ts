/**
 * Visual QA: render corridor polygons (engine output) to SVG for direct
 * inspection of join geometry. Open the file in a browser and screenshot.
 */
import { generateCorridorBuffers } from "../src/core/buffer-engine";
import { writeFileSync } from "fs";
import type { SurveyVector, SurveyPoint } from "../src/types/spatial";

const mk = (id: string, cat: "road" | "water", coords: [number, number][]): SurveyVector => ({
  id, code: cat === "road" ? "RD-CL" : "RIV", name: id, category: cat,
  layer: "qa",
  points: coords.map(([e, n], i) => ({
    id: `${id}-${i}`, easting: e, northing: n, elevation: 0,
    rawCode: "", category: cat, description: "",
  })),
  isClosed: false, color: "#000", lineType: "solid", lineWidth: 1,
});

// Bend-heavy fixtures straight from the golden suite.
const road = mk("bend-road", "road", [
  [1000, 2000], [1100, 2000], [1100, 2120],
]);
const zig = mk("acute-road", "road", [
  [1250, 2000], [1350, 2000], [1420.71, 2070.71], [1520.71, 2070.71],
]);
const river = mk("river", "water", [
  [1000, 2250], [1100, 2290], [1200, 2250], [1300, 2290],
]);

const buffers = generateCorridorBuffers([road, zig, river], [], 15, 30);

const toSvgXY = ([e, n]: [number, number]): [number, number] => [e - 900, 2420 - n];
const path = (ring: [number, number][]) =>
  ring.map((p, i) => `${i === 0 ? "M" : "L"}${toSvgXY(p)[0].toFixed(2)},${toSvgXY(p)[1].toFixed(2)}`).join(" ") + " Z";

let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="760" height="520" viewBox="0 0 760 520">
<rect width="760" height="520" fill="#141414"/>
<text x="20" y="30" fill="#d9a441" font-family="monospace" font-size="15">Corridor engine v2 — round joins, flat caps (engine output, GEOS-parity)</text>
`;

const colors = ["#d9a441", "#d9a441", "#62bfc3"];
buffers.forEach((b, i) => {
  svg += `<path d="${path(b.polygon)}" fill="${colors[i]}" fill-opacity="0.14" stroke="${colors[i]}" stroke-width="1.6" stroke-dasharray="6 4"/>\n`;
  // centerline overlay
  const src = b.sourceFeatureId === "bend-road" ? road : b.sourceFeatureId === "acute-road" ? zig : river;
  const cl = src.points.map((p) => [p.easting, p.northing] as [number, number]);
  svg += `<path d="${cl.map((p, j) => `${j === 0 ? "M" : "L"}${toSvgXY(p)[0].toFixed(2)},${toSvgXY(p)[1].toFixed(2)}`).join(" ")}" fill="none" stroke="#888" stroke-width="1"/>\n`;
  // vertex ticks on the ring (join arcs visible as dense ticks)
  for (const p of b.polygon) {
    const [x, y] = toSvgXY(p);
    svg += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.6" fill="${colors[i]}"/>\n`;
  }
});
svg += "</svg>";
writeFileSync("/home/z/my-project/download/metardu-audit/corridor-geometry.svg", svg);
console.log("wrote corridor-geometry.svg with", buffers.length, "corridors");
