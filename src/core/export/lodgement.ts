/**
 * One-click Lodgement Package (Phase D — field-to-statute).
 *
 * Bundles everything a land registry desk needs into a single ZIP:
 *   LandXML/<project>_Cadastre.xml   — statutory lodgement schema
 *                                      (carries the provenance comment block)
 *   provenance/provenance.json       — machine-readable provenance graph
 *   schedules/beacons.csv            — coordinated station schedule
 *   schedules/bearings-distances.csv — adjusted boundary traverse schedule
 *   plans/Form4.svg                  — print-ready statutory mutation plan
 *   MANIFEST.txt                     — contents + integrity digest
 *
 * The ZIP writer is dependency-free (store method, CRC-32) so the package
 * builds offline with no WASM or server round-trip.
 */

import { PipelineResult } from "../../types/spatial";
import { exportToLandXml } from "../../exporters/landxml-exporter";
import { renderTemplate } from "../composer/render";
import { form4Preset } from "../composer/presets";
import { buildProvenanceGraph, serializeProvenance } from "../provenance";

/* ------------------------------------------------------------------ */
/* CRC-32 (IEEE 802.3, reflected, same polynomial as zlib)             */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ */
/* ZIP (store method)                                                  */
/* ------------------------------------------------------------------ */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1f),
    date: (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f),
  };
}

function le16(buf: number[], v: number) {
  buf.push(v & 0xff, (v >>> 8) & 0xff);
}
function le32(buf: number[], v: number) {
  buf.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
}

/**
 * Builds a stored (uncompressed) ZIP archive — valid per APPNOTE.TXT and
 * readable by every unzip implementation. Folders are implicit (paths only).
 */
export function buildZip(entries: ZipEntry[], when: Date = new Date()): Uint8Array {
  const { time, date } = dosDateTime(when);
  const local: number[] = [];
  const central: number[] = [];
  const offsets: number[] = [];

  for (const e of entries) {
    const nameBytes = new TextEncoder().encode(e.name);
    const crc = crc32(e.data);
    offsets.push(local.length);

    // Local file header
    le32(local, 0x04034b50);
    le16(local, 20); // version needed
    le16(local, 0x0800); // flags: UTF-8 names
    le16(local, 0); // method: store
    le16(local, time);
    le16(local, date);
    le32(local, crc);
    le32(local, e.data.length); // compressed size
    le32(local, e.data.length); // uncompressed size
    le16(local, nameBytes.length);
    le16(local, 0); // extra len
    for (const b of nameBytes) local.push(b);
    for (const b of e.data) local.push(b);

    // Central directory entry
    le32(central, 0x02014b50);
    le16(central, 20); // version made by
    le16(central, 20); // version needed
    le16(central, 0x0800);
    le16(central, 0);
    le16(central, time);
    le16(central, date);
    le32(central, crc);
    le32(central, e.data.length);
    le32(central, e.data.length);
    le16(central, nameBytes.length);
    le16(central, 0); // extra
    le16(central, 0); // comment
    le16(central, 0); // disk start
    le16(central, 0); // internal attrs
    le32(central, 0); // external attrs
    le32(central, offsets[offsets.length - 1]);
    for (const b of nameBytes) central.push(b);
  }

  const centralStart = local.length;
  const centralEnd = centralStart + central.length;

  // End of central directory
  const eocd: number[] = [];
  le32(eocd, 0x06054b50);
  le16(eocd, 0); // disk
  le16(eocd, 0); // disk with cd
  le16(eocd, entries.length);
  le16(eocd, entries.length);
  le32(eocd, centralEnd - centralStart);
  le32(eocd, centralStart);
  le16(eocd, 0); // comment len

  const out = new Uint8Array(centralEnd + eocd.length);
  out.set(new Uint8Array(local), 0);
  out.set(new Uint8Array(central), centralStart);
  out.set(new Uint8Array(eocd), centralEnd);
  return out;
}

