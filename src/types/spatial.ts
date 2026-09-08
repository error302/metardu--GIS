export type FeatureCategory =
  | "control"
  | "boundary"
  | "building"
  | "road"
  | "utility"
  | "water"
  | "vegetation"
  | "terrain"
  | "settlement"
  | "energy";

export interface SurveyPoint {
  id: string;
  easting: number;
  northing: number;
  elevation: number;
  rawCode: string;
  category: FeatureCategory;
  description: string;
  ellipsoidHeight?: number;
  geoidN?: number;
  latitude?: number;
  longitude?: number;
  timestamp?: string;
  accuracyM?: number;
}

export interface BearingDistance {
  fromId: string;
  toId: string;
  bearingDeg: number;
  bearingDms: string;
  distanceM: number;
}

export interface SurveyVector {
  id: string;
  code: string;
  name: string;
  category: FeatureCategory;
  layer: string;
  points: SurveyPoint[];
  isClosed: boolean;
  color: string;
  lineType: "solid" | "dashed" | "dotted" | "dashdot";
  lineWidth: number;
}

export interface BoundaryPolygon {
  id: string;
  name: string;
  parcelNo: string;
  points: SurveyPoint[];
  perimeterM: number;
  areaSqM: number;
  areaHa: number;
  areaAcres: number;
  isClosed: boolean;
  linearMisclosureM: number;
  precisionRatio: number;
  precisionRating: "Class A (Urban)" | "Class B (Rural)" | "Sub-Standard";
  bearingsDistances: BearingDistance[];
}

export interface TinTriangle {
  p1: SurveyPoint;
  p2: SurveyPoint;
  p3: SurveyPoint;
  normal: [number, number, number];
  slopePercent: number;
  aspectDeg: number;
}

export interface TinMesh {
  vertices: SurveyPoint[];
  triangles: TinTriangle[];
  minZ: number;
  maxZ: number;
  meanSlopePercent: number;
  cutVolumeM3: number;
  fillVolumeM3: number;
  datumElevation: number;
}

export interface ContourLine {
  elevation: number;
  isMajor: boolean;
  points: [number, number][];
}

export interface CorridorBuffer {
  id: string;
  sourceFeatureId: string;
  featureName: string;
  reserveWidthM: number;
  leftOffset: [number, number][];
  rightOffset: [number, number][];
  areaSqM: number;
  encroachmentDetected: boolean;
}

export interface McdaWeights {
  slopeWeight: number; // 0-100
  roadAccessWeight: number; // 0-100
  waterBufferWeight: number; // 0-100
  socialInfraWeight: number; // 0-100
  maxSlopeAllowed: number; // %
  riparianBufferM: number; // meters
}

export interface SuitabilityCell {
  x: number;
  y: number;
  score: number; // 0 - 100
  category: "optimal" | "suitable" | "moderate" | "restricted" | "hazard";
  slope: number;
  distToRoadM: number;
  distToRiverM: number;
  distToInfraM: number;
}

export interface HazardSink {
  id: string;
  center: [number, number];
  minElevation: number;
  spillElevation: number;
  depthM: number;
  pondingAreaSqM: number;
  riskLevel: "low" | "medium" | "high" | "critical";
}

export interface ExposedAsset {
  id: string;
  name: string;
  type: "settlement" | "infrastructure" | "clinic" | "school" | "water_point" | "road";
  coordinate: [number, number];
  elevation: number;
  hazardRisk: "critical" | "high" | "moderate" | "safe";
  distanceToSinkM: number;
}

export interface EnergyCluster {
  id: string;
  centroid: [number, number];
  householdCount: number;
  populationEstimate: number;
  clusterRadiusM: number;
  gridDistanceKm: number;
  solarGhiKwhM2: number;
  recommendedType: "Mini-Grid" | "Stand-Alone SHS" | "Grid Extension";
  dailyDemandKwh: number;
  recommendedSolarKw: number;
  nightTimeLuminosity: "Dark (Unserved)" | "Dim" | "Bright (Electrified)";
}

export interface PipelineTelemetry {
  stepName: string;
  durationMs: number;
  status: "pass" | "warn" | "fail";
  details: string;
}

export interface ProjectMetadata {
  id: string;
  title: string;
  locality: string;
  country: string;
  crs: string;
  surveyorName: string;
  registrationNo: string;
  date: string;
  scale: string;
  organization: string;
}

export interface PipelineResult {
  metadata: ProjectMetadata;
  points: SurveyPoint[];
  vectors: SurveyVector[];
  boundary: BoundaryPolygon | null;
  tin: TinMesh | null;
  contours: ContourLine[];
  buffers: CorridorBuffer[];
  suitability: SuitabilityCell[];
  hazardSinks: HazardSink[];
  exposedAssets: ExposedAsset[];
  energyClusters: EnergyCluster[];
  telemetries: PipelineTelemetry[];
  totalDurationMs: number;
}