export type BarShapeCode =
  | 'straight'     // Shape 00: Straight bar
  | 'l_bend'       // Shape 11: Single 90 bend (L-bar)
  | 'u_hook'       // Shape 21: U-hook / double bend
  | 'crank'        // Shape 41: Cranked / bent-up bar
  | 'stirrup_rect' // Shape 51: Rectangular link / tie / stirrup
  | 'chair';       // Chair support for top mesh

export type StructuralMemberType =
  | 'footing'
  | 'column'
  | 'beam'
  | 'slab'
  | 'staircase'
  | 'wall'
  | 'other';

export type GuidedWorkflowStep = 'scope' | 'catalog' | 'reinforcement' | 'takeoff';

export interface BoxCoords {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
}

export interface MemberDetectedGeometry {
  type: 'line' | 'rect' | 'polygon';
  start?: [number, number];            // CAD world coords for span start
  end?: [number, number];              // CAD world coords for span end
  boundaryPoints?: [number, number][]; // Polygon points for slab/column/footing
  lengthMm?: number;
  widthMm?: number;
  depthMm?: number;
  sourceConfidence: 'high' | 'approximate' | 'manual';
  notes?: string;
}

export interface AttachedRebarCallout {
  id: string;
  text: string;
  coords?: [number, number];
  role: 'main' | 'top_extra' | 'bottom_extra' | 'stirrup' | 'custom';
  count?: number;
  diameter: number;
  spacingMm?: number;
  lengthMm?: number;
  notes?: string;
}

export interface BeamCrossSectionInspection {
  mark?: string;
  widthMm?: number;
  depthMm?: number;
  topBars?: { count: number; diameter: number; notes?: string };
  bottomBars?: { count: number; diameter: number; notes?: string };
  stirrups?: { diameter: number; spacingMm: number; legs?: number; notes?: string };
  sourceText?: string;
}

export interface PendingSectionMatch {
  sectionTitle: string;
  sheetId?: string;
  confidence: number;
  status: 'pending' | 'confirmed' | 'rejected';
  widthMm?: number;
  depthMm?: number;
  topBars?: { count: number; diameter: number };
  topExtraBars?: { count: number; diameter: number; curtailmentRatio?: number };
  bottomBars?: { count: number; diameter: number };
  stirrups?: { diameter: number; spacingMm: number; supportSpacingMm?: number; legs?: number };
}

export interface CivilAuditAnomaly {
  memberMark: string;
  severity: 'error' | 'warning';
  codeClause: string;
  message: string;
}

export interface StructuralMemberDefinition {
  id: string;
  mark: string;                     // e.g. "B1-1", "B2-5", "B3-6", "B4-10", "B5-100", "C1"
  category: StructuralMemberType;
  floorLevel?: string;              // e.g. "Ground to 1st", "1st to 2nd", "All Floors"
  countOnLayout: number;            // Number of instances found on framing layout
  widthMm: number;                  // Cross-section width (or footing length)
  depthMm: number;                  // Cross-section depth (or footing width)
  thicknessMm?: number;             // Slab thickness or footing depth
  spanMm: number;                   // Clear span of beam / slab, or column floor height
  clearCoverMm: number;             // Concrete cover
  sizeSource?: 'schedule' | 'inline_text' | 'geometry' | 'manual';
  scheduleConflict?: {
    scheduleWidthMm: number;
    scheduleDepthMm: number;
  };
  mainBars?: {
    count: number;
    diameter: number;
    shape?: BarShapeCode;
    notes?: string;
  };
  secondaryBars?: {
    count: number;
    diameter: number;
    shape?: BarShapeCode;
    notes?: string;
  };
  topSupportExtraBars?: {
    count: number;
    diameter: number;
    curtailmentRatio?: number;      // e.g. 0.25L per IS 13920
  };
  stirrups?: {
    diameter: number;
    spacingMm: number;
    supportSpacingMm?: number;      // Confinement spacing (2d zone) per IS 13920
    legs?: number;                  // 2-legged, 4-legged
    notes?: string;
  };
  extraBars?: AttachedRebarCallout[];
  detectedGeometry?: MemberDetectedGeometry;
  pendingSectionMatch?: PendingSectionMatch;
  linkedLegendMark?: string;
  isVerifiedInLegend?: boolean;
  layerName?: string;
  notes?: string;
}

export interface BbsBarItem {
  id: string;
  memberId: string;           // e.g. "C1", "B-101", "F1"
  memberType: StructuralMemberType;
  floorLevel?: string;
  mark: string;               // e.g. "Main bottom", "Top extra", "Ties"
  diameter: number;           // mm, e.g. 8, 10, 12, 16, 20, 25, 32
  shape: BarShapeCode;
  dimA: number;               // Main leg length (mm)
  dimB?: number;              // Second leg / depth / width
  dimC?: number;              // Hook / return / third leg
  dimD?: number;              // Additional dimension
  cuttingLengthM: number;     // Calculated cutting length in meters
  numMembers: number;         // Count of members (e.g. 6 columns of C1)
  barsPerMember: number;      // Bars in 1 member (e.g. 8 bars or calculated from spacing)
  totalBars: number;          // numMembers * barsPerMember
  totalLengthM: number;       // totalBars * cuttingLengthM
  unitWeightKgM: number;      // d^2 / 162.28 kg/m
  totalWeightKg: number;      // totalLengthM * unitWeightKgM
  sourceSheetId?: string;
  sourceTextCoords?: [number, number];
  notes?: string;
}

