/**
 * RFC 7946 GeoJSON Exporter
 * Formats points, boundaries, contours, and corridor buffers into an interchangeable spatial dataset.
 */

import { PipelineResult } from "../types/spatial";
import { buildProvenanceGraph } from "../core/provenance";

export function exportToGeoJson(result: PipelineResult): string {
  const features: any[] = [];

  // Points
  for (const p of result.points) {
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [p.longitude || p.easting, p.latitude || p.northing, p.elevation],
      },
      properties: {
        id: p.id,
        code: p.rawCode,
        category: p.category,
        description: p.description,
        easting: p.easting,
        northing: p.northing,
        elevationMsl: p.elevation,
      },
    });
  }

  // Boundary
  if (result.boundary && result.boundary.points.length >= 3) {
    const coords = result.boundary.points.map((p) => [
      p.longitude || p.easting,
      p.latitude || p.northing,
      p.elevation,
    ]);
    // Close ring
    coords.push(coords[0]);

    features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [coords],
      },
      properties: {
        id: result.boundary.id,
        parcelNo: result.boundary.parcelNo,
        areaSqM: result.boundary.areaSqM,
        areaHa: result.boundary.areaHa,
        areaAcres: result.boundary.areaAcres,
        precisionRatio: `1:${result.boundary.precisionRatio}`,
        precisionRating: result.boundary.precisionRating,
      },
    });
  }

  // Vectors
  for (const v of result.vectors) {
    if (v.points.length < 2) continue;
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: v.points.map((p) => [p.longitude || p.easting, p.latitude || p.northing, p.elevation]),
      },
      properties: {
        id: v.id,
        name: v.name,
        code: v.code,
        category: v.category,
        layer: v.layer,
      },
    });
  }

  // Contours
  for (const c of result.contours) {
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: c.points.map((pt) => [pt[0], pt[1], c.elevation]),
      },
      properties: {
        elevation: c.elevation,
        isMajor: c.isMajor,
      },
    });
  }

  // Corridor buffers as closed Polygon features (join-resolved rings from
  // the GEOS-parity engine; rings are already closed, first vertex repeated).
  for (const buf of result.buffers) {
    if (buf.polygon.length < 4) continue;
    features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [buf.polygon.map(([e, n]) => [e, n, 0])],
      },
      properties: {
        id: buf.id,
        sourceFeatureId: buf.sourceFeatureId,
        featureName: buf.featureName,
        reserveWidthM: buf.reserveWidthM,
        areaSqM: buf.areaSqM,
        encroachmentDetected: buf.encroachmentDetected,
      },
    });
  }

  const featureCollection = {
    type: "FeatureCollection",
    metadata: {
      title: result.metadata.title,
      locality: result.metadata.locality,
      crs: result.metadata.crs,
      generator: "MetaRDU GIS Studio Autonomous Workstation",
      timestamp: new Date().toISOString(),
    },
    // RFC 7946 §6.1 allows foreign members — provenance travels with the data.
    provenance: buildProvenanceGraph(result),
    features,
  };

  return JSON.stringify(featureCollection, null, 2);
}