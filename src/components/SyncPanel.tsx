/**
 * Sync Panel — edge-first collaboration over the project file (Phase D).
 *
 * A persistent CRDT replica (CrdtDoc) tracks this workstation's document.
 * "Adopting" a document diffs it against the previously adopted snapshot and
 * appends only the changed registers to the op log — so exported op ids are
 * unique forever and change files stay small. Merging is deterministic
 * (last-writer-wins by lamport/replica; add-wins points with causality).
 *
 * Exchange paths: .metardu-changes.json change files (WhatsApp/email) or an
 * optional LAN relay (bridge/sync-bridge.mjs). No server product: replicas
 * are authoritative, the relay only shuffles immutable ops.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { FileOutput, FileInput, Radio, UploadCloud, DownloadCloud, GitMerge, Users } from "lucide-react";
import { PipelineResult } from "../types/spatial";
import { MetarduProject, createProjectSnapshot } from "../core/project";
import { CrdtDoc, CrdtOp, parseChangeFile, ChangeFile } from "../core/crdt/crdt";
import { snapshotToOps, buildChangeFile, docToProject } from "../core/crdt/project-crdt";

interface SyncPanelProps {
  result: PipelineResult;
  /** Applies a merged project as the new working document. */
  onApplyProject: (project: MetarduProject) => void;
}

const REPLICA_KEY = "metardu-sync-replica-id";
const BRIDGE_KEY = "metardu-sync-bridge-url";

const META_FIELDS = [
  "id", "title", "locality", "country", "crs",
  "surveyorName", "registrationNo", "date", "scale", "organization",
] as const;

function ensureReplicaId(): string {
  let id = localStorage.getItem(REPLICA_KEY);
  if (!id) {
    id = `rep-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36).slice(-4)}`;
    localStorage.setItem(REPLICA_KEY, id);
  }
  return id;
}

/** Stable signature of a point's content (change detection for diffing). */
function pointSig(p: PipelineResult["points"][number]): string {
  return [
    p.easting, p.northing, p.elevation, p.rawCode, p.category, p.description,
    JSON.stringify(p.properties ?? null),
  ].join("|");
}

