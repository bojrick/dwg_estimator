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
  Pencil,
  Check,
  FileSpreadsheet,
  ChevronDown,
  Bookmark,
  Trash2,
  CornerDownRight,
  Crosshair,
} from 'lucide-react';
import { PlanDiscipline, DISCIPLINES } from '../types/plan';

export type ViewerTabMode = 'dwg';
type ToolMode = 'pan' | 'measure';
type MeasureSubMode = 'distance' | 'area-pick' | 'area-points';
type ColorMode = 'cad' | 'blueprint' | 'mono';

export interface SavedMeasurement {
  id: string;
  name: string;
  type: 'distance' | 'area';
  subMode: 'distance' | 'area-pick' | 'area-points';
  sheetId?: string;
  points: [number, number][];
  rawUnits: number;
  formattedPrimary: string;
  formattedSecondary: string;
  metadata?: {
    deltaX?: number;
    deltaY?: number;
    perimeter?: string;
    color?: string;
  };
  createdAt: string;
}

interface DetectedAreaShape {
  pts: [number, number][];
  label: string;
}

export interface OtrackGuideInfo {
  type: 'single' | 'intersection';
  axis?: 'h' | 'v';
  coord?: number;
  label: string;
  snapOrigin?: [number, number];
  originH?: [number, number];
  originV?: [number, number];
  intersectionPt?: [number, number];
}

export interface AcquiredTrackPoint {
  id: string;
  pt: [number, number];
  acquiredAt: number;
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
  onUpdateMetadata?: (patch: { name?: string; sheets?: any[]; measurements?: any[] }) => Promise<void>;
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

