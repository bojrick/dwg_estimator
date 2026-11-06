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
  scaleToM: number = 0.001
): MemberDetectedGeometry | null {
  const segments = extractAllSegments(lines, polylines);
  if (segments.length === 0) return null;

  const [tx, ty] = tagCoords;
  const searchRadiusUnits = 8.0 / (scaleToM > 0 ? scaleToM : 1.0); // Search up to ~8m equivalent

  // 1. Find segments passing close to tag
  const nearby = segments.filter((s) => {
    return distSqToSegment([tx, ty], s.start, s.end) < (searchRadiusUnits * 0.25) ** 2;
  });

  if (nearby.length === 0) return null;

  // 2. Determine dominant axis (horizontal vs vertical vs angled)
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

  // 3. Search along dominant axis for transverse support lines (columns or cross beams)
  if (isHoriz) {
    // Horizontal beam: span runs in X, support lines run transverse (in Y)
    // Find transverse lines crossing near beam Y level
    let minX = tx - searchRadiusUnits;
    let maxX = tx + searchRadiusUnits;

    let closestLeftX = minX;
    let closestRightX = maxX;

    for (const s of segments) {
      const dx = Math.abs(s.end[0] - s.start[0]);
      const dy = Math.abs(s.end[1] - s.start[1]);
      if (dy > dx * 1.5 && dy > 0.1) {
        // Transverse line in Y
        const minY = Math.min(s.start[1], s.end[1]);
        const maxY = Math.max(s.start[1], s.end[1]);
        if (ty >= minY - 0.5 && ty <= maxY + 0.5) {
          const xPos = (s.start[0] + s.end[0]) / 2;
          if (xPos < tx && xPos > closestLeftX) {
            closestLeftX = xPos;
          } else if (xPos > tx && xPos < closestRightX) {
            closestRightX = xPos;
          }
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
        sourceConfidence: 'high',
        notes: `Clear span detected between transverse supports (${spanMm} mm)`,
      };
    }
  } else {
    // Vertical beam: span runs in Y, support lines run transverse (in X)
    let minY = ty - searchRadiusUnits;
    let maxY = ty + searchRadiusUnits;

    let closestBottomY = minY;
    let closestTopY = maxY;

    for (const s of segments) {
      const dx = Math.abs(s.end[0] - s.start[0]);
      const dy = Math.abs(s.end[1] - s.start[1]);
      if (dx > dy * 1.5 && dx > 0.1) {
        // Transverse line in X
        const minX = Math.min(s.start[0], s.end[0]);
        const maxX = Math.max(s.start[0], s.end[0]);
        if (tx >= minX - 0.5 && tx <= maxX + 0.5) {
          const yPos = (s.start[1] + s.end[1]) / 2;
          if (yPos < ty && yPos > closestBottomY) {
            closestBottomY = yPos;
          } else if (yPos > ty && yPos < closestTopY) {
            closestTopY = yPos;
          }
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
        sourceConfidence: 'high',
        notes: `Clear span detected between transverse supports (${spanMm} mm)`,
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
  scaleToM: number = 0.001
): MemberDetectedGeometry | null {
  if (!tagCoords || !tagCoords[0] || !tagCoords[1]) return null;

  switch (scope) {
    case 'beam':
      return detectBeamSpanFromLayout(tagCoords, lines, polylines, scaleToM);
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