/* ------------------------------------------------------------------ */
/* CSV schedules                                                       */
/* ------------------------------------------------------------------ */

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header: string[], rows: (string | number)[][]): string {
  return [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}

/* ------------------------------------------------------------------ */
/* Package builder                                                     */
/* ------------------------------------------------------------------ */

export interface LodgementPackage {
  filename: string;
  bytes: Uint8Array;
  /** The manifest text (also embedded in the ZIP as MANIFEST.txt). */
  manifest: string;
}

export function buildLodgementPackage(result: PipelineResult, now: Date = new Date()): LodgementPackage {
  const safe = result.metadata.title.replace(/[^a-zA-Z0-9_-]+/g, "_");
  const prov = buildProvenanceGraph(result);

  const entries: ZipEntry[] = [];
  const push = (name: string, text: string) =>
    entries.push({ name, data: new TextEncoder().encode(text) });

  push(`LandXML/${safe}_Cadastre.xml`, exportToLandXml(result));
  push("provenance/provenance.json", serializeProvenance(prov));

  // Beacon schedule — every coordinated station, adjusted working coordinates.
  push(
    "schedules/beacons.csv",
    toCsv(
      ["station", "easting_m", "northing_m", "elev_msl_m", "code", "category", "description"],
      result.points.map((p) => [
        p.id, p.easting.toFixed(3), p.northing.toFixed(3), p.elevation.toFixed(3),
        p.rawCode, p.category, p.description,
      ]),
    ),
  );

  // Adjusted boundary traverse schedule.
  const b = result.boundary;
  push(
    "schedules/bearings-distances.csv",
    b
      ? toCsv(
          ["from", "to", "from_e_m", "from_n_m", "to_e_m", "to_n_m", "bearing_dms", "distance_m"],
          b.bearingsDistances.map((bd) => {
            const fp = b.points.find((q) => q.id === bd.fromId);
            const tp = b.points.find((q) => q.id === bd.toId);
            return [
              bd.fromId, bd.toId,
              fp ? fp.easting.toFixed(3) : "", fp ? fp.northing.toFixed(3) : "",
              tp ? tp.easting.toFixed(3) : "", tp ? tp.northing.toFixed(3) : "",
              bd.bearingDms, bd.distanceM.toFixed(3),
            ];
          }),
        )
      : toCsv(["from", "to", "bearing_dms", "distance_m"], [[
          "no closed boundary in document", "", "", "",
        ]]),
  );

  // Statutory plan — print-ready SVG (browsers print SVG → PDF 1:1 from the dialog).
  push(`plans/Form4_${safe}.svg`, renderTemplate(form4Preset(), result).svg);

  const manifest =
`METARDU GIS STUDIO — ONE-CLICK LODGEMENT PACKAGE
================================================
Project        : ${result.metadata.title} (${result.metadata.id})
Locality       : ${result.metadata.locality}, ${result.metadata.country}
CRS            : ${result.metadata.crs}
Surveyor       : ${result.metadata.surveyorName} (Reg. ${result.metadata.registrationNo})
Survey date    : ${result.metadata.date}
Compiled       : ${now.toISOString()}

Contents
--------
LandXML/${safe}_Cadastre.xml    Statutory LandXML 1.2 lodgement schema (with embedded provenance audit)
provenance/provenance.json     Machine-readable provenance graph (METARDU_PROVENANCE 1.0.0)
schedules/beacons.csv          Coordinated station schedule (adjusted working coordinates)
schedules/bearings-distances.csv  Adjusted boundary traverse schedule (bearing, distance)
plans/Form4_${safe}.svg        Print-ready Form 4 mutation plan (print dialog exports 1:1 PDF)

Figures & verification
----------------------
Provenance digest : ${prov.digest}
Figures audited   : ${prov.nodes.filter((n) => n.kind === "figure").length}
Boundary          : ${b ? `${b.areaHa.toFixed(2)} ha, precision 1:${b.precisionRatio.toLocaleString("en-US")} (${b.precisionRating})` : "no closed boundary in document"}
Stations          : ${result.points.length}

Verification notes
------------------
- Every figure carries its method, inputs and stated tolerance in provenance.json.
- The digest changes if any input, weight or result changes — verify before lodgement.
- Form 4 SVG: open in a browser and print to PDF at 100% scale for a lodgement PDF.
`;
  push("MANIFEST.txt", manifest);

  return {
    filename: `Lodgement_${safe}_${now.toISOString().split("T")[0]}.zip`,
    bytes: buildZip(entries, now),
    manifest,
  };
}
