/**
 * GIS Field Calculator Engine
 * QGIS/ArcGIS Pro style attribute expression evaluator.
 * Allows safe computation of new or existing attribute fields based on geometric properties,
 * existing attributes, math functions, string functions, and conditionals.
 */

import { SurveyPoint, AttributeField } from "../types/spatial";

export interface FieldCalculatorConfig {
  fieldName: string;
  isNewField: boolean;
  fieldType: "string" | "number" | "boolean";
  expression: string;
  targetPointIds?: string[]; // If undefined, applies to all points
}

export interface FieldCalculatorResult {
  updatedPoints: SurveyPoint[];
  modifiedCount: number;
  error?: string;
}

export interface ExpressionPreset {
  id: string;
  label: string;
  category: "Geometry" | "String" | "Conditional" | "Survey";
  expression: string;
  targetField: string;
  fieldType: "string" | "number" | "boolean";
  description: string;
}

export const EXPRESSION_PRESETS: ExpressionPreset[] = [
  {
    id: "coord-label",
    label: "Coordinate Label",
    category: "String",
    expression: "concat($id, ' (E:', round($x, 1), ', N:', round($y, 1), ')')",
    targetField: "label",
    fieldType: "string",
    description: "Combines station ID and rounded Easting/Northing coordinates.",
  },
  {
    id: "easting-km",
    label: "Easting in Kilometers",
    category: "Geometry",
    expression: "round($x / 1000, 3)",
    targetField: "easting_km",
    fieldType: "number",
    description: "Converts Easting meters to kilometers.",
  },
  {
    id: "northing-km",
    label: "Northing in Kilometers",
    category: "Geometry",
    expression: "round($y / 1000, 3)",
    targetField: "northing_km",
    fieldType: "number",
    description: "Converts Northing meters to kilometers.",
  },
  {
    id: "elevation-class",
    label: "Elevation Classification",
    category: "Conditional",
    expression: "if($z >= 1650, 'Highland (>1650m)', 'Valley (<1650m)')",
    targetField: "elevation_tier",
    fieldType: "string",
    description: "Categorizes points based on MSL elevation.",
  },
  {
    id: "corridor-buffer",
    label: "Corridor Setback Radius",
    category: "Survey",
    expression: "if($code == 'RD_CL', 15, if($code == 'RIV_CL', 30, 5))",
    targetField: "buffer_m",
    fieldType: "number",
    description: "Assigns statutory setback buffer based on road (15m) or riparian (30m) feature codes.",
  },
  {
    id: "uppercase-code",
    label: "Uppercase Clean Code",
    category: "String",
    expression: "upper($code)",
    targetField: "clean_code",
    fieldType: "string",
    description: "Ensures feature code is normalized uppercase.",
  },
];

/**
 * Safely evaluates an expression against a single survey point
 */
