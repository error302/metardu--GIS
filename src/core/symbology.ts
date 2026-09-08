/**
 * GIS Symbology Engine (QGIS / ArcGIS Pro Parity)
 * Supports Single Symbol, Categorized (by field), and Graduated (by numeric ranges) styling.
 */

export type SymbologyType = "single" | "categorized" | "graduated";

export interface SymbolStyle {
  color: string;
  fillColor?: string;
  fillOpacity?: number;
  strokeColor?: string;
  strokeWidth?: number;
  strokeDash?: number[];
  pointRadius?: number;
  pointShape?: "circle" | "square" | "triangle" | "cross";
}

export interface CategorizedRule {
  value: string;
  label: string;
  style: SymbolStyle;
}

export interface GraduatedRule {
  min: number;
  max: number;
  label: string;
  style: SymbolStyle;
}

export interface LayerSymbology {
  type: SymbologyType;
  field?: string;
  defaultStyle: SymbolStyle;
  categorizedRules?: CategorizedRule[];
  graduatedRules?: GraduatedRule[];
}

/** Color ramps for thematic and graduated maps */
export const COLOR_RAMPS = {
  viridis: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"],
  magma: ["#000004", "#51127c", "#b73779", "#fb8861", "#fcfdbf"],
  spectral: ["#9e0142", "#d53e4f", "#fee08b", "#e6f598", "#66c2a5", "#5e4fa2"],
  blues: ["#eff3ff", "#bdd7e7", "#6baed6", "#3182bd", "#08519c"],
  greens: ["#edf8e9", "#bae4b3", "#74c476", "#31a354", "#006d2c"],
  reds: ["#fee5d9", "#fcae91", "#fb6a4a", "#de2d26", "#a50f15"],
  amber: ["#fffbeb", "#fde68a", "#f59e0b", "#d97706", "#92400e"],
};

/** Resolves the concrete styling for an item given its attribute value and layer symbology */
export function resolveSymbolStyle(symbology: LayerSymbology, featureVal?: any): SymbolStyle {
  if (symbology.type === "single" || featureVal === undefined || featureVal === null) {
    return symbology.defaultStyle;
  }

  if (symbology.type === "categorized" && symbology.categorizedRules) {
    const strVal = String(featureVal).toLowerCase();
    const rule = symbology.categorizedRules.find(
      (r) => String(r.value).toLowerCase() === strVal
    );
    return rule ? rule.style : symbology.defaultStyle;
  }

  if (symbology.type === "graduated" && symbology.graduatedRules) {
    const num = Number(featureVal);
    if (!isNaN(num)) {
      const rule = symbology.graduatedRules.find((r) => num >= r.min && num < r.max);
      return rule ? rule.style : symbology.defaultStyle;
    }
  }

  return symbology.defaultStyle;
}

/** Helper to generate graduated quantile/equal-interval rules */
export function createGraduatedRules(
  minVal: number,
  maxVal: number,
  classes: number = 5,
  ramp: keyof typeof COLOR_RAMPS = "viridis"
): GraduatedRule[] {
  const colors = COLOR_RAMPS[ramp] || COLOR_RAMPS.viridis;
  const step = (maxVal - minVal) / classes;
  const rules: GraduatedRule[] = [];

  for (let i = 0; i < classes; i++) {
    const cMin = Number((minVal + i * step).toFixed(2));
    const cMax = Number((i === classes - 1 ? maxVal : minVal + (i + 1) * step).toFixed(2));
    const colorIndex = Math.min(colors.length - 1, Math.floor((i / classes) * colors.length));
    const color = colors[colorIndex];

    rules.push({
      min: cMin,
      max: cMax,
      label: `${cMin} – ${cMax}`,
      style: {
        color,
        fillColor: color,
        fillOpacity: 0.6,
        strokeColor: "#ffffff",
        strokeWidth: 1,
        pointRadius: 3 + i,
      },
    });
  }

  return rules;
}
