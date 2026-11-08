import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Layers,
  Ruler,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Eye,
  EyeOff,
  X,
  Check,
} from 'lucide-react';

export interface WorldBBox {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
  width?: number;
  height?: number;
}

export interface CadEstimatorCanvasProps {
  rawData: any; // Active cropped raw data (already cropped or full)
  sheets?: any[];
  activeSheetId: string;
  onSelectSheetId: (sheetId: string) => void;
  highlightedLayers?: string[];
  highlightedMark?: string | null;
  layoutBox?: WorldBBox | null;
  boxSelectLabel?: string | null; // When non-null, canvas enters box-select mode
  onBoxSelected?: (bbox: WorldBBox) => void;
  onCancelExternalTool?: () => void;
  twoPointPickLabel?: string | null; // When non-null, canvas enters 2-point span pick mode
  twoPointPickIsRect?: boolean; // When true, 2-point pick draws a live OSNAP rectangle (W × L = Area)
  singlePointPickLabel?: string | null; // When non-null, canvas displays banner and routes click to onClickWorld
  onTwoPointPicked?: (distMeters: number, p1: [number, number], p2: [number, number]) => void;
  onClickWorld?: (wx: number, wy: number) => boolean | void;
  renderCustomOverlay?: (
    ctx: CanvasRenderingContext2D,
    worldToScreen: (wx: number, wy: number) => [number, number],
    zoom: number
  ) => void;
  hiddenLayersExternal?: Set<string>;
  onChangeHiddenLayers?: (hidden: Set<string>) => void;
}

type MeasureMode = 'off' | 'distance' | 'area';

function polygonAreaWorld(pts: [number, number][]): number {
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) * 0.5;
}

