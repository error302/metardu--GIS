/**
 * External-source provenance registry — session-scoped record of every
 * OSINT fetch the workstation performed.
 *
 * The provenance graph is built from PipelineResult, which knows nothing
 * about the network. Rather than widening that contract everywhere, the
 * registry holds the consulted external sources (service, endpoint,
 * license, timestamp, feature count) and buildProvenanceGraph appends
 * them as `src:external-*` nodes. The record is the OSINT chain of
 * custody: what was consulted, from where, under which license, and how
 * much of it entered the document.
 *
 * Semantics: session-scoped by design. A report may legitimately state
 * "this session consulted OSM via Overpass" even after the document has
 * moved on — the disclosure is about the analysis environment, not only
 * the current geometry. The panel exposes an explicit Clear.
 */

export interface ExternalSourceRecord {
  /** Service identity, e.g. "OpenStreetMap (Overpass API)". */
  service: string;
  /** Exact endpoint URL that served the data. */
  endpoint: string;
  /** Data license, e.g. "ODbL 1.0". */
  license: string;
  /** Attribution string required by the license. */
  attribution: string;
  /** ISO-8601 fetch timestamp. */
  fetchedAt: string;
  /** Number of external features ingested. */
  featureCount: number;
  /** Human scope line, e.g. "buildings, roads — bbox [...] ≈ 12 × 8 km". */
  note?: string;
}

let sources: ExternalSourceRecord[] = [];

/** Append a fetch record (newest last; order is stable per session). */
export function recordExternalSource(rec: ExternalSourceRecord): void {
  sources.push(rec);
}

/** Current records (defensive copy — callers cannot mutate the registry). */
export function getExternalSources(): ExternalSourceRecord[] {
  return [...sources];
}

/** Drop the session record (explicit user action). */
export function clearExternalSources(): void {
  sources = [];
}

/** Total features ingested from external sources this session. */
export function externalFeatureCount(): number {
  return sources.reduce((s, r) => s + r.featureCount, 0);
}
