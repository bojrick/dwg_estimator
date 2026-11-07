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

function parseDimTokenToMeters(str: string): [number, number] | null {
  // Matches meters "4.2 x 3.6", mm "4200 x 3600", or feet-inches "12'6\" x 10'0\""
  const ftMatch = str.match(/(\d{1,2})\s*['’]\s*(\d{1,2})?\s*(?:["”])?\s*[xX×*]\s*(\d{1,2})\s*['’]\s*(\d{1,2})?/);
  if (ftMatch) {
    const f1 = parseInt(ftMatch[1], 10) + (ftMatch[2] ? parseInt(ftMatch[2], 10) / 12 : 0);
    const f2 = parseInt(ftMatch[3], 10) + (ftMatch[4] ? parseInt(ftMatch[4], 10) / 12 : 0);
    const w = f1 * 0.3048;
    const h = f2 * 0.3048;
    if (w >= 0.4 && h >= 0.4 && w <= 40 && h <= 40) return [w, h];
  }

  const numMatch = str.match(/(\d+(?:\.\d+)?)\s*[xX×*]\s*(\d+(?:\.\d+)?)/);
  if (numMatch) {
    let a = parseFloat(numMatch[1]);
    let b = parseFloat(numMatch[2]);
    if (a >= 350 && b >= 350) {
      a /= 1000;
      b /= 1000;
    } else if (a > 25 && b > 25 && a < 350 && b < 350) {
      // Likely feet without apostrophe or cm; treat >45 as cm
      if (a >= 60 && b >= 60) {
        a /= 100;
        b /= 100;
      } else {
        a *= 0.3048;
        b *= 0.3048;
      }
    }
    if (a >= 0.4 && b >= 0.4 && a <= 50 && b <= 50) return [a, b];
  }
  return null;
}

// ============================================================================
// 1. ARCHITECTURAL LAYER & GEOMETRY INFERENCE
// ============================================================================
export interface ArchInferenceResult {
  rooms: (RoomDefinition & { sourceLayer?: string })[];
  openings: (OpeningDefinition & { sourceLayer?: string })[];
  paramPatch: Partial<ArchitecturalParameters>;
  summaryNote: string;
}

const ROOM_NAME_RE =
  /\b(living|dining|drawing|hall|lounge|foyer|lobby|verandah|bedroom|master\s*bed|guest\s*bed|kids\s*bed|bed\s*room|kitchen|utility|wash|store|pantry|pooja|puja|study|office|cabin|conference|reception|toilet|bath|wc|powder|dress|balcony|sit\s*out|deck|terrace|corridor|passage|stair|lift)\b/i;

export function inferArchitecturalFromCad(
  rawData: any,
  box?: WorldBBox | null,
  roleOverrides: Record<string, string> = {}
): ArchInferenceResult {
  const scaleToM = Number(rawData?.scale_to_m) || 1.0;
  const layerStats = analyzeCadLayers(rawData, 'architectural', box, roleOverrides);
  const roleByLayer = new Map(layerStats.map((l) => [l.name, l.inferredRole]));

  // 1) Infer external vs internal wall lengths (accounting for double-line CAD walls: divide by 2)
  let extLineM = 0;
  let intLineM = 0;
  let genericWallLineM = 0;
  for (const st of layerStats) {
    if (st.inferredRole === 'ext_wall') extLineM += st.lineLengthM;
    else if (st.inferredRole === 'int_wall') intLineM += st.lineLengthM;
    else if (st.inferredRole === 'wall') genericWallLineM += st.lineLengthM;
  }

  let extWallLengthM = Math.round((extLineM / 2) * 10) / 10;
  let intWallLengthM = Math.round((intLineM / 2) * 10) / 10;
  if (genericWallLineM > 0) {
    // Double-line CAD wall centerline = total edge length / 2, split ~45% external / 55% internal
    const centerLen = genericWallLineM / 2;
    extWallLengthM = Math.round((extWallLengthM + centerLen * 0.45) * 10) / 10;
    intWallLengthM = Math.round((intWallLengthM + centerLen * 0.55) * 10) / 10;
  }

  // 2) Scan rooms from CAD texts + nearby dimension labels or closed polylines
  const texts = (rawData?.texts || []).filter((t: any) => t.text && inBox(t.x, t.y, box));
  const closedRoomPolys: { pts: number[][]; areaM2: number; perimM: number; layer: string; cx: number; cy: number }[] = [];
  for (const pl of rawData?.polylines || []) {
    if (!pl.points || pl.points.length < 4) continue;
    if (!pl.points.some((p: number[]) => inBox(p[0], p[1], box))) continue;
    const areaM2 = polyAreaWorld(pl.points) * scaleToM * scaleToM;
    if (areaM2 < 1.8 || areaM2 > 450) continue;
    const perimM = polyLengthWorld(pl.points, true) * scaleToM;
    const cx = pl.points.reduce((a: number, p: number[]) => a + p[0], 0) / pl.points.length;
    const cy = pl.points.reduce((a: number, p: number[]) => a + p[1], 0) / pl.points.length;
    closedRoomPolys.push({ pts: pl.points, areaM2, perimM, layer: pl.layer || '0', cx, cy });
  }

  const rooms: (RoomDefinition & { sourceLayer?: string })[] = [];
  const seenRoomCoords: [number, number][] = [];

  for (const t of texts) {
    const rawStr = String(t.text || '').trim();
    if (rawStr.length < 2 || rawStr.length > 48) continue;
    if (!ROOM_NAME_RE.test(rawStr)) continue;
    // Deduplicate overlapping multi-line labels at almost identical coordinates
    if (seenRoomCoords.some(([rx, ry]) => Math.hypot((rx - t.x) * scaleToM, (ry - t.y) * scaleToM) < 1.1)) {
      continue;
    }

    // Look for inline or nearby dimension text (within 2.5m)
    let dims = parseDimTokenToMeters(rawStr);
    if (!dims) {
      const nearby = texts.find(
        (other: any) =>
          other !== t &&
          Math.hypot((other.x - t.x) * scaleToM, (other.y - t.y) * scaleToM) < 2.6 &&
          parseDimTokenToMeters(String(other.text || '')) !== null
      );
      if (nearby) dims = parseDimTokenToMeters(String(nearby.text));
    }

    let areaM2 = 0;
    let perimeterM = 0;
    if (dims) {
      areaM2 = Math.round(dims[0] * dims[1] * 100) / 100;
      perimeterM = Math.round(2 * (dims[0] + dims[1]) * 100) / 100;
    } else {
      // Check nearest reasonable closed room polyline
      const nearPoly = closedRoomPolys
        .filter((cp) => Math.hypot((cp.cx - t.x) * scaleToM, (cp.cy - t.y) * scaleToM) < 5.0)
        .sort(
          (a, b) =>
            Math.hypot(a.cx - t.x, a.cy - t.y) - Math.hypot(b.cx - t.x, b.cy - t.y)
        )[0];
      if (nearPoly) {
        areaM2 = Math.round(nearPoly.areaM2 * 100) / 100;
        perimeterM = Math.round(nearPoly.perimM * 100) / 100;
      } else {
        // Sensible room-type geometric defaults when unclosed lines are used
        const low = rawStr.toLowerCase();
        if (/toilet|bath|wc|powder|store|pooja|puja|utility/.test(low)) {
          areaM2 = 4.2;
          perimeterM = 8.4;
        } else if (/kitchen|balcony|foyer|study|passage|corridor/.test(low)) {
          areaM2 = 9.6;
          perimeterM = 12.6;
        } else if (/living|dining|hall|lounge|conference/.test(low)) {
          areaM2 = 22.0;
          perimeterM = 19.2;
        } else {
          areaM2 = 14.4;
          perimeterM = 15.2;
        }
      }
    }

    const cleanName = rawStr
      .replace(/(\d+.*)/, '')
      .replace(/[_-]+/g, ' ')
      .trim() || rawStr;
    const finish = /master\s*bed|lounge/i.test(cleanName)
      ? 'wooden'
      : /lobby|foyer|stair/i.test(cleanName)
      ? 'granite'
      : 'vitrified_tile';

    seenRoomCoords.push([t.x, t.y]);
    rooms.push({
      id: `rm_${rooms.length + 1}_${Date.now().toString(36)}`,
      name: cleanName.length >= 2 ? cleanName : rawStr,
      areaM2,
      perimeterM,
      floorFinish: finish,
      sourceLayer: t.layer || '0',
    });
  }

  // If drawing has closed room polylines on room/area layers but no room text tags
  if (rooms.length === 0 && closedRoomPolys.length > 0) {
    closedRoomPolys.slice(0, 16).forEach((cp, idx) => {
      rooms.push({
        id: `rm_poly_${idx + 1}`,
        name: `Enclosed Space ${idx + 1}`,
        areaM2: Math.round(cp.areaM2 * 100) / 100,
        perimeterM: Math.round(cp.perimM * 100) / 100,
        floorFinish: 'vitrified_tile',
        sourceLayer: cp.layer,
      });
    });
  }

  // 3) Scan Door / Window / Ventilator tags (MD, D1..D12, W1..W12, V1..V6, FD1, SD1) + Door Swing Arcs
  const openingCounts = new Map<string, { type: 'door' | 'window' | 'ventilator'; count: number; w: number; h: number; layer: string }>();
  const tagRe = /^(MD\d*|FD\d*|SD\d*|D\d{0,2}|W\d{0,2}|KW\d*|V\d{0,2})$/i;

  for (const t of texts) {
    const token = String(t.text || '').trim().toUpperCase();
    if (!tagRe.test(token)) continue;
    let type: 'door' | 'window' | 'ventilator' = 'door';
    let w = 0.9;
    let h = 2.1;
    if (token.startsWith('W') || token.startsWith('KW')) {
      type = 'window';
      w = token === 'W1' ? 1.5 : 1.2;
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
    const existing = openingCounts.get(token);
    if (existing) existing.count++;
    else openingCounts.set(token, { type, count: 1, w, h, layer: t.layer || '0' });
  }

  // Fallback to 90-degree door swing arcs on door/wall layers if no text tags were placed
  if (openingCounts.size === 0) {
    let doorArcs = 0;
    for (const ac of rawData?.arcs_circles || []) {
      if (ac.type !== 'ARC' || !ac.center || !inBox(ac.center[0], ac.center[1], box)) continue;
      const rM = (ac.radius || 0) * scaleToM;
      const role = roleByLayer.get(ac.layer || '0');
      if (rM >= 0.65 && rM <= 1.25 && (role === 'door' || role === 'wall' || role === 'general')) {
        doorArcs++;
      }
    }
    if (doorArcs > 0) {
      openingCounts.set('D1', { type: 'door', count: doorArcs, w: 0.9, h: 2.1, layer: 'ARC-SWING' });
    }
  }

  const openings: (OpeningDefinition & { sourceLayer?: string })[] = Array.from(openingCounts.entries()).map(
    ([mark, info], idx) => ({
      id: `op_${idx + 1}_${mark}`,
      mark,
      type: info.type,
      widthM: info.w,
      heightM: info.h,
      count: info.count,
      description:
        info.type === 'door'
          ? 'Detected CAD Door Mark'
          : info.type === 'window'
          ? 'Detected CAD Window Mark'
          : 'Detected CAD Ventilator',
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

  const paramPatch: Partial<ArchitecturalParameters> = {};
  if (extWallLengthM > 0) paramPatch.extWallLengthM = extWallLengthM;
  if (intWallLengthM > 0) paramPatch.intWallLengthM = intWallLengthM;

  return {
    rooms,
    openings,
    paramPatch,
    summaryNote: `Inferred ${rooms.length} room(s), ${openings.reduce((a, o) => a + o.count, 0)} opening(s), Ext Wall ${extWallLengthM}m, Int Wall ${intWallLengthM}m`,
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

