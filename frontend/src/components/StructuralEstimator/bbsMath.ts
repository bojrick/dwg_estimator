import {
  BarShapeCode,
  BbsBarItem,
  CivilAuditAnomaly,
  DiameterSummary,
  LongitudinalSectionDefinition,
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
 * Calculates cutting length in meters for a given bar shape and dimensions (in mm)
 * per IS 2502:1963 & IS 456:2000, including stock length lap splice allowance when > maxStockLengthM.
 */
export function calculateCuttingLengthM(
  shape: BarShapeCode,
  diameterMm: number,
  dimA: number,
  dimB: number = 0,
  dimC: number = 0,
  dimD: number = 0,
  options?: {
    maxStockLengthM?: number;
    lapLengthMultiplier?: number;
    hookAllowanceMultiplier?: number;
  }
): number {
  const d = diameterMm || 10;
  const hookMult = options?.hookAllowanceMultiplier ?? 20;
  const lapMult = options?.lapLengthMultiplier ?? 50;
  const maxStockMm = (options?.maxStockLengthM || 12.0) * 1000;
  let lenMm = 0;

  switch (shape) {
    case 'straight':
      lenMm = Math.max(0, dimA);
      break;

    case 'l_bend':
      // L-bar: A + B - 1x 90° bend deduction (2d per IS 2502)
      lenMm = Math.max(0, dimA + dimB - 2 * d);
      break;

    case 'u_hook':
      // U-bar: A + B + C - 2x 90° bend deductions (4d per IS 2502)
      lenMm = Math.max(0, dimA + dimB + dimC - 4 * d);
      break;

    case 'crank':
      // Cranked bar: A + B + C + 0.42*D - 2x 45° bend deductions (2d per IS 2502)
      lenMm = Math.max(0, dimA + dimB + dimC + 0.42 * dimD - 2 * d);
      break;

    case 'stirrup_rect':
      // Rectangular stirrup: 2*(A + B) + hook allowance (e.g. 24d for 135° seismic hooks - 6d bends = ~20d-24d)
      lenMm = Math.max(0, 2 * (dimA + dimB) + hookMult * d);
      break;

    case 'chair':
      // Chair bar: 2 legs (A) + 2 upright heights (B) + 1 top cradle (C)
      lenMm = Math.max(0, 2 * dimA + 2 * dimB + dimC);
      break;

    default:
      lenMm = Math.max(0, dimA);
  }

  // Commercial stock bar lap splice addition (IS 456: bars > maxStockMm require lap splices)
  if (shape !== 'stirrup_rect' && shape !== 'chair' && maxStockMm >= 3000 && lenMm > maxStockMm) {
    const numLaps = Math.floor((lenMm - 1) / maxStockMm);
    lenMm += numLaps * lapMult * d;
  }

  // Convert to meters and round to 3 decimal places
  return Math.round((lenMm / 1000) * 1000) / 1000;
}

/**
 * Recalculates all dependent values on a BBS bar item.
 */
export function recalculateBarItem(
  item: Partial<BbsBarItem>,
  options?: {
    maxStockLengthM?: number;
    lapLengthMultiplier?: number;
    hookAllowanceMultiplier?: number;
  }
): BbsBarItem {
  const shape = item.shape || 'straight';
  const diameter = item.diameter || 12;
  const dimA = item.dimA || 0;
  const dimB = item.dimB || 0;
  const dimC = item.dimC || 0;
  const dimD = item.dimD || 0;

  const cuttingLengthM = calculateCuttingLengthM(shape, diameter, dimA, dimB, dimC, dimD, options);
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
 * Handles beams, columns, footings, slabs, multi-floor reductions, IS 13920 confinement zones,
 * stock length lap splices, and attached plan callouts.
 */
export function generateBbsFromMemberDefinitions(
  members: StructuralMemberDefinition[],
  parameters?: Partial<StructuralEstimateState['parameters']>
): BbsBarItem[] {
  const result: BbsBarItem[] = [];
  const lapMult = parameters?.lapLengthMultiplier ?? 50;
  const hookMult = parameters?.hookAllowanceMultiplier ?? 24;
  const maxStockLengthM = parameters?.maxStockLengthM ?? 12.0;
  const calcOpts = { maxStockLengthM, lapLengthMultiplier: lapMult, hookAllowanceMultiplier: hookMult };

  for (const m of members) {
    const numMembers = Math.max(1, m.countOnLayout || 1);
    const defaultCover =
      parameters?.defaultCoverMm?.[m.category as keyof typeof parameters.defaultCoverMm] ??
      (m.category === 'footing' ? 50 : m.category === 'column' ? 40 : m.category === 'beam' ? 25 : 20);
    const cover = m.clearCoverMm || defaultCover;
    const span = Math.max(500, m.spanMm || (m.category === 'column' ? parameters?.defaultFloorHeightMm || 3000 : 3000));
    const width = Math.max(100, m.widthMm || 230);
    const depth = Math.max(100, m.depthMm || 450);
    const thickness = m.thicknessMm || 150;
    const floorLabel = m.floorLevel ? ` [${m.floorLevel}]` : '';

    // 1. Beams
    if (m.category === 'beam') {
      const mainDia = m.mainBars?.diameter || 16;
      const devLength = lapMult * mainDia;

      // Bottom Main Bars
      if (m.mainBars && m.mainBars.count > 0) {
        result.push(
          recalculateBarItem(
            {
              memberId: m.mark,
              memberType: 'beam',
              floorLevel: m.floorLevel,
              mark: `Bottom Main${floorLabel}`,
              diameter: mainDia,
              shape: m.mainBars.shape || 'l_bend',
              dimA: span,
              dimB: devLength,
              numMembers,
              barsPerMember: m.mainBars.count,
              notes: `Span ${Math.round(span)}mm, b×D ${width}×${depth}mm (Ld=${lapMult}d)`,
            },
            calcOpts
          )
        );
      }

      // Top Continuous / Anchor Bars
      if (m.secondaryBars && m.secondaryBars.count > 0) {
        const topDia = m.secondaryBars.diameter || 12;
        result.push(
          recalculateBarItem(
            {
              memberId: m.mark,
              memberType: 'beam',
              floorLevel: m.floorLevel,
              mark: `Top Continuous${floorLabel}`,
              diameter: topDia,
              shape: m.secondaryBars.shape || 'l_bend',
              dimA: span,
              dimB: lapMult * topDia,
              numMembers,
              barsPerMember: m.secondaryBars.count,
              notes: `Top continuous anchor bars`,
            },
            calcOpts
          )
        );
      }

      // Top Support Extra (Curtailment Bars per IS 13920: 0.25L + Ld at each support)
      if (m.topSupportExtraBars && m.topSupportExtraBars.count > 0) {
        const extDia = m.topSupportExtraBars.diameter || 16;
        const ratio = m.topSupportExtraBars.curtailmentRatio || 0.25;
        const extLen = Math.round(span * ratio);
        result.push(
          recalculateBarItem(
            {
              memberId: m.mark,
              memberType: 'beam',
              floorLevel: m.floorLevel,
              mark: `Top Support Extra (2 ends)${floorLabel}`,
              diameter: extDia,
              shape: 'l_bend',
              dimA: extLen,
              dimB: lapMult * extDia,
              numMembers,
              barsPerMember: m.topSupportExtraBars.count * 2,
              notes: `Curtailed @ ${Math.round(ratio * 100)}% span (${extLen}mm + ${lapMult}d anchorage)`,
            },
            calcOpts
          )
        );
      }

      // Stirrups (Supports IS 13920 2-zone confinement + mid-span spacing)
      if (m.stirrups && m.stirrups.spacingMm > 0) {
        const stirrupA = Math.max(80, width - 2 * cover);
        const stirrupB = Math.max(80, depth - 2 * cover);
        const effDepth = Math.max(150, depth - cover);
        const suppSpacing =
          m.stirrups.supportSpacingMm ||
          (parameters?.seismicDuctileDetailing ? Math.min(100, Math.round(effDepth / 4)) : 0);

        let stirrupCount = Math.max(3, Math.round(span / m.stirrups.spacingMm) + 1);
        let spacingNote = `@ ${m.stirrups.spacingMm}mm c/c`;

        if (suppSpacing > 0 && suppSpacing < m.stirrups.spacingMm && span > 4 * effDepth) {
          const confZoneLen = 2 * effDepth; // 2d at each support face per IS 13920
          const endCount = 2 * Math.ceil(confZoneLen / suppSpacing);
          const midLen = Math.max(0, span - 2 * confZoneLen);
          const midCount = Math.ceil(midLen / m.stirrups.spacingMm) + 1;
          stirrupCount = endCount + midCount;
          spacingNote = `IS 13920: @ ${suppSpacing}mm (ends) & ${m.stirrups.spacingMm}mm (mid)`;
        }

        result.push(
          recalculateBarItem(
            {
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
              notes: `${spacingNote} across ${Math.round(span)}mm span`,
            },
            calcOpts
          )
        );
      }
    }

    // 2. Columns
    else if (m.category === 'column') {
      const mainDia = m.mainBars?.diameter || 16;
      const lapLength = lapMult * mainDia;

      if (m.mainBars && m.mainBars.count > 0) {
        result.push(
          recalculateBarItem(
            {
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
              notes: `Height ${Math.round(span)}mm + ${lapLength}mm (${lapMult}d) lap, size ${width}×${depth}mm`,
            },
            calcOpts
          )
        );
      }

      // Lateral Ties
      if (m.stirrups && m.stirrups.spacingMm > 0) {
        const tieA = Math.max(80, width - 2 * cover);
        const tieB = Math.max(80, depth - 2 * cover);
        const tieCount = Math.max(3, Math.round(span / m.stirrups.spacingMm) + 1);

        result.push(
          recalculateBarItem(
            {
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
            },
            calcOpts
          )
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
        recalculateBarItem(
          {
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
          },
          calcOpts
        )
      );

      result.push(
        recalculateBarItem(
          {
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
          },
          calcOpts
        )
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
        recalculateBarItem(
          {
            memberId: m.mark,
            memberType: 'slab',
            floorLevel: m.floorLevel,
            mark: `Short Span Main (Cranked)${floorLabel}`,
            diameter: mainDia,
            shape: 'crank',
            dimA: span - 2 * cover,
            dimB: 200,
            dimC: 200,
            dimD: Math.max(60, thickness - 2 * cover),
            numMembers,
            barsPerMember: countX,
            notes: `Thk ${thickness}mm @ ${spacingX}mm c/c`,
          },
          calcOpts
        )
      );

      result.push(
        recalculateBarItem(
          {
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
          },
          calcOpts
        )
      );

      // Chair bars (1 per m2 of slab area)
      const areaM2 = (span / 1000) * (depth / 1000);
      const chairCount = Math.max(2, Math.ceil(areaM2));
      result.push(
        recalculateBarItem(
          {
            memberId: m.mark,
            memberType: 'slab',
            floorLevel: m.floorLevel,
            mark: `Chair Bars${floorLabel}`,
            diameter: Math.max(10, mainDia),
            shape: 'chair',
            dimA: 300,
            dimB: Math.max(50, thickness - 2 * cover - 20),
            dimC: 400,
            numMembers,
            barsPerMember: chairCount,
            notes: `1 chair per m² (${areaM2.toFixed(1)} m²)`,
          },
          calcOpts
        )
      );
    }

    // 5. Generic / Wall / Other
    else {
      const dia = m.mainBars?.diameter || 12;
      result.push(
        recalculateBarItem(
          {
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
          },
          calcOpts
        )
      );
    }

    // 6. Attached Plan Callout Extra Bars (applicable to ANY component!)
    if (m.extraBars && m.extraBars.length > 0) {
      for (const callout of m.extraBars) {
        const extraDia = callout.diameter || 16;
        const extraCount = callout.count || 2;
        const extraLen = callout.lengthMm || Math.round(span / 3 + lapMult * extraDia);

        result.push(
          recalculateBarItem(
            {
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
            },
            calcOpts
          )
        );
      }
    }
  }

  return result;
}

/**
 * Calculates continuous multi-span beam reinforcement from Longitudinal Sections (L-Sections).
 * Accounts for continuous bottom & top bars across supports, stock length lap splices (> 12m),
 * mid-span curtailments, support hogging top extras, and confinement zone stirrup spacing.
 */
export function generateBbsFromLongitudinalSections(
  longitudinalSections: LongitudinalSectionDefinition[] = [],
  parameters?: Partial<StructuralEstimateState['parameters']>
): BbsBarItem[] {
  const result: BbsBarItem[] = [];
  const lapMult = parameters?.lapLengthMultiplier ?? 50;
  const hookMult = parameters?.hookAllowanceMultiplier ?? 24;
  const maxStockLengthM = parameters?.maxStockLengthM ?? 12.0;
  const calcOpts = { maxStockLengthM, lapLengthMultiplier: lapMult, hookAllowanceMultiplier: hookMult };

  for (const ls of longitudinalSections) {
    if (!ls.spans || ls.spans.length === 0) continue;

    const spans = ls.spans;
    const numSpans = spans.length;
    const lsTitle = ls.name || `LS (${spans.map((s) => s.beamMark).join(' + ')})`;

    // Compute continuous clear spans and column support widths
    const totalClearSpanMm = spans.reduce((sum, s) => sum + (s.clearSpanMm || 3500), 0);
    const totalIntermediateColWidthMm = spans.slice(0, -1).reduce((sum, s, idx) => {
      const colW = s.supportColRightMm || spans[idx + 1]?.supportColLeftMm || 350;
      return sum + colW;
    }, 0);

    const firstSpan = spans[0];
    const lastSpan = spans[numSpans - 1];

    // 1. Continuous Bottom Bars
    if (ls.reinforcement.bottomContinuousBars && ls.reinforcement.bottomContinuousBars.count > 0) {
      const dia = ls.reinforcement.bottomContinuousBars.diameter;
      const count = ls.reinforcement.bottomContinuousBars.count;
      const devLength = lapMult * dia;
      const baseContLen = totalClearSpanMm + totalIntermediateColWidthMm + 2 * devLength;

      // Check stock length lapping (> 12.0m)
      const numLaps = Math.max(0, Math.floor(baseContLen / (maxStockLengthM * 1000)));
      const lapAllowanceMm = numLaps * (lapMult * dia);
      const totalCutLenMm = baseContLen + lapAllowanceMm;

      result.push(
        recalculateBarItem(
          {
            memberId: lsTitle,
            memberType: 'beam',
            mark: `Bottom Continuous (${spans.map((s) => s.beamMark).join('~')})`,
            diameter: dia,
            shape: 'u_hook',
            dimA: totalCutLenMm,
            dimB: devLength,
            dimC: devLength,
            numMembers: 1,
            barsPerMember: count,
            notes: `Continuous over ${numSpans} spans (${(totalClearSpanMm / 1000).toFixed(2)}m)${
              numLaps > 0
                ? ` with ${numLaps} lap splice(s) (${lapMult}d=${(lapAllowanceMm / 1000).toFixed(2)}m)`
                : ' (single stock cut)'
            }`,
          },
          calcOpts
        )
      );
    }

    // 2. Mid-Span Curtailed Bottom Bars (Per Span)
    if (ls.reinforcement.bottomCurtailedBars && ls.reinforcement.bottomCurtailedBars.count > 0) {
      const dia = ls.reinforcement.bottomCurtailedBars.diameter;
      const count = ls.reinforcement.bottomCurtailedBars.count;
      const ratio = ls.reinforcement.bottomCurtailedBars.curtailRatio || 0.15;

      for (const s of spans) {
        const curLen = Math.round(s.clearSpanMm * (1 - 2 * ratio));
        result.push(
          recalculateBarItem(
            {
              memberId: lsTitle,
              memberType: 'beam',
              mark: `Bottom Curtailed (${s.beamMark})`,
              diameter: dia,
              shape: 'straight',
              dimA: curLen,
              numMembers: 1,
              barsPerMember: count,
              notes: `${s.beamMark} mid-span curtailment (${ratio * 100}% offset each side, span ${(s.clearSpanMm / 1000).toFixed(2)}m)`,
            },
            calcOpts
          )
        );
      }
    }

    // 3. Continuous Top Hanger / Anchor Bars
    if (ls.reinforcement.topContinuousBars && ls.reinforcement.topContinuousBars.count > 0) {
      const dia = ls.reinforcement.topContinuousBars.diameter;
      const count = ls.reinforcement.topContinuousBars.count;
      const devLength = lapMult * dia;
      const baseTopLen = totalClearSpanMm + totalIntermediateColWidthMm + 2 * devLength;
      const numLaps = Math.max(0, Math.floor(baseTopLen / (maxStockLengthM * 1000)));
      const lapAllowanceMm = numLaps * (lapMult * dia);
      const totalCutLenMm = baseTopLen + lapAllowanceMm;

      result.push(
        recalculateBarItem(
          {
            memberId: lsTitle,
            memberType: 'beam',
            mark: `Top Continuous Hanger (${spans.map((s) => s.beamMark).join('~')})`,
            diameter: dia,
            shape: 'u_hook',
            dimA: totalCutLenMm,
            dimB: devLength,
            dimC: devLength,
            numMembers: 1,
            barsPerMember: count,
            notes: `Top continuous hanger bars across ${numSpans} spans${
              numLaps > 0 ? ` with ${numLaps} lap(s)` : ''
            }`,
          },
          calcOpts
        )
      );
    }

    // 4. Support Top Extra Bars (Hogging Moment Bars Over Supports)
    if (ls.reinforcement.supportTopExtraBars && ls.reinforcement.supportTopExtraBars.count > 0) {
      const dia = ls.reinforcement.supportTopExtraBars.diameter;
      const count = ls.reinforcement.supportTopExtraBars.count;
      const extRatio = ls.reinforcement.supportTopExtraBars.extensionRatio || 0.33;

      // Over intermediate supports
      for (let i = 0; i < numSpans - 1; i++) {
        const leftSpan = spans[i];
        const rightSpan = spans[i + 1];
        const colW = leftSpan.supportColRightMm || rightSpan.supportColLeftMm || 350;
        const leftExt = Math.round(leftSpan.clearSpanMm * extRatio);
        const rightExt = Math.round(rightSpan.clearSpanMm * extRatio);
        const totalExtraLen = leftExt + colW + rightExt;

        result.push(
          recalculateBarItem(
            {
              memberId: lsTitle,
              memberType: 'beam',
              mark: `Top Extra over Support (${leftSpan.beamMark} | ${rightSpan.beamMark})`,
              diameter: dia,
              shape: 'straight',
              dimA: totalExtraLen,
              numMembers: 1,
              barsPerMember: count,
              notes: `Extends L/3 (${(leftExt / 1000).toFixed(2)}m left + ${(colW / 1000).toFixed(2)}m col + ${(rightExt / 1000).toFixed(2)}m right)`,
            },
            calcOpts
          )
        );
      }

      // Over end supports (anchored into end column + extending L/4 or L/3 into span)
      const endExtLeft = Math.round(firstSpan.clearSpanMm * 0.25);
      const endDevLeft = lapMult * dia;
      result.push(
        recalculateBarItem(
          {
            memberId: lsTitle,
            memberType: 'beam',
            mark: `Top Extra @ End Support (${firstSpan.beamMark})`,
            diameter: dia,
            shape: 'l_bend',
            dimA: endExtLeft,
            dimB: endDevLeft,
            numMembers: 1,
            barsPerMember: count,
            notes: `End support anchorage into col (${(endExtLeft / 1000).toFixed(2)}m in span + Ld)`,
          },
          calcOpts
        )
      );

      const endExtRight = Math.round(lastSpan.clearSpanMm * 0.25);
      const endDevRight = lapMult * dia;
      result.push(
        recalculateBarItem(
          {
            memberId: lsTitle,
            memberType: 'beam',
            mark: `Top Extra @ End Support (${lastSpan.beamMark})`,
            diameter: dia,
            shape: 'l_bend',
            dimA: endExtRight,
            dimB: endDevRight,
            numMembers: 1,
            barsPerMember: count,
            notes: `End support anchorage into col (${(endExtRight / 1000).toFixed(2)}m in span + Ld)`,
          },
          calcOpts
        )
      );
    }

    // 5. Stirrups (Confinement Zones + Mid-Span Zone Per Span)
    if (ls.reinforcement.stirrups && ls.reinforcement.stirrups.diameter > 0) {
      const st = ls.reinforcement.stirrups;
      const dia = st.diameter || 8;
      const spEnd = st.spacingEndMm || 100;
      const spMid = st.spacingMidMm || 175;

      for (const s of spans) {
        const spanW = s.widthMm || 230;
        const spanD = s.depthMm || 450;
        const cover = 25;
        const stirrupA = Math.max(80, spanW - 2 * cover);
        const stirrupB = Math.max(80, spanD - 2 * cover);
        const effDepth = Math.max(150, spanD - cover);

        const confZoneLen = st.confinementZoneMm || 2 * effDepth; // 2d confinement zone per IS 13920
        const endCount = 2 * Math.ceil(confZoneLen / spEnd);
        const midLen = Math.max(0, s.clearSpanMm - 2 * confZoneLen);
        const midCount = Math.ceil(midLen / spMid) + 1;
        const totalStirrupsForSpan = endCount + midCount;

        result.push(
          recalculateBarItem(
            {
              memberId: lsTitle,
              memberType: 'beam',
              mark: `Stirrups (${s.beamMark})`,
              diameter: dia,
              shape: 'stirrup_rect',
              dimA: stirrupA,
              dimB: stirrupB,
              numMembers: 1,
              barsPerMember: totalStirrupsForSpan,
              notes: `${s.beamMark} (${spanW}×${spanD}mm): ${endCount} in 2d confinement (@${spEnd}mm) + ${midCount} mid (@${spMid}mm)`,
            },
            calcOpts
          )
        );
      }
    }
  }

  return result;
}

/**
 * Combines Longitudinal Section bar items with remaining individual structural members,
 * ensuring beams covered by an LS are not counted twice.
 */
export function generateCompleteBbs(
  members: StructuralMemberDefinition[],
  longitudinalSections: LongitudinalSectionDefinition[] = [],
  parameters?: Partial<StructuralEstimateState['parameters']>
): BbsBarItem[] {
  const coveredBeamMarks = new Set<string>();
  for (const ls of longitudinalSections) {
    for (const span of ls.spans || []) {
      if (span.beamMark) {
        coveredBeamMarks.add(span.beamMark.trim().toUpperCase());
      }
    }
  }

  const nonCoveredMembers = members.filter((m) => {
    if (m.category === 'beam') {
      return !coveredBeamMarks.has(m.mark.trim().toUpperCase());
    }
    return true;
  });

  const memberBars = generateBbsFromMemberDefinitions(nonCoveredMembers, parameters);
  const lsBars = generateBbsFromLongitudinalSections(longitudinalSections, parameters);

  return [...lsBars, ...memberBars];
}

/**
 * Instant deterministic IS 456:2000 / IS 13920:2016 & Project Constraint Checker.
 */
export function runLocalIs456Audit(
  members: StructuralMemberDefinition[],
  parameters?: Partial<StructuralEstimateState['parameters']>
): CivilAuditAnomaly[] {
  const anomalies: CivilAuditAnomaly[] = [];
  const allowedSet = new Set(parameters?.allowedDiameters || [8, 10, 12, 16, 20, 25, 28, 32]);

  for (const m of members) {
    const b = Math.max(100, m.widthMm || 230);
    const d = Math.max(100, m.depthMm || 450);
    const grossArea = b * d;

    const checkDia = (role: string, dia?: number) => {
      if (dia && !allowedSet.has(dia)) {
        anomalies.push({
          memberMark: m.mark,
          severity: 'warning',
          codeClause: 'Project Constraint',
          message: `${m.mark}: ${role} bar Φ${dia}mm is outside allowed project diameters (${Array.from(allowedSet).join(', ')}mm)`,
        });
      }
    };

    checkDia('Main', m.mainBars?.diameter);
    checkDia('Top/Secondary', m.secondaryBars?.diameter);
    checkDia('Support Extra', m.topSupportExtraBars?.diameter);
    checkDia('Stirrup', m.stirrups?.diameter);

    const mainCount = m.mainBars?.count || 0;
    const mainDia = m.mainBars?.diameter || 16;
    const astMain = mainCount * ((Math.PI * mainDia * mainDia) / 4);

    if (m.category === 'column') {
      const pt = (astMain / grossArea) * 100;
      if (pt < 0.8) {
        anomalies.push({
          memberMark: m.mark,
          severity: 'error',
          codeClause: 'IS 456 Cl. 26.5.3.1',
          message: `${m.mark} (${b}×${d}): Longitudinal steel is ${pt.toFixed(2)}% (< 0.80% minimum for columns)`,
        });
      } else if (pt > 4.0) {
        anomalies.push({
          memberMark: m.mark,
          severity: 'warning',
          codeClause: 'IS 456 Cl. 26.5.3.1',
          message: `${m.mark} (${b}×${d}): Longitudinal steel is ${pt.toFixed(2)}% (> 4.0% practical lapped column limit)`,
        });
      }
    } else if (m.category === 'beam') {
      const pt = (astMain / grossArea) * 100;
      if (pt < 0.18) {
        anomalies.push({
          memberMark: m.mark,
          severity: 'error',
          codeClause: 'IS 456 Cl. 26.5.1.1',
          message: `${m.mark} (${b}×${d}): Tension steel is ${pt.toFixed(2)}% (below IS 456 minimum 0.85/fy)`,
        });
      } else if (pt > 2.5) {
        anomalies.push({
          memberMark: m.mark,
          severity: 'warning',
          codeClause: 'IS 456 Cl. 26.5.1.1b',
          message: `${m.mark} (${b}×${d}): Tension steel is ${pt.toFixed(2)}% (> 2.5% bar congestion threshold)`,
        });
      }

      if (m.stirrups?.spacingMm) {
        const maxSpacing = Math.min(Math.round(0.75 * (d - (m.clearCoverMm || 25))), 300);
        if (m.stirrups.spacingMm > maxSpacing) {
          anomalies.push({
            memberMark: m.mark,
            severity: 'error',
            codeClause: 'IS 456 Cl. 26.5.1.5',
            message: `${m.mark}: Stirrup spacing ${m.stirrups.spacingMm}mm exceeds max allowed ${maxSpacing}mm`,
          });
        }
      }
    }
  }

  return anomalies;
}


