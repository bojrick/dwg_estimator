import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  ArrowLeft,
  Save,
  Download,
  Printer,
  Plus,
  Trash2,
  Copy,
  Edit2,
  Table as TableIcon,
  Sparkles,
  Layers,
  ZoomIn,
  ZoomOut,
  Maximize2,
  CheckCircle2,
  HelpCircle,
  FolderKanban,
  FileSpreadsheet,
  Ruler,
  MousePointer,
  Crosshair,
  ArrowRight,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import {
  BbsBarItem,
  BbsMemberGroup,
  ExtractedCadTable,
  RebarTextCandidate,
  StructuralEstimateState,
  StructuralMemberType,
  StructuralMemberDefinition,
  GuidedWorkflowStep,
} from './types';
import {
  STANDARD_DIAMETERS,
  calculateDiameterSummary,
  calculateTakeoffTotals,
  recalculateBarItem,
  generateBbsFromMemberDefinitions,
} from './bbsMath';
import { scanTextsForRebar } from './rebarTextParser';
import {
  extractTableFromBoundingBox,
  autoDetectScheduleTables,
  BoxCoords,
} from './cadTableParser';
import { BarShapeEditorModal } from './BarShapeEditorModal';
import { ScheduleTableModal } from './ScheduleTableModal';
import { GuidedWorkflowBar } from './GuidedWorkflowBar';
import { MemberCatalogStep } from './MemberCatalogStep';
import { ReinforcementLinkStep } from './ReinforcementLinkStep';
import { scanStructuralTagsWithVerification } from './tagScanner';
import { cropRawDataToSheet } from '../SheetSelectorModal';

interface StructuralEstimatorPageProps {
  plan: any;
  rawData: any;
  fullRawData?: any;
  isGuest?: boolean;
  onBack: () => void;
  onSaveEstimate: (estimate: StructuralEstimateState) => Promise<void>;
  showToast: (msg: string) => void;
}

