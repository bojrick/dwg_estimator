/**
 * CadLatticeEngine: High-precision geometric table extraction for CAD drawings.
 * Inspired by open-source vector lattice engines (Camelot / pdfplumber Lattice),
 * operating directly on floating-point CAD lines, polylines, and text entities.
 */

export interface BoxCoords {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
}

export interface LineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface LatticeCell {
  rowIndex: number;
  colIndex: number;
  colSpan: number;
  rowSpan: number;
  bbox: BoxCoords;
  text: string;
}

export interface LatticeTableResult {
  headers: string[];
  rows: string[][];
  cells: LatticeCell[];
  bbox: BoxCoords;
  rowCount: number;
  colCount: number;
  isLattice: boolean; // true if reconstructed from physical vector gridlines
}

/**
 * Decomposes lines and polylines into raw 2D line segments, filtered by bounding box if provided.
 */
export function extractLineSegments(
  lines: any[] = [],
  polylines: any[] = [],
  bbox?: BoxCoords
): LineSegment[] {
  const segments: LineSegment[] = [];

  const inBox = (x: number, y: number) => {
    if (!bbox) return true;
    const pad = 1.0;
    return x >= bbox.min_x - pad && x <= bbox.max_x + pad && y >= bbox.min_y - pad && y <= bbox.max_y + pad;
  };

  // 1. Process LINE entities
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln || !ln.start || !ln.end) continue;
    const x1 = ln.start[0];
    const y1 = ln.start[1];
    const x2 = ln.end[0];
    const y2 = ln.end[1];

    if (inBox(x1, y1) || inBox(x2, y2)) {
      segments.push({ x1, y1, x2, y2 });
    }
  }

  // 2. Process POLYLINE / LWPOLYLINE entities
  for (let i = 0; i < polylines.length; i++) {
    const pl = polylines[i];
    if (!pl || !pl.points || pl.points.length < 2) continue;
    const pts = pl.points;
    const n = pts.length;
    const isClosed = Boolean(pl.closed);

    for (let p = 0; p < n - 1; p++) {
      const x1 = pts[p][0];
      const y1 = pts[p][1];
      const x2 = pts[p + 1][0];
      const y2 = pts[p + 1][1];
      if (inBox(x1, y1) || inBox(x2, y2)) {
        segments.push({ x1, y1, x2, y2 });
      }
    }

    if (isClosed && n >= 3) {
      const x1 = pts[n - 1][0];
      const y1 = pts[n - 1][1];
      const x2 = pts[0][0];
      const y2 = pts[0][1];
      if (inBox(x1, y1) || inBox(x2, y2)) {
        segments.push({ x1, y1, x2, y2 });
      }
    }
  }

  return segments;
}

/**
 * Merges collinear, overlapping, or adjacent line segments.
 */
function mergeCollinearSegments(
  segments: { coord: number; min: number; max: number }[],
  coordSnapTol: number,
  gapTol: number
): { coord: number; min: number; max: number }[] {
  // Sort by coord then min
  const sorted = [...segments].sort((a, b) => a.coord - b.coord || a.min - b.min);
  const merged: { coord: number; min: number; max: number; count: number }[] = [];

  for (const seg of sorted) {
    let placed = false;
    for (const m of merged) {
      if (Math.abs(m.coord - seg.coord) <= coordSnapTol) {
        // Check if ranges overlap or touch within gapTol
        if (seg.min <= m.max + gapTol && seg.max >= m.min - gapTol) {
          m.min = Math.min(m.min, seg.min);
          m.max = Math.max(m.max, seg.max);
          m.coord = (m.coord * m.count + seg.coord) / (m.count + 1);
          m.count++;
          placed = true;
          break;
        }
      }
    }
    if (!placed) {
      merged.push({ coord: seg.coord, min: seg.min, max: seg.max, count: 1 });
    }
  }

  return merged.map((m) => ({ coord: m.coord, min: m.min, max: m.max }));
}

/**
 * Extracts a table using Vector Lattice Grid Analysis:
 * Identifies physical horizontal and vertical gridlines, finds their intersections,
 * forms cells, and assigns texts strictly to their respective cell boundaries.
 */
