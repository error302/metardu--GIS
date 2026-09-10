/**
 * Deterministic synthetic survey generator for benchmarks and soak tests.
 * Produces a spatially structured dataset (terrain mass, settlement clusters,
 * road/river/utility corridors, cadastral ring) that exercises every pipeline
 * subsystem, including a depression sink for the hazard auditor.
 */

import { SurveyPoint } from "../src/types/spatial";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSurveyDataset(n: number, seed = 42): SurveyPoint[] {
  const rand = mulberry32(seed);
  const ORIGIN_E = 250000;
  const ORIGIN_N = 9850000;
  const SPAN = 2000; // metres

  const elevationAt = (x: number, y: number): number => {
    let h =
      40 * Math.sin(x / 300) +
      30 * Math.cos(y / 250) +
      8 * Math.sin(x / 57 + y / 71) +
      2 * rand() * 0.4;
    // Depression sink (for hazard audit)
    const dx = x - SPAN * 0.22;
    const dy = y - SPAN * 0.28;
    h -= 6.5 * Math.exp(-(dx * dx + dy * dy) / (120 * 120));
    return h;
  };

  const pts: SurveyPoint[] = [];
  let seq = 0;
  const push = (
    easting: number,
    northing: number,
    rawCode: string,
    category: SurveyPoint["category"],
    description: string
  ) => {
    pts.push({
      id: `SYN-${String(++seq).padStart(6, "0")}`,
      easting: ORIGIN_E + easting,
      northing: ORIGIN_N + northing,
      elevation: Number(elevationAt(easting, northing).toFixed(3)),
      rawCode,
      category,
      description,
    });
  };

  // --- Proportions -----------------------------------------------------------
  const nBoundary = 12;
  const nControl = 4;
  const nRoad = Math.round(n * 0.06);
  const nWater = Math.round(n * 0.05);
  const nUtility = Math.round(n * 0.02);
  const nSettlement = Math.round(n * 0.09);
  const nTerrain = n - nBoundary - nControl - nRoad - nWater - nUtility - nSettlement;

  // Terrain mass: jittered grid with smooth synthetic relief
  const side = Math.ceil(Math.sqrt(nTerrain));
  for (let i = 0; i < nTerrain; i++) {
    const gx = ((i % side) / side) * SPAN + (rand() - 0.5) * (SPAN / side);
    const gy = (Math.floor(i / side) / side) * SPAN + (rand() - 0.5) * (SPAN / side);
    push(gx, gy, "TERR", "terrain", "Spot elevation");
  }

  // Boundary ring (closed, Bowditch-friendly)
  const ringR = SPAN * 0.42;
  for (let i = 0; i < nBoundary; i++) {
    const ang = (i / nBoundary) * 2 * Math.PI;
    push(
      SPAN / 2 + ringR * Math.cos(ang),
      SPAN / 2 + ringR * Math.sin(ang),
      "PB",
      "boundary",
      `Beacon B${i + 1}`
    );
  }

  // Control monuments
  for (let i = 0; i < nControl; i++) {
    push(SPAN * (0.2 + 0.2 * i), SPAN * (0.15 + 0.23 * i), "CTRL", "control", `Control C${i + 1}`);
  }

  // Road corridors: 3 polylines sampled every ~10 m
  for (let i = 0; i < nRoad; i++) {
    const c = i % 3;
    const t = (i / nRoad) * SPAN * 1.2;
    const x = c === 0 ? t * 0.8 : c === 1 ? SPAN * 0.5 + 120 * Math.sin(t / 90) : t * 0.7;
    const y = c === 0 ? SPAN * 0.35 + 90 * Math.cos(t / 70) : c === 1 ? t * 0.9 : SPAN * 0.75;
    push(x, y, "RD-CL", "road", "Road centreline");
  }

  // Sinuous river
  for (let i = 0; i < nWater; i++) {
    const t = (i / nWater) * SPAN * 1.35;
    push(
      SPAN * 0.14 + 220 * Math.sin(t / 130) + t * 0.32,
      t * 0.72,
      "RIV",
      "water",
      "River centreline"
    );
  }

  // Transmission line
  for (let i = 0; i < nUtility; i++) {
    const t = (i / nUtility) * SPAN;
    push(t, SPAN * 0.92 + 30 * Math.sin(t / 150), "PWR", "utility", "Power line");
  }

  // Settlement clusters: 6 villages, gaussian-ish scatter
  const villages: [number, number][] = [
    [0.18, 0.62], [0.34, 0.78], [0.55, 0.30], [0.68, 0.66], [0.82, 0.44], [0.44, 0.50],
  ];
  for (let i = 0; i < nSettlement; i++) {
    const [vx, vy] = villages[i % villages.length];
    const g = () => (rand() + rand() + rand() + rand() - 2) * 90;
    push(
      vx * SPAN + g(),
      vy * SPAN + g(),
      i % 12 === 0 ? "SCH" : i % 17 === 0 ? "WTR_PT" : "VILL",
      "settlement",
      i % 12 === 0 ? "School" : i % 17 === 0 ? "Water point" : "Dwelling"
    );
  }

  return pts;
}

export const BENCH_METADATA = {
  id: "BENCH-50K",
  title: "Benchmark Synthetic Survey",
  locality: "Synthetic site",
  country: "East Africa",
  crs: "Arc 1960 / UTM zone 37S",
  surveyorName: "Bench Generator",
  registrationNo: "BENCH",
  date: "2026-01-01",
  scale: "1:2,500",
  organization: "MetaRDU GIS Workstation",
};
