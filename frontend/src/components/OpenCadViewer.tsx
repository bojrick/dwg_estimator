import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiUrl } from '../auth';
import {
  ArrowLeft,
  Ruler,
  Hand,
  Maximize2,
  ZoomIn,
  ZoomOut,
  Layers,
  Share2,
  FileText,
  FileCode2,
  Columns,
  Upload,
  Sparkles,
  Download,
  Eye,
  EyeOff,
  X,
  CheckCircle2,
  RefreshCw,
  Edit2,
  Check,
} from 'lucide-react';

export type ViewerTabMode = 'dwg' | 'pdf' | 'split';
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
  onUploadPdf: (file: File) => Promise<void>;
  onGeneratePdf: () => Promise<void>;
  onUploadDwg: (file: File) => Promise<void>;
  onSavePlan?: () => void;
  onUpdateMetadata?: (patch: { name?: string; sheets?: any[] }) => Promise<void>;
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
  onUploadPdf,
  onGeneratePdf,
  onUploadDwg,
  onSavePlan,
  onUpdateMetadata,
  isGuest = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const dwgInputRef = useRef<HTMLInputElement | null>(null);

  const [viewTab, setViewTab] = useState<ViewerTabMode>(initialTab);
  const [toolMode, setToolMode] = useState<ToolMode>(initialMeasure ? 'measure' : 'pan');
  const [colorMode, setColorMode] = useState<ColorMode>('cad');

  const [viewCenter, setViewCenter] = useState<[number, number]>([0, 0]);
  const [zoom, setZoom] = useState<number>(1);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({ w: 800, h: 600 });

  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [showLayersSheet, setShowLayersSheet] = useState<boolean>(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState<boolean>(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

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
  }, [viewTab]);

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
  const findNearestSnapPoint = useCallback(
    (wx: number, wy: number): [number, number] | null => {
      if (!rawData) return null;
      const tolWorld = 18.0 / Math.max(zoom, 1e-6);
      let bestPt: [number, number] | null = null;
      let bestDist = tolWorld;

      const check = (px: number, py: number) => {
        const d = Math.hypot(wx - px, wy - py);
        if (d < bestDist) {
          bestDist = d;
          bestPt = [px, py];
        }
      };

      if (rawData.lines) {
        for (const ln of rawData.lines) {
          if (!isLayerVisible(ln.layer)) continue;
          check(ln.start[0], ln.start[1]);
          check(ln.end[0], ln.end[1]);
        }
      }
      if (rawData.polylines) {
        for (const pl of rawData.polylines) {
          if (!isLayerVisible(pl.layer)) continue;
          for (const pt of pl.points) check(pt[0], pt[1]);
        }
      }
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
        if (pxHeight < 5.5) continue;
        const [sx, sy] = worldToScreen(t.x, t.y);
        const fontPx = Math.min(32, Math.max(7.5, pxHeight));
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
        const boxY = Math.max(12, Math.min(canvasSize.h - 32, sy - 14));
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
          ctx.strokeRect(snx - 6, sny - 6, 12, 12);
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
          ctx.strokeRect(snx - 6, sny - 6, 12, 12);
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

  const placeMeasurePoint = (wx: number, wy: number) => {
    if (measureSubMode === 'area-pick') {
      const shape = findClosedAreaAtPoint(wx, wy);
      setSelectedAreaShape(shape);
      setHoverAreaShape(shape);
      return;
    }
    const snapped = findNearestSnapPoint(wx, wy) || [wx, wy];
    setSnapPt(snapped);
    if (measureSubMode === 'area-points') {
      setMeasurePts((prev) => [...prev, snapped]);
    } else {
      setMeasurePts((prev) => (prev.length >= 2 ? [snapped] : [...prev, snapped]));
    }
  };

  // Mouse handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
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
      if (Math.hypot(dx, dy) > 6) {
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
    if (!dragRef.current.active) return;
    const wasMoved = dragRef.current.moved;
    const tapX = dragRef.current.startX;
    const tapY = dragRef.current.startY;
    dragRef.current.active = false;
    if (!wasMoved && toolMode === 'measure' && e.changedTouches.length === 1) {
      const [wx, wy] = screenToWorld(tapX, tapY);
      placeMeasurePoint(wx, wy);
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
    <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden select-none">
      {/* Hidden file inputs for attaching/replacing PDF or DWG */}
      <input
        ref={pdfInputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusyAction('Uploading & matching PDF...');
          try {
            await onUploadPdf(f);
          } finally {
            setBusyAction(null);
            e.target.value = '';
          }
        }}
      />
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

      {/* Top Viewer Header (Mobile-first compact layout) */}
      <div className="bg-slate-900 border-b border-slate-800 px-3 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onBack}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition shrink-0"
            title="Back to Plan Vault"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {isGuest && (
                <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold shrink-0">
                  Guest Preview
                </span>
              )}
              {plan.project_name && (
                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-bold text-blue-300 shrink-0">
                  {plan.project_name}
                </span>
              )}
              {plan.discipline && (
                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-bold uppercase text-amber-300 shrink-0">
                  {plan.discipline}
                </span>
              )}
              {editingPlanTitle ? (
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={tempPlanTitle}
                    onChange={(e) => setTempPlanTitle(e.target.value)}
                    className="bg-slate-950 border border-blue-500 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none"
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
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400"
                    title="Cancel"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1 group">
                  <h2 className="text-xs sm:text-sm font-bold text-white truncate max-w-[180px] sm:max-w-md">
                    {plan.name}
                  </h2>
                  {onUpdateMetadata && !isGuest && (
                    <button
                      onClick={() => {
                        setTempPlanTitle(plan.name || '');
                        setEditingPlanTitle(true);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
                      title="Edit plan name"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 truncate mt-0.5">
              <CheckCircle2 className="w-3 h-3 shrink-0" />
              <span className="truncate">{plan.match_reason || 'Cleaned Single-Sheet Plan View'}</span>
            </div>
          </div>
        </div>

        {/* Center Segmented Switcher: DWG | PDF | Split */}
        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 shrink-0">
          <button
            onClick={() => setViewTab('dwg')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition ${
              viewTab === 'dwg' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <FileCode2 className="w-3.5 h-3.5" />
            <span>DWG</span>
          </button>
          <button
            onClick={() => setViewTab('pdf')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition ${
              viewTab === 'pdf' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>PDF</span>
            {!plan.has_pdf && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Upload associated PDF" />
            )}
          </button>
          <button
            onClick={() => setViewTab('split')}
            className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition ${
              viewTab === 'split' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Columns className="w-3.5 h-3.5" />
            <span>Split</span>
          </button>
        </div>

        {/* Right Actions: Sheet View Selector + Save (Guest) + Share + Download */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isGuest && onSavePlan && (
            <button
              onClick={onSavePlan}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow transition animate-pulse"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Save Plan</span>
            </button>
          )}

          {sheets.length > 0 && (
            <div className="flex items-center gap-1">
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
                className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-200 max-w-[155px] sm:max-w-[210px] truncate"
                title="Switch isolated view from multi-sheet DWG"
              >
                {sheets.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.index ? `View #${s.index}: ` : ''}{s.name}
                  </option>
                ))}
                <option value="all">Show All {sheets.length} Sheets (Uncropped)</option>
              </select>

              {onUpdateMetadata && !isGuest && plan.active_sheet_id && plan.active_sheet_id !== 'all' && (
                <button
                  onClick={() => {
                    const cur = sheets.find((s: any) => s.id === plan.active_sheet_id);
                    if (cur) {
                      setTempSheetName(cur.name || '');
                      setTempSheetDesc(cur.description || '');
                      setEditingSheetMeta(true);
                    }
                  }}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                  title="Edit current sheet name and description"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          <button
            onClick={() => onShare(plan)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Share</span>
          </button>

          <div className="relative">
            <button
              onClick={() => setShowDownloadMenu((v) => !v)}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
              title="Download or Update Plan Files"
            >
              <Download className="w-4 h-4" />
            </button>
            {showDownloadMenu && (
              <div className="absolute right-0 mt-1.5 w-52 bg-slate-900 border border-slate-700 rounded-xl shadow-xl p-1.5 z-40 text-xs space-y-1">
                {plan.has_dwg && (
                  <>
                    <a
                      href={apiUrl(`/api/plans/${plan.id}/file/dxf?share=${encodeURIComponent(plan.share_token || '')}`)}
                      download
                      className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-800 text-slate-200"
                    >
                      <Download className="w-3.5 h-3.5 text-emerald-400" />
                      Download Cleaned .DXF
                    </a>
                    <a
                      href={apiUrl(`/api/plans/${plan.id}/file/dwg?share=${encodeURIComponent(plan.share_token || '')}`)}
                      download
                      className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-800 text-slate-200"
                    >
                      <Download className="w-3.5 h-3.5 text-blue-400" />
                      Download Original .DWG
                    </a>
                  </>
                )}
                {plan.has_pdf && (
                  <a
                    href={apiUrl(`/api/plans/${plan.id}/file/pdf?share=${encodeURIComponent(plan.share_token || '')}`)}
                    download={plan.pdf_filename || 'plan.pdf'}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-800 text-slate-200"
                  >
                    <Download className="w-3.5 h-3.5 text-amber-400" />
                    Download Associated .PDF
                  </a>
                )}
                <div className="border-t border-slate-800 my-1" />
                <button
                  onClick={() => {
                    setShowDownloadMenu(false);
                    pdfInputRef.current?.click();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-800 text-left text-slate-200"
                >
                  <Upload className="w-3.5 h-3.5 text-blue-400" />
                  {plan.has_pdf ? 'Replace Associated PDF' : 'Upload Associated PDF'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {busyAction && (
        <div className="bg-blue-950/90 border-b border-blue-500/30 px-4 py-1.5 text-xs text-blue-200 flex items-center justify-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          <span>{busyAction}</span>
        </div>
      )}

      {/* Main Content Area: DWG / PDF / Split */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        {/* DWG VIEWPORT */}
        {(viewTab === 'dwg' || viewTab === 'split') && (
          <div
            ref={containerRef}
            className={`relative overflow-hidden bg-slate-950 ${
              viewTab === 'split' ? 'flex-1 border-b lg:border-b-0 lg:border-r border-slate-800' : 'flex-1'
            }`}
          >
            {!rawData ? (
              <div className="h-full flex flex-col items-center justify-center p-6 text-center gap-3">
                <FileCode2 className="w-10 h-10 text-slate-500" />
                <div className="text-sm font-bold text-white">No DWG File Attached Yet</div>
                <p className="text-xs text-slate-400 max-w-xs">
                  Upload the .DWG or .DXF file for this plan to clean up the view and measure distances.
                </p>
                <button
                  onClick={() => dwgInputRef.current?.click()}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-2"
                >
                  <Upload className="w-4 h-4" /> Upload .DWG / .DXF
                </button>
              </div>
            ) : (
              <>
                <canvas
                  ref={canvasRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onWheel={handleWheel}
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  className={`w-full h-full block touch-none ${
                    toolMode === 'measure' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
                  }`}
                />

                {/* Top Floating Measurement HUD Banner */}
                {toolMode === 'measure' && (
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 w-[94%] max-w-md bg-slate-900/95 backdrop-blur-md border border-emerald-500/50 rounded-2xl px-3.5 py-2.5 shadow-2xl space-y-2">
                    {/* Sub-mode switcher: Distance | Area: Pick Closed | Area: Points */}
                    <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                      {(
                        [
                          { id: 'distance', label: 'Distance' },
                          { id: 'area-pick', label: 'Area: Closed' },
                          { id: 'area-points', label: 'Area: Points' },
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
                          className={`py-1 px-2 rounded-lg text-[11px] font-bold transition ${
                            measureSubMode === m.id
                              ? 'bg-emerald-600 text-white shadow-xs'
                              : 'text-slate-400 hover:text-slate-200'
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
                            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                              Measured Distance (OSNAP)
                            </div>
                            <div className="text-base sm:text-lg font-extrabold font-mono text-white">
                              {activeMeasureFormatted.meters}{' '}
                              <span className="text-xs font-semibold text-emerald-300">
                                ({activeMeasureFormatted.feetInches} | {activeMeasureFormatted.mm})
                              </span>
                            </div>
                            <div className="text-[11px] font-mono text-slate-400">
                              ΔX: {(Math.abs(measurePts[1][0] - measurePts[0][0]) * unitScaleToM).toFixed(3)}m · ΔY:{' '}
                              {(Math.abs(measurePts[1][1] - measurePts[0][1]) * unitScaleToM).toFixed(3)}m
                            </div>
                          </div>
                          <button
                            onClick={() => setMeasurePts([])}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 shrink-0"
                          >
                            Clear
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2 text-xs text-emerald-200">
                          <div className="flex items-center gap-2">
                            <Ruler className="w-4 h-4 text-emerald-400 shrink-0" />
                            <span>
                              {measurePts.length === 0
                                ? 'Tap 1st point on DWG to measure distance'
                                : 'Tap 2nd point to complete measurement'}
                            </span>
                          </div>
                          {measurePts.length > 0 && (
                            <button
                              onClick={() => setMeasurePts([])}
                              className="text-[11px] underline text-slate-300"
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      )
                    ) : activeAreaFormatted ? (
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 truncate">
                            {measureSubMode === 'area-pick'
                              ? (selectedAreaShape || hoverAreaShape)?.label || 'Closed Area'
                              : `Polygon Area (${measurePts.length} pts)`}
                          </div>
                          <div className="text-base sm:text-lg font-extrabold font-mono text-white">
                            {activeAreaFormatted.sqm}{' '}
                            <span className="text-xs font-semibold text-emerald-300">
                              ({activeAreaFormatted.sqft}
                              {unitName === 'mm' ? ` | ${activeAreaFormatted.sqmm}` : ''})
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-slate-400">
                            Perimeter: {activeAreaFormatted.perim.meters} ({activeAreaFormatted.perim.feetInches})
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {measureSubMode === 'area-points' && measurePts.length > 0 && (
                            <button
                              onClick={() => setMeasurePts((prev) => prev.slice(0, -1))}
                              className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-bold text-slate-200"
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
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2 text-xs text-emerald-200">
                        <div className="flex items-center gap-2">
                          <Ruler className="w-4 h-4 text-emerald-400 shrink-0" />
                          <span>
                            {measureSubMode === 'area-pick'
                              ? 'Tap inside any closed polygon or room to get its area'
                              : `Tap 3+ points (OSNAP) to measure polygon area (${measurePts.length} pts)`}
                          </span>
                        </div>
                        {measurePts.length > 0 && (
                          <button
                            onClick={() => setMeasurePts([])}
                            className="text-[11px] underline text-slate-300"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Right Zoom Controls */}
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col gap-1.5 z-20">
                  <button
                    onClick={() => setZoom((z) => z * 1.3)}
                    className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-700 text-slate-200 hover:bg-slate-800 shadow-lg"
                    title="Zoom In"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setZoom((z) => z / 1.3)}
                    className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-700 text-slate-200 hover:bg-slate-800 shadow-lg"
                    title="Zoom Out"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <button
                    onClick={fitDrawing}
                    className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-700 text-slate-200 hover:bg-slate-800 shadow-lg"
                    title="Fit Plan to Screen"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Bottom Mobile-First Floating Tool Dock */}
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 bg-slate-900/95 backdrop-blur-md border border-slate-700/90 p-1.5 rounded-2xl shadow-2xl max-w-[96vw] overflow-x-auto">
                  <button
                    onClick={() => setToolMode('pan')}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition shrink-0 ${
                      toolMode === 'pan'
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <Hand className="w-3.5 h-3.5" />
                    <span>Pan</span>
                  </button>

                  <button
                    onClick={() => setToolMode((m) => (m === 'measure' ? 'pan' : 'measure'))}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition shrink-0 ${
                      toolMode === 'measure'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-900/60'
                    }`}
                  >
                    <Ruler className="w-3.5 h-3.5" />
                    <span>Measure</span>
                  </button>

                  <div className="h-5 w-px bg-slate-800 mx-0.5 shrink-0" />

                  {/* Drawing Unit Scale Selector */}
                  <select
                    value={unitScaleToM}
                    onChange={(e) => onChangeUnitScale(Number(e.target.value))}
                    className="bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-200 shrink-0"
                    title="Calibrate DWG Measurement Units"
                  >
                    {UNIT_OPTIONS.map((u) => (
                      <option key={u.label} value={u.scale}>
                        Unit: {u.label}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => setShowLayersSheet((v) => !v)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition shrink-0 ${
                      showLayersSheet ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>Layers ({layers.length})</span>
                  </button>

                  <button
                    onClick={() =>
                      setColorMode((c) => (c === 'cad' ? 'blueprint' : c === 'blueprint' ? 'mono' : 'cad'))
                    }
                    className="px-2.5 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800 uppercase shrink-0"
                    title="Cycle CAD Color Mode"
                  >
                    {colorMode}
                  </button>
                </div>

                {/* Slide-up Layer Drawer */}
                {showLayersSheet && (
                  <div className="absolute bottom-16 left-1/2 -translate-x-1/2 w-[92%] max-w-sm max-h-72 bg-slate-900/95 backdrop-blur-md border border-slate-700 rounded-2xl shadow-2xl z-30 flex flex-col overflow-hidden">
                    <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center justify-between">
                      <span className="text-xs font-bold text-white">
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
                          className="p-1 text-slate-400 hover:text-white"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="overflow-y-auto divide-y divide-slate-800/60 p-1.5">
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
                            className="w-full px-2.5 py-1.5 rounded-lg flex items-center justify-between hover:bg-slate-800/60 text-xs"
                          >
                            <div className="flex items-center gap-2 truncate">
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: lyr.color_hex || '#f8fafc' }}
                              />
                              <span className={`font-mono truncate ${visible ? 'text-slate-100' : 'text-slate-500 line-through'}`}>
                                {lyr.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[10px] text-slate-400">{lyr.entity_count}</span>
                              {visible ? (
                                <Eye className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <EyeOff className="w-3.5 h-3.5 text-slate-500" />
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
        )}

        {/* ASSOCIATED PDF VIEWPORT */}
        {(viewTab === 'pdf' || viewTab === 'split') && (
          <div className="flex-1 flex flex-col bg-slate-900 overflow-hidden">
            {plan.has_pdf ? (
              <>
                <div className="px-3 py-1.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 truncate text-slate-300">
                    <FileText className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="font-mono truncate">{plan.pdf_filename || 'Associated Plan.pdf'}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => pdfInputRef.current?.click()}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200"
                    >
                      Replace PDF
                    </button>
                    <a
                      href={apiUrl(`/api/plans/${plan.id}/file/pdf?share=${encodeURIComponent(plan.share_token || '')}`)}
                      target="_blank"
                      rel="noreferrer"
                      className="px-2 py-1 rounded bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 text-[11px] font-semibold"
                    >
                      Open Full Tab ↗
                    </a>
                  </div>
                </div>
                <iframe
                  src={`${apiUrl(`/api/plans/${plan.id}/file/pdf?share=${encodeURIComponent(plan.share_token || '')}`)}#view=FitH`}
                  title={plan.pdf_filename || plan.name}
                  className="flex-1 w-full h-full border-0 bg-slate-950"
                />
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
                  <FileText className="w-6 h-6 text-amber-400" />
                </div>
                <div className="space-y-1 max-w-sm">
                  <h3 className="text-sm font-bold text-white">No Associated PDF Uploaded Yet</h3>
                  <p className="text-xs text-slate-400">
                    Upload the associated PDF for this DWG. PlanVault will also match the PDF against the DWG sheets to keep only the matching view.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    onClick={() => pdfInputRef.current?.click()}
                    className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg"
                  >
                    <Upload className="w-4 h-4" />
                    Upload Associated PDF
                  </button>
                  {plan.has_dwg && (
                    <button
                      onClick={async () => {
                        setBusyAction('Generating matching PDF from cleaned DWG view...');
                        try {
                          await onGeneratePdf();
                        } finally {
                          setBusyAction(null);
                        }
                      }}
                      className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-2 border border-slate-700"
                    >
                      <Sparkles className="w-4 h-4 text-emerald-400" />
                      Auto-Generate PDF from Cleaned View
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sheet Metadata Edit Modal */}
      {editingSheetMeta && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Edit Sheet Name & Description</h3>
              <button
                onClick={() => setEditingSheetMeta(false)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Sheet Name</label>
              <input
                type="text"
                value={tempSheetName}
                onChange={(e) => setTempSheetName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                placeholder="e.g. Ground Floor Plan"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Description (What this view represents)
              </label>
              <textarea
                rows={3}
                value={tempSheetDesc}
                onChange={(e) => setTempSheetDesc(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-blue-500 resize-none"
                placeholder="e.g., Working plan showing room boundaries and external columns..."
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingSheetMeta(false)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 text-xs font-semibold text-slate-300 hover:bg-slate-700"
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
                className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white shadow"
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
