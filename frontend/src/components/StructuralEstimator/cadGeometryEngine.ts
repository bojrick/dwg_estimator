import type { MemberDetectedGeometry, StructuralMemberType } from './types';

interface CadLineSegment {
  start: [number, number];
  end: [number, number];
  layer?: string;
}

/**
 * Normalizes CAD lines and polylines into an array of simple line segments.
 */
function extractAllSegments(lines: any[] = [], polylines: any[] = []): CadLineSegment[] {
  const segments: CadLineSegment[] = [];

  for (const ln of lines) {
    if (ln?.start && ln?.end) {
      segments.push({
        start: [Number(ln.start[0]), Number(ln.start[1])],
        end: [Number(ln.end[0]), Number(ln.end[1])],
        layer: ln.layer,
      });
    }
  }

  for (const pl of polylines) {
    const pts = pl?.points || [];
    if (pts.length >= 2) {
      for (let i = 0; i < pts.length - 1; i++) {
        segments.push({
          start: [Number(pts[i][0]), Number(pts[i][1])],
          end: [Number(pts[i + 1][0]), Number(pts[i + 1][1])],
          layer: pl.layer,
        });
      }
      if (pl.closed && pts.length >= 3) {
        segments.push({
          start: [Number(pts[pts.length - 1][0]), Number(pts[pts.length - 1][1])],
          end: [Number(pts[0][0]), Number(pts[0][1])],
          layer: pl.layer,
        });
      }
    }
  }

  return segments;
}

/**
 * Calculates point-to-segment distance squared.
 */
function distSqToSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2;
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const projX = a[0] + t * dx;
  const projY = a[1] + t * dy;
  return (p[0] - projX) ** 2 + (p[1] - projY) ** 2;
}

/**
 * Detects beam span from layout lines around a beam mark tag coordinate.
 * Finds parallel beam edges and the transverse column/intersecting support boundaries.
 */
