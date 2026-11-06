import {
  BarShapeCode,
  BbsBarItem,
  DiameterSummary,
  StructuralEstimateState,
  StructuralMemberDefinition,
} from './types';

export const STANDARD_DIAMETERS = [6, 8, 10, 12, 16, 20, 25, 28, 32, 36, 40];

/**
 * Returns theoretical unit weight of mild / HYSD steel rebar in kg/m:
 * weight = d^2 / 162.28
 */
export function getUnitWeightKgM(diameterMm: number): number {
  if (diameterMm <= 0) return 0;
  return Math.round((Math.pow(diameterMm, 2) / 162.28) * 1000) / 1000;
}

/**
 * Calculates cutting length in meters for a given bar shape and dimensions (in mm).
 */
export function calculateCuttingLengthM(
  shape: BarShapeCode,
  diameterMm: number,
  dimA: number,
  dimB: number = 0,
  dimC: number = 0,
  dimD: number = 0
): number {
  const d = diameterMm || 10;
  let lenMm = 0;

  switch (shape) {
    case 'straight':
      lenMm = Math.max(0, dimA);
      break;

    case 'l_bend':
      // L-bar: A + B - 1x 90° bend deduction (2d)
      lenMm = Math.max(0, dimA + dimB - 2 * d);
      break;

    case 'u_hook':
      // U-bar: A + B + C - 2x 90° bend deductions (4d)
      lenMm = Math.max(0, dimA + dimB + dimC - 4 * d);
      break;

    case 'crank':
      // Cranked bar: A (straight) + B (cranked section inclined) + C (straight) + 0.42*D
      // Where D is crank depth (dimD), minus 2x 45° bend deductions (2d)
      lenMm = Math.max(0, dimA + dimB + dimC + 0.42 * dimD - 2 * d);
      break;

    case 'stirrup_rect':
      // Rectangular stirrup: 2*(A + B) + 2x 135° hooks (24d) - 3x 90° bends (6d) = 2*(A+B) + 18d
      lenMm = Math.max(0, 2 * (dimA + dimB) + 20 * d);
      break;

    case 'chair':
      // Chair bar: 2 legs (A) + 2 upright heights (B) + 1 top cradle (C)
      lenMm = Math.max(0, 2 * dimA + 2 * dimB + dimC);
      break;

    default:
      lenMm = Math.max(0, dimA);
  }

  // Convert to meters and round to 3 decimal places
  return Math.round((lenMm / 1000) * 1000) / 1000;
}

/**
 * Recalculates all dependent values on a BBS bar item.
 */
