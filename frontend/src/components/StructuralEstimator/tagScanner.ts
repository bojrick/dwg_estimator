import type {
  StructuralMemberType,
  ExtractedCadTable,
  BoxCoords,
  MemberDetectedGeometry,
} from './types';
import { detectMemberGeometry } from './cadGeometryEngine.ts';

export interface DiscoveredTag {
  mark: string;
  category: StructuralMemberType;
  countOnLayout: number;
  layers: string[];
  suggestedWidthMm?: number;
  suggestedDepthMm?: number;
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
      // Matches B1, B1-1, B2-5, PB1, PB1-1, TB1, FB1, RB1, CB1, GB1, SB1, B-101, 1B1, B1A, B1-A
      return /\b((?:[1-9]?[PFTBGRCS]?B|BEAM)-?\d{1,3}(?:[A-Z]|-\d{1,2}|-[A-Z])?)\b/i;

    case 'column':
      // Matches C1, C1-1, C1A, C-101, SC1, RC1, P1, P-1, 1C1
      return /\b((?:[1-9]?[SRC]?C|COL|P)-?\d{1,3}(?:[A-Z]|-\d{1,2}|-[A-Z])?)\b/i;

    case 'slab':
      // Matches S1, NS1, SS1, DS1, FS1, TS1, CS1, S-1, S1A, SLAB 1
      return /\b((?:[NDSTFC]?S|SLAB)-?\d{1,2}(?:[A-Z]|-\d{1,2})?)\b/i;

    case 'footing':
      // Matches F1, CF1, RF1, PF1, F-101, FTG 1
      return /\b((?:[CRPF]?F|FTG)-?\d{1,3}(?:[A-Z]|-\d{1,2})?)\b/i;

    default:
      return /\b([A-Z]{1,3}-?\d{1,3}[A-Z]?)\b/i;
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
    ? new RegExp(`\\b(${options.customPrefix.trim()}-?\\d{1,3}[A-Z]?(?:-\\d{1,2})?)\\b`, 'i')
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
    }
  >();

  // Extract known marks from schedule tables for Pass 4 cross-validation
  // Prioritize activeLegendTable if explicitly provided
  const tablesToScan = options?.activeLegendTable
    ? [options.activeLegendTable, ...scheduleTables.filter((t) => t.id !== options.activeLegendTable?.id)]
    : scheduleTables;

  const knownScheduleMarks = new Map<string, { widthMm?: number; depthMm?: number }>();
  for (const table of tablesToScan) {
    let markCol = 0;
    let sizeCol = -1;
    for (let c = 0; c < table.headers.length; c++) {
      if (/(mark|id|no|col|beam|footing)/i.test(table.headers[c])) markCol = c;
      if (/(size|dim|b\s*x\s*d|section)/i.test(table.headers[c])) sizeCol = c;
    }
    for (const r of table.rows) {
      const mStr = (r[markCol] || '').trim().toUpperCase();
      if (mStr && !knownScheduleMarks.has(mStr)) {
        let w: number | undefined;
        let d: number | undefined;
        if (sizeCol >= 0 && r[sizeCol]) {
          const match = r[sizeCol].match(/(\d+)\s*[*xX/×]\s*(\d+)/);
          if (match) {
            w = parseInt(match[1], 10);
            d = parseInt(match[2], 10);
            if (w <= 36 && d <= 48) {
              w = Math.round(w * 25.4);
              d = Math.round(d * 25.4);
            }
          }
        }
        knownScheduleMarks.set(mStr, { widthMm: w, depthMm: d });
      }
    }
  }

  for (const t of texts) {
    if (!t || !t.text) continue;
    const rawStr = String(t.text).trim();
    if (rawStr.length < 2 || rawStr.length > 30) continue;

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
    };

    cur.coords.push([t.x, t.y]);
    cur.layers.add(layerName);
    cur.heights.push(ht);
    tagInstances.set(extractedMark, cur);
  }

  // Pass 4: Build DiscoveredTag results with verification status & CAD geometric element detection
  const results: DiscoveredTag[] = [];

  for (const [mark, data] of tagInstances.entries()) {
    const avgH = data.heights.reduce((s, h) => s + h, 0) / data.heights.length;
    const scheduleMatch = knownScheduleMarks.get(mark);

    // Compute CAD physical geometry (span line, column boundary, slab panel)
    let detectedGeom: MemberDetectedGeometry | null = null;
    if (data.coords.length > 0 && (options?.lines || options?.polylines)) {
      detectedGeom = detectMemberGeometry(
        scope,
        data.coords[0],
        options.lines || [],
        options.polylines || [],
        options.scaleToM || 0.001
      );
    }

    results.push({
      mark,
      category: scope,
      countOnLayout: data.coords.length,
      layers: Array.from(data.layers),
      suggestedWidthMm: scheduleMatch?.widthMm || detectedGeom?.widthMm,
      suggestedDepthMm: scheduleMatch?.depthMm || detectedGeom?.depthMm,
      isVerifiedInLegend: Boolean(scheduleMatch),
      textCoords: data.coords,
      avgHeight: Math.round(avgH * 100) / 100,
      detectedGeometry: detectedGeom,
    });
  }

  // Sort by natural alphanumeric order (e.g. B1, B2, B10, B1-1, PB1)
  results.sort((a, b) => a.mark.localeCompare(b.mark, undefined, { numeric: true, sensitivity: 'base' }));

  return results;
}
