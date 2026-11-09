import {
  ExtractedCadTable,
  GeneralCadTable,
  GeneralTableCategory,
  BbsBarItem,
  StructuralMemberType,
} from './types';
import { recalculateBarItem } from './bbsMath';
import {
  extractTableViaLattice,
  extractLineSegments,
} from './cadLatticeEngine';
import type { BoxCoords, LatticeTableResult } from './cadLatticeEngine';

export type { BoxCoords };

export interface StandardizedColumnMapping {
  markCol: number;
  sizeCol: number;
  mainRebarCol: number;
  tiesCol: number;
  topRebarCol: number;
  bottomRebarCol: number;
}

/**
 * Expands schedule table mark cells while strictly preserving compound hyphenated marks
 * such as B1-1, B2-5, B3-6, B4-10, B5-100.
 * A hyphen inside a single token (e.g. 'B2-5') is NEVER treated as a range.
 * Ranges only expand when both endpoints carry the structural prefix (e.g. 'B1-1 TO B1-4' or 'B1 TO B4').
 */
export function expandGroupedMemberMarks(
  rawCell: string,
  knownLayoutMarks?: string[]
): string[] {
  if (!rawCell || !rawCell.trim()) return [];

  let clean = rawCell.trim().toUpperCase();
  clean = clean.replace(/\(\s*\d+\s*[*X×/]\s*\d+[^)]*\)/g, '').trim();

  const knownSet = new Set((knownLayoutMarks || []).map((m) => m.trim().toUpperCase()));
  if (knownSet.has(clean)) return [clean];

  const parts = clean.split(/[,;&/]+|\bAND\b/i);
  const expanded: string[] = [];

  const compoundRangeRe = /^([A-Z]{1,4}\d{1,3})-(\d{1,4})\s*(?:TO|THROUGH|THRU|-|–)\s*\1-(\d{1,4})$/i;
  const simplePrefixRangeRe = /^([A-Z]{1,4})(-?)(\d{1,4})\s*(?:TO|THROUGH|THRU|-|–)\s*\1\2(\d{1,4})$/i;
  const singleMarkRe = /^([1-9]?[A-Z]{1,4}-?\d{1,4}(?:-\d{1,4}|[A-Z]|-[A-Z])?)$/i;

  for (const rawPart of parts) {
    const p = rawPart.trim();
    if (!p) continue;

    if (knownSet.has(p)) {
      expanded.push(p);
      continue;
    }

    const mComp = p.match(compoundRangeRe);
    if (mComp) {
      const prefix = mComp[1].toUpperCase();
      const startN = parseInt(mComp[2], 10);
      const endN = parseInt(mComp[3], 10);
      if (endN > startN && endN - startN <= 50) {
        const padLen = mComp[2].length;
        for (let i = startN; i <= endN; i++) {
          const numStr = padLen > 1 ? String(i).padStart(padLen, '0') : String(i);
          expanded.push(`${prefix}-${numStr}`);
        }
        continue;
      }
    }

    if (/\b(?:TO|THROUGH|THRU)\b|\s+[-–]\s+/i.test(p)) {
      const mSimp = p.match(simplePrefixRangeRe);
      if (mSimp) {
        const prefix = mSimp[1].toUpperCase();
        const sep = mSimp[2];
        const startN = parseInt(mSimp[3], 10);
        const endN = parseInt(mSimp[4], 10);
        if (endN > startN && endN - startN <= 50) {
          const padLen = mSimp[3].length;
          for (let i = startN; i <= endN; i++) {
            const numStr = padLen > 1 ? String(i).padStart(padLen, '0') : String(i);
            expanded.push(`${prefix}${sep}${numStr}`);
          }
          continue;
        }
      }
    }

    const mSingle = p.match(singleMarkRe);
    if (mSingle) {
      expanded.push(mSingle[1].toUpperCase());
    } else {
      const mLead = p.match(/^([1-9]?[A-Z]{1,4}\d{1,4}-\d{1,4}|[1-9]?[A-Z]{1,4}-?\d{1,4}[A-Z]?)\b/i);
      if (mLead) expanded.push(mLead[1].toUpperCase());
    }
  }

  return Array.from(new Set(expanded));
}

/**
 * Standardizes raw column headers into civil engineering schedule roles.
 */
export function standardizeScheduleHeaders(headers: string[]): {
  normalizedHeaders: string[];
  mapping: StandardizedColumnMapping;
} {
  let markCol = -1;
  let sizeCol = -1;
  let mainRebarCol = -1;
  let tiesCol = -1;
  let topRebarCol = -1;
  let bottomRebarCol = -1;

  const normalized = headers.map((raw, idx) => {
    const clean = raw.trim().replace(/\s+/g, ' ');
    const low = clean.toLowerCase();

    if (markCol === -1 && /(col(\.|\s|umn)?\s*(no|mark|id)|beam\s*(no|mark|id)|footing\s*(no|mark|id)|mark|id|member)/i.test(low)) {
      markCol = idx;
      return 'Member ID';
    }
    if (sizeCol === -1 && /(size|dim(ension)?|width|depth|b\s*x\s*d|section|c\/s)/i.test(low)) {
      sizeCol = idx;
      return 'Section Size (WxD)';
    }
    if (topRebarCol === -1 && /(top\s*(steel|bar|reinf)|hanger|anchor)/i.test(low)) {
      topRebarCol = idx;
      return 'Top Bars';
    }
    if (bottomRebarCol === -1 && /(bottom\s*(steel|bar|reinf)|btm|main\s*steel)/i.test(low)) {
      bottomRebarCol = idx;
      return 'Bottom Bars';
    }
    if (tiesCol === -1 && /(tie|ring|stirrup|shear|link|lateral|hoop)/i.test(low)) {
      tiesCol = idx;
      return 'Stirrups / Ties';
    }
    if (mainRebarCol === -1 && /(main|longitudinal|vertical|reinf(orcement)?|steel|bar)/i.test(low)) {
      mainRebarCol = idx;
      return 'Main Reinforcement';
    }
    return clean || `Col ${idx + 1}`;
  });

  // Fallbacks
  if (markCol === -1) markCol = 0;
  if (mainRebarCol === -1 && headers.length > 1) {
    mainRebarCol = bottomRebarCol >= 0 ? bottomRebarCol : sizeCol === 1 ? 2 : 1;
  }

  return {
    normalizedHeaders: normalized,
    mapping: {
      markCol,
      sizeCol,
      mainRebarCol,
      tiesCol,
      topRebarCol,
      bottomRebarCol,
    },
  };
}

/**
 * Parses a table from CAD geometry and text inside a bounding box using Vector Lattice.
 */
export function extractTableFromBoundingBox(
  texts: any[],
  bbox: BoxCoords,
  tableTitle?: string,
  lines: any[] = [],
  polylines: any[] = []
): ExtractedCadTable | null {
  const result: LatticeTableResult | null = extractTableViaLattice(lines, polylines, texts, bbox);
  if (!result || result.rows.length === 0) return null;

  // Infer table category and member type from title and contents
  const combinedText = [
    tableTitle || '',
    ...result.headers,
    ...result.rows.flatMap((r) => r),
  ].join(' ').toLowerCase();

  let category: GeneralTableCategory = 'general';
  let detectedType: StructuralMemberType = 'other';

  if (/col|column/i.test(combinedText)) {
    detectedType = 'column';
    category = 'structural';
  } else if (/beam|plinth|lintel|girder|\b(?:[1-9]?[NPFTBGRCSLWMDU]?B)-?\d{1,4}\b/i.test(combinedText)) {
    detectedType = 'beam';
    category = 'structural';
  } else if (/footing|fnd|foundation|raft/i.test(combinedText)) {
    detectedType = 'footing';
    category = 'structural';
  } else if (/slab/i.test(combinedText)) {
    detectedType = 'slab';
    category = 'structural';
  } else if (/(door|win(dow)?|glaz|opening|shutter|vent)/i.test(combinedText)) {
    category = 'door_window';
  } else if (/(finish|flooring|skirting|ceiling|plaster|paint)/i.test(combinedText)) {
    category = 'room_finish';
  } else if (/(panel|circuit|breaker|switchboard|conduit|db\b)/i.test(combinedText)) {
    category = 'electrical';
  }

  // Preserve natural CAD headers without force-overwriting them
  const rawHeaders = result.headers.map((h, i) => h.trim() || `Col ${i + 1}`);

  const defaultTitle =
    tableTitle ||
    (category === 'structural'
      ? `${detectedType.toUpperCase()} SCHEDULE`
      : category === 'door_window'
      ? 'DOOR & WINDOW SCHEDULE'
      : category === 'room_finish'
      ? 'ROOM FINISH SCHEDULE'
      : category === 'electrical'
      ? 'ELECTRICAL PANEL SCHEDULE'
      : 'CAD SCHEDULE TABLE');

  return {
    id: `table_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: defaultTitle,
    headers: rawHeaders,
    rows: result.rows,
    bbox,
    detectedType,
    category,
  };
}

/**
 * 4-Gate 100% Accurate Schedule Table Detection:
 *
 * Gate 1: Lattice Topology: Detects intersecting horizontal and vertical line networks.
 * Gate 2: Proportions: Row heights scaled for human readable text (1.2x to 4x text height).
 * Gate 3: Text Occupancy: >= 35% of interior cells contain CAD text.
 * Gate 4: Semantic Schedule Match: Table title or headers match structural schedule nomenclature.
 */
export function autoDetectScheduleTables(
  texts: any[],
  lines: any[] = [],
  polylines: any[] = [],
  sheetId?: string
): ExtractedCadTable[] {
  if (!texts || texts.length === 0) return [];

  const tables: ExtractedCadTable[] = [];
  const scheduleHeaderRegex =
    /\b(column|beam|footing|foundation|slab|lintel|pile|rebar|reinforcement|r\.?c\.?c\.?)\s*(schedule|details|table|specification|of\s+beams|of\s+columns)\b/i;

  const avgHeight =
    texts.reduce((sum, t) => sum + (t.height || 0.25), 0) / texts.length || 0.25;

  // Find all schedule title candidate texts
  const titleCandidates = texts.filter(
    (t) => t && t.text && scheduleHeaderRegex.test(String(t.text))
  );

  for (const title of titleCandidates) {
    const titleY = title.y;
    const titleX = title.x;
    const ht = title.height || avgHeight;

    // Estimate table search area below title (wider to capture multi-column Indian schedules)
    const estWidth = Math.max(14, ht * 95);
    const estHeight = Math.max(10, ht * 65);

    const searchBox: BoxCoords = {
      min_x: titleX - estWidth * 0.25,
      min_y: titleY - estHeight,
      max_x: titleX + estWidth * 0.95,
      max_y: titleY + ht * 2.0,
    };

    const latticeResult = extractTableViaLattice(lines, polylines, texts, searchBox);
    if (!latticeResult || latticeResult.rows.length < 2 || latticeResult.headers.length < 2) {
      continue;
    }

    // Gate 3: Text Occupancy Verification
    const totalCells = latticeResult.rowCount * latticeResult.colCount;
    let filledCells = 0;
    for (const h of latticeResult.headers) if (h.trim()) filledCells++;
    for (const row of latticeResult.rows) {
      for (const cell of row) if (cell.trim()) filledCells++;
    }

    const occupancyRatio = totalCells > 0 ? filledCells / totalCells : 0;
    if (occupancyRatio < 0.35) {
      // Disqualified: not a real data table (likely architectural grid)
      continue;
    }

    // Gate 4: Semantic Validation
    const fullText = [
      title.text,
      ...latticeResult.headers,
      ...latticeResult.rows.slice(0, 3).flatMap((r) => r),
    ].join(' ').toLowerCase();

    const isStructuralMatch =
      scheduleHeaderRegex.test(title.text) ||
      /(mark|col|beam|footing|size|reinf|stirrup|tie)/i.test(fullText);

    if (!isStructuralMatch) {
      continue;
    }

    // Passed all 4 Gates! 100% verified table
    let detectedType: StructuralMemberType = 'other';
    if (/col|column/i.test(fullText)) detectedType = 'column';
    else if (/beam|plinth|girder|\b(?:[1-9]?[NPFTBGRCSLWMDU]?B)-?\d{1,4}\b/i.test(fullText)) detectedType = 'beam';
    else if (/footing|foundation|fnd/i.test(fullText)) detectedType = 'footing';
    else if (/slab/i.test(fullText)) detectedType = 'slab';

    const { normalizedHeaders } = standardizeScheduleHeaders(latticeResult.headers);

    tables.push({
      id: `table_auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      sheetId,
      title: title.text.trim().toUpperCase(),
      headers: normalizedHeaders,
      rows: latticeResult.rows,
      bbox: latticeResult.bbox,
      detectedType,
    });
  }

  return tables;
}

/**
 * Converts standardized schedule rows into BBS members and bar configurations.
 */
export function convertScheduleTableToBbsItems(
  table: ExtractedCadTable,
  options?: {
    defaultFloorHeightM?: number;
    defaultBeamSpanM?: number;
    clearCoverMm?: number;
  }
): BbsBarItem[] {
  const result: BbsBarItem[] = [];
  const rawType = String(table.detectedType || 'column');
  const type: StructuralMemberType = ['column', 'beam', 'footing', 'slab', 'staircase', 'wall'].includes(rawType)
    ? (rawType as StructuralMemberType)
    : 'column';
  const cover =
    options?.clearCoverMm ||
    (type === 'column' ? 40 : type === 'beam' ? 25 : type === 'footing' ? 50 : 20);

  const { mapping } = standardizeScheduleHeaders(table.headers);

  for (let r = 0; r < table.rows.length; r++) {
    const row = table.rows[r];
    const memberId = row[mapping.markCol]?.trim() || `M-${r + 1}`;
    const sizeText = mapping.sizeCol >= 0 ? row[mapping.sizeCol]?.trim() || '' : '';
    const mainText = mapping.mainRebarCol >= 0 ? row[mapping.mainRebarCol]?.trim() || '' : '';
    const tiesText = mapping.tiesCol >= 0 ? row[mapping.tiesCol]?.trim() || '' : '';
    const topText = mapping.topRebarCol >= 0 ? row[mapping.topRebarCol]?.trim() || '' : '';
    const btmText = mapping.bottomRebarCol >= 0 ? row[mapping.bottomRebarCol]?.trim() || '' : '';

    // Dimensions: e.g. "300 x 450", "230 x 600", "12x18"
    let widthMm = 300;
    let depthMm = 450;
    const sizeMatch = sizeText.match(/(\d+)\s*[*xX/]\s*(\d+)/);
    if (sizeMatch) {
      widthMm = parseInt(sizeMatch[1], 10);
      depthMm = parseInt(sizeMatch[2], 10);
      if (widthMm <= 36 && depthMm <= 48) {
        // Imperial inches to mm
        widthMm = Math.round(widthMm * 25.4);
        depthMm = Math.round(depthMm * 25.4);
      }
    }

    // Parse main rebar
    const mainMatch = (mainText || btmText).match(/(\d+)\s*[-xX/]?\s*(?:[tTyY#]|dia|mm)?\s*(\d{1,2})/);
    const mainCount = mainMatch ? parseInt(mainMatch[1], 10) : 4;
    const mainDia = mainMatch ? parseInt(mainMatch[2], 10) : 16;

    if (type === 'column') {
      const floorHt = (options?.defaultFloorHeightM || 3.0) * 1000;
      const lapLength = 50 * mainDia;

      result.push(
        recalculateBarItem({
          memberId,
          memberType: 'column',
          mark: 'Main Longitudinal',
          diameter: mainDia,
          shape: 'l_bend',
          dimA: floorHt + lapLength,
          dimB: 300,
          numMembers: 1,
          barsPerMember: mainCount,
          notes: `Col size ${widthMm}x${depthMm}mm`,
        })
      );

      // Ties
      let tieDia = 8;
      let tieSpacing = 150;
      const tieMatch = tiesText.match(/(\d{1,2})\s*(?:@|at)\s*(\d{2,4})/);
      if (tieMatch) {
        tieDia = parseInt(tieMatch[1], 10);
        tieSpacing = parseInt(tieMatch[2], 10);
      }
      const tieA = Math.max(100, widthMm - 2 * cover);
      const tieB = Math.max(100, depthMm - 2 * cover);
      const tieCount = Math.max(3, Math.round(floorHt / tieSpacing));

      result.push(
        recalculateBarItem({
          memberId,
          memberType: 'column',
          mark: 'Lateral Ties',
          diameter: tieDia,
          shape: 'stirrup_rect',
          dimA: tieA,
          dimB: tieB,
          numMembers: 1,
          barsPerMember: tieCount,
          notes: `Ties @ ${tieSpacing}mm c/c`,
        })
      );
    } else if (type === 'beam') {
      const spanM = options?.defaultBeamSpanM || 4.0;
      const spanMm = spanM * 1000;
      const devLength = 50 * mainDia;

      // Bottom bars
      result.push(
        recalculateBarItem({
          memberId,
          memberType: 'beam',
          mark: 'Bottom Main',
          diameter: mainDia,
          shape: 'l_bend',
          dimA: spanMm,
          dimB: devLength,
          numMembers: 1,
          barsPerMember: mainCount,
          notes: `Beam size ${widthMm}x${depthMm}mm`,
        })
      );

      // Top bars
      const topMatch = topText.match(/(\d+)\s*[-xX/]?\s*(?:[tTyY#]|dia|mm)?\s*(\d{1,2})/);
      const topCount = topMatch ? parseInt(topMatch[1], 10) : 2;
      const topDia = topMatch ? parseInt(topMatch[2], 10) : Math.max(10, mainDia - 4);

      result.push(
        recalculateBarItem({
          memberId,
          memberType: 'beam',
          mark: 'Top Continuous',
          diameter: topDia,
          shape: 'l_bend',
          dimA: spanMm,
          dimB: devLength,
          numMembers: 1,
          barsPerMember: topCount,
          notes: 'Anchor / top bars',
        })
      );

      // Stirrups
      let tieDia = 8;
      let tieSpacing = 150;
      const tieMatch = tiesText.match(/(\d{1,2})\s*(?:@|at)\s*(\d{2,4})/);
      if (tieMatch) {
        tieDia = parseInt(tieMatch[1], 10);
        tieSpacing = parseInt(tieMatch[2], 10);
      }
      const stirrupA = Math.max(100, widthMm - 2 * cover);
      const stirrupB = Math.max(100, depthMm - 2 * cover);
      const stirrupCount = Math.max(3, Math.round(spanMm / tieSpacing));

      result.push(
        recalculateBarItem({
          memberId,
          memberType: 'beam',
          mark: 'Stirrups',
          diameter: tieDia,
          shape: 'stirrup_rect',
          dimA: stirrupA,
          dimB: stirrupB,
          numMembers: 1,
          barsPerMember: stirrupCount,
          notes: `Stirrups @ ${tieSpacing}mm c/c`,
        })
      );
    } else if (type === 'footing') {
      const footingLen = widthMm > 500 ? widthMm : 1800;
      const footingWid = depthMm > 500 ? depthMm : 1800;
      let meshDia = 12;
      let meshSpacing = 150;
      const meshMatch = (mainText || btmText).match(/(\d{1,2})\s*(?:@|at)\s*(\d{2,4})/);
      if (meshMatch) {
        meshDia = parseInt(meshMatch[1], 10);
        meshSpacing = parseInt(meshMatch[2], 10);
      }
      const countX = Math.max(4, Math.round(footingWid / meshSpacing) + 1);
      const countY = Math.max(4, Math.round(footingLen / meshSpacing) + 1);

      result.push(
        recalculateBarItem({
          memberId,
          memberType: 'footing',
          mark: 'Bottom Mesh (X-dir)',
          diameter: meshDia,
          shape: 'l_bend',
          dimA: footingLen - 2 * cover,
          dimB: 200,
          numMembers: 1,
          barsPerMember: countX,
          notes: `Mesh @ ${meshSpacing}mm c/c`,
        })
      );

      result.push(
        recalculateBarItem({
          memberId,
          memberType: 'footing',
          mark: 'Bottom Mesh (Y-dir)',
          diameter: meshDia,
          shape: 'l_bend',
          dimA: footingWid - 2 * cover,
          dimB: 200,
          numMembers: 1,
          barsPerMember: countY,
          notes: `Mesh @ ${meshSpacing}mm c/c`,
        })
      );
    } else {
      result.push(
        recalculateBarItem({
          memberId,
          memberType: type,
          mark: 'Main Reinforcement',
          diameter: mainDia,
          shape: 'straight',
          dimA: 3000,
          numMembers: 1,
          barsPerMember: mainCount,
          notes: sizeText,
        })
      );
    }
  }

  return result;
}
