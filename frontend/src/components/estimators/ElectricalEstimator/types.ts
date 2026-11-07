export type ElectricalPointType =
  | 'light'
  | 'fan'
  | 'socket_6a'
  | 'socket_16a'
  | 'ac_point'
  | 'switchboard'
  | 'distribution_board';

export interface ElectricalPointItem {
  id: string;
  name: string;
  type: ElectricalPointType;
  count: number;
  dropHeightM: number;
}

export interface ElectricalParameters {
  floorHeightM: number;
  averageRunBetweenPointsM: number;
  loopingWastagePct: number;
  rateConduitPerM: number;
  rateWire1_5PerM: number;
  rateWire2_5PerM: number;
  rateWire4_0PerM: number;
  ratePerPointLabor: number;
  currency: string;
}

export interface ElectricalTakeoffSummary {
  totalPoints: number;
  totalConduitLengthM: number;
  wire1_5M: number; // Lighting & fan loops
  wire2_5M: number; // 6A Convenience power
  wire4_0M: number; // 16A Power / AC points
  earthWireM: number;
  totalLaborCost: number;
  totalMaterialCost: number;
  totalCost: number;
}

