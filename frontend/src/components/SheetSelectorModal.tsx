import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Maximize2,
  ZoomIn,
  ZoomOut,
  Plus,
  Trash2,
  Check,
  X,
  FileCode2,
  Square,
  Eye,
  Layers,
  Files,
  CheckSquare,
} from 'lucide-react';
import { AiBadge } from './ui/AiBadge';
import { authFetch } from '../auth';

export interface SheetConfig {
  id: string;
  name: string;
  description: string;
  file_id?: string;
  source_file?: string;
  bbox: {
    min_x: number;
    min_y: number;
    max_x: number;
    max_y: number;
    width: number;
    height: number;
  };
  is_custom_window?: boolean;
}

export interface CadFileInfo {
  fileId: string;
  filename: string;
  name?: string;
  rawData: any;
  sheets?: any[];
  scaleToM?: number;
  unitName?: string;
}

interface SheetSelectorModalProps {
  planTitle: string;
  dwgFilename: string;
  rawData: any;
  initialSheets?: any[];
  filesData?: CadFileInfo[];
  onConfirm: (data: {
    planTitle: string;
    sheets: SheetConfig[];
    activeSheetId: string;
  }) => void;
  onCancel: () => void;
}

export const SheetSelectorModal: React.FC<SheetSelectorModalProps> = ({
  planTitle: initialPlanTitle,
  dwgFilename,
  rawData,
  initialSheets = [],
  filesData,
  onConfirm,
  onCancel,
}) => {
  const hasMultipleFiles = Boolean(filesData && filesData.length > 1);

  const normalizedFiles = filesData?.map((f: any, idx: number) => ({
    ...f,
    fileId: f.fileId || f.file_id || `file_${idx}`,
    rawData: f.rawData || f.raw_data,
  }));

  // Active file being inspected
  const [activeFileId, setActiveFileId] = useState<string>(() => {
    return normalizedFiles && normalizedFiles[0] ? normalizedFiles[0].fileId : 'file_0';
  });

  const activeFileInfo = hasMultipleFiles
    ? normalizedFiles?.find((f) => f.fileId === activeFileId) || normalizedFiles?.[0]
    : null;

  const currentRawData = activeFileInfo ? activeFileInfo.rawData : rawData;
  const currentFilename = activeFileInfo ? activeFileInfo.filename : dwgFilename;

  const [planTitle, setPlanTitle] = useState(
    initialPlanTitle || dwgFilename.replace(/\.[^/.]+$/, '')
  );

  // Initialize sheets from auto-detected sheets or modelspace bbox
  const [sheets, setSheets] = useState<SheetConfig[]>(() => {
    if (hasMultipleFiles && normalizedFiles) {
      const all: SheetConfig[] = [];
      normalizedFiles.forEach((f, fIdx) => {
        const fid = f.fileId;
        if (f.sheets && f.sheets.length > 0) {
          f.sheets.forEach((s: any, sIdx: number) => {
            const rawId = s.id || `sheet_${sIdx + 1}`;
            const uniqueId = String(rawId).startsWith(`${fid}__`) ? rawId : `${fid}__${rawId}`;
            all.push({
              id: uniqueId,
              name: s.name || `${f.name || f.filename} - Sheet ${sIdx + 1}`,
              description: s.description || '',
              file_id: fid,
              source_file: f.filename,
              bbox: { ...s.bbox },
              is_custom_window: false,
            });
          });
        } else {
          const b = f.rawData?.bbox_raw || { min_x: 0, min_y: 0, max_x: 100, max_y: 100, width: 100, height: 100 };
          all.push({
            id: `${fid}__sheet_1`,
            name: `${f.name || f.filename} View`,
            description: `Full view from ${f.filename}`,
            file_id: fid,
            source_file: f.filename,
            bbox: {
              min_x: b.min_x,
              min_y: b.min_y,
              max_x: b.max_x,
              max_y: b.max_y,
              width: b.width || Math.abs(b.max_x - b.min_x),
              height: b.height || Math.abs(b.max_y - b.min_y),
            },
            is_custom_window: false,
          });
        }
      });
      return all;
    }

    if (initialSheets && initialSheets.length > 0) {
      return initialSheets.map((s, idx) => ({
        id: s.id || `sheet_${idx + 1}`,
        name: s.name || `Sheet ${idx + 1}`,
        description: s.description || (s.title ? `${s.title} ${s.subtitle || ''}`.trim() : ''),
        file_id: 'file_0',
        source_file: dwgFilename,
        bbox: { ...s.bbox },
        is_custom_window: false,
      }));
    }

    const b = rawData?.bbox_raw || { min_x: 0, min_y: 0, max_x: 100, max_y: 100, width: 100, height: 100 };
    return [
      {
        id: 'sheet_1',
        name: 'Main Plan View',
        description: 'Primary DWG floor plan view',
        file_id: 'file_0',
        source_file: dwgFilename,
        bbox: {
          min_x: b.min_x,
          min_y: b.min_y,
          max_x: b.max_x,
          max_y: b.max_y,
          width: b.width || Math.abs(b.max_x - b.min_x),
          height: b.height || Math.abs(b.max_y - b.min_y),
        },
        is_custom_window: false,
      },
    ];
  });

  const [activeSheetId, setActiveSheetId] = useState<string>(() => {
    return (sheets && sheets[0]?.id) || 'sheet_1';
  });

  // Selection state: user selects which sheets to KEEP and which to DISCARD (removes clutter)
  const [selectedSheetIds, setSelectedSheetIds] = useState<Set<string>>(() => {
    if (sheets.length <= 1) {
      return new Set(sheets.map((s) => s.id));
    }
    // Default to keeping sheet 1 so user starts with clean focus, not 22 cluttered sheets
    return new Set([sheets[0].id]);
  });

  const activeSheet = sheets.find((s) => s.id === activeSheetId) || sheets[0] || null;

  // Canvas state
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewCenter, setViewCenter] = useState<[number, number]>([0, 0]);
  const [zoom, setZoom] = useState<number>(1);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({ w: 800, h: 600 });
  const [viewingFullDrawing, setViewingFullDrawing] = useState<boolean>(false);

  // Mode: 'pan' or 'draw-window'
  const [mode, setMode] = useState<'pan' | 'draw-window'>('pan');
  const [isAiCleaning, setIsAiCleaning] = useState(false);
  const [sheetSuggestions, setSheetSuggestions] = useState<Record<string, string>>({});
  const [suggestingIds, setSuggestingIds] = useState<Record<string, boolean>>({});
  const [sheetSnapshots, setSheetSnapshots] = useState<Record<string, string>>({});
  const suggestedAttemptedRef = useRef<Set<string>>(new Set());

  const getRawForSheet = useCallback(
    (s: SheetConfig) => {
      if (hasMultipleFiles && normalizedFiles && s.file_id) {
        const found = normalizedFiles.find((f) => f.fileId === s.file_id);
        if (found?.rawData) return found.rawData;
      }
      return currentRawData;
    },
    [hasMultipleFiles, normalizedFiles, currentRawData]
  );

  const extractTextsInBox = useCallback((raw: any, bbox: SheetConfig['bbox']): string[] => {
    if (!raw?.texts || !bbox) return [];
    const matched = raw.texts.filter(
      (t: any) =>
        t.text &&
        t.x >= bbox.min_x &&
        t.x <= bbox.max_x &&
        t.y >= bbox.min_y &&
        t.y <= bbox.max_y
    );
    matched.sort((a: any, b: any) => (Number(b.height) || 0) - (Number(a.height) || 0));
    return matched
      .map((t: any) => String(t.text || '').trim())
      .filter(Boolean)
      .slice(0, 25);
  }, []);

  const suggestSheetNameInBackground = useCallback(
    async (sheet: SheetConfig) => {
      if (!sheet || suggestedAttemptedRef.current.has(sheet.id)) return;
      suggestedAttemptedRef.current.add(sheet.id);
      const raw = getRawForSheet(sheet);
      const boxTexts = extractTextsInBox(raw, sheet.bbox);
      if (boxTexts.length === 0 && !sheet.source_file && !dwgFilename) return;

      setSuggestingIds((prev) => ({ ...prev, [sheet.id]: true }));
      try {
        const res = await authFetch('/api/plans/ai-clean-names', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: sheet.source_file || currentFilename || dwgFilename || 'plan.dwg',
            sheets: [{ id: sheet.id, name: sheet.name, candidate_texts: boxTexts }],
            candidate_texts: boxTexts,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const suggested = data.sheets?.[0]?.name?.trim();
          if (suggested) {
            setSheetSuggestions((prev) => ({ ...prev, [sheet.id]: suggested }));
          }
        }
      } catch {
        // silent background helper
      } finally {
        setSuggestingIds((prev) => ({ ...prev, [sheet.id]: false }));
      }
    },
    [getRawForSheet, extractTextsInBox, currentFilename, dwgFilename]
  );

  const handleAutoNameSheetsAi = async () => {
    setIsAiCleaning(true);
    try {
      const candidateTexts = (currentRawData?.texts || [])
        .slice()
        .sort((a: any, b: any) => (Number(b.height) || 0) - (Number(a.height) || 0))
        .map((t: any) => String(t.text || '').trim())
        .filter(Boolean)
        .slice(0, 45);

      const res = await authFetch('/api/plans/ai-clean-names', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: currentFilename || dwgFilename || 'plan.dwg',
          sheets: sheets.map((s) => ({
            id: s.id,
            name: s.name,
            candidate_texts: extractTextsInBox(getRawForSheet(s), s.bbox),
          })),
          candidate_texts: candidateTexts,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.cleaned_title) {
          setPlanTitle(data.cleaned_title);
        }
        if (data.sheets && Array.isArray(data.sheets)) {
          const map = new Map(data.sheets.map((s: any) => [s.id, s.name]));
          setSheets((prev) =>
            prev.map((s) => ({
              ...s,
              name: (map.get(s.id) as string) || s.name,
            }))
          );
        }
      }
    } catch (err) {
      console.warn('AI clean names fallback:', err);
    } finally {
      setIsAiCleaning(false);
    }
  };

  // Dragging / Window drawing refs
  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startCenter: [number, number];
    boxStartWorld: [number, number] | null;
    currentWorld: [number, number] | null;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    startCenter: [0, 0],
    boxStartWorld: null,
    currentWorld: null,
  });

  const [drawingBox, setDrawingBox] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);

  // Resize canvas observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 20 && rect.height > 20) {
        setCanvasSize({ w: Math.floor(rect.width), h: Math.floor(rect.height) });
      }
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Coordinate projections
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

  // Zoom to a specific sheet bbox cleanly (matching Image 2)
  const zoomToSheet = useCallback(
    (s: SheetConfig) => {
      const b = s.bbox;
      const spanX = Math.max(1e-3, b.width);
      const spanY = Math.max(1e-3, b.height);
      const cx = (b.min_x + b.max_x) / 2;
      const cy = (b.min_y + b.max_y) / 2;
      const zx = (canvasSize.w * 0.85) / spanX;
      const zy = (canvasSize.h * 0.85) / spanY;
      setViewCenter([cx, cy]);
      setZoom(Math.max(1e-5, Math.min(zx, zy)));
      setViewingFullDrawing(false);
    },
    [canvasSize.w, canvasSize.h]
  );

  // Fit full DWG into view
  const fitDrawing = useCallback(() => {
    const b = currentRawData?.bbox_raw;
    if (!b) return;
    const spanX = Math.max(1e-3, b.max_x - b.min_x);
    const spanY = Math.max(1e-3, b.max_y - b.min_y);
    const cx = (b.min_x + b.max_x) / 2;
    const cy = (b.min_y + b.max_y) / 2;
    const zx = (canvasSize.w * 0.9) / spanX;
    const zy = (canvasSize.h * 0.88) / spanY;
    setViewCenter([cx, cy]);
    setZoom(Math.max(1e-5, Math.min(zx, zy)));
    setViewingFullDrawing(true);
  }, [currentRawData, canvasSize.w, canvasSize.h]);

  // On mount or when changing active file: focus on first active sheet cleanly!
  useEffect(() => {
    if (activeSheet && (!hasMultipleFiles || activeSheet.file_id === activeFileId)) {
      zoomToSheet(activeSheet);
    } else {
      fitDrawing();
    }
  }, [activeFileId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Color mapper helper: preserves exact CAD ACI & layer colors
  const getEntityColor = useCallback((rawHex: string | undefined): string => {
    return rawHex || '#f1f5f9';
  }, []);

  // Filter sheets visible in current file's canvas
  const visibleSheetsInFile = sheets.filter((s) => {
    if (!hasMultipleFiles) return true;
    return (s.file_id || 'file_0') === activeFileId;
  });

  // Sheet selection helpers
  // In default single-sheet mode, clicking any sheet card switches the single kept sheet to that view.
  // Clicking checkboxes enters multi-select mode so users can cherry-pick 2+ views across sheets/files.
  const [multiSelectMode, setMultiSelectMode] = useState<boolean>(false);

  const toggleSheetSelection = (id: string) => {
    setMultiSelectMode(true);
    setSelectedSheetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectOnlyCurrent = () => {
    if (activeSheetId) {
      setMultiSelectMode(false);
      setSelectedSheetIds(new Set([activeSheetId]));
    }
  };

  const selectAll = () => {
    setMultiSelectMode(true);
    setSelectedSheetIds(new Set(sheets.map((s) => s.id)));
  };

  const resetSelection = () => {
    if (activeSheetId) {
      setMultiSelectMode(false);
      setSelectedSheetIds(new Set([activeSheetId]));
    }
  };

  // Render High-DPI CAD drawing and sheet bounding boxes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !currentRawData) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Retina / HiDPI support
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.w * dpr;
    canvas.height = canvasSize.h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Dark CAD background matching OpenCadViewer
    ctx.fillStyle = '#060b14';
    ctx.fillRect(0, 0, canvasSize.w, canvasSize.h);

    const [wMinX, wMaxY] = screenToWorld(0, 0);
    const [wMaxX, wMinY] = screenToWorld(canvasSize.w, canvasSize.h);
    const padX = (wMaxX - wMinX) * 0.1;
    const padY = (wMaxY - wMinY) * 0.1;
    const cullMinX = wMinX - padX;
    const cullMaxX = wMaxX + padX;
    const cullMinY = wMinY - padY;
    const cullMaxY = wMaxY + padY;

    // Subtle CAD Grid
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

    // Hatches (walls, column fills)
    if (currentRawData.hatches) {
      ctx.save();
      ctx.globalAlpha = 0.15;
      for (const h of currentRawData.hatches) {
        if (!h.points || h.points.length < 3) continue;
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

    // Lines batched by true color
    if (currentRawData.lines) {
      const buckets = new Map<string, number[][]>();
      for (const ln of currentRawData.lines) {
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

    // Polylines batched by true color
    if (currentRawData.polylines) {
      const polyBuckets = new Map<string, any[]>();
      for (const pl of currentRawData.polylines) {
        if (!pl.points || pl.points.length < 2) continue;
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

    // Circles & Arcs (doors, curves, columns)
    if (currentRawData.arcs_circles) {
      ctx.lineWidth = 1.05;
      for (const ac of currentRawData.arcs_circles) {
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

    // Text with Level-Of-Detail (LOD) culling & rotation
    // Prevents giant smeared overlapping text blobs when zoomed out
    if (currentRawData.texts) {
      ctx.save();
      for (const t of currentRawData.texts) {
        if (t.x < cullMinX || t.x > cullMaxX || t.y < cullMinY || t.y > cullMaxY) continue;
        const pxHeight = (t.height || 0.2) * zoom;
        // Clean LOD: hide small text until user zooms in so text never balloons into blobs
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

    // Render defined sheets for this file
    visibleSheetsInFile.forEach((s) => {
      const isSelected = s.id === activeSheetId;
      const isKept = selectedSheetIds.has(s.id);
      const b = s.bbox;
      const [sx1, sy1] = worldToScreen(b.min_x, b.max_y);
      const [sx2, sy2] = worldToScreen(b.max_x, b.min_y);
      const sw = Math.abs(sx2 - sx1);
      const sh = Math.abs(sy2 - sy1);

      ctx.save();
      if (isSelected) {
        ctx.fillStyle = isKept ? 'rgba(56, 189, 248, 0.08)' : 'rgba(100, 116, 139, 0.04)';
        ctx.strokeStyle = isKept ? '#38bdf8' : '#94a3b8';
        ctx.lineWidth = 2.5;
        ctx.fillRect(Math.min(sx1, sx2), Math.min(sy1, sy2), sw, sh);
        ctx.strokeRect(Math.min(sx1, sx2), Math.min(sy1, sy2), sw, sh);

        // Highlight header badge
        const badgeX = Math.min(sx1, sx2);
        const badgeY = Math.max(16, Math.min(sy1, sy2) - 24);
        ctx.fillStyle = isKept ? '#0284c7' : '#475569';
        ctx.fillRect(badgeX, badgeY, Math.min(sw, 200), 22);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px ui-monospace, monospace';
        ctx.fillText(isKept ? `View: ${s.name}` : `(Excluded): ${s.name}`, badgeX + 6, badgeY + 15);
      } else if (isKept) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.03)';
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 1.4;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(Math.min(sx1, sx2), Math.min(sy1, sy2), sw, sh);

        ctx.fillStyle = '#38bdf8';
        ctx.font = '500 10px ui-monospace, monospace';
        ctx.fillText(`✓ ${s.name}`, Math.min(sx1, sx2) + 4, Math.min(sy1, sy2) - 4);
      } else {
        // Excluded sheet: draw faint outline so user sees it will be discarded
        ctx.strokeStyle = 'rgba(100, 116, 139, 0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 6]);
        ctx.strokeRect(Math.min(sx1, sx2), Math.min(sy1, sy2), sw, sh);
      }
      ctx.restore();
    });

    // Temporary window drawing box
    if (drawingBox) {
      const [sx1, sy1] = worldToScreen(drawingBox.x1, drawingBox.y1);
      const [sx2, sy2] = worldToScreen(drawingBox.x2, drawingBox.y2);
      const sw = Math.abs(sx2 - sx1);
      const sh = Math.abs(sy2 - sy1);

      ctx.save();
      ctx.fillStyle = 'rgba(16, 185, 129, 0.16)';
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.fillRect(Math.min(sx1, sx2), Math.min(sy1, sy2), sw, sh);
      ctx.strokeRect(Math.min(sx1, sx2), Math.min(sy1, sy2), sw, sh);

      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 11px ui-monospace, monospace';
      ctx.fillText('+ New Sheet Window Box', Math.min(sx1, sx2) + 6, Math.min(sy1, sy2) - 6);
      ctx.restore();
    }
  }, [
    currentRawData,
    visibleSheetsInFile,
    activeSheetId,
    selectedSheetIds,
    drawingBox,
    canvasSize,
    worldToScreen,
    screenToWorld,
    zoom,
    getEntityColor,
  ]);

  // Pointer events
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const [wx, wy] = screenToWorld(sx, sy);

    if (mode === 'draw-window') {
      dragRef.current = {
        active: true,
        startX: sx,
        startY: sy,
        startCenter: [...viewCenter],
        boxStartWorld: [wx, wy],
        currentWorld: [wx, wy],
      };
      setDrawingBox({ x1: wx, y1: wy, x2: wx, y2: wy });
    } else {
      dragRef.current = {
        active: true,
        startX: sx,
        startY: sy,
        startCenter: [...viewCenter],
        boxStartWorld: null,
        currentWorld: null,
      };
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragRef.current.active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const [wx, wy] = screenToWorld(sx, sy);

    if (mode === 'draw-window' && dragRef.current.boxStartWorld) {
      const [bx, by] = dragRef.current.boxStartWorld;
      setDrawingBox({ x1: bx, y1: by, x2: wx, y2: wy });
    } else {
      const dx = sx - dragRef.current.startX;
      const dy = sy - dragRef.current.startY;
      setViewCenter([
        dragRef.current.startCenter[0] - dx / zoom,
        dragRef.current.startCenter[1] + dy / zoom,
      ]);
    }
  };

  // Touch adapters reuse the mouse handlers (they only read clientX/clientY); 2 fingers pinch-zoom
  const pinchRef = useRef<{ d: number; z: number } | null>(null);
  const asMouse = (t: React.Touch) =>
    ({ clientX: t.clientX, clientY: t.clientY } as unknown as React.MouseEvent<HTMLCanvasElement>);
  const pinchDist = (e: React.TouchEvent) =>
    Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 2) {
      dragRef.current.active = false;
      setDrawingBox(null);
      pinchRef.current = { d: Math.max(10, pinchDist(e)), z: zoom };
    } else if (e.touches.length === 1) {
      handleMouseDown(asMouse(e.touches[0]));
    }
  };
  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 2 && pinchRef.current) {
      const next = pinchRef.current.z * (pinchDist(e) / pinchRef.current.d);
      setZoom(Math.max(1e-5, Math.min(1000, next)));
    } else if (e.touches.length === 1 && !pinchRef.current) {
      handleMouseMove(asMouse(e.touches[0]));
    }
  };
  const handleTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (pinchRef.current) {
      if (e.touches.length === 0) pinchRef.current = null;
      return;
    }
    handleMouseUp();
  };

  const captureBoxSnapshot = useCallback(
    (bbox: SheetConfig['bbox']): string | null => {
      const src = canvasRef.current;
      if (!src) return null;
      const [sx1, sy1] = worldToScreen(bbox.min_x, bbox.max_y);
      const [sx2, sy2] = worldToScreen(bbox.max_x, bbox.min_y);
      const dpr = window.devicePixelRatio || 1;
      const rx = Math.max(0, Math.floor(Math.min(sx1, sx2) * dpr));
      const ry = Math.max(0, Math.floor(Math.min(sy1, sy2) * dpr));
      const rw = Math.min(src.width - rx, Math.floor(Math.abs(sx2 - sx1) * dpr));
      const rh = Math.min(src.height - ry, Math.floor(Math.abs(sy2 - sy1) * dpr));
      if (rw < 8 || rh < 8) return null;
      try {
        const off = document.createElement('canvas');
        off.width = 200;
        off.height = 120;
        const octx = off.getContext('2d');
        if (!octx) return null;
        octx.fillStyle = '#09090b';
        octx.fillRect(0, 0, 200, 120);
        const scale = Math.min(200 / rw, 120 / rh);
        const dw = rw * scale;
        const dh = rh * scale;
        octx.drawImage(src, rx, ry, rw, rh, (200 - dw) / 2, (120 - dh) / 2, dw, dh);
        return off.toDataURL('image/png');
      } catch {
        return null;
      }
    },
    [worldToScreen]
  );

  // Trigger background name suggestion when selecting a generic-named sheet
  useEffect(() => {
    if (!activeSheet) return;
    if (/^(sheet|view|frame|layout|window|main plan view)/i.test(activeSheet.name) || /[_]/.test(activeSheet.name)) {
      suggestSheetNameInBackground(activeSheet);
    }
  }, [activeSheet, suggestSheetNameInBackground]);

  const handleMouseUp = () => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;

    if (mode === 'draw-window' && drawingBox) {
      const minX = Math.min(drawingBox.x1, drawingBox.x2);
      const maxX = Math.max(drawingBox.x1, drawingBox.x2);
      const minY = Math.min(drawingBox.y1, drawingBox.y2);
      const maxY = Math.max(drawingBox.y1, drawingBox.y2);
      const width = maxX - minX;
      const height = maxY - minY;

      if (width > 0.1 && height > 0.1) {
        const newId = `sheet_${Date.now()}`;
        const bboxObj = {
          min_x: round3(minX),
          min_y: round3(minY),
          max_x: round3(maxX),
          max_y: round3(maxY),
          width: round3(width),
          height: round3(height),
        };
        const snap = captureBoxSnapshot(bboxObj);
        if (snap) {
          setSheetSnapshots((prev) => ({ ...prev, [newId]: snap }));
        }
        const newSheet: SheetConfig = {
          id: newId,
          name: `View ${sheets.length + 1}`,
          description: `Custom window from ${currentFilename}`,
          file_id: activeFileId,
          source_file: currentFilename,
          bbox: bboxObj,
          is_custom_window: true,
        };
        setSheets((prev) => [...prev, newSheet]);
        setActiveSheetId(newId);
        setSelectedSheetIds((prev) => (multiSelectMode ? new Set([...prev, newId]) : new Set([newId])));
        setMode('pan');
        suggestSheetNameInBackground(newSheet);
      }
      setDrawingBox(null);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const [wx, wy] = screenToWorld(sx, sy);

    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    const newZoom = Math.max(1e-5, Math.min(1000, zoom * factor));
    setZoom(newZoom);
    setViewCenter([wx - (sx - canvasSize.w / 2) / newZoom, wy + (sy - canvasSize.h / 2) / newZoom]);
  };

  const updateActiveSheet = (updates: Partial<SheetConfig>) => {
    if (!activeSheet) return;
    setSheets((prev) =>
      prev.map((s) => (s.id === activeSheet.id ? { ...s, ...updates } : s))
    );
  };

  const deleteSheet = (id: string) => {
    if (sheets.length <= 1) return;
    const remaining = sheets.filter((s) => s.id !== id);
    setSheets(remaining);
    setSelectedSheetIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      if (next.size === 0 && remaining.length > 0) {
        next.add(remaining[0].id);
      }
      return next;
    });
    if (activeSheetId === id) {
      setActiveSheetId(remaining[0].id);
    }
  };

  const keptCount = selectedSheetIds.size;

  const handleFinish = () => {
    const keptSheets = sheets.filter((s) => selectedSheetIds.has(s.id));
    if (keptSheets.length === 0) return;
    const finalActiveId = selectedSheetIds.has(activeSheetId) ? activeSheetId : keptSheets[0].id;
    onConfirm({
      planTitle: planTitle.trim() || 'Untitled Plan',
      sheets: keptSheets,
      activeSheetId: finalActiveId,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-6xl h-[calc(100dvh-16px)] sm:h-[94vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Top Header */}
        <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-950 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-blue-600/20 text-blue-400 shrink-0">
              {hasMultipleFiles ? <Files className="w-5 h-5" /> : <FileCode2 className="w-5 h-5" />}
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-medium text-white truncate flex items-center gap-2">
                <span>Sheets and views</span>
                <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-semibold">
                  {keptCount} of {sheets.length} kept
                </span>
              </h2>
              <p className="text-[11px] text-zinc-400 truncate">
                Keep the sheet views you need; the rest are discarded
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-2 sm:py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-300 transition"
            >
              Cancel
            </button>
            <button
              onClick={handleFinish}
              disabled={keptCount === 0}
              className="flex items-center gap-1.5 px-4 py-2 sm:py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-medium text-white transition shadow"
            >
              <Check className="w-4 h-4" />
              <span>
                Keep {keptCount} {keptCount === 1 ? 'sheet' : 'sheets'}
              </span>
            </button>
          </div>
        </div>

        {/* Master Plan Name & Multi-file bar */}
        <div className="px-4 py-2 bg-zinc-900/90 border-b border-zinc-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 flex-1 min-w-[280px]">
            <label className="font-medium text-zinc-300 shrink-0">Plan Title:</label>
            <input
              type="text"
              value={planTitle}
              onChange={(e) => setPlanTitle(e.target.value)}
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1 text-white font-medium focus:outline-none focus:border-blue-500"
              placeholder="e.g. Ground Floor & Structural Layout"
            />
          </div>

          {/* Multi-DWG File Tabs Selector */}
          {hasMultipleFiles && normalizedFiles && (
            <div className="flex items-center gap-1 overflow-x-auto max-w-full">
              <span className="text-[11px] font-medium text-zinc-400 mr-1 flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-blue-400" />
                <span>DWG Source:</span>
              </span>
              {normalizedFiles.map((f) => {
                const isCurrent = f.fileId === activeFileId;
                const fileSheets = sheets.filter((s) => (s.file_id || 'file_0') === f.fileId);
                const keptFileSheets = fileSheets.filter((s) => selectedSheetIds.has(s.id)).length;
                return (
                  <button
                    key={f.fileId}
                    type="button"
                    onClick={() => {
                      setActiveFileId(f.fileId);
                      const firstSheet = sheets.find((s) => (s.file_id || 'file_0') === f.fileId);
                      if (firstSheet) {
                        setActiveSheetId(firstSheet.id);
                        zoomToSheet(firstSheet);
                      }
                    }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition truncate max-w-[200px] ${
                      isCurrent
                        ? 'bg-blue-600 text-white shadow'
                        : 'bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                    title={f.filename}
                  >
                    <span className="truncate">{f.name || f.filename}</span>
                    <span className="px-1.5 py-0.2 rounded-full bg-black/30 text-[10px]">
                      {keptFileSheets}/{fileSheets.length}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Main Body: Left CAD Canvas + Right Sheets Sidebar */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
          
          {/* Canvas Area */}
          <div ref={containerRef} className="flex-1 relative bg-zinc-950 overflow-hidden flex flex-col min-h-[200px]">
            
            {/* Canvas Toolbar overlay */}
            <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 bg-zinc-900/90 backdrop-blur-xs border border-zinc-700 rounded-xl p-1 shadow-lg">
              <button
                type="button"
                onClick={() => setMode('pan')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                  mode === 'pan' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
                }`}
                title="Pan & Zoom around modelspace"
              >
                <span>Pan</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('draw-window')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                  mode === 'draw-window'
                    ? 'bg-blue-600 text-white ring-2 ring-blue-400/30'
                    : 'text-zinc-300 hover:text-zinc-300 bg-blue-500/10'
                }`}
                title="Click and drag on the drawing to create a new sheet view window"
              >
                <Square className="w-3.5 h-3.5" />
                <span>Draw box</span>
              </button>
              <div className="w-px h-4 bg-zinc-700 mx-0.5" />
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(1000, z * 1.25))}
                className="p-2 sm:p-1 rounded-lg text-zinc-400 hover:text-white"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(1e-5, z * 0.8))}
                className="p-2 sm:p-1 rounded-lg text-zinc-400 hover:text-white"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={activeSheet ? () => zoomToSheet(activeSheet) : fitDrawing}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold transition ${
                  !viewingFullDrawing ? 'bg-zinc-800 text-blue-400' : 'text-zinc-400 hover:text-white'
                }`}
                title="Frame Selected Sheet View"
              >
                <Eye className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Focus Sheet</span>
              </button>
              <button
                type="button"
                onClick={fitDrawing}
                className={`p-1 rounded-lg transition ${
                  viewingFullDrawing ? 'bg-zinc-800 text-blue-400' : 'text-zinc-400 hover:text-white'
                }`}
                title="Fit Full Drawing Modelspace"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>

            {/* Instruction banner in draw mode */}
            {mode === 'draw-window' && (
              <div className="absolute top-14 left-3 z-10 bg-zinc-900 border border-blue-500/40 text-blue-200 text-xs px-3 py-1.5 rounded-lg shadow flex items-center gap-1.5 ">
                <Square className="w-3.5 h-3.5 text-zinc-300 shrink-0" />
                <span>Drag a rectangle to define a new sheet boundary</span>
              </div>
            )}

            <canvas
              ref={canvasRef}
              style={{ width: `${canvasSize.w}px`, height: `${canvasSize.h}px` }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onWheel={handleWheel}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
              className={`w-full h-full block touch-none ${
                mode === 'draw-window' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
              }`}
            />
          </div>

          {/* Right Sheet Configuration Sidebar */}
          <div className="w-full md:w-80 lg:w-96 border-t md:border-t-0 md:border-l border-zinc-800 bg-zinc-900/80 flex flex-col shrink-0">
            
            <div className="p-3 border-b border-zinc-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-medium text-white flex items-center gap-1.5">
                    <CheckSquare className="w-3.5 h-3.5 text-blue-400" />
                    <span>Sheets & Views</span>
                  </h3>
                  <p className="text-[11px] text-blue-400 font-semibold">
                    {keptCount} of {sheets.length} kept in plan
                  </p>
                </div>
                <button
                  onClick={() => setMode('draw-window')}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-zinc-300 text-xs font-semibold transition"
                  title="Draw a new sheet window box"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Box</span>
                </button>
              </div>

              {/* Quick view selection actions */}
              <div className="flex items-center gap-1.5 pt-1 text-[10px]">
                <button
                  type="button"
                  onClick={selectOnlyCurrent}
                  className="px-2 py-0.5 rounded bg-blue-600/25 hover:bg-blue-600/40 text-blue-300 font-semibold transition border border-blue-500/30"
                  title="Keep only this active sheet and discard all other clutter"
                >
                  Only This View
                </button>
                <button
                  type="button"
                  onClick={selectAll}
                  className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={resetSelection}
                  className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={handleAutoNameSheetsAi}
                  disabled={isAiCleaning}
                  className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium transition flex items-center gap-1 border border-zinc-700"
                  title="Uses AI to scan CAD title blocks and standardize sheet names"
                >
                  <AiBadge label="AI" />
                  <span>{isAiCleaning ? 'Naming...' : 'Auto-name'}</span>
                </button>
              </div>
            </div>

            {/* Sheet Tabs / List with Checkboxes */}
            <div className="p-3 space-y-2 overflow-y-auto max-h-36 md:max-h-64 border-b border-zinc-800">
              {sheets.map((s, idx) => {
                const isSelected = s.id === activeSheetId;
                const isKept = selectedSheetIds.has(s.id);
                return (
                  <div
                    key={s.id}
                    onClick={() => {
                      setActiveSheetId(s.id);
                      if (!multiSelectMode) {
                        setSelectedSheetIds(new Set([s.id]));
                      }
                      if (hasMultipleFiles && s.file_id && s.file_id !== activeFileId) {
                        setActiveFileId(s.file_id);
                      }
                      zoomToSheet(s);
                    }}
                    className={`p-2.5 rounded-xl border text-left cursor-pointer transition flex items-center justify-between gap-2.5 ${
                      isSelected
                        ? 'bg-blue-600/15 border-blue-500 text-white shadow-xs'
                        : isKept
                        ? 'bg-zinc-950/60 border-zinc-800 hover:border-zinc-700 text-zinc-200'
                        : 'bg-zinc-950/30 border-zinc-900 opacity-60 text-zinc-500'
                    }`}
                  >
                    {/* Prominent Inclusion Checkbox */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSheetSelection(s.id);
                      }}
                      className={`w-6 h-6 sm:w-4 sm:h-4 rounded flex items-center justify-center border transition shrink-0 ${
                        isKept
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-zinc-900 border-zinc-700 text-transparent hover:border-zinc-500'
                      }`}
                      title={isKept ? 'Included in plan (click to exclude)' : 'Excluded from plan (click to include)'}
                    >
                      <Check className="w-3 h-3 stroke-[3]" />
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 font-medium text-xs truncate">
                        <span className={`truncate ${!isKept ? 'line-through text-zinc-500' : ''}`}>
                          {s.name}
                        </span>
                        {s.is_custom_window && (
                          <span className="px-1 py-0.2 rounded bg-blue-500/20 text-zinc-300 text-[9px] font-medium shrink-0">
                            Custom Box
                          </span>
                        )}
                        {!isKept && (
                          <span className="px-1 py-0.2 rounded bg-zinc-800 text-zinc-500 text-[9px] font-medium shrink-0">
                            Excluded
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-zinc-400 truncate">
                        {hasMultipleFiles && s.source_file && (
                          <span className="text-blue-400 font-mono truncate">
                            [{s.source_file.replace(/\.[^/.]+$/, '')}]
                          </span>
                        )}
                        <span className="truncate">{s.description || 'No description added'}</span>
                      </div>
                    </div>

                    {sheets.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteSheet(s.id);
                        }}
                        className="p-1 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition shrink-0"
                        title="Delete view"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Active Sheet Metadata Editor */}
            {activeSheet && (
              <div className="p-4 flex-1 flex flex-col space-y-3 overflow-y-auto bg-zinc-950/50">
                <div className="text-xs font-medium text-zinc-200 flex items-center justify-between">
                  <span>Edit Selected View #{sheets.findIndex((s) => s.id === activeSheet.id) + 1}</span>
                  {selectedSheetIds.has(activeSheet.id) ? (
                    <span className="text-[10px] text-zinc-300 font-semibold flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      <span>Included in Plan</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleSheetSelection(activeSheet.id)}
                      className="text-[10px] text-blue-400 hover:text-blue-300 font-semibold"
                    >
                      + Include in Plan
                    </button>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold text-zinc-400">
                    Sheet Name
                  </label>
                  <input
                    type="text"
                    value={activeSheet.name}
                    onChange={(e) => updateActiveSheet({ name: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                    placeholder="e.g. Ground Floor Plan"
                  />
                  {suggestingIds[activeSheet.id] && (
                    <div className="text-[10px] text-zinc-400 flex items-center gap-1.5">
                      <AiBadge />
                      <span>Inspecting selected box layout for name suggestion...</span>
                    </div>
                  )}
                  {sheetSuggestions[activeSheet.id] &&
                    sheetSuggestions[activeSheet.id] !== activeSheet.name && (
                      <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-blue-500/10 border border-blue-500/25 text-[11px]">
                        <div className="min-w-0 flex items-center gap-1.5">
                          <AiBadge />
                          <span className="text-zinc-200 truncate" title={sheetSuggestions[activeSheet.id]}>
                            Rename to <strong>{sheetSuggestions[activeSheet.id]}</strong>?
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              updateActiveSheet({ name: sheetSuggestions[activeSheet.id] });
                              setSheetSuggestions((prev) => {
                                const next = { ...prev };
                                delete next[activeSheet.id];
                                return next;
                              });
                            }}
                            className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium text-[10px]"
                          >
                            Apply
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setSheetSuggestions((prev) => {
                                const next = { ...prev };
                                delete next[activeSheet.id];
                                return next;
                              })
                            }
                            className="p-0.5 text-zinc-400 hover:text-white"
                            title="Dismiss suggestion"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    )}
                  {sheetSnapshots[activeSheet.id] && (
                    <div className="flex items-center gap-2 p-1.5 rounded-lg bg-zinc-900/80 border border-zinc-800">
                      <img
                        src={sheetSnapshots[activeSheet.id]}
                        alt="Selected layout reference"
                        className="w-16 h-10 object-contain rounded border border-zinc-800 bg-zinc-950 shrink-0"
                      />
                      <span className="text-[10px] text-zinc-400">
                        Captured layout box reference
                      </span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                    Sheet Description (What this view represents)
                  </label>
                  <textarea
                    rows={3}
                    value={activeSheet.description}
                    onChange={(e) => updateActiveSheet({ description: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-blue-500 resize-none"
                    placeholder="e.g., Working plan showing room boundaries, external columns, staircase details..."
                  />
                </div>

                <div className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-400 space-y-1 font-mono">
                  <div>Window Bounds:</div>
                  <div className="text-zinc-300">
                    X: [{activeSheet.bbox.min_x.toFixed(1)}, {activeSheet.bbox.max_x.toFixed(1)}] | Y: [{activeSheet.bbox.min_y.toFixed(1)}, {activeSheet.bbox.max_y.toFixed(1)}]
                  </div>
                  <div>
                    Span: {activeSheet.bbox.width.toFixed(1)} × {activeSheet.bbox.height.toFixed(1)} units
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => zoomToSheet(activeSheet)}
                    className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1 font-semibold"
                  >
                    <Maximize2 className="w-3 h-3" />
                    <span>Focus View on Canvas</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function cropRawDataToSheet(fullRaw: any, targetSheet: SheetConfig) {
  if (!fullRaw || !targetSheet) return fullRaw;
  const b = targetSheet.bbox;
  const padX = Math.max(0.5, (b.width || 50) * 0.025);
  const padY = Math.max(0.5, (b.height || 50) * 0.025);
  const minX = Math.min(b.min_x, b.max_x) - padX;
  const maxX = Math.max(b.min_x, b.max_x) + padX;
  const minY = Math.min(b.min_y, b.max_y) - padY;
  const maxY = Math.max(b.min_y, b.max_y) + padY;
  const inBox = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;

  const lines = (fullRaw.lines || []).filter(
    (ln: any) => inBox(ln.start[0], ln.start[1]) && inBox(ln.end[0], ln.end[1])
  );
  const polylines = (fullRaw.polylines || []).filter(
    (pl: any) => pl.points && pl.points.every((pt: any) => inBox(pt[0], pt[1]))
  );
  const arcs_circles = (fullRaw.arcs_circles || []).filter(
    (ac: any) => inBox(ac.center[0], ac.center[1])
  );
  const texts = (fullRaw.texts || []).filter((t: any) => inBox(t.x, t.y));
  const hatches = (fullRaw.hatches || []).filter(
    (h: any) => h.points && inBox(h.points[0][0], h.points[0][1])
  );
  const inserts = (fullRaw.inserts || []).filter(
    (ins: any) => ins.pos && inBox(ins.pos[0], ins.pos[1])
  );

  const layerCounts: Record<string, number> = {};
  for (const item of [...lines, ...polylines, ...arcs_circles, ...texts, ...hatches]) {
    if (item.layer) layerCounts[item.layer] = (layerCounts[item.layer] || 0) + 1;
  }
  const filteredLayers = (fullRaw.layers || [])
    .filter((lyr: any) => (layerCounts[lyr.name] || 0) > 0)
    .map((lyr: any) => ({ ...lyr, entity_count: layerCounts[lyr.name] || 0 }));

  return {
    ...fullRaw,
    bbox_raw: b,
    bbox_full: b,
    active_sheet: targetSheet,
    sheets: [targetSheet],
    layers: filteredLayers.length > 0 ? filteredLayers : fullRaw.layers,
    lines,
    polylines,
    arcs_circles,
    texts,
    hatches,
    inserts,
    tables: fullRaw.tables || [],
    cleanup_stats: {
      is_cropped: true,
      sheet_id: targetSheet.id,
      sheet_name: targetSheet.name,
      cleaned_primitives:
        lines.length + polylines.length + arcs_circles.length + texts.length + hatches.length,
    },
  };
}