export function recalculateBarItem(item: Partial<BbsBarItem>): BbsBarItem {
  const shape = item.shape || 'straight';
  const diameter = item.diameter || 12;
  const dimA = item.dimA || 0;
  const dimB = item.dimB || 0;
  const dimC = item.dimC || 0;
  const dimD = item.dimD || 0;

  const cuttingLengthM = calculateCuttingLengthM(shape, diameter, dimA, dimB, dimC, dimD);
  const numMembers = Math.max(1, item.numMembers || 1);
  const barsPerMember = Math.max(1, item.barsPerMember || 1);
  const totalBars = numMembers * barsPerMember;
  const totalLengthM = Math.round(totalBars * cuttingLengthM * 1000) / 1000;
  const unitWeightKgM = getUnitWeightKgM(diameter);
  const totalWeightKg = Math.round(totalLengthM * unitWeightKgM * 100) / 100;

  return {
    id: item.id || `bar_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    memberId: item.memberId || 'M1',
    memberType: item.memberType || 'other',
    mark: item.mark || 'Main',
    diameter,
    shape,
    dimA,
    dimB,
    dimC,
    dimD,
    cuttingLengthM,
    numMembers,
    barsPerMember,
    totalBars,
    totalLengthM,
    unitWeightKgM,
    totalWeightKg,
    sourceSheetId: item.sourceSheetId,
    sourceTextCoords: item.sourceTextCoords,
    notes: item.notes || '',
  };
}

/**
 * Summarizes all BBS items by bar diameter with total lengths and weights.
 */
export function calculateDiameterSummary(items: BbsBarItem[]): DiameterSummary[] {
  const map = new Map<number, { totalBars: number; totalLengthM: number; totalWeightKg: number }>();

  for (const item of items) {
    const cur = map.get(item.diameter) || { totalBars: 0, totalLengthM: 0, totalWeightKg: 0 };
    cur.totalBars += item.totalBars;
    cur.totalLengthM += item.totalLengthM;
    cur.totalWeightKg += item.totalWeightKg;
    map.set(item.diameter, cur);
  }

  const result: DiameterSummary[] = [];
  const sortedDias = Array.from(map.keys()).sort((a, b) => a - b);

  for (const dia of sortedDias) {
    const data = map.get(dia)!;
    const unitWt = getUnitWeightKgM(dia);
    result.push({
      diameter: dia,
      totalBars: data.totalBars,
      totalLengthM: Math.round(data.totalLengthM * 100) / 100,
      unitWeightKgM: unitWt,
      totalWeightKg: Math.round(data.totalWeightKg * 10) / 10,
      weightTonnes: Math.round((data.totalWeightKg / 1000) * 1000) / 1000,
    });
  }

  return result;
}

export interface TakeoffTotals {
  totalBars: number;
  totalLengthM: number;
  netWeightKg: number;
  netWeightTonnes: number;
  wastageKg: number;
  totalWeightWithWastageKg: number;
  totalWeightWithWastageTonnes: number;
  bindingWireKg: number;
  totalCost: number;
}

export function calculateTakeoffTotals(
  summary: DiameterSummary[],
  params: StructuralEstimateState['parameters']
): TakeoffTotals {
  let totalBars = 0;
  let totalLengthM = 0;
  let netWeightKg = 0;

  for (const row of summary) {
    totalBars += row.totalBars;
    totalLengthM += row.totalLengthM;
    netWeightKg += row.totalWeightKg;
  }

  const wastageRate = (params.wastagePct || 0) / 100;
  const wastageKg = Math.round(netWeightKg * wastageRate * 10) / 10;
  const totalWeightWithWastageKg = Math.round((netWeightKg + wastageKg) * 10) / 10;
  const bindingWireRate = (params.bindingWirePct || 1) / 100;
  const bindingWireKg = Math.round(totalWeightWithWastageKg * bindingWireRate * 10) / 10;
  const totalCost = Math.round(totalWeightWithWastageKg * (params.steelRatePerKg || 0) * 100) / 100;

  return {
    totalBars,
    totalLengthM: Math.round(totalLengthM * 100) / 100,
    netWeightKg: Math.round(netWeightKg * 10) / 10,
    netWeightTonnes: Math.round((netWeightKg / 1000) * 1000) / 1000,
    wastageKg,
    totalWeightWithWastageKg,
    totalWeightWithWastageTonnes: Math.round((totalWeightWithWastageKg / 1000) * 1000) / 1000,
    bindingWireKg,
    totalCost,
  };
}

/**
 * Transforms guided structural member definitions into exact BBS bar items.
 * Handles beams, columns, footings, slabs, multi-floor reductions, and attached plan callouts.
 */
export function generateBbsFromMemberDefinitions(
  members: StructuralMemberDefinition[]
): BbsBarItem[] {
  const result: BbsBarItem[] = [];

  for (const m of members) {
    const numMembers = Math.max(1, m.countOnLayout || 1);
    const cover = m.clearCoverMm || 25;
    const span = Math.max(500, m.spanMm || 3000);
    const width = Math.max(100, m.widthMm || 300);
    const depth = Math.max(100, m.depthMm || 450);
    const thickness = m.thicknessMm || 150;
    const floorLabel = m.floorLevel ? ` [${m.floorLevel}]` : '';

    // 1. Beams
    if (m.category === 'beam') {
      const devLength = 50 * (m.mainBars?.diameter || 16);

      // Bottom Main Bars
      if (m.mainBars && m.mainBars.count > 0) {
        result.push(
          recalculateBarItem({
            memberId: m.mark,
            memberType: 'beam',
            floorLevel: m.floorLevel,
            mark: `Bottom Main${floorLabel}`,
            diameter: m.mainBars.diameter,
            shape: m.mainBars.shape || 'l_bend',
            dimA: span,
            dimB: devLength,
            numMembers,
            barsPerMember: m.mainBars.count,
            notes: `Span ${Math.round(span)}mm, b×D ${width}×${depth}mm`,
          })
        );
      }

      // Top Continuous / Anchor Bars
      if (m.secondaryBars && m.secondaryBars.count > 0) {
        result.push(
          recalculateBarItem({
            memberId: m.mark,
            memberType: 'beam',
            floorLevel: m.floorLevel,
            mark: `Top Continuous${floorLabel}`,
            diameter: m.secondaryBars.diameter,
            shape: m.secondaryBars.shape || 'l_bend',
            dimA: span,
            dimB: devLength,
            numMembers,
            barsPerMember: m.secondaryBars.count,
            notes: 'Top anchor bars',
          })
        );
      }

      // Stirrups
      if (m.stirrups && m.stirrups.spacingMm > 0) {
        const stirrupA = Math.max(80, width - 2 * cover);
        const stirrupB = Math.max(80, depth - 2 * cover);
        const stirrupCount = Math.max(3, Math.round(span / m.stirrups.spacingMm) + 1);

        result.push(
          recalculateBarItem({
            memberId: m.mark,
            memberType: 'beam',
            floorLevel: m.floorLevel,
            mark: `Stirrups (${m.stirrups.legs || 2}-Legged)${floorLabel}`,
            diameter: m.stirrups.diameter,
            shape: 'stirrup_rect',
            dimA: stirrupA,
            dimB: stirrupB,
            numMembers,
            barsPerMember: stirrupCount,
            notes: `@ ${m.stirrups.spacingMm}mm c/c across ${Math.round(span)}mm span`,
          })
        );
      }
    }

    // 2. Columns
    else if (m.category === 'column') {
      const mainDia = m.mainBars?.diameter || 16;
      const lapLength = 50 * mainDia;

      if (m.mainBars && m.mainBars.count > 0) {
        result.push(
          recalculateBarItem({
            memberId: m.mark,
            memberType: 'column',
            floorLevel: m.floorLevel,
            mark: `Vertical Bars${floorLabel}`,
            diameter: mainDia,
            shape: m.mainBars.shape || 'l_bend',
            dimA: span + lapLength,
            dimB: 300,
            numMembers,
            barsPerMember: m.mainBars.count,
            notes: `Height ${Math.round(span)}mm + ${lapLength}mm lap, size ${width}×${depth}mm`,
          })
        );
      }

      // Lateral Ties
      if (m.stirrups && m.stirrups.spacingMm > 0) {
        const tieA = Math.max(80, width - 2 * cover);
        const tieB = Math.max(80, depth - 2 * cover);
        const tieCount = Math.max(3, Math.round(span / m.stirrups.spacingMm) + 1);

        result.push(
          recalculateBarItem({
            memberId: m.mark,
            memberType: 'column',
            floorLevel: m.floorLevel,
            mark: `Lateral Ties${floorLabel}`,
            diameter: m.stirrups.diameter,
            shape: 'stirrup_rect',
            dimA: tieA,
            dimB: tieB,
            numMembers,
            barsPerMember: tieCount,
            notes: `Ties @ ${m.stirrups.spacingMm}mm c/c`,
          })
        );
      }
    }

    // 3. Footings
    else if (m.category === 'footing') {
      const fLength = width;
      const fWidth = depth;
      const fDepth = thickness > 150 ? thickness : 450;
      const meshDia = m.mainBars?.diameter || 12;
      const meshSpacing = m.stirrups?.spacingMm || 150;

      const countX = Math.max(3, Math.round((fWidth - 2 * cover) / meshSpacing) + 1);
      const countY = Math.max(3, Math.round((fLength - 2 * cover) / meshSpacing) + 1);
      const bendH = Math.max(150, fDepth - 2 * cover);

      result.push(
        recalculateBarItem({
          memberId: m.mark,
          memberType: 'footing',
          floorLevel: m.floorLevel,
          mark: `Bottom Mesh (X-dir)${floorLabel}`,
          diameter: meshDia,
          shape: 'u_hook',
          dimA: fLength - 2 * cover,
          dimB: bendH,
          dimC: bendH,
          numMembers,
          barsPerMember: countX,
          notes: `Size ${fLength}×${fWidth}×${fDepth}mm @ ${meshSpacing}mm c/c`,
        })
      );

      result.push(
        recalculateBarItem({
          memberId: m.mark,
          memberType: 'footing',
          floorLevel: m.floorLevel,
          mark: `Bottom Mesh (Y-dir)${floorLabel}`,
          diameter: meshDia,
          shape: 'u_hook',
          dimA: fWidth - 2 * cover,
          dimB: bendH,
          dimC: bendH,
          numMembers,
          barsPerMember: countY,
          notes: `Size ${fLength}×${fWidth}×${fDepth}mm @ ${meshSpacing}mm c/c`,
        })
      );
    }

    // 4. Slabs
    else if (m.category === 'slab') {
      const mainDia = m.mainBars?.diameter || 10;
      const secDia = m.secondaryBars?.diameter || 8;
      const spacingX = m.stirrups?.spacingMm || 150;
      const spacingY = 200;

      const countX = Math.max(3, Math.round((depth - 2 * cover) / spacingX) + 1);
      const countY = Math.max(3, Math.round((span - 2 * cover) / spacingY) + 1);

      result.push(
        recalculateBarItem({
          memberId: m.mark,
          memberType: 'slab',
          floorLevel: m.floorLevel,
          mark: `Short Span Main Bars${floorLabel}`,
          diameter: mainDia,
          shape: 'crank',
          dimA: span - 2 * cover,
          dimB: 200,
          dimC: 200,
          dimD: thickness - 2 * cover,
          numMembers,
          barsPerMember: countX,
          notes: `Thk ${thickness}mm @ ${spacingX}mm c/c`,
        })
      );

      result.push(
        recalculateBarItem({
          memberId: m.mark,
          memberType: 'slab',
          floorLevel: m.floorLevel,
          mark: `Long Span Distribution${floorLabel}`,
          diameter: secDia,
          shape: 'straight',
          dimA: depth - 2 * cover,
          numMembers,
          barsPerMember: countY,
          notes: `Distribution @ ${spacingY}mm c/c`,
        })
      );
    }

    // 5. Generic / Wall / Other
    else {
      const dia = m.mainBars?.diameter || 12;
      result.push(
        recalculateBarItem({
          memberId: m.mark,
          memberType: m.category,
          floorLevel: m.floorLevel,
          mark: `Main Rebar${floorLabel}`,
          diameter: dia,
          shape: 'straight',
          dimA: span,
          numMembers,
          barsPerMember: m.mainBars?.count || 4,
          notes: m.notes || '',
        })
      );
    }

    // 6. Attached Plan Callout Extra Bars (applicable to ANY component!)
    if (m.extraBars && m.extraBars.length > 0) {
      for (const callout of m.extraBars) {
        const extraDia = callout.diameter || 16;
        const extraCount = callout.count || 2;
        const extraLen = callout.lengthMm || Math.round(span / 3 + 50 * extraDia);

        result.push(
          recalculateBarItem({
            memberId: m.mark,
            memberType: m.category,
            floorLevel: m.floorLevel,
            mark: `Extra: ${callout.text || callout.role}${floorLabel}`,
            diameter: extraDia,
            shape: 'l_bend',
            dimA: extraLen,
            dimB: 200,
            numMembers,
            barsPerMember: extraCount,
            sourceTextCoords: callout.coords,
            notes: `Attached from plan callout: "${callout.text}"`,
          })
        );
      }
    }
  }

  return result;
}


