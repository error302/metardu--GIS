/**
 * Project ⇄ CRDT projection — bridges the .metardu.json document model and
 * the edge-first CRDT replica (src/core/crdt/crdt.ts).
 *
 * snapshotToOps  — diff a full project snapshot into ops (idempotent replay
 *                  of a snapshot leaves the replica state unchanged apart
 *                  from op-id churn).
 * docToChangeFile / docToProject — exchange and rebuild.
 */

import { ProjectMetadata } from "../../types/spatial";
import { MetarduProject } from "../project";
import {
  CrdtDoc, CrdtOp, CrdtValue, ChangeFile, CHANGES_FORMAT, CHANGES_VERSION,
} from "./crdt";

/** Metadata fields carried as scalar registers. */
const META_FIELDS: (keyof ProjectMetadata)[] = [
  "id", "title", "locality", "country", "crs",
  "surveyorName", "registrationNo", "date", "scale", "organization",
];

/**
 * Converts a full project snapshot into a fresh set of ops on the replica.
 * Every call re-asserts the snapshot state (new lamports) — the practical
 * meaning is "this replica now vouches for this state".
 */
export function snapshotToOps(doc: CrdtDoc, project: MetarduProject): CrdtOp[] {
  const ops: CrdtOp[] = [];
  ops.push(doc.setScalar("project.name", project.projectName));
  ops.push(doc.setScalar("project.crs", project.crs));
  for (const f of META_FIELDS) {
    ops.push(doc.setScalar(`meta.${f}`, project.metadata[f] as CrdtValue));
  }
  ops.push(doc.setWeights(project.mcdaWeights));
  ops.push(doc.setParams(project.offGridParams));
  for (const layer of project.layers) ops.push(doc.setLayer(layer));
  for (const p of project.points) ops.push(doc.upsertPoint(p));
  return ops;
}

/** Builds an exchangeable change file from the replica's op history. */
export function buildChangeFile(
  doc: CrdtDoc,
  ops: CrdtOp[],
  projectName: string,
): ChangeFile {
  return {
    format: CHANGES_FORMAT,
    version: CHANGES_VERSION,
    replica: doc.replica,
    generatedAt: new Date().toISOString(),
    project: projectName,
    ops,
  };
}

/**
 * Rebuilds a project from merged replica state. Fields not present in the
 * CRDT fall back to the fallback metadata (typically the local document's),
 * so a merge never invents values.
 */
export function docToProject(doc: CrdtDoc, fallback: {
  metadata: ProjectMetadata;
  layers: MetarduProject["layers"];
  offGridParams: MetarduProject["offGridParams"];
  mcdaWeights: MetarduProject["mcdaWeights"];
}): MetarduProject {
  const meta: ProjectMetadata = { ...fallback.metadata };
  for (const f of META_FIELDS) {
    const v = doc.getScalar(`meta.${f}`);
    if (v !== undefined && v !== null) (meta as any)[f] = v;
  }
  return {
    format: "METARDU_GIS_PROJECT",
    version: "1.0.0",
    savedAt: new Date().toISOString(),
    projectName: (doc.getScalar("project.name") as string) ?? fallback.metadata.title ?? "Merged Project",
    crs: (doc.getScalar("project.crs") as string) ?? fallback.metadata.crs,
    metadata: meta,
    points: doc.livePoints(),
    layers: doc.getLayers().length > 0 ? doc.getLayers() : fallback.layers,
    offGridParams: doc.getParams() ?? fallback.offGridParams,
    mcdaWeights: doc.getWeights() ?? fallback.mcdaWeights,
  };
}
