export type FloorFinishType = 'vitrified_tile' | 'marble' | 'granite' | 'wooden' | 'concrete';
export type BlockType = 'aac' | 'clay_brick' | 'concrete_block';
export type OpeningType = 'door' | 'window' | 'ventilator';

export interface RoomDefinition {
  id: string;
  name: string;
  areaM2: number;
  perimeterM: number;
  floorFinish: FloorFinishType;
}

export interface OpeningDefinition {
  id: string;
  mark: string; // e.g. D1, D2, W1
  type: OpeningType;
  widthM: number;
  heightM: number;
  count: number;
  description?: string;
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
  currency: string;
}

export interface ArchTakeoffSummary {
  grossWallAreaM2: number;
  totalOpeningsAreaM2: number;
  netExtWallAreaM2: number;
  netIntWallAreaM2: number;
  extMasonryVolumeM3: number;
  intMasonryVolumeM3: number;
  totalMasonryVolumeM3: number;
  singleBlockVolumeM3: number;
  totalBlocksRequired: number;
  internalPlasterAreaM2: number;
  externalPlasterAreaM2: number;
  ceilingPlasterAreaM2: number;
  totalFlooringAreaM2: number;
  totalSkirtingLengthM: number;
  totalCost: number;
}