export const StructuralEstimatorPage: React.FC<StructuralEstimatorPageProps> = ({
  plan,
  rawData: initialRawData,
  fullRawData,
  isGuest,
  onBack,
  onSaveEstimate,
  showToast,
}) => {
  const sheets: any[] = plan?.sheets || [];
  const [activeSheetId, setActiveSheetId] = useState<string>(() => {
    return plan?.active_sheet_id && plan.active_sheet_id !== 'all'
      ? plan.active_sheet_id
      : sheets[0]?.id || 'all';
  });

  // Guided workflow state
  const [currentStep, setCurrentStep] = useState<GuidedWorkflowStep>('scope');
  const [selectedScope, setSelectedScope] = useState<StructuralMemberType>('beam');

  // Estimate state
  const [estimateState, setEstimateState] = useState<StructuralEstimateState>(() => {
    const saved = plan?.structural_estimate || {};
    return {
      workflowStep: saved.workflowStep || 'scope',
      selectedScope: saved.selectedScope || 'beam',
      layoutSheetId: saved.layoutSheetId || sheets[0]?.id,
      scheduleSheetId: saved.scheduleSheetId || sheets[0]?.id,
      definedMembers: saved.definedMembers || [],
      members: saved.members || [],
      scheduleTables: saved.scheduleTables || [],
      parameters: {
        wastagePct: saved.parameters?.wastagePct ?? 3.0,
        bindingWirePct: saved.parameters?.bindingWirePct ?? 1.0,
        steelRatePerKg: saved.parameters?.steelRatePerKg ?? 0.85,
        currency: saved.parameters?.currency || '$',
        defaultCoverMm: saved.parameters?.defaultCoverMm || {
          footing: 50,
          column: 40,
          beam: 25,
          slab: 20,
        },
      },
      notes: saved.notes || '',
    };
  });

  const [definedMembers, setDefinedMembers] = useState<StructuralMemberDefinition[]>(() => {
    return estimateState.definedMembers || [];
  });

  // Crop raw data to active sheet
  const activeSheet = useMemo(() => {
    return sheets.find((s) => s.id === activeSheetId);
  }, [sheets, activeSheetId]);

  const activeRaw = useMemo(() => {
    const base = fullRawData || initialRawData;
    if (!base) return null;
    if (!activeSheet || activeSheetId === 'all') return base;
    return cropRawDataToSheet(base, activeSheet);
  }, [fullRawData, initialRawData, activeSheet, activeSheetId]);

  // Dynamic calculated BBS items
  const [bbsItems, setBbsItems] = useState<BbsBarItem[]>([]);

  useEffect(() => {
    if (definedMembers.length > 0) {
      const generated = generateBbsFromMemberDefinitions(definedMembers);
      setBbsItems(generated);
    } else if (estimateState.members && estimateState.members.length > 0) {
      const flat = estimateState.members.flatMap((m) => m.items || []);
      setBbsItems(flat);
    }
  }, [definedMembers, estimateState.members]);

  // Span picking on CAD
  const [pickingMemberId, setPickingMemberId] = useState<string | null>(null);
  const [pickedFirstPoint, setPickedFirstPoint] = useState<[number, number] | null>(null);

  // Selected CAD Callout for attachment
  const [selectedPlanCallout, setSelectedPlanCallout] = useState<any | null>(null);

  // Highlighted marks on drawing
  const [highlightedMark, setHighlightedMark] = useState<string | null>(null);

  // Modals & inspect
  const [editingItem, setEditingItem] = useState<Partial<BbsBarItem> | null>(null);
  const [inspectingTable, setInspectingTable] = useState<ExtractedCadTable | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Canvas Viewport transform: pan and zoom
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [toolMode, setToolMode] = useState<'pan' | 'select_table' | 'pick_span' | 'select_layout'>('pan');
  const [detectedRebarTexts, setDetectedRebarTexts] = useState<RebarTextCandidate[]>([]);

  // Framing Layout ROI & Legend Table Linking
  const [layoutBoundingBox, setLayoutBoundingBox] = useState<BoxCoords | null>(() => {
    return estimateState.layoutBoundingBox || null;
  });
  const [activeLegendTableId, setActiveLegendTableId] = useState<string | null>(() => {
    return estimateState.activeLegendTableId || estimateState.scheduleTables[0]?.id || null;
  });
  const [inspectedMember, setInspectedMember] = useState<StructuralMemberDefinition | null>(null);

  // Marquee selection for tables & layout ROI
  const [marqueeStart, setMarqueeStart] = useState<{ x: number; y: number } | null>(null);
  const [marqueeEnd, setMarqueeEnd] = useState<{ x: number; y: number } | null>(null);

  const [viewState, setViewState] = useState({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  // Fit active drawing bounding box into canvas
  const fitToView = useCallback(() => {
    if (!activeRaw || !containerRef.current || !canvasRef.current) return;
    const b = activeRaw.bbox_raw || activeRaw.bbox_full;
    if (!b || !b.width || !b.height) return;

    const cw = containerRef.current.clientWidth || 600;
    const ch = containerRef.current.clientHeight || 500;
    const pad = 40;

    const scaleX = (cw - pad * 2) / b.width;
    const scaleY = (ch - pad * 2) / b.height;
    const scale = Math.min(scaleX, scaleY, 50);

    const midX = (b.min_x + b.max_x) / 2;
    const midY = (b.min_y + b.max_y) / 2;

    const offsetX = cw / 2 - midX * scale;
    const offsetY = ch / 2 + midY * scale;

    setViewState({ scale, offsetX, offsetY });
  }, [activeRaw]);

  useEffect(() => {
    fitToView();
  }, [fitToView, activeSheetId]);

  // World to screen and screen to world coordinates
  const worldToScreen = useCallback(
    (wx: number, wy: number) => {
      const sx = wx * viewState.scale + viewState.offsetX;
      const sy = -wy * viewState.scale + viewState.offsetY;
      return [sx, sy];
    },
    [viewState]
  );

  const screenToWorld = useCallback(
    (sx: number, sy: number) => {
      const wx = (sx - viewState.offsetX) / viewState.scale;
      const wy = -(sy - viewState.offsetY) / viewState.scale;
      return [wx, wy];
    },
    [viewState]
  );

  // Multi-pass verification scanner for structural tags on layout sheet
  const handleScanLayoutTags = (options?: { allowedLayers?: string[]; customPrefix?: string }) => {
    if (!activeRaw?.texts) return;

    const activeLegend = estimateState.scheduleTables.find((t) => t.id === activeLegendTableId);

    const discovered = scanStructuralTagsWithVerification(
      activeRaw.texts,
      selectedScope,
      estimateState.scheduleTables,
      {
        ...options,
        bbox: layoutBoundingBox || undefined,
        activeLegendTable: activeLegend || undefined,
        lines: activeRaw.lines || [],
        polylines: activeRaw.polylines || [],
        scaleToM: activeRaw.scale_to_m || 0.001,
      }
    );

    if (discovered.length === 0) {
      showToast(`No ${selectedScope.toUpperCase()} tags found matching filter.`);
      return;
    }

    const defaultCover =
      selectedScope === 'column' ? 40 : selectedScope === 'beam' ? 25 : selectedScope === 'footing' ? 50 : 20;

    const newMembers: StructuralMemberDefinition[] = [];

    for (const disc of discovered) {
      const existing = definedMembers.find((m) => m.mark === disc.mark);
      const detectedSpan = disc.detectedGeometry?.lengthMm;
      const fallbackSpan = selectedScope === 'column' ? 3000 : 4000;

      if (existing) {
        newMembers.push({
          ...existing,
          countOnLayout: disc.countOnLayout,
          isVerifiedInLegend: disc.isVerifiedInLegend || existing.isVerifiedInLegend,
          layerName: disc.layers[0] || existing.layerName,
          widthMm: disc.suggestedWidthMm || existing.widthMm,
          depthMm: disc.suggestedDepthMm || existing.depthMm,
          spanMm: detectedSpan || existing.spanMm,
          detectedGeometry: disc.detectedGeometry || existing.detectedGeometry,
          linkedLegendMark: disc.isVerifiedInLegend ? disc.mark : existing.linkedLegendMark,
        });
      } else {
        newMembers.push({
          id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          mark: disc.mark,
          category: selectedScope,
          floorLevel: 'Ground Floor',
          countOnLayout: disc.countOnLayout,
          widthMm: disc.suggestedWidthMm || (selectedScope === 'beam' ? 230 : 300),
          depthMm: disc.suggestedDepthMm || 450,
          spanMm: detectedSpan || fallbackSpan,
          clearCoverMm: defaultCover,
          isVerifiedInLegend: disc.isVerifiedInLegend,
          layerName: disc.layers[0],
          detectedGeometry: disc.detectedGeometry || undefined,
          linkedLegendMark: disc.isVerifiedInLegend ? disc.mark : undefined,
          mainBars: { count: 4, diameter: 16 },
          secondaryBars: { count: 2, diameter: 12 },
          stirrups: { diameter: 8, spacingMm: 150, legs: 2 },
        });
      }
    }

    setDefinedMembers(newMembers);
    const verifiedCount = discovered.filter((d) => d.isVerifiedInLegend).length;
    const geomCount = discovered.filter((d) => d.detectedGeometry).length;
    showToast(
      `Discovered ${discovered.length} ${selectedScope} tags (${verifiedCount} verified in legend, ${geomCount} CAD spans measured)`
    );
  };

  // Render CAD sheet to canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activeRaw) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    // Dark CAD background
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, rect.width, rect.height);

    // Draw lines
    ctx.lineWidth = 1;
    const lines = activeRaw.lines || [];
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const [x1, y1] = worldToScreen(ln.start[0], ln.start[1]);
      const [x2, y2] = worldToScreen(ln.end[0], ln.end[1]);
      ctx.strokeStyle = ln.color || '#94a3b8';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Draw polylines
    const polylines = activeRaw.polylines || [];
    for (let i = 0; i < polylines.length; i++) {
      const pl = polylines[i];
      if (!pl.points || pl.points.length < 2) continue;
      ctx.strokeStyle = pl.color || '#94a3b8';
      ctx.beginPath();
      const [sx0, sy0] = worldToScreen(pl.points[0][0], pl.points[0][1]);
      ctx.moveTo(sx0, sy0);
      for (let p = 1; p < pl.points.length; p++) {
        const [px, py] = worldToScreen(pl.points[p][0], pl.points[p][1]);
        ctx.lineTo(px, py);
      }
      if (pl.closed) ctx.closePath();
      ctx.stroke();
    }

    // Draw texts
    const texts = activeRaw.texts || [];
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i];
      const [tx, ty] = worldToScreen(t.x, t.y);
      if (tx < -50 || tx > rect.width + 50 || ty < -50 || ty > rect.height + 50) continue;
      const screenH = Math.max(8, (t.height || 0.25) * viewState.scale);
      if (screenH < 4) continue;

      const isHighlighted = highlightedMark && String(t.text).toUpperCase().includes(highlightedMark);

      ctx.font = `${isHighlighted ? 'bold ' : ''}${Math.round(screenH)}px sans-serif`;
      ctx.fillStyle = isHighlighted ? '#38bdf8' : t.color || '#cbd5e1';
      ctx.fillText(t.text, tx, ty);

      if (isHighlighted) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.strokeRect(tx - 4, ty - screenH / 2 - 2, screenH * t.text.length * 0.7 + 8, screenH + 4);
      }
    }

    // Draw Framing Layout Bounding Box (if set)
    if (layoutBoundingBox) {
      const [sMinX, sMaxY] = worldToScreen(layoutBoundingBox.min_x, layoutBoundingBox.max_y);
      const [sMaxX, sMinY] = worldToScreen(layoutBoundingBox.max_x, layoutBoundingBox.min_y);
      const bw = Math.abs(sMaxX - sMinX);
      const bh = Math.abs(sMaxY - sMinY);

      ctx.fillStyle = 'rgba(16, 185, 129, 0.06)';
      ctx.fillRect(sMinX, sMinY, bw, bh);
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.strokeRect(sMinX, sMinY, bw, bh);
      ctx.setLineDash([]);

      // Label pill in top-left of framing area
      ctx.fillStyle = '#065f46';
      ctx.fillRect(sMinX, Math.max(0, sMinY - 20), 140, 20);
      ctx.fillStyle = '#ecfdf5';
      ctx.font = '10px Inter, sans-serif';
      ctx.fillText('Framing Layout Area', sMinX + 8, Math.max(12, sMinY - 6));
    }

    // Draw Dual Highlighting for Inspected Member (Text Annotation + Physical Geometry)
    if (inspectedMember) {
      // 1. Text Annotation Highlight (Circle on drawing)
      for (let i = 0; i < texts.length; i++) {
        const t = texts[i];
        if (t.text && String(t.text).toUpperCase().includes(inspectedMember.mark)) {
          const [tx, ty] = worldToScreen(t.x, t.y);
          const r = Math.max(12, (t.height || 0.25) * viewState.scale * 1.5 + 4);
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(tx, ty, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // 2. Physical Geometric Span Line or Boundary Polygon Highlight
      const geom = inspectedMember.detectedGeometry;
      if (geom) {
        if (geom.type === 'line' && geom.start && geom.end) {
          const [sx1, sy1] = worldToScreen(geom.start[0], geom.start[1]);
          const [sx2, sy2] = worldToScreen(geom.end[0], geom.end[1]);

          // Glowing span line
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 3.5;
          ctx.beginPath();
          ctx.moveTo(sx1, sy1);
          ctx.lineTo(sx2, sy2);
          ctx.stroke();

          // End ticks
          const angle = Math.atan2(sy2 - sy1, sx2 - sx1);
          const tickLen = 8;
          for (const [px, py] of [[sx1, sy1], [sx2, sy2]]) {
            ctx.beginPath();
            ctx.moveTo(px - Math.sin(angle) * tickLen, py + Math.cos(angle) * tickLen);
            ctx.lineTo(px + Math.sin(angle) * tickLen, py - Math.cos(angle) * tickLen);
            ctx.stroke();
          }

          // Span dimension callout badge
          const midX = (sx1 + sx2) / 2;
          const midY = (sy1 + sy2) / 2;
          const label = `${inspectedMember.mark}: L = ${(inspectedMember.spanMm || 0).toLocaleString()} mm`;
          ctx.font = 'bold 11px Inter, sans-serif';
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = '#18181b';
          ctx.fillRect(midX - tw / 2 - 8, midY - 22, tw + 16, 20);
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 1;
          ctx.strokeRect(midX - tw / 2 - 8, midY - 22, tw + 16, 20);
          ctx.fillStyle = '#fbbf24';
          ctx.fillText(label, midX - tw / 2, midY - 8);
        } else if ((geom.type === 'rect' || geom.type === 'polygon') && geom.boundaryPoints && geom.boundaryPoints.length >= 3) {
          ctx.beginPath();
          for (let pIdx = 0; pIdx < geom.boundaryPoints.length; pIdx++) {
            const [bx, by] = worldToScreen(geom.boundaryPoints[pIdx][0], geom.boundaryPoints[pIdx][1]);
            if (pIdx === 0) ctx.moveTo(bx, by);
            else ctx.lineTo(bx, by);
          }
          ctx.closePath();
          ctx.fillStyle = 'rgba(245, 158, 11, 0.15)';
          ctx.fill();
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 2.5;
          ctx.stroke();

          // Dimension badge
          const centerPt = geom.boundaryPoints[0];
          const [cx, cy] = worldToScreen(centerPt[0], centerPt[1]);
          const dimLabel = `${inspectedMember.widthMm} × ${inspectedMember.depthMm} mm`;
          ctx.fillStyle = '#18181b';
          ctx.fillRect(cx - 30, cy - 20, 100, 18);
          ctx.fillStyle = '#fbbf24';
          ctx.font = '10px Inter, sans-serif';
          ctx.fillText(dimLabel, cx - 24, cy - 7);
        }
      }
    }

    // Draw detected rebar pins
    for (const pin of detectedRebarTexts) {
      const [px, py] = worldToScreen(pin.x, pin.y);
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#047857';
      ctx.stroke();
    }

    // Draw picked point 1 if picking span
    if (pickedFirstPoint) {
      const [p1x, p1y] = worldToScreen(pickedFirstPoint[0], pickedFirstPoint[1]);
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(p1x, p1y, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw marquee selection box
    if (marqueeStart && marqueeEnd) {
      const minX = Math.min(marqueeStart.x, marqueeEnd.x);
      const minY = Math.min(marqueeStart.y, marqueeEnd.y);
      const w = Math.abs(marqueeStart.x - marqueeEnd.x);
      const h = Math.abs(marqueeStart.y - marqueeEnd.y);

      const isLayoutSelect = toolMode === 'select_layout';
      ctx.fillStyle = isLayoutSelect ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)';
      ctx.fillRect(minX, minY, w, h);
      ctx.strokeStyle = isLayoutSelect ? '#10b981' : '#3b82f6';
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(minX, minY, w, h);
      ctx.setLineDash([]);
    }
  }, [
    activeRaw,
    viewState,
    worldToScreen,
    detectedRebarTexts,
    highlightedMark,
    pickedFirstPoint,
    marqueeStart,
    marqueeEnd,
    layoutBoundingBox,
    inspectedMember,
    toolMode,
  ]);

  // Handle canvas mouse events
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    if (toolMode === 'select_table' || toolMode === 'select_layout') {
      setMarqueeStart({ x: clientX, y: clientY });
      setMarqueeEnd({ x: clientX, y: clientY });
      return;
    }

    if (toolMode === 'pick_span' && pickingMemberId) {
      const [wx, wy] = screenToWorld(clientX, clientY);
      if (!pickedFirstPoint) {
        setPickedFirstPoint([wx, wy]);
        showToast('Start point set. Now click end point of the span on the drawing.');
      } else {
        const scaleToM = activeRaw?.scale_to_m || 1.0;
        const distUnits = Math.hypot(wx - pickedFirstPoint[0], wy - pickedFirstPoint[1]);
        const distMm = Math.round(distUnits * scaleToM * 1000);

        setDefinedMembers((prev) =>
          prev.map((m) => (m.id === pickingMemberId ? { ...m, spanMm: distMm } : m))
        );
        showToast(`Measured clear span: ${distMm} mm (${(distMm / 1000).toFixed(2)} m)`);
        setPickedFirstPoint(null);
        setPickingMemberId(null);
        setToolMode('pan');
      }
      return;
    }

    // Check if clicked near a text annotation (for Step 3 Callout Attachment)
    if (currentStep === 'reinforcement' && activeRaw?.texts) {
      const [wx, wy] = screenToWorld(clientX, clientY);
      const clickedText = activeRaw.texts.find(
        (t: any) => Math.hypot(t.x - wx, t.y - wy) < (t.height || 0.3) * 3
      );
      if (clickedText) {
        const cleanStr = String(clickedText.text).trim();
        const cand = scanTextsForRebar([clickedText])[0];
        setSelectedPlanCallout(
          cand || {
            id: `callout_${Date.now()}`,
            text: cleanStr,
            diameter: 16,
            count: 2,
            x: clickedText.x,
            y: clickedText.y,
          }
        );
        showToast(`Selected annotation: "${cleanStr}"`);
        return;
      }
    }

    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    if ((toolMode === 'select_table' || toolMode === 'select_layout') && marqueeStart) {
      setMarqueeEnd({ x: clientX, y: clientY });
      return;
    }

    if (isDraggingRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      setViewState((prev) => ({
        ...prev,
        offsetX: prev.offsetX + dx,
        offsetY: prev.offsetY + dy,
      }));
    }
  };

  const handleMouseUp = () => {
    if (toolMode === 'select_layout' && marqueeStart && marqueeEnd) {
      const x1 = Math.min(marqueeStart.x, marqueeEnd.x);
      const x2 = Math.max(marqueeStart.x, marqueeEnd.x);
      const y1 = Math.min(marqueeStart.y, marqueeEnd.y);
      const y2 = Math.max(marqueeStart.y, marqueeEnd.y);

      if (Math.abs(x2 - x1) > 20 && Math.abs(y2 - y1) > 20) {
        const [wMinX, wMaxY] = screenToWorld(x1, y1);
        const [wMaxX, wMinY] = screenToWorld(x2, y2);

        const bbox: BoxCoords = {
          min_x: Math.min(wMinX, wMaxX),
          min_y: Math.min(wMinY, wMaxY),
          max_x: Math.max(wMinX, wMaxX),
          max_y: Math.max(wMinY, wMaxY),
        };

        setLayoutBoundingBox(bbox);
        setEstimateState((prev) => ({ ...prev, layoutBoundingBox: bbox }));
        showToast('Framing layout scan window selected!');
      }
      setMarqueeStart(null);
      setMarqueeEnd(null);
      setToolMode('pan');
      return;
    }

    if (toolMode === 'select_table' && marqueeStart && marqueeEnd) {
      const x1 = Math.min(marqueeStart.x, marqueeEnd.x);
      const x2 = Math.max(marqueeStart.x, marqueeEnd.x);
      const y1 = Math.min(marqueeStart.y, marqueeEnd.y);
      const y2 = Math.max(marqueeStart.y, marqueeEnd.y);

      if (Math.abs(x2 - x1) > 20 && Math.abs(y2 - y1) > 20) {
        const [wMinX, wMaxY] = screenToWorld(x1, y1);
        const [wMaxX, wMinY] = screenToWorld(x2, y2);

        const bbox: BoxCoords = {
          min_x: Math.min(wMinX, wMaxX),
          min_y: Math.min(wMinY, wMaxY),
          max_x: Math.max(wMinX, wMaxX),
          max_y: Math.max(wMinY, wMaxY),
        };

        const table = extractTableFromBoundingBox(
          activeRaw?.texts || [],
          bbox,
          undefined,
          activeRaw?.lines || [],
          activeRaw?.polylines || []
        );

        if (table) {
          table.sheetId = activeSheetId;
          setInspectingTable(table);
          showToast(`Lattice Schedule Table: ${table.rows.length} rows`);
        } else {
          showToast('No structured table detected. Try a wider bounding box.');
        }
      }
      setMarqueeStart(null);
      setMarqueeEnd(null);
      setToolMode('pan');
      return;
    }

    isDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    setViewState((prev) => {
      const newScale = Math.min(Math.max(prev.scale * zoomFactor, 0.01), 200);
      const newOffsetX = mouseX - (mouseX - prev.offsetX) * (newScale / prev.scale);
      const newOffsetY = mouseY - (mouseY - prev.offsetY) * (newScale / prev.scale);
      return { scale: newScale, offsetX: newOffsetX, offsetY: newOffsetY };
    });
  };

  // Start span measurement tool for a member
  const handleStartPickingSpan = (memberId: string) => {
    setPickingMemberId(memberId);
    setPickedFirstPoint(null);
    setToolMode('pick_span');
    showToast('Click two points on the drawing to measure clear span.');
  };

  // Save to backend
  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
      const memberGroupsMap = new Map<string, BbsMemberGroup>();
      for (const item of bbsItems) {
        const key = `${item.memberId}_${item.memberType}`;
        const group = memberGroupsMap.get(key) || {
          id: key,
          name: item.memberId,
          type: item.memberType,
          sheetId: item.sourceSheetId,
          items: [],
        };
        group.items.push(item);
        memberGroupsMap.set(key, group);
      }

      const nextState: StructuralEstimateState = {
        ...estimateState,
        workflowStep: currentStep,
        selectedScope,
        definedMembers,
        members: Array.from(memberGroupsMap.values()),
      };

      setEstimateState(nextState);
      await onSaveEstimate(nextState);
      showToast('Structural estimate saved successfully');
    } catch (err) {
      showToast('Failed to save estimate');
    } finally {
      setIsSaving(false);
    }
  };

  // Export BBS CSV
  const handleExportBbsCsv = () => {
    const headers = [
      'Member ID',
      'Member Type',
      'Floor Level',
      'Bar Mark',
      'Shape',
      'Diameter (mm)',
      'Cutting Length (m)',
      'No. of Members',
      'Bars per Member',
      'Total Bars',
      'Total Length (m)',
      'Unit Weight (kg/m)',
      'Total Weight (kg)',
      'Notes',
    ];
    const rows = bbsItems.map((i) =>
      [
        `"${i.memberId}"`,
        `"${i.memberType}"`,
        `"${i.floorLevel || 'All'}"`,
        `"${i.mark}"`,
        `"${i.shape}"`,
        i.diameter,
        i.cuttingLengthM.toFixed(3),
        i.numMembers,
        i.barsPerMember,
        i.totalBars,
        i.totalLengthM.toFixed(2),
        i.unitWeightKgM.toFixed(3),
        i.totalWeightKg.toFixed(2),
        `"${(i.notes || '').replace(/"/g, '""')}"`,
      ].join(',')
    );

    const blob = new Blob([[headers.join(','), ...rows].join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${plan.name || 'structural'}_bbs_schedule.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Downloaded BBS schedule CSV');
  };

  // Calculated takeoff summary
  const diameterSummary = useMemo(() => {
    return calculateDiameterSummary(bbsItems);
  }, [bbsItems]);

  const takeoffTotals = useMemo(() => {
    return calculateTakeoffTotals(diameterSummary, estimateState.parameters);
  }, [diameterSummary, estimateState.parameters]);

  return (
    <div className="h-[100dvh] flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden font-sans">
      {/* Top Header */}
      <header className="h-14 border-b border-zinc-800 bg-zinc-900 px-4 flex items-center justify-between gap-4 shrink-0 z-20">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBack}
            className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition"
            title="Return to CAD viewer"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold text-white truncate">{plan?.name}</h1>
              <span className="px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[10px] font-medium tracking-wide uppercase">
                Guided BBS Estimator
              </span>
            </div>
            <div className="text-[11px] text-zinc-400 truncate">
              {plan?.project_name} · Layout ➔ Legend ➔ Schedule ➔ Takeoff
            </div>
          </div>
        </div>

        {/* Global Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleExportBbsCsv}
            disabled={bbsItems.length === 0}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 text-xs font-medium transition"
            title="Export Bar Bending Schedule to CSV"
          >
            <Download className="w-3.5 h-3.5 text-zinc-400" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={() => window.print()}
            disabled={bbsItems.length === 0}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 text-xs font-medium transition"
            title="Print or save as PDF"
          >
            <Printer className="w-3.5 h-3.5 text-zinc-400" />
            <span>Print BBS</span>
          </button>

          <button
            onClick={handleSaveAll}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md transition"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Saving...' : 'Save Estimate'}</span>
          </button>
        </div>
      </header>

      {/* Guided Workflow Progress Bar */}
      <GuidedWorkflowBar
        currentStep={currentStep}
        onStepChange={(step) => setCurrentStep(step)}
        memberCount={definedMembers.length}
        bbsItemCount={bbsItems.length}
      />

      {/* Sheet Selector & Tool Bar */}
      <div className="bg-zinc-900/60 border-b border-zinc-800/80 px-4 py-1.5 flex items-center justify-between gap-3 text-xs overflow-x-auto shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-medium text-zinc-400 mr-1 flex items-center gap-1">
            <Layers className="w-3.5 h-3.5" />
            Active View:
          </span>
          {sheets.length > 0 ? (
            sheets.map((s, idx) => (
              <button
                key={s.id}
                onClick={() => setActiveSheetId(s.id)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                  activeSheetId === s.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-750'
                }`}
              >
                {s.name || `Sheet ${idx + 1}`}
              </button>
            ))
          ) : (
            <span className="text-zinc-500 text-xs">Full Modelspace (Single View)</span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setToolMode(toolMode === 'select_table' ? 'pan' : 'select_table')}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
              toolMode === 'select_table'
                ? 'bg-amber-500 text-zinc-950 font-bold'
                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-750'
            }`}
            title="Drag marquee box over any schedule table in the drawing"
          >
            <TableIcon className="w-3.5 h-3.5" />
            <span>{toolMode === 'select_table' ? 'Cancel Box' : 'Select Schedule Table'}</span>
          </button>
        </div>
      </div>

      {/* Main Split Body */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Pane: Persistent CAD Inspector */}
        <div className="w-full lg:w-1/2 h-1/2 lg:h-full border-b lg:border-b-0 lg:border-r border-zinc-800 flex flex-col relative bg-zinc-950">
          {/* CAD Controls Overlay */}
          <div className="absolute top-3 left-3 z-10 flex items-center gap-1 bg-zinc-900/90 backdrop-blur-xs border border-zinc-800 rounded-xl p-1 shadow-lg text-xs">
            <button
              onClick={() => setViewState((v) => ({ ...v, scale: v.scale * 1.25 }))}
              className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-300 hover:text-white"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewState((v) => ({ ...v, scale: v.scale * 0.8 }))}
              className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-300 hover:text-white"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={fitToView}
              className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-300 hover:text-white"
              title="Fit Sheet to Window"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <div className="h-4 w-px bg-zinc-750 mx-1" />
            <span className="text-[11px] text-zinc-400 px-1 font-mono">
              {toolMode === 'pick_span'
                ? 'Click 2 points to measure span'
                : toolMode === 'select_table'
                ? 'Drag box over table'
                : toolMode === 'select_layout'
                ? 'Drag box over framing layout area'
                : currentStep === 'reinforcement'
                ? 'Click any CAD callout to attach'
                : 'Pan & Zoom'}
            </span>
          </div>

          {/* Canvas */}
          <div ref={containerRef} className="flex-1 w-full h-full relative overflow-hidden">
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onWheel={handleWheel}
              className={`w-full h-full block touch-none select-none ${
                toolMode === 'select_table' || toolMode === 'select_layout'
                  ? 'cursor-crosshair'
                  : toolMode === 'pick_span'
                  ? 'cursor-crosshair'
                  : currentStep === 'reinforcement'
                  ? 'cursor-pointer'
                  : 'cursor-grab active:cursor-grabbing'
              }`}
            />
          </div>
        </div>

        {/* Right Pane: Guided Step Workstation */}
        <div className="w-full lg:w-1/2 h-1/2 lg:h-full flex flex-col bg-zinc-900 overflow-y-auto p-5">
          {/* STEP 1: SCOPE & SHEETS */}
          {currentStep === 'scope' && (
            <div className="space-y-6 max-w-2xl">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Step 1: Select Structural Element Scope
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Choose which structural element category to estimate for this schedule
                </p>
              </div>

              {/* Scope Selector Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { id: 'beam', label: 'Beams', desc: 'Plinth, Floor & Roof' },
                  { id: 'column', label: 'Columns', desc: 'Columns & Pedestals' },
                  { id: 'footing', label: 'Footings', desc: 'Isolated & Combined' },
                  { id: 'slab', label: 'Slabs', desc: 'One-way & Two-way' },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedScope(item.id as StructuralMemberType)}
                    className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                      selectedScope === item.id
                        ? 'border-blue-500 bg-blue-500/10 text-white'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'
                    }`}
                  >
                    <div className="text-xs font-semibold">{item.label}</div>
                    <div className="text-[10px] text-zinc-500 mt-1">{item.desc}</div>
                  </button>
                ))}
              </div>

              {/* Sheet Assignment */}
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3">
                <h4 className="text-xs font-semibold text-zinc-200">Sheet Mapping</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      Framing Layout Sheet (Spans & Counts):
                    </label>
                    <select
                      value={activeSheetId}
                      onChange={(e) => setActiveSheetId(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white"
                    >
                      {sheets.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      Schedule / Typical Details Sheet:
                    </label>
                    <select
                      value={estimateState.scheduleSheetId || activeSheetId}
                      onChange={(e) =>
                        setEstimateState((prev) => ({ ...prev, scheduleSheetId: e.target.value }))
                      }
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white"
                    >
                      {sheets.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setCurrentStep('catalog')}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-2 shadow-lg transition"
                >
                  <span>Proceed to Step 2: Member Catalog</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: MEMBER CATALOG & GEOMETRY */}
          {currentStep === 'catalog' && (
            <MemberCatalogStep
              scope={selectedScope}
              members={definedMembers}
              scheduleTables={estimateState.scheduleTables}
              cadTexts={activeRaw?.texts}
              cadLayers={activeRaw?.layers}
              layoutBoundingBox={layoutBoundingBox}
              activeLegendTableId={activeLegendTableId}
              inspectedMemberId={inspectedMember?.id || null}
              onChangeMembers={(m) => setDefinedMembers(m)}
              onScanLayoutTags={handleScanLayoutTags}
              onPickSpanOnDrawing={handleStartPickingSpan}
              onHighlightMember={(mark) => {
                setHighlightedMark(mark === highlightedMark ? null : mark);
                showToast(`Highlighting ${mark} tags on layout`);
              }}
              onSelectMemberForInspection={(m) => setInspectedMember(m)}
              onStartSelectLayoutBox={() => {
                setToolMode('select_layout');
                showToast('Click and drag a box over the framing layout plan');
              }}
              onClearLayoutBox={() => {
                setLayoutBoundingBox(null);
                setEstimateState((prev) => ({ ...prev, layoutBoundingBox: null }));
                showToast('Framing window cleared: scanning entire sheet');
              }}
              onChangeActiveLegendTableId={(id) => {
                setActiveLegendTableId(id);
                setEstimateState((prev) => ({ ...prev, activeLegendTableId: id }));
              }}
              onProceedToStep3={() => setCurrentStep('reinforcement')}
              activePickingMemberId={pickingMemberId}
            />
          )}

          {/* STEP 3: REINFORCEMENT & CROSS-SECTIONS */}
          {currentStep === 'reinforcement' && (
            <ReinforcementLinkStep
              scope={selectedScope}
              members={definedMembers}
              scheduleTables={estimateState.scheduleTables}
              onChangeMembers={(m) => setDefinedMembers(m)}
              onOpenScheduleTableModal={(t) => setInspectingTable(t)}
              onBackToStep2={() => setCurrentStep('catalog')}
              onProceedToStep4={() => setCurrentStep('takeoff')}
              selectedPlanCallout={selectedPlanCallout}
              onClearSelectedCallout={() => setSelectedPlanCallout(null)}
            />
          )}

          {/* STEP 4: BBS VERIFICATION & STEEL TAKEOFF */}
          {currentStep === 'takeoff' && (
            <div className="space-y-6">
              {/* BBS Items Table */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-white">
                    Step 4: Bar Bending Schedule (BBS) Verification
                  </h3>
                  <div className="text-xs text-emerald-400 font-mono font-bold">
                    Net: {takeoffTotals.netWeightKg} kg ({takeoffTotals.netWeightTonnes} t)
                  </div>
                </div>

                <div className="border border-zinc-800 rounded-xl overflow-x-auto bg-zinc-950">
                  <table className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-zinc-900 border-b border-zinc-800 text-zinc-400 text-left">
                        <th className="p-2.5">Member</th>
                        <th className="p-2.5">Role / Mark</th>
                        <th className="p-2.5">Shape</th>
                        <th className="p-2.5 text-center">Dia</th>
                        <th className="p-2.5 text-right">Cut L (m)</th>
                        <th className="p-2.5 text-center">Qty</th>
                        <th className="p-2.5 text-right">Total L (m)</th>
                        <th className="p-2.5 text-right">Total Wt (kg)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-850">
                      {bbsItems.map((item) => (
                        <tr key={item.id} className="hover:bg-zinc-900/50 transition">
                          <td className="p-2.5 font-bold text-white whitespace-nowrap">
                            {item.memberId}
                            {item.floorLevel && (
                              <span className="block text-[10px] text-zinc-500 font-normal">
                                {item.floorLevel}
                              </span>
                            )}
                          </td>
                          <td className="p-2.5 text-zinc-200">{item.mark}</td>
                          <td className="p-2.5">
                            <span className="px-2 py-0.5 rounded bg-zinc-850 text-zinc-300 text-[10px] font-mono capitalize">
                              {item.shape.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="p-2.5 text-center font-mono font-semibold text-blue-400">
                            Φ {item.diameter}
                          </td>
                          <td className="p-2.5 text-right font-mono text-zinc-200">
                            {item.cuttingLengthM.toFixed(3)}
                          </td>
                          <td className="p-2.5 text-center font-mono text-zinc-300">
                            {item.numMembers} × {item.barsPerMember} = {item.totalBars}
                          </td>
                          <td className="p-2.5 text-right font-mono text-zinc-300">
                            {item.totalLengthM.toFixed(2)}
                          </td>
                          <td className="p-2.5 text-right font-mono font-semibold text-emerald-400">
                            {item.totalWeightKg.toFixed(1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Diameter Summary */}
              <div>
                <h4 className="text-xs font-semibold text-zinc-300 mb-2">
                  Diameter-wise Steel Takeoff
                </h4>
                <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="bg-zinc-900 border-b border-zinc-800 text-zinc-400 text-left">
                        <th className="p-2.5">Bar Dia</th>
                        <th className="p-2.5 text-center">Total Bars</th>
                        <th className="p-2.5 text-right">Total Length (m)</th>
                        <th className="p-2.5 text-right">Unit Wt (kg/m)</th>
                        <th className="p-2.5 text-right">Total Wt (kg)</th>
                        <th className="p-2.5 text-right">Tonnes (t)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-850">
                      {diameterSummary.map((row) => (
                        <tr key={row.diameter} className="hover:bg-zinc-900/50">
                          <td className="p-2.5 font-mono font-bold text-blue-400">
                            Φ {row.diameter} mm
                          </td>
                          <td className="p-2.5 text-center font-mono text-zinc-300">
                            {row.totalBars}
                          </td>
                          <td className="p-2.5 text-right font-mono text-zinc-300">
                            {row.totalLengthM.toFixed(2)}
                          </td>
                          <td className="p-2.5 text-right font-mono text-zinc-400">
                            {row.unitWeightKgM.toFixed(3)}
                          </td>
                          <td className="p-2.5 text-right font-mono font-semibold text-emerald-400">
                            {row.totalWeightKg.toFixed(1)}
                          </td>
                          <td className="p-2.5 text-right font-mono text-zinc-200">
                            {row.weightTonnes.toFixed(3)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Executive Summary Card */}
              <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="bg-zinc-900 rounded-xl p-3">
                  <div className="text-[10px] text-zinc-400">Net Rebar Weight</div>
                  <div className="text-base font-bold text-white font-mono mt-0.5">
                    {takeoffTotals.netWeightKg} <span className="text-xs font-normal">kg</span>
                  </div>
                  <div className="text-[10px] text-zinc-500 font-mono">
                    {takeoffTotals.netWeightTonnes} tonnes
                  </div>
                </div>

                <div className="bg-zinc-900 rounded-xl p-3">
                  <div className="text-[10px] text-zinc-400">
                    Wastage (+{estimateState.parameters.wastagePct}%)
                  </div>
                  <div className="text-base font-bold text-amber-400 font-mono mt-0.5">
                    +{takeoffTotals.wastageKg} <span className="text-xs font-normal">kg</span>
                  </div>
                  <div className="text-[10px] text-zinc-500 font-mono">
                    Gross: {takeoffTotals.totalWeightWithWastageKg} kg
                  </div>
                </div>

                <div className="bg-zinc-900 rounded-xl p-3">
                  <div className="text-[10px] text-zinc-400">Binding Wire (1%)</div>
                  <div className="text-base font-bold text-zinc-300 font-mono mt-0.5">
                    {takeoffTotals.bindingWireKg} <span className="text-xs font-normal">kg</span>
                  </div>
                  <div className="text-[10px] text-zinc-500">for tying rebar</div>
                </div>

                <div className="bg-blue-950/40 border border-blue-500/20 rounded-xl p-3">
                  <div className="text-[10px] text-blue-300">Total Steel Cost</div>
                  <div className="text-base font-bold text-emerald-400 font-mono mt-0.5">
                    {estimateState.parameters.currency} {takeoffTotals.totalCost.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-blue-300/80 font-mono">budget estimate</div>
                </div>
              </div>

              {/* Back to Step 3 */}
              <div className="flex justify-between pt-2">
                <button
                  onClick={() => setCurrentStep('reinforcement')}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back to Reinforcement Specs</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {inspectingTable && (
        <ScheduleTableModal
          table={inspectingTable}
          onClose={() => setInspectingTable(null)}
          onSaveTable={(updatedTable) => {
            setEstimateState((prev) => ({
              ...prev,
              scheduleTables: [
                ...prev.scheduleTables.filter((t) => t.id !== updatedTable.id),
                updatedTable,
              ],
            }));
            showToast('Schedule table edits saved!');
          }}
          onImportToBbs={(items, updatedTable) => {
            setEstimateState((prev) => ({
              ...prev,
              scheduleTables: [...prev.scheduleTables.filter((t) => t.id !== updatedTable.id), updatedTable],
            }));
            showToast('Schedule table imported!');
          }}
        />
      )}
    </div>
  );
};
