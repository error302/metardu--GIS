/**
 * LandXML 1.2 Cadastral Schema Generator
 * Outputs statutory XML format for digital land registry lodgement.
 */

import { PipelineResult } from "../types/spatial";
import { buildProvenanceGraph, ProvenanceGraph } from "../core/provenance";

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

  // Provenance rides as an XML comment block: LandXML 1.2 has no extension
  // point for it, and comments survive every standards-compliant parser.
  xml += `\n${provenanceComment(buildProvenanceGraph(result))}`;
  return xml;
}

function provenanceComment(graph: ProvenanceGraph): string {
  const lines: string[] = [
    "==================== METARDU PROVENANCE (machine-readable audit) ====================",
    `digest: ${graph.digest}  format: ${graph.format} ${graph.version}  generatedAt: ${graph.generatedAt}`,
    `project: ${graph.project.title} | CRS: ${graph.project.crs} | surveyor: ${graph.project.surveyorName} (${graph.project.registrationNo})`,
  ];
  for (const n of graph.nodes) {
    if (n.kind === "figure") {
      lines.push(
        `FIGURE [${n.id}] ${n.label} = ${n.value ?? "-"} | method: ${n.methodCitation ?? "-"}`,
      );
      if (n.inputs?.length) lines.push(`        inputs: ${n.inputs.join(" <- ")}`);
      if (n.tolerance) lines.push(`        tolerance: ${n.tolerance}`);
    } else if (n.kind === "source") {
      lines.push(`SOURCE [${n.id}] ${n.label}: ${n.origin ?? "-"}`);
    } else {
      lines.push(`PROCESS [${n.id}] ${n.label} (${n.durationMs ?? "?"} ms)`);
    }
  }
  lines.push("====================================== END PROVENANCE ======================================");
  return lines.map((l) => `<!-- ${l.replace(/--/g, "- -")} -->`).join("\n");
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