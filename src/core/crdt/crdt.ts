/**
 * Edge-first CRDT engine (Phase D) — converges .metardu.json project state
 * across replicas without a server product.
 *
 * Design: an operation log of last-writer-wins registers and an add-wins
 * point set, merged by a total order on (lamport, replicaId). This matches
 * the reality of the target market: survey teams exchange small change
 * files over WhatsApp/email (or an optional LAN relay), replicas converge
 * deterministically, and the offline promise is never broken.
 *
 * Semantics (per register / per point id):
 *   - Idempotent: applying an op twice changes nothing (dedup by op id).
 *   - Commutative: concurrent ops converge regardless of arrival order —
 *     winner is the op with the higher (lamport, replicaId) pair.
 *   - Causally correct: lamport clocks capture happens-before across merges.
 *   - remove-point tombstones a point; a strictly-later upsert resurrects
 *     it (documented add-wins-with-causality behavior).
 */

import { SurveyPoint, McdaWeights, OffGridPlannerParams } from "../../types/spatial";
import { LayerItem } from "../layer-store";

export const CHANGES_FORMAT = "METARDU_CHANGES" as const;
export const CHANGES_VERSION = "1.0.0" as const;

export type CrdtValue = string | number | boolean | null;

export type CrdtOp =
  /** Scalar register: project name, CRS, metadata fields (key "meta.<field>"). */
  | { op: "set-scalar"; id: string; replica: string; lamport: number; ts: string; key: string; value: CrdtValue }
  /** Add-wins set element: one surveyed station. */
  | { op: "upsert-point"; id: string; replica: string; lamport: number; ts: string; point: SurveyPoint }
  | { op: "remove-point"; id: string; replica: string; lamport: number; ts: string; pointId: string }
  /** Whole-object registers: analysis parameters. */
  | { op: "set-weights"; id: string; replica: string; lamport: number; ts: string; weights: McdaWeights }
  | { op: "set-params"; id: string; replica: string; lamport: number; ts: string; params: OffGridPlannerParams }
  | { op: "set-layer"; id: string; replica: string; lamport: number; ts: string; layer: LayerItem };

export type CrdtOpKind = CrdtOp["op"];

/** Envelope exchanged between replicas (change file or relay payload). */
export interface ChangeFile {
  format: typeof CHANGES_FORMAT;
  version: typeof CHANGES_VERSION;
  replica: string;
  generatedAt: string;
  /** Human context: project + count, so a reviewer knows what they are merging. */
  project: string;
  ops: CrdtOp[];
}

/* ------------------------------------------------------------------ */
/* Total order on (lamport, replica)                                   */
/* ------------------------------------------------------------------ */

export function opWins(
  a: { lamport: number; replica: string },
  b: { lamport: number; replica: string },
): boolean {
  return a.lamport > b.lamport || (a.lamport === b.lamport && a.replica > b.replica);
}

/* ------------------------------------------------------------------ */
/* Replica document                                                    */
/* ------------------------------------------------------------------ */

interface Register<T> { lamport: number; replica: string; value: T }

interface DocState {
  scalars: Map<string, Register<CrdtValue>>;
  points: Map<string, Register<SurveyPoint>>;
  pointTombstones: Map<string, Register<true>>;
  weights: Register<McdaWeights> | null;
  params: Register<OffGridPlannerParams> | null;
  layers: Map<string, Register<LayerItem>>;
}

export interface MergeReport {
  applied: number;
  /** Duplicates already present — the merge is idempotent. */
  ignored: number;
  /** Ops rejected as malformed. */
  rejected: string[];
  /** Points now tombstoned by the merge. */
  removals: number;
}

export interface CrdtDocOptions {
  /** Hard cap on retained op ids (memory guard for very long sessions). */
  maxSeenOps?: number;
}

export class CrdtDoc {
  readonly replica: string;
  private lamport = 0;
  private readonly seen = new Set<string>();
  private readonly seenOrder: string[] = [];
  private readonly state: DocState = {
    scalars: new Map(),
    points: new Map(),
    pointTombstones: new Map(),
    weights: null,
    params: null,
    layers: new Map(),
  };

  constructor(replica: string, private opts: CrdtDocOptions = {}) {
    if (!replica) throw new Error("CrdtDoc requires a non-empty replica id");
    this.replica = replica;
  }

  get clock(): number {
    return this.lamport;
  }

  get opCount(): number {
    return this.seen.size;
  }

  /* ---------------- local operations ---------------- */

  private localStamp(): { id: string; replica: string; lamport: number; ts: string } {
    this.lamport += 1;
    return {
      id: `${this.replica}:${this.lamport}`,
      replica: this.replica,
      lamport: this.lamport,
      ts: new Date().toISOString(),
    };
  }

  setScalar(key: string, value: CrdtValue): CrdtOp {
    const op = { op: "set-scalar" as const, ...this.localStamp(), key, value };
    this.integrate(op);
    return op;
  }

  upsertPoint(point: SurveyPoint): CrdtOp {
    const op = { op: "upsert-point" as const, ...this.localStamp(), point };
    this.integrate(op);
    return op;
  }

  removePoint(pointId: string): CrdtOp {
    const op = { op: "remove-point" as const, ...this.localStamp(), pointId };
    this.integrate(op);
    return op;
  }

