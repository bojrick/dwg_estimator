export type PlumbingFixtureType = 'wc' | 'basin' | 'sink' | 'shower' | 'urinal' | 'floor_trap';

export interface PlumbingFixtureItem {
  id: string;
  name: string;
  type: PlumbingFixtureType;
  count: number;
}

export interface PlumbingParameters {
  numOccupants: number;
  dailyDemandLitersPerHead: number; // IS 1172 standard (135 L/head/day)
  ohtReserveDays: number;
  ugtReserveDays: number;
  supplyCpvc15M: number;
  supplyCpvc20M: number;
  supplyCpvc25M: number;
  drainPvc75M: number;
  drainPvc110M: number;
  rateCpvcPerM: number;
  ratePvcPerM: number;
  ratePerFixtureLabor: number;
  currency: string;
}

export interface PlumbingTakeoffSummary {
  totalFixtures: number;
  dailyWaterDemandLpd: number;
  ohtCapacityLiters: number;
  ugtCapacityLiters: number;
  totalSupplyPipeM: number;
  totalDrainPipeM: number;
  materialCost: number;
  laborCost: number;
  totalCost: number;
}