export function evaluateExpression(
  expression: string,
  pt: SurveyPoint,
  index: number
): any {
  // Built-in environment for safe execution
  const env: Record<string, any> = {
    // Geometric variables
    $x: pt.easting,
    $y: pt.northing,
    $z: pt.elevation,
    $id: pt.id,
    $code: pt.rawCode,
    $cat: pt.category,
    $desc: pt.description,
    $lat: pt.latitude ?? 0,
    $lon: pt.longitude ?? 0,
    $index: index + 1,
    $rownum: index + 1,

    // Math functions
    abs: Math.abs,
    round: (val: number, decimals: number = 0) => {
      const factor = Math.pow(10, decimals);
      return Math.round(val * factor) / factor;
    },
    floor: Math.floor,
    ceil: Math.ceil,
    sqrt: Math.sqrt,
    pow: Math.pow,
    min: Math.min,
    max: Math.max,

    // String functions
    concat: (...args: any[]) => args.join(""),
    upper: (s: any) => String(s ?? "").toUpperCase(),
    lower: (s: any) => String(s ?? "").toLowerCase(),
    trim: (s: any) => String(s ?? "").trim(),
    substr: (s: any, start: number, length?: number) =>
      String(s ?? "").substring(start, length !== undefined ? start + length : undefined),

    // Conditional functions
    __if: (cond: boolean, trueVal: any, falseVal: any) => (cond ? trueVal : falseVal),
    iff: (cond: boolean, trueVal: any, falseVal: any) => (cond ? trueVal : falseVal),
  };

  // Populate point properties into environment (skipping JS reserved words)
  const reservedWords = new Set(["break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "export", "extends", "finally", "for", "function", "if", "import", "in", "instanceof", "new", "return", "super", "switch", "this", "throw", "try", "typeof", "var", "void", "while", "with", "yield"]);
  if (pt.properties) {
    for (const [key, val] of Object.entries(pt.properties)) {
      if (!reservedWords.has(key) && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)) {
        env[key] = val;
      }
    }
  }

  // Pre-process expression: replace [field_name] with field_name and if() with __if()
  let sanitized = expression
    .replace(/\[([a-zA-Z0-9_-]+)\]/g, "$1")
    .replace(/\bif\s*\(/gi, "__if(");

  // Create function from sanitized expression using Function constructor with restricted scope
  const argNames = Object.keys(env);
  const argValues = Object.values(env);

  try {
    const fn = new Function(...argNames, `return (${sanitized});`);
    return fn(...argValues);
  } catch (err: any) {
    throw new Error(`Expression error: ${err.message || String(err)}`);
  }
}

/**
 * Executes a field calculator configuration over a dataset of survey points
 */
export function executeFieldCalculator(
  points: SurveyPoint[],
  config: FieldCalculatorConfig
): FieldCalculatorResult {
  const targetName = config.fieldName.trim();
  if (!targetName) {
    return { updatedPoints: points, modifiedCount: 0, error: "Field name cannot be blank." };
  }

  // Check if trying to overwrite reserved geometry fields
  const coreFields = ["id", "easting", "northing", "elevation", "rawCode", "category"];
  const isCore = coreFields.includes(targetName);

  const targetSet = config.targetPointIds && config.targetPointIds.length > 0
    ? new Set(config.targetPointIds)
    : null;

  const updatedPoints: SurveyPoint[] = [];
  let modifiedCount = 0;

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];

    // If target subset specified and point not in subset, preserve as is
    if (targetSet && !targetSet.has(pt.id)) {
      updatedPoints.push(pt);
      continue;
    }

    try {
      const rawVal = evaluateExpression(config.expression, pt, i);
      let castVal: any = rawVal;

      if (config.fieldType === "number") {
        castVal = Number(rawVal);
        if (isNaN(castVal)) castVal = 0;
      } else if (config.fieldType === "boolean") {
        castVal = Boolean(rawVal);
      } else {
        castVal = rawVal !== undefined && rawVal !== null ? String(rawVal) : "";
      }

      // If updating a core field
      if (isCore) {
        const updated: any = { ...pt };
        if (targetName === "rawCode") {
          updated.rawCode = String(castVal);
        } else if (targetName === "elevation") {
          updated.elevation = Number(castVal);
        } else if (targetName === "easting") {
          updated.easting = Number(castVal);
        } else if (targetName === "northing") {
          updated.northing = Number(castVal);
        } else if (targetName === "id") {
          updated.id = String(castVal);
        }
        updatedPoints.push(updated);
      } else {
        // Update custom properties
        const newProperties = { ...(pt.properties || {}), [targetName]: castVal };
        updatedPoints.push({
          ...pt,
          properties: newProperties,
        });
      }

      modifiedCount++;
    } catch (err: any) {
      return {
        updatedPoints: points,
        modifiedCount: 0,
        error: `Calculation failed at row ${i + 1} (${pt.id}): ${err.message}`,
      };
    }
  }

  return {
    updatedPoints,
    modifiedCount,
  };
}