export interface BbsMemberGroup {
  id: string;
  name: string;               // e.g. "C1 (300x450)", "B1 (230x450)"
  type: StructuralMemberType;
  floorLevel?: string;
  sheetId?: string;
  items: BbsBarItem[];
}

export type GeneralTableCategory =
  | 'structural'
  | 'door_window'
  | 'room_finish'
  | 'electrical'
  | 'plumbing'
  | 'general';

export interface ExtractedCadTable {
  id: string;
  sheetId?: string;
  title: string;
  headers: string[];
  rows: string[][];
  bbox?: {
    min_x: number;
    min_y: number;
    max_x: number;
    max_y: number;
  };
  detectedType?: StructuralMemberType | GeneralTableCategory;
  category?: GeneralTableCategory;
}

export type GeneralCadTable = ExtractedCadTable;

export interface LsSpanDefinition {
  id: string;
  beamMark: string; // e.g. "B1-1"
  clearSpanMm: number; // e.g. 3800
  centerToCenterSpanMm?: number; // physical CAD distance between column centers (e.g. 4100)
  widthMm: number; // e.g. 230
  depthMm: number; // e.g. 450
  supportColLeftMm?: number; // e.g. 300
  supportColRightMm?: number; // e.g. 400
  bottomCurtailedOverride?: { count: number; diameter: number; curtailRatio?: number };
  topExtraLeftOverride?: { count: number; diameter: number; extensionRatio?: number };
  topExtraRightOverride?: { count: number; diameter: number; extensionRatio?: number };
}

export interface LongitudinalSectionDefinition {
  id: string;
  name: string; // e.g. "BEAM B1 (GRID 1): B1-1 ~ B1-3"
  sheetId?: string;
  windowBox?: BoxCoords;
  spans: LsSpanDefinition[];
  reinforcement: {
    bottomContinuousBars?: { count: number; diameter: number };
    bottomCurtailedBars?: { count: number; diameter: number; curtailRatio?: number };
    topContinuousBars?: { count: number; diameter: number };
    supportTopExtraBars?: { count: number; diameter: number; extensionRatio?: number };
    stirrups?: {
      diameter: number;
      legs?: number;
      spacingEndMm: number;
      spacingMidMm: number;
      confinementZoneMm?: number;
    };
  };
  notes?: string;
}

export interface RebarTextCandidate {
  id: string;
  text: string;
  layer: string;
  x: number;
  y: number;
  count?: number;
  diameter?: number;
  spacingMm?: number;
  role?: 'main' | 'stirrup' | 'top' | 'bottom';
}

export interface DiameterSummary {
  diameter: number;
  totalBars: number;
  totalLengthM: number;
  unitWeightKgM: number;
  totalWeightKg: number;
  weightTonnes: number;
}

export interface StructuralEstimateState {
  workflowStep?: GuidedWorkflowStep;
  selectedScope?: StructuralMemberType;
  layoutSheetId?: string;
  scheduleSheetId?: string;
  layoutBoundingBox?: BoxCoords | null;
  activeLegendTableId?: string | null;
  definedMembers?: StructuralMemberDefinition[];
  members: BbsMemberGroup[];
  scheduleTables: ExtractedCadTable[];
  longitudinalSections?: LongitudinalSectionDefinition[];
  parameters: {
    wastagePct: number;               // e.g. 3% - 5%
    bindingWirePct: number;           // e.g. 1%
    steelRatePerKg: number;           // e.g. ₹68 / kg
    currency: string;                 // e.g. "₹", "$", "AED"
    maxStockLengthM?: number;         // Commercial bar length (default 12.0 m)
    allowedDiameters?: number[];      // Project allowed diameters e.g. [8, 10, 12, 16, 20, 25]
    concreteGrade?: string;           // e.g. "M25", "M30"
    steelGrade?: string;              // e.g. "Fe500", "Fe500D"
    lapLengthMultiplier?: number;     // e.g. 50 (50d per IS 456)
    hookAllowanceMultiplier?: number; // e.g. 24 (24d seismic 135° hooks) or 18 (90° hooks)
    defaultFloorHeightMm?: number;    // e.g. 3000 mm
    seismicDuctileDetailing?: boolean;// IS 13920 confinement zones
    defaultCoverMm: {
      footing: number;
      column: number;
      beam: number;
      slab: number;
    };
  };
  notes?: string;
}