  setWeights(weights: McdaWeights): CrdtOp {
    const op = { op: "set-weights" as const, ...this.localStamp(), weights };
    this.integrate(op);
    return op;
  }

  setParams(params: OffGridPlannerParams): CrdtOp {
    const op = { op: "set-params" as const, ...this.localStamp(), params };
    this.integrate(op);
    return op;
  }

  setLayer(layer: LayerItem): CrdtOp {
    const op = { op: "set-layer" as const, ...this.localStamp(), layer };
    this.integrate(op);
    return op;
  }

  /* ---------------- merge ---------------- */

  /**
   * Applies remote ops. Deterministic: winner by (lamport, replica) per
   * register/point; duplicates ignored; lamport clock advances past the
   * remote maximum so future local edits win ties against that history.
   */
  merge(ops: CrdtOp[]): MergeReport {
    const report: MergeReport = { applied: 0, ignored: 0, rejected: [], removals: 0 };
    let maxLamport = this.lamport;
    for (const op of ops) {
      if (!isValidOp(op)) {
        report.rejected.push(String((op as any)?.op ?? "unknown"));
        continue;
      }
      if (this.seen.has(op.id)) {
        report.ignored += 1;
        continue;
      }
      if (op.lamport > maxLamport) maxLamport = op.lamport;
      this.integrate(op);
      report.applied += 1;
      if (op.op === "remove-point") report.removals += 1;
    }
    // Observed the remote history — move the clock past it (merge event).
    this.lamport = Math.max(this.lamport, maxLamport) + 1;
    return report;
  }

  private remember(id: string) {
    this.seen.add(id);
    this.seenOrder.push(id);
    const cap = this.opts.maxSeenOps ?? 200_000;
    while (this.seenOrder.length > cap) {
      const old = this.seenOrder.shift();
      if (old) this.seen.delete(old);
    }
  }

  private integrate(op: CrdtOp): void {
    this.remember(op.id);
    switch (op.op) {
      case "set-scalar": {
        const cur = this.state.scalars.get(op.key);
        if (!cur || opWins(op, cur)) {
          this.state.scalars.set(op.key, { lamport: op.lamport, replica: op.replica, value: op.value });
        }
        break;
      }
      case "upsert-point": {
        const key = op.point.id;
        const tomb = this.state.pointTombstones.get(key);
        // A concurrent upsert wins over a tombstone only if strictly later.
        if (tomb && !opWins(op, tomb)) break;
        this.state.pointTombstones.delete(key);
        const cur = this.state.points.get(key);
        if (!cur || opWins(op, cur)) {
          this.state.points.set(key, { lamport: op.lamport, replica: op.replica, value: op.point });
        }
        break;
      }
      case "remove-point": {
        const key = op.pointId;
        const tomb = this.state.pointTombstones.get(key);
        if (!tomb || opWins(op, tomb)) {
          this.state.pointTombstones.set(key, { lamport: op.lamport, replica: op.replica, value: true });
        }
        const cur = this.state.points.get(key);
        // Tombstone wins only if later than the live register.
        if (cur && opWins(op, cur)) this.state.points.delete(key);
        break;
      }
      case "set-weights": {
        if (!this.state.weights || opWins(op, this.state.weights)) {
          this.state.weights = { lamport: op.lamport, replica: op.replica, value: op.weights };
        }
        break;
      }
      case "set-params": {
        if (!this.state.params || opWins(op, this.state.params)) {
          this.state.params = { lamport: op.lamport, replica: op.replica, value: op.params };
        }
        break;
      }
      case "set-layer": {
        const cur = this.state.layers.get(op.layer.id);
        if (!cur || opWins(op, cur)) {
          this.state.layers.set(op.layer.id, { lamport: op.lamport, replica: op.replica, value: op.layer });
        }
        break;
      }
    }
  }

  /* ---------------- state access ---------------- */

  getScalar(key: string): CrdtValue | undefined {
    return this.state.scalars.get(key)?.value;
  }

  livePoints(): SurveyPoint[] {
    return [...this.state.points.values()].map((r) => r.value);
  }

  getWeights(): McdaWeights | undefined {
    return this.state.weights?.value;
  }

  getParams(): OffGridPlannerParams | undefined {
    return this.state.params?.value;
  }

  getLayers(): LayerItem[] {
    return [...this.state.layers.values()].map((r) => r.value);
  }
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function isValidOp(op: unknown): op is CrdtOp {
  if (typeof op !== "object" || op === null) return false;
  const o = op as Record<string, unknown>;
  return (
    typeof o.op === "string" &&
    typeof o.id === "string" &&
    typeof o.replica === "string" &&
    typeof o.lamport === "number" &&
    Number.isFinite(o.lamport) &&
    typeof o.ts === "string"
  );
}

/** Parses and validates a change file payload (used by UI and bridge client). */
export function parseChangeFile(json: string): ChangeFile {
  const parsed = JSON.parse(json);
  if (!parsed || parsed.format !== CHANGES_FORMAT) {
    throw new Error("Not a MetaRDU change file (missing METARDU_CHANGES signature).");
  }
  if (!Array.isArray(parsed.ops)) {
    throw new Error("Change file is malformed: ops is not an array.");
  }
  return parsed as ChangeFile;
}
