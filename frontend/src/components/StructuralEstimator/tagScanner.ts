import type {
  StructuralMemberType,
  ExtractedCadTable,
  BoxCoords,
  MemberDetectedGeometry,
} from './types';
import { detectMemberGeometry } from './cadGeometryEngine.ts';
import { expandGroupedMemberMarks } from './cadTableParser.ts';

export interface DiscoveredTag {
  mark: string;
  category: StructuralMemberType;
  countOnLayout: number;
  layers: string[];
  suggestedWidthMm?: number;
  suggestedDepthMm?: number;
  sizeSource?: 'schedule' | 'inline_text' | 'geometry' | 'manual';
  scheduleConflict?: { scheduleWidthMm: number; scheduleDepthMm: number };
  scheduleMainBars?: { count: number; diameter: number };
  scheduleSecondaryBars?: { count: number; diameter: number };
  scheduleStirrups?: { diameter: number; spacingMm: number; legs?: number };
  isVerifiedInLegend: boolean;
  textCoords: [number, number][];
  avgHeight: number;
  detectedGeometry?: MemberDetectedGeometry | null;
}

export interface LegendSectionSize {
  label: string; // e.g. "230 × 450"
  widthMm: number;
  depthMm: number;
  sourceTableId?: string;
  sourceText?: string;
}

/**
 * Delimiter-isolated exact structural token matcher.
 * Ensures searching for "S1" matches "S1", "S1 (125 THK)", "SLAB S1, S2", "(S1)", "S1/S2"
 * but NEVER collides with "S11", "S12", "NS1", "SS1", "S101", or "S1-A".
 */
export function isExactTokenMatch(rawText: string, targetMark: string): boolean {
  if (!rawText || !targetMark) return false;
  const cleanRaw = rawText.trim();
  const cleanTarget = targetMark.trim();

  if (cleanRaw.toUpperCase() === cleanTarget.toUpperCase()) return true;

  const escaped = cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match target surrounded by non-alphanumeric, non-hyphen, non-underscore delimiters
  const pattern = new RegExp(`(^|[^a-zA-Z0-9\\-_])(${escaped})([^a-zA-Z0-9\\-_]|$)`, 'i');
  return pattern.test(cleanRaw);
}

/**
 * Extracts all unique cross-section sizes (e.g. 230x450, 300x600, 9"x18")
 * found in schedule tables or drawing dimension annotations.
 */
export function extractLegendSectionSizes(
  scheduleTables: ExtractedCadTable[] = [],
  texts: any[] = []
): LegendSectionSize[] {
  const sizeMap = new Map<string, LegendSectionSize>();

  const parseSizeStr = (str: string, source: string) => {
    if (!str) return;
    const match = str.match(/(\d{2,4})\s*[*xX/×]\s*(\d{2,4})/);
    if (match) {
      let w = parseInt(match[1], 10);
      let d = parseInt(match[2], 10);
      if (w <= 36 && d <= 48) {
        // Imperial inches to mm
        w = Math.round(w * 25.4);
        d = Math.round(d * 25.4);
      }
      if (w >= 100 && w <= 2500 && d >= 100 && d <= 3000) {
        const key = `${w}×${d}`;
        if (!sizeMap.has(key)) {
          sizeMap.set(key, {
            label: `${w} × ${d}`,
            widthMm: w,
            depthMm: d,
            sourceText: source,
          });
        }
      }
    }
  };

  // 1. Scan extracted schedule tables
  for (const table of scheduleTables) {
    let sizeColIdx = -1;
    for (let c = 0; c < table.headers.length; c++) {
      if (/(size|dim|b\s*x\s*d|section|width|depth)/i.test(table.headers[c])) {
        sizeColIdx = c;
        break;
      }
    }
    if (sizeColIdx >= 0) {
      for (const row of table.rows) {
        if (row[sizeColIdx]) {
          parseSizeStr(row[sizeColIdx], table.title);
        }
      }
    }
  }

  // 2. Scan CAD texts for section dimension annotations (e.g. "B1 (230x450)", "COL 300x600")
  for (const t of texts) {
    if (!t || !t.text) continue;
    const s = String(t.text).trim();
    if (s.length >= 5 && s.length <= 40) {
      parseSizeStr(s, s);
    }
  }

  return Array.from(sizeMap.values()).sort((a, b) => a.widthMm - b.widthMm || a.depthMm - b.depthMm);
}

/**
 * Checks if a CAD layer is relevant for the target structural category.
 */
export function isLayerRelevantForScope(
  layerName: string = '',
  scope: StructuralMemberType
): 'high' | 'medium' | 'exclude' {
  const low = layerName.toLowerCase();

  // Definite exclusions (architectural fixtures, dimensions, electrical, plumbing)
  if (/(door|win(dow)?|wall|brick|elec|plumb|sanitary|furn|hatch|grid|axis|dim(ension)?|meas)/i.test(low)) {
    // Only exclude if it doesn't also contain structural keywords
    if (!/(col|beam|slab|ftg|footing|reinf)/i.test(low)) {
      return 'exclude';
    }
  }

  if (scope === 'beam') {
    if (/(beam|s-beam|bm|pb|tb|fb|rb|cb|rcc-beam)/i.test(low)) return 'high';
  } else if (scope === 'column') {
    if (/(col|s-col|pillar|rcc-col|stanchion)/i.test(low)) return 'high';
  } else if (scope === 'slab') {
    if (/(slab|s-slab|panel|rcc-slab|deck)/i.test(low)) return 'high';
  } else if (scope === 'footing') {
    if (/(ftg|footing|fnd|foundation|raft|pile|s-fnd)/i.test(low)) return 'high';
  }

  // General text layers
  if (/(text|anno|label|id|mark|tag|0$)/i.test(low)) return 'medium';

  return 'medium';
}

/**
 * Regex patterns for structural members supporting complex numbering:
 * - Beams: B1, B1-1, B2-5, PB1, PB1-1, TB1, FB1, RB1, CB1, GB1, SB1, B-101, 1B1, B1A, B1-A
 * - Columns: C1, C1-1, C1A, C-101, SC1, RC1, P1
 * - Slabs: S1, NS1 (Non-sunken), SS1 (Sunken), DS1 (Drop), FS1 (Flat), TS1 (Typical), CS1, S-1, S1A
 * - Footings: F1, CF1, RF1, PF1, F-101
 */
export function getStructuralTagPattern(scope: StructuralMemberType): RegExp {
  switch (scope) {
    case 'beam':
      // Matches B1, B1-1, B2-5, PB1, PB1-1, TB1, FB1, RB1, CB1, GB1, SB1, B-101, B100..B9999, 1B1, B1A, B1-A
      return /\b((?:[1-9]?[PFTBGRCS]?B|BEAM)-?\d{1,4}(?:[A-Z]|-\d{1,4}|-[A-Z])?)\b/i;

    case 'column':
      // Matches C1, C1-1, C1A, C-101, C100..C9999, SC1, RC1, P1, P-1, 1C1
      return /\b((?:[1-9]?[SRC]?C|COL|P)-?\d{1,4}(?:[A-Z]|-\d{1,4}|-[A-Z])?)\b/i;

    case 'slab':
      // Matches S1, NS1, SS1, DS1, FS1, TS1, CS1, S-1, S100..S9999, S1A, SLAB 1
      return /\b((?:[NDSTFC]?S|SLAB)-?\d{1,4}(?:[A-Z]|-\d{1,4})?)\b/i;

    case 'footing':
      // Matches F1, CF1, RF1, PF1, F-101, F100..F9999, FTG 1
      return /\b((?:[CRPF]?F|FTG)-?\d{1,4}(?:[A-Z]|-\d{1,4})?)\b/i;

    default:
      return /\b([A-Z]{1,3}-?\d{1,4}[A-Z]?)\b/i;
  }
}

/**
 * Multi-Pass Verification Scanner for Structural Member Tags:
 *
 * Pass 1: Layer affinity filtering
 * Pass 2: Exact structural tag regex matching
 * Pass 3: Text height consistency filtering (removes title blocks & dimensions)
 * Pass 4: Cross-referencing against Schedule & Legend tables
 */
export function scanStructuralTagsWithVerification(
  texts: any[] = [],
  scope: StructuralMemberType,
  scheduleTables: ExtractedCadTable[] = [],
  options?: {
    allowedLayers?: string[];
    customPrefix?: string;
    bbox?: BoxCoords;
    activeLegendTable?: ExtractedCadTable;
    lines?: any[];
    polylines?: any[];
    scaleToM?: number;
  }
): DiscoveredTag[] {
  if (!texts || texts.length === 0) return [];

  const tagPattern = options?.customPrefix?.trim()
    ? new RegExp(`\\b(${options.customPrefix.trim()}-?\\d{1,4}[A-Z]?(?:-\\d{1,4})?)\\b`, 'i')
    : getStructuralTagPattern(scope);

  // Calculate median text height for consistency check
  const heights = texts.map((t) => t.height || 0.25).filter((h) => h > 0).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || 0.25;

  const tagInstances = new Map<
    string,
    {
      coords: [number, number][];
      layers: Set<string>;
      heights: number[];
      rawStrings: string[];
    }
  >();

  // Extract known marks from schedule tables for Pass 4 cross-validation
  // Prioritize activeLegendTable if explicitly provided
  const tablesToScan = options?.activeLegendTable
    ? [options.activeLegendTable, ...scheduleTables.filter((t) => t.id !== options.activeLegendTable?.id)]
    : scheduleTables;

  const knownScheduleMarks = new Map<
    string,
    {
      widthMm?: number;
      depthMm?: number;
      mainBars?: { count: number; diameter: number };
      secondaryBars?: { count: number; diameter: number };
      stirrups?: { diameter: number; spacingMm: number; legs?: number };
    }
  >();
  for (const table of tablesToScan) {
    let markCol = 0;
    let sizeCol = -1;
    let topCol = -1;
    let btmCol = -1;
    let mainCol = -1;
    let tiesCol = -1;
    for (let c = 0; c < table.headers.length; c++) {
      const h = table.headers[c];
      if (/(mark|id|no|col|beam|footing|member)/i.test(h)) markCol = c;
      else if (/(size|dim|b\s*x\s*d|section|width)/i.test(h)) sizeCol = c;
      else if (/(top|hanger)/i.test(h)) topCol = c;
      else if (/(bottom|btm)/i.test(h)) btmCol = c;
      else if (/(tie|stirrup|ring|link)/i.test(h)) tiesCol = c;
      else if (/(main|longitudinal|vertical|reinf|steel)/i.test(h)) mainCol = c;
    }
    for (const r of table.rows) {
      const rawMarkCell = (r[markCol] || '').trim();
      if (!rawMarkCell) continue;
      const expandedMarks = expandGroupedMemberMarks(rawMarkCell);

      let w: number | undefined;
      let d: number | undefined;
      const sizeCellText = sizeCol >= 0 && r[sizeCol] ? r[sizeCol] : r.join(' ');
      const match = sizeCellText.match(/(\d{2,4})\s*[*xX/×]\s*(\d{2,4})/);
      if (match) {
        w = parseInt(match[1], 10);
        d = parseInt(match[2], 10);
        if (w <= 36 && d <= 48) {
          w = Math.round(w * 25.4);
          d = Math.round(d * 25.4);
        }
      }

      const mainCell = btmCol >= 0 ? r[btmCol] : mainCol >= 0 ? r[mainCol] : '';
      const topCell = topCol >= 0 ? r[topCol] : '';
      const tiesCell = tiesCol >= 0 ? r[tiesCol] : '';

      const mMain = (mainCell || '').match(/(\d+)\s*[-xX/]?\s*(?:[tTyY#]|dia|mm|[\u03A6\u00D8])?\s*(\d{1,2})/);
      const mTop = (topCell || '').match(/(\d+)\s*[-xX/]?\s*(?:[tTyY#]|dia|mm|[\u03A6\u00D8])?\s*(\d{1,2})/);
      const mTie = (tiesCell || '').match(/(\d{1,2})\s*(?:[tTyY#]|dia|mm|[\u03A6\u00D8])?\s*(?:@|at)\s*(\d{2,3})/i);

      for (const mStr of expandedMarks) {
        if (mStr && !knownScheduleMarks.has(mStr)) {
          knownScheduleMarks.set(mStr, {
            widthMm: w,
            depthMm: d,
            mainBars: mMain ? { count: parseInt(mMain[1], 10), diameter: parseInt(mMain[2], 10) } : undefined,
            secondaryBars: mTop ? { count: parseInt(mTop[1], 10), diameter: parseInt(mTop[2], 10) } : undefined,
            stirrups: mTie
              ? {
                  diameter: parseInt(mTie[1], 10),
                  spacingMm: parseInt(mTie[2], 10),
                  legs: /4\s*l/i.test(tiesCell || '') ? 4 : 2,
                }
              : undefined,
          });
        }
      }
    }
  }

  for (const t of texts) {
    if (!t || !t.text) continue;
    const rawStr = String(t.text).trim();
    if (rawStr.length < 2 || rawStr.length > 42) continue;

    // Framing Layout ROI Bounding Box Filter
    if (options?.bbox) {
      const { min_x, min_y, max_x, max_y } = options.bbox;
      if (t.x < min_x || t.x > max_x || t.y < min_y || t.y > max_y) {
        continue;
      }
    }

    const layerName = t.layer || '';

    // Pass 1: Layer affinity filter
    if (options?.allowedLayers && options.allowedLayers.length > 0) {
      if (!options.allowedLayers.includes(layerName)) continue;
    } else {
      const affinity = isLayerRelevantForScope(layerName, scope);
      if (affinity === 'exclude') continue;
    }

    // Pass 3: Text height consistency filter (reject title blocks > 3x median or tiny dims < 0.4x)
    const ht = t.height || medianHeight;
    if (ht > medianHeight * 3.5 || ht < medianHeight * 0.4) {
      continue;
    }

    // Pass 2: Syntax pattern match
    const match = rawStr.match(tagPattern);
    if (!match) continue;

    const extractedMark = match[1].toUpperCase();

    // Verify non-greedy token match against full text
    if (!isExactTokenMatch(rawStr, extractedMark)) {
      continue;
    }

    const cur = tagInstances.get(extractedMark) || {
      coords: [],
      layers: new Set<string>(),
      heights: [],
      rawStrings: [],
    };

    cur.coords.push([t.x, t.y]);
    cur.layers.add(layerName);
    cur.heights.push(ht);
    cur.rawStrings.push(rawStr);
    tagInstances.set(extractedMark, cur);
  }

  // Helper to parse WxD from inline or nearby text within spatial radius of a member tag
  const findInlineOrNearbySize = (
    rawStrings: string[],
    coord: [number, number],
    searchRadius: number
  ): { widthMm: number; depthMm: number } | null => {
    const parseDims = (str: string): { widthMm: number; depthMm: number } | null => {
      const m = str.match(/(\d{2,4})\s*[*xX/×]\s*(\d{2,4})/);
      if (!m) return null;
      let w = parseInt(m[1], 10);
      let d = parseInt(m[2], 10);
      if (w <= 36 && d <= 48) {
        w = Math.round(w * 25.4);
        d = Math.round(d * 25.4);
      }
      if (w >= 100 && w <= 2500 && d >= 100 && d <= 3000) {
        return { widthMm: w, depthMm: d };
      }
      return null;
    };

    // 1. Check inline string itself, e.g. "B2-5 (230x600)"
    for (const s of rawStrings) {
      const parsed = parseDims(s);
      if (parsed) return parsed;
    }

    // 2. Check nearby text entities within spatial radius on the plan
    let bestDistSq = searchRadius * searchRadius;
    let bestDims: { widthMm: number; depthMm: number } | null = null;
    for (const t of texts) {
      if (!t || !t.text) continue;
      const dx = t.x - coord[0];
      const dy = t.y - coord[1];
      const dSq = dx * dx + dy * dy;
      if (dSq > bestDistSq) continue;
      const parsed = parseDims(String(t.text));
      if (parsed) {
        bestDistSq = dSq;
        bestDims = parsed;
      }
    }
    return bestDims;
  };

  // Pass 4: Build DiscoveredTag results with 4-Priority Size Waterfall & CAD geometric element detection
  const results: DiscoveredTag[] = [];

  for (const [mark, data] of tagInstances.entries()) {
    const avgH = data.heights.reduce((s, h) => s + h, 0) / data.heights.length;
    const scheduleMatch = knownScheduleMarks.get(mark);
    const inlineSize = data.coords[0]
      ? findInlineOrNearbySize(data.rawStrings, data.coords[0], Math.max(avgH * 6, 1.2))
      : null;

    // Compute CAD physical geometry (span line, column boundary, slab panel)
    let detectedGeom: MemberDetectedGeometry | null = null;
    if (data.coords.length > 0 && (options?.lines || options?.polylines)) {
      detectedGeom = detectMemberGeometry(
        scope,
        data.coords[0],
        options.lines || [],
        options.polylines || [],
        options.scaleToM || 0.001,
        texts || []
      );
    }

    let finalWidthMm: number | undefined;
    let finalDepthMm: number | undefined;
    let sizeSource: 'schedule' | 'inline_text' | 'geometry' | 'manual' = 'manual';
    let scheduleConflict: { scheduleWidthMm: number; scheduleDepthMm: number } | undefined;

    if (scheduleMatch?.widthMm && scheduleMatch?.depthMm) {
      finalWidthMm = scheduleMatch.widthMm;
      finalDepthMm = scheduleMatch.depthMm;
      sizeSource = 'schedule';
      if (
        inlineSize &&
        (inlineSize.widthMm !== scheduleMatch.widthMm || inlineSize.depthMm !== scheduleMatch.depthMm)
      ) {
        // Inline annotation on plan overrides generic schedule if specific to this beam mark
        finalWidthMm = inlineSize.widthMm;
        finalDepthMm = inlineSize.depthMm;
        sizeSource = 'inline_text';
        scheduleConflict = {
          scheduleWidthMm: scheduleMatch.widthMm,
          scheduleDepthMm: scheduleMatch.depthMm,
        };
      }
    } else if (inlineSize) {
      finalWidthMm = inlineSize.widthMm;
      finalDepthMm = inlineSize.depthMm;
      sizeSource = 'inline_text';
    } else if (detectedGeom?.widthMm && detectedGeom?.depthMm) {
      finalWidthMm = detectedGeom.widthMm;
      finalDepthMm = detectedGeom.depthMm;
      sizeSource = 'geometry';
    }

    results.push({
      mark,
      category: scope,
      countOnLayout: data.coords.length,
      layers: Array.from(data.layers),
      suggestedWidthMm: finalWidthMm,
      suggestedDepthMm: finalDepthMm,
      sizeSource,
      scheduleConflict,
      scheduleMainBars: scheduleMatch?.mainBars,
      scheduleSecondaryBars: scheduleMatch?.secondaryBars,
      scheduleStirrups: scheduleMatch?.stirrups,
      isVerifiedInLegend: Boolean(scheduleMatch || inlineSize),
      textCoords: data.coords,
      avgHeight: Math.round(avgH * 100) / 100,
      detectedGeometry: detectedGeom,
    });
  }

  // Sort by natural alphanumeric order (e.g. B1-1, B2-5, B3-6, B4-10, B5-100)
  results.sort((a, b) => a.mark.localeCompare(b.mark, undefined, { numeric: true, sensitivity: 'base' }));

  return results;
}

/**
 * Scans all sheets in fullRawData for General Notes texts and scattered cross-section detail clusters.
 */
export function scanGeneralNotesAndSections(fullRawData: any, sheets: any[] = []): {
  generalNotesTexts: string[];
  sectionClusters: any[];
} {
  const texts: any[] = fullRawData?.texts || [];
  const generalNotesTexts: string[] = [];
  const sectionClusters: any[] = [];

  const noteRegex = /\b(concrete\s+grade|steel\s+grade|clear\s+cover|lap\s+length|development\s+length|fe\s*500|fe\s*415|m\s*20|m\s*25|m\s*30|is\s*:\s*456|is\s*:\s*13920)\b/i;
  const sectionHeaderRegex = /\b(sec(?:tion)?\s*[a-z0-9]{1,3}\s*[-–]\s*[a-z0-9]{1,3}|detail\s+of\s+(?:beam|col|footing)|typical\s+(?:beam|col)\s+sec)\b/i;

  for (const t of texts) {
    if (!t || !t.text) continue;
    const str = String(t.text).trim();
    if (noteRegex.test(str) && generalNotesTexts.length < 60) {
      generalNotesTexts.push(str);
    }
    if (sectionHeaderRegex.test(str) && sectionClusters.length < 30) {
      const ht = t.height || 0.25;
      const radius = Math.max(ht * 25, 4.0);
      const nearby = texts.filter(
        (nt) => nt && nt.text && Math.abs(nt.x - t.x) <= radius && Math.abs(nt.y - t.y) <= radius
      );
      const nearbyStrs = nearby.map((nt) => String(nt.text).trim());
      const joined = nearbyStrs.join(' ');
      const dimMatch = joined.match(/(\d{2,4})\s*[*xX/×]\s*(\d{2,4})/);
      let wMm: number | undefined;
      let dMm: number | undefined;
      if (dimMatch) {
        wMm = parseInt(dimMatch[1], 10);
        dMm = parseInt(dimMatch[2], 10);
        if (wMm <= 36 && dMm <= 48) {
          wMm = Math.round(wMm * 25.4);
          dMm = Math.round(dMm * 25.4);
        }
      }
      const sheetObj = sheets.find(
        (s) =>
          s.bbox &&
          t.x >= s.bbox.min_x &&
          t.x <= s.bbox.max_x &&
          t.y >= s.bbox.min_y &&
          t.y <= s.bbox.max_y
      );
      sectionClusters.push({
        title: str,
        sheetId: sheetObj?.id || 'all',
        widthMm: wMm,
        depthMm: dMm,
        texts: nearbyStrs.slice(0, 12),
      });
    }
  }

  return { generalNotesTexts, sectionClusters };
}
