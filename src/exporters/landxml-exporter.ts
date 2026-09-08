/**
 * LandXML 1.2 Cadastral Schema Generator
 * Outputs statutory XML format for digital land registry lodgement.
 */

import { PipelineResult } from "../types/spatial";

export function exportToLandXml(result: PipelineResult): string {
  const dateStr = new Date().toISOString().split("T")[0];

  let xml = `<?xml version="1.0" encoding="utf-8"?>\n`;
  xml += `<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="${dateStr}" time="12:00:00">\n`;
  xml += `  <Project name="${escapeXml(result.metadata.title)}" desc="Autonomous Cadastral Lodgement"/>\n`;
  xml += `  <Application name="MetaRDU GIS Studio" version="1.0" desc="Automated Survey & Spatial Platform"/>\n`;
  xml += `  <CoordinateSystem name="${escapeXml(result.metadata.crs)}" desc="Arc 1960 / UTM 37S"/>\n`;
  xml += `  <Units>\n`;
  xml += `    <Metric linearUnit="meter" areaUnit="squareMeter" volumeUnit="cubicMeter" angularUnit="decimal degrees"/>\n`;
  xml += `  </Units>\n`;

  // CgPoints (Coordinated Points)
  xml += `  <CgPoints>\n`;
  for (const p of result.points) {
    xml += `    <CgPoint name="${escapeXml(p.id)}" code="${escapeXml(p.rawCode)}">${p.northing} ${p.easting} ${p.elevation}</CgPoint>\n`;
  }
  xml += `  </CgPoints>\n`;

  // Parcels
  if (result.boundary) {
    const b = result.boundary;
    xml += `  <Parcels>\n`;
    xml += `    <Parcel name="${escapeXml(b.parcelNo)}" area="${b.areaSqM}" desc="Cadastral Survey Mutation">\n`;
    xml += `      <CoordGeom>\n`;
    for (const bd of b.bearingsDistances) {
      xml += `        <Line>\n`;
      xml += `          <Start pointRef="${escapeXml(bd.fromId)}"/>\n`;
      xml += `          <End pointRef="${escapeXml(bd.toId)}"/>\n`;
      xml += `        </Line>\n`;
    }
    xml += `      </CoordGeom>\n`;
    xml += `    </Parcel>\n`;
    xml += `  </Parcels>\n`;
  }

  xml += `</LandXML>`;
  return xml;
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case '"': return "&quot;";
      default: return c;
    }
  });
}