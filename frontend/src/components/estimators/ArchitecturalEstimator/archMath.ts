import {
  ArchitecturalParameters,
  RoomDefinition,
  OpeningDefinition,
  ArchTakeoffSummary,
} from './types';

export function calculateArchTakeoff(
  params: ArchitecturalParameters,
  rooms: RoomDefinition[],
  openings: OpeningDefinition[]
): ArchTakeoffSummary {
  const floorHeight = params.floorHeightM || 3.0;

  // Openings deductions
  let totalOpeningsAreaM2 = 0;
  let doorWidthTotalM = 0;
  for (const op of openings) {
    const area = (op.widthM || 0) * (op.heightM || 0) * (op.count || 1);
    totalOpeningsAreaM2 += area;
    if (op.type === 'door') {
      doorWidthTotalM += (op.widthM || 0) * (op.count || 1);
    }
  }

  // Derive wall lengths from rooms if not explicitly overridden
  const totalFloorAreaM2 = rooms.reduce((acc, r) => acc + (r.areaM2 || 0), 0);
  const totalPerimeterM = rooms.reduce((acc, r) => acc + (r.perimeterM || 0), 0);

  // If external and internal wall lengths are 0, estimate from rooms perimeter
  const extWallLen = params.extWallLengthM > 0
    ? params.extWallLengthM
    : Math.max(10, Math.round(Math.sqrt(totalFloorAreaM2 || 100) * 4));
  const intWallLen = params.intWallLengthM > 0
    ? params.intWallLengthM
    : Math.max(5, Math.round(Math.max(0, totalPerimeterM - extWallLen) * 0.5));

  const grossExtWallArea = extWallLen * floorHeight;
  const grossIntWallArea = intWallLen * floorHeight;
  const grossWallAreaM2 = grossExtWallArea + grossIntWallArea;

  // Assume 60% of openings on external walls (windows, main doors), 40% on internal walls (room doors)
  const extOpeningsArea = totalOpeningsAreaM2 * 0.6;
  const intOpeningsArea = totalOpeningsAreaM2 * 0.4;

  const netExtWallAreaM2 = Math.max(0, grossExtWallArea - extOpeningsArea);
  const netIntWallAreaM2 = Math.max(0, grossIntWallArea - intOpeningsArea);

  const extMasonryVolumeM3 = netExtWallAreaM2 * (params.extWallThicknessM || 0.23);
  const intMasonryVolumeM3 = netIntWallAreaM2 * (params.intWallThicknessM || 0.115);
  const totalMasonryVolumeM3 = extMasonryVolumeM3 + intMasonryVolumeM3;

  // Unit block volume calculation with mortar joint
  const mortarM = (params.mortarJointMm || 10) / 1000;
  const blkLenM = (params.blockLengthMm || 600) / 1000 + mortarM;
  const blkHgtM = (params.blockHeightMm || 200) / 1000 + mortarM;
  const blkWidM = (params.blockWidthMm || 150) / 1000;
  const singleBlockVolumeM3 = Math.max(1e-5, blkLenM * blkHgtM * blkWidM);

  const rawBlocks = totalMasonryVolumeM3 / singleBlockVolumeM3;
  const totalBlocksRequired = Math.ceil(rawBlocks * (1 + (params.wastagePct || 5) / 100));

  // Plastering: Internal has 2 coats on partition walls + 1 coat on inner face of external walls + ceiling
  const internalPlasterAreaM2 = (netIntWallAreaM2 * 2) + netExtWallAreaM2 + totalFloorAreaM2;
  const externalPlasterAreaM2 = netExtWallAreaM2;
  const ceilingPlasterAreaM2 = totalFloorAreaM2;

  // Flooring & Skirting
  const totalFlooringAreaM2 = totalFloorAreaM2;
  const totalSkirtingLengthM = Math.max(0, totalPerimeterM - doorWidthTotalM);

  // Cost calculation
  const masonryCost = totalMasonryVolumeM3 * (params.masonryRatePerM3 || 4500);
  const plasterCost = (internalPlasterAreaM2 + externalPlasterAreaM2) * (params.plasterRatePerM2 || 180);
  const paintCost = (internalPlasterAreaM2 + externalPlasterAreaM2) * (params.paintRatePerM2 || 140);
  const flooringCost = totalFlooringAreaM2 * (params.flooringRatePerM2 || 750);
  const totalCost = Math.round(masonryCost + plasterCost + paintCost + flooringCost);

  return {
    grossWallAreaM2: Math.round(grossWallAreaM2 * 100) / 100,
    totalOpeningsAreaM2: Math.round(totalOpeningsAreaM2 * 100) / 100,
    netExtWallAreaM2: Math.round(netExtWallAreaM2 * 100) / 100,
    netIntWallAreaM2: Math.round(netIntWallAreaM2 * 100) / 100,
    extMasonryVolumeM3: Math.round(extMasonryVolumeM3 * 100) / 100,
    intMasonryVolumeM3: Math.round(intMasonryVolumeM3 * 100) / 100,
    totalMasonryVolumeM3: Math.round(totalMasonryVolumeM3 * 100) / 100,
    singleBlockVolumeM3: Math.round(singleBlockVolumeM3 * 10000) / 10000,
    totalBlocksRequired,
    internalPlasterAreaM2: Math.round(internalPlasterAreaM2 * 100) / 100,
    externalPlasterAreaM2: Math.round(externalPlasterAreaM2 * 100) / 100,
    ceilingPlasterAreaM2: Math.round(ceilingPlasterAreaM2 * 100) / 100,
    totalFlooringAreaM2: Math.round(totalFlooringAreaM2 * 100) / 100,
    totalSkirtingLengthM: Math.round(totalSkirtingLengthM * 100) / 100,
    totalCost,
  };
}