export const CadEstimatorCanvas: React.FC<CadEstimatorCanvasProps> = ({
  rawData,
  sheets = [],
  activeSheetId,
  onSelectSheetId,
  highlightedLayers = [],
  highlightedMark = null,
  layoutBox = null,
  boxSelectLabel = null,
  onBoxSelected,
  onCancelExternalTool,
  twoPointPickLabel = null,
  twoPointPickIsRect = false,
  singlePointPickLabel = null,
  onTwoPointPicked,
  onClickWorld,
  renderCustomOverlay,
  hiddenLayersExternal,
  onChangeHiddenLayers,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({ w: 720, h: 520 });
  const [viewCenter, setViewCenter] = useState<[number, number]>([0, 0]);
  const [zoom, setZoom] = useState<number>(1);

  // Layer visibility state
  const [internalHiddenLayers, setInternalHiddenLayers] = useState<Set<string>>(new Set());
  const hiddenLayers = hiddenLayersExternal ?? internalHiddenLayers;
  const setHiddenLayers = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => {
      const next = updater(hiddenLayers);
      if (onChangeHiddenLayers) onChangeHiddenLayers(next);
      else setInternalHiddenLayers(next);
    },
    [hiddenLayers, onChangeHiddenLayers]
  );
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [layerFilter, setLayerFilter] = useState('');

  // Built-in Measure state (matches OpenCadViewer)
  const [measureMode, setMeasureMode] = useState<MeasureMode>('off');
  const [measurePts, setMeasurePts] = useState<[number, number][]>([]);
  const [cursorWorld, setCursorWorld] = useState<[number, number] | null>(null);
  const [snapPt, setSnapPt] = useState<[number, number] | null>(null);

  // External 2-point & box-marquee state
  const [pickFirstPt, setPickFirstPt] = useState<[number, number] | null>(null);
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  useEffect(() => {
    if (!twoPointPickLabel) setPickFirstPt(null);
  }, [twoPointPickLabel]);

  useEffect(() => {
    if (boxSelectLabel || twoPointPickLabel) {
      setMeasureMode('off');
      setMeasurePts([]);
    }
  }, [boxSelectLabel, twoPointPickLabel]);

  const unitScaleToM = Number(rawData?.scale_to_m) || 1.0;

  const layersList = useMemo<any[]>(() => {
    if (rawData?.layers && Array.isArray(rawData.layers) && rawData.layers.length > 0) {
      return rawData.layers;
    }
    const counts = new Map<string, { name: string; color: string; entity_count: number }>();
    const bump = (lname?: string, col?: string) => {
      const key = lname || '0';
      const cur = counts.get(key);
      if (cur) cur.entity_count++;
      else counts.set(key, { name: key, color: col || '#94a3b8', entity_count: 1 });
    };
    (rawData?.lines || []).forEach((e: any) => bump(e.layer, e.color));
    (rawData?.polylines || []).forEach((e: any) => bump(e.layer, e.color));
    (rawData?.arcs_circles || []).forEach((e: any) => bump(e.layer, e.color));
    (rawData?.texts || []).forEach((e: any) => bump(e.layer, e.color));
    return Array.from(counts.values()).sort((a, b) => b.entity_count - a.entity_count);
  }, [rawData]);

  const highlightedLayerSet = useMemo(
    () => new Set(highlightedLayers.map((l) => l.toUpperCase())),
    [highlightedLayers]
  );

  const isLayerVisible = useCallback(
    (layerName?: string) => !hiddenLayers.has(layerName || '0'),
    [hiddenLayers]
  );

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 20 && r.height > 20) {
        setCanvasSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const worldToScreen = useCallback(
    (wx: number, wy: number): [number, number] => [
      canvasSize.w / 2 + (wx - viewCenter[0]) * zoom,
      canvasSize.h / 2 - (wy - viewCenter[1]) * zoom,
    ],
    [canvasSize.w, canvasSize.h, viewCenter, zoom]
  );

  const screenToWorld = useCallback(
    (sx: number, sy: number): [number, number] => [
      viewCenter[0] + (sx - canvasSize.w / 2) / zoom,
      viewCenter[1] - (sy - canvasSize.h / 2) / zoom,
    ],
    [canvasSize.w, canvasSize.h, viewCenter, zoom]
  );

  const fitToView = useCallback(() => {
    const b = rawData?.bbox_raw || rawData?.bbox_full;
    if (!b) return;
    const bw = Math.max(b.width || Math.abs(b.max_x - b.min_x), 1e-3);
    const bh = Math.max(b.height || Math.abs(b.max_y - b.min_y), 1e-3);
    const pad = 28;
    const availW = Math.max(120, canvasSize.w - pad * 2);
    const availH = Math.max(120, canvasSize.h - pad * 2);
    const nextZoom = Math.max(1e-5, Math.min(availW / bw, availH / bh));
    setZoom(nextZoom);
    setViewCenter([(b.min_x + b.max_x) / 2, (b.min_y + b.max_y) / 2]);
  }, [rawData, canvasSize.w, canvasSize.h]);

  useEffect(() => {
    fitToView();
  }, [activeSheetId, rawData]);

  // OSNAP endpoint / midpoint / center finder for Measure & 2-point pick
  const findNearestSnap = useCallback(
    (wx: number, wy: number, isTouch = false): [number, number] | null => {
      if (!rawData) return null;
      const tol = (isTouch ? 32 : 16) / Math.max(zoom, 1e-6);
      let best: [number, number] | null = null;
      let bestD = tol;
      const check = (px: number, py: number, weight = 1) => {
        const d = Math.hypot(px - wx, py - wy) * weight;
        if (d < bestD) {
          bestD = d;
          best = [px, py];
        }
      };
      for (const ln of rawData.lines || []) {
        if (!isLayerVisible(ln.layer)) continue;
        check(ln.start[0], ln.start[1], 1);
        check(ln.end[0], ln.end[1], 1);
        check((ln.start[0] + ln.end[0]) / 2, (ln.start[1] + ln.end[1]) / 2, 1.35);
      }
      for (const pl of rawData.polylines || []) {
        if (!isLayerVisible(pl.layer) || !pl.points) continue;
        for (let i = 0; i < pl.points.length; i++) {
          check(pl.points[i][0], pl.points[i][1], 1);
        }
      }
      for (const ac of rawData.arcs_circles || []) {
        if (!isLayerVisible(ac.layer) || !ac.center) continue;
        check(ac.center[0], ac.center[1], 1.2);
      }
      return best;
    },
    [rawData, zoom, isLayerVisible]
  );

  // Main CAD render pass (matches OpenCadViewer settings + clean text LOD)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.w * dpr;
    canvas.height = canvasSize.h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, canvasSize.w, canvasSize.h);

    if (!rawData) return;

    const [wMinX, wMaxY] = screenToWorld(0, 0);
    const [wMaxX, wMinY] = screenToWorld(canvasSize.w, canvasSize.h);
    const padX = (wMaxX - wMinX) * 0.08;
    const padY = (wMaxY - wMinY) * 0.08;
    const cullMinX = wMinX - padX;
    const cullMaxX = wMaxX + padX;
    const cullMinY = wMinY - padY;
    const cullMaxY = wMaxY + padY;

    // Subtle CAD grid
    const rawStep = Math.pow(10, Math.floor(Math.log10(110 / Math.max(zoom, 1e-9))));
    const gridStep = rawStep * zoom < 40 ? rawStep * 5 : rawStep * zoom < 80 ? rawStep * 2 : rawStep;
    if (gridStep * zoom >= 20) {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.045)';
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

    const resolveColor = (colorHex?: string, layerName?: string) => {
      if (highlightedLayerSet.size > 0) {
        const isHi = highlightedLayerSet.has((layerName || '0').toUpperCase());
        if (isHi) return '#38bdf8';
        return 'rgba(113, 113, 122, 0.35)';
      }
      if (!colorHex || colorHex === '#000000' || colorHex === '#09090b') return '#d4d4d8';
      return colorHex;
    };

    // Hatches
    if (rawData.hatches) {
      ctx.save();
      ctx.globalAlpha = 0.14;
      for (const h of rawData.hatches) {
        if (!isLayerVisible(h.layer) || !h.points || h.points.length < 3) continue;
        const p0 = h.points[0];
        if (p0[0] < cullMinX || p0[0] > cullMaxX || p0[1] < cullMinY || p0[1] > cullMaxY) continue;
        ctx.fillStyle = resolveColor(h.color, h.layer);
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

    // Batched Lines
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
        const col = resolveColor(ln.color, ln.layer);
        let b = buckets.get(col);
        if (!b) {
          b = [];
          buckets.set(col, b);
        }
        b.push([x1, y1, x2, y2]);
      }
      for (const [col, segs] of buckets.entries()) {
        ctx.strokeStyle = col;
        ctx.lineWidth = col === '#38bdf8' ? 1.8 : 1.05;
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

    // Polylines
    if (rawData.polylines) {
      const polyBuckets = new Map<string, any[]>();
      for (const pl of rawData.polylines) {
        if (!isLayerVisible(pl.layer) || !pl.points || pl.points.length < 2) continue;
        const col = resolveColor(pl.color, pl.layer);
        let b = polyBuckets.get(col);
        if (!b) {
          b = [];
          polyBuckets.set(col, b);
        }
        b.push(pl);
      }
      for (const [col, pls] of polyBuckets.entries()) {
        ctx.strokeStyle = col;
        ctx.lineWidth = col === '#38bdf8' ? 1.8 : 1.05;
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

    // Arcs & Circles
    if (rawData.arcs_circles) {
      for (const ac of rawData.arcs_circles) {
        if (!isLayerVisible(ac.layer) || !ac.center) continue;
        const [cx, cy] = ac.center;
        const r = ac.radius || 0;
        if (cx + r < cullMinX || cx - r > cullMaxX || cy + r < cullMinY || cy - r > cullMaxY) continue;
        const sr = r * zoom;
        if (sr < 0.6) continue;
        const [sx, sy] = worldToScreen(cx, cy);
        const col = resolveColor(ac.color, ac.layer);
        ctx.strokeStyle = col;
        ctx.lineWidth = col === '#38bdf8' ? 1.8 : 1.05;
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

    // Texts with Clean LOD (identical to OpenCadViewer: never oversized when zoomed out)
    if (rawData.texts) {
      ctx.save();
      const markUpper = highlightedMark?.trim().toUpperCase() || null;
      for (const t of rawData.texts) {
        if (!isLayerVisible(t.layer)) continue;
        if (t.x < cullMinX || t.x > cullMaxX || t.y < cullMinY || t.y > cullMaxY) continue;
        const isMarkMatch =
          markUpper && String(t.text || '').trim().toUpperCase().includes(markUpper);
        const pxHeight = (t.height || 0.2) * zoom;
        if (!isMarkMatch && pxHeight < 7.5) continue;
        const [sx, sy] = worldToScreen(t.x, t.y);
        const fontPx = isMarkMatch ? Math.max(11, Math.min(26, pxHeight)) : Math.min(26, pxHeight);
        ctx.font = `${isMarkMatch || fontPx > 12 ? '600' : '400'} ${fontPx.toFixed(1)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.fillStyle = isMarkMatch ? '#38bdf8' : resolveColor(t.color, t.layer);
        if (t.rotation) {
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate((-t.rotation * Math.PI) / 180);
          ctx.fillText(t.text, 0, 0);
          ctx.restore();
        } else {
          ctx.fillText(t.text, sx, sy);
        }
        if (isMarkMatch) {
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(sx - 3, sy - fontPx, fontPx * String(t.text).length * 0.65 + 6, fontPx + 5);
        }
      }
      ctx.restore();
    }

    // Layout scan bounding box if present
    if (layoutBox) {
      const [sMinX, sMaxY] = worldToScreen(layoutBox.min_x, layoutBox.max_y);
      const [sMaxX, sMinY] = worldToScreen(layoutBox.max_x, layoutBox.min_y);
      ctx.save();
      ctx.fillStyle = 'rgba(16, 185, 129, 0.06)';
      ctx.fillRect(sMinX, sMinY, sMaxX - sMinX, sMaxY - sMinY);
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.strokeRect(sMinX, sMinY, sMaxX - sMinX, sMaxY - sMinY);
      ctx.restore();
    }

    // Custom discipline overlay (e.g. Structural cross-sections / member highlights)
    if (renderCustomOverlay) {
      ctx.save();
      renderCustomOverlay(ctx, worldToScreen, zoom);
      ctx.restore();
    }

    // 2-Point Span / Room Rectangle Pick preview
    if (twoPointPickLabel && pickFirstPt) {
      const [sx1, sy1] = worldToScreen(pickFirstPt[0], pickFirstPt[1]);
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(sx1, sy1, 5, 0, Math.PI * 2);
      ctx.fill();
      const target = snapPt || cursorWorld;
      if (target) {
        const [sx2, sy2] = worldToScreen(target[0], target[1]);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.8;
        ctx.setLineDash([5, 4]);
        if (twoPointPickIsRect) {
          const rx = Math.min(sx1, sx2);
          const ry = Math.min(sy1, sy2);
          const rw = Math.abs(sx2 - sx1);
          const rh = Math.abs(sy2 - sy1);
          ctx.fillStyle = 'rgba(245, 158, 11, 0.14)';
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeRect(rx, ry, rw, rh);
          ctx.setLineDash([]);
          const wM = Math.abs(target[0] - pickFirstPt[0]) * unitScaleToM;
          const hM = Math.abs(target[1] - pickFirstPt[1]) * unitScaleToM;
          const areaM2 = wM * hM;
          const label = `${wM.toFixed(2)}m × ${hM.toFixed(2)}m = ${areaM2.toFixed(2)} m²`;
          ctx.font = '600 11px ui-monospace, SFMono-Regular, monospace';
          const tw = ctx.measureText(label).width + 14;
          const bx = rx + rw / 2 - tw / 2;
          const by = ry + rh / 2 - 11;
          ctx.fillStyle = 'rgba(24, 24, 27, 0.92)';
          ctx.fillRect(bx, by, tw, 22);
          ctx.strokeStyle = '#f59e0b';
          ctx.strokeRect(bx, by, tw, 22);
          ctx.fillStyle = '#fde68a';
          ctx.fillText(label, bx + 7, by + 15);
        } else {
          ctx.beginPath();
          ctx.moveTo(sx1, sy1);
          ctx.lineTo(sx2, sy2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    // Marquee selection box
    if (marquee) {
      const rx = Math.min(marquee.x1, marquee.x2);
      const ry = Math.min(marquee.y1, marquee.y2);
      const rw = Math.abs(marquee.x2 - marquee.x1);
      const rh = Math.abs(marquee.y2 - marquee.y1);
      ctx.fillStyle = 'rgba(59, 130, 246, 0.14)';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
    }

    // Built-in Measure Overlay (Distance & Polygon Area with OSNAP)
    if (measureMode !== 'off' || twoPointPickLabel) {
      ctx.save();
      if (snapPt) {
        const [spx, spy] = worldToScreen(snapPt[0], snapPt[1]);
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 1.8;
        ctx.strokeRect(spx - 5, spy - 5, 10, 10);
      }

      const drawBadge = (sx: number, sy: number, label: string) => {
        ctx.font = '600 11px ui-monospace, SFMono-Regular, monospace';
        const tw = ctx.measureText(label).width + 14;
        const bx = Math.max(8, Math.min(canvasSize.w - tw - 8, sx - tw / 2));
        const by = Math.max(46, Math.min(canvasSize.h - 28, sy - 12));
        ctx.fillStyle = 'rgba(6, 78, 59, 0.94)';
        ctx.fillRect(bx, by, tw, 22);
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(bx, by, tw, 22);
        ctx.fillStyle = '#ecfdf5';
        ctx.fillText(label, bx + 7, by + 15);
      };

      if (measureMode === 'distance' && measurePts.length >= 1) {
        const p1 = measurePts[0];
        const p2 = measurePts.length >= 2 ? measurePts[1] : snapPt || cursorWorld;
        const [sx1, sy1] = worldToScreen(p1[0], p1[1]);
        ctx.fillStyle = '#34d399';
        ctx.beginPath();
        ctx.arc(sx1, sy1, 4.5, 0, Math.PI * 2);
        ctx.fill();
        if (p2) {
          const [sx2, sy2] = worldToScreen(p2[0], p2[1]);
          ctx.strokeStyle = '#34d399';
          ctx.lineWidth = 2;
          ctx.setLineDash(measurePts.length < 2 ? [5, 4] : []);
          ctx.beginPath();
          ctx.moveTo(sx1, sy1);
          ctx.lineTo(sx2, sy2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(sx2, sy2, 4.5, 0, Math.PI * 2);
          ctx.fill();
          const distM = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * unitScaleToM;
          drawBadge((sx1 + sx2) / 2, (sy1 + sy2) / 2, `${distM.toFixed(3)} m (${Math.round(distM * 1000)} mm)`);
        }
      } else if (measureMode === 'area' && measurePts.length >= 1) {
        const live = snapPt || cursorWorld;
        const pts = measurePts.length < 3 && live ? [...measurePts, live] : measurePts;
        ctx.beginPath();
        pts.forEach((pt, idx) => {
          const [sx, sy] = worldToScreen(pt[0], pt[1]);
          if (idx === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        if (pts.length >= 3) {
          ctx.closePath();
          ctx.fillStyle = 'rgba(16, 185, 129, 0.16)';
          ctx.fill();
        }
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 1.8;
        ctx.stroke();
        for (const pt of measurePts) {
          const [sx, sy] = worldToScreen(pt[0], pt[1]);
          ctx.fillStyle = '#34d399';
          ctx.beginPath();
          ctx.arc(sx, sy, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        if (pts.length >= 3) {
          const areaM2 = polygonAreaWorld(pts) * unitScaleToM * unitScaleToM;
          const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
          const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
          const [scx, scy] = worldToScreen(cx, cy);
          drawBadge(scx, scy, `${areaM2.toFixed(2)} m² (${(areaM2 * 10.7639).toFixed(1)} sq.ft)`);
        }
      }
      ctx.restore();
    }
  }, [
    rawData,
    canvasSize,
    viewCenter,
    zoom,
    hiddenLayers,
    highlightedLayerSet,
    highlightedMark,
    layoutBox,
    renderCustomOverlay,
    twoPointPickLabel,
    twoPointPickIsRect,
    pickFirstPt,
    marquee,
    measureMode,
    measurePts,
    cursorWorld,
    snapPt,
    unitScaleToM,
    worldToScreen,
    screenToWorld,
    isLayerVisible,
  ]);

  // Pointer & touch interactions
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

  const handlePointTrigger = (sx: number, sy: number, isTouch = false) => {
    const [rawWx, rawWy] = screenToWorld(sx, sy);
    const snapped = findNearestSnap(rawWx, rawWy, isTouch) || [rawWx, rawWy];

    if (twoPointPickLabel && onTwoPointPicked) {
      if (!pickFirstPt) {
        setPickFirstPt(snapped);
      } else {
        const distM = Math.hypot(snapped[0] - pickFirstPt[0], snapped[1] - pickFirstPt[1]) * unitScaleToM;
        onTwoPointPicked(distM, pickFirstPt, snapped);
        setPickFirstPt(null);
      }
      return;
    }

    if (measureMode === 'distance') {
      setMeasurePts((prev) => (prev.length === 0 || prev.length >= 2 ? [snapped] : [prev[0], snapped]));
      return;
    }
    if (measureMode === 'area') {
      setMeasurePts((prev) => [...prev, snapped]);
      return;
    }

    if (onClickWorld) {
      onClickWorld(rawWx, rawWy);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (boxSelectLabel) {
      setMarquee({ x1: sx, y1: sy, x2: sx, y2: sy });
      return;
    }

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

    if (boxSelectLabel && marquee) {
      setMarquee((prev) => (prev ? { ...prev, x2: sx, y2: sy } : null));
      return;
    }

    if (measureMode !== 'off' || twoPointPickLabel) {
      const [wx, wy] = screenToWorld(sx, sy);
      setCursorWorld([wx, wy]);
      setSnapPt(findNearestSnap(wx, wy, false));
    }

    if (dragRef.current.active) {
      const dx = sx - dragRef.current.startX;
      const dy = sy - dragRef.current.startY;
      if (Math.hypot(dx, dy) > 5) dragRef.current.moved = true;
      if (dragRef.current.moved) {
        setViewCenter([
          dragRef.current.startCenter[0] - dx / zoom,
          dragRef.current.startCenter[1] + dy / zoom,
        ]);
      }
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (boxSelectLabel && marquee) {
      const x1 = Math.min(marquee.x1, marquee.x2);
      const x2 = Math.max(marquee.x1, marquee.x2);
      const y1 = Math.min(marquee.y1, marquee.y2);
      const y2 = Math.max(marquee.y1, marquee.y2);
      setMarquee(null);
      if (x2 - x1 > 16 && y2 - y1 > 16 && onBoxSelected) {
        const [w1x, w1y] = screenToWorld(x1, y2);
        const [w2x, w2y] = screenToWorld(x2, y1);
        const min_x = Math.min(w1x, w2x);
        const max_x = Math.max(w1x, w2x);
        const min_y = Math.min(w1y, w2y);
        const max_y = Math.max(w1y, w2y);
        onBoxSelected({
          min_x,
          min_y,
          max_x,
          max_y,
          width: max_x - min_x,
          height: max_y - min_y,
        });
      }
      return;
    }

    const wasMoved = dragRef.current.moved;
    dragRef.current.active = false;
    if (!wasMoved) {
      handlePointTrigger(sx, sy, false);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const [wx, wy] = screenToWorld(sx, sy);
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    const nextZoom = Math.max(1e-5, Math.min(10000, zoom * factor));
    setZoom(nextZoom);
    setViewCenter([wx - (sx - canvasSize.w / 2) / nextZoom, wy + (sy - canvasSize.h / 2) / nextZoom]);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      dragRef.current = {
        active: true,
        moved: true,
        startX: 0,
        startY: 0,
        startCenter: [...viewCenter],
        pinchDist: Math.max(10, Math.hypot(dx, dy)),
        startZoom: zoom,
      };
    } else if (e.touches.length === 1) {
      if (e.touches[0].clientX <= 22) return;
      const sx = e.touches[0].clientX - rect.left;
      const sy = e.touches[0].clientY - rect.top;
      if (boxSelectLabel) {
        setMarquee({ x1: sx, y1: sy, x2: sx, y2: sy });
        return;
      }
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
    const rect = e.currentTarget.getBoundingClientRect();
    if (e.touches.length === 1 && boxSelectLabel && marquee) {
      const sx = e.touches[0].clientX - rect.left;
      const sy = e.touches[0].clientY - rect.top;
      setMarquee((prev) => (prev ? { ...prev, x2: sx, y2: sy } : null));
      return;
    }
    if (!dragRef.current.active) return;
    if (e.touches.length === 2 && dragRef.current.pinchDist) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.max(10, Math.hypot(dx, dy));
      setZoom(Math.max(1e-5, Math.min(10000, dragRef.current.startZoom * (dist / dragRef.current.pinchDist))));
      return;
    }
    if (e.touches.length === 1) {
      const sx = e.touches[0].clientX - rect.left;
      const sy = e.touches[0].clientY - rect.top;
      const dx = sx - dragRef.current.startX;
      const dy = sy - dragRef.current.startY;
      if (Math.hypot(dx, dy) > 12) dragRef.current.moved = true;
      if (dragRef.current.moved) {
        setViewCenter([
          dragRef.current.startCenter[0] - dx / zoom,
          dragRef.current.startCenter[1] + dy / zoom,
        ]);
      }
    }
  };

  const handleTouchEnd = () => {
    if (boxSelectLabel && marquee) {
      const x1 = Math.min(marquee.x1, marquee.x2);
      const x2 = Math.max(marquee.x1, marquee.x2);
      const y1 = Math.min(marquee.y1, marquee.y2);
      const y2 = Math.max(marquee.y1, marquee.y2);
      setMarquee(null);
      if (x2 - x1 > 16 && y2 - y1 > 16 && onBoxSelected) {
        const [w1x, w1y] = screenToWorld(x1, y2);
        const [w2x, w2y] = screenToWorld(x2, y1);
        const min_x = Math.min(w1x, w2x);
        const max_x = Math.max(w1x, w2x);
        const min_y = Math.min(w1y, w2y);
        const max_y = Math.max(w1y, w2y);
        onBoxSelected({ min_x, min_y, max_x, max_y, width: max_x - min_x, height: max_y - min_y });
      }
      return;
    }
    if (!dragRef.current.active) return;
    const wasMoved = dragRef.current.moved;
    const sx = dragRef.current.startX;
    const sy = dragRef.current.startY;
    dragRef.current.active = false;
    if (!wasMoved) {
      handlePointTrigger(sx, sy, true);
    }
  };

  const measuredDistM =
    measureMode === 'distance' && measurePts.length === 2
      ? Math.hypot(measurePts[1][0] - measurePts[0][0], measurePts[1][1] - measurePts[0][1]) * unitScaleToM
      : null;

  const measuredAreaM2 =
    measureMode === 'area' && measurePts.length >= 3
      ? polygonAreaWorld(measurePts) * unitScaleToM * unitScaleToM
      : null;

  const filteredLayers = layersList.filter((l) =>
    !layerFilter.trim() ? true : String(l.name).toLowerCase().includes(layerFilter.toLowerCase())
  );

  const isCrosshair = Boolean(
    boxSelectLabel || twoPointPickLabel || singlePointPickLabel || measureMode !== 'off'
  );

  return (
    <div className="w-full h-full flex flex-col relative bg-zinc-950 select-none">
      {/* Top Toolbar: Sheet Dropdown + Measure + Layers + Zoom */}
      <div className="h-9 px-2.5 bg-zinc-950 border-b border-zinc-800/80 flex items-center justify-between gap-2 text-xs shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {sheets.length > 0 ? (
            <>
              <span className="text-[11px] text-zinc-400 shrink-0 hidden sm:inline">Sheet:</span>
              <select
                value={activeSheetId}
                onChange={(e) => onSelectSheetId(e.target.value)}
                className="bg-zinc-900 hover:bg-zinc-800/90 text-zinc-100 text-[11px] font-medium rounded-lg px-2.5 py-1 border border-zinc-700/80 focus:outline-none focus:border-amber-400 max-w-[210px] sm:max-w-[320px] truncate transition-colors"
                title="Select drawing sheet for takeoff scope"
              >
                {sheets.map((s: any, idx: number) => (
                  <option key={s.id || idx} value={s.id}>
                    {idx + 1}. {s.name || `Sheet ${idx + 1}`}
                  </option>
                ))}
                <option value="all">All Sheets Combined ({sheets.length})</option>
              </select>
            </>
          ) : (
            <span className="text-zinc-400 text-[11px] px-1">Full Drawing Modelspace</span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => {
              if (measureMode === 'off') {
                onCancelExternalTool?.();
                setMeasureMode('distance');
                setMeasurePts([]);
              } else {
                setMeasureMode('off');
                setMeasurePts([]);
              }
            }}
            className={`px-2 py-1 rounded flex items-center gap-1 text-[11px] font-medium transition ${
              measureMode !== 'off'
                ? 'bg-emerald-600 text-white'
                : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
            }`}
            title="Measure distance & area on CAD drawing (OSNAP)"
          >
            <Ruler className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Measure</span>
          </button>

          <button
            type="button"
            onClick={() => setShowLayerPanel((v) => !v)}
            className={`px-2 py-1 rounded flex items-center gap-1 text-[11px] font-medium transition ${
              showLayerPanel || hiddenLayers.size > 0
                ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
            }`}
            title="Inspect & filter CAD layers"
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Layers</span>
          </button>

          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(10000, z * 1.25))}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
            title="Zoom in"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(1e-5, z * 0.8))}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
            title="Zoom out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={fitToView}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
            title="Fit drawing"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Canvas Viewport */}
      <div ref={containerRef} className="flex-1 w-full h-full relative overflow-hidden">
        {/* Native iOS left-edge swipe guard */}
        <div className="absolute inset-y-0 left-0 w-5 z-10 sm:hidden" />

        {/* Built-in Measure HUD */}
        {measureMode !== 'off' && (
          <div className="absolute top-2.5 inset-x-2.5 z-20 bg-zinc-900/95 border border-zinc-700/80 rounded-xl px-3 py-2 flex flex-wrap items-center justify-between gap-2 shadow-xl text-xs">
            <div className="flex items-center gap-1 bg-zinc-950 p-0.5 rounded-lg border border-zinc-800">
              <button
                type="button"
                onClick={() => {
                  setMeasureMode('distance');
                  setMeasurePts([]);
                }}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                  measureMode === 'distance' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Distance
              </button>
              <button
                type="button"
                onClick={() => {
                  setMeasureMode('area');
                  setMeasurePts([]);
                }}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                  measureMode === 'area' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Polygon Area
              </button>
            </div>

            <div className="font-mono text-[11px] text-emerald-300">
              {measureMode === 'distance' ? (
                measuredDistM !== null ? (
                  <span>
                    <strong>{measuredDistM.toFixed(3)} m</strong> · {(measuredDistM * 3.28084).toFixed(2)} ft · ΔX:{' '}
                    {(Math.abs(measurePts[1][0] - measurePts[0][0]) * unitScaleToM).toFixed(2)}m ΔY:{' '}
                    {(Math.abs(measurePts[1][1] - measurePts[0][1]) * unitScaleToM).toFixed(2)}m
                  </span>
                ) : (
                  <span className="text-zinc-300">
                    {measurePts.length === 0 ? 'Click 1st point (OSNAP)' : 'Click 2nd point'}
                  </span>
                )
              ) : measuredAreaM2 !== null ? (
                <span>
                  <strong>{measuredAreaM2.toFixed(2)} m²</strong> · {(measuredAreaM2 * 10.7639).toFixed(1)} sq.ft ({measurePts.length} pts)
                </span>
              ) : (
                <span className="text-zinc-300">Click 3+ corner points ({measurePts.length} pts)</span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {measurePts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMeasurePts([])}
                  className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] text-zinc-200"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setMeasureMode('off');
                  setMeasurePts([]);
                }}
                className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* External Box / 2-Point / Single-Point Tool Banner */}
        {(boxSelectLabel || twoPointPickLabel || singlePointPickLabel) && (
          <div className="absolute top-2.5 left-2.5 z-20 px-3 py-1.5 rounded-lg bg-amber-400 text-zinc-950 text-[11px] font-medium flex items-center gap-2 shadow-lg">
            <span>{boxSelectLabel || twoPointPickLabel || singlePointPickLabel}</span>
            {onCancelExternalTool && (
              <button
                type="button"
                onClick={() => {
                  setPickFirstPt(null);
                  setMarquee(null);
                  onCancelExternalTool();
                }}
                className="underline text-[10px] font-semibold"
              >
                Cancel
              </button>
            )}
          </div>
        )}

        {/* Layer Visibility Popover */}
        {showLayerPanel && (
          <div className="absolute top-2.5 right-2.5 z-30 w-64 max-h-[75%] bg-zinc-900/95 backdrop-blur-md border border-zinc-700 rounded-xl shadow-2xl flex flex-col overflow-hidden">
            <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
              <span className="text-xs font-medium text-white">CAD Layers ({layersList.length})</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setHiddenLayers(() => new Set())}
                  className="text-[10px] text-blue-400 hover:text-blue-300"
                >
                  All On
                </button>
                <span className="text-zinc-700">·</span>
                <button
                  type="button"
                  onClick={() => setHiddenLayers(() => new Set(layersList.map((l) => l.name)))}
                  className="text-[10px] text-zinc-400 hover:text-zinc-200"
                >
                  All Off
                </button>
                <button
                  type="button"
                  onClick={() => setShowLayerPanel(false)}
                  className="p-0.5 text-zinc-400 hover:text-white ml-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="p-2 border-b border-zinc-800">
              <input
                type="text"
                value={layerFilter}
                onChange={(e) => setLayerFilter(e.target.value)}
                placeholder="Filter layers..."
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-[11px] text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/50">
              {filteredLayers.map((lyr) => {
                const visible = !hiddenLayers.has(lyr.name);
                return (
                  <button
                    key={lyr.name}
                    type="button"
                    onClick={() =>
                      setHiddenLayers((prev) => {
                        const next = new Set(prev);
                        if (next.has(lyr.name)) next.delete(lyr.name);
                        else next.add(lyr.name);
                        return next;
                      })
                    }
                    className="w-full px-3 py-1.5 flex items-center justify-between gap-2 hover:bg-zinc-800/60 text-left text-[11px]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-xs shrink-0"
                        style={{ backgroundColor: lyr.color || '#94a3b8' }}
                      />
                      <span className={`truncate ${visible ? 'text-zinc-200' : 'text-zinc-500 line-through'}`}>
                        {lyr.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] font-mono text-zinc-500">{lyr.entity_count}</span>
                      {visible ? (
                        <Eye className="w-3 h-3 text-zinc-400" />
                      ) : (
                        <EyeOff className="w-3 h-3 text-zinc-600" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

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
            isCrosshair ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
          }`}
        />
      </div>
    </div>
  );
};