export function extractTableViaLattice(
  lines: any[],
  polylines: any[],
  texts: any[],
  bbox: BoxCoords
): LatticeTableResult | null {
  // Filter texts inside bbox
  const insideTexts = (texts || []).filter(
    (t) =>
      t &&
      t.text &&
      typeof t.x === 'number' &&
      typeof t.y === 'number' &&
      t.x >= bbox.min_x - 0.5 &&
      t.x <= bbox.max_x + 0.5 &&
      t.y >= bbox.min_y - 0.5 &&
      t.y <= bbox.max_y + 0.5
  );

  if (insideTexts.length < 2) return null;

  const avgTextHeight =
    insideTexts.reduce((sum, t) => sum + (t.height || 0.25), 0) / insideTexts.length || 0.25;

  const segments = extractLineSegments(lines, polylines, bbox);

  const angleTol = 0.05; // ~3 degrees
  const coordSnapTol = Math.max(0.05, avgTextHeight * 0.25);
  const gapTol = Math.max(0.2, avgTextHeight * 1.5);
  const minSegLen = Math.max(0.5, avgTextHeight * 1.5);

  const rawHoriz: { coord: number; min: number; max: number }[] = [];
  const rawVert: { coord: number; min: number; max: number }[] = [];

  for (const s of segments) {
    const dx = Math.abs(s.x2 - s.x1);
    const dy = Math.abs(s.y2 - s.y1);
    const len = Math.hypot(dx, dy);
    if (len < minSegLen) continue;

    // Horizontal line
    if (dy <= dx * angleTol || dy < coordSnapTol) {
      const y = (s.y1 + s.y2) / 2;
      const minX = Math.min(s.x1, s.x2);
      const maxX = Math.max(s.x1, s.x2);
      // Ensure it intersects table bbox
      if (maxX >= bbox.min_x && minX <= bbox.max_x) {
        rawHoriz.push({
          coord: y,
          min: Math.max(bbox.min_x, minX),
          max: Math.min(bbox.max_x, maxX),
        });
      }
    }
    // Vertical line
    else if (dx <= dy * angleTol || dx < coordSnapTol) {
      const x = (s.x1 + s.x2) / 2;
      const minY = Math.min(s.y1, s.y2);
      const maxY = Math.max(s.y1, s.y2);
      if (maxY >= bbox.min_y && minY <= bbox.max_y) {
        rawVert.push({
          coord: x,
          min: Math.max(bbox.min_y, minY),
          max: Math.min(bbox.max_y, maxY),
        });
      }
    }
  }

  const mergedHoriz = mergeCollinearSegments(rawHoriz, coordSnapTol, gapTol);
  const mergedVert = mergeCollinearSegments(rawVert, coordSnapTol, gapTol);

  // If there are not enough physical gridlines (less than 2 rows or 2 cols), fall back
  if (mergedHoriz.length < 2 || mergedVert.length < 2) {
    return extractTableViaStream(insideTexts, bbox, avgTextHeight);
  }

  // Row boundaries: sorted Y descending (top to bottom)
  const rowY = Array.from(new Set(mergedHoriz.map((h) => h.coord))).sort((a, b) => b - a);
  // Col boundaries: sorted X ascending (left to right)
  const colX = Array.from(new Set(mergedVert.map((v) => v.coord))).sort((a, b) => a - b);

  if (rowY.length < 2 || colX.length < 2) {
    return extractTableViaStream(insideTexts, bbox, avgTextHeight);
  }

  const rowCount = rowY.length - 1;
  const colCount = colX.length - 1;

  const cells: LatticeCell[] = [];
  const grid: string[][] = Array.from({ length: rowCount }, () => new Array(colCount).fill(''));

  // Build cells and assign texts
  for (let r = 0; r < rowCount; r++) {
    const yTop = rowY[r];
    const yBtm = rowY[r + 1];

    for (let c = 0; c < colCount; c++) {
      const xLeft = colX[c];
      const xRight = colX[c + 1];

      const cellBox: BoxCoords = {
        min_x: xLeft,
        min_y: yBtm,
        max_x: xRight,
        max_y: yTop,
      };

      // Slight padding to catch texts aligned directly against cell borders
      const padX = (xRight - xLeft) * 0.05;
      const padY = (yTop - yBtm) * 0.05;

      const cellTexts = insideTexts.filter(
        (t) =>
          t.x >= xLeft - padX &&
          t.x <= xRight + padX &&
          t.y >= yBtm - padY &&
          t.y <= yTop + padY
      );

      // Sort texts inside the cell by Y descending (top-to-bottom reading order), then X
      cellTexts.sort((a, b) => b.y - a.y || a.x - b.x);

      const cellString = cellTexts
        .map((t) => String(t.text).trim())
        .filter(Boolean)
        .join(' ');

      grid[r][c] = cellString;

      cells.push({
        rowIndex: r,
        colIndex: c,
        colSpan: 1,
        rowSpan: 1,
        bbox: cellBox,
        text: cellString,
      });
    }
  }

  // Filter out any columns that are 100% empty across all rows
  const activeColIndices = Array.from({ length: colCount }, (_, idx) => idx).filter((cIdx) =>
    grid.some((row) => Boolean(row[cIdx]))
  );

  if (activeColIndices.length < 1) return null;

  const finalGrid = grid.map((row) => activeColIndices.map((cIdx) => row[cIdx] || ''));

  // Separate header row and data rows
  const headers = finalGrid[0].map((h, idx) => h || `Col ${idx + 1}`);
  const dataRows = finalGrid.slice(1);

  return {
    headers,
    rows: dataRows,
    cells,
    bbox,
    rowCount: finalGrid.length,
    colCount: headers.length,
    isLattice: true,
  };
}

