/**
 * Off-Grid Energy Access & Service Catchment Modeler (Sun King & Electrification Planning)
 * Clusters settlements, evaluates distance to transmission lines, and models solar mini-grid vs SHS potential.
 */

import { SurveyPoint, EnergyCluster, SurveyVector } from "../types/spatial";

export function modelEnergyClusters(
  points: SurveyPoint[],
  vectors: SurveyVector[]
): EnergyCluster[] {
  // Find all settlement points or general household structures
  const settlementPts = points.filter(
    (p) => p.category === "settlement" || p.category === "building" || p.rawCode === "VILL" || p.rawCode === "HH"
  );

  if (settlementPts.length === 0) return [];

  const gridVectors = vectors.filter((v) => v.category === "utility" || v.code === "PWR" || v.code === "GRID");

  // Spatial clustering (group points within 200m radius)
  const CLUSTER_DIST = 250;
  const clusters: SurveyPoint[][] = [];
  const visited = new Set<string>();

  for (let i = 0; i < settlementPts.length; i++) {
    const p1 = settlementPts[i];
    if (visited.has(p1.id)) continue;

    const currentCluster: SurveyPoint[] = [p1];
    visited.add(p1.id);

    for (let j = i + 1; j < settlementPts.length; j++) {
      const p2 = settlementPts[j];
      if (visited.has(p2.id)) continue;

      const d = Math.hypot(p1.easting - p2.easting, p1.northing - p2.northing);
      if (d < CLUSTER_DIST) {
        currentCluster.push(p2);
        visited.add(p2.id);
      }
    }

    clusters.push(currentCluster);
  }

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

    // Distance to nearest grid line
    let minDistM = 8500; // default 8.5km if no grid vector in survey
    if (gridVectors.length > 0) {
      minDistM = Infinity;
      for (const gv of gridVectors) {
        for (const gp of gv.points) {
          const d = Math.hypot(centroidX - gp.easting, centroidY - gp.northing);
          if (d < minDistM) minDistM = d;
        }
      }
    }
    const gridDistanceKm = Number((minDistM / 1000).toFixed(2));

    // Estimate household density (each point represents ~3-8 households in rural settlement density)
    const householdCount = group.length * 6;
    const populationEstimate = householdCount * 5; // 5 persons/HH
    const dailyDemandKwh = Number((householdCount * 1.4).toFixed(1)); // 1.4 kWh/HH/day for rural lighting, phone charging, TV, small cooling
    const recommendedSolarKw = Number((dailyDemandKwh / 4.8).toFixed(1)); // 4.8 peak sun hours in East Africa (GHI ~ 5.5 kWh/m2)

    let recommendedType: EnergyCluster["recommendedType"] = "Stand-Alone SHS";
    if (gridDistanceKm < 1.2) {
      recommendedType = "Grid Extension";
    } else if (householdCount >= 50 && maxR <= 350) {
      recommendedType = "Mini-Grid";
    }

    // Simulated VIIRS Black Marble nocturnal luminescence
    let nightTimeLuminosity: EnergyCluster["nightTimeLuminosity"] = "Dark (Unserved)";
    if (gridDistanceKm < 1.0) {
      nightTimeLuminosity = "Bright (Electrified)";
    } else if (gridDistanceKm < 3.0) {
      nightTimeLuminosity = "Dim";
    }

    results.push({
      id: `CLUSTER-${clusterId++}`,
      centroid: [centroidX, centroidY],
      householdCount,
      populationEstimate,
      clusterRadiusM: Math.round(maxR),
      gridDistanceKm,
      solarGhiKwhM2: 5.6, // East Africa high solar irradiance
      recommendedType,
      dailyDemandKwh,
      recommendedSolarKw,
      nightTimeLuminosity,
    });
  }

  return results;
}