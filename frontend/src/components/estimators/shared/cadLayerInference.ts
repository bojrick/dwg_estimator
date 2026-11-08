import { WorldBBox } from './CadEstimatorCanvas';
import {
  RoomDefinition,
  OpeningDefinition,
  ArchitecturalParameters,
} from '../ArchitecturalEstimator/types';
import {
  ElectricalPointItem,
  ElectricalPointType,
  ElectricalParameters,
} from '../ElectricalEstimator/types';
import {
  PlumbingFixtureItem,
  PlumbingFixtureType,
  PlumbingParameters,
} from '../PlumbingEstimator/types';
import {
  FireProtectionItem,
  FireItemType,
  FireProtectionParameters,
} from '../FireEstimator/types';

export interface LayerStat {
  name: string;
  color: string;
  entityCount: number;
  lineLengthM: number;
  closedAreaM2: number;
  circleArcCount: number;
  textCount: number;
  inferredRole: string;
}

function inBox(x: number, y: number, box?: WorldBBox | null): boolean {
  if (!box) return true;
  return x >= box.min_x && x <= box.max_x && y >= box.min_y && y <= box.max_y;
}

function polyLengthWorld(pts: number[][], closed?: boolean): number {
  if (!pts || pts.length < 2) return 0;
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    len += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  }
  if (closed && pts.length >= 3) {
    len += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  }
  return len;
}

function polyAreaWorld(pts: number[][]): number {
  if (!pts || pts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) * 0.5;
}

export function analyzeCadLayers(
  rawData: any,
  discipline: 'architectural' | 'electrical' | 'plumbing' | 'fire',
  box?: WorldBBox | null,
  roleOverrides: Record<string, string> = {}
): LayerStat[] {
  if (!rawData) return [];
  const scaleToM = Number(rawData.scale_to_m) || 1.0;
  const map = new Map<string, LayerStat>();

  const ensure = (lname?: string, color?: string): LayerStat => {
    const key = lname || '0';
    let entry = map.get(key);
    if (!entry) {
      entry = {
        name: key,
        color: color || '#94a3b8',
        entityCount: 0,
        lineLengthM: 0,
        closedAreaM2: 0,
        circleArcCount: 0,
        textCount: 0,
        inferredRole: roleOverrides[key] || inferLayerRole(key, discipline),
      };
      map.set(key, entry);
    }
    return entry;
  };

  for (const ln of rawData.lines || []) {
    if (!inBox(ln.start[0], ln.start[1], box) && !inBox(ln.end[0], ln.end[1], box)) continue;
    const st = ensure(ln.layer, ln.color);
    st.entityCount++;
    st.lineLengthM += Math.hypot(ln.end[0] - ln.start[0], ln.end[1] - ln.start[1]) * scaleToM;
  }

  for (const pl of rawData.polylines || []) {
    if (!pl.points || pl.points.length < 2) continue;
    if (!pl.points.some((p: number[]) => inBox(p[0], p[1], box))) continue;
    const st = ensure(pl.layer, pl.color);
    st.entityCount++;
    st.lineLengthM += polyLengthWorld(pl.points, pl.closed) * scaleToM;
    const isClosed =
      pl.closed ||
      (pl.points.length >= 4 &&
        Math.hypot(
          pl.points[0][0] - pl.points[pl.points.length - 1][0],
          pl.points[0][1] - pl.points[pl.points.length - 1][1]
        ) *
          scaleToM <
          0.15);
    if (isClosed) {
      st.closedAreaM2 += polyAreaWorld(pl.points) * scaleToM * scaleToM;
    }
  }

  for (const ac of rawData.arcs_circles || []) {
    if (!ac.center || !inBox(ac.center[0], ac.center[1], box)) continue;
    const st = ensure(ac.layer, ac.color);
    st.entityCount++;
    st.circleArcCount++;
  }

  for (const t of rawData.texts || []) {
    if (!inBox(t.x, t.y, box)) continue;
    const st = ensure(t.layer, t.color);
    st.entityCount++;
    st.textCount++;
  }

  return Array.from(map.values())
    .map((s) => ({
      ...s,
      lineLengthM: Math.round(s.lineLengthM * 10) / 10,
      closedAreaM2: Math.round(s.closedAreaM2 * 10) / 10,
      inferredRole: roleOverrides[s.name] || s.inferredRole,
    }))
    .sort((a, b) => b.entityCount - a.entityCount);
}

export function inferLayerRole(
  layerName: string,
  discipline: 'architectural' | 'electrical' | 'plumbing' | 'fire'
): string {
  const s = layerName.toUpperCase();
  if (/(GRID|AXIS|DIM|TEXT|ANNO|TITLE|BORDER|FRAME|DEFPOINTS|HATCH)/.test(s)) return 'annotation';

  if (discipline === 'architectural') {
    if (/(PARAPET|PRPT|BALCONY.*WALL|TERRACE.*WALL|RAILING)/.test(s)) return 'parapet';
    if (/(EXT.*WALL|OUTER.*WALL|230|200.*WALL)/.test(s)) return 'ext_wall';
    if (/(INT.*WALL|PART|115|100.*WALL)/.test(s)) return 'int_wall';
    if (/(WALL|BRICK|MASON|BLK|BLOCK|AAC)/.test(s)) return 'wall';
    if (/(DOOR|DR|OPEN)/.test(s)) return 'door';
    if (/(WIN|WDW|GLAZ|VENT)/.test(s)) return 'window';
    if (/(ROOM|AREA|SPACE|FLOOR|TILE|FINISH)/.test(s)) return 'room';
    return 'general';
  }

  if (discipline === 'electrical') {
    if (/(COND|WIRE|CABLE|CIRC|LOOP|TRAY)/.test(s)) return 'conduit';
    if (/(LIGHT|LTG|LED|LAMP|FIXT|LUM)/.test(s)) return 'light';
    if (/(FAN|EXH)/.test(s)) return 'fan';
    if (/(16A|20A|POWER|PWR|RAW|AC|HVAC|GEYSER)/.test(s)) return 'power';
    if (/(6A|SOCK|PLUG|SW|SWITCH|SB)/.test(s)) return 'socket';
    if (/(DB|PANEL|MDB|SDB|DIST)/.test(s)) return 'db';
    return 'general';
  }

  if (discipline === 'plumbing') {
    if (/(SOIL|SVP|110|SEWER|FOUL)/.test(s)) return 'drain_110';
    if (/(WASTE|WVP|75|SULLAGE|DRAIN|SWR|RWP)/.test(s)) return 'drain_75';
    if (/(25|MAIN.*WTR|RISER.*WTR|HEADER)/.test(s)) return 'supply_25';
    if (/(20|HOT|HW)/.test(s)) return 'supply_20';
    if (/(CPVC|UPVC|CW|COLD|WTR|WATER|SUPPLY|PIPE)/.test(s)) return 'supply_15';
    if (/(SAN|FIXT|WC|TOILET|PLUMB|PHE|BASIN|SINK|TRAP)/.test(s)) return 'fixture';
    return 'general';
  }

  if (discipline === 'fire') {
    if (/(RISER|MAIN|HEADER|150|100)/.test(s)) return 'riser_pipe';
    if (/(BRANCH|SPR.*PIPE|FIRE.*PIPE|65|50|40|32|25|PIPE)/.test(s)) return 'branch_pipe';
    if (/(SPR|HEAD|PEND|UPRIGHT)/.test(s)) return 'sprinkler';
    if (/(FHR|HOSE|REEL|FHC)/.test(s)) return 'hose_reel';
    if (/(HYD|LANDING|VALVE)/.test(s)) return 'landing_valve';
    if (/(EXT|FE|ABC|CO2)/.test(s)) return 'extinguisher';
    return 'general';
  }

  return 'general';
}

function stripDxfMtext(raw: string): string {
  return String(raw || '')
    .replace(/\\P/gi, '\n')
    .replace(/\\X/gi, '\n')
    .replace(/\\[fFcCHWTQApS][^;]*;/g, '')
    .replace(/[{}]/g, '')
    .trim();
}

export function parseDimTokenWithLabel(
  rawInput: string
): { wM: number; hM: number; label: string } | null {
  const str = stripDxfMtext(rawInput);

  const ftInRe =
    /(\d{1,2}(?:\.\d+)?)\s*['’]\s*(?:[-–—]?\s*(\d{1,2}(?:\.\d+)?)\s*(?:["”]|''|in\b)?)?\s*[xX×*]\s*(\d{1,2}(?:\.\d+)?)\s*['’]\s*(?:[-–—]?\s*(\d{1,2}(?:\.\d+)?)\s*(?:["”]|''|in\b)?)?/;
  const ftMatch = str.match(ftInRe);
  if (ftMatch) {
    const f1 = parseFloat(ftMatch[1]) + (ftMatch[2] ? parseFloat(ftMatch[2]) / 12 : 0);
    const f2 = parseFloat(ftMatch[3]) + (ftMatch[4] ? parseFloat(ftMatch[4]) / 12 : 0);
    const w = Math.round(f1 * 0.3048 * 1000) / 1000;
    const h = Math.round(f2 * 0.3048 * 1000) / 1000;
    if (w >= 0.35 && h >= 0.35 && w <= 45 && h <= 45) {
      return { wM: w, hM: h, label: ftMatch[0].trim() };
    }
  }

  const numRe =
    /(\d+(?:\.\d+)?)\s*(mm|cm|m|ft|feet)?\s*[xX×*]\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|ft|feet)?/i;
  const numMatch = str.match(numRe);
  if (numMatch) {
    let a = parseFloat(numMatch[1]);
    let b = parseFloat(numMatch[3]);
    const unit = (numMatch[2] || numMatch[4] || '').toLowerCase();

    if (unit === 'mm' || (a >= 350 && b >= 350)) {
      a /= 1000;
      b /= 1000;
    } else if (unit === 'cm' || (a >= 65 && b >= 65 && a < 350 && b < 350)) {
      a /= 100;
      b /= 100;
    } else if (
      unit === 'ft' ||
      unit === 'feet' ||
      (a > 7.5 && b > 7.5 && a <= 45 && b <= 45 && !str.includes('.'))
    ) {
      a *= 0.3048;
      b *= 0.3048;
    }
    if (a >= 0.35 && b >= 0.35 && a <= 50 && b <= 50) {
      return {
        wM: Math.round(a * 1000) / 1000,
        hM: Math.round(b * 1000) / 1000,
        label: numMatch[0].trim(),
      };
    }
  }
  return null;
}

function parseDimTokenToMeters(str: string): [number, number] | null {
  const parsed = parseDimTokenWithLabel(str);
  return parsed ? [parsed.wM, parsed.hM] : null;
}

export function pointInPoly(x: number, y: number, pts: number[][]): boolean {
  if (!pts || pts.length < 3) return false;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0],
      yi = pts[i][1];
    const xj = pts[j][0],
      yj = pts[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export interface WallBoundaryEnclosure {
  boundaryPolygon: [number, number][]; // in CAD world coords
  areaM2: number;
  perimeterM: number;
  parapetLengthM: number;
  isParapetEnclosed: boolean;
  widthM: number;
  lengthM: number;
  bbox: WorldBBox;
}

function perpDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / Math.sqrt(lenSq);
}

function rdpSimplifyOpen(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length <= 2) return pts;
  let maxD = 0;
  let maxIdx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDistance(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) {
      maxD = d;
      maxIdx = i;
    }
  }
  if (maxD > tol) {
    const left = rdpSimplifyOpen(pts.slice(0, maxIdx + 1), tol);
    const right = rdpSimplifyOpen(pts.slice(maxIdx), tol);
    return left.slice(0, -1).concat(right);
  }
  return [pts[0], pts[pts.length - 1]];
}

function rdpSimplifyPolygon(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length <= 3) return pts;
  let maxD = 0;
  let splitIdx = 1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > maxD) {
      maxD = d;
      splitIdx = i;
    }
  }
  const half1 = rdpSimplifyOpen(pts.slice(0, splitIdx + 1), tol);
  const half2 = rdpSimplifyOpen(pts.slice(splitIdx).concat([pts[0]]), tol);
  const merged = half1.slice(0, -1).concat(half2.slice(0, -1));
  return merged.length >= 3 ? merged : pts;
}

export function traceWallBoundaryEnclosure(
  seedX: number,
  seedY: number,
  rawData: any,
  scaleToM: number,
  box?: WorldBBox | null,
  roleOverrides: Record<string, string> = {}
): WallBoundaryEnclosure | null {
  interface WallSeg {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    isParapet: boolean;
    layer: string;
  }
  const segments: WallSeg[] = [];

  const addSeg = (x1: number, y1: number, x2: number, y2: number, layer: string = '0') => {
    if (!inBox(x1, y1, box) && !inBox(x2, y2, box)) return;
    const lenM = Math.hypot(x2 - x1, y2 - y1) * scaleToM;
    if (lenM < 0.2) return;
    const s = layer.toUpperCase();
    if (/(GRID|AXIS|DIM|TEXT|ANNO|TITLE|BORDER|FRAME|DEFPOINTS|HATCH)/i.test(s)) return;
    const role = roleOverrides[layer] || inferLayerRole(layer, 'architectural');
    if (role === 'annotation') return;
    const isParapet =
      role === 'parapet' ||
      /(PARAPET|PRPT|BALCONY.*WALL|TERRACE.*WALL|RAILING)/i.test(s) ||
      /(PARAPET|PRPT|BALCONY|TERRACE)/i.test(role);
    segments.push({ x1, y1, x2, y2, isParapet, layer });
  };

  for (const ln of rawData?.lines || []) {
    addSeg(ln.start[0], ln.start[1], ln.end[0], ln.end[1], ln.layer);
  }
  for (const pl of rawData?.polylines || []) {
    const pts = pl.points;
    if (!pts || pts.length < 2) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      addSeg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], pl.layer);
    }
    if (pl.closed && pts.length >= 3) {
      addSeg(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1], pl.layer);
    }
  }

  if (segments.length === 0) return null;

  // Door opening bridge segments (close small gaps 0.65m - 1.4m between wall endpoints near seed)
  const localEndpoints: { x: number; y: number }[] = [];
  for (const seg of segments) {
    if (Math.hypot(seg.x1 - seedX, seg.y1 - seedY) * scaleToM <= 16.0) {
      localEndpoints.push({ x: seg.x1, y: seg.y1 });
    }
    if (Math.hypot(seg.x2 - seedX, seg.y2 - seedY) * scaleToM <= 16.0) {
      localEndpoints.push({ x: seg.x2, y: seg.y2 });
    }
  }
  for (let i = 0; i < localEndpoints.length; i++) {
    for (let j = i + 1; j < localEndpoints.length; j++) {
      const dM =
        Math.hypot(localEndpoints[i].x - localEndpoints[j].x, localEndpoints[i].y - localEndpoints[j].y) *
        scaleToM;
      if (dM >= 0.65 && dM <= 1.35) {
        segments.push({
          x1: localEndpoints[i].x,
          y1: localEndpoints[i].y,
          x2: localEndpoints[j].x,
          y2: localEndpoints[j].y,
          isParapet: false,
          layer: 'VIRTUAL_DOOR_CLOSURE',
        });
      }
    }
  }

  const maxSearchDist = 20.0 / scaleToM;
  const minHitDist = 0.12 / scaleToM;
  const rayAngles: number[] = [];

  // 1) 90 radial rays at 4-degree intervals
  const numRegular = 90;
  for (let i = 0; i < numRegular; i++) {
    rayAngles.push((i * 2 * Math.PI) / numRegular);
  }

  // 2) Rays towards segment endpoints within search distance
  for (const seg of segments) {
    for (const [px, py] of [
      [seg.x1, seg.y1],
      [seg.x2, seg.y2],
    ]) {
      const dist = Math.hypot(px - seedX, py - seedY);
      if (dist > minHitDist && dist < maxSearchDist) {
        const ang = Math.atan2(py - seedY, px - seedX);
        const normAng = ang < 0 ? ang + 2 * Math.PI : ang;
        rayAngles.push(normAng);
        rayAngles.push((normAng - 0.001 + 2 * Math.PI) % (2 * Math.PI));
        rayAngles.push((normAng + 0.001) % (2 * Math.PI));
      }
    }
  }

  rayAngles.sort((a, b) => a - b);

  const rawHitPoints: { pt: [number, number]; isParapet: boolean; dist: number }[] = [];
  let prevAngle = -1;

  for (const ang of rayAngles) {
    if (prevAngle >= 0 && Math.abs(ang - prevAngle) < 1e-4) continue;
    prevAngle = ang;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);

    let closestT = Infinity;
    let hitParapet = false;

    for (const seg of segments) {
      const deltaX = seg.x2 - seg.x1;
      const deltaY = seg.y2 - seg.y1;
      const det = deltaX * dy - deltaY * dx;
      if (Math.abs(det) < 1e-9) continue;

      const t = (deltaX * (seg.y1 - seedY) - deltaY * (seg.x1 - seedX)) / det;
      if (t <= minHitDist || t >= closestT || t >= maxSearchDist) continue;

      const u = (dx * (seg.y1 - seedY) - dy * (seg.x1 - seedX)) / det;
      if (u >= -0.002 && u <= 1.002) {
        closestT = t;
        hitParapet = seg.isParapet;
      }
    }

    if (closestT < maxSearchDist) {
      rawHitPoints.push({
        pt: [seedX + closestT * dx, seedY + closestT * dy],
        isParapet: hitParapet,
        dist: closestT,
      });
    }
  }

  if (rawHitPoints.length < 8) return null;

  // Deduplicate points within 0.05m
  const deduped: [number, number][] = [];
  for (const h of rawHitPoints) {
    if (
      deduped.length === 0 ||
      Math.hypot(h.pt[0] - deduped[deduped.length - 1][0], h.pt[1] - deduped[deduped.length - 1][1]) * scaleToM > 0.05
    ) {
      deduped.push(h.pt);
    }
  }

  if (deduped.length < 3) return null;

  // Simplify using Ramer-Douglas-Peucker with 0.06m tolerance
  const simplified = rdpSimplifyPolygon(deduped, 0.06 / scaleToM);
  if (simplified.length < 3) return null;

  // Shoelace Area & Euclidean Perimeter
  let areaSum = 0;
  let perimSum = 0;
  const xs: number[] = [];
  const ys: number[] = [];

  for (let i = 0; i < simplified.length; i++) {
    const p1 = simplified[i];
    const p2 = simplified[(i + 1) % simplified.length];
    areaSum += p1[0] * p2[1] - p2[0] * p1[1];
    perimSum += Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    xs.push(p1[0]);
    ys.push(p1[1]);
  }

  const areaM2 = Math.round(Math.abs(areaSum) * 0.5 * scaleToM * scaleToM * 100) / 100;
  const perimeterM = Math.round(perimSum * scaleToM * 100) / 100;

  if (areaM2 < 1.2 || areaM2 > 500) return null;

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const widthM = Math.round((maxX - minX) * scaleToM * 100) / 100;
  const lengthM = Math.round((maxY - minY) * scaleToM * 100) / 100;

  // Detect parapet boundary length along simplified edges
  let parapetLengthM = 0;
  for (let i = 0; i < simplified.length; i++) {
    const p1 = simplified[i];
    const p2 = simplified[(i + 1) % simplified.length];
    const mx = (p1[0] + p2[0]) * 0.5;
    const my = (p1[1] + p2[1]) * 0.5;
    const edgeLenM = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * scaleToM;

    for (const seg of segments) {
      if (!seg.isParapet) continue;
      const d = perpDistance([mx, my], [seg.x1, seg.y1], [seg.x2, seg.y2]) * scaleToM;
      if (d < 0.25) {
        parapetLengthM += edgeLenM;
        break;
      }
    }
  }
  parapetLengthM = Math.round(parapetLengthM * 10) / 10;
  const isParapetEnclosed = parapetLengthM >= 0.8;

  return {
    boundaryPolygon: simplified,
    areaM2,
    perimeterM,
    parapetLengthM,
    isParapetEnclosed,
    widthM,
    lengthM,
    bbox: {
      min_x: minX,
      min_y: minY,
      max_x: maxX,
      max_y: maxY,
      width: maxX - minX,
      height: maxY - minY,
    },
  };
}

function raycastRoomEnclosure(
  tx: number,
  ty: number,
  rawData: any,
  scaleToM: number,
  box?: WorldBBox | null
): { wM: number; hM: number; bbox: WorldBBox } | null {
  const maxSearchWorld = 16.0 / scaleToM;
  const minSearchWorld = 0.35 / scaleToM;
  const doorGapTolWorld = 0.55 / scaleToM;

  let xLeft: number | null = null;
  let xRight: number | null = null;
  let yBottom: number | null = null;
  let yTop: number | null = null;

  const testSeg = (x1: number, y1: number, x2: number, y2: number, layer?: string) => {
    if (layer && /(GRID|AXIS|DIM|TEXT|ANNO|TITLE|HATCH)/i.test(layer)) return;
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    const lenM = Math.hypot(dx, dy) * scaleToM;
    if (lenM < 0.45) return;

    if (dx <= dy * 0.08) {
      const vx = (x1 + x2) * 0.5;
      const minY = Math.min(y1, y2) - doorGapTolWorld;
      const maxY = Math.max(y1, y2) + doorGapTolWorld;
      if (ty >= minY && ty <= maxY) {
        const dist = vx - tx;
        if (dist < -minSearchWorld && dist > -maxSearchWorld) {
          if (xLeft === null || vx > xLeft) xLeft = vx;
        } else if (dist > minSearchWorld && dist < maxSearchWorld) {
          if (xRight === null || vx < xRight) xRight = vx;
        }
      }
    } else if (dy <= dx * 0.08) {
      const hy = (y1 + y2) * 0.5;
      const minX = Math.min(x1, x2) - doorGapTolWorld;
      const maxX = Math.max(x1, x2) + doorGapTolWorld;
      if (tx >= minX && tx <= maxX) {
        const dist = hy - ty;
        if (dist < -minSearchWorld && dist > -maxSearchWorld) {
          if (yBottom === null || hy > yBottom) yBottom = hy;
        } else if (dist > minSearchWorld && dist < maxSearchWorld) {
          if (yTop === null || hy < yTop) yTop = hy;
        }
      }
    }
  };

  for (const ln of rawData?.lines || []) {
    if (!inBox(ln.start[0], ln.start[1], box) && !inBox(ln.end[0], ln.end[1], box)) continue;
    testSeg(ln.start[0], ln.start[1], ln.end[0], ln.end[1], ln.layer);
  }
  for (const pl of rawData?.polylines || []) {
    const pts = pl.points;
    if (!pts || pts.length < 2) continue;
    if (!pts.some((p: number[]) => inBox(p[0], p[1], box))) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      testSeg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], pl.layer);
    }
    if (pl.closed && pts.length >= 3) {
      testSeg(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1], pl.layer);
    }
  }

  if (xLeft !== null && xRight !== null && yBottom !== null && yTop !== null) {
    const wM = Math.round((xRight - xLeft) * scaleToM * 100) / 100;
    const hM = Math.round((yTop - yBottom) * scaleToM * 100) / 100;
    if (wM >= 0.85 && hM >= 0.85 && wM <= 24 && hM <= 24 && wM * hM >= 1.5 && wM * hM <= 320) {
      return {
        wM,
        hM,
        bbox: {
          min_x: xLeft,
          min_y: yBottom,
          max_x: xRight,
          max_y: yTop,
          width: xRight - xLeft,
          height: yTop - yBottom,
        },
      };
    }
  }
  return null;
}

// ============================================================================
// 1. ARCHITECTURAL LAYER & GEOMETRY INFERENCE
// ============================================================================
export interface ArchInferenceResult {
  rooms: RoomDefinition[];
  openings: OpeningDefinition[];
  paramPatch: Partial<ArchitecturalParameters>;
  summaryNote: string;
}

const ROOM_NAME_RE =
  /\b(living|dining|drawing|hall|lounge|foyer|lobby|verandah|sit\s*out|bedroom|master\s*bed|guest\s*bed|kids\s*bed|children\s*bed|bed\s*room|m\.?\s*bed|kitchen|utility|wash|store|pantry|pooja|puja|mandir|study|office|cabin|conference|reception|toilet|bath|w\.?c\.?|powder|dress|balcony|deck|terrace|corridor|passage|stair|lift|parking|porch|garage|servant|maid)\b/i;

export function inferArchitecturalFromCad(
  rawData: any,
  box?: WorldBBox | null,
  roleOverrides: Record<string, string> = {}
): ArchInferenceResult {
  const scaleToM = Number(rawData?.scale_to_m) || 1.0;
  const layerStats = analyzeCadLayers(rawData, 'architectural', box, roleOverrides);
  const roleByLayer = new Map(layerStats.map((l) => [l.name, l.inferredRole]));

  // 1) Infer external vs internal vs parapet wall lengths (accounting for double-line CAD walls: divide by 2)
  let extLineM = 0;
  let intLineM = 0;
  let parapetLineM = 0;
  let genericWallLineM = 0;
  for (const st of layerStats) {
    if (st.inferredRole === 'ext_wall') extLineM += st.lineLengthM;
    else if (st.inferredRole === 'int_wall') intLineM += st.lineLengthM;
    else if (st.inferredRole === 'parapet') parapetLineM += st.lineLengthM;
    else if (st.inferredRole === 'wall') genericWallLineM += st.lineLengthM;
  }

  let extWallLengthM = Math.round((extLineM / 2) * 10) / 10;
  let intWallLengthM = Math.round((intLineM / 2) * 10) / 10;
  let parapetWallLengthM = Math.round((parapetLineM > 0 ? parapetLineM / 2 : 0) * 10) / 10;
  if (genericWallLineM > 0) {
    const centerLen = genericWallLineM / 2;
    extWallLengthM = Math.round((extWallLengthM + centerLen * 0.45) * 10) / 10;
    intWallLengthM = Math.round((intWallLengthM + centerLen * 0.55) * 10) / 10;
  }

  // 2) Collect closed polylines for deterministic Point-in-Polygon enclosure
  const texts = (rawData?.texts || []).filter((t: any) => t.text && inBox(t.x, t.y, box));
  const closedRoomPolys: {
    pts: number[][];
    areaM2: number;
    perimM: number;
    layer: string;
    bbox: WorldBBox;
  }[] = [];

  for (const pl of rawData?.polylines || []) {
    if (!pl.points || pl.points.length < 4) continue;
    if (!pl.points.some((p: number[]) => inBox(p[0], p[1], box))) continue;
    const isClosed =
      pl.closed ||
      Math.hypot(
        pl.points[0][0] - pl.points[pl.points.length - 1][0],
        pl.points[0][1] - pl.points[pl.points.length - 1][1]
      ) *
        scaleToM <
        0.25;
    if (!isClosed) continue;
    const areaM2 = polyAreaWorld(pl.points) * scaleToM * scaleToM;
    if (areaM2 < 1.2 || areaM2 > 420) continue;
    const perimM = polyLengthWorld(pl.points, true) * scaleToM;
    const xs = pl.points.map((p: number[]) => p[0]);
    const ys = pl.points.map((p: number[]) => p[1]);
    closedRoomPolys.push({
      pts: pl.points,
      areaM2,
      perimM,
      layer: pl.layer || '0',
      bbox: {
        min_x: Math.min(...xs),
        min_y: Math.min(...ys),
        max_x: Math.max(...xs),
        max_y: Math.max(...ys),
      },
    });
  }

  const rooms: RoomDefinition[] = [];
  const seenRoomCoords: [number, number][] = [];

  for (const t of texts) {
    const cleanedText = stripDxfMtext(String(t.text || ''));
    if (cleanedText.length < 2 || cleanedText.length > 72) continue;
    if (!ROOM_NAME_RE.test(cleanedText)) continue;
    if (/\b(schedule|note|detail|section|elevation|scale|drawing)\b/i.test(cleanedText)) continue;

    if (
      seenRoomCoords.some(
        ([rx, ry]) => Math.hypot((rx - t.x) * scaleToM, (ry - t.y) * scaleToM) < 0.95
      )
    ) {
      continue;
    }

    // Priority A: Inline dimension on the same MText/Text label, or adjacent dimension text right below/near the room name
    let parsedDims = parseDimTokenWithLabel(cleanedText);
    if (!parsedDims) {
      const candidates = texts
        .filter((other: any) => {
          if (other === t) return false;
          const otherText = stripDxfMtext(String(other.text || ''));
          const otherLayer = other.layer || '0';
          const otherRole = roleOverrides[otherLayer] || inferLayerRole(otherLayer, 'architectural');
          if (otherRole === 'door' || otherRole === 'window') return false;
          if (/\b(M?D\d*|FD\d*|SD\d*|K?W\d*|F?V\d*|C\d+|B\d+|door|window|vent)\b/i.test(otherText)) {
            return false;
          }
          if (ROOM_NAME_RE.test(otherText)) return false;
          const dxM = Math.abs(other.x - t.x) * scaleToM;
          const dyM = (other.y - t.y) * scaleToM;
          return dxM <= 2.4 && dyM >= -2.5 && dyM <= 1.2;
        })
        .map((other: any) => {
          const d = parseDimTokenWithLabel(String(other.text || ''));
          if (!d) return null;
          const distScore =
            Math.abs(other.x - t.x) * scaleToM * 1.3 + Math.abs(other.y - t.y) * scaleToM;
          return { ...d, distScore };
        })
        .filter(Boolean) as { wM: number; hM: number; label: string; distScore: number }[];

      candidates.sort((a, b) => a.distScore - b.distScore);
      if (candidates.length > 0) {
        parsedDims = candidates[0];
      }
    }

    // Priority B: Smallest closed CAD polyline that physically encloses (t.x, t.y)
    const enclosingPoly = closedRoomPolys
      .filter((cp) => pointInPoly(t.x, t.y, cp.pts))
      .sort((a, b) => a.areaM2 - b.areaM2)[0];

    // Priority C: Wall & Parapet Boundary Enclosure (dense radial ray-sweep against wall segments)
    const wallEnclosure = traceWallBoundaryEnclosure(t.x, t.y, rawData, scaleToM, box, roleOverrides);
    const wallBox = wallEnclosure || raycastRoomEnclosure(t.x, t.y, rawData, scaleToM, box);

    let areaM2 = 0;
    let perimeterM = 0;
    let widthM: number | undefined;
    let lengthM: number | undefined;
    let derivationMethod: RoomDefinition['derivationMethod'] = 'manual';
    let dimensionText: string | undefined;
    let boundaryPolygon: [number, number][] | undefined =
      wallEnclosure?.boundaryPolygon || (enclosingPoly ? (enclosingPoly.pts as [number, number][]) : undefined);
    let parapetLengthM: number | undefined = wallEnclosure?.parapetLengthM;
    let isParapetEnclosed: boolean | undefined = wallEnclosure?.isParapetEnclosed;
    let roomBbox: WorldBBox | undefined = wallEnclosure?.bbox || enclosingPoly?.bbox || wallBox?.bbox;
    let isVerified = false;

    if (parsedDims) {
      widthM = Math.round(parsedDims.wM * 100) / 100;
      lengthM = Math.round(parsedDims.hM * 100) / 100;
      areaM2 = Math.round(parsedDims.wM * parsedDims.hM * 100) / 100;
      perimeterM = Math.round(2 * (parsedDims.wM + parsedDims.hM) * 100) / 100;
      derivationMethod = 'cad_dims';
      dimensionText = `${parsedDims.label} (${widthM.toFixed(2)}m × ${lengthM.toFixed(2)}m)`;
      isVerified = true;
      if (wallEnclosure && Math.abs(wallEnclosure.areaM2 - areaM2) / areaM2 < 0.18) {
        areaM2 = wallEnclosure.areaM2;
        perimeterM = wallEnclosure.perimeterM;
        boundaryPolygon = wallEnclosure.boundaryPolygon;
      }
      if (!roomBbox) {
        const hw = parsedDims.wM / (2 * scaleToM);
        const hh = parsedDims.hM / (2 * scaleToM);
        roomBbox = { min_x: t.x - hw, min_y: t.y - hh, max_x: t.x + hw, max_y: t.y + hh };
      }
    } else if (enclosingPoly) {
      areaM2 = Math.round(enclosingPoly.areaM2 * 100) / 100;
      perimeterM = Math.round(enclosingPoly.perimM * 100) / 100;
      widthM =
        Math.round(Math.abs(enclosingPoly.bbox.max_x - enclosingPoly.bbox.min_x) * scaleToM * 100) /
        100;
      lengthM =
        Math.round(Math.abs(enclosingPoly.bbox.max_y - enclosingPoly.bbox.min_y) * scaleToM * 100) /
        100;
      derivationMethod = 'cad_polygon';
      boundaryPolygon = enclosingPoly.pts as [number, number][];
      dimensionText = `CAD Polygon (${widthM.toFixed(2)}m × ${lengthM.toFixed(2)}m)`;
      isVerified = true;
    } else if (wallEnclosure) {
      widthM = wallEnclosure.widthM;
      lengthM = wallEnclosure.lengthM;
      areaM2 = wallEnclosure.areaM2;
      perimeterM = wallEnclosure.perimeterM;
      derivationMethod = 'wall_enclosure';
      boundaryPolygon = wallEnclosure.boundaryPolygon;
      parapetLengthM = wallEnclosure.parapetLengthM;
      isParapetEnclosed = wallEnclosure.isParapetEnclosed;
      dimensionText = wallEnclosure.isParapetEnclosed
        ? `Parapet Balcony (${areaM2} m² · ${parapetLengthM}m parapet)`
        : `Wall Enclosure (${widthM.toFixed(2)}m × ${lengthM.toFixed(2)}m)`;
      isVerified = true;
    } else if (wallBox && 'wM' in wallBox) {
      widthM = wallBox.wM;
      lengthM = wallBox.hM;
      areaM2 = Math.round(wallBox.wM * wallBox.hM * 100) / 100;
      perimeterM = Math.round(2 * (wallBox.wM + wallBox.hM) * 100) / 100;
      derivationMethod = 'wall_enclosure';
      dimensionText = `Wall Enclosure (${widthM.toFixed(2)}m × ${lengthM.toFixed(2)}m)`;
      isVerified = true;
    } else {
      const low = cleanedText.toLowerCase();
      if (/toilet|bath|wc|powder|store|pooja|puja|utility/.test(low)) {
        widthM = 1.8;
        lengthM = 2.4;
      } else if (/kitchen|balcony|foyer|study|passage|corridor/.test(low)) {
        widthM = 2.8;
        lengthM = 3.4;
      } else if (/living|dining|hall|lounge|conference/.test(low)) {
        widthM = 4.2;
        lengthM = 5.2;
      } else {
        widthM = 3.6;
        lengthM = 4.0;
      }
      areaM2 = Math.round(widthM * lengthM * 100) / 100;
      perimeterM = Math.round(2 * (widthM + lengthM) * 100) / 100;
      derivationMethod = 'manual';
      dimensionText = 'Needs CAD verification';
      isVerified = false;
      const hw = widthM / (2 * scaleToM);
      const hh = lengthM / (2 * scaleToM);
      roomBbox = { min_x: t.x - hw, min_y: t.y - hh, max_x: t.x + hw, max_y: t.y + hh };
    }

    const firstLine = cleanedText.split('\n')[0] || cleanedText;
    const cleanName =
      firstLine
        .replace(/(\d+\s*['’"”xX×*].*)/, '')
        .replace(/[_-]+/g, ' ')
        .trim() || firstLine;
    const finish = /master\s*bed|lounge/i.test(cleanName)
      ? 'wooden'
      : /lobby|foyer|stair|parking|porch/i.test(cleanName)
      ? 'granite'
      : isParapetEnclosed || /balcony|terrace|verandah|sit\s*out/i.test(cleanName)
      ? 'concrete'
      : 'vitrified_tile';

    seenRoomCoords.push([t.x, t.y]);
    rooms.push({
      id: `rm_${rooms.length + 1}_${Date.now().toString(36)}`,
      name: cleanName.length >= 2 ? cleanName : firstLine,
      areaM2,
      perimeterM,
      widthM,
      lengthM,
      floorFinish: finish,
      included: true,
      derivationMethod,
      dimensionText,
      sourceLayer: t.layer || '0',
      isVerified,
      bbox: roomBbox,
      boundaryPolygon,
      parapetLengthM,
      isParapetEnclosed,
    });
  }

  // If drawing has closed room polylines on room/area layers but no room text tags
  if (rooms.length === 0 && closedRoomPolys.length > 0) {
    closedRoomPolys.slice(0, 16).forEach((cp, idx) => {
      const wM = Math.round(Math.abs(cp.bbox.max_x - cp.bbox.min_x) * scaleToM * 100) / 100;
      const hM = Math.round(Math.abs(cp.bbox.max_y - cp.bbox.min_y) * scaleToM * 100) / 100;
      rooms.push({
        id: `rm_poly_${idx + 1}`,
        name: `Enclosed Space ${idx + 1}`,
        areaM2: Math.round(cp.areaM2 * 100) / 100,
        perimeterM: Math.round(cp.perimM * 100) / 100,
        widthM: wM,
        lengthM: hM,
        floorFinish: 'vitrified_tile',
        included: true,
        derivationMethod: 'cad_polygon',
        dimensionText: `CAD Polygon (${wM}m × ${hM}m)`,
        sourceLayer: cp.layer,
        isVerified: true,
        bbox: cp.bbox,
        boundaryPolygon: cp.pts as [number, number][],
      });
    });
  }

  // 3) Scan Door / Window / Ventilator Schedule & Tags (MD, D1..D12, W1..W12, V1..V6, FD1, SD1)
  const scheduleSizeByMark = new Map<string, [number, number]>();
  const schedLineRe = /\b(MD\d*|FD\d*|SD\d*|D\d{1,2}|W\d{1,2}|KW\d*|V\d{1,2})\b[\s:=\-–]*(.+)/i;
  for (const t of texts) {
    const cleaned = stripDxfMtext(String(t.text || ''));
    for (const line of cleaned.split('\n')) {
      const m = line.match(schedLineRe);
      if (m) {
        const mark = m[1].toUpperCase();
        const dims = parseDimTokenToMeters(m[2]);
        if (dims && dims[0] >= 0.4 && dims[0] <= 4.5 && dims[1] >= 0.4 && dims[1] <= 3.5) {
          scheduleSizeByMark.set(mark, dims);
        }
      }
    }
  }

  const openingCounts = new Map<
    string,
    { type: 'door' | 'window' | 'ventilator'; count: number; w: number; h: number; layer: string }
  >();
  const tagRe = /^(MD\d*|FD\d*|SD\d*|D\d{1,2}|W\d{1,2}|KW\d*|V\d{1,2}|D|W|V)(?:\b|[\s(:-])/i;

  for (const t of texts) {
    const line0 = stripDxfMtext(String(t.text || '')).split('\n')[0].trim();
    const tagMatch = line0.match(tagRe);
    if (!tagMatch) continue;
    const token = tagMatch[1].toUpperCase();
    let type: 'door' | 'window' | 'ventilator' = 'door';
    let w = 0.9;
    let h = 2.1;
    if (token.startsWith('W') || token.startsWith('KW')) {
      type = 'window';
      w = token === 'W1' ? 1.5 : token === 'W2' ? 1.2 : 1.0;
      h = 1.2;
    } else if (token.startsWith('V')) {
      type = 'ventilator';
      w = 0.6;
      h = 0.6;
    } else if (token.startsWith('MD') || token.startsWith('SD')) {
      w = token.startsWith('SD') ? 1.8 : 1.05;
      h = 2.1;
    } else if (token === 'D2' || token === 'D3') {
      w = 0.75;
      h = 2.1;
    }
    const schedDims = scheduleSizeByMark.get(token);
    if (schedDims) {
      w = Math.round(schedDims[0] * 100) / 100;
      h = Math.round(schedDims[1] * 100) / 100;
    }
    const existing = openingCounts.get(token);
    if (existing) existing.count++;
    else openingCounts.set(token, { type, count: 1, w, h, layer: t.layer || '0' });
  }

  if (openingCounts.size === 0) {
    for (const ac of rawData?.arcs_circles || []) {
      if (ac.type !== 'ARC' || !ac.center || !inBox(ac.center[0], ac.center[1], box)) continue;
      const rM = (ac.radius || 0) * scaleToM;
      const role = roleByLayer.get(ac.layer || '0');
      if (rM >= 0.65 && rM <= 1.35 && (role === 'door' || role === 'wall' || role === 'general')) {
        const roundedW = rM >= 1.0 ? 1.05 : rM >= 0.85 ? 0.9 : 0.75;
        const mark = roundedW >= 1.0 ? 'MD' : roundedW >= 0.85 ? 'D1' : 'D2';
        const cur = openingCounts.get(mark);
        if (cur) cur.count++;
        else
          openingCounts.set(mark, {
            type: 'door',
            count: 1,
            w: roundedW,
            h: 2.1,
            layer: ac.layer || 'ARC-SWING',
          });
      }
    }
  }

  const openings: OpeningDefinition[] = Array.from(openingCounts.entries()).map(
    ([mark, info], idx) => ({
      id: `op_${idx + 1}_${mark}`,
      mark,
      type: info.type,
      widthM: info.w,
      heightM: info.h,
      count: info.count,
      included: true,
      description:
        info.type === 'door'
          ? `CAD Door (${info.w.toFixed(2)}m × ${info.h.toFixed(2)}m)`
          : info.type === 'window'
          ? `CAD Window (${info.w.toFixed(2)}m × ${info.h.toFixed(2)}m)`
          : `CAD Ventilator (${info.w.toFixed(2)}m × ${info.h.toFixed(2)}m)`,
      sourceLayer: info.layer,
    })
  );

  // Derive fallback wall lengths from detected rooms/bbox if wall layers weren't named
  if (extWallLengthM === 0 && intWallLengthM === 0) {
    const b = box || rawData?.bbox_raw;
    if (b) {
      const bwM = Math.abs(b.max_x - b.min_x) * scaleToM;
      const bhM = Math.abs(b.max_y - b.min_y) * scaleToM;
      if (bwM > 2 && bhM > 2 && bwM < 200 && bhM < 200) {
        extWallLengthM = Math.round(2 * (bwM + bhM) * 0.75 * 10) / 10;
      }
    }
    const roomsPerim = rooms.reduce((a, r) => a + r.perimeterM, 0);
    if (roomsPerim > 0) {
      intWallLengthM = Math.round(Math.max(8, (roomsPerim - extWallLengthM) * 0.5) * 10) / 10;
    }
  }

  if (parapetWallLengthM === 0) {
    const roomParapetSum = Math.round(
      rooms.reduce((a, r) => a + (r.parapetLengthM || 0), 0) * 10
    ) / 10;
    if (roomParapetSum > 0) parapetWallLengthM = roomParapetSum;
  }

  const paramPatch: Partial<ArchitecturalParameters> = {};
  if (extWallLengthM > 0) paramPatch.extWallLengthM = extWallLengthM;
  if (intWallLengthM > 0) paramPatch.intWallLengthM = intWallLengthM;
  if (parapetWallLengthM > 0) paramPatch.parapetWallLengthM = parapetWallLengthM;

  return {
    rooms,
    openings,
    paramPatch,
    summaryNote: `Inferred ${rooms.length} room(s), ${openings.reduce((a, o) => a + o.count, 0)} opening(s), Ext Wall ${extWallLengthM}m, Int Wall ${intWallLengthM}m${parapetWallLengthM > 0 ? `, Parapet ${parapetWallLengthM}m` : ''}`,
  };
}

// ============================================================================
// 2. ELECTRICAL LAYER & SYMBOL INFERENCE
// ============================================================================
export interface ElectricalInferenceResult {
  points: (ElectricalPointItem & { sourceLayer?: string })[];
  measuredConduitM: number;
  paramPatch: Partial<ElectricalParameters>;
  summaryNote: string;
}

export function inferElectricalFromCad(
  rawData: any,
  box?: WorldBBox | null,
  roleOverrides: Record<string, string> = {}
): ElectricalInferenceResult {
  const scaleToM = Number(rawData?.scale_to_m) || 1.0;
  const layerStats = analyzeCadLayers(rawData, 'electrical', box, roleOverrides);

  let measuredConduitM = 0;
  const bucket = new Map<
    ElectricalPointType,
    { name: string; count: number; dropHeightM: number; layers: Set<string> }
  >();

  const addPoint = (type: ElectricalPointType, name: string, count: number, dropH: number, layer: string) => {
    if (count <= 0) return;
    const cur = bucket.get(type);
    if (cur) {
      cur.count += count;
      cur.layers.add(layer);
    } else {
      bucket.set(type, { name, count, dropHeightM: dropH, layers: new Set([layer]) });
    }
  };

  for (const st of layerStats) {
    if (st.inferredRole === 'conduit') {
      measuredConduitM += st.lineLengthM;
    } else if (st.inferredRole === 'light' && st.circleArcCount > 0) {
      addPoint('light', `LED Light Fixtures (${st.name})`, st.circleArcCount, 0.4, st.name);
    } else if (st.inferredRole === 'fan' && st.circleArcCount > 0) {
      addPoint('fan', `Ceiling / Exhaust Fans (${st.name})`, st.circleArcCount, 0.3, st.name);
    } else if (st.inferredRole === 'socket' && st.circleArcCount > 0) {
      addPoint('socket_6a', `6A Convenience Sockets (${st.name})`, st.circleArcCount, 1.8, st.name);
    } else if (st.inferredRole === 'power' && st.circleArcCount > 0) {
      addPoint('socket_16a', `16A Heavy Power Points (${st.name})`, st.circleArcCount, 1.5, st.name);
    } else if (st.inferredRole === 'db' && st.entityCount > 0) {
      addPoint('distribution_board', `Distribution Boards (${st.name})`, Math.max(1, Math.min(8, st.textCount || 1)), 1.2, st.name);
    }
  }

  // Also scan CAD text callouts (SB1..SB30, DB, SDB, MDB, AC, 16A, 6A, CF, EXH, LED, DL)
  const texts = (rawData?.texts || []).filter((t: any) => t.text && inBox(t.x, t.y, box));
  for (const t of texts) {
    const s = String(t.text || '').trim().toUpperCase();
    const lyr = t.layer || '0';
    if (/^(MDB|SDB|DB[-_\s]?\d*|LDB|PDB)$/.test(s)) {
      addPoint('distribution_board', 'MCB Distribution Boards (DB)', 1, 1.2, lyr);
    } else if (/^SB[-_\s]?\d+$/.test(s)) {
      addPoint('switchboard', 'Modular Switchboards (SB)', 1, 1.5, lyr);
    } else if (/^(AC[-_\s]?\d*|SPLIT\s*AC|CASSETTE\s*AC)$/.test(s)) {
      addPoint('ac_point', 'AC Power Units (20A SPN)', 1, 0.6, lyr);
    } else if (/^(16A|20A|GEYSER|MW|OVEN|HOB|WM)$/.test(s)) {
      addPoint('socket_16a', '16A Power Sockets', 1, 1.5, lyr);
    } else if (/^(6A|5A|TV|DATA|RJ45)$/.test(s)) {
      addPoint('socket_6a', '6A Convenience Sockets', 1, 1.8, lyr);
    } else if (/^(CF|FAN|EXH|EF)$/.test(s)) {
      addPoint('fan', 'Ceiling & Exhaust Fan Points', 1, 0.3, lyr);
    } else if (/^(DL\d*|LED|TUBE|BATTEN|CHANDELIER|WL\d*|PL\d*)$/.test(s)) {
      addPoint('light', 'Lighting Points (Callout Tags)', 1, 0.4, lyr);
    }
  }

  // If drawing is architectural (room tags present, no explicit electrical symbols yet), infer baseline per room!
  if (bucket.size === 0) {
    const archRes = inferArchitecturalFromCad(rawData, box);
    if (archRes.rooms.length > 0) {
      let lights = 0;
      let fans = 0;
      let s6 = 0;
      let s16 = 0;
      let ac = 0;
      for (const r of archRes.rooms) {
        const low = r.name.toLowerCase();
        lights += Math.max(2, Math.ceil(r.areaM2 / 6));
        if (!/toilet|bath|wc|store|pooja/.test(low)) fans += Math.max(1, Math.floor(r.areaM2 / 14) || 1);
        s6 += /living|bed|office|kitchen/.test(low) ? 3 : 1;
        if (/kitchen|toilet|bath|utility/.test(low)) s16 += 2;
        if (/bed|living|office|cabin/.test(low)) ac += 1;
      }
      addPoint('light', 'Inferred Room Lighting Points', lights, 0.4, archRes.rooms[0]?.sourceLayer || '0');
      addPoint('fan', 'Inferred Ceiling / Exhaust Fans', fans, 0.3, archRes.rooms[0]?.sourceLayer || '0');
      addPoint('socket_6a', 'Inferred 6A Convenience Sockets', s6, 1.8, archRes.rooms[0]?.sourceLayer || '0');
      addPoint('socket_16a', 'Inferred 16A Kitchen / Geyser Sockets', Math.max(1, s16), 1.5, archRes.rooms[0]?.sourceLayer || '0');
      if (ac > 0) addPoint('ac_point', 'Inferred AC Power Points', ac, 0.6, archRes.rooms[0]?.sourceLayer || '0');
      addPoint('switchboard', 'Inferred Room Switchboards', archRes.rooms.length, 1.5, archRes.rooms[0]?.sourceLayer || '0');
      addPoint('distribution_board', 'Main Distribution Board (MCB DB)', 1, 1.2, archRes.rooms[0]?.sourceLayer || '0');
    }
  }

  const points: (ElectricalPointItem & { sourceLayer?: string })[] = Array.from(bucket.entries()).map(
    ([type, info], idx) => ({
      id: `ep_${idx + 1}_${type}`,
      name: info.name,
      type,
      count: info.count,
      dropHeightM: info.dropHeightM,
      sourceLayer: Array.from(info.layers)[0],
    })
  );

  const totalPts = points.reduce((a, p) => a + p.count, 0);
  const paramPatch: Partial<ElectricalParameters> = {};
  if (measuredConduitM > 5 && totalPts > 0) {
    paramPatch.averageRunBetweenPointsM = Math.round((measuredConduitM / totalPts) * 100) / 100;
  } else if (rawData?.bbox_raw) {
    const b = box || rawData.bbox_raw;
    const spanM = Math.hypot((b.max_x - b.min_x) * scaleToM, (b.max_y - b.min_y) * scaleToM);
    if (spanM > 3 && spanM < 150) {
      paramPatch.averageRunBetweenPointsM = Math.round(Math.max(2.5, Math.min(7.5, spanM * 0.14)) * 10) / 10;
    }
  }

  return {
    points,
    measuredConduitM: Math.round(measuredConduitM * 10) / 10,
    paramPatch,
    summaryNote: `Detected ${totalPts} electrical point(s)${
      measuredConduitM > 0 ? ` & ${measuredConduitM.toFixed(1)}m conduit runs` : ''
    }`,
  };
}

// ============================================================================
// 3. PLUMBING & SANITARY LAYER INFERENCE
// ============================================================================
export interface PlumbingInferenceResult {
  fixtures: (PlumbingFixtureItem & { sourceLayer?: string })[];
  paramPatch: Partial<PlumbingParameters>;
  summaryNote: string;
}

export function inferPlumbingFromCad(
  rawData: any,
  box?: WorldBBox | null,
  roleOverrides: Record<string, string> = {}
): PlumbingInferenceResult {
  const layerStats = analyzeCadLayers(rawData, 'plumbing', box, roleOverrides);

  let cpvc15 = 0;
  let cpvc20 = 0;
  let cpvc25 = 0;
  let pvc75 = 0;
  let pvc110 = 0;

  for (const st of layerStats) {
    if (st.inferredRole === 'supply_15') cpvc15 += st.lineLengthM;
    else if (st.inferredRole === 'supply_20') cpvc20 += st.lineLengthM;
    else if (st.inferredRole === 'supply_25') cpvc25 += st.lineLengthM;
    else if (st.inferredRole === 'drain_75') pvc75 += st.lineLengthM;
    else if (st.inferredRole === 'drain_110') pvc110 += st.lineLengthM;
  }

  const fixMap = new Map<PlumbingFixtureType, { name: string; count: number; layer: string }>();
  const bumpFix = (type: PlumbingFixtureType, name: string, n: number, layer: string) => {
    const cur = fixMap.get(type);
    if (cur) cur.count += n;
    else fixMap.set(type, { name, count: n, layer });
  };

  const texts = (rawData?.texts || []).filter((t: any) => t.text && inBox(t.x, t.y, box));
  for (const t of texts) {
    const s = String(t.text || '').trim().toUpperCase();
    const lyr = t.layer || '0';
    if (/^(WC|EWC|IWC|WATER\s*CLOSET)$/.test(s)) bumpFix('wc', 'Water Closets (EWC)', 1, lyr);
    else if (/^(WB|WASH\s*BASIN|BASIN|WHB)$/.test(s)) bumpFix('basin', 'Wash Basins', 1, lyr);
    else if (/^(KS|SINK|KITCHEN\s*SINK)$/.test(s)) bumpFix('sink', 'Kitchen / Utility Sinks', 1, lyr);
    else if (/^(SH|SHOWER)$/.test(s)) bumpFix('shower', 'Shower Mixer Units', 1, lyr);
    else if (/^(UR|URINAL)$/.test(s)) bumpFix('urinal', 'Wall-Hung Urinals', 1, lyr);
    else if (/^(FT|FD|NT|NAHANI|FLOOR\s*TRAP|GULLY|GT)$/.test(s)) bumpFix('floor_trap', 'Nahani / Floor Traps', 1, lyr);
  }

  // Fallback: infer sanitary fixtures from detected Toilets / Baths / Kitchens on architectural layers
  if (fixMap.size === 0) {
    const archRes = inferArchitecturalFromCad(rawData, box);
    let toilets = 0;
    let kitchens = 0;
    let layerHint = '0';
    for (const r of archRes.rooms) {
      const low = r.name.toLowerCase();
      if (/toilet|bath|wc|powder/.test(low)) {
        toilets++;
        layerHint = r.sourceLayer || layerHint;
      } else if (/kitchen|utility|wash|pantry/.test(low)) {
        kitchens++;
        layerHint = r.sourceLayer || layerHint;
      }
    }
    if (toilets > 0 || kitchens > 0) {
      if (toilets > 0) {
        bumpFix('wc', 'Inferred Water Closets (from Toilet Rooms)', toilets, layerHint);
        bumpFix('basin', 'Inferred Wash Basins', toilets, layerHint);
        bumpFix('shower', 'Inferred Shower Units', toilets, layerHint);
      }
      if (kitchens > 0) {
        bumpFix('sink', 'Inferred Kitchen / Utility Sinks', kitchens, layerHint);
      }
      bumpFix('floor_trap', 'Inferred Floor / Nahani Traps', toilets * 2 + kitchens, layerHint);
    }
  }

  const fixtures: (PlumbingFixtureItem & { sourceLayer?: string })[] = Array.from(fixMap.entries()).map(
    ([type, info], idx) => ({
      id: `pf_${idx + 1}_${type}`,
      name: info.name,
      type,
      count: info.count,
      sourceLayer: info.layer,
    })
  );

  const wcCount = fixMap.get('wc')?.count || 0;
  const totalFix = fixtures.reduce((a, f) => a + f.count, 0);

  // If pipe layers weren't drawn explicitly, estimate run lengths proportional to fixture count
  if (cpvc15 + cpvc20 + cpvc25 === 0 && totalFix > 0) {
    cpvc15 = Math.round(totalFix * 4.5);
    cpvc20 = Math.round(totalFix * 3.0);
    cpvc25 = Math.round(Math.max(12, totalFix * 2.2));
  }
  if (pvc75 + pvc110 === 0 && totalFix > 0) {
    pvc75 = Math.round(totalFix * 3.5);
    pvc110 = Math.round(Math.max(15, wcCount * 9 + 10));
  }

  const paramPatch: Partial<PlumbingParameters> = {
    supplyCpvc15M: Math.round(cpvc15 * 10) / 10,
    supplyCpvc20M: Math.round(cpvc20 * 10) / 10,
    supplyCpvc25M: Math.round(cpvc25 * 10) / 10,
    drainPvc75M: Math.round(pvc75 * 10) / 10,
    drainPvc110M: Math.round(pvc110 * 10) / 10,
  };
  if (wcCount > 0) {
    paramPatch.numOccupants = Math.max(4, wcCount * 3);
  }

  return {
    fixtures,
    paramPatch,
    summaryNote: `Detected ${totalFix} sanitary fixture(s), Supply ${(cpvc15 + cpvc20 + cpvc25).toFixed(1)}m, Drain ${(pvc75 + pvc110).toFixed(1)}m`,
  };
}

// ============================================================================
// 4. FIRE PROTECTION LAYER & COVERAGE INFERENCE
// ============================================================================
export interface FireInferenceResult {
  items: (FireProtectionItem & { sourceLayer?: string })[];
  paramPatch: Partial<FireProtectionParameters>;
  summaryNote: string;
}

export function inferFireFromCad(
  rawData: any,
  box?: WorldBBox | null,
  roleOverrides: Record<string, string> = {}
): FireInferenceResult {
  const scaleToM = Number(rawData?.scale_to_m) || 1.0;
  const layerStats = analyzeCadLayers(rawData, 'fire', box, roleOverrides);

  let riserM = 0;
  let branchM = 0;
  const itemMap = new Map<FireItemType, { name: string; count: number; specs: string; layer: string }>();

  const bump = (type: FireItemType, name: string, n: number, specs: string, layer: string) => {
    if (n <= 0) return;
    const cur = itemMap.get(type);
    if (cur) cur.count += n;
    else itemMap.set(type, { name, count: n, specs, layer });
  };

  for (const st of layerStats) {
    if (st.inferredRole === 'riser_pipe') riserM += st.lineLengthM;
    else if (st.inferredRole === 'branch_pipe') branchM += st.lineLengthM;
    else if (st.inferredRole === 'sprinkler' && st.circleArcCount > 0) {
      bump('sprinkler', `Pendant Sprinklers (${st.name})`, st.circleArcCount, '68°C Glass Bulb K-80', st.name);
    } else if (st.inferredRole === 'hose_reel' && st.entityCount > 0) {
      bump('hose_reel', `First-Aid Fire Hose Reels (${st.name})`, Math.max(1, st.circleArcCount || st.textCount || 1), '30m × 20mm IS 884', st.name);
    } else if (st.inferredRole === 'landing_valve' && st.entityCount > 0) {
      bump('landing_valve', `Single Hydrant Landing Valves (${st.name})`, Math.max(1, st.circleArcCount || st.textCount || 1), '63mm Gunmetal IS 5290', st.name);
    } else if (st.inferredRole === 'extinguisher' && st.entityCount > 0) {
      bump('extinguisher', `Fire Extinguishers (${st.name})`, Math.max(1, st.circleArcCount || st.textCount || 1), 'ABC 4kg / CO2 4.5kg', st.name);
    }
  }

  // Scan CAD text tags (SPR, FHC, FHR, HYD, LV, FE, ABC, CO2)
  const texts = (rawData?.texts || []).filter((t: any) => t.text && inBox(t.x, t.y, box));
  for (const t of texts) {
    const s = String(t.text || '').trim().toUpperCase();
    const lyr = t.layer || '0';
    if (/^(SPR\d*|SPRINKLER)$/.test(s)) bump('sprinkler', 'Pendant Sprinklers (68°C)', 1, 'K-80 Quartzoid Bulb', lyr);
    else if (/^(FHR\d*|FHC\d*|HOSE\s*REEL)$/.test(s)) bump('hose_reel', 'Fire Hose Reel Drums', 1, '30m Rubber Hose', lyr);
    else if (/^(HYD\d*|LV\d*|LANDING\s*VALVE)$/.test(s)) bump('landing_valve', 'Hydrant Landing Valves (63mm)', 1, 'IS 5290 Type A', lyr);
    else if (/^(FE\d*|ABC|CO2|EXTINGUISHER)$/.test(s)) bump('extinguisher', 'Portable Fire Extinguishers', 1, 'IS 15683 Marked', lyr);
  }

  // Estimate floor footprint area from cropped box or CAD drawing bounds
  let floorAreaM2 = 0;
  const b = box || rawData?.bbox_raw;
  if (b) {
    const bw = Math.abs(b.max_x - b.min_x) * scaleToM;
    const bh = Math.abs(b.max_y - b.min_y) * scaleToM;
    if (bw > 3 && bh > 3 && bw < 250 && bh < 250) {
      floorAreaM2 = Math.round(bw * bh * 0.68);
    }
  }
  if (floorAreaM2 <= 0) floorAreaM2 = 420;

  // If drawing is architectural with no explicit fire layer symbols yet, size per NBC Part 4 / IS 15105!
  if (itemMap.size === 0) {
    const reqSpr = Math.max(4, Math.ceil(floorAreaM2 / 12));
    const cores = Math.max(1, Math.ceil(floorAreaM2 / 500));
    bump('sprinkler', 'Inferred Sprinklers (NBC 12m² Grid)', reqSpr, '68°C Glass Bulb K-80', '0');
    bump('extinguisher', 'ABC + CO2 Extinguisher Pairs', cores * 2 + 2, '4kg ABC + 4.5kg CO2', '0');
    bump('hose_reel', 'Staircase Fire Hose Reels', cores, '30m × 20mm IS 884', '0');
    bump('landing_valve', 'Wet Riser Landing Valves', cores, '63mm Gunmetal IS 5290', '0');
  }

  const sprCount = itemMap.get('sprinkler')?.count || Math.ceil(floorAreaM2 / 12);
  if (riserM === 0) riserM = Math.max(18, Math.round(Math.sqrt(floorAreaM2) * 1.4));
  if (branchM === 0) branchM = Math.round(sprCount * 3.4);

  const items: (FireProtectionItem & { sourceLayer?: string })[] = Array.from(itemMap.entries()).map(
    ([type, info], idx) => ({
      id: `fp_${idx + 1}_${type}`,
      name: info.name,
      type,
      count: info.count,
      specs: info.specs,
      sourceLayer: info.layer,
    })
  );

  return {
    items,
    paramPatch: {
      totalFloorAreaM2: floorAreaM2,
      riserPipeLengthM: Math.round(riserM * 10) / 10,
      branchPipeLengthM: Math.round(branchM * 10) / 10,
    },
    summaryNote: `Floor footprint ~${floorAreaM2}m² · ${items.reduce((a, i) => a + i.count, 0)} fire apparatus · ${(riserM + branchM).toFixed(1)}m MS piping`,
  };
}

