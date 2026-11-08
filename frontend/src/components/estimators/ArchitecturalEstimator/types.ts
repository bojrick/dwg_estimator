export type FloorFinishType = 'vitrified_tile' | 'marble' | 'granite' | 'wooden' | 'concrete';
export type BlockType = 'aac' | 'clay_brick' | 'concrete_block';
export type OpeningType = 'door' | 'window' | 'ventilator';

export type RoomDerivationMethod =
  | 'cad_polygon'
  | 'cad_dims'
  | 'wall_enclosure'
  | 'user_picked'
  | 'manual';

export interface RoomDefinition {
  id: string;
  name: string;
  areaM2: number;
  perimeterM: number;
  floorFinish: FloorFinishType;
  included?: boolean; // default true; false excludes room from takeoff
  widthM?: number;
  lengthM?: number;
  derivationMethod?: RoomDerivationMethod;
  dimensionText?: string;
  sourceLayer?: string;
  isVerified?: boolean;
  bbox?: { min_x: number; min_y: number; max_x: number; max_y: number };
  boundaryPolygon?: [number, number][]; // Exact polygon vertices in CAD world coordinates
  parapetLengthM?: number; // Length of boundary formed by parapet walls
  isParapetEnclosed?: boolean; // True if room is a balcony / terrace bounded by parapet
}

export interface OpeningDefinition {
  id: string;
  mark: string; // e.g. D1, D2, W1
  type: OpeningType;
  widthM: number;
  heightM: number;
  count: number;
  description?: string;
  included?: boolean; // default true
  unitRate?: number; // rate per unit (₹/no)
  sourceLayer?: string;
}

export interface ArchitecturalParameters {
  floorHeightM: number;
  extWallLengthM: number;
  intWallLengthM: number;
  extWallThicknessM: number;
  intWallThicknessM: number;
  blockType: BlockType;
  blockLengthMm: number;
  blockHeightMm: number;
  blockWidthMm: number;
  mortarJointMm: number;
  wastagePct: number;
  internalPlasterThicknessMm: number;
  externalPlasterThicknessMm: number;
  masonryRatePerM3: number;
  plasterRatePerM2: number;
  paintRatePerM2: number;
  flooringRatePerM2: number;
  doorRatePerM2?: number;
  windowRatePerM2?: number;
  parapetWallHeightM?: number; // e.g. 1.0m for balcony/terrace parapet
  parapetWallThicknessM?: number; // e.g. 0.115m (4.5")
  parapetWallLengthM?: number; // total parapet length across sheet
  parapetMasonryRatePerM3?: number;
  currency: string;
}

export interface OpeningScheduleRow {
  id: string;
  mark: string;
  type: OpeningType;
  description: string;
  sizeLabel: string;
  widthM: number;
  heightM: number;
  unitAreaM2: number;
  count: number;
  totalAreaM2: number;
  unitRate: number;
  amount: number;
}

export interface MaterialOrderQuantity {
  id: string;
  category: 'masonry' | 'cement' | 'sand' | 'flooring' | 'paint' | 'openings';
  item: string;
  netQuantity: number;
  netUnit: string;
  orderQuantity: number;
  commercialUnit: string;
  specification: string;
  estimatedCost: number;
}

export interface ArchTakeoffSummary {
  grossWallAreaM2: number;
  totalOpeningsAreaM2: number;
  netExtWallAreaM2: number;
  netIntWallAreaM2: number;
  extMasonryVolumeM3: number;
  intMasonryVolumeM3: number;
  parapetMasonryVolumeM3?: number;
  parapetWallLengthM?: number;
  totalMasonryVolumeM3: number;
  singleBlockVolumeM3: number;
  totalBlocksRequired: number;
  internalPlasterAreaM2: number;
  externalPlasterAreaM2: number;
  ceilingPlasterAreaM2: number;
  totalFlooringAreaM2: number;
  totalSkirtingLengthM: number;
  doorsCount: number;
  windowsCount: number;
  ventilatorsCount: number;
  openingsCost: number;
  openingSchedule: OpeningScheduleRow[];
  orderQuantities: MaterialOrderQuantity[];
  totalCost: number;
}

export interface SheetEstimateRecord {
  sheetId: string;
  sheetName: string;
  updatedAt: string;
  parameters: ArchitecturalParameters;
  rooms: RoomDefinition[];
  openings: OpeningDefinition[];
  roleOverrides?: Record<string, string>;
  scanBox?: { min_x: number; min_y: number; max_x: number; max_y: number } | null;
  summary: ArchTakeoffSummary;
  notes?: string;
}

export interface EstimateVersion {
  id: string;
  versionNumber: number;
  timestamp: string;
  label?: string;
  sheetId?: string;
  sheetName?: string;
  totalCost: number;
  notes?: string;
  snapshot: any;
}
