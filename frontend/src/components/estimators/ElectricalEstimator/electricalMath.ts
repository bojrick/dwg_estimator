import {
  ElectricalParameters,
  ElectricalPointItem,
  ElectricalTakeoffSummary,
} from './types';

export function calculateElectricalTakeoff(
  params: ElectricalParameters,
  points: ElectricalPointItem[]
): ElectricalTakeoffSummary {
  const avgRun = params.averageRunBetweenPointsM || 3.5;
  const loopFactor = 1 + (params.loopingWastagePct || 15) / 100;

  let totalPoints = 0;
  let lightFanPoints = 0;
  let socket6aPoints = 0;
  let powerAcPoints = 0;
  let totalDropHeightM = 0;

  for (const pt of points) {
    const c = pt.count || 0;
    totalPoints += c;
    totalDropHeightM += (pt.dropHeightM || 0) * c;

    if (pt.type === 'light' || pt.type === 'fan') {
      lightFanPoints += c;
    } else if (pt.type === 'socket_6a' || pt.type === 'switchboard') {
      socket6aPoints += c;
    } else if (pt.type === 'socket_16a' || pt.type === 'ac_point' || pt.type === 'distribution_board') {
      powerAcPoints += c;
    }
  }

  // Conduit: Horizontal slab runs between points + vertical wall drops
  const horizontalConduitM = totalPoints * avgRun;
  const totalConduitLengthM = Math.round((horizontalConduitM + totalDropHeightM) * 10) / 10;

  // 1.5 sq.mm: Lighting & fan points (3 wires: Phase, Neutral, Earth/Switch)
  const wire1_5M = Math.round((lightFanPoints * avgRun * 2.8 + totalDropHeightM * 2) * loopFactor);

  // 2.5 sq.mm: 6A convenience sockets (3 wires: Phase, Neutral, Earth)
  const wire2_5M = Math.round((socket6aPoints * avgRun * 2.5 + socket6aPoints * 1.5) * loopFactor);

  // 4.0 sq.mm: 16A power / AC points
  const wire4_0M = Math.round((powerAcPoints * avgRun * 3.0 + powerAcPoints * 2.0) * loopFactor);

  // Continuous earth wire
  const earthWireM = Math.round(totalConduitLengthM * 0.9 * loopFactor);

  // Cost estimates
  const conduitCost = totalConduitLengthM * (params.rateConduitPerM || 120);
  const wireCost =
    wire1_5M * (params.rateWire1_5PerM || 18) +
    wire2_5M * (params.rateWire2_5PerM || 28) +
    wire4_0M * (params.rateWire4_0PerM || 45) +
    earthWireM * 14;
  const totalMaterialCost = Math.round(conduitCost + wireCost);
  const totalLaborCost = Math.round(totalPoints * (params.ratePerPointLabor || 350));
  const totalCost = totalMaterialCost + totalLaborCost;

  return {
    totalPoints,
    totalConduitLengthM,
    wire1_5M,
    wire2_5M,
    wire4_0M,
    earthWireM,
    totalMaterialCost,
    totalLaborCost,
    totalCost,
  };
}

