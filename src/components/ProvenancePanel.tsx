/**
 * Provenance Panel — statutory audit view of the machine-readable provenance
 * graph (src/core/provenance.ts). Reviewers can verify HOW every exported
 * figure was produced: its method, its inputs, and its stated tolerance.
 */

import React, { useMemo, useState } from "react";
import { Download, Fingerprint, ChevronRight, Landmark, Cog, Sigma } from "lucide-react";
import { PipelineResult } from "../types/spatial";
import {
  buildProvenanceGraph,
  serializeProvenance,
  ProvenanceNode,
} from "../core/provenance";

interface ProvenancePanelProps {
  result: PipelineResult;
}

const KindIcon: React.FC<{ kind: ProvenanceNode["kind"] }> = ({ kind }) => {
  const Icon = kind === "source" ? Landmark : kind === "process" ? Cog : Sigma;
  return <Icon className="w-3.5 h-3.5 text-ink-2 shrink-0" />;
};

export const ProvenancePanel: React.FC<ProvenancePanelProps> = ({ result }) => {
  const graph = useMemo(() => buildProvenanceGraph(result), [result]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const sources = graph.nodes.filter((n) => n.kind === "source");
  const processes = graph.nodes.filter((n) => n.kind === "process");
  const figures = graph.nodes.filter((n) => n.kind === "figure");

  const resolveLabel = (id: string) => {
    const node = graph.nodes.find((n) => n.id === id);
    if (!node) return id;
    return node.kind === "process" ? node.label.replace(/^\d+\.\s*/, "") : node.label;
  };

  const downloadJson = () => {
    const blob = new Blob([serializeProvenance(graph)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Provenance_${result.metadata.title.replace(/\s+/g, "_")}_${graph.digest}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyDigest = () => {
    navigator.clipboard?.writeText(graph.digest).catch(() => {});
  };

  return (
    <div className="h-full flex bg-app">
      {/* Register rail */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-[880px] mx-auto p-5">
          {/* Digest header */}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-[3px] border border-line-strong bg-sunken flex items-center justify-center shrink-0">
              <Fingerprint className="w-4.5 h-4.5 text-accent" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-[14px] font-semibold text-ink leading-tight">Provenance register</h2>
              <p className="text-[11px] text-ink-3 mt-0.5">
                Every exported figure carries its method, inputs and stated tolerance — verifiable, not asserted.
              </p>
            </div>
            <button onClick={downloadJson} className="ui-btn shrink-0">
              <Download className="w-3.5 h-3.5" />
              <span>Export JSON</span>
            </button>
          </div>

          <div className="ui-card px-3 py-2 mb-4 flex items-center gap-3 flex-wrap">
            <span className="ui-label">Integrity digest</span>
            <button
              onClick={copyDigest}
              title="Copy digest"
              className="font-mono text-[12px] text-accent bg-transparent border border-line rounded-[3px] px-2 py-0.5 hover:border-accent transition-colors"
            >
              {graph.digest}
            </button>
            <span className="text-[11px] text-ink-3 tnum">
              {graph.nodes.length} nodes · {figures.length} audited figures · {graph.format} {graph.version}
            </span>
            <span className="text-[11px] text-ink-3 ml-auto tnum">
              Any change to inputs, weights or results changes the digest.
            </span>
          </div>

          {/* Figures — the audit target */}
          <SectionTitle icon={<Sigma className="w-3.5 h-3.5" />} label={`Figures (${figures.length})`} />
          <div className="ui-card divide-y divide-line mb-4">
            {figures.length === 0 && (
              <p className="px-3 py-3 text-[12px] text-ink-3">
                No figures yet — run the pipeline to populate the register.
              </p>
            )}
            {figures.map((n) => {
              const open = expanded === n.id;
              return (
                <div key={n.id}>
                  <button
                    onClick={() => setExpanded(open ? null : n.id)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-raised/60 transition-colors text-left"
                  >
                    <ChevronRight
                      className={`w-3.5 h-3.5 text-ink-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
                    />
                    <KindIcon kind={n.kind} />
                    <span className="text-[12.5px] text-ink font-medium whitespace-nowrap">{n.label}</span>
                    <span className="text-[12px] text-ink-2 tnum truncate flex-1">{n.value}</span>
                    <span className="text-[10px] text-ink-3 uppercase tracking-wide shrink-0 hidden sm:inline">
                      {n.methodId}
                    </span>
                  </button>
                  {open && (
                    <div className="px-3 pb-3 pt-1 ml-[46px] border-l border-line-strong space-y-2">
                      <ProvRow label="Method" value={n.methodCitation ?? "—"} />
                      <ProvRow
                        label="Inputs"
                        value={(n.inputs ?? []).map(resolveLabel).join(" → ") || "—"}
                      />
                      <ProvRow label="Tolerance" value={n.tolerance ?? "—"} accent />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Sources */}
          <SectionTitle icon={<Landmark className="w-3.5 h-3.5" />} label={`Sources (${sources.length})`} />
          <div className="ui-card divide-y divide-line mb-4">
            {sources.map((n) => (
              <div key={n.id} className="flex items-start gap-2.5 px-3 py-2">
                <KindIcon kind={n.kind} />
                <div className="min-w-0">
                  <p className="text-[12.5px] text-ink font-medium">{n.label}</p>
                  <p className="text-[11.5px] text-ink-2">{n.origin}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Processes */}
          <SectionTitle icon={<Cog className="w-3.5 h-3.5" />} label={`Processes (${processes.length})`} />
          <div className="ui-card divide-y divide-line">
            {processes.map((n) => (
              <div key={n.id} className="flex items-center gap-2.5 px-3 py-1.5">
                <KindIcon kind={n.kind} />
                <span className="text-[12px] text-ink truncate">{n.label}</span>
                <span className="text-[11px] text-ink-3 tnum ml-auto shrink-0">
                  {n.durationMs !== undefined ? `${n.durationMs} ms` : "—"}
                </span>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-ink-3 mt-3 leading-relaxed">
            This register is embedded in every export: GeoJSON foreign member, LandXML comment block,
            GeoPackage <span className="font-mono">mr_provenance</span> attributes table, and the
            <span className="font-mono"> .metardu.json</span> project file. A compact register can be
            placed on any composer sheet via the “Provenance” table element.
          </p>
        </div>
      </div>
    </div>
  );
};

const SectionTitle: React.FC<{ icon: React.ReactNode; label: string }> = ({ icon, label }) => (
  <div className="flex items-center gap-2 mb-1.5 mt-1">
    <span className="text-ink-3">{icon}</span>
    <span className="ui-label">{label}</span>
    <div className="flex-1 h-px bg-line" />
  </div>
);

const ProvRow: React.FC<{ label: string; value: string; accent?: boolean }> = ({ label, value, accent }) => (
  <div className="flex gap-2">
    <span className="text-[10px] uppercase tracking-wide text-ink-3 w-16 shrink-0 pt-0.5">{label}</span>
    <span className={`text-[11.5px] leading-snug ${accent ? "text-ink" : "text-ink-2"}`}>{value}</span>
  </div>
);
