import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiUrl, authFetch } from '../auth';
import {
  ArrowLeft,
  Ruler,
  Hand,
  Maximize2,
  ZoomIn,
  ZoomOut,
  Layers,
  Share2,
  FileCode2,
  Upload,
  Download,
  Eye,
  EyeOff,
  X,
  CheckCircle2,
  RefreshCw,
  Edit2,
  Check,
  FileSpreadsheet,
  ChevronDown,
} from 'lucide-react';
import { PlanDiscipline, DISCIPLINES } from '../types/plan';
import { AiBadge } from './ui/AiBadge';

export type ViewerTabMode = 'dwg';
type ToolMode = 'pan' | 'measure';
type MeasureSubMode = 'distance' | 'area-pick' | 'area-points';
type ColorMode = 'cad' | 'blueprint' | 'mono';

interface DetectedAreaShape {
  pts: [number, number][];
  label: string;
}

function pointInPolygon(x: number, y: number, pts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function computePolygonAreaAndPerimeter(pts: [number, number][]): {
  rawArea: number;
  rawPerim: number;
  centroid: [number, number];
} {
  const n = pts.length;
  if (n < 3) return { rawArea: 0, rawPerim: 0, centroid: pts[0] || [0, 0] };
  let area2 = 0;
  let perim = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % n];
    const cross = x1 * y2 - x2 * y1;
    area2 += cross;
    perim += Math.hypot(x2 - x1, y2 - y1);
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  const rawArea = Math.abs(area2) * 0.5;
  if (Math.abs(area2) > 1e-7) {
    cx /= 3 * area2;
    cy /= 3 * area2;
  } else {
    cx = pts.reduce((s, p) => s + p[0], 0) / n;
    cy = pts.reduce((s, p) => s + p[1], 0) / n;
  }
  return { rawArea, rawPerim: perim, centroid: [cx, cy] };
}

interface OpenCadViewerProps {
  plan: any;
  rawData: any;
  initialTab?: ViewerTabMode;
  initialMeasure?: boolean;
  onBack: () => void;
  onShare: (plan: any) => void;
  onSelectSheet: (sheetId: string) => Promise<void>;
  onChangeUnitScale: (scaleToM: number) => Promise<void>;
  onUploadDwg: (file: File) => Promise<void>;
  onSavePlan?: () => void;
  onOpenAuth?: (mode: 'signin' | 'signup') => void;
  onUpdateMetadata?: (patch: { name?: string; sheets?: any[] }) => Promise<void>;
  onOpenStructuralEstimator?: () => void;
  onOpenEstimator?: (discipline: PlanDiscipline) => void;
  isGuest?: boolean;
}

const UNIT_OPTIONS = [
  { label: 'm', scale: 1.0 },
  { label: 'mm', scale: 0.001 },
  { label: 'cm', scale: 0.01 },
  { label: 'ft', scale: 0.3048 },
  { label: 'in', scale: 0.0254 },
];

