import {
  PlumbingParameters,
  PlumbingFixtureItem,
  PlumbingTakeoffSummary,
} from './types';

export function calculatePlumbingTakeoff(
  params: PlumbingParameters,
  fixtures: PlumbingFixtureItem[]
): PlumbingTakeoffSummary {
  const totalFixtures = fixtures.reduce((acc, f) => acc + (f.count || 0), 0);

  // Daily water demand (IS 1172)
  const occupants = params.numOccupants || 8;
  const lpdPerHead = params.dailyDemandLitersPerHead || 135;
  const dailyWaterDemandLpd = occupants * lpdPerHead;

  // Tank sizing: OHT is typically 1 day, UGT is typically 1.5 days
  const ohtCapacityLiters = Math.ceil((dailyWaterDemandLpd * (params.ohtReserveDays || 1.0)) / 500) * 500;
  const ugtCapacityLiters = Math.ceil((dailyWaterDemandLpd * (params.ugtReserveDays || 1.5)) / 1000) * 1000;

  // Piping totals
  const totalSupplyPipeM =
    (params.supplyCpvc15M || 0) + (params.supplyCpvc20M || 0) + (params.supplyCpvc25M || 0);
  const totalDrainPipeM = (params.drainPvc75M || 0) + (params.drainPvc110M || 0);

  // Costs
  const supplyPipeCost = totalSupplyPipeM * (params.rateCpvcPerM || 95);
  const drainPipeCost = totalDrainPipeM * (params.ratePvcPerM || 160);
  const tankCost = (ohtCapacityLiters * 6.5) + (ugtCapacityLiters * 5.0); // Tank material estimate
  const materialCost = Math.round(supplyPipeCost + drainPipeCost + tankCost);
  const laborCost = Math.round(totalFixtures * (params.ratePerFixtureLabor || 1200));
  const totalCost = materialCost + laborCost;

  return {
    totalFixtures,
    dailyWaterDemandLpd,
    ohtCapacityLiters,
    ugtCapacityLiters,
    totalSupplyPipeM,
    totalDrainPipeM,
    materialCost,
    laborCost,
    totalCost,
  };
}

