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

export interface StructuralMemberDefinition {
  id: string;
  mark: string;                     // e.g. "C1", "B-101", "F1", "S1"
  category: StructuralMemberType;
  floorLevel?: string;              // e.g. "Ground to 1st", "1st to 2nd", "All Floors"
  countOnLayout: number;            // Number of instances found on framing layout
  widthMm: number;                  // Cross-section width (or footing length)
  depthMm: number;                  // Cross-section depth (or footing width)
  thicknessMm?: number;             // Slab thickness or footing depth
  spanMm: number;                   // Clear span of beam / slab, or column floor height
  clearCoverMm: number;             // Concrete cover
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
  stirrups?: {
    diameter: number;
    spacingMm: number;
    legs?: number;                  // 2-legged, 4-legged
    notes?: string;
  };
  extraBars?: AttachedRebarCallout[];
  detectedGeometry?: MemberDetectedGeometry;
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
  detectedType?: StructuralMemberType;
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
  parameters: {
    wastagePct: number;        // e.g. 3% - 5%
    bindingWirePct: number;    // e.g. 1%
    steelRatePerKg: number;    // e.g. $0.85 or ₹75
    currency: string;          // e.g. "$", "₹", "€", "£"
    defaultCoverMm: {
      footing: number;
      column: number;
      beam: number;
      slab: number;
    };
  };
  notes?: string;
}