  // Saved Measurements & Focus state
  const storageKey = `plan_measurements_${plan?.id || 'guest'}`;
  const [savedMeasurements, setSavedMeasurements] = useState<SavedMeasurement[]>(() => {
    if (Array.isArray(plan?.measurements) && plan.measurements.length > 0) {
      return plan.measurements;
    }
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw);
    } catch { }
    return [];
  });
  const [focusedMeasurementId, setFocusedMeasurementId] = useState<string | null>(null);
  const [showSavedDrawer, setShowSavedDrawer] = useState<boolean>(false);
  const [namingModal, setNamingModal] = useState<{
    type: 'distance' | 'area';
    subMode: 'distance' | 'area-pick' | 'area-points';
    defaultName: string;
    points: [number, number][];
    rawUnits: number;
    formattedPrimary: string;
    formattedSecondary: string;
    metadata?: {
      deltaX?: number;
      deltaY?: number;
      perimeter?: string;
    };
  } | null>(null);
  const [tempMeasureName, setTempMeasureName] = useState<string>('');
  const [editingMeasureId, setEditingMeasureId] = useState<string | null>(null);
  const [editingMeasureText, setEditingMeasureText] = useState<string>('');

  // Orthogonal Snapping & Guidelines state (AutoCAD Ortho F8 + Object Snap Tracking F11)
  const [isOrthoLocked, setIsOrthoLocked] = useState<boolean>(false);
  const [shiftKeyDown, setShiftKeyDown] = useState<boolean>(false);
  const [isOtrackEnabled, setIsOtrackEnabled] = useState<boolean>(true);
  const [acquiredTrackPoints, setAcquiredTrackPoints] = useState<AcquiredTrackPoint[]>([]);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSnapCandidateRef = useRef<[number, number] | null>(null);
  const [orthoGuideRay, setOrthoGuideRay] = useState<OtrackGuideInfo | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg((cur) => (cur === msg ? null : cur)), 2600);
  }, []);

  // Sync saved measurements from plan prop if updated
  useEffect(() => {
    if (Array.isArray(plan?.measurements)) {
      setSavedMeasurements(plan.measurements);
    }
  }, [plan?.measurements]);

  // Clean up hover timer on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  const persistSavedMeasurements = useCallback(
    (next: SavedMeasurement[]) => {
      setSavedMeasurements(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch { }
      if (onUpdateMetadata) {
        onUpdateMetadata({ measurements: next }).catch(() => { });
      }
    },
    [storageKey, onUpdateMetadata]
  );

  // Metadata editing state
  const [editingPlanTitle, setEditingPlanTitle] = useState(false);
  const [tempPlanTitle, setTempPlanTitle] = useState(plan.name || '');
  const [savingPlanTitle, setSavingPlanTitle] = useState(false);
  const [editingSheetMeta, setEditingSheetMeta] = useState(false);
  const [tempSheetName, setTempSheetName] = useState('');
  const [tempSheetDesc, setTempSheetDesc] = useState('');
  const [sheetPreviewUrl, setSheetPreviewUrl] = useState<string | null>(null);

  // Global key bindings: Shift for temp Ortho, F8 for Ortho lock, F11 for O-TRACK, Esc to exit focus / cancel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftKeyDown(true);
      if (e.key === 'F8') {
        e.preventDefault();
        setIsOrthoLocked((prev) => !prev);
      }
      if (e.key === 'F11') {
        e.preventDefault();
        setIsOtrackEnabled((prev) => {
          const next = !prev;
          showToast(`Object Snap Tracking (F11): ${next ? 'ON' : 'OFF'}`);
          return next;
        });
      }
      if (e.key === 'Escape') {
        if (editingPlanTitle) {
          setEditingPlanTitle(false);
        } else if (editingSheetMeta) {
          setEditingSheetMeta(false);
        } else if (showEstimatorMenu || showDownloadMenu) {
          setShowEstimatorMenu(false);
          setShowDownloadMenu(false);
        } else if (acquiredTrackPoints.length > 0) {
          setAcquiredTrackPoints([]);
          setOrthoGuideRay(null);
          showToast('Cleared tracking points');
        } else if (focusedMeasurementId) {
          setFocusedMeasurementId(null);
        } else if (namingModal) {
          setNamingModal(null);
        } else if (measurePts.length > 0) {
          setMeasurePts([]);
          setOrthoGuideRay(null);
        } else if (selectedAreaShape) {
          setSelectedAreaShape(null);
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftKeyDown(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    editingPlanTitle,
    editingSheetMeta,
    showEstimatorMenu,
    showDownloadMenu,
    focusedMeasurementId,
    namingModal,
    measurePts.length,
    selectedAreaShape,
    acquiredTrackPoints.length,
    showToast,
  ]);

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

  const resolveOrthoPoint = useCallback(
    (
      wx: number,
      wy: number,
      isTouch = false,
      precomputedSnap?: [number, number] | null
    ): {
      point: [number, number];
      rawSnap: [number, number] | null;
      guide: OtrackGuideInfo | null;
    } => {
      const rawSnap = precomputedSnap !== undefined ? precomputedSnap : findNearestSnapPoint(wx, wy, isTouch);
      if (measureSubMode === 'area-pick') {
        return { point: rawSnap || [wx, wy], rawSnap, guide: null };
      }

      // Collect tracking origins: acquired snap points + last placed measurement point
      const origins: [number, number][] = [];
      if (isOtrackEnabled) {
        for (const ap of acquiredTrackPoints) {
          origins.push(ap.pt);
        }
      }
      if (measurePts.length >= 1) {
        const p1 = measurePts[measurePts.length - 1];
        if (!origins.some((o) => Math.hypot(o[0] - p1[0], o[1] - p1[1]) < 1e-4)) {
          origins.push(p1);
        }
      }

      const cand = rawSnap || [wx, wy];
      if (origins.length === 0) {
        return { point: cand, rawSnap, guide: null };
      }

      const [scx, scy] = worldToScreen(cand[0], cand[1]);
      const orthoThresholdPx = isTouch ? 28 : 18;
      const forceOrtho = isOrthoLocked || shiftKeyDown;

      // 1. Dual-Ray Invisible Intersection Snapping (AutoCAD O-TRACK when >= 2 tracking origins exist)
      if (origins.length >= 2) {
        let bestIntersection: {
          pt: [number, number];
          originH: [number, number];
          originV: [number, number];
          distPx: number;
        } | null = null;

        for (let i = 0; i < origins.length; i++) {
          for (let j = i + 1; j < origins.length; j++) {
            const A = origins[i];
            const B = origins[j];

            // Intersection 1: Vertical from A (x=A[0]), Horizontal from B (y=B[1])
            if (Math.abs(A[0] - B[0]) > 1e-3 && Math.abs(A[1] - B[1]) > 1e-3) {
              const int1: [number, number] = [A[0], B[1]];
              const [isx1, isy1] = worldToScreen(int1[0], int1[1]);
              const d1 = Math.hypot(scx - isx1, scy - isy1);
              if (d1 <= orthoThresholdPx * 1.35 && (!bestIntersection || d1 < bestIntersection.distPx)) {
                bestIntersection = { pt: int1, originH: B, originV: A, distPx: d1 };
              }

              // Intersection 2: Horizontal from A (y=A[1]), Vertical from B (x=B[0])
              const int2: [number, number] = [B[0], A[1]];
              const [isx2, isy2] = worldToScreen(int2[0], int2[1]);
              const d2 = Math.hypot(scx - isx2, scy - isy2);
              if (d2 <= orthoThresholdPx * 1.35 && (!bestIntersection || d2 < bestIntersection.distPx)) {
                bestIntersection = { pt: int2, originH: A, originV: B, distPx: d2 };
              }
            }
          }
        }

        if (bestIntersection) {
          const { pt, originH, originV } = bestIntersection;
          const hAngle = pt[0] >= originH[0] ? 0 : 180;
          const vAngle = pt[1] >= originV[1] ? 90 : 270;
          return {
            point: pt,
            rawSnap,
            guide: {
              type: 'intersection',
              label: `Apparent Intersection · ${hAngle}° / ${vAngle}°`,
              originH,
              originV,
              intersectionPt: pt,
            },
          };
        }
      }

      // 2. Single-Ray Orthogonal Tracking (from any acquired point or active anchor)
      let bestRay: {
        pt: [number, number];
        axis: 'h' | 'v';
        coord: number;
        origin: [number, number];
        distPx: number;
        label: string;
      } | null = null;

      for (const origin of origins) {
        const [sox, soy] = worldToScreen(origin[0], origin[1]);
        const sdx = scx - sox;
        const sdy = scy - soy;
        const absSdx = Math.abs(sdx);
        const absSdy = Math.abs(sdy);

        const isNearH = forceOrtho ? absSdx >= absSdy : absSdy <= orthoThresholdPx;
        const isNearV = forceOrtho ? absSdy > absSdx : absSdx <= orthoThresholdPx;

        if (isNearH) {
          const pt: [number, number] = [cand[0], origin[1]];
          const distPx = absSdy;
          if (!bestRay || distPx < bestRay.distPx) {
            bestRay = {
              pt,
              axis: 'h',
              coord: origin[1],
              origin,
              distPx,
              label: `${cand[0] >= origin[0] ? 0 : 180}° · Ortho H`,
            };
          }
        } else if (isNearV) {
          const pt: [number, number] = [origin[0], cand[1]];
          const distPx = absSdx;
          if (!bestRay || distPx < bestRay.distPx) {
            bestRay = {
              pt,
              axis: 'v',
              coord: origin[0],
              origin,
              distPx,
              label: `${cand[1] >= origin[1] ? 90 : 270}° · Ortho V`,
            };
          }
        }
      }

      if (bestRay) {
        return {
          point: bestRay.pt,
          rawSnap,
          guide: {
            type: 'single',
            axis: bestRay.axis,
            coord: bestRay.coord,
            label: bestRay.label,
            snapOrigin: bestRay.origin,
          },
        };
      }

      return { point: cand, rawSnap, guide: null };
    },
    [
      findNearestSnapPoint,
      measurePts,
      measureSubMode,
      worldToScreen,
      isOrthoLocked,
      shiftKeyDown,
      isOtrackEnabled,
      acquiredTrackPoints,
    ]
  );

  const zoomToMeasurement = useCallback(
    (m: SavedMeasurement) => {
      if (!m.points || m.points.length === 0) return;
      setFocusedMeasurementId(m.id);

      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (const [x, y] of m.points) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const spanX = Math.max(0.6 / Math.max(unitScaleToM, 1e-6), maxX - minX);
      const spanY = Math.max(0.6 / Math.max(unitScaleToM, 1e-6), maxY - minY);

      const targetZoom = Math.max(
        1e-5,
        Math.min((canvasSize.w * 0.48) / spanX, (canvasSize.h * 0.48) / spanY, 8000)
      );

      const startCenter: [number, number] = [viewCenter[0], viewCenter[1]];
      const startZoom = zoom;
      const startTime = performance.now();
      const duration = 350;

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(1, elapsed / duration);
        const ease = 1 - Math.pow(1 - t, 3);
        const curX = startCenter[0] + (cx - startCenter[0]) * ease;
        const curY = startCenter[1] + (cy - startCenter[1]) * ease;
        const curZ = startZoom + (targetZoom - startZoom) * ease;
        setViewCenter([curX, curY]);
        setZoom(curZ);
        if (t < 1) {
          requestAnimationFrame(animate);
        }
      };
      requestAnimationFrame(animate);
    },
    [canvasSize.w, canvasSize.h, viewCenter, zoom, unitScaleToM]
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

    const isFocusActive = Boolean(focusedMeasurementId);
    if (isFocusActive) {
      ctx.save();
      ctx.globalAlpha = 0.16;
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

    if (isFocusActive) {
      ctx.restore();
    }

    // Saved Measurements Overlay
    if (savedMeasurements.length > 0) {
      ctx.save();
      for (const sm of savedMeasurements) {
        const isThisFocused = sm.id === focusedMeasurementId;
        if (isFocusActive && !isThisFocused) continue; // In focus mode, clearly show ONLY that measurement

        ctx.save();
        const color = sm.metadata?.color || (isThisFocused ? '#10b981' : '#34d399');
        if (sm.type === 'distance' && sm.points.length === 2) {
          const p1 = sm.points[0];
          const p2 = sm.points[1];
          const [sx1, sy1] = worldToScreen(p1[0], p1[1]);
          const [sx2, sy2] = worldToScreen(p2[0], p2[1]);

          ctx.strokeStyle = color;
          ctx.lineWidth = isThisFocused ? 3.5 : 2;
          ctx.beginPath();
          ctx.moveTo(sx1, sy1);
          ctx.lineTo(sx2, sy2);
          ctx.stroke();

          // End witness perpendicular ticks
          const ang = Math.atan2(sy2 - sy1, sx2 - sx1);
          const tickLen = isThisFocused ? 10 : 7;
          const cosP = Math.cos(ang + Math.PI / 2);
          const sinP = Math.sin(ang + Math.PI / 2);

          ctx.beginPath();
          ctx.moveTo(sx1 - cosP * tickLen, sy1 - sinP * tickLen);
          ctx.lineTo(sx1 + cosP * tickLen, sy1 + sinP * tickLen);
          ctx.moveTo(sx2 - cosP * tickLen, sy2 - sinP * tickLen);
          ctx.lineTo(sx2 + cosP * tickLen, sy2 + sinP * tickLen);
          ctx.stroke();

          // End vertices
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(sx1, sy1, isThisFocused ? 5.5 : 4, 0, Math.PI * 2);
          ctx.arc(sx2, sy2, isThisFocused ? 5.5 : 4, 0, Math.PI * 2);
          ctx.fill();

          // Badge
          const midX = (sx1 + sx2) / 2;
          const midY = (sy1 + sy2) / 2;
          const label = isThisFocused
            ? `${sm.name}: ${sm.formattedPrimary}`
            : `${sm.name} · ${sm.formattedPrimary}`;
          ctx.font = '700 12px ui-monospace, SFMono-Regular, monospace';
          const tw = ctx.measureText(label).width + 18;
          const bx = Math.max(8, Math.min(canvasSize.w - tw - 8, midX - tw / 2));
          const by = Math.max(toolMode === 'measure' ? 96 : 14, Math.min(canvasSize.h - 32, midY - 14));

          ctx.fillStyle = isThisFocused ? 'rgba(6, 78, 59, 0.98)' : 'rgba(15, 23, 42, 0.9)';
          ctx.fillRect(bx, by, tw, 24);
          ctx.strokeStyle = color;
          ctx.lineWidth = isThisFocused ? 2 : 1.2;
          ctx.strokeRect(bx, by, tw, 24);
          ctx.fillStyle = '#ecfdf5';
          ctx.fillText(label, bx + 9, by + 16);
        } else if (sm.points.length >= 3) {
          ctx.beginPath();
          const [sx0, sy0] = worldToScreen(sm.points[0][0], sm.points[0][1]);
          ctx.moveTo(sx0, sy0);
          for (let i = 1; i < sm.points.length; i++) {
            const [sxi, syi] = worldToScreen(sm.points[i][0], sm.points[i][1]);
            ctx.lineTo(sxi, syi);
          }
          ctx.closePath();
          ctx.fillStyle = isThisFocused ? 'rgba(16, 185, 129, 0.28)' : 'rgba(16, 185, 129, 0.12)';
          ctx.fill();
          ctx.strokeStyle = color;
          ctx.lineWidth = isThisFocused ? 3 : 1.8;
          ctx.stroke();

          const { centroid } = computePolygonAreaAndPerimeter(sm.points);
          const [cx, cy] = worldToScreen(centroid[0], centroid[1]);
          const label = isThisFocused
            ? `${sm.name}: ${sm.formattedPrimary}`
            : `${sm.name} · ${sm.formattedPrimary}`;
          ctx.font = '700 12px ui-monospace, SFMono-Regular, monospace';
          const tw = ctx.measureText(label).width + 18;
          const bx = Math.max(8, Math.min(canvasSize.w - tw - 8, cx - tw / 2));
          const by = Math.max(toolMode === 'measure' ? 96 : 14, Math.min(canvasSize.h - 32, cy - 14));

          ctx.fillStyle = isThisFocused ? 'rgba(6, 78, 59, 0.98)' : 'rgba(15, 23, 42, 0.9)';
          ctx.fillRect(bx, by, tw, 24);
          ctx.strokeStyle = color;
          ctx.lineWidth = isThisFocused ? 2 : 1.2;
          ctx.strokeRect(bx, by, tw, 24);
          ctx.fillStyle = '#ecfdf5';
          ctx.fillText(label, bx + 9, by + 16);
        }
        ctx.restore();
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

        // Draw AutoCAD F11 Acquired Object Snap Tracking Points (+)
        if (toolMode === 'measure' && isOtrackEnabled && acquiredTrackPoints.length > 0) {
          ctx.save();
          for (const ap of acquiredTrackPoints) {
            const [asx, asy] = worldToScreen(ap.pt[0], ap.pt[1]);
            // Subtle glowing ring
            ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(asx, asy, 8, 0, Math.PI * 2);
            ctx.stroke();

            // AutoCAD + glyph
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(asx - 5, asy);
            ctx.lineTo(asx + 5, asy);
            ctx.moveTo(asx, asy - 5);
            ctx.lineTo(asx, asy + 5);
            ctx.stroke();
          }
          ctx.restore();
        }

        // Draw Object Snap Guidelines (Single ray or Dual-ray Invisible Intersection)
        if (orthoGuideRay) {
          ctx.save();
          ctx.strokeStyle = '#06b6d4';
          ctx.lineWidth = 1.4;
          ctx.setLineDash([6, 5]);

          if (
            orthoGuideRay.type === 'intersection' &&
            orthoGuideRay.originH &&
            orthoGuideRay.originV &&
            orthoGuideRay.intersectionPt
          ) {
            const [hsx, hsy] = worldToScreen(orthoGuideRay.originH[0], orthoGuideRay.originH[1]);
            const [vsx, vsy] = worldToScreen(orthoGuideRay.originV[0], orthoGuideRay.originV[1]);
            const [isx, isy] = worldToScreen(orthoGuideRay.intersectionPt[0], orthoGuideRay.intersectionPt[1]);

            // Horizontal ray from originH to intersectionPt (and slightly beyond)
            const hDir = Math.sign(isx - hsx) || 1;
            ctx.beginPath();
            ctx.moveTo(hsx, isy);
            ctx.lineTo(isx + hDir * 36, isy);
            ctx.stroke();

            // Vertical ray from originV to intersectionPt (and slightly beyond)
            const vDir = Math.sign(isy - vsy) || 1;
            ctx.beginPath();
            ctx.moveTo(isx, vsy);
            ctx.lineTo(isx, isy + vDir * 36);
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw intersection glyph ⨁
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(isx, isy, 7, 0, Math.PI * 2);
            ctx.moveTo(isx - 10, isy);
            ctx.lineTo(isx + 10, isy);
            ctx.moveTo(isx, isy - 10);
            ctx.lineTo(isx, isy + 10);
            ctx.stroke();

            // Tooltip badge
            const txt = orthoGuideRay.label;
            ctx.font = '600 11px ui-monospace, SFMono-Regular, monospace';
            const tw = ctx.measureText(txt).width + 16;
            const bx = Math.min(canvasSize.w - tw - 8, Math.max(8, isx + 14));
            const by = Math.max(toolMode === 'measure' ? 96 : 14, Math.min(canvasSize.h - 32, isy - 24));
            ctx.fillStyle = 'rgba(8, 47, 73, 0.95)';
            ctx.fillRect(bx, by, tw, 22);
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1.3;
            ctx.strokeRect(bx, by, tw, 22);
            ctx.fillStyle = '#e0f2fe';
            ctx.fillText(txt, bx + 8, by + 15);
          } else {
            // Single ray guideline
            ctx.beginPath();
            if (orthoGuideRay.axis === 'h' && orthoGuideRay.coord !== undefined) {
              const [, gsy] = worldToScreen(0, orthoGuideRay.coord);
              ctx.moveTo(0, gsy);
              ctx.lineTo(canvasSize.w, gsy);
            } else if (orthoGuideRay.axis === 'v' && orthoGuideRay.coord !== undefined) {
              const [gsx] = worldToScreen(orthoGuideRay.coord, 0);
              ctx.moveTo(gsx, 0);
              ctx.lineTo(gsx, canvasSize.h);
            }
            ctx.stroke();
            ctx.setLineDash([]);

            // Angle badge near cursor/snap
            const liveTarget = snapPt || cursorWorld;
            if (liveTarget) {
              const [lx, ly] = worldToScreen(liveTarget[0], liveTarget[1]);
              const txt = orthoGuideRay.label;
              ctx.font = '600 11px ui-monospace, SFMono-Regular, monospace';
              const tw = ctx.measureText(txt).width + 14;
              const bx = Math.min(canvasSize.w - tw - 8, Math.max(8, lx + 12));
              const by = Math.max(toolMode === 'measure' ? 96 : 14, Math.min(canvasSize.h - 32, ly - 22));
              ctx.fillStyle = 'rgba(8, 47, 73, 0.95)';
              ctx.fillRect(bx, by, tw, 20);
              ctx.strokeStyle = '#38bdf8';
              ctx.lineWidth = 1.2;
              ctx.strokeRect(bx, by, tw, 20);
              ctx.fillStyle = '#e0f2fe';
              ctx.fillText(txt, bx + 7, by + 14);
            }

            if (orthoGuideRay.snapOrigin) {
              const [sox, soy] = worldToScreen(orthoGuideRay.snapOrigin[0], orthoGuideRay.snapOrigin[1]);
              ctx.strokeStyle = '#38bdf8';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(sox - 8, soy);
              ctx.lineTo(sox + 8, soy);
              ctx.moveTo(sox, soy - 8);
              ctx.lineTo(sox, soy + 8);
              ctx.stroke();
            }
          }
          ctx.restore();
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
    savedMeasurements,
    focusedMeasurementId,
    orthoGuideRay,
    isOtrackEnabled,
    acquiredTrackPoints,
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
    const resolved = resolveOrthoPoint(wx, wy, isTouch);
    const snapped = resolved.point;
    setSnapPt(snapped);
    setOrthoGuideRay(null);
    if (measureSubMode === 'area-points') {
      setMeasurePts((prev) => [...prev, snapped]);
    } else {
      setMeasurePts((prev) => {
        if (prev.length === 1) {
          setAcquiredTrackPoints([]);
          return [...prev, snapped];
        }
        return prev.length >= 2 ? [snapped] : [...prev, snapped];
      });
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
        setOrthoGuideRay(null);
        setHoverAreaShape(findClosedAreaAtPoint(wx, wy));
      } else {
        const rawSnap = findNearestSnapPoint(wx, wy, false);

        // AutoCAD F11 Object Snap Tracking: hover acquisition / release
        if (isOtrackEnabled && rawSnap) {
          const isSameSnap =
            activeSnapCandidateRef.current &&
            Math.abs(activeSnapCandidateRef.current[0] - rawSnap[0]) < 1e-4 &&
            Math.abs(activeSnapCandidateRef.current[1] - rawSnap[1]) < 1e-4;

          if (!isSameSnap) {
            activeSnapCandidateRef.current = rawSnap;
            if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = setTimeout(() => {
              setAcquiredTrackPoints((prev) => {
                const existingIdx = prev.findIndex(
                  (p) => Math.hypot(p.pt[0] - rawSnap[0], p.pt[1] - rawSnap[1]) < 1e-4
                );
                if (existingIdx >= 0) {
                  // Re-hovering an acquired point releases it
                  const updated = [...prev];
                  updated.splice(existingIdx, 1);
                  showToast('Released tracking point');
                  return updated;
                } else {
                  // Acquire point (up to 7 points)
                  const newPt: AcquiredTrackPoint = {
                    id: Math.random().toString(36).substring(2, 9),
                    pt: rawSnap,
                    acquiredAt: Date.now(),
                  };
                  showToast('Acquired tracking point (+)');
                  return [...prev.slice(-6), newPt];
                }
              });
            }, 300);
          }
        } else if (!rawSnap) {
          activeSnapCandidateRef.current = null;
          if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
          }
        }

        const resolved = resolveOrthoPoint(wx, wy, false, rawSnap);
        setSnapPt(resolved.point);
        setOrthoGuideRay(resolved.guide);
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
  const focusedMeasurement = savedMeasurements.find((m) => m.id === focusedMeasurementId);

  const handleCommitSave = () => {
    if (!namingModal) return;
    const name = tempMeasureName.trim() || namingModal.defaultName;
    const newM: SavedMeasurement = {
      id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      type: namingModal.type,
      subMode: namingModal.subMode,
      sheetId: plan?.active_sheet_id || 'all',
      points: namingModal.points,
      rawUnits: namingModal.rawUnits,
      formattedPrimary: namingModal.formattedPrimary,
      formattedSecondary: namingModal.formattedSecondary,
      metadata: namingModal.metadata,
      createdAt: new Date().toISOString(),
    };
    persistSavedMeasurements([...savedMeasurements, newM]);
    setNamingModal(null);
    setTempMeasureName('');
  };

  const canRenamePlan = Boolean(onUpdateMetadata && !isGuest);
  const openRenamePlanModal = () => {
    if (!canRenamePlan) return;
    setTempPlanTitle(plan.name || '');
    setEditingPlanTitle(true);
  };
  const hasGuestSaveCta = Boolean(isGuest && onSavePlan);
  const estimatorIsPrimary = !hasGuestSaveCta && Boolean(onOpenEstimator || onOpenStructuralEstimator);

  return (
    <div className="flex-1 flex flex-col bg-zinc-950 overflow-hidden relative">
      {toastMsg && (
        <div className="fixed top-[max(56px,calc(env(safe-area-inset-top)+48px))] left-1/2 -translate-x-1/2 z-50 bg-zinc-900/95 border border-zinc-700 text-zinc-100 text-xs font-medium px-3.5 py-2 rounded-lg flex items-center gap-2 pointer-events-none max-w-[92vw]">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="truncate">{toastMsg}</span>
        </div>
      )}
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

      {/* Header: row 1 = back, title, actions; row 2 = compact sheet selector strip */}
      <header className="bg-[#111315] border-b border-zinc-800 pt-[env(safe-area-inset-top)] shrink-0">
        <div className="px-2.5 sm:px-3.5 py-1.5 flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button
              type="button"
              onClick={onBack}
              className="w-9 h-9 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-zinc-100 flex items-center justify-center shrink-0 transition"
              title="Back to Plan Vault"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 min-w-0">
                <h2
                  onClick={canRenamePlan ? openRenamePlanModal : undefined}
                  className={`text-xs sm:text-sm font-medium text-zinc-100 truncate ${canRenamePlan ? 'cursor-pointer hover:text-white transition' : ''}`}
                  title={plan.name}
                >
                  {plan.name}
                </h2>
                {canRenamePlan && (
                  <button
                    type="button"
                    onClick={openRenamePlanModal}
                    className="p-1.5 rounded-md text-zinc-400 hover:text-amber-400 hover:bg-zinc-800 shrink-0 transition"
                    title="Rename plan"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="text-[10px] sm:text-[11px] font-mono text-zinc-400 truncate">
                {[isGuest ? 'Guest preview' : null, plan.project_name, plan.discipline].filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            {onOpenAuth && (
              <>
                <button
                  type="button"
                  onClick={() => onOpenAuth('signin')}
                  className="hidden sm:inline-flex items-center h-9 px-2.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 transition whitespace-nowrap"
                >
                  Sign In
                </button>
                {!isGuest && (
                  <button
                    type="button"
                    onClick={() => onOpenAuth('signup')}
                    className={`h-9 px-2.5 sm:px-3 rounded-lg text-xs font-medium transition whitespace-nowrap ${!hasGuestSaveCta && !estimatorIsPrimary
                        ? 'bg-zinc-100 hover:bg-white text-zinc-950'
                        : 'bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 hover:text-zinc-100'
                      }`}
                  >
                    Sign Up
                  </button>
                )}
              </>
            )}

            {hasGuestSaveCta && onSavePlan && (
              <button
                type="button"
                onClick={onSavePlan}
                className="h-9 flex items-center gap-1.5 px-2.5 sm:px-3 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-medium transition whitespace-nowrap shrink-0"
              >
                <Upload className="w-3.5 h-3.5 shrink-0" />
                <span className="sm:hidden">Save</span>
                <span className="hidden sm:inline">{onOpenAuth ? 'Sign Up & Save' : 'Save Plan'}</span>
              </button>
            )}

            {/* Multi-discipline Estimator Launcher */}
            {(onOpenEstimator || onOpenStructuralEstimator) && (
              <div className="relative">
                <div
                  className={`flex items-center h-9 rounded-lg overflow-hidden ${estimatorIsPrimary
                      ? 'bg-zinc-100 text-zinc-950'
                      : 'bg-zinc-900 border border-zinc-700 text-zinc-200'
                    }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setShowEstimatorMenu(false);
                      setShowDownloadMenu(false);
                      if (onOpenEstimator) {
                        onOpenEstimator(currentDiscipline);
                      } else if (onOpenStructuralEstimator) {
                        onOpenStructuralEstimator();
                      }
                    }}
                    className={`h-full flex items-center gap-1.5 px-2 sm:px-3 text-xs font-medium transition whitespace-nowrap ${estimatorIsPrimary
                        ? 'text-zinc-950 hover:bg-white'
                        : 'text-zinc-100 hover:bg-zinc-800'
                      }`}
                    title={`Open ${currentDisciplineInfo.estimatorLabel}`}
                  >
                    <FileSpreadsheet
                      className={`w-3.5 h-3.5 shrink-0 ${estimatorIsPrimary ? 'text-zinc-800' : 'text-amber-400'
                        }`}
                    />
                    <span className="hidden sm:inline">{currentDisciplineInfo.estimatorLabel}</span>
                    <span className="sm:hidden">Estimator</span>
                  </button>
                  {onOpenEstimator && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowDownloadMenu(false);
                        setShowEstimatorMenu((v) => !v);
                      }}
                      className={`h-full px-1.5 sm:px-2 flex items-center justify-center border-l transition ${estimatorIsPrimary
                          ? 'border-zinc-300 text-zinc-700 hover:bg-white hover:text-zinc-950'
                          : 'border-zinc-700/80 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
                        }`}
                      title="Switch discipline estimator"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {showEstimatorMenu && onOpenEstimator && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowEstimatorMenu(false)}
                    />
                    <div className="fixed inset-x-3 top-[calc(56px+env(safe-area-inset-top))] sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-1.5 sm:w-64 z-50 bg-zinc-900 border border-zinc-700/90 rounded-xl p-1.5 text-xs space-y-1">
                      <div className="px-2.5 py-1 text-[11px] font-mono text-zinc-400">
                        Select estimator
                      </div>
                      {DISCIPLINES.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => {
                            setShowEstimatorMenu(false);
                            onOpenEstimator(d.id);
                          }}
                          className={`w-full flex items-start gap-2.5 px-2.5 py-2 min-h-[40px] sm:min-h-0 rounded-lg text-left transition ${d.id === currentDiscipline
                              ? 'bg-amber-400/15 border border-amber-400/30 text-amber-200'
                              : 'hover:bg-zinc-800 border border-transparent text-zinc-300'
                            }`}
                        >
                          <FileSpreadsheet
                            className={`w-4 h-4 mt-0.5 shrink-0 ${d.id === currentDiscipline ? 'text-amber-400' : 'text-zinc-400'
                              }`}
                          />
                          <div>
                            <div className="font-medium text-zinc-200">{d.estimatorLabel}</div>
                            <div className="text-[11px] text-zinc-400 leading-tight">{d.estimatorDesc}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => onShare(plan)}
              className="w-9 h-9 md:w-auto md:px-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-zinc-100 text-xs font-medium flex items-center justify-center gap-1.5 transition shrink-0"
              title="Share plan"
            >
              <Share2 className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden md:inline">Share</span>
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowEstimatorMenu(false);
                  setShowDownloadMenu((v) => !v);
                }}
                className="w-9 h-9 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-zinc-100 flex items-center justify-center transition shrink-0"
                title="Download or Update Plan Files"
              >
                <Download className="w-4 h-4" />
              </button>
              {showDownloadMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowDownloadMenu(false)}
                  />
                  <div className="fixed inset-x-3 top-[calc(56px+env(safe-area-inset-top))] sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-1.5 sm:w-52 z-50 bg-zinc-900 border border-zinc-700/90 rounded-xl p-1.5 text-xs space-y-1">
                    {isGuest ? (
                      <div className="space-y-1">
                        <div className="px-3 py-2 text-[11px] text-zinc-400">
                          Sign up &amp; save to download CAD files
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setShowDownloadMenu(false);
                            dwgInputRef.current?.click();
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 min-h-[40px] sm:min-h-0 rounded-lg hover:bg-zinc-800 text-zinc-200 text-left"
                        >
                          <Upload className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span>Open another .DWG / .DXF</span>
                        </button>
                      </div>
                    ) : plan.has_dwg ? (
                      <>
                        <a
                          href={apiUrl(`/api/plans/${plan.id}/file/dxf?share=${encodeURIComponent(plan.share_token || '')}`)}
                          download
                          onClick={() => setShowDownloadMenu(false)}
                          className="flex items-center gap-2 px-3 py-2 min-h-[40px] sm:min-h-0 rounded-lg hover:bg-zinc-800 text-zinc-200"
                        >
                          <Download className="w-3.5 h-3.5 text-zinc-300 shrink-0" />
                          Download Cleaned .DXF
                        </a>
                        <a
                          href={apiUrl(`/api/plans/${plan.id}/file/dwg?share=${encodeURIComponent(plan.share_token || '')}`)}
                          download
                          onClick={() => setShowDownloadMenu(false)}
                          className="flex items-center gap-2 px-3 py-2 min-h-[40px] sm:min-h-0 rounded-lg hover:bg-zinc-800 text-zinc-200"
                        >
                          <Download className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          Download Original .DWG
                        </a>
                      </>
                    ) : (
                      <div className="px-3 py-2 text-zinc-400">No CAD file attached</div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {sheets.length > 0 && (
          <div className="px-2.5 sm:px-3.5 py-1 bg-zinc-950 border-t border-zinc-800/80 flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Layers className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              {sheets.length === 1 ? (
                <span
                  className="h-8 flex items-center text-xs text-zinc-200 truncate"
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
                  className="h-8 text-xs bg-zinc-900 border border-zinc-800 rounded-md px-2 text-zinc-200 flex-1 min-w-0 sm:flex-none sm:max-w-[280px] truncate focus:outline-none focus:border-amber-400"
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
            </div>

            {onUpdateMetadata && !isGuest && plan.active_sheet_id && plan.active_sheet_id !== 'all' && (
              <button
                type="button"
                onClick={() => {
                  const cur = sheets.find((s: any) => s.id === plan.active_sheet_id);
                  if (cur) {
                    setTempSheetName(cur.name || '');
                    setTempSheetDesc(cur.description || '');
                    try {
                      setSheetPreviewUrl(canvasRef.current ? canvasRef.current.toDataURL('image/png') : null);
                    } catch {
                      setSheetPreviewUrl(null);
                    }
                    setEditingSheetMeta(true);
                  }
                }}
                className="h-8 px-2.5 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-300 hover:text-zinc-100 flex items-center gap-1.5 shrink-0 transition"
                title="Edit current sheet name and description"
              >
                <Pencil className="w-3 h-3" />
                <span>Edit sheet</span>
              </button>
            )}
          </div>
        )}
      </header>

      {busyAction && (
        <div className="bg-zinc-900 border-b border-amber-400/25 px-4 py-1.5 text-xs text-amber-200 flex items-center justify-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span className="truncate">{busyAction}</span>
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
                className="px-4 py-2.5 min-h-[40px] rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-medium flex items-center gap-2 transition"
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
                className={`w-full h-full block touch-none select-none ${toolMode === 'measure' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
                  }`}
              />

              {/* Focused Measurement Mode Top Banner */}
              {focusedMeasurement && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2.5 bg-zinc-900/95 backdrop-blur-md border border-amber-400/40 px-3.5 py-2 rounded-xl max-w-[94vw]">
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-white truncate">
                      {focusedMeasurement.name}
                    </div>
                    <div className="text-[11px] font-mono text-amber-300 truncate tabular-nums">
                      {focusedMeasurement.formattedPrimary}{' '}
                      <span className="text-zinc-400">({focusedMeasurement.formattedSecondary})</span>
                    </div>
                  </div>
                  <div className="h-5 w-px bg-zinc-700 mx-0.5 shrink-0" />
                  <button
                    onClick={() => setFocusedMeasurementId(null)}
                    className="px-2.5 py-1.5 min-h-[36px] sm:min-h-0 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/60 text-xs font-medium text-zinc-200 transition shrink-0"
                    title="Exit focus and show all (Esc)"
                  >
                    Show All (Esc)
                  </button>
                </div>
              )}

              {/* Top Floating Measurement HUD Banner */}
              {toolMode === 'measure' && (
                <div className="absolute top-0 inset-x-0 z-20 bg-zinc-900/95 backdrop-blur-md border-b border-zinc-800 px-2.5 sm:px-3 py-2 space-y-1.5">
                  {/* Sub-mode switcher: Distance | Area: Pick Closed | Area: Points + Ortho lock */}
                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5">
                    <div className="grid grid-cols-3 gap-1 flex-1 min-w-[200px] bg-zinc-950 p-1 rounded-xl border border-zinc-800">
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
                            setOrthoGuideRay(null);
                          }}
                          className={`py-2 px-1.5 min-h-[36px] sm:min-h-0 rounded-lg text-[11px] font-medium transition active:scale-95 truncate ${measureSubMode === m.id
                            ? 'bg-amber-400 text-zinc-950'
                            : 'text-zinc-400 hover:text-zinc-200'
                            }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setIsOrthoLocked((v) => !v)}
                      className={`flex items-center gap-1 px-2.5 py-2 min-h-[38px] sm:min-h-0 rounded-xl text-[11px] font-medium transition active:scale-95 shrink-0 border ${isOrthoLocked
                        ? 'bg-amber-400/15 border-amber-400/40 text-amber-300'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                        }`}
                      title="Toggle Orthogonal Guidelines & Snapping (F8 or hold Shift)"
                    >
                      <CornerDownRight className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Ortho</span>
                      <span>{isOrthoLocked ? 'ON' : 'OFF'}</span>
                    </button>
                    <button
                      onClick={() => {
                        setIsOtrackEnabled((v) => {
                          const next = !v;
                          showToast(`Object Snap Tracking (F11): ${next ? 'ON' : 'OFF'}`);
                          return next;
                        });
                      }}
                      className={`flex items-center gap-1 px-2.5 py-2 min-h-[38px] sm:min-h-0 rounded-xl text-[11px] font-medium transition active:scale-95 shrink-0 border ${isOtrackEnabled
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                        }`}
                      title="Toggle AutoCAD Object Snap Tracking (F11) - Hover snap points to acquire tracking lines & invisible intersections"
                    >
                      <Crosshair className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">O-TRACK</span>
                      <span>{isOtrackEnabled ? 'ON' : 'OFF'}</span>
                    </button>
                    {acquiredTrackPoints.length > 0 && (
                      <button
                        onClick={() => {
                          setAcquiredTrackPoints([]);
                          setOrthoGuideRay(null);
                          showToast('Cleared tracking points');
                        }}
                        className="flex items-center gap-1 px-2 py-2 min-h-[38px] sm:min-h-0 rounded-xl text-[10px] font-mono bg-zinc-900 border border-zinc-700 text-emerald-300 hover:text-emerald-200 shrink-0"
                        title="Click or press Esc to clear acquired tracking points"
                      >
                        +{acquiredTrackPoints.length}
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {measureSubMode === 'distance' ? (
                    activeMeasureFormatted && measurePts.length === 2 ? (
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11px] font-medium text-zinc-400">
                            Measured distance (OSNAP & Ortho)
                          </div>
                          <div className="text-base sm:text-lg font-medium font-mono text-white tabular-nums truncate">
                            {activeMeasureFormatted.meters}{' '}
                            <span className="text-xs font-normal text-zinc-300">
                              ({activeMeasureFormatted.feetInches} | {activeMeasureFormatted.mm})
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-zinc-400 tabular-nums">
                            ΔX: {(Math.abs(measurePts[1][0] - measurePts[0][0]) * unitScaleToM).toFixed(3)}m · ΔY:{' '}
                            {(Math.abs(measurePts[1][1] - measurePts[0][1]) * unitScaleToM).toFixed(3)}m
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => {
                              const distCount = savedMeasurements.filter((m) => m.type === 'distance').length + 1;
                              const defName = `Span #${distCount} (${activeMeasureFormatted.primary})`;
                              setNamingModal({
                                type: 'distance',
                                subMode: 'distance',
                                defaultName: defName,
                                points: [measurePts[0], measurePts[1]],
                                rawUnits: activeMeasureDistance!,
                                formattedPrimary: activeMeasureFormatted.primary,
                                formattedSecondary: `${activeMeasureFormatted.feetInches} | ${activeMeasureFormatted.mm}`,
                                metadata: {
                                  deltaX: Number((Math.abs(measurePts[1][0] - measurePts[0][0]) * unitScaleToM).toFixed(3)),
                                  deltaY: Number((Math.abs(measurePts[1][1] - measurePts[0][1]) * unitScaleToM).toFixed(3)),
                                },
                              });
                              setTempMeasureName(defName);
                            }}
                            className="px-2.5 py-2 sm:py-1.5 min-h-[38px] sm:min-h-0 rounded-lg bg-zinc-100 hover:bg-white text-xs font-medium text-zinc-950 flex items-center gap-1 transition active:scale-95"
                            title="Save this measurement"
                          >
                            <Bookmark className="w-3.5 h-3.5" />
                            <span>Save</span>
                          </button>
                          <button
                            onClick={() => setMeasurePts([])}
                            className="px-2.5 py-2 sm:py-1.5 min-h-[38px] sm:min-h-0 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/60 text-xs font-medium text-zinc-200 shrink-0"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2 text-xs text-zinc-300">
                        <div className="flex items-center gap-2 min-w-0">
                          <Ruler className="w-4 h-4 text-amber-400 shrink-0" />
                          <span className="truncate">
                            {measurePts.length === 0
                              ? 'Tap 1st point on DWG to measure distance'
                              : 'Tap 2nd point to complete measurement (snaps to ortho)'}
                          </span>
                        </div>
                        {measurePts.length > 0 && (
                          <button
                            onClick={() => setMeasurePts([])}
                            className="text-[11px] text-amber-400 hover:underline shrink-0"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    )
                  ) : activeAreaFormatted ? (
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium text-zinc-400 truncate">
                          {measureSubMode === 'area-pick'
                            ? (selectedAreaShape || hoverAreaShape)?.label || 'Closed area'
                            : `Polygon area (${measurePts.length} pts)`}
                        </div>
                        <div className="text-base sm:text-lg font-medium font-mono text-white tabular-nums truncate">
                          {activeAreaFormatted.sqm}{' '}
                          <span className="text-xs font-normal text-zinc-300">
                            ({activeAreaFormatted.sqft}
                            {unitName === 'mm' ? ` | ${activeAreaFormatted.sqmm}` : ''})
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-zinc-400 tabular-nums">
                          Perimeter: {activeAreaFormatted.perim.meters} ({activeAreaFormatted.perim.feetInches})
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => {
                            const areaCount = savedMeasurements.filter((m) => m.type === 'area').length + 1;
                            const roomLabel = (selectedAreaShape || hoverAreaShape)?.label;
                            const defName = roomLabel
                              ? roomLabel.replace(/Closed Polyline |Hatch Area /i, '')
                              : `Area #${areaCount} (${activeAreaFormatted.sqm})`;
                            setNamingModal({
                              type: 'area',
                              subMode: measureSubMode,
                              defaultName: defName,
                              points: activeAreaPts,
                              rawUnits: activeAreaMetrics!.rawArea,
                              formattedPrimary: activeAreaFormatted.sqm,
                              formattedSecondary: `${activeAreaFormatted.sqft}${unitName === 'mm' ? ` | ${activeAreaFormatted.sqmm}` : ''}`,
                              metadata: {
                                perimeter: activeAreaFormatted.perim.meters,
                              },
                            });
                            setTempMeasureName(defName);
                          }}
                          className="px-2.5 py-2 sm:py-1.5 min-h-[38px] sm:min-h-0 rounded-lg bg-zinc-100 hover:bg-white text-xs font-medium text-zinc-950 flex items-center gap-1 transition active:scale-95"
                          title="Save this area measurement"
                        >
                          <Bookmark className="w-3.5 h-3.5" />
                          <span>Save</span>
                        </button>
                        {measureSubMode === 'area-points' && measurePts.length > 0 && (
                          <button
                            onClick={() => setMeasurePts((prev) => prev.slice(0, -1))}
                            className="px-2.5 py-2 sm:py-1.5 min-h-[38px] sm:min-h-0 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/60 text-[11px] font-medium text-zinc-200"
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
                          className="px-2.5 py-2 sm:py-1.5 min-h-[38px] sm:min-h-0 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/60 text-xs font-medium text-zinc-200"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2 text-xs text-zinc-300">
                      <div className="flex items-center gap-2 min-w-0">
                        <Ruler className="w-4 h-4 text-amber-400 shrink-0" />
                        <span className="truncate">
                          {measureSubMode === 'area-pick'
                            ? 'Tap inside any closed polygon or room to get its area'
                            : `Tap 3+ points (OSNAP) to measure polygon area (${measurePts.length} pts)`}
                        </span>
                      </div>
                      {measurePts.length > 0 && (
                        <button
                          onClick={() => setMeasurePts([])}
                          className="text-[11px] text-amber-400 hover:underline shrink-0"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Right Zoom Controls */}
              <div className="absolute right-2 bottom-[calc(76px+env(safe-area-inset-bottom))] flex flex-col gap-1.5 z-20">
                <button
                  onClick={() => setZoom((z) => z * 1.3)}
                  className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-zinc-900/95 border border-zinc-700/80 text-zinc-200 hover:bg-zinc-800 active:scale-95 transition"
                  title="Zoom In"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setZoom((z) => z / 1.3)}
                  className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-zinc-900/95 border border-zinc-700/80 text-zinc-200 hover:bg-zinc-800 active:scale-95 transition"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  onClick={fitDrawing}
                  className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-zinc-900/95 border border-zinc-700/80 text-zinc-200 hover:bg-zinc-800 active:scale-95 transition"
                  title="Fit Plan to Screen"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              </div>

              {/* Bottom Mobile-First Floating Tool Dock */}
              <div className="absolute bottom-[max(12px,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-20 overflow-x-auto no-scrollbar max-w-[96vw] flex items-center gap-1 bg-zinc-900/95 border border-zinc-700/90 p-1 rounded-xl">
                <button
                  onClick={() => setToolMode('pan')}
                  className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium transition shrink-0 active:scale-95 min-h-[40px] ${toolMode === 'pan'
                    ? 'bg-amber-400 text-zinc-950'
                    : 'text-zinc-300 hover:bg-zinc-800'
                    }`}
                >
                  <Hand className="w-3.5 h-3.5" />
                  <span>Pan</span>
                </button>

                <button
                  onClick={() => setToolMode((m) => (m === 'measure' ? 'pan' : 'measure'))}
                  className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium transition shrink-0 active:scale-95 min-h-[40px] ${toolMode === 'measure'
                    ? 'bg-amber-400 text-zinc-950'
                    : 'text-zinc-300 hover:bg-zinc-800'
                    }`}
                >
                  <Ruler className="w-3.5 h-3.5" />
                  <span>Measure</span>
                </button>

                <button
                  onClick={() => setShowSavedDrawer((v) => !v)}
                  className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium transition shrink-0 active:scale-95 min-h-[40px] ${showSavedDrawer
                    ? 'bg-zinc-100 text-zinc-950'
                    : savedMeasurements.length > 0
                      ? 'bg-zinc-950 text-amber-300 border border-amber-400/30 hover:bg-zinc-800'
                      : 'text-zinc-300 hover:bg-zinc-800'
                    }`}
                  title="View saved measurements"
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  <span className="tabular-nums">Saved ({savedMeasurements.length})</span>
                </button>

                <div className="h-5 w-px bg-zinc-800 mx-0.5 shrink-0" />

                {/* Drawing Unit Scale Selector */}
                <select
                  value={unitScaleToM}
                  onChange={(e) => onChangeUnitScale(Number(e.target.value))}
                  className="bg-zinc-950 border border-zinc-700/80 rounded-lg px-2 py-2 min-h-[40px] text-xs font-medium font-mono text-zinc-200 shrink-0 max-w-[72px] focus:outline-none focus:border-amber-400"
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
                  className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium transition shrink-0 active:scale-95 min-h-[40px] ${showLayersSheet ? 'bg-zinc-100 text-zinc-950' : 'text-zinc-300 hover:bg-zinc-800'
                    }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Layers</span>
                </button>

                <button
                  onClick={() =>
                    setColorMode((c) => (c === 'cad' ? 'blueprint' : c === 'blueprint' ? 'mono' : 'cad'))
                  }
                  className="px-2.5 py-2 rounded-lg min-h-[40px] text-xs font-medium font-mono text-zinc-300 hover:bg-zinc-800 shrink-0 capitalize"
                  title="Cycle CAD Color Mode"
                >
                  {colorMode}
                </button>
              </div>

              {/* Slide-up Layer Drawer */}
              {showLayersSheet && (
                <div className="absolute inset-x-2 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 bottom-[calc(64px+env(safe-area-inset-bottom))] max-h-[60dvh] w-auto sm:w-96 bg-zinc-900/95 backdrop-blur-md border border-zinc-700 rounded-xl z-30 flex flex-col overflow-hidden">
                  <div className="px-3.5 py-2.5 border-b border-zinc-800 flex items-center justify-between">
                    <span className="text-xs font-medium text-white">
                      Cleaned view layers ({layers.length})
                    </span>
                    <div className="flex items-center gap-2">
                      {hiddenLayers.size > 0 && (
                        <button
                          onClick={() => setHiddenLayers(new Set())}
                          className="text-[11px] text-amber-400 hover:text-amber-300 font-medium px-1.5 py-1"
                        >
                          Show All
                        </button>
                      )}
                      <button
                        onClick={() => setShowLayersSheet(false)}
                        className="p-1.5 min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white"
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
                          className="w-full px-2.5 py-2 sm:py-1.5 min-h-[40px] sm:min-h-0 rounded-lg flex items-center justify-between hover:bg-zinc-800/60 text-xs"
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
                            <span className="text-[11px] font-mono text-zinc-400 tabular-nums">{lyr.entity_count}</span>
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

              {/* Slide-up Saved Measurements Drawer */}
              {showSavedDrawer && (
                <div className="absolute inset-x-2 sm:inset-x-auto sm:right-6 bottom-[calc(64px+env(safe-area-inset-bottom))] max-h-[60dvh] w-auto sm:w-96 bg-zinc-900/95 backdrop-blur-md border border-zinc-700 rounded-xl z-40 flex flex-col overflow-hidden">
                  <div className="px-3.5 py-2.5 border-b border-zinc-800 flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <Bookmark className="w-4 h-4 text-amber-400 shrink-0" />
                      <span className="text-xs font-medium text-white truncate">
                        Saved measurements ({savedMeasurements.length})
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {savedMeasurements.length > 0 && (
                        <button
                          onClick={() => {
                            if (window.confirm('Clear all saved measurements?')) {
                              persistSavedMeasurements([]);
                              setFocusedMeasurementId(null);
                            }
                          }}
                          className="text-[11px] text-zinc-400 hover:text-red-400 transition px-1.5 py-1"
                        >
                          Clear All
                        </button>
                      )}
                      <button
                        onClick={() => setShowSavedDrawer(false)}
                        className="p-1.5 min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="overflow-y-auto divide-y divide-zinc-800/60 p-1.5 space-y-1">
                    {savedMeasurements.length === 0 ? (
                      <div className="py-8 text-center text-zinc-400 text-xs space-y-1">
                        <Bookmark className="w-6 h-6 mx-auto text-zinc-600" />
                        <p className="font-medium text-zinc-300">No saved measurements yet</p>
                        <p className="text-[11px] text-zinc-500 max-w-xs mx-auto">
                          Use the Measure tool to measure distances or room areas, then tap Save to keep them.
                        </p>
                      </div>
                    ) : (
                      savedMeasurements.map((m) => {
                        const isFocused = m.id === focusedMeasurementId;
                        const isEditing = m.id === editingMeasureId;
                        return (
                          <div
                            key={m.id}
                            className={`p-2.5 rounded-xl transition ${isFocused
                              ? 'bg-amber-400/10 border border-amber-400/35'
                              : 'hover:bg-zinc-800/60 border border-transparent'
                              }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-start gap-2 min-w-0 flex-1">
                                <span className="mt-0.5 p-1 rounded-lg bg-zinc-800 text-amber-400 shrink-0">
                                  {m.type === 'distance' ? (
                                    <Ruler className="w-3.5 h-3.5" />
                                  ) : (
                                    <Maximize2 className="w-3.5 h-3.5" />
                                  )}
                                </span>
                                <div className="min-w-0 flex-1">
                                  {isEditing ? (
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="text"
                                        value={editingMeasureText}
                                        onChange={(e) => setEditingMeasureText(e.target.value)}
                                        className="bg-zinc-950 border border-amber-400/70 rounded px-2 py-1 text-base sm:text-xs text-white focus:outline-none flex-1 min-w-0"
                                        autoFocus
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            persistSavedMeasurements(
                                              savedMeasurements.map((x) =>
                                                x.id === m.id
                                                  ? { ...x, name: editingMeasureText.trim() || x.name }
                                                  : x
                                              )
                                            );
                                            setEditingMeasureId(null);
                                          } else if (e.key === 'Escape') {
                                            setEditingMeasureId(null);
                                          }
                                        }}
                                      />
                                      <button
                                        onClick={() => {
                                          persistSavedMeasurements(
                                            savedMeasurements.map((x) =>
                                              x.id === m.id
                                                ? { ...x, name: editingMeasureText.trim() || x.name }
                                                : x
                                            )
                                          );
                                          setEditingMeasureId(null);
                                        }}
                                        className="p-1.5 rounded bg-zinc-100 text-zinc-950 shrink-0"
                                      >
                                        <Check className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-xs font-medium text-white truncate min-w-0">
                                        {m.name}
                                      </span>
                                      <button
                                        onClick={() => {
                                          setEditingMeasureId(m.id);
                                          setEditingMeasureText(m.name);
                                        }}
                                        className="p-1 text-zinc-500 hover:text-zinc-300 transition shrink-0"
                                        title="Rename measurement"
                                      >
                                        <Pencil className="w-3 h-3" />
                                      </button>
                                    </div>
                                  )}
                                  <div className="text-sm font-medium font-mono text-amber-300 mt-0.5 tabular-nums">
                                    {m.formattedPrimary}
                                  </div>
                                  <div className="text-[11px] font-mono text-zinc-400 truncate tabular-nums">
                                    {m.formattedSecondary}
                                    {m.metadata?.deltaX !== undefined && m.metadata?.deltaY !== undefined ? (
                                      <span> · ΔX:{m.metadata.deltaX}m · ΔY:{m.metadata.deltaY}m</span>
                                    ) : null}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={() => {
                                    zoomToMeasurement(m);
                                    if (window.innerWidth < 640) setShowSavedDrawer(false);
                                  }}
                                  className={`px-2.5 py-1.5 min-h-[36px] sm:min-h-0 rounded-lg text-xs font-medium transition ${isFocused
                                    ? 'bg-amber-400 text-zinc-950'
                                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                                    }`}
                                  title="Focus and zoom to measurement"
                                >
                                  Focus
                                </button>
                                <button
                                  onClick={() => {
                                    persistSavedMeasurements(savedMeasurements.filter((x) => x.id !== m.id));
                                    if (focusedMeasurementId === m.id) setFocusedMeasurementId(null);
                                  }}
                                  className="p-2 sm:p-1.5 min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-red-400 transition"
                                  title="Delete measurement"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Rename Plan Modal (matching home page RenamePlanModal) */}
      {editingPlanTitle && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setEditingPlanTitle(false)}
        >
          <div
            className="w-full sm:max-w-sm bg-zinc-900 border-t sm:border border-zinc-800 rounded-t-2xl sm:rounded-xl p-5 pb-[max(20px,env(safe-area-inset-bottom))] sm:pb-5 space-y-4 max-h-[90dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-zinc-100 flex items-center gap-2">
                <Pencil className="w-4 h-4 text-amber-400" />
                Rename plan
              </h3>
              <button
                type="button"
                onClick={() => setEditingPlanTitle(false)}
                className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition shrink-0"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const trimmed = tempPlanTitle.trim();
                if (!trimmed || savingPlanTitle) return;
                if (onUpdateMetadata && trimmed !== plan.name) {
                  setSavingPlanTitle(true);
                  try {
                    await onUpdateMetadata({ name: trimmed });
                  } finally {
                    setSavingPlanTitle(false);
                  }
                }
                setEditingPlanTitle(false);
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Plan display name
                </label>
                <input
                  type="text"
                  autoFocus
                  value={tempPlanTitle}
                  onChange={(e) => setTempPlanTitle(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700/80 rounded-lg px-3 py-2 min-h-[42px] text-base sm:text-xs text-zinc-100 focus:outline-none focus:border-amber-400"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingPlanTitle(false)}
                  className="px-4 min-h-[42px] rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!tempPlanTitle.trim() || savingPlanTitle}
                  className="px-4 min-h-[42px] rounded-lg bg-zinc-100 hover:bg-white disabled:opacity-50 text-xs font-medium text-zinc-950 transition"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sheet Metadata Edit Modal */}
      {editingSheetMeta && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setEditingSheetMeta(false)}
        >
          <div
            className="bg-zinc-900 border-t sm:border border-zinc-800 rounded-t-2xl sm:rounded-xl max-w-md w-full p-5 pb-[max(20px,env(safe-area-inset-bottom))] sm:pb-5 space-y-4 max-h-[90dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-zinc-100 flex items-center gap-2">
                <Pencil className="w-4 h-4 text-amber-400" />
                Edit sheet name & description
              </h3>
              <button
                type="button"
                onClick={() => setEditingSheetMeta(false)}
                className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-zinc-300">Sheet name</label>
              <input
                type="text"
                value={tempSheetName}
                onChange={(e) => setTempSheetName(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700/80 rounded-lg px-3 py-2 min-h-[42px] text-base sm:text-xs text-zinc-100 focus:outline-none focus:border-amber-400"
                placeholder="e.g. Ground Floor Plan"
              />
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
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Description (what this view represents)
              </label>
              <textarea
                rows={3}
                value={tempSheetDesc}
                onChange={(e) => setTempSheetDesc(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700/80 rounded-lg p-2.5 text-base sm:text-xs text-zinc-100 focus:outline-none focus:border-amber-400 resize-none"
                placeholder="e.g., Working plan showing room boundaries and external columns..."
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingSheetMeta(false)}
                className="px-4 min-h-[42px] rounded-lg bg-zinc-800 text-xs font-medium text-zinc-200 hover:bg-zinc-700 transition"
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
                className="px-4 min-h-[42px] rounded-lg bg-zinc-100 hover:bg-white text-xs font-medium text-zinc-950 transition"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Naming / Save Measurement Modal */}
      {namingModal && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setNamingModal(null)}
        >
          <div
            className="bg-zinc-900 border-t sm:border border-zinc-800 rounded-t-2xl sm:rounded-xl max-w-sm w-full p-5 pb-[max(20px,env(safe-area-inset-bottom))] sm:pb-5 space-y-3.5 max-h-[90dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-medium text-zinc-100">Save measurement</h3>
              </div>
              <button
                type="button"
                onClick={() => setNamingModal(null)}
                className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-zinc-950 border border-zinc-800/80 rounded-xl p-2.5">
              <div className="text-[11px] text-zinc-400">Measured value</div>
              <div className="text-base font-medium font-mono text-amber-300 tabular-nums">
                {namingModal.formattedPrimary}
              </div>
              <div className="text-[11px] font-mono text-zinc-400 tabular-nums">
                {namingModal.formattedSecondary}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-zinc-300">Measurement name</label>
              <input
                type="text"
                value={tempMeasureName}
                onChange={(e) => setTempMeasureName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCommitSave();
                  }
                }}
                className="w-full bg-zinc-950 border border-zinc-700/80 rounded-lg px-3 py-2 min-h-[42px] text-base sm:text-xs text-zinc-100 focus:outline-none focus:border-amber-400"
                placeholder={namingModal.defaultName}
                autoFocus
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setNamingModal(null)}
                className="px-4 min-h-[42px] rounded-lg bg-zinc-800 text-xs font-medium text-zinc-200 hover:bg-zinc-700 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCommitSave}
                className="px-4 min-h-[42px] rounded-lg bg-zinc-100 hover:bg-white text-xs font-medium text-zinc-950 transition"
              >
                Save Measurement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
