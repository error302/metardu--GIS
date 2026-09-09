/**
 * Traverse Diagnostics — plain-language misclosure interpretation.
 *
 * Turns the numeric Bowditch adjustment report into sentences a field crew
 * can act on: what closed, what failed, which leg carries the largest
 * correction, and which axis the error leans toward. Every sentence is
 * derived from the report — nothing is asserted that the numbers do not show.
 */

import { TraverseAdjustmentReport, TraverseLeg } from "./traverse-adjust";

export type DiagnosticSeverity = "ok" | "info" | "warning" | "critical";

export interface TraverseDiagnostic {
  severity: DiagnosticSeverity;
  title: string;
  detail: string;
}

export interface TraverseNarrative {
  /** One-paragraph plain-language summary for the field crew / reviewer. */
  summary: string;
  diagnostics: TraverseDiagnostic[];
  /** Leg with the largest absolute correction (the usual suspect). */
  worstLeg: TraverseLeg | null;
}

const fmtM = (n: number, d = 3) =>
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Compass-point approximation of an error vector, for plain language. */
function errorDirection(e: number, n: number): string {
  const mag = Math.hypot(e, n);
  if (mag < 1e-9) return "exactly on target";
  const deg = (Math.atan2(e, n) * 180) / Math.PI; // 0 = north, 90 = east
  const dirs = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  const idx = Math.round(((deg + 360) % 360) / 45) % 8;
  return `${dirs[idx]} (${fmtM(Math.abs(e), 3)} m ${e >= 0 ? "east" : "west"}, ${fmtM(Math.abs(n), 3)} m ${n >= 0 ? "north" : "south"})`;
}

export function describeTraverse(report: TraverseAdjustmentReport): TraverseNarrative {
  const diagnostics: TraverseDiagnostic[] = [];
  const tolerance = report.standardToleranceRatio;

  /* 1. Headline: closed or failed against the chosen class. */
  const passed = report.status === "PASSED";
  diagnostics.push({
    severity: passed ? "ok" : "critical",
    title: passed ? "Precision accepted" : "Precision requirement exceeded",
    detail: passed
      ? `The traverse closed at ${report.precisionFraction}, which is tighter than the 1:${tolerance.toLocaleString("en-US")} requirement for this survey class. The adjusted coordinates are fit for lodgement.`
      : `The traverse closed at ${report.precisionFraction}, which is coarser than the 1:${tolerance.toLocaleString("en-US")} requirement for this survey class. Re-observe the flagged legs before lodgement — do not adjust past a failing misclosure.`,
  });

  /* 2. Magnitude in human units. */
  const cm = report.linearMisclosureM * 100;
  diagnostics.push({
    severity: report.linearMisclosureM < 0.05 ? "ok" : report.linearMisclosureM < 0.2 ? "info" : "warning",
    title: "Linear misclosure",
    detail: `The traverse missed its closing point by ${fmtM(report.linearMisclosureM)} m (${cm.toFixed(1)} cm) over a ${fmtM(report.totalPerimeterM, 2)} m perimeter — ${errorDirection(report.misclosureE, report.misclosureN)} of where it should have landed.`,
  });

  /* 3. Axis bias: does the error lean east-west or north-south? */
  const absE = Math.abs(report.misclosureE);
  const absN = Math.abs(report.misclosureN);
  const dominant = Math.max(absE, absN);
  const minor = Math.min(absE, absN);
  if (report.linearMisclosureM > 0 && dominant > minor * 2 && dominant > 0.001) {
    const axis = absE > absN ? "east–west" : "north–south";
    diagnostics.push({
      severity: "info",
      title: `Error leans ${axis}`,
      detail:
        absE > absN
          ? `Most of the misclosure is in the east–west axis (${fmtM(absE)} m of ${fmtM(report.linearMisclosureM)} m). On a compass traverse this usually points to a bearing or distance error on a predominantly east–west leg — check those observations first.`
          : `Most of the misclosure is in the north–south axis (${fmtM(absN)} m of ${fmtM(report.linearMisclosureM)} m). On a compass traverse this usually points to a bearing or distance error on a predominantly north–south leg — check those observations first.`,
    });
  }

  /* 4. Worst leg: largest absolute correction vector. */
  let worstLeg: TraverseLeg | null = null;
  let worstMag = -1;
  for (const leg of report.legs) {
    const mag = Math.hypot(leg.corrE, leg.corrN);
    if (mag > worstMag) {
      worstMag = mag;
      worstLeg = leg;
    }
  }
  if (worstLeg && worstMag > 0) {
    diagnostics.push({
      severity: passed ? "info" : "warning",
      title: "Largest correction",
      detail: `Leg ${worstLeg.fromId} → ${worstLeg.toId} received the largest adjustment: ${fmtM(worstLeg.corrE)} m east, ${fmtM(worstLeg.corrN)} m north (${(worstMag * 100).toFixed(1)} cm). ${passed ? "This is within tolerance, but if the traverse were to fail, this leg is where re-observation would pay off first." : "Start the re-observation here."}`,
    });
  }

  /* 5. Method disclosure (what the adjustment did, in one sentence). */
  diagnostics.push({
    severity: "info",
    title: `Adjustment method — ${report.method}`,
    detail: `Corrections were distributed in proportion to leg length (Bowditch / compass rule), so longer legs absorb proportionally more of the misclosure. Angles were held; only positions were adjusted. Acceptance threshold: 1:${tolerance.toLocaleString("en-US")}.`,
  });

  /* 6. Summary paragraph. */
  const summary = passed
    ? `Closed traverse of ${report.legs.length} legs and ${fmtM(report.totalPerimeterM, 2)} m perimeter, misclosure ${fmtM(report.linearMisclosureM)} m (${report.precisionFraction}) — passes the 1:${tolerance.toLocaleString("en-US")} ${report.method} requirement.${worstLeg ? ` Largest correction on ${worstLeg.fromId} → ${worstLeg.toId}.` : ""}`
    : `Closed traverse of ${report.legs.length} legs and ${fmtM(report.totalPerimeterM, 2)} m perimeter, misclosure ${fmtM(report.linearMisclosureM)} m (${report.precisionFraction}) — FAILS the 1:${tolerance.toLocaleString("en-US")} ${report.method} requirement. Re-observe before lodgement.`;

  return { summary, diagnostics, worstLeg };
}