export const SyncPanel: React.FC<SyncPanelProps> = ({ result, onApplyProject }) => {
  const replicaId = useMemo(ensureReplicaId, []);

  // Persistent replica state across the session.
  const docRef = useRef<CrdtDoc | null>(null);
  if (!docRef.current) docRef.current = new CrdtDoc(replicaId);
  const doc = docRef.current;

  const logRef = useRef<CrdtOp[]>([]);
  const baseRef = useRef<MetarduProject | null>(null);
  const clockRef = useRef(0);

  const project = useMemo(() => createProjectSnapshot(result), [result]);

  /** Diff `project` against the last adopted snapshot; emit only changes. */
  const adopt = (proj: MetarduProject): number => {
    const base = baseRef.current;
    let emitted = 0;
    const push = (op: CrdtOp) => {
      logRef.current.push(op);
      emitted += 1;
    };

    if (!base) {
      for (const op of snapshotToOps(doc, proj)) push(op);
    } else {
      if (base.projectName !== proj.projectName) push(doc.setScalar("project.name", proj.projectName));
      if (base.crs !== proj.crs) push(doc.setScalar("project.crs", proj.crs));
      for (const f of META_FIELDS) {
        if (base.metadata[f] !== proj.metadata[f]) {
          push(doc.setScalar(`meta.${f}`, proj.metadata[f] as string));
        }
      }
      if (JSON.stringify(base.mcdaWeights) !== JSON.stringify(proj.mcdaWeights)) {
        push(doc.setWeights(proj.mcdaWeights));
      }
      if (JSON.stringify(base.offGridParams) !== JSON.stringify(proj.offGridParams)) {
        push(doc.setParams(proj.offGridParams));
      }
      const baseLayers = new Map(base.layers.map((l) => [l.id, JSON.stringify(l)]));
      for (const l of proj.layers) {
        if (baseLayers.get(l.id) !== JSON.stringify(l)) push(doc.setLayer(l));
      }
      const baseSig = new Map(base.points.map((p) => [p.id, pointSig(p)]));
      const seen = new Set<string>();
      for (const p of proj.points) {
        seen.add(p.id);
        if (baseSig.get(p.id) !== pointSig(p)) push(doc.upsertPoint(p));
      }
      // Points the replica holds that the snapshot no longer contains.
      for (const p of doc.livePoints()) {
        if (!seen.has(p.id)) push(doc.removePoint(p.id));
      }
    }
    baseRef.current = proj;
    clockRef.current = doc.clock;
    return emitted;
  };

  // The replica vouches for the current document whenever it changes.
  useEffect(() => {
    adopt(project);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  const [bridgeUrl, setBridgeUrl] = useState(
    () => localStorage.getItem(BRIDGE_KEY) ?? "http://localhost:8788",
  );
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opCount, setOpCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const fallbackFor = () => ({
    metadata: project.metadata,
    layers: project.layers,
    offGridParams: project.offGridParams,
    mcdaWeights: project.mcdaWeights,
  });

  const exportChanges = () => {
    const changeFile = buildChangeFile(doc, logRef.current, project.projectName);
    const blob = new Blob([JSON.stringify(changeFile, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.projectName.replace(/[^a-zA-Z0-9_-]+/g, "_")}.metardu-changes.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${changeFile.ops.length} operations as a change file — merge is idempotent on the far end.`);
  };

  const mergeOps = (ops: CrdtOp[], sourceLabel: string) => {
    const report = doc.merge(ops);
    logRef.current.push(...ops);
    const merged = docToProject(doc, fallbackFor());
    baseRef.current = merged;
    onApplyProject(merged);
    setOpCount(doc.opCount);
    setStatus(
      `Merged ${report.applied} ops from ${sourceLabel} ` +
      `(${report.ignored} duplicates skipped, ${report.rejected.length} rejected, ${report.removals} removals). ` +
      `Document now holds ${merged.points.length} stations.`,
    );
  };

  const onFilePicked = async (f: File | null) => {
    if (!f) return;
    setError(null);
    try {
      const changeFile = parseChangeFile(await f.text());
      mergeOps(changeFile.ops, `replica ${changeFile.replica}`);
    } catch (err) {
      setError(`Merge failed: ${(err as Error).message}`);
    }
  };

  const pullRelay = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${bridgeUrl.replace(/\/$/, "")}/ops?since=0`);
      if (!res.ok) throw new Error(`relay responded ${res.status}`);
      const body = await res.json();
      mergeOps(body.ops ?? [], "relay");
    } catch (err) {
      setError(
        `Relay pull failed: ${(err as Error).message}. Start the relay with: node bridge/sync-bridge.mjs 8788`,
      );
    } finally {
      setBusy(false);
    }
  };

  const pushRelay = async () => {
    setBusy(true);
    setError(null);
    try {
      const envelope = buildChangeFile(doc, logRef.current, project.projectName);
      const res = await fetch(`${bridgeUrl.replace(/\/$/, "")}/ops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelope),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `relay responded ${res.status}`);
      }
      const body = await res.json();
      setStatus(`Pushed ${body.accepted} ops to relay (${body.ignored} already known). Relay head at ${body.head}.`);
    } catch (err) {
      setError(`Relay push failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex bg-app">
      <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-auto">
        <div className="w-full max-w-[560px]">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-9 h-9 rounded-[3px] border border-line-strong bg-sunken flex items-center justify-center">
              <Users className="w-4.5 h-4.5 text-ink-2" />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold text-ink leading-tight">Edge sync</h2>
              <p className="text-[11px] text-ink-3 mt-0.5">
                CRDT over the project file — merge change files or relay ops; replicas converge offline.
              </p>
            </div>
          </div>

          {/* Replica card */}
          <div className="ui-card px-3 py-2.5 mb-3 flex items-center gap-3">
            <span className="ui-label">This replica</span>
            <span className="font-mono text-[12px] text-accent border border-line rounded-[3px] px-2 py-0.5">{replicaId}</span>
            <span className="text-[11px] text-ink-3 tnum ml-auto">
              {opCount || logRef.current.length} ops · clock {clockRef.current || doc.clock}
            </span>
          </div>

          <div className="ui-card divide-y divide-line mb-3">
            <ActionRow
              icon={FileOutput}
              title="Export change file"
              desc="The replica's op log as .metardu-changes.json — send by WhatsApp or email; merge is idempotent."
              action={
                <button onClick={exportChanges} className="ui-btn shrink-0">
                  <FileOutput className="w-3.5 h-3.5" />
                  <span>Export</span>
                </button>
              }
            />
            <ActionRow
              icon={FileInput}
              title="Merge change file"
              desc="Apply a colleague's change file — concurrent edits resolve deterministically, no server needed."
              action={
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(e) => onFilePicked(e.target.files?.[0] ?? null)}
                  />
                  <button onClick={() => fileRef.current?.click()} className="ui-btn shrink-0">
                    <FileInput className="w-3.5 h-3.5" />
                    <span>Merge…</span>
                  </button>
                </>
              }
            />
          </div>

          {/* Relay */}
          <div className="ui-card p-3 mb-3">
            <div className="flex items-center gap-2 mb-2">
              <Radio className="w-3.5 h-3.5 text-ink-2" />
              <span className="ui-label">LAN relay (optional)</span>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <input
                value={bridgeUrl}
                onChange={(e) => {
                  setBridgeUrl(e.target.value);
                  localStorage.setItem(BRIDGE_KEY, e.target.value);
                }}
                className="ui-input flex-1 text-[12px] font-mono"
                placeholder="http://192.168.1.20:8788"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={pullRelay} disabled={busy} className="ui-btn flex-1 justify-center disabled:opacity-50">
                <DownloadCloud className="w-3.5 h-3.5" />
                <span>Pull ops</span>
              </button>
              <button onClick={pushRelay} disabled={busy} className="ui-btn flex-1 justify-center disabled:opacity-50">
                <UploadCloud className="w-3.5 h-3.5" />
                <span>Push ops</span>
              </button>
            </div>
            <p className="text-[10.5px] text-ink-3 mt-2 leading-relaxed">
              The relay (bridge/sync-bridge.mjs) is memory-only infrastructure — authoritative
              state always lives on the replicas, so offline always works.
            </p>
          </div>

          {status && (
            <div className="flex items-start gap-2 text-[12px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-[3px] px-2.5 py-2">
              <GitMerge className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{status}</span>
            </div>
          )}
          {error && (
            <p className="text-[12px] text-red-400 bg-red-500/10 border border-red-500/30 rounded-[3px] px-2.5 py-2 mt-3">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

const ActionRow: React.FC<{
  icon: React.ElementType;
  title: string;
  desc: string;
  action: React.ReactNode;
}> = ({ icon: Icon, title, desc, action }) => (
  <div className="flex items-center gap-3 px-3 py-3">
    <Icon className="w-4 h-4 text-ink-2 shrink-0" />
    <div className="min-w-0 flex-1">
      <p className="text-[12.5px] text-ink font-medium">{title}</p>
      <p className="text-[11px] text-ink-3 leading-relaxed mt-0.5">{desc}</p>
    </div>
    {action}
  </div>
);
