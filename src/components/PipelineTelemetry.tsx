import React from "react";
import { CheckCircle, AlertCircle, Cpu } from "lucide-react";
import { PipelineTelemetry } from "../types/spatial";

interface PipelineTelemetryProps {
  telemetries: PipelineTelemetry[];
  totalDurationMs: number;
}

export const PipelineTelemetryBar: React.FC<PipelineTelemetryProps> = ({
  telemetries,
  totalDurationMs,
}) => {
  return (
    <div className="bg-[#080C14] border-b border-slate-800 px-4 py-1.5 flex items-center gap-4 text-xs font-mono overflow-x-auto">
      <div className="flex items-center gap-1.5 text-slate-400 shrink-0 font-semibold">
        <Cpu className="w-3.5 h-3.5 text-blue-400" />
        <span>PIPELINE TELEMETRY:</span>
      </div>

      <div className="flex items-center gap-3 overflow-x-auto py-0.5">
        {telemetries.map((t, idx) => (
          <div
            key={idx}
            className="flex items-center gap-1.5 shrink-0 bg-slate-900/80 px-2 py-0.5 rounded border border-slate-800 text-[11px]"
            title={t.details}
          >
            {t.status === "pass" ? (
              <CheckCircle className="w-3 h-3 text-emerald-400" />
            ) : (
              <AlertCircle className="w-3 h-3 text-amber-400" />
            )}
            <span className="text-slate-300">{t.stepName.split(". ")[1] || t.stepName}</span>
            <span className="text-blue-400 font-bold">{t.durationMs}ms</span>
          </div>
        ))}
      </div>

      <div className="ml-auto shrink-0 text-slate-400">
        Total: <span className="text-emerald-400 font-bold">{totalDurationMs}ms</span>
      </div>
    </div>
  );
};