import { RebarTextCandidate } from './types';

// Regexes for common structural rebar notations
const REBAR_SPACING_REGEX =
  /(?:^|[\s,;+\(\[])(?:[tTyY#]|dia|mm|[\u03A6\u03C6\u2300\u00D8])?\s*(\d{1,2})\s*(?:[tTyY#]|dia|mm|[\u03A6\u03C6\u2300\u00D8])?\s*(?:@|at)\s*(\d{2,4})\s*(?:c\/c|cc|c-c|mm)?/i;

const REBAR_COUNT_DIA_REGEX =
  /(?:^|[\s,;+\(\[])(\d+)\s*[-xX/]?\s*(?:[tTyY#]|dia|mm|[\u03A6\u03C6\u2300\u00D8])?\s*(\d{1,2})\s*(?:[tTyY#]|dia|mm|[\u03A6\u03C6\u2300\u00D8])?(?:[\s,\)\]]|$)/i;

const REBAR_COMBINED_CALLOUT =
  /(\d+)\s*[-xX]?\s*(?:[tTyY#]|dia|mm)?\s*(\d{1,2})\s*(?:\+|and|\/)\s*(\d+)\s*[-xX]?\s*(?:[tTyY#]|dia|mm)?\s*(\d{1,2})/i;

/**
 * Scans an array of CAD text entities and extracts rebar callouts.
 * If bbox is provided, only texts within the bounding box are scanned.
 */
export function scanTextsForRebar(
  texts: any[],
  bbox?: { min_x: number; min_y: number; max_x: number; max_y: number }
): RebarTextCandidate[] {
  if (!texts || !Array.isArray(texts)) return [];

  const candidates: RebarTextCandidate[] = [];
  const seenTexts = new Set<string>();

  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    if (!t || !t.text) continue;

    const rawStr = String(t.text).trim();
    if (!rawStr || rawStr.length < 3) continue;

    // Filter by bounding box if given
    if (bbox) {
      if (t.x < bbox.min_x || t.x > bbox.max_x || t.y < bbox.min_y || t.y > bbox.max_y) {
        continue;
      }
    }

    const key = `${rawStr}_${Math.round(t.x)}_${Math.round(t.y)}`;
    if (seenTexts.has(key)) continue;

    // Check count + dia pattern (e.g. 4-T16, 8-Y20)
    const countMatch = rawStr.match(REBAR_COUNT_DIA_REGEX);
    if (countMatch) {
      const count = parseInt(countMatch[1], 10);
      const dia = parseInt(countMatch[2], 10);
      if (dia >= 6 && dia <= 40 && count >= 1 && count <= 50) {
        seenTexts.add(key);
        const role = /top/i.test(rawStr)
          ? 'top'
          : /btm|bottom/i.test(rawStr)
          ? 'bottom'
          : /tie|ring|stirrup|link/i.test(rawStr)
          ? 'stirrup'
          : 'main';
        candidates.push({
          id: `rebar_cand_${i}`,
          text: rawStr,
          layer: t.layer || '',
          x: t.x,
          y: t.y,
          count,
          diameter: dia,
          role,
        });
        continue;
      }
    }

    // Check spacing pattern (e.g. T10 @ 150 c/c)
    const spacingMatch = rawStr.match(REBAR_SPACING_REGEX);
    if (spacingMatch) {
      const dia = parseInt(spacingMatch[1], 10);
      const spacing = parseInt(spacingMatch[2], 10);
      if (dia >= 6 && dia <= 32 && spacing >= 50 && spacing <= 500) {
        seenTexts.add(key);
        candidates.push({
          id: `rebar_cand_${i}`,
          text: rawStr,
          layer: t.layer || '',
          x: t.x,
          y: t.y,
          diameter: dia,
          spacingMm: spacing,
          role: 'stirrup',
        });
        continue;
      }
    }

    // Check combined callouts e.g. 2-20 + 2-16
    const combMatch = rawStr.match(REBAR_COMBINED_CALLOUT);
    if (combMatch) {
      const count1 = parseInt(combMatch[1], 10);
      const dia1 = parseInt(combMatch[2], 10);
      if (dia1 >= 6 && dia1 <= 40) {
        seenTexts.add(key);
        candidates.push({
          id: `rebar_cand_${i}`,
          text: rawStr,
          layer: t.layer || '',
          x: t.x,
          y: t.y,
          count: count1,
          diameter: dia1,
          role: 'main',
        });
        continue;
      }
    }
  }

  return candidates;
}