export const OpenCadViewer: React.FC<OpenCadViewerProps> = ({
  plan,
  rawData,
  initialTab = 'dwg',
  initialMeasure = false,
  onBack,
  onShare,
  onSelectSheet,
  onChangeUnitScale,
  onUploadDwg,
  onSavePlan,
  onOpenAuth,
  onUpdateMetadata,
  onOpenStructuralEstimator,
  onOpenEstimator,
  isGuest = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dwgInputRef = useRef<HTMLInputElement | null>(null);

  const [toolMode, setToolMode] = useState<ToolMode>(initialMeasure ? 'measure' : 'pan');
  const [colorMode, setColorMode] = useState<ColorMode>('cad');

  const [viewCenter, setViewCenter] = useState<[number, number]>([0, 0]);
  const [zoom, setZoom] = useState<number>(1);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({ w: 800, h: 600 });

  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [showLayersSheet, setShowLayersSheet] = useState<boolean>(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState<boolean>(false);
  const [showEstimatorMenu, setShowEstimatorMenu] = useState<boolean>(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const currentDiscipline: PlanDiscipline = (plan.discipline as PlanDiscipline) || 'structural';
  const currentDisciplineInfo = DISCIPLINES.find((d) => d.id === currentDiscipline) || DISCIPLINES[2];

  // Measurement state
  const [measureSubMode, setMeasureSubMode] = useState<MeasureSubMode>('distance');
  const [measurePts, setMeasurePts] = useState<[number, number][]>([]);
  const [selectedAreaShape, setSelectedAreaShape] = useState<DetectedAreaShape | null>(null);
  const [hoverAreaShape, setHoverAreaShape] = useState<DetectedAreaShape | null>(null);
  const [cursorWorld, setCursorWorld] = useState<[number, number] | null>(null);
  const [snapPt, setSnapPt] = useState<[number, number] | null>(null);

  // Metadata editing state
  const [editingPlanTitle, setEditingPlanTitle] = useState(false);
  const [tempPlanTitle, setTempPlanTitle] = useState(plan.name || '');
  const [editingSheetMeta, setEditingSheetMeta] = useState(false);
  const [tempSheetName, setTempSheetName] = useState('');
  const [tempSheetDesc, setTempSheetDesc] = useState('');
  const [sheetAiSuggestion, setSheetAiSuggestion] = useState<string | null>(null);
  const [sheetAiBusy, setSheetAiBusy] = useState(false);
  const [sheetPreviewUrl, setSheetPreviewUrl] = useState<string | null>(null);

  // Pointer & touch gesture tracking
  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    startCenter: [number, number];
    pinchDist: number | null;
    startZoom: number;
  }>({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    startCenter: [0, 0],
    pinchDist: null,
    startZoom: 1,
  });

  const unitScaleToM = rawData?.scale_to_m || plan?.scale_to_m || 1.0;
  const unitName = rawData?.unit_name || plan?.unit_name || 'm';

  // Resize observer for responsive mobile/desktop canvas
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 40 && rect.height > 40) {
        setCanvasSize({ w: Math.floor(rect.width), h: Math.floor(rect.height) });
      }
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitDrawing = useCallback(() => {
    const b = rawData?.bbox_raw;
    if (!b) return;
    const spanX = Math.max(1e-3, b.max_x - b.min_x);
    const spanY = Math.max(1e-3, b.max_y - b.min_y);
    const cx = (b.min_x + b.max_x) / 2;
    const cy = (b.min_y + b.max_y) / 2;
    const zx = (canvasSize.w * 0.9) / spanX;
    const zy = (canvasSize.h * 0.88) / spanY;
    setViewCenter([cx, cy]);
    setZoom(Math.max(1e-5, Math.min(zx, zy)));
  }, [rawData, canvasSize.w, canvasSize.h]);

  useEffect(() => {
    fitDrawing();
    setMeasurePts([]);
    setSelectedAreaShape(null);
    setHoverAreaShape(null);
    setHiddenLayers(new Set());
  }, [rawData?.bbox_raw?.min_x, rawData?.bbox_raw?.max_x, fitDrawing]);

  const worldToScreen = useCallback(
    (wx: number, wy: number): [number, number] => [
      (wx - viewCenter[0]) * zoom + canvasSize.w / 2,
      -(wy - viewCenter[1]) * zoom + canvasSize.h / 2,
    ],
    [viewCenter, zoom, canvasSize.w, canvasSize.h]
  );

  const screenToWorld = useCallback(
    (sx: number, sy: number): [number, number] => [
      (sx - canvasSize.w / 2) / zoom + viewCenter[0],
      -(sy - canvasSize.h / 2) / zoom + viewCenter[1],
    ],
    [viewCenter, zoom, canvasSize.w, canvasSize.h]
  );

  const isLayerVisible = useCallback(
    (layerName: string) => !hiddenLayers.has(layerName),
    [hiddenLayers]
  );

  const getEntityColor = useCallback(
    (rawHex: string): string => {
      if (colorMode === 'blueprint') return '#38bdf8';
      if (colorMode === 'mono') return '#e2e8f0';
      return rawHex || '#f1f5f9';
    },
    [colorMode]
  );

  const formatMeasurement = useCallback(
    (rawDist: number) => {
      const m = rawDist * unitScaleToM;
      const mm = Math.round(m * 1000);
      const totalInches = m * 39.3700787;
      const ft = Math.floor(totalInches / 12);
      const inches = (totalInches - ft * 12).toFixed(1);
      return {
        primary: unitName === 'mm' ? `${mm.toLocaleString()} mm` : `${m.toFixed(3)} m`,
        meters: `${m.toFixed(3)} m`,
        mm: `${mm.toLocaleString()} mm`,
        feetInches: `${ft}' ${inches}"`,
      };
    },
    [unitScaleToM, unitName]
  );

  const formatAreaMeasurement = useCallback(
    (rawArea: number, rawPerim: number) => {
      const sqm = rawArea * unitScaleToM * unitScaleToM;
      const sqft = sqm * 10.7639104;
      const sqmm = Math.round(sqm * 1e6);
      return {
        sqm: `${sqm.toFixed(2)} m²`,
        sqft: `${sqft.toFixed(2)} sq.ft`,
        sqmm: `${sqmm.toLocaleString()} mm²`,
        perim: formatMeasurement(rawPerim),
      };
    },
    [unitScaleToM, formatMeasurement]
  );

  // Detect closed polygon (polyline, hatch, circle) or enclosed wall room at (wx, wy)
  // shortcut: enclosed-room fallback resolves axis-aligned rectangular rooms; L-shaped unjoined rooms use Area Points mode.
  const findClosedAreaAtPoint = useCallback(
    (wx: number, wy: number): DetectedAreaShape | null => {
      if (!rawData) return null;
      const tolWorld = 14.0 / Math.max(zoom, 1e-6);
      const sheetBbox = rawData.bbox_raw;
      const maxSheetArea = sheetBbox
        ? Math.max(1, (sheetBbox.max_x - sheetBbox.min_x) * (sheetBbox.max_y - sheetBbox.min_y)) * 0.65
        : Infinity;
      const minWorldArea = 0.002 / Math.max(unitScaleToM * unitScaleToM, 1e-12);

      let bestShape: DetectedAreaShape | null = null;
      let bestArea = Infinity;

      const considerPolygon = (rawPts: number[][], label: string, isExplicitlyClosed: boolean) => {
        if (!rawPts || rawPts.length < 3) return;
        const first = rawPts[0];
        const last = rawPts[rawPts.length - 1];
        const closeGap = Math.hypot(first[0] - last[0], first[1] - last[1]);
        let xsMin = Infinity,
          xsMax = -Infinity,
          ysMin = Infinity,
          ysMax = -Infinity;
        for (const p of rawPts) {
          if (p[0] < xsMin) xsMin = p[0];
          if (p[0] > xsMax) xsMax = p[0];
          if (p[1] < ysMin) ysMin = p[1];
          if (p[1] > ysMax) ysMax = p[1];
        }
        const span = Math.hypot(xsMax - xsMin, ysMax - ysMin);
        if (!isExplicitlyClosed && closeGap > Math.max(1e-2, span * 0.03)) return;
        if (
          wx < xsMin - tolWorld ||
          wx > xsMax + tolWorld ||
          wy < ysMin - tolWorld ||
          wy > ysMax + tolWorld
        ) {
          return;
        }
        const pts: [number, number][] = (
          closeGap < 1e-4 && rawPts.length > 3 ? rawPts.slice(0, -1) : rawPts
        ).map((p) => [p[0], p[1]]);
        if (pts.length < 3) return;

        const { rawArea } = computePolygonAreaAndPerimeter(pts);
        if (rawArea < minWorldArea || rawArea > maxSheetArea || rawArea >= bestArea) return;

        let matched = pointInPolygon(wx, wy, pts);
        if (!matched) {
          for (let i = 0; i < pts.length; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            if (distToSegment(wx, wy, a[0], a[1], b[0], b[1]) <= tolWorld) {
              matched = true;
              break;
            }
          }
        }
        if (matched) {
          bestArea = rawArea;
          bestShape = { pts, label };
        }
      };

      if (rawData.polylines) {
        for (const pl of rawData.polylines) {
          if (!isLayerVisible(pl.layer)) continue;
          considerPolygon(pl.points, `Closed Polyline (${pl.layer})`, Boolean(pl.closed));
        }
      }
      if (rawData.hatches) {
        for (const h of rawData.hatches) {
          if (!isLayerVisible(h.layer)) continue;
          considerPolygon(h.points, `Hatch Area (${h.layer})`, true);
        }
      }
      if (rawData.arcs_circles) {
        for (const ac of rawData.arcs_circles) {
          if (ac.type !== 'CIRCLE' || !isLayerVisible(ac.layer)) continue;
          const [cx, cy] = ac.center;
          const r = ac.radius;
          if (Math.hypot(wx - cx, wy - cy) <= r + tolWorld) {
            const cArea = Math.PI * r * r;
            if (cArea >= minWorldArea && cArea < bestArea) {
              const pts: [number, number][] = [];
              for (let i = 0; i < 48; i++) {
                const ang = (i / 48) * Math.PI * 2;
                pts.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
              }
              bestArea = cArea;
              bestShape = { pts, label: `Circle (${ac.layer})` };
            }
          }
        }
      }

      if (bestShape) return bestShape;

      // Fallback: find enclosing vertical & horizontal wall lines around (wx, wy)
      const doorAllowance = 0.85 / Math.max(unitScaleToM, 1e-6);
      const minSegLen = 0.25 / Math.max(unitScaleToM, 1e-6);
      const minRoomSpan = 0.35 / Math.max(unitScaleToM, 1e-6);
      const maxRoomSpan = 40.0 / Math.max(unitScaleToM, 1e-6);

      let leftX: number | null = null;
      let rightX: number | null = null;
      let bottomY: number | null = null;
      let topY: number | null = null;

      const checkWallSeg = (x1: number, y1: number, x2: number, y2: number) => {
        const dx = Math.abs(x2 - x1);
        const dy = Math.abs(y2 - y1);
        if (dy >= minSegLen && dx <= dy * 0.18) {
          const x = (x1 + x2) * 0.5;
          if (wy >= Math.min(y1, y2) - doorAllowance && wy <= Math.max(y1, y2) + doorAllowance) {
            if (x < wx && (leftX === null || x > leftX)) leftX = x;
            if (x > wx && (rightX === null || x < rightX)) rightX = x;
          }
        } else if (dx >= minSegLen && dy <= dx * 0.18) {
          const y = (y1 + y2) * 0.5;
          if (wx >= Math.min(x1, x2) - doorAllowance && wx <= Math.max(x1, x2) + doorAllowance) {
            if (y < wy && (bottomY === null || y > bottomY)) bottomY = y;
            if (y > wy && (topY === null || y < topY)) topY = y;
          }
        }
      };

      if (rawData.lines) {
        for (const ln of rawData.lines) {
          if (!isLayerVisible(ln.layer) || ln.source === 'dimension') continue;
          checkWallSeg(ln.start[0], ln.start[1], ln.end[0], ln.end[1]);
        }
      }
      if (rawData.polylines) {
        for (const pl of rawData.polylines) {
          if (!isLayerVisible(pl.layer) || !pl.points || pl.points.length < 2) continue;
          const pts = pl.points;
          const cnt = pl.closed ? pts.length : pts.length - 1;
          for (let i = 0; i < cnt; i++) {
            const p1 = pts[i];
            const p2 = pts[(i + 1) % pts.length];
            checkWallSeg(p1[0], p1[1], p2[0], p2[1]);
          }
        }
      }

      if (leftX !== null && rightX !== null && bottomY !== null && topY !== null) {
        const w = rightX - leftX;
        const h = topY - bottomY;
        if (w >= minRoomSpan && w <= maxRoomSpan && h >= minRoomSpan && h <= maxRoomSpan) {
          const pts: [number, number][] = [
            [leftX, bottomY],
            [rightX, bottomY],
            [rightX, topY],
            [leftX, topY],
          ];
          const roomTxt = rawData.texts?.find(
            (t: any) =>
              isLayerVisible(t.layer) &&
              t.x >= leftX! &&
              t.x <= rightX! &&
              t.y >= bottomY! &&
              t.y <= topY! &&
              t.text &&
              t.text.length >= 2 &&
              t.text.length <= 28
          );
          return {
            pts,
            label: roomTxt ? `Enclosed Area (${roomTxt.text})` : 'Enclosed Wall Area',
          };
        }
      }

      return null;
    },
    [rawData, zoom, unitScaleToM, isLayerVisible]
  );

  // Find nearest endpoint / vertex for OSNAP in Measure Mode
  const snapKindRef = useRef<'end' | 'mid' | 'center'>('end');
  const findNearestSnapPoint = useCallback(
    (wx: number, wy: number, isTouch = false): [number, number] | null => {
      if (!rawData) return null;
      // a fingertip is ~40px wide, so touch gets a larger snap radius than a mouse
      const tolWorld = (isTouch ? 36.0 : 18.0) / Math.max(zoom, 1e-6);
      let bestPt: [number, number] | null = null;
      let bestDist = tolWorld;

      let bestKind: 'end' | 'mid' | 'center' = 'end';
      // midpoints/centers must be clearly closer than an endpoint to win, so corners stay easy to hit
      const check = (px: number, py: number, kind: 'end' | 'mid' | 'center' = 'end') => {
        const d = Math.hypot(wx - px, wy - py) * (kind === 'end' ? 1 : 1.25);
        if (d < bestDist) {
          bestDist = d;
          bestPt = [px, py];
          bestKind = kind;
        }
      };

      if (rawData.lines) {
        for (const ln of rawData.lines) {
          if (!isLayerVisible(ln.layer)) continue;
          check(ln.start[0], ln.start[1]);
          check(ln.end[0], ln.end[1]);
          check((ln.start[0] + ln.end[0]) / 2, (ln.start[1] + ln.end[1]) / 2, 'mid');
        }
      }
      if (rawData.polylines) {
        for (const pl of rawData.polylines) {
          if (!isLayerVisible(pl.layer)) continue;
          for (let k = 0; k < pl.points.length; k++) {
            const pt = pl.points[k];
            check(pt[0], pt[1]);
            if (k > 0) check((pt[0] + pl.points[k - 1][0]) / 2, (pt[1] + pl.points[k - 1][1]) / 2, 'mid');
          }
        }
      }
      if (rawData.arcs_circles) {
        for (const ac of rawData.arcs_circles) {
          if (isLayerVisible(ac.layer)) check(ac.center[0], ac.center[1], 'center');
        }
      }
      snapKindRef.current = bestKind;
      return bestPt;
    },
    [rawData, zoom, isLayerVisible]
  );

  // Render cleaned 2D CAD view & measurement overlay
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rawData) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.w * dpr;
    canvas.height = canvasSize.h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = colorMode === 'blueprint' ? '#04142c' : '#060b14';
    ctx.fillRect(0, 0, canvasSize.w, canvasSize.h);

    const [wMinX, wMaxY] = screenToWorld(0, 0);
    const [wMaxX, wMinY] = screenToWorld(canvasSize.w, canvasSize.h);
    const padX = (wMaxX - wMinX) * 0.1;
    const padY = (wMaxY - wMinY) * 0.1;
    const cullMinX = wMinX - padX;
    const cullMaxX = wMaxX + padX;
    const cullMinY = wMinY - padY;
    const cullMaxY = wMaxY + padY;

    // Subtle CAD grid
    const rawStep = Math.pow(10, Math.floor(Math.log10(110 / Math.max(zoom, 1e-9))));
    const gridStep = rawStep * zoom < 40 ? rawStep * 5 : rawStep * zoom < 80 ? rawStep * 2 : rawStep;
    if (gridStep * zoom >= 20) {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const startX = Math.floor(wMinX / gridStep) * gridStep;
      for (let gx = startX; gx <= wMaxX; gx += gridStep) {
        const [sx] = worldToScreen(gx, 0);
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, canvasSize.h);
      }
      const startY = Math.floor(wMinY / gridStep) * gridStep;
      for (let gy = startY; gy <= wMaxY; gy += gridStep) {
        const [, sy] = worldToScreen(0, gy);
        ctx.moveTo(0, sy);
        ctx.lineTo(canvasSize.w, sy);
      }
      ctx.stroke();
    }

    // Hatches
    if (rawData.hatches) {
      ctx.save();
      ctx.globalAlpha = 0.15;
      for (const h of rawData.hatches) {
        if (!isLayerVisible(h.layer) || !h.points || h.points.length < 3) continue;
        const p0 = h.points[0];
        if (p0[0] < cullMinX || p0[0] > cullMaxX || p0[1] < cullMinY || p0[1] > cullMaxY) continue;
        ctx.fillStyle = getEntityColor(h.color);
        ctx.beginPath();
        const [sx0, sy0] = worldToScreen(p0[0], p0[1]);
        ctx.moveTo(sx0, sy0);
        for (let i = 1; i < h.points.length; i++) {
          const [sxi, syi] = worldToScreen(h.points[i][0], h.points[i][1]);
          ctx.lineTo(sxi, syi);
        }
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // Lines batched by color
    if (rawData.lines) {
      const buckets = new Map<string, number[][]>();
      for (const ln of rawData.lines) {
        if (!isLayerVisible(ln.layer)) continue;
        const [x1, y1] = ln.start;
        const [x2, y2] = ln.end;
        if (
          Math.max(x1, x2) < cullMinX ||
          Math.min(x1, x2) > cullMaxX ||
          Math.max(y1, y2) < cullMinY ||
          Math.min(y1, y2) > cullMaxY
        ) {
          continue;
        }
        const col = getEntityColor(ln.color);
        let b = buckets.get(col);
        if (!b) {
          b = [];
          buckets.set(col, b);
        }
        b.push([x1, y1, x2, y2]);
      }
      ctx.lineWidth = 1.05;
      for (const [col, segs] of buckets.entries()) {
        ctx.strokeStyle = col;
        ctx.beginPath();
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i];
          const [sx1, sy1] = worldToScreen(s[0], s[1]);
          const [sx2, sy2] = worldToScreen(s[2], s[3]);
          ctx.moveTo(sx1, sy1);
          ctx.lineTo(sx2, sy2);
        }
        ctx.stroke();
      }
    }

    // Polylines batched by color
    if (rawData.polylines) {
      const polyBuckets = new Map<string, any[]>();
      for (const pl of rawData.polylines) {
        if (!isLayerVisible(pl.layer) || !pl.points || pl.points.length < 2) continue;
        const col = getEntityColor(pl.color);
        let b = polyBuckets.get(col);
        if (!b) {
          b = [];
          polyBuckets.set(col, b);
        }
        b.push(pl);
      }
      ctx.lineWidth = 1.15;
      for (const [col, pls] of polyBuckets.entries()) {
        ctx.strokeStyle = col;
        ctx.beginPath();
        for (const pl of pls) {
          const pts = pl.points;
          const [sx0, sy0] = worldToScreen(pts[0][0], pts[0][1]);
          ctx.moveTo(sx0, sy0);
          for (let j = 1; j < pts.length; j++) {
            const [sxj, syj] = worldToScreen(pts[j][0], pts[j][1]);
            ctx.lineTo(sxj, syj);
          }
          if (pl.closed) ctx.closePath();
        }
        ctx.stroke();
      }
    }

    // Circles & Arcs
    if (rawData.arcs_circles) {
      ctx.lineWidth = 1.05;
      for (const ac of rawData.arcs_circles) {
        if (!isLayerVisible(ac.layer)) continue;
        const [cx, cy] = ac.center;
        const r = ac.radius;
        if (cx + r < cullMinX || cx - r > cullMaxX || cy + r < cullMinY || cy - r > cullMaxY) continue;
        const sr = r * zoom;
        if (sr < 0.5) continue;
        const [sx, sy] = worldToScreen(cx, cy);
        ctx.strokeStyle = getEntityColor(ac.color);
        ctx.beginPath();
        if (ac.type === 'CIRCLE') {
          ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        } else {
          const startRad = -(ac.start_angle || 0) * (Math.PI / 180);
          const endRad = -(ac.end_angle || 0) * (Math.PI / 180);
          ctx.arc(sx, sy, sr, startRad, endRad, true);
        }
        ctx.stroke();
      }
    }

    // Texts
    if (rawData.texts) {
      ctx.save();
      for (const t of rawData.texts) {
        if (!isLayerVisible(t.layer)) continue;
        if (t.x < cullMinX || t.x > cullMaxX || t.y < cullMinY || t.y > cullMaxY) continue;
        const pxHeight = (t.height || 0.2) * zoom;
        if (pxHeight < 7.5) continue;
        const [sx, sy] = worldToScreen(t.x, t.y);
        const fontPx = Math.min(26, pxHeight);
        ctx.font = `${fontPx > 12 ? '600' : '400'} ${fontPx.toFixed(1)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.fillStyle = getEntityColor(t.color);
        if (t.rotation) {
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate((-t.rotation * Math.PI) / 180);
          ctx.fillText(t.text, 0, 0);
          ctx.restore();
        } else {
          ctx.fillText(t.text, sx, sy);
        }
      }
      ctx.restore();
    }

    // Interactive Distance & Area Measurement Overlay
    if (toolMode === 'measure') {
      ctx.save();
      const drawBadge = (sx: number, sy: number, label: string) => {
        ctx.font = '700 12px ui-monospace, SFMono-Regular, monospace';
        const tw = ctx.measureText(label).width + 18;
        const boxX = Math.max(8, Math.min(canvasSize.w - tw - 8, sx - tw / 2));
        const boxY = Math.max(toolMode === 'measure' ? 96 : 12, Math.min(canvasSize.h - 32, sy - 14));
        ctx.fillStyle = 'rgba(6, 78, 59, 0.95)';
        ctx.fillRect(boxX, boxY, tw, 24);
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(boxX, boxY, tw, 24);
        ctx.fillStyle = '#ecfdf5';
        ctx.fillText(label, boxX + 9, boxY + 16);
      };

      const drawPolygonOverlay = (
        pts: [number, number][],
        fillStyle: string,
        strokeStyle: string,
        dashed = false,
        showVertices = true
      ) => {
        if (pts.length < 2) return;
        ctx.beginPath();
        const [sx0, sy0] = worldToScreen(pts[0][0], pts[0][1]);
        ctx.moveTo(sx0, sy0);
        for (let i = 1; i < pts.length; i++) {
          const [sxi, syi] = worldToScreen(pts[i][0], pts[i][1]);
          ctx.lineTo(sxi, syi);
        }
        if (pts.length >= 3) {
          ctx.closePath();
          ctx.fillStyle = fillStyle;
          ctx.fill();
        }
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = 2.4;
        if (dashed) ctx.setLineDash([6, 4]);
        ctx.stroke();
        if (dashed) ctx.setLineDash([]);

        if (showVertices) {
          ctx.fillStyle = strokeStyle;
          for (const pt of pts) {
            const [vx, vy] = worldToScreen(pt[0], pt[1]);
            ctx.beginPath();
            ctx.arc(vx, vy, 4.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      };

      if (measureSubMode === 'area-pick') {
        const activeShape = selectedAreaShape || hoverAreaShape;
        if (hoverAreaShape && hoverAreaShape !== selectedAreaShape) {
          drawPolygonOverlay(
            hoverAreaShape.pts,
            'rgba(16, 185, 129, 0.10)',
            'rgba(52, 211, 153, 0.75)',
            true,
            false
          );
        }
        if (selectedAreaShape) {
          drawPolygonOverlay(
            selectedAreaShape.pts,
            'rgba(16, 185, 129, 0.24)',
            '#10b981',
            false,
            selectedAreaShape.pts.length <= 24
          );
        }
        if (activeShape && activeShape.pts.length >= 3) {
          const { rawArea, rawPerim, centroid } = computePolygonAreaAndPerimeter(activeShape.pts);
          const fmt = formatAreaMeasurement(rawArea, rawPerim);
          const [cx, cy] = worldToScreen(centroid[0], centroid[1]);
          drawBadge(cx, cy, `${fmt.sqm}  (${fmt.sqft})`);
        }
      } else if (measureSubMode === 'area-points') {
        if (snapPt) {
          const [snx, sny] = worldToScreen(snapPt[0], snapPt[1]);
          ctx.strokeStyle = '#10b981';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          if (snapKindRef.current === 'mid') {
            ctx.moveTo(snx, sny - 8);
            ctx.lineTo(snx + 8, sny + 6);
            ctx.lineTo(snx - 8, sny + 6);
            ctx.closePath();
          } else if (snapKindRef.current === 'center') {
            ctx.arc(snx, sny, 6, 0, Math.PI * 2);
          } else {
            ctx.rect(snx - 6, sny - 6, 12, 12);
          }
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(snx, sny, 18, 0, Math.PI * 2);
          ctx.stroke();
        }
        const livePt = snapPt || cursorWorld;
        const previewPts =
          livePt && measurePts.length >= 1 && measurePts.length < 3
            ? [...measurePts, livePt]
            : measurePts;
        if (previewPts.length >= 2) {
          drawPolygonOverlay(
            previewPts,
            'rgba(16, 185, 129, 0.22)',
            '#10b981',
            measurePts.length < 3,
            true
          );
        } else if (measurePts.length === 1) {
          const [sx1, sy1] = worldToScreen(measurePts[0][0], measurePts[0][1]);
          ctx.fillStyle = '#10b981';
          ctx.beginPath();
          ctx.arc(sx1, sy1, 5, 0, Math.PI * 2);
          ctx.fill();
        }
        if (previewPts.length >= 3) {
          const { rawArea, rawPerim, centroid } = computePolygonAreaAndPerimeter(previewPts);
          if (rawArea > 1e-6) {
            const fmt = formatAreaMeasurement(rawArea, rawPerim);
            const [cx, cy] = worldToScreen(centroid[0], centroid[1]);
            drawBadge(cx, cy, `${fmt.sqm}  (${fmt.sqft})`);
          }
        }
      } else {
        if (snapPt) {
          const [snx, sny] = worldToScreen(snapPt[0], snapPt[1]);
          ctx.strokeStyle = '#10b981';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          if (snapKindRef.current === 'mid') {
            ctx.moveTo(snx, sny - 8);
            ctx.lineTo(snx + 8, sny + 6);
            ctx.lineTo(snx - 8, sny + 6);
            ctx.closePath();
          } else if (snapKindRef.current === 'center') {
            ctx.arc(snx, sny, 6, 0, Math.PI * 2);
          } else {
            ctx.rect(snx - 6, sny - 6, 12, 12);
          }
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(snx, sny, 18, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (measurePts.length >= 1) {
          const p1 = measurePts[0];
          const p2 = measurePts.length >= 2 ? measurePts[1] : snapPt || cursorWorld;
          const [sx1, sy1] = worldToScreen(p1[0], p1[1]);

          ctx.fillStyle = '#10b981';
          ctx.beginPath();
          ctx.arc(sx1, sy1, 5.5, 0, Math.PI * 2);
          ctx.fill();

          if (p2) {
            const [sx2, sy2] = worldToScreen(p2[0], p2[1]);
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 2.5;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.moveTo(sx1, sy1);
            ctx.lineTo(sx2, sy2);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.beginPath();
            ctx.arc(sx2, sy2, 5.5, 0, Math.PI * 2);
            ctx.fill();

            const rawDist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
            if (rawDist > 1e-5) {
              const fmt = formatMeasurement(rawDist);
              const label = `${fmt.meters}  (${fmt.feetInches})`;
              drawBadge((sx1 + sx2) / 2, (sy1 + sy2) / 2 - 14, label);
            }
          }
        }
      }
      ctx.restore();
    }
  }, [
    rawData,
    viewCenter,
    zoom,
    canvasSize,
    colorMode,
    hiddenLayers,
    toolMode,
    measureSubMode,
    measurePts,
    selectedAreaShape,
    hoverAreaShape,
    snapPt,
    cursorWorld,
    worldToScreen,
    screenToWorld,
    isLayerVisible,
    getEntityColor,
    formatMeasurement,
    formatAreaMeasurement,
  ]);

  const lastTouchRef = useRef(0);
  const touchT0Ref = useRef(0);
  const placeMeasurePoint = (wx: number, wy: number, isTouch = false) => {
    if (measureSubMode === 'area-pick') {
      const shape = findClosedAreaAtPoint(wx, wy);
      setSelectedAreaShape(shape);
      setHoverAreaShape(shape);
      return;
    }
    const snapped = findNearestSnapPoint(wx, wy, isTouch) || [wx, wy];
    setSnapPt(snapped);
    if (measureSubMode === 'area-points') {
      setMeasurePts((prev) => [...prev, snapped]);
    } else {
      setMeasurePts((prev) => (prev.length >= 2 ? [snapped] : [...prev, snapped]));
    }
  };

  // Mouse handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (Date.now() - lastTouchRef.current < 800) return; // synthesized after a tap
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    dragRef.current = {
      active: true,
      moved: false,
      startX: sx,
      startY: sy,
      startCenter: [...viewCenter],
      pinchDist: null,
      startZoom: zoom,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const [wx, wy] = screenToWorld(sx, sy);
    setCursorWorld([wx, wy]);

    if (toolMode === 'measure' && !dragRef.current.active) {
      if (measureSubMode === 'area-pick') {
        setSnapPt(null);
        setHoverAreaShape(findClosedAreaAtPoint(wx, wy));
      } else {
        setSnapPt(findNearestSnapPoint(wx, wy));
      }
    }

    if (dragRef.current.active) {
      const dx = sx - dragRef.current.startX;
      const dy = sy - dragRef.current.startY;
      if (Math.hypot(dx, dy) > 4) {
        dragRef.current.moved = true;
      }
      if (dragRef.current.moved) {
        setViewCenter([
          dragRef.current.startCenter[0] - dx / zoom,
          dragRef.current.startCenter[1] + dy / zoom,
        ]);
      }
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (Date.now() - lastTouchRef.current < 800) return;
    if (!dragRef.current.active) return;
    const wasMoved = dragRef.current.moved;
    dragRef.current.active = false;
    if (!wasMoved && toolMode === 'measure') {
      const rect = e.currentTarget.getBoundingClientRect();
      const [wx, wy] = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      placeMeasurePoint(wx, wy);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const [wxBefore, wyBefore] = screenToWorld(sx, sy);
    const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
    const nextZoom = Math.max(1e-5, Math.min(10000, zoom * factor));
    const newCenterX = wxBefore - (sx - canvasSize.w / 2) / nextZoom;
    const newCenterY = wyBefore + (sy - canvasSize.h / 2) / nextZoom;
    setZoom(nextZoom);
    setViewCenter([newCenterX, newCenterY]);
  };

  // Mobile Touch Gestures (1-finger pan / tap-to-measure + 2-finger pinch zoom)
  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    lastTouchRef.current = Date.now();
    if (e.touches.length === 1) touchT0Ref.current = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      dragRef.current = {
        active: true,
        moved: true,
        startX: (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left,
        startY: (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top,
        startCenter: [...viewCenter],
        pinchDist: Math.hypot(dx, dy),
        startZoom: zoom,
      };
    } else if (e.touches.length === 1) {
      if (e.touches[0].clientX <= 22) return;
      const sx = e.touches[0].clientX - rect.left;
      const sy = e.touches[0].clientY - rect.top;
      dragRef.current = {
        active: true,
        moved: false,
        startX: sx,
        startY: sy,
        startCenter: [...viewCenter],
        pinchDist: null,
        startZoom: zoom,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!dragRef.current.active) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (e.touches.length === 2 && dragRef.current.pinchDist) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.max(10, Math.hypot(dx, dy));
      const scale = dist / dragRef.current.pinchDist;
      setZoom(Math.max(1e-5, Math.min(10000, dragRef.current.startZoom * scale)));
      return;
    }
    if (e.touches.length === 1) {
      const sx = e.touches[0].clientX - rect.left;
      const sy = e.touches[0].clientY - rect.top;
      const dx = sx - dragRef.current.startX;
      const dy = sy - dragRef.current.startY;
      if (Math.hypot(dx, dy) > 16) {
        dragRef.current.moved = true;
      }
      if (dragRef.current.moved) {
        setViewCenter([
          dragRef.current.startCenter[0] - dx / zoom,
          dragRef.current.startCenter[1] + dy / zoom,
        ]);
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
    lastTouchRef.current = Date.now();
    if (!dragRef.current.active) return;
    const wasMoved = dragRef.current.moved;
    const tapX = dragRef.current.startX;
    const tapY = dragRef.current.startY;
    dragRef.current.active = false;
    if (!wasMoved && Date.now() - touchT0Ref.current < 350 && toolMode === 'measure' && e.changedTouches.length === 1) {
      const [wx, wy] = screenToWorld(tapX, tapY);
      placeMeasurePoint(wx, wy, true);
    }
  };

  const activeMeasureDistance =
    measureSubMode === 'distance' && measurePts.length === 2
      ? Math.hypot(measurePts[1][0] - measurePts[0][0], measurePts[1][1] - measurePts[0][1])
      : null;
  const activeMeasureFormatted =
    activeMeasureDistance !== null ? formatMeasurement(activeMeasureDistance) : null;

  const activeAreaPts =
    measureSubMode === 'area-pick'
      ? (selectedAreaShape || hoverAreaShape)?.pts || []
      : measureSubMode === 'area-points'
      ? measurePts
      : [];
  const activeAreaMetrics =
    activeAreaPts.length >= 3 ? computePolygonAreaAndPerimeter(activeAreaPts) : null;
  const activeAreaFormatted =
    activeAreaMetrics !== null
      ? formatAreaMeasurement(activeAreaMetrics.rawArea, activeAreaMetrics.rawPerim)
      : null;

  const sheets = plan.sheets || rawData?.sheets || [];
  const layers = rawData?.layers || [];

  return (
    <div className="flex-1 flex flex-col bg-zinc-950 overflow-hidden">
      {/* Hidden file input for replacing DWG */}
      <input
        ref={dwgInputRef}
        type="file"
        accept=".dwg,.dxf"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusyAction('Uploading & cleaning DWG...');
          try {
            await onUploadDwg(f);
          } finally {
            setBusyAction(null);
            e.target.value = '';
          }
        }}
      />

      {/* Header: row 1 = back, title, actions; row 2 = view switcher, sheet selector */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-3 pb-2 pt-[max(8px,env(safe-area-inset-top))] shrink-0 space-y-2">
        <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
            <button
              onClick={onBack}
              className="p-2.5 sm:p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition shrink-0"
              title="Back to Plan Vault"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {editingPlanTitle ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={tempPlanTitle}
                      onChange={(e) => setTempPlanTitle(e.target.value)}
                      className="bg-zinc-950 border border-blue-500 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none"
                      autoFocus
                    />
                    <button
                      onClick={async () => {
                        if (onUpdateMetadata && tempPlanTitle.trim() && tempPlanTitle !== plan.name) {
                          await onUpdateMetadata({ name: tempPlanTitle.trim() });
                        }
                        setEditingPlanTitle(false);
                      }}
                      className="p-1 rounded bg-blue-600 hover:bg-blue-500 text-white"
                      title="Save title"
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => {
                        setTempPlanTitle(plan.name || '');
                        setEditingPlanTitle(false);
                      }}
                      className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400"
                      title="Cancel"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 group min-w-0">
                    <h2 className="text-xs sm:text-sm font-medium text-white truncate min-w-0">
                      {plan.name}
                    </h2>
                    {onUpdateMetadata && !isGuest && (
                      <button
                        onClick={() => {
                          setTempPlanTitle(plan.name || '');
                          setEditingPlanTitle(true);
                        }}
                        className="p-0.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition shrink-0"
                        title="Edit plan name"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="text-[11px] text-zinc-400 truncate mt-0.5">
                {[isGuest ? 'Guest preview' : null, plan.project_name, plan.discipline].filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>
  
  
          <div className="flex items-center gap-1.5 shrink-0">
          {onOpenAuth && (
            <>
              <button
                onClick={() => onOpenAuth('signin')}
                className="hidden sm:inline-flex px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 transition"
              >
                Sign In
              </button>
              {!isGuest && (
                <button
                  onClick={() => onOpenAuth('signup')}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow transition"
                >
                  Sign Up
                </button>
              )}
            </>
          )}
          {isGuest && onSavePlan && (
            <button
              onClick={onSavePlan}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow transition"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{onOpenAuth ? 'Sign Up & Save' : 'Save Plan'}</span>
            </button>
          )}

          {/* Multi-discipline Estimator Launcher */}
          {(onOpenEstimator || onOpenStructuralEstimator) && (
            <div className="relative">
              <div className="flex items-center rounded-lg bg-zinc-800 hover:bg-zinc-700/80 border border-zinc-700 overflow-hidden shadow-sm">
                <button
                  onClick={() => {
                    if (onOpenEstimator) {
                      onOpenEstimator(currentDiscipline);
                    } else if (onOpenStructuralEstimator) {
                      onOpenStructuralEstimator();
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 sm:px-2.5 sm:py-1.5 text-zinc-100 hover:text-white text-xs font-medium transition"
                  title={`Open ${currentDisciplineInfo.estimatorLabel}`}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-blue-400" />
                  <span className="hidden sm:inline font-mono text-[11px] uppercase tracking-wider text-zinc-400 mr-0.5">
                    {currentDiscipline}
                  </span>
                  <span className="hidden sm:inline">{currentDisciplineInfo.estimatorLabel}</span>
                  <span className="sm:hidden">Estimator</span>
                </button>
                {onOpenEstimator && (
                  <button
                    onClick={() => setShowEstimatorMenu((v) => !v)}
                    className="p-1.5 sm:py-1.5 border-l border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50 transition"
                    title="Switch discipline estimator"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {showEstimatorMenu && onOpenEstimator && (
                <div className="absolute right-0 mt-1.5 w-64 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl p-1.5 z-40 text-xs space-y-1">
                  <div className="px-2.5 py-1 text-[11px] font-mono text-zinc-400 uppercase tracking-wider">
                    Select Estimator
                  </div>
                  {DISCIPLINES.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => {
                        setShowEstimatorMenu(false);
                        onOpenEstimator(d.id);
                      }}
                      className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left transition ${
                        d.id === currentDiscipline
                          ? 'bg-blue-600/15 border border-blue-500/30 text-blue-200'
                          : 'hover:bg-zinc-800 text-zinc-300'
                      }`}
                    >
                      <FileSpreadsheet className="w-4 h-4 mt-0.5 shrink-0 text-zinc-400" />
                      <div>
                        <div className="font-medium text-zinc-200">{d.estimatorLabel}</div>
                        <div className="text-[11px] text-zinc-400 leading-tight">{d.estimatorDesc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => onShare(plan)}
            className="flex items-center gap-1.5 px-3 py-2.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Share</span>
          </button>

          <div className="relative">
            <button
              onClick={() => setShowDownloadMenu((v) => !v)}
              className="p-2.5 sm:p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition"
              title="Download or Update Plan Files"
            >
              <Download className="w-4 h-4" />
            </button>
            {showDownloadMenu && (
              <div className="absolute right-0 mt-1.5 w-52 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl p-1.5 z-40 text-xs space-y-1">
                {plan.has_dwg && (
                  <>
                    <a
                      href={apiUrl(`/api/plans/${plan.id}/file/dxf?share=${encodeURIComponent(plan.share_token || '')}`)}
                      download
                      className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-800 text-zinc-200"
                    >
                      <Download className="w-3.5 h-3.5 text-zinc-300" />
                      Download Cleaned .DXF
                    </a>
                    <a
                      href={apiUrl(`/api/plans/${plan.id}/file/dwg?share=${encodeURIComponent(plan.share_token || '')}`)}
                      download
                      className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-800 text-zinc-200"
                    >
                      <Download className="w-3.5 h-3.5 text-blue-400" />
                      Download Original .DWG
                    </a>
                  </>
                )}
              </div>
            )}
          </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {sheets.length > 0 && (
            <div className="flex items-center gap-1 flex-1 min-w-0">
              {sheets.length === 1 ? (
                <span
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-zinc-200 flex-1 min-w-0 sm:flex-none sm:max-w-[210px] truncate"
                  title={sheets[0].name}
                >
                  {sheets[0].name}
                </span>
              ) : (
                <select
                  value={plan.active_sheet_id || 'all'}
                  onChange={async (e) => {
                    const nextId = e.target.value;
                    setBusyAction('Isolating sheet view...');
                    try {
                      await onSelectSheet(nextId);
                    } finally {
                      setBusyAction(null);
                    }
                  }}
                  className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-zinc-200 flex-1 min-w-0 sm:flex-none sm:max-w-[210px] truncate"
                  title="Switch isolated view"
                >
                  <option value="all">All {sheets.length} Selected Views (Merged)</option>
                  {sheets.map((s: any, idx: number) => (
                    <option key={s.id} value={s.id}>
                      View #{idx + 1}: {s.name}
                    </option>
                  ))}
                </select>
              )}

              {onUpdateMetadata && !isGuest && plan.active_sheet_id && plan.active_sheet_id !== 'all' && (
                <button
                  onClick={() => {
                    const cur = sheets.find((s: any) => s.id === plan.active_sheet_id);
                    if (cur) {
                      setTempSheetName(cur.name || '');
                      setTempSheetDesc(cur.description || '');
                      setSheetAiSuggestion(null);
                      try {
                        setSheetPreviewUrl(canvasRef.current ? canvasRef.current.toDataURL('image/png') : null);
                      } catch {
                        setSheetPreviewUrl(null);
                      }
                      setEditingSheetMeta(true);
                      const sheetTexts = (rawData?.texts || [])
                        .slice()
                        .sort((a: any, b: any) => (Number(b.height) || 0) - (Number(a.height) || 0))
                        .map((t: any) => String(t.text || '').trim())
                        .filter(Boolean)
                        .slice(0, 25);
                      setSheetAiBusy(true);
                      authFetch('/api/plans/ai-clean-names', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          filename: plan.dwg_filename || plan.name || 'plan.dwg',
                          sheets: [{ id: cur.id, name: cur.name, candidate_texts: sheetTexts }],
                          candidate_texts: sheetTexts,
                        }),
                      })
                        .then((r) => (r.ok ? r.json() : null))
                        .then((d) => {
                          const sName = d?.sheets?.[0]?.name?.trim();
                          if (sName) setSheetAiSuggestion(sName);
                        })
                        .catch(() => {})
                        .finally(() => setSheetAiBusy(false));
                    }
                  }}
                  className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition"
                  title="Edit current sheet name and description"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

        </div>
      </div>

      {busyAction && (
        <div className="bg-zinc-900 border-b border-blue-500/30 px-4 py-1.5 text-xs text-blue-200 flex items-center justify-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          <span>{busyAction}</span>
        </div>
      )}

      {/* Main CAD Content Area */}
      <div className="flex-1 flex overflow-hidden relative">
        <div
          ref={containerRef}
          className="relative flex-1 overflow-hidden bg-zinc-950"
        >
            {!rawData ? (
              <div className="h-full flex flex-col items-center justify-center p-6 text-center gap-3">
                <FileCode2 className="w-10 h-10 text-zinc-500" />
                <div className="text-sm font-medium text-white">No DWG File Attached Yet</div>
                <p className="text-xs text-zinc-400 max-w-xs">
                  Upload the .DWG or .DXF file for this plan to clean up the view and measure distances.
                </p>
                <button
                  onClick={() => dwgInputRef.current?.click()}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-2"
                >
                  <Upload className="w-4 h-4" /> Upload .DWG / .DXF
                </button>
              </div>
            ) : (
              <>
                {/* Native iOS left-edge swipe guard so touch-none on canvas does not block edge back gesture */}
                <div className="absolute inset-y-0 left-0 w-5 z-10 sm:hidden" />
                <canvas
                  ref={canvasRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onWheel={handleWheel}
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  className={`w-full h-full block touch-none select-none ${
                    toolMode === 'measure' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
                  }`}
                />

                {/* Top Floating Measurement HUD Banner */}
                {toolMode === 'measure' && (
                  <div className="absolute top-0 inset-x-0 z-20 bg-zinc-900/95 backdrop-blur-md border-b border-white/10 px-3 py-2 space-y-1.5">
                    {/* Sub-mode switcher: Distance | Area: Pick Closed | Area: Points */}
                    <div className="grid grid-cols-3 gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800">
                      {(
                        [
                          { id: 'distance', label: 'Distance' },
                          { id: 'area-pick', label: 'Room area' },
                          { id: 'area-points', label: 'Trace area' },
                        ] as { id: MeasureSubMode; label: string }[]
                      ).map((m) => (
                        <button
                          key={m.id}
                          onClick={() => {
                            setMeasureSubMode(m.id);
                            setMeasurePts([]);
                            setSelectedAreaShape(null);
                            setHoverAreaShape(null);
                          }}
                          className={`py-2 px-1 rounded-lg text-[11px] font-medium transition active:scale-95 truncate ${
                            measureSubMode === m.id
                              ? 'bg-blue-600 text-white shadow-xs'
                              : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>

                    {measureSubMode === 'distance' ? (
                      activeMeasureFormatted && measurePts.length === 2 ? (
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-[10px] font-medium text-zinc-300">
                              Measured Distance (OSNAP)
                            </div>
                            <div className="text-base sm:text-lg font-semibold font-mono text-white">
                              {activeMeasureFormatted.meters}{' '}
                              <span className="text-xs font-semibold text-zinc-300">
                                ({activeMeasureFormatted.feetInches} | {activeMeasureFormatted.mm})
                              </span>
                            </div>
                            <div className="text-[11px] font-mono text-zinc-400">
                              ΔX: {(Math.abs(measurePts[1][0] - measurePts[0][0]) * unitScaleToM).toFixed(3)}m · ΔY:{' '}
                              {(Math.abs(measurePts[1][1] - measurePts[0][1]) * unitScaleToM).toFixed(3)}m
                            </div>
                          </div>
                          <button
                            onClick={() => setMeasurePts([])}
                            className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 shrink-0"
                          >
                            Clear
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2 text-xs text-blue-200">
                          <div className="flex items-center gap-2">
                            <Ruler className="w-4 h-4 text-zinc-300 shrink-0" />
                            <span>
                              {measurePts.length === 0
                                ? 'Tap 1st point on DWG to measure distance'
                                : 'Tap 2nd point to complete measurement'}
                            </span>
                          </div>
                          {measurePts.length > 0 && (
                            <button
                              onClick={() => setMeasurePts([])}
                              className="text-[11px] underline text-zinc-300"
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      )
                    ) : activeAreaFormatted ? (
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[10px] font-medium text-zinc-300 truncate">
                            {measureSubMode === 'area-pick'
                              ? (selectedAreaShape || hoverAreaShape)?.label || 'Closed Area'
                              : `Polygon Area (${measurePts.length} pts)`}
                          </div>
                          <div className="text-base sm:text-lg font-semibold font-mono text-white">
                            {activeAreaFormatted.sqm}{' '}
                            <span className="text-xs font-semibold text-zinc-300">
                              ({activeAreaFormatted.sqft}
                              {unitName === 'mm' ? ` | ${activeAreaFormatted.sqmm}` : ''})
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-zinc-400">
                            Perimeter: {activeAreaFormatted.perim.meters} ({activeAreaFormatted.perim.feetInches})
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {measureSubMode === 'area-points' && measurePts.length > 0 && (
                            <button
                              onClick={() => setMeasurePts((prev) => prev.slice(0, -1))}
                              className="px-2 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-[11px] font-medium text-zinc-200"
                            >
                              Undo
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setMeasurePts([]);
                              setSelectedAreaShape(null);
                              setHoverAreaShape(null);
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2 text-xs text-blue-200">
                        <div className="flex items-center gap-2">
                          <Ruler className="w-4 h-4 text-zinc-300 shrink-0" />
                          <span>
                            {measureSubMode === 'area-pick'
                              ? 'Tap inside any closed polygon or room to get its area'
                              : `Tap 3+ points (OSNAP) to measure polygon area (${measurePts.length} pts)`}
                          </span>
                        </div>
                        {measurePts.length > 0 && (
                          <button
                            onClick={() => setMeasurePts([])}
                            className="text-[11px] underline text-zinc-300"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Right Zoom Controls */}
                <div className="absolute right-2 bottom-24 flex flex-col gap-1.5 z-20">
                  <button
                    onClick={() => setZoom((z) => z * 1.3)}
                    className="p-3 rounded-xl bg-zinc-900/90 border border-zinc-700 text-zinc-200 hover:bg-zinc-800 active:scale-95 shadow-lg"
                    title="Zoom In"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setZoom((z) => z / 1.3)}
                    className="p-3 rounded-xl bg-zinc-900/90 border border-zinc-700 text-zinc-200 hover:bg-zinc-800 active:scale-95 shadow-lg"
                    title="Zoom Out"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <button
                    onClick={fitDrawing}
                    className="p-3 rounded-xl bg-zinc-900/90 border border-zinc-700 text-zinc-200 hover:bg-zinc-800 active:scale-95 shadow-lg"
                    title="Fit Plan to Screen"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Bottom Mobile-First Floating Tool Dock */}
                <div className="absolute bottom-[max(12px,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-zinc-900/95 backdrop-blur-md border border-zinc-700/90 p-1 rounded-2xl shadow-2xl max-w-[96vw]">
                  <button
                    onClick={() => setToolMode('pan')}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition shrink-0 active:scale-95 min-h-[40px] ${
                      toolMode === 'pan'
                        ? 'bg-blue-600 text-white'
                        : 'text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    <Hand className="w-3.5 h-3.5" />
                    <span>Pan</span>
                  </button>

                  <button
                    onClick={() => setToolMode((m) => (m === 'measure' ? 'pan' : 'measure'))}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition shrink-0 active:scale-95 min-h-[40px] ${
                      toolMode === 'measure'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-zinc-900 text-zinc-300 border border-blue-500/30 hover:bg-blue-900/60'
                    }`}
                  >
                    <Ruler className="w-3.5 h-3.5" />
                    <span>Measure</span>
                  </button>

                  <div className="h-5 w-px bg-zinc-800 mx-0.5 shrink-0" />

                  {/* Drawing Unit Scale Selector */}
                  <select
                    value={unitScaleToM}
                    onChange={(e) => onChangeUnitScale(Number(e.target.value))}
                    className="bg-zinc-950 border border-zinc-700 rounded-xl px-2 py-2 text-xs font-medium text-zinc-200 shrink-0 max-w-[84px]"
                    title="Calibrate DWG Measurement Units"
                  >
                    {UNIT_OPTIONS.map((u) => (
                      <option key={u.label} value={u.scale}>
                        {u.label}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => setShowLayersSheet((v) => !v)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition shrink-0 active:scale-95 min-h-[40px] ${
                      showLayersSheet ? 'bg-blue-600 text-white' : 'text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>Layers</span>
                  </button>

                  <button
                    onClick={() =>
                      setColorMode((c) => (c === 'cad' ? 'blueprint' : c === 'blueprint' ? 'mono' : 'cad'))
                    }
                    className="px-2.5 py-2 rounded-xl text-xs font-semibold text-zinc-300 hover:bg-zinc-800 shrink-0"
                    title="Cycle CAD Color Mode"
                  >
                    {colorMode}
                  </button>
                </div>

                {/* Slide-up Layer Drawer */}
                {showLayersSheet && (
                  <div className="absolute bottom-16 left-1/2 -translate-x-1/2 w-[92%] max-w-sm max-h-72 bg-zinc-900/95 backdrop-blur-md border border-zinc-700 rounded-2xl shadow-2xl z-30 flex flex-col overflow-hidden">
                    <div className="px-3.5 py-2.5 border-b border-zinc-800 flex items-center justify-between">
                      <span className="text-xs font-medium text-white">
                        Cleaned View Layers ({layers.length})
                      </span>
                      <div className="flex items-center gap-2">
                        {hiddenLayers.size > 0 && (
                          <button
                            onClick={() => setHiddenLayers(new Set())}
                            className="text-[11px] text-blue-400 hover:underline"
                          >
                            Show All
                          </button>
                        )}
                        <button
                          onClick={() => setShowLayersSheet(false)}
                          className="p-1 text-zinc-400 hover:text-white"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="overflow-y-auto divide-y divide-zinc-800/60 p-1.5">
                      {layers.map((lyr: any) => {
                        const visible = !hiddenLayers.has(lyr.name);
                        return (
                          <button
                            key={lyr.name}
                            onClick={() => {
                              setHiddenLayers((prev) => {
                                const next = new Set(prev);
                                if (next.has(lyr.name)) next.delete(lyr.name);
                                else next.add(lyr.name);
                                return next;
                              });
                            }}
                            className="w-full px-2.5 py-1.5 rounded-lg flex items-center justify-between hover:bg-zinc-800/60 text-xs"
                          >
                            <div className="flex items-center gap-2 truncate">
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: lyr.color_hex || '#f8fafc' }}
                              />
                              <span className={`font-mono truncate ${visible ? 'text-zinc-100' : 'text-zinc-500 line-through'}`}>
                                {lyr.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[10px] text-zinc-400">{lyr.entity_count}</span>
                              {visible ? (
                                <Eye className="w-3.5 h-3.5 text-zinc-300" />
                              ) : (
                                <EyeOff className="w-3.5 h-3.5 text-zinc-500" />
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

      {/* Sheet Metadata Edit Modal */}
      {editingSheetMeta && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-white">Edit Sheet Name & Description</h3>
              <button
                onClick={() => setEditingSheetMeta(false)}
                className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-zinc-300">Sheet Name</label>
              <input
                type="text"
                value={tempSheetName}
                onChange={(e) => setTempSheetName(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                placeholder="e.g. Ground Floor Plan"
              />
              {sheetAiBusy && (
                <div className="text-[11px] text-zinc-400 flex items-center gap-1.5">
                  <AiBadge />
                  <span>Reading sheet layout context for name suggestion...</span>
                </div>
              )}
              {sheetAiSuggestion && sheetAiSuggestion !== tempSheetName && (
                <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-blue-500/10 border border-blue-500/25 text-xs">
                  <div className="min-w-0 flex items-center gap-1.5">
                    <AiBadge />
                    <span className="text-zinc-200 truncate">
                      Suggested: <strong>{sheetAiSuggestion}</strong>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setTempSheetName(sheetAiSuggestion);
                      setSheetAiSuggestion(null);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-[11px] shrink-0"
                  >
                    Apply
                  </button>
                </div>
              )}
              {sheetPreviewUrl && (
                <div className="flex items-center gap-2.5 p-2 rounded-xl bg-zinc-950 border border-zinc-800">
                  <img
                    src={sheetPreviewUrl}
                    alt="Current sheet layout reference"
                    className="w-20 h-12 object-contain rounded border border-zinc-800 bg-black shrink-0"
                  />
                  <span className="text-[11px] text-zinc-400">
                    Active sheet layout reference used to infer title
                  </span>
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">
                Description (What this view represents)
              </label>
              <textarea
                rows={3}
                value={tempSheetDesc}
                onChange={(e) => setTempSheetDesc(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-blue-500 resize-none"
                placeholder="e.g., Working plan showing room boundaries and external columns..."
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingSheetMeta(false)}
                className="px-3 py-1.5 rounded-xl bg-zinc-800 text-xs font-semibold text-zinc-300 hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (onUpdateMetadata) {
                    const nextSheets = sheets.map((s: any) =>
                      s.id === plan.active_sheet_id
                        ? { ...s, name: tempSheetName.trim() || s.name, description: tempSheetDesc.trim() }
                        : s
                    );
                    await onUpdateMetadata({ sheets: nextSheets });
                  }
                  setEditingSheetMeta(false);
                }}
                className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white shadow"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