/**
 * Fallback Stream Extraction: Uses whitespace projection profiles when physical gridlines
 * are absent (borderless / open tables).
 */
export function extractTableViaStream(
  texts: any[],
  bbox: BoxCoords,
  avgHeight: number
): LatticeTableResult | null {
  if (!texts || texts.length < 2) return null;

  const rowTolerance = Math.max(0.12, avgHeight * 1.1);

  // Group into rows by Y descending
  const sortedByY = [...texts].sort((a, b) => b.y - a.y);
  const rawRows: any[][] = [];

  for (const t of sortedByY) {
    let placed = false;
    for (const r of rawRows) {
      if (Math.abs(r[0].y - t.y) <= rowTolerance) {
        r.push(t);
        placed = true;
        break;
      }
    }
    if (!placed) {
      rawRows.push([t]);
    }
  }

  if (rawRows.length < 2) return null;

  // Determine global column boundaries
  const allX = texts.map((t) => t.x).sort((a, b) => a - b);
  const colCenters: number[] = [];
  const colTolerance = Math.max(0.4, avgHeight * 3.5);

  for (const x of allX) {
    const matchedIdx = colCenters.findIndex((c) => Math.abs(c - x) <= colTolerance);
    if (matchedIdx >= 0) {
      colCenters[matchedIdx] = (colCenters[matchedIdx] + x) / 2;
    } else {
      colCenters.push(x);
    }
  }
  colCenters.sort((a, b) => a - b);

  const grid: string[][] = [];
  for (const r of rawRows) {
    const rowCells: string[] = new Array(colCenters.length).fill('');
    for (const t of r) {
      let closestCol = 0;
      let minDist = Infinity;
      for (let c = 0; c < colCenters.length; c++) {
        const dist = Math.abs(colCenters[c] - t.x);
        if (dist < minDist) {
          minDist = dist;
          closestCol = c;
        }
      }
      const existing = rowCells[closestCol];
      rowCells[closestCol] = existing ? `${existing} ${t.text.trim()}` : t.text.trim();
    }
    grid.push(rowCells);
  }

  const activeColIndices = colCenters
    .map((_, idx) => idx)
    .filter((idx) => grid.some((r) => Boolean(r[idx])));

  if (activeColIndices.length < 2) return null;

  const cleanedGrid = grid.map((r) => activeColIndices.map((idx) => r[idx] || ''));
  const headers = cleanedGrid[0].map((h, idx) => h || `Col ${idx + 1}`);
  const dataRows = cleanedGrid.slice(1);

  return {
    headers,
    rows: dataRows,
    cells: [],
    bbox,
    rowCount: cleanedGrid.length,
    colCount: headers.length,
    isLattice: false,
  };
}

