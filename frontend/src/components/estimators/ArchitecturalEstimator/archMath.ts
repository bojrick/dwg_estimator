import {
  ArchitecturalParameters,
  RoomDefinition,
  OpeningDefinition,
  ArchTakeoffSummary,
  OpeningScheduleRow,
  MaterialOrderQuantity,
} from './types';

export function calculateArchTakeoff(
  params: ArchitecturalParameters,
  rooms: RoomDefinition[],
  openings: OpeningDefinition[]
): ArchTakeoffSummary {
  const floorHeight = params.floorHeightM || 3.0;
  const activeRooms = rooms.filter((r) => r.included !== false);
  const activeOpenings = openings.filter((o) => o.included !== false && (o.count || 0) > 0);

  // Openings deductions & itemized schedule
  let totalOpeningsAreaM2 = 0;
  let doorWidthTotalM = 0;
  let doorsCount = 0;
  let windowsCount = 0;
  let ventilatorsCount = 0;
  let openingsCost = 0;

  const defaultDoorRateM2 = params.doorRatePerM2 ?? 4200;
  const defaultWinRateM2 = params.windowRatePerM2 ?? 3600;

  const openingSchedule: OpeningScheduleRow[] = activeOpenings.map((op) => {
    const w = Number(op.widthM) || 0;
    const h = Number(op.heightM) || 0;
    const count = Number(op.count) || 0;
    const unitArea = Math.round(w * h * 100) / 100;
    const totalArea = Math.round(unitArea * count * 100) / 100;
    totalOpeningsAreaM2 += totalArea;

    if (op.type === 'door') {
      doorWidthTotalM += w * count;
      doorsCount += count;
    } else if (op.type === 'window') {
      windowsCount += count;
    } else {
      ventilatorsCount += count;
    }

    const defaultUnitRate =
      op.type === 'door'
        ? Math.round(unitArea * defaultDoorRateM2)
        : Math.round(unitArea * defaultWinRateM2);
    const unitRate = op.unitRate !== undefined && op.unitRate > 0 ? op.unitRate : defaultUnitRate;
    const amount = Math.round(unitRate * count);
    openingsCost += amount;

    return {
      id: op.id,
      mark: op.mark || (op.type === 'door' ? 'D' : op.type === 'window' ? 'W' : 'V'),
      type: op.type,
      description:
        op.description ||
        (op.type === 'door'
          ? 'Flush / panel door with frame'
          : op.type === 'window'
          ? 'Glazed casement / sliding window'
          : 'Louvered ventilator'),
      sizeLabel: `${w.toFixed(2)}m × ${h.toFixed(2)}m`,
      widthM: w,
      heightM: h,
      unitAreaM2: unitArea,
      count,
      totalAreaM2: totalArea,
      unitRate,
      amount,
    };
  });

  // Derive wall lengths from active rooms if not explicitly overridden
  const totalFloorAreaM2 = activeRooms.reduce((acc, r) => acc + (Number(r.areaM2) || 0), 0);
  const totalPerimeterM = activeRooms.reduce((acc, r) => acc + (Number(r.perimeterM) || 0), 0);

  const extWallLen =
    params.extWallLengthM > 0
      ? params.extWallLengthM
      : totalFloorAreaM2 > 0
      ? Math.max(8, Math.round(Math.sqrt(totalFloorAreaM2) * 4 * 10) / 10)
      : 0;
  const intWallLen =
    params.intWallLengthM > 0
      ? params.intWallLengthM
      : totalPerimeterM > 0
      ? Math.max(4, Math.round(Math.max(0, totalPerimeterM - extWallLen) * 0.5 * 10) / 10)
      : 0;

  const grossExtWallArea = extWallLen * floorHeight;
  const grossIntWallArea = intWallLen * floorHeight;
  const grossWallAreaM2 = grossExtWallArea + grossIntWallArea;

  // Windows & ventilators sit on external walls; doors split between internal and external walls
  const winVentArea = openingSchedule
    .filter((o) => o.type !== 'door')
    .reduce((a, o) => a + o.totalAreaM2, 0);
  const doorArea = openingSchedule
    .filter((o) => o.type === 'door')
    .reduce((a, o) => a + o.totalAreaM2, 0);

  const extOpeningsArea = Math.min(grossExtWallArea, winVentArea + doorArea * 0.25);
  const intOpeningsArea = Math.min(grossIntWallArea, doorArea * 0.75);

  const netExtWallAreaM2 = Math.max(0, grossExtWallArea - extOpeningsArea);
  const netIntWallAreaM2 = Math.max(0, grossIntWallArea - intOpeningsArea);

  const extMasonryVolumeM3 = netExtWallAreaM2 * (params.extWallThicknessM || 0.23);
  const intMasonryVolumeM3 = netIntWallAreaM2 * (params.intWallThicknessM || 0.115);

  // Parapet walls calculation (balconies, terraces, railings with lower ~1m height)
  const parapetWallLen =
    params.parapetWallLengthM !== undefined && params.parapetWallLengthM > 0
      ? params.parapetWallLengthM
      : activeRooms.reduce((acc, r) => acc + (Number(r.parapetLengthM) || 0), 0);
  const parapetHeight = params.parapetWallHeightM || 1.0;
  const parapetThick = params.parapetWallThicknessM || 0.115;
  const parapetMasonryVolumeM3 = parapetWallLen * parapetHeight * parapetThick;
  const parapetPlasterAreaM2 = parapetWallLen * parapetHeight * 2;

  const totalMasonryVolumeM3 = extMasonryVolumeM3 + intMasonryVolumeM3 + parapetMasonryVolumeM3;

  // Unit block volume calculation with mortar joint
  const mortarM = (params.mortarJointMm || 10) / 1000;
  const blkLenM = (params.blockLengthMm || 600) / 1000 + mortarM;
  const blkHgtM = (params.blockHeightMm || 200) / 1000 + mortarM;
  const blkWidM = (params.blockWidthMm || 150) / 1000;
  const singleBlockVolumeM3 = Math.max(1e-5, blkLenM * blkHgtM * blkWidM);

  const rawBlocks = totalMasonryVolumeM3 / singleBlockVolumeM3;
  const totalBlocksRequired = Math.ceil(rawBlocks * (1 + (params.wastagePct || 5) / 100));

  // Plastering: Internal has 2 faces on partition walls + 1 inner face on external walls + ceiling
  const internalPlasterAreaM2 = netIntWallAreaM2 * 2 + netExtWallAreaM2 + totalFloorAreaM2;
  const externalPlasterAreaM2 = netExtWallAreaM2 + parapetPlasterAreaM2;
  const ceilingPlasterAreaM2 = totalFloorAreaM2;

  // Flooring & Skirting
  const totalFlooringAreaM2 = totalFloorAreaM2;
  const totalSkirtingLengthM = Math.max(0, totalPerimeterM - doorWidthTotalM);

  // Cost calculation
  const mainMasonryCost = (extMasonryVolumeM3 + intMasonryVolumeM3) * (params.masonryRatePerM3 || 4500);
  const parapetMasonryCost =
    parapetMasonryVolumeM3 *
    (params.parapetMasonryRatePerM3 || params.masonryRatePerM3 || 4500);
  const masonryCost = mainMasonryCost + parapetMasonryCost;
  const plasterCost =
    (internalPlasterAreaM2 + externalPlasterAreaM2) * (params.plasterRatePerM2 || 180);
  const paintCost =
    (internalPlasterAreaM2 + externalPlasterAreaM2) * (params.paintRatePerM2 || 140);
  const flooringCost = totalFlooringAreaM2 * (params.flooringRatePerM2 || 750);
  const totalCost = Math.round(masonryCost + plasterCost + paintCost + flooringCost + openingsCost);

  // Commercial Procurement Order Quantities (IS 2250 / CPWD material coefficients)
  const totalPlasterM2 = internalPlasterAreaM2 + externalPlasterAreaM2;
  const cementBagsPerM3Masonry = params.blockType === 'aac' ? 1.15 : 2.45;
  const cementBagsMasonry = totalMasonryVolumeM3 * cementBagsPerM3Masonry;
  const cementBagsPlaster = totalPlasterM2 * 0.145; // 12–18mm 1:5 CM plaster
  const cementBagsFlooring = totalFlooringAreaM2 * 0.08;
  const totalCementBags50Kg = Math.ceil(
    (cementBagsMasonry + cementBagsPlaster + cementBagsFlooring) * 1.03
  );

  const sandM3Masonry = totalMasonryVolumeM3 * (params.blockType === 'aac' ? 0.18 : 0.28);
  const sandM3Plaster = totalPlasterM2 * 0.021;
  const totalSandM3 = sandM3Masonry + sandM3Plaster;
  const totalSandTonnes = Math.ceil(totalSandM3 * 1.6 * 10) / 10; // M-Sand bulk density ~1.6 MT/m3
  const totalSandBrass = Math.round((totalSandM3 / 2.8317) * 100) / 100;

  // Flooring boxes: standard 600×600mm (4 pcs = 1.44 m²/box) with 8% cutting wastage
  const tileBoxesRequired = Math.ceil((totalFlooringAreaM2 * 1.08) / 1.44);
  const tileAdhesiveBags20Kg = Math.ceil(totalFlooringAreaM2 / 4.2);

  // Paint: 2 coats emulsion + 1 coat primer (~6.2 m²/L finished 2-coat coverage)
  const totalPaintLiters = Math.ceil((totalPlasterM2 * 1.05) / 6.2);
  const paintBuckets20L = Math.ceil(totalPaintLiters / 20);
  const puttyBags40Kg = Math.ceil(internalPlasterAreaM2 / 14);

  const masonryPackSize =
    params.blockType === 'aac' ? 60 : params.blockType === 'concrete_block' ? 50 : 2000;
  const masonryPackLabel =
    params.blockType === 'aac'
      ? `Pallets (${masonryPackSize} blocks/pallet · ${totalBlocksRequired.toLocaleString()} nos)`
      : params.blockType === 'concrete_block'
      ? `Pallets (${masonryPackSize} blocks/pallet · ${totalBlocksRequired.toLocaleString()} nos)`
      : `Lots of 2,000 bricks (${totalBlocksRequired.toLocaleString()} nos)`;

  const orderQuantities: MaterialOrderQuantity[] = [
    {
      id: 'ord_masonry',
      category: 'masonry',
      item:
        params.blockType === 'aac'
          ? `AAC Blocks (${params.blockLengthMm}×${params.blockHeightMm}×${params.blockWidthMm}mm)`
          : params.blockType === 'clay_brick'
          ? 'Modular Clay Bricks (Class 7.5)'
          : 'Solid Concrete Blocks',
      netQuantity: Math.round(totalMasonryVolumeM3 * 100) / 100,
      netUnit: 'm³',
      orderQuantity: Math.ceil(totalBlocksRequired / masonryPackSize),
      commercialUnit: masonryPackLabel,
      specification: `Includes ${params.wastagePct || 5}% breakage allowance`,
      estimatedCost: Math.round(masonryCost * 0.68),
    },
    {
      id: 'ord_cement',
      category: 'cement',
      item: 'OPC 43 / PPC Cement (Masonry, Plaster & Bedding)',
      netQuantity: Math.round((cementBagsMasonry + cementBagsPlaster + cementBagsFlooring) * 10) / 10,
      netUnit: 'bags',
      orderQuantity: totalCementBags50Kg,
      commercialUnit: '50 kg Bags',
      specification: 'IS 2250 CM 1:5 mortar & plaster mix',
      estimatedCost: totalCementBags50Kg * 390,
    },
    {
      id: 'ord_sand',
      category: 'sand',
      item: 'Graded M-Sand / Plaster Sand (Zone II)',
      netQuantity: Math.round(totalSandM3 * 10) / 10,
      netUnit: 'm³',
      orderQuantity: totalSandTonnes,
      commercialUnit: `MT (${totalSandBrass} Brass)`,
      specification: 'IS 1542 / IS 2116 graded fine aggregate',
      estimatedCost: Math.round(totalSandTonnes * 1250),
    },
    {
      id: 'ord_tiles',
      category: 'flooring',
      item: 'Flooring Tiles (600×600mm Vitrified / Finish)',
      netQuantity: Math.round(totalFlooringAreaM2 * 10) / 10,
      netUnit: 'm²',
      orderQuantity: tileBoxesRequired,
      commercialUnit: `Boxes (1.44 m²/box) + ${tileAdhesiveBags20Kg} Adhesive Bags (20kg)`,
      specification: 'Includes 8% cutting & skirting wastage',
      estimatedCost: Math.round(flooringCost * 0.72),
    },
    {
      id: 'ord_paint',
      category: 'paint',
      item: 'Interior & Exterior Acrylic Emulsion + Wall Putty',
      netQuantity: Math.round(totalPlasterM2 * 10) / 10,
      netUnit: 'm²',
      orderQuantity: paintBuckets20L,
      commercialUnit: `20L Paint Drums (${totalPaintLiters} L) + ${puttyBags40Kg} Putty Bags (40kg)`,
      specification: '1 coat primer + 2 coats finish emulsion',
      estimatedCost: Math.round(paintCost * 0.65),
    },
  ];

  if (doorsCount > 0 || windowsCount > 0 || ventilatorsCount > 0) {
    orderQuantities.push({
      id: 'ord_openings',
      category: 'openings',
      item: 'Doors, Windows & Ventilator Assemblies',
      netQuantity: Math.round(totalOpeningsAreaM2 * 100) / 100,
      netUnit: 'm²',
      orderQuantity: doorsCount + windowsCount + ventilatorsCount,
      commercialUnit: `Sets (${doorsCount} Doors · ${windowsCount} Windows · ${ventilatorsCount} Vent.)`,
      specification: openingSchedule.map((o) => `${o.mark}: ${o.count}×(${o.sizeLabel})`).join(', '),
      estimatedCost: openingsCost,
    });
  }

  return {
    grossWallAreaM2: Math.round(grossWallAreaM2 * 100) / 100,
    totalOpeningsAreaM2: Math.round(totalOpeningsAreaM2 * 100) / 100,
    netExtWallAreaM2: Math.round(netExtWallAreaM2 * 100) / 100,
    netIntWallAreaM2: Math.round(netIntWallAreaM2 * 100) / 100,
    extMasonryVolumeM3: Math.round(extMasonryVolumeM3 * 100) / 100,
    intMasonryVolumeM3: Math.round(intMasonryVolumeM3 * 100) / 100,
    parapetMasonryVolumeM3: Math.round(parapetMasonryVolumeM3 * 100) / 100,
    parapetWallLengthM: Math.round(parapetWallLen * 10) / 10,
    totalMasonryVolumeM3: Math.round(totalMasonryVolumeM3 * 100) / 100,
    singleBlockVolumeM3: Math.round(singleBlockVolumeM3 * 10000) / 10000,
    totalBlocksRequired,
    internalPlasterAreaM2: Math.round(internalPlasterAreaM2 * 100) / 100,
    externalPlasterAreaM2: Math.round(externalPlasterAreaM2 * 100) / 100,
    ceilingPlasterAreaM2: Math.round(ceilingPlasterAreaM2 * 100) / 100,
    totalFlooringAreaM2: Math.round(totalFlooringAreaM2 * 100) / 100,
    totalSkirtingLengthM: Math.round(totalSkirtingLengthM * 100) / 100,
    doorsCount,
    windowsCount,
    ventilatorsCount,
    openingsCost,
    openingSchedule,
    orderQuantities,
    totalCost,
  };
}