export function detectBeamSpanFromLayout(
  tagCoords: [number, number],
  lines: any[] = [],
  polylines: any[] = [],
  scaleToM: number = 0.001,
  cadTexts: any[] = []
): MemberDetectedGeometry | null {
  const segments = extractAllSegments(lines, polylines);
  if (segments.length === 0) return null;

  const [tx, ty] = tagCoords;
  const searchRadiusUnits = 8.0 / (scaleToM > 0 ? scaleToM : 1.0); // Search up to ~8m equivalent

  // 1. Find segments passing close to tag to determine dominant beam axis
  const nearby = segments.filter((s) => {
    return distSqToSegment([tx, ty], s.start, s.end) < (searchRadiusUnits * 0.25) ** 2;
  });

  if (nearby.length === 0) return null;

  // 2. Determine dominant axis (horizontal vs vertical)
  let horizWeight = 0;
  let vertWeight = 0;

  for (const s of nearby) {
    const dx = Math.abs(s.end[0] - s.start[0]);
    const dy = Math.abs(s.end[1] - s.start[1]);
    const len = Math.hypot(dx, dy);
    if (len < 0.001) continue;

    if (dx > dy * 2) horizWeight += len;
    else if (dy > dx * 2) vertWeight += len;
  }

  const isHoriz = horizWeight >= vertWeight;

  // 3. Extract candidate supporting columns: closed polylines (150-1500mm) or column text marks
  interface CandidateColumn {
    mark?: string;
    center: [number, number];
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  }
  const candidateColumns: CandidateColumn[] = [];

  for (const pl of polylines) {
    if (!pl.closed || !pl.points || pl.points.length < 4 || pl.points.length > 8) continue;
    const xs = pl.points.map((p: any) => p[0]);
    const ys = pl.points.map((p: any) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const wMm = Math.round((maxX - minX) * scaleToM * 1000);
    const dMm = Math.round((maxY - minY) * scaleToM * 1000);

    if (wMm >= 150 && wMm <= 1500 && dMm >= 150 && dMm <= 1500) {
      candidateColumns.push({
        center: [(minX + maxX) / 2, (minY + maxY) / 2],
        minX,
        maxX,
        minY,
        maxY,
      });
    }
  }

  // Also include column markers from CAD texts (e.g. C1, C2)
  for (const t of cadTexts) {
    if (!t || !t.text) continue;
    const str = String(t.text).trim();
    if (/^(?:[1-9]?[SRC]?C|COL)-?\d{1,4}[A-Z]?$/i.test(str) && typeof t.x === 'number' && typeof t.y === 'number') {
      const halfW = 0.2 / (scaleToM > 0 ? scaleToM : 1.0);
      candidateColumns.push({
        mark: str.toUpperCase(),
        center: [t.x, t.y],
        minX: t.x - halfW,
        maxX: t.x + halfW,
        minY: t.y - halfW,
        maxY: t.y + halfW,
      });
    }
  }

  const corridorTol = 0.6 / (scaleToM > 0 ? scaleToM : 1.0); // 600mm corridor tolerance

  if (isHoriz) {
    // Horizontal beam: runs in X, corridor bound by beam ty ± corridorTol
    const corridorCols = candidateColumns.filter(
      (c) => Math.abs(c.center[1] - ty) <= corridorTol || (ty >= c.minY && ty <= c.maxY)
    );

    // Immediate adjacent columns only: closest left and closest right
    let closestLeft: CandidateColumn | null = null;
    let closestRight: CandidateColumn | null = null;

    for (const c of corridorCols) {
      if (c.center[0] < tx && (!closestLeft || c.center[0] > closestLeft.center[0])) {
        closestLeft = c;
      } else if (c.center[0] > tx && (!closestRight || c.center[0] < closestRight.center[0])) {
        closestRight = c;
      }
    }

    if (closestLeft && closestRight) {
      const c1 = closestLeft.center[0];
      const c2 = closestRight.center[0];
      const spanMm = Math.round(Math.abs(c2 - c1) * scaleToM * 1000);
      if (spanMm >= 800 && spanMm <= 25000) {
        const c1Name = closestLeft.mark || 'Col 1';
        const c2Name = closestRight.mark || 'Col 2';
        return {
          type: 'line',
          start: [c1, ty],
          end: [c2, ty],
          lengthMm: spanMm,
          sourceConfidence: 'high',
          notes: `Span between adjacent column centerlines (${c1Name} to ${c2Name}): ${spanMm} mm`,
        };
      }
    }

    // Fallback: search transverse support lines
    let minX = tx - searchRadiusUnits;
    let maxX = tx + searchRadiusUnits;
    let closestLeftX = minX;
    let closestRightX = maxX;

    for (const s of segments) {
      const dx = Math.abs(s.end[0] - s.start[0]);
      const dy = Math.abs(s.end[1] - s.start[1]);
      if (dy > dx * 1.5 && dy > 0.1) {
        const minY = Math.min(s.start[1], s.end[1]);
        const maxY = Math.max(s.start[1], s.end[1]);
        if (ty >= minY - 0.5 && ty <= maxY + 0.5) {
          const xPos = (s.start[0] + s.end[0]) / 2;
          if (xPos < tx && xPos > closestLeftX) closestLeftX = xPos;
          else if (xPos > tx && xPos < closestRightX) closestRightX = xPos;
        }
      }
    }

    const spanUnits = closestRightX - closestLeftX;
    const spanMm = Math.round(spanUnits * scaleToM * 1000);
    if (spanMm >= 800 && spanMm <= 20000) {
      return {
        type: 'line',
        start: [closestLeftX, ty],
        end: [closestRightX, ty],
        lengthMm: spanMm,
        sourceConfidence: 'approximate',
        notes: `Span between transverse supports (${spanMm} mm)`,
      };
    }
  } else {
    // Vertical beam: runs in Y, corridor bound by beam tx ± corridorTol
    const corridorCols = candidateColumns.filter(
      (c) => Math.abs(c.center[0] - tx) <= corridorTol || (tx >= c.minX && tx <= c.maxX)
    );

    let closestBottom: CandidateColumn | null = null;
    let closestTop: CandidateColumn | null = null;

    for (const c of corridorCols) {
      if (c.center[1] < ty && (!closestBottom || c.center[1] > closestBottom.center[1])) {
        closestBottom = c;
      } else if (c.center[1] > ty && (!closestTop || c.center[1] < closestTop.center[1])) {
        closestTop = c;
      }
    }

    if (closestBottom && closestTop) {
      const c1 = closestBottom.center[1];
      const c2 = closestTop.center[1];
      const spanMm = Math.round(Math.abs(c2 - c1) * scaleToM * 1000);
      if (spanMm >= 800 && spanMm <= 25000) {
        const c1Name = closestBottom.mark || 'Col 1';
        const c2Name = closestTop.mark || 'Col 2';
        return {
          type: 'line',
          start: [tx, c1],
          end: [tx, c2],
          lengthMm: spanMm,
          sourceConfidence: 'high',
          notes: `Span between adjacent column centerlines (${c1Name} to ${c2Name}): ${spanMm} mm`,
        };
      }
    }

    // Fallback: search transverse support lines
    let minY = ty - searchRadiusUnits;
    let maxY = ty + searchRadiusUnits;
    let closestBottomY = minY;
    let closestTopY = maxY;

    for (const s of segments) {
      const dx = Math.abs(s.end[0] - s.start[0]);
      const dy = Math.abs(s.end[1] - s.start[1]);
      if (dx > dy * 1.5 && dx > 0.1) {
        const minX = Math.min(s.start[0], s.end[0]);
        const maxX = Math.max(s.start[0], s.end[0]);
        if (tx >= minX - 0.5 && tx <= maxX + 0.5) {
          const yPos = (s.start[1] + s.end[1]) / 2;
          if (yPos < ty && yPos > closestBottomY) closestBottomY = yPos;
          else if (yPos > ty && yPos < closestTopY) closestTopY = yPos;
        }
      }
    }

    const spanUnits = closestTopY - closestBottomY;
    const spanMm = Math.round(spanUnits * scaleToM * 1000);
    if (spanMm >= 800 && spanMm <= 20000) {
      return {
        type: 'line',
        start: [tx, closestBottomY],
        end: [tx, closestTopY],
        lengthMm: spanMm,
        sourceConfidence: 'approximate',
        notes: `Span between transverse supports (${spanMm} mm)`,
      };
    }
  }

  // Fallback: estimate from longest contiguous nearby segment
  let maxSegLen = 0;
  let bestSeg: CadLineSegment | null = null;
  for (const s of nearby) {
    const l = Math.hypot(s.end[0] - s.start[0], s.end[1] - s.start[1]);
    if (l > maxSegLen) {
      maxSegLen = l;
      bestSeg = s;
    }
  }

  if (bestSeg) {
    const spanMm = Math.round(maxSegLen * scaleToM * 1000);
    return {
      type: 'line',
      start: bestSeg.start,
      end: bestSeg.end,
      lengthMm: Math.min(20000, Math.max(1000, spanMm)),
      sourceConfidence: 'approximate',
      notes: `Approximate span from adjacent CAD line (${spanMm} mm)`,
    };
  }

  return null;
}

/**
 * Detects column cross-section boundary rectangle from layout around column tag.
 */
export function detectColumnBoundaryFromLayout(
  tagCoords: [number, number],
  polylines: any[] = [],
  lines: any[] = [],
  scaleToM: number = 0.001
): MemberDetectedGeometry | null {
  const [tx, ty] = tagCoords;
  const maxSearchUnits = 1.5 / (scaleToM > 0 ? scaleToM : 1.0);

  // 1. Search for closed polyline surrounding or closest to tag
  for (const pl of polylines) {
    if (!pl.closed || !pl.points || pl.points.length < 4 || pl.points.length > 8) continue;
    const xs = pl.points.map((p: any) => p[0]);
    const ys = pl.points.map((p: any) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const wUnits = maxX - minX;
    const dUnits = maxY - minY;
    const wMm = Math.round(wUnits * scaleToM * 1000);
    const dMm = Math.round(dUnits * scaleToM * 1000);

    // Realistic column sizes: 150mm to 1500mm
    if (wMm >= 150 && wMm <= 1500 && dMm >= 150 && dMm <= 1500) {
      if (tx >= minX - maxSearchUnits * 0.3 && tx <= maxX + maxSearchUnits * 0.3 &&
          ty >= minY - maxSearchUnits * 0.3 && ty <= maxY + maxSearchUnits * 0.3) {
        return {
          type: 'rect',
          start: [minX, minY],
          end: [maxX, maxY],
          boundaryPoints: pl.points,
          widthMm: wMm,
          depthMm: dMm,
          sourceConfidence: 'high',
          notes: `Column section detected from closed CAD polygon (${wMm} × ${dMm} mm)`,
        };
      }
    }
  }

  return null;
}

/**
 * Detects slab panel boundaries surrounding a slab tag coordinate.
 */
export function detectSlabPanelFromLayout(
  tagCoords: [number, number],
  lines: any[] = [],
  polylines: any[] = [],
  scaleToM: number = 0.001
): MemberDetectedGeometry | null {
  const segments = extractAllSegments(lines, polylines);
  if (segments.length === 0) return null;

  const [tx, ty] = tagCoords;
  const maxDist = 12.0 / (scaleToM > 0 ? scaleToM : 1.0); // up to 12m slab span

  let minX = tx - maxDist;
  let maxX = tx + maxDist;
  let minY = ty - maxDist;
  let maxY = ty + maxDist;

  // Search for 4 bounding beam lines in -X, +X, -Y, +Y
  for (const s of segments) {
    const dx = Math.abs(s.end[0] - s.start[0]);
    const dy = Math.abs(s.end[1] - s.start[1]);

    if (dy > dx * 1.5) {
      // Vertical boundary line
      const sMinY = Math.min(s.start[1], s.end[1]);
      const sMaxY = Math.max(s.start[1], s.end[1]);
      if (ty >= sMinY && ty <= sMaxY) {
        const xPos = (s.start[0] + s.end[0]) / 2;
        if (xPos < tx && xPos > minX) minX = xPos;
        else if (xPos > tx && xPos < maxX) maxX = xPos;
      }
    } else if (dx > dy * 1.5) {
      // Horizontal boundary line
      const sMinX = Math.min(s.start[0], s.end[0]);
      const sMaxX = Math.max(s.start[0], s.end[0]);
      if (tx >= sMinX && tx <= sMaxX) {
        const yPos = (s.start[1] + s.end[1]) / 2;
        if (yPos < ty && yPos > minY) minY = yPos;
        else if (yPos > ty && yPos < maxY) maxY = yPos;
      }
    }
  }

  const spanX = Math.round((maxX - minX) * scaleToM * 1000);
  const spanY = Math.round((maxY - minY) * scaleToM * 1000);

  if (spanX >= 1000 && spanX <= 15000 && spanY >= 1000 && spanY <= 15000) {
    const lx = Math.min(spanX, spanY);
    const ly = Math.max(spanX, spanY);
    const ratio = Math.round((ly / lx) * 100) / 100;
    const isOneWay = ratio > 2.0;

    return {
      type: 'polygon',
      start: [minX, minY],
      end: [maxX, maxY],
      boundaryPoints: [
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, maxY],
      ],
      widthMm: lx,
      lengthMm: ly,
      sourceConfidence: 'high',
      notes: `${isOneWay ? 'One-Way' : 'Two-Way'} Slab Panel (${lx} × ${ly} mm, Ly/Lx = ${ratio})`,
    };
  }

  return null;
}

/**
 * Dispatcher to automatically detect member geometric element based on structural category.
 */
export function detectMemberGeometry(
  scope: StructuralMemberType,
  tagCoords: [number, number],
  lines: any[] = [],
  polylines: any[] = [],
  scaleToM: number = 0.001,
  cadTexts: any[] = []
): MemberDetectedGeometry | null {
  if (!tagCoords || !tagCoords[0] || !tagCoords[1]) return null;

  switch (scope) {
    case 'beam':
      // Beam spans are not guessed from layout corridors; true spans belong to Longitudinal Sections
      return null;
    case 'column':
      return detectColumnBoundaryFromLayout(tagCoords, polylines, lines, scaleToM);
    case 'slab':
      return detectSlabPanelFromLayout(tagCoords, lines, polylines, scaleToM);
    case 'footing':
      return detectColumnBoundaryFromLayout(tagCoords, polylines, lines, scaleToM); // Footings also form closed rectangles
    default:
      return null;
  }
}

/**
 * Extracts beam cross-section reinforcement and dimensions from detail CAD geometry within a bounding box.
 */
export function extractBeamCrossSectionFromBBox(
  texts: any[] = [],
  lines: any[] = [],
  polylines: any[] = [],
  bbox: { min_x: number; min_y: number; max_x: number; max_y: number },
  scaleToM: number = 0.001
): import('./types').BeamCrossSectionInspection {
  const result: import('./types').BeamCrossSectionInspection = {};

  // Filter texts inside bbox
  const insideTexts = texts.filter(
    (t) =>
      typeof t.x === 'number' &&
      typeof t.y === 'number' &&
      t.x >= bbox.min_x &&
      t.x <= bbox.max_x &&
      t.y >= bbox.min_y &&
      t.y <= bbox.max_y
  );

  const allStrings = insideTexts.map((t) => String(t.text).trim()).filter(Boolean);
  result.sourceText = allStrings.join(' | ');

  // 1. Detect Mark (e.g. B1, SEC B1, NB01, BEAM 101)
  for (const str of allStrings) {
    const markMatch = str.match(/\b(?:SEC(?:TION)?\s*)?([1-9]?[NPFTBGRCSLWMDU]?B-?\d{1,4}[A-Z]?)\b/i);
    if (markMatch) {
      result.mark = markMatch[1].toUpperCase();
      break;
    }
  }

  // 2. Detect Cross-Section Dimensions (e.g. 230x450, 300 x 600)
  for (const str of allStrings) {
    const dimMatch = str.match(/(\d{2,4})\s*[*xX/×]\s*(\d{2,4})/);
    if (dimMatch) {
      let w = parseInt(dimMatch[1], 10);
      let d = parseInt(dimMatch[2], 10);
      if (w <= 36 && d <= 48) {
        w = Math.round(w * 25.4);
        d = Math.round(d * 25.4);
      }
      if (w >= 100 && w <= 2000 && d >= 100 && d <= 3000) {
        result.widthMm = w;
        result.depthMm = d;
        break;
      }
    }
  }

  // If dimensions not in text, inspect outer closed polyline in bbox
  if (!result.widthMm || !result.depthMm) {
    for (const pl of polylines) {
      if (!pl.closed || !pl.points || pl.points.length < 4) continue;
      const xs = pl.points.map((p: any) => p[0]);
      const ys = pl.points.map((p: any) => p[1]);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      if (minX >= bbox.min_x && maxX <= bbox.max_x && minY >= bbox.min_y && maxY <= bbox.max_y) {
        const w = Math.round((maxX - minX) * scaleToM * 1000);
        const d = Math.round((maxY - minY) * scaleToM * 1000);
        if (w >= 150 && w <= 2000 && d >= 150 && d <= 3000) {
          result.widthMm = w;
          result.depthMm = d;
          break;
        }
      }
    }
  }

  // 3. Scan rebar callouts: top, bottom, stirrup
  // Regexes:
  const COUNT_DIA_REGEX = /(\d+)\s*[-xX/]?\s*(?:[tTyY#]|dia|mm|[\u03A6\u03C6\u2300\u00D8])?\s*(\d{1,2})\s*(?:[tTyY#]|dia|mm|[\u03A6\u03C6\u2300\u00D8])?/i;
  const STIRRUP_REGEX = /(?:(\d+)\s*L(?:EG)?-?)?\s*(?:[tTyY#]|dia|mm|[\u03A6\u03C6\u2300\u00D8])?\s*(\d{1,2})\s*(?:[tTyY#]|dia|mm)?\s*(?:@|at)\s*(\d{2,4})\s*(?:c\/c|cc|c-c|mm)?/i;

  const midY = (bbox.min_y + bbox.max_y) / 2;

  for (const t of insideTexts) {
    const s = String(t.text).trim();

    // Check stirrup first
    const stMatch = s.match(STIRRUP_REGEX);
    if (stMatch && !result.stirrups) {
      const legs = stMatch[1] ? parseInt(stMatch[1], 10) : 2;
      const dia = parseInt(stMatch[2], 10);
      const sp = parseInt(stMatch[3], 10);
      if (dia >= 6 && dia <= 32 && sp >= 50 && sp <= 500) {
        result.stirrups = {
          diameter: dia,
          spacingMm: sp,
          legs,
          notes: s,
        };
        continue;
      }
    }

    // Check bar count & diameter
    const barMatch = s.match(COUNT_DIA_REGEX);
    if (barMatch) {
      const cnt = parseInt(barMatch[1], 10);
      const dia = parseInt(barMatch[2], 10);
      if (cnt >= 1 && cnt <= 30 && dia >= 8 && dia <= 40) {
        const isTop = /top|hanger|anchor/i.test(s) || t.y > midY;
        const isBtm = /btm|bottom|main/i.test(s) || t.y <= midY;

        if (isTop && !result.topBars) {
          result.topBars = { count: cnt, diameter: dia, notes: s };
        } else if (isBtm && !result.bottomBars) {
          result.bottomBars = { count: cnt, diameter: dia, notes: s };
        }
      }
    }
  }

  return result;
}

export interface DetectedContinuousSpan {
  id: string;
  beamMark: string;
  centerToCenterSpanMm: number;
  clearSpanMm: number;
  widthMm: number;
  depthMm: number;
  supportColLeftMm: number;
  supportColRightMm: number;
  colLeftLabel?: string;
  colRightLabel?: string;
}

/**
 * Extracts continuous beam spans from a windowed CAD elevation drawing.
 * Measures physical center-to-center distance between column supports.
 */
export function extractContinuousBeamSpansFromWindow(
  bbox: { min_x: number; min_y: number; max_x: number; max_y: number },
  lines: any[] = [],
  polylines: any[] = [],
  texts: any[] = [],
  scaleToM: number = 0.001,
  candidateBeams: string[] = []
): {
  spans: DetectedContinuousSpan[];
  beamMarks: string[];
  depthMm: number;
  widthMm: number;
} {
  const scale = scaleToM > 0 ? scaleToM : 0.001;
  const pad = 0.1 / scale; // 100mm tolerance in CAD units

  const minX = bbox.min_x - pad;
  const maxX = bbox.max_x + pad;
  const minY = bbox.min_y - pad;
  const maxY = bbox.max_y + pad;

  // 1. Filter entities strictly inside window
  const inTexts = texts.filter(
    (t) => typeof t.x === 'number' && typeof t.y === 'number' && t.x >= minX && t.x <= maxX && t.y >= minY && t.y <= maxY
  );

  const allSegs = extractAllSegments(lines, polylines);
  const inSegs = allSegs.filter(
    (s) =>
      Math.max(s.start[0], s.end[0]) >= minX &&
      Math.min(s.start[0], s.end[0]) <= maxX &&
      Math.max(s.start[1], s.end[1]) >= minY &&
      Math.min(s.start[1], s.end[1]) <= maxY
  );

  // 2. Identify beam depth and section size from texts or geometry
  let widthMm = 230;
  let depthMm = 450;
  for (const t of inTexts) {
    const s = String(t.text || '').trim();
    const mSz = s.match(/(\d{2,4})\s*[*xX/×]\s*(\d{2,4})/);
    if (mSz) {
      const w = parseInt(mSz[1], 10);
      const d = parseInt(mSz[2], 10);
      if (w >= 100 && w <= 1500 && d >= 150 && d <= 2500) {
        widthMm = w;
        depthMm = d;
        break;
      }
    }
  }

  // If size not found in text, measure beam elevation height from horizontal bounding lines
  const horizSegs = inSegs.filter((s) => Math.abs(s.end[0] - s.start[0]) > Math.abs(s.end[1] - s.start[1]) * 2);
  if (horizSegs.length >= 2 && depthMm === 450) {
    const ys = horizSegs.map((s) => (s.start[1] + s.end[1]) / 2).sort((a, b) => a - b);
    const measuredD = Math.round((ys[ys.length - 1] - ys[0]) * scale * 1000);
    if (measuredD >= 200 && measuredD <= 2000) {
      depthMm = measuredD;
    }
  }

  // 3. Find column supports along horizontal axis X
  // Column faces: vertical line segments (dy > dx * 2)
  const vertSegs = inSegs
    .filter((s) => Math.abs(s.end[1] - s.start[1]) > Math.abs(s.end[0] - s.start[0]) * 2)
    .map((s) => ({
      x: (s.start[0] + s.end[0]) / 2,
      minY: Math.min(s.start[1], s.end[1]),
      maxY: Math.max(s.start[1], s.end[1]),
      len: Math.abs(s.end[1] - s.start[1]),
    }))
    .filter((s) => s.len * scale * 1000 >= 150)
    .sort((a, b) => a.x - b.x);

  // Cluster nearby vertical lines (within 100mm to 800mm) into columns
  interface ColumnStation {
    centerX: number;
    widthMm: number;
    label?: string;
  }
  const colStations: ColumnStation[] = [];
  const colMaxTolUnits = 0.85 / scale; // up to 850mm column width
  const colMinTolUnits = 0.12 / scale; // at least 120mm

  let i = 0;
  while (i < vertSegs.length) {
    const curr = vertSegs[i];
    let nextIdx = i + 1;
    let paired = false;

    while (nextIdx < vertSegs.length) {
      const cand = vertSegs[nextIdx];
      const dist = cand.x - curr.x;
      if (dist >= colMinTolUnits && dist <= colMaxTolUnits) {
        // Paired left and right face of a column
        const cX = (curr.x + cand.x) / 2;
        const wMm = Math.round(dist * scale * 1000);
        colStations.push({ centerX: cX, widthMm: wMm });
        i = nextIdx + 1;
        paired = true;
        break;
      }
      if (dist > colMaxTolUnits) break;
      nextIdx++;
    }

    if (!paired) {
      i++;
    }
  }

  // Also look for column and grid text markers (e.g. C1, C2, Grid A, Grid B)
  const colTextMarkers = inTexts
    .map((t) => {
      const str = String(t.text || '').trim();
      const isColMark = /^(?:[1-9]?[SRC]?C|COL)-?\d{1,4}[A-Z]?$/i.test(str);
      const isGridMark = /^(?:GRID\s*)?([A-Z]|\d{1,3})$/i.test(str);
      return { text: str.toUpperCase(), x: t.x, y: t.y, isCol: isColMark, isGrid: isGridMark };
    })
    .filter((t) => t.isCol || t.isGrid)
    .sort((a, b) => a.x - b.x);

  // If physical line pairing found fewer than 2 columns, use column/grid text marker positions
  if (colStations.length < 2 && colTextMarkers.length >= 2) {
    colStations.length = 0;
    for (const tm of colTextMarkers) {
      colStations.push({
        centerX: tm.x,
        widthMm: 350,
        label: tm.text,
      });
    }
  }

  // Deduplicate column stations that are too close (e.g. within 600mm)
  const mergedCols: ColumnStation[] = [];
  for (const cs of colStations) {
    const last = mergedCols[mergedCols.length - 1];
    if (!last || Math.abs(cs.centerX - last.centerX) * scale * 1000 > 600) {
      mergedCols.push(cs);
    }
  }

  // Identify beam marks present in the window
  const detectedMarks: string[] = [];
  const knownCandidateSet = new Set(candidateBeams.map((m) => m.toUpperCase()));

  for (const t of inTexts) {
    const s = String(t.text || '').trim().toUpperCase();
    for (const cand of knownCandidateSet) {
      if (s === cand || s.includes(cand)) {
        if (!detectedMarks.includes(cand)) detectedMarks.push(cand);
      }
    }
    // Generic match B1-1, B2-5, NB01, PB1, etc.
    const genMatch = s.match(/\b([1-9]?[NPFTBGRCSLWMDU]?B-?\d{1,4}(?:-\d{1,4}|[A-Z])?)\b/i);
    if (genMatch && !detectedMarks.includes(genMatch[1].toUpperCase())) {
      detectedMarks.push(genMatch[1].toUpperCase());
    }
  }

  // Extract direct CAD dimension callouts (e.g. 3800, 4200, 3.80m) in the window
  const dimCandidates: { valMm: number; x: number; y: number }[] = [];
  for (const t of inTexts) {
    const s = String(t.text || '').trim();
    const mMm = s.match(/^\s*(\d{4,5})\s*(?:mm)?\s*$/i);
    if (mMm) {
      const v = parseInt(mMm[1], 10);
      if (v >= 1200 && v <= 18000) dimCandidates.push({ valMm: v, x: t.x, y: t.y });
      continue;
    }
    const mM = s.match(/^\s*(\d{1,2}\.\d{1,3})\s*(?:m|mtr)?\s*$/i);
    if (mM) {
      const v = Math.round(parseFloat(mM[1]) * 1000);
      if (v >= 1200 && v <= 18000) dimCandidates.push({ valMm: v, x: t.x, y: t.y });
    }
  }
  dimCandidates.sort((a, b) => a.x - b.x);

  // If column stations could not be paired from vectors, construct safe stations
  if (mergedCols.length < 2) {
    mergedCols.length = 0;
    const count = Math.max(detectedMarks.length, dimCandidates.length, 2);
    // Safe standard spacing (4000mm clear + 350mm col) instead of dividing arbitrary user box
    const standardSpanMm = dimCandidates.length > 0 ? dimCandidates[0].valMm : 4000;
    const colStepUnits = ((standardSpanMm + 350) / 1000) / (scale * 1000);
    const startX = bbox.min_x + pad;
    for (let k = 0; k <= count; k++) {
      mergedCols.push({
        centerX: startX + k * colStepUnits,
        widthMm: 350,
        label: `C${k + 1}`,
      });
    }
  }

  // Sort columns strictly left-to-right
  mergedCols.sort((a, b) => a.centerX - b.centerX);

  // Associate column labels with closest text markers
  for (const col of mergedCols) {
    if (!col.label) {
      const nearby = colTextMarkers.find((tm) => Math.abs(tm.x - col.centerX) * scale * 1000 <= 400);
      if (nearby) col.label = nearby.text;
    }
  }

  // 4. Measure Center-to-Center and Clear Spans (Priority: CAD Dimension > Vector line distance > 4000mm standard)
  const spans: DetectedContinuousSpan[] = [];
  const finalMarks: string[] = [];

  for (let sIdx = 0; sIdx < mergedCols.length - 1; sIdx++) {
    const cLeft = mergedCols[sIdx];
    const cRight = mergedCols[sIdx + 1];

    let ccDistMm = Math.round(Math.abs(cRight.centerX - cLeft.centerX) * scale * 1000);
    const colLeftW = cLeft.widthMm || 300;
    const colRightW = cRight.widthMm || 350;
    let clearDistMm = Math.max(600, ccDistMm - Math.round((colLeftW + colRightW) / 2));

    // Priority 1: Check for exact CAD dimension text located in this span
    const spanDim = dimCandidates.find((d) => d.x >= cLeft.centerX - pad && d.x <= cRight.centerX + pad)
      || dimCandidates[sIdx];
    if (spanDim) {
      // Direct CAD dimension callout overrides imprecise vector coordinates
      clearDistMm = spanDim.valMm;
      ccDistMm = clearDistMm + Math.round((colLeftW + colRightW) / 2);
    }

    // Find beam mark in this span interval [cLeft.centerX, cRight.centerX]
    const spanTexts = inTexts.filter((t) => t.x >= cLeft.centerX - pad && t.x <= cRight.centerX + pad);
    let spanMark = '';
    for (const st of spanTexts) {
      const s = String(st.text || '').trim().toUpperCase();
      const found = detectedMarks.find((dm) => s.includes(dm));
      if (found && !finalMarks.includes(found)) {
        spanMark = found;
        break;
      }
    }

    if (!spanMark) {
      const unassigned = detectedMarks.find((dm) => !finalMarks.includes(dm));
      spanMark = unassigned || `B1-${sIdx + 1}`;
    }
    finalMarks.push(spanMark);

    spans.push({
      id: `span_${sIdx + 1}`,
      beamMark: spanMark,
      centerToCenterSpanMm: ccDistMm,
      clearSpanMm: clearDistMm,
      widthMm,
      depthMm,
      supportColLeftMm: colLeftW,
      supportColRightMm: colRightW,
      colLeftLabel: cLeft.label,
      colRightLabel: cRight.label,
    });
  }

  return {
    spans,
    beamMarks: finalMarks,
    depthMm,
    widthMm,
  };
}
