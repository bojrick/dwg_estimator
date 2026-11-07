import {
  FireProtectionParameters,
  FireProtectionItem,
  FireTakeoffSummary,
} from './types';

export function calculateFireTakeoff(
  params: FireProtectionParameters,
  items: FireProtectionItem[]
): FireTakeoffSummary {
  const area = params.totalFloorAreaM2 || 450;
  const coverage = params.sprinklerCoverageM2 || 12;

  // Minimum required sprinklers (IS 15105 / NFPA 13)
  const minRecommendedSprinklers = Math.ceil(area / coverage);

  let sprinklersInstalled = 0;
  let extinguishersCount = 0;
  let hoseReelsCount = 0;

  for (const it of items) {
    if (it.type === 'sprinkler') sprinklersInstalled += (it.count || 0);
    else if (it.type === 'extinguisher') extinguishersCount += (it.count || 0);
    else if (it.type === 'hose_reel') hoseReelsCount += (it.count || 0);
  }

  const totalPipingM = (params.riserPipeLengthM || 45) + (params.branchPipeLengthM || 120);

  const sprinklerCost = (sprinklersInstalled || minRecommendedSprinklers) * (params.rateSprinkler || 450);
  const extinguisherCost = extinguishersCount * (params.rateExtinguisher || 2200);
  const hoseReelCost = hoseReelsCount * (params.rateHoseReel || 8500);
  const pipeCost = totalPipingM * (params.ratePipePerM || 450);

  const materialCost = Math.round(sprinklerCost + extinguisherCost + hoseReelCost + pipeCost);
  const laborCost = Math.round(materialCost * 0.25);
  const totalCost = materialCost + laborCost;

  return {
    minRecommendedSprinklers,
    sprinklersInstalled,
    extinguishersCount,
    hoseReelsCount,
    totalPipingM,
    materialCost,
    laborCost,
    totalCost,
  };
}

