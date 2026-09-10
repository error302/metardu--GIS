/**
 * Off-Grid Electrification Planner — Generic Service Catchment Modeler
 * Clusters settlements, evaluates distance to transmission lines, and models mini-grid vs SHS potential.
 * Supports user-configurable cost/kWp, daily demand/HH, grid distance threshold, and mini-grid size threshold.
 */

import { SurveyPoint, EnergyCluster, SurveyVector, OffGridPlannerParams } from "../types/spatial";
import { UniformGridIndex } from "./spatial-index";

export const DEFAULT_OFFGRID_PARAMS: OffGridPlannerParams = {
  costPerKwSolar: 1100, // USD per kWp
  costPerKwhBattery: 350, // USD per kWh storage
  demandPerHhKwh: 1.4, // kWh per household per day
  gridThresholdKm: 1.5, // km threshold for grid extension
  minMiniGridHh: 40, // minimum households to justify mini-grid
  peakSunHours: 5.0, // average peak sun hours
  batteryAutonomyDays: 1.5, // days of autonomy
};

export function modelEnergyClusters(
  points: SurveyPoint[],
  vectors: SurveyVector[],
  params: OffGridPlannerParams = DEFAULT_OFFGRID_PARAMS
): EnergyCluster[] {
  // Find all settlement points or general household structures
  const settlementPts = points.filter(
    (p) => p.category === "settlement" || p.category === "building" || p.rawCode === "VILL" || p.rawCode === "HH"
  );

  if (settlementPts.length === 0) return [];

  const gridVectors = vectors.filter((v) => v.category === "utility" || v.code === "PWR" || v.code === "GRID");

  // Spatial clustering (group points within 250m radius).
  // Anchor-greedy, seeded in survey order — identical semantics to the
  // legacy O(n²) pair scan, but the candidate sweep is an indexed radius
  // query so large settlement datasets stay interactive.
  const CLUSTER_DIST = 250;
  const clusters: SurveyPoint[][] = [];
  const visited = new Set<string>();
  const settlementIndex = new UniformGridIndex(
    settlementPts,
    (p) => ({ x: p.easting, y: p.northing }),
    CLUSTER_DIST
  );

  for (let i = 0; i < settlementPts.length; i++) {
    const p1 = settlementPts[i];
    if (visited.has(p1.id)) continue;

    const currentCluster: SurveyPoint[] = [p1];
    visited.add(p1.id);

    const candidates = settlementIndex.radius(p1.easting, p1.northing, CLUSTER_DIST);
    for (const p2 of candidates) {
      if (p2.id === p1.id || visited.has(p2.id)) continue;

      const d = Math.hypot(p1.easting - p2.easting, p1.northing - p2.northing);
      if (d < CLUSTER_DIST) {
        currentCluster.push(p2);
        visited.add(p2.id);
      }
    }

    clusters.push(currentCluster);
  }

  const gridVertexIndex = new UniformGridIndex(
    gridVectors.flatMap((gv) => gv.points),
    (p) => ({ x: p.easting, y: p.northing })
  );

  const results: EnergyCluster[] = [];
  let clusterId = 1;

  for (const group of clusters) {
    let sumX = 0;
    let sumY = 0;
    for (const p of group) {
      sumX += p.easting;
      sumY += p.northing;
    }
    const centroidX = Number((sumX / group.length).toFixed(2));
    const centroidY = Number((sumY / group.length).toFixed(2));

    // Calculate cluster radius
    let maxR = 40;
    for (const p of group) {
      const d = Math.hypot(p.easting - centroidX, p.northing - centroidY);
      if (d > maxR) maxR = d;
    }

    // Distance to nearest grid line vertex (indexed nearest-neighbour query)
    let minDistM = 8500; // default 8.5km if no grid vector in survey
    if (gridVectors.length > 0) {
      const hit = gridVertexIndex.nearest(centroidX, centroidY);
      minDistM = hit ? hit.dist : 8500;
    }
    const gridDistanceKm = Number((minDistM / 1000).toFixed(2));

    // Household count and energy sizing dynamically computed from user params
    const householdCount = group.length * 6;
    const populationEstimate = householdCount * 5; // 5 persons/HH
    const dailyDemandKwh = Number((householdCount * params.demandPerHhKwh).toFixed(1));
    const recommendedSolarKw = Number((dailyDemandKwh / params.peakSunHours).toFixed(1));
    const batteryStorageKwh = Number((dailyDemandKwh * params.batteryAutonomyDays).toFixed(1));

    // Dynamic Electrification Decision Rule based on user thresholds
    let recommendedType: EnergyCluster["recommendedType"] = "Stand-Alone SHS";
    let capexEstimateUsd = 0;

    if (gridDistanceKm <= params.gridThresholdKm) {
      recommendedType = "Grid Extension";
      // Grid extension cost ~ $9,000 / km + $150 per connection
      capexEstimateUsd = Math.round(gridDistanceKm * 9000 + householdCount * 150);
    } else if (householdCount >= params.minMiniGridHh && maxR <= 450) {
      recommendedType = "Mini-Grid";
      // Mini-grid CAPEX = Solar Generation + Battery Storage + LV reticulation ($250/HH)
      capexEstimateUsd = Math.round(
        recommendedSolarKw * params.costPerKwSolar +
          batteryStorageKwh * params.costPerKwhBattery +
          householdCount * 250
      );
    } else {
      recommendedType = "Stand-Alone SHS";
      // Stand-alone SHS average unit cost ~ $180 per household kit
      capexEstimateUsd = Math.round(householdCount * 180);
    }

    // Simulated night lights luminosity based on proximity to grid
    let nightTimeLuminosity: EnergyCluster["nightTimeLuminosity"] = "Dark (Unserved)";
    if (gridDistanceKm < 1.0) {
      nightTimeLuminosity = "Bright (Electrified)";
    } else if (gridDistanceKm < 2.5) {
      nightTimeLuminosity = "Dim";
    }

    results.push({
      id: `CLUSTER-${clusterId++}`,
      centroid: [centroidX, centroidY],
      householdCount,
      populationEstimate,
      clusterRadiusM: Math.round(maxR),
      gridDistanceKm,
      solarGhiKwhM2: Number((params.peakSunHours * 1.1).toFixed(1)),
      recommendedType,
      dailyDemandKwh,
      recommendedSolarKw,
      batteryStorageKwh,
      capexEstimateUsd,
      nightTimeLuminosity,
    });
  }

  return results;
}