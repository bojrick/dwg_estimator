export type FireItemType = 'sprinkler' | 'extinguisher' | 'hose_reel' | 'landing_valve' | 'riser_pipe';
export type HazardClass = 'light' | 'ordinary' | 'high';

export interface FireProtectionItem {
  id: string;
  name: string;
  type: FireItemType;
  count: number;
  specs?: string;
}

export interface FireProtectionParameters {
  totalFloorAreaM2: number;
  hazardClass: HazardClass;
  sprinklerCoverageM2: number;
  riserPipeLengthM: number;
  branchPipeLengthM: number;
  rateSprinkler: number;
  rateExtinguisher: number;
  rateHoseReel: number;
  ratePipePerM: number;
  currency: string;
}

export interface FireTakeoffSummary {
  minRecommendedSprinklers: number;
  sprinklersInstalled: number;
  extinguishersCount: number;
  hoseReelsCount: number;
  totalPipingM: number;
  materialCost: number;
  laborCost: number;
  totalCost: number;
}

