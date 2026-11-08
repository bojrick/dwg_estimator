import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  Save,
  Download,
  Plus,
  Trash2,
  Scan,
  Crop,
  Ruler,
  Layers,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  X,
  Crosshair,
  FileSpreadsheet,
  PackageCheck,
} from 'lucide-react';
import {
  ArchitecturalParameters,
  RoomDefinition,
  OpeningDefinition,
  FloorFinishType,
  BlockType,
  OpeningType,
  SheetEstimateRecord,
  EstimateVersion,
  OpeningScheduleRow,
} from './types';
import { calculateArchTakeoff } from './archMath';
import { cropRawDataToSheet } from '../../SheetSelectorModal';
import { CadEstimatorCanvas, WorldBBox } from '../shared/CadEstimatorCanvas';
import {
  analyzeCadLayers,
  inferArchitecturalFromCad,
  pointInPoly,
  traceWallBoundaryEnclosure,
} from '../shared/cadLayerInference';
import { VersionHistoryControl } from '../shared/VersionHistoryControl';

interface ArchitecturalEstimatorPageProps {
  plan: any;
  rawData: any;
  fullRawData?: any;
  isGuest?: boolean;
  onBack: () => void;
  onSaveEstimate: (estimate: any) => Promise<void>;
  showToast: (msg: string) => void;
}

type ArchStep = 'scope' | 'elements' | 'specs' | 'takeoff';

const DEFAULT_PARAMS: ArchitecturalParameters = {
  floorHeightM: 3.0,
  extWallLengthM: 40.0,
  intWallLengthM: 25.0,
  extWallThicknessM: 0.23,
  intWallThicknessM: 0.115,
  parapetWallHeightM: 1.0,
  parapetWallThicknessM: 0.115,
  parapetWallLengthM: 0,
  blockType: 'aac',
  blockLengthMm: 600,
  blockHeightMm: 200,
  blockWidthMm: 150,
  mortarJointMm: 10,
  wastagePct: 5,
  internalPlasterThicknessMm: 12,
  externalPlasterThicknessMm: 18,
  masonryRatePerM3: 4500,
  plasterRatePerM2: 180,
  paintRatePerM2: 140,
  flooringRatePerM2: 750,
  doorRatePerM2: 4200,
  windowRatePerM2: 3600,
  currency: '₹',
};

const ARCH_ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'ext_wall', label: 'External wall' },
  { value: 'int_wall', label: 'Internal wall' },
  { value: 'wall', label: 'Wall (auto split)' },
  { value: 'parapet', label: 'Parapet / balcony wall' },
  { value: 'door', label: 'Door / swing' },
  { value: 'window', label: 'Window / glazing' },
  { value: 'room', label: 'Room boundary' },
  { value: 'annotation', label: 'Annotation / ignore' },
  { value: 'general', label: 'General geometry' },
];

export const ArchitecturalEstimatorPage: React.FC<ArchitecturalEstimatorPageProps> = ({
  plan,
  rawData,
  fullRawData,
  onBack,
  onSaveEstimate,
  showToast,
}) => {
  const savedState = plan?.discipline_estimates?.architectural || plan?.architectural_estimate || {};

  const sheets = useMemo<any[]>(
    () => plan?.sheets || fullRawData?.sheets || rawData?.sheets || [],
    [plan?.sheets, fullRawData?.sheets, rawData?.sheets]
  );

  // Default to the first isolated sheet (not 'all') so wall lengths & rooms are scoped to one sheet
  const [activeSheetId, setActiveSheetId] = useState<string>(
    () => savedState.active_sheet_id || plan?.active_sheet_id || sheets[0]?.id || 'all'
  );

  const activeSheet = useMemo(
    () => sheets.find((s) => s.id === activeSheetId),
    [sheets, activeSheetId]
  );
  const activeSheetName = useMemo(
    () =>
      activeSheetId === 'all'
        ? `All Sheets (${sheets.length || 1})`
        : activeSheet?.name || savedState.sheetName || 'Selected Sheet',
    [activeSheetId, activeSheet, sheets.length, savedState.sheetName]
  );

  const [bySheet, setBySheet] = useState<Record<string, SheetEstimateRecord>>(
    () => savedState.by_sheet || {}
  );
  const [versions, setVersions] = useState<EstimateVersion[]>(() => savedState.versions || []);

  const initialSheetRecord = savedState.by_sheet?.[activeSheetId] || savedState;
  const hasSavedForInitialSheet = Boolean(
    (initialSheetRecord?.rooms && initialSheetRecord.rooms.length > 0) ||
      (initialSheetRecord?.openings && initialSheetRecord.openings.length > 0)
  );

  const [step, setStep] = useState<ArchStep>('scope');
  const [elementSubTab, setElementSubTab] = useState<'rooms' | 'openings'>('rooms');
  const [takeoffSubTab, setTakeoffSubTab] = useState<'boq' | 'orders' | 'combined'>('boq');

  const [params, setParams] = useState<ArchitecturalParameters>(() => ({
    ...DEFAULT_PARAMS,
    ...(initialSheetRecord?.parameters || {}),
  }));
  const [rooms, setRooms] = useState<RoomDefinition[]>(() => initialSheetRecord?.rooms || []);
  const [openings, setOpenings] = useState<OpeningDefinition[]>(
    () => initialSheetRecord?.openings || []
  );
  const [roleOverrides, setRoleOverrides] = useState<Record<string, string>>(
    () => initialSheetRecord?.roleOverrides || {}
  );
  const [scanBox, setScanBox] = useState<WorldBBox | null>(
    () => initialSheetRecord?.scanBox || null
  );
  const [notes, setNotes] = useState<string>(() => initialSheetRecord?.notes || '');
  const [lastScanNote, setLastScanNote] = useState<string>('');

  // Interactive CAD canvas states
  const [highlightedLayers, setHighlightedLayers] = useState<string[]>([]);
  const [highlightedMark, setHighlightedMark] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [isSelectingBox, setIsSelectingBox] = useState(false);
  const [pickTarget, setPickTarget] = useState<
    | null
    | {
        kind:
          | 'extWall'
          | 'intWall'
          | 'parapetWall'
          | 'roomPerim'
          | 'verifyRoomRect'
          | 'newRoomRect'
          | 'traceWallBoundary';
        roomId?: string;
        label: string;
      }
  >(null);
  const [isSaving, setIsSaving] = useState(false);

  const masterRawData = useMemo(() => fullRawData || rawData || null, [fullRawData, rawData]);
  const activeRaw = useMemo(() => {
    if (!masterRawData) return null;
    if (!activeSheet || activeSheetId === 'all') return masterRawData;
    return cropRawDataToSheet(masterRawData, activeSheet);
  }, [masterRawData, activeSheet, activeSheetId]);

  const layerStats = useMemo(
    () => analyzeCadLayers(activeRaw, 'architectural', scanBox, roleOverrides),
    [activeRaw, scanBox, roleOverrides]
  );

  const runCadInference = useCallback(
    (
      targetRaw: any,
      boxOverride?: WorldBBox | null,
      overridesOverride?: Record<string, string>,
      silent?: boolean
    ) => {
      if (!targetRaw) return;
      const res = inferArchitecturalFromCad(
        targetRaw,
        boxOverride !== undefined ? boxOverride : scanBox,
        overridesOverride || roleOverrides
      );
      setRooms(res.rooms);
      setOpenings(res.openings);
      if (Object.keys(res.paramPatch).length > 0) {
        setParams((prev) => ({ ...prev, ...res.paramPatch }));
      }
      setLastScanNote(res.summaryNote);
      if (!silent) showToast(res.summaryNote);
    },
    [scanBox, roleOverrides, showToast]
  );

  // Auto-infer on initial mount if current sheet has no saved rooms/openings
  useEffect(() => {
    if (!hasSavedForInitialSheet && activeRaw && rooms.length === 0 && openings.length === 0) {
      runCadInference(activeRaw, scanBox, roleOverrides, true);
    }
  }, [hasSavedForInitialSheet, activeRaw]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(
    () => calculateArchTakeoff(params, rooms, openings),
    [params, rooms, openings]
  );

  // Snapshot current sheet into `bySheet` whenever user switches sheets
  const currentSheetRecord = useMemo<SheetEstimateRecord>(
    () => ({
      sheetId: activeSheetId,
      sheetName: activeSheetName,
      updatedAt: new Date().toISOString(),
      parameters: params,
      rooms,
      openings,
      roleOverrides,
      scanBox,
      summary,
      notes,
    }),
    [activeSheetId, activeSheetName, params, rooms, openings, roleOverrides, scanBox, summary, notes]
  );

  const handleSelectSheet = (nextSheetId: string) => {
    if (nextSheetId === activeSheetId) return;
    const updatedMap = { ...bySheet, [activeSheetId]: currentSheetRecord };
    setBySheet(updatedMap);
    setActiveSheetId(nextSheetId);
    setSelectedRoomId(null);
    setHighlightedMark(null);

    const existing = updatedMap[nextSheetId];
    if (existing && (existing.rooms.length > 0 || existing.openings.length > 0)) {
      setParams({ ...DEFAULT_PARAMS, ...existing.parameters });
      setRooms(existing.rooms);
      setOpenings(existing.openings);
      setRoleOverrides(existing.roleOverrides || {});
      setScanBox(existing.scanBox || null);
      setNotes(existing.notes || '');
      showToast(`Loaded estimate for ${existing.sheetName}`);
    } else if (masterRawData) {
      const nextSheet = sheets.find((s) => s.id === nextSheetId);
      const nextRaw =
        !nextSheet || nextSheetId === 'all'
          ? masterRawData
          : cropRawDataToSheet(masterRawData, nextSheet);
      setScanBox(null);
      setNotes('');
      const res = inferArchitecturalFromCad(nextRaw, null, roleOverrides);
      setRooms(res.rooms);
      setOpenings(res.openings);
      setParams((prev) => ({ ...DEFAULT_PARAMS, currency: prev.currency, ...res.paramPatch }));
      setLastScanNote(res.summaryNote);
      showToast(`Scanned ${nextSheet?.name || 'sheet'}: ${res.summaryNote}`);
    }
  };

  // Combined multi-sheet report aggregation
  const allSheetRecords = useMemo<SheetEstimateRecord[]>(() => {
    const mergedMap: Record<string, SheetEstimateRecord> = {
      ...bySheet,
      [activeSheetId]: currentSheetRecord,
    };
    return Object.values(mergedMap).filter(
      (rec) => rec && (rec.rooms?.length > 0 || rec.openings?.length > 0)
    );
  }, [bySheet, activeSheetId, currentSheetRecord]);

  const combinedReport = useMemo(() => {
    let masonryM3 = 0;
    let blocksCount = 0;
    let flooringM2 = 0;
    let intPlasterM2 = 0;
    let extPlasterM2 = 0;
    let skirtingM = 0;
    let totalCost = 0;
    const openingMap = new Map<string, OpeningScheduleRow>();
    const orderMap = new Map<
      string,
      { item: string; orderQuantity: number; commercialUnit: string; estimatedCost: number }
    >();

    for (const rec of allSheetRecords) {
      const s = rec.summary || calculateArchTakeoff(rec.parameters, rec.rooms, rec.openings);
      masonryM3 += s.totalMasonryVolumeM3 || 0;
      blocksCount += s.totalBlocksRequired || 0;
      flooringM2 += s.totalFlooringAreaM2 || 0;
      intPlasterM2 += s.internalPlasterAreaM2 || 0;
      extPlasterM2 += s.externalPlasterAreaM2 || 0;
      skirtingM += s.totalSkirtingLengthM || 0;
      totalCost += s.totalCost || 0;

      for (const op of s.openingSchedule || []) {
        const key = `${op.mark}_${op.sizeLabel}`;
        const cur = openingMap.get(key);
        if (cur) {
          cur.count += op.count;
          cur.totalAreaM2 = Math.round((cur.totalAreaM2 + op.totalAreaM2) * 100) / 100;
          cur.amount += op.amount;
        } else {
          openingMap.set(key, { ...op });
        }
      }

      for (const ord of s.orderQuantities || []) {
        const cur = orderMap.get(ord.id);
        if (cur) {
          cur.orderQuantity = Math.round((cur.orderQuantity + ord.orderQuantity) * 10) / 10;
          cur.estimatedCost += ord.estimatedCost;
        } else {
          orderMap.set(ord.id, {
            item: ord.item,
            orderQuantity: ord.orderQuantity,
            commercialUnit: ord.commercialUnit,
            estimatedCost: ord.estimatedCost,
          });
        }
      }
    }

    return {
      sheetCount: allSheetRecords.length,
      masonryM3: Math.round(masonryM3 * 100) / 100,
      blocksCount,
      flooringM2: Math.round(flooringM2 * 100) / 100,
      intPlasterM2: Math.round(intPlasterM2 * 100) / 100,
      extPlasterM2: Math.round(extPlasterM2 * 100) / 100,
      skirtingM: Math.round(skirtingM * 100) / 100,
      totalCost: Math.round(totalCost),
      openings: Array.from(openingMap.values()),
      orders: Array.from(orderMap.values()),
    };
  }, [allSheetRecords]);

  const updateParam = <K extends keyof ArchitecturalParameters>(
    key: K,
    val: ArchitecturalParameters[K]
  ) => {
    setParams((prev) => ({ ...prev, [key]: val }));
  };

  const handleRoleChange = (layerName: string, newRole: string) => {
    const next = { ...roleOverrides, [layerName]: newRole };
    setRoleOverrides(next);
    runCadInference(activeRaw, scanBox, next, false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const nextBySheet = { ...bySheet, [activeSheetId]: currentSheetRecord };
      setBySheet(nextBySheet);

      const newVersion: EstimateVersion = {
        id: `v_${Date.now()}`,
        versionNumber: versions.length + 1,
        timestamp: new Date().toISOString(),
        sheetId: activeSheetId,
        sheetName: activeSheetName,
        totalCost: summary.totalCost,
        notes: notes.trim() || undefined,
        snapshot: {
          active_sheet_id: activeSheetId,
          sheetName: activeSheetName,
          parameters: params,
          rooms,
          openings,
          roleOverrides,
          scanBox,
          notes,
          by_sheet: nextBySheet,
        },
      };
      const nextVersions = [...versions.slice(-19), newVersion];
      setVersions(nextVersions);

      await onSaveEstimate({
        architectural_estimate: {
          active_sheet_id: activeSheetId,
          sheetName: activeSheetName,
          parameters: params,
          rooms,
          openings,
          roleOverrides,
          scanBox,
          notes,
          summary,
          by_sheet: nextBySheet,
          versions: nextVersions,
          updatedAt: new Date().toISOString(),
        },
      });
      showToast(`Saved ${activeSheetName} (v${newVersion.versionNumber})`);
    } catch {
      showToast('Failed to save estimate');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRestoreVersion = (ver: EstimateVersion) => {
    const snap = ver.snapshot;
    if (!snap) return;
    if (snap.active_sheet_id) setActiveSheetId(snap.active_sheet_id);
    if (snap.parameters) setParams({ ...DEFAULT_PARAMS, ...snap.parameters });
    if (snap.rooms) setRooms(snap.rooms);
    if (snap.openings) setOpenings(snap.openings);
    if (snap.roleOverrides) setRoleOverrides(snap.roleOverrides);
    setScanBox(snap.scanBox || null);
    setNotes(snap.notes || '');
    if (snap.by_sheet) setBySheet(snap.by_sheet);
    showToast(`Restored v${ver.versionNumber} (${ver.sheetName || 'sheet'})`);
  };

  const handleExportCsv = (combined = false) => {
    const rows: string[][] = [];
    if (combined) {
      rows.push(['Combined Multi-Sheet Architectural BOQ', plan?.title || plan?.name || 'Plan']);
      rows.push(['Sheets Included', allSheetRecords.map((r) => r.sheetName).join(' + ')]);
      rows.push([]);
      rows.push(['Sheet Name', 'Rooms', 'Masonry (m3)', 'Flooring (m2)', 'Cost', 'Estimator Notes']);
      for (const rec of allSheetRecords) {
        rows.push([
          rec.sheetName,
          String(rec.rooms.filter((r) => r.included !== false).length),
          rec.summary.totalMasonryVolumeM3.toFixed(2),
          rec.summary.totalFlooringAreaM2.toFixed(2),
          String(rec.summary.totalCost),
          rec.notes || '-',
        ]);
      }
      rows.push([]);
      rows.push(['Combined Door & Window Schedule', 'Type', 'Size', 'Count', 'Total Area (m2)', 'Amount']);
      for (const op of combinedReport.openings) {
        rows.push([
          op.mark,
          op.type,
          op.sizeLabel,
          String(op.count),
          op.totalAreaM2.toFixed(2),
          String(op.amount),
        ]);
      }
      rows.push([]);
      rows.push(['Combined Material Order Quantities', 'Order Qty', 'Commercial Unit', 'Estimated Cost']);
      for (const ord of combinedReport.orders) {
        rows.push([
          ord.item,
          String(ord.orderQuantity),
          ord.commercialUnit,
          String(ord.estimatedCost),
        ]);
      }
      rows.push(['Grand Total Plan Cost', '', '', String(combinedReport.totalCost)]);
    } else {
      rows.push(['Sheet Name', activeSheetName]);
      if (notes.trim()) rows.push(['Estimator Notes', notes.trim()]);
      rows.push([]);
      rows.push(['Work Item', 'Quantity', 'Unit', 'Rate', 'Amount']);
      rows.push([
        `External masonry (${Math.round(params.extWallThicknessM * 1000)}mm ${params.blockType.toUpperCase()})`,
        summary.extMasonryVolumeM3.toFixed(2),
        'm3',
        String(params.masonryRatePerM3),
        String(Math.round(summary.extMasonryVolumeM3 * params.masonryRatePerM3)),
      ]);
      rows.push([
        `Internal masonry (${Math.round(params.intWallThicknessM * 1000)}mm ${params.blockType.toUpperCase()})`,
        summary.intMasonryVolumeM3.toFixed(2),
        'm3',
        String(params.masonryRatePerM3),
        String(Math.round(summary.intMasonryVolumeM3 * params.masonryRatePerM3)),
      ]);
      rows.push([
        `Internal & ceiling plaster (${params.internalPlasterThicknessMm}mm)`,
        summary.internalPlasterAreaM2.toFixed(2),
        'm2',
        String(params.plasterRatePerM2),
        String(Math.round(summary.internalPlasterAreaM2 * params.plasterRatePerM2)),
      ]);
      rows.push([
        `External plaster (${params.externalPlasterThicknessMm}mm)`,
        summary.externalPlasterAreaM2.toFixed(2),
        'm2',
        String(params.plasterRatePerM2),
        String(Math.round(summary.externalPlasterAreaM2 * params.plasterRatePerM2)),
      ]);
      rows.push([
        'Wall & ceiling paint',
        (summary.internalPlasterAreaM2 + summary.externalPlasterAreaM2).toFixed(2),
        'm2',
        String(params.paintRatePerM2),
        String(
          Math.round(
            (summary.internalPlasterAreaM2 + summary.externalPlasterAreaM2) * params.paintRatePerM2
          )
        ),
      ]);
      rows.push([
        'Flooring & skirting',
        summary.totalFlooringAreaM2.toFixed(2),
        'm2',
        String(params.flooringRatePerM2),
        String(Math.round(summary.totalFlooringAreaM2 * params.flooringRatePerM2)),
      ]);
      rows.push([]);
      rows.push(['Door & Window Schedule', 'Type', 'Size', 'Count', 'Total Area (m2)', 'Unit Rate', 'Amount']);
      for (const op of summary.openingSchedule) {
        rows.push([
          op.mark,
          op.type,
          op.sizeLabel,
          String(op.count),
          op.totalAreaM2.toFixed(2),
          String(op.unitRate),
          String(op.amount),
        ]);
      }
      rows.push([]);
      rows.push(['Material Order Quantities', 'Net Qty', 'Order Qty', 'Commercial Packaging', 'Est. Cost']);
      for (const ord of summary.orderQuantities) {
        rows.push([
          ord.item,
          `${ord.netQuantity} ${ord.netUnit}`,
          String(ord.orderQuantity),
          ord.commercialUnit,
          String(ord.estimatedCost),
        ]);
      }
      rows.push(['Total Sheet Cost', '', '', '', String(summary.totalCost)]);
    }

    const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(plan?.title || plan?.name || 'architectural').replace(/\s+/g, '_')}_${
      combined ? 'Combined_Plan' : activeSheetName.replace(/\s+/g, '_')
    }_BOQ.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Visual room overlay on CAD canvas + click-to-select/unselect
  const renderRoomOverlay = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      worldToScreen: (wx: number, wy: number) => [number, number]
    ) => {
      for (const rm of rooms) {
        const isSel = selectedRoomId === rm.id;
        const isInc = rm.included !== false;

        if (rm.boundaryPolygon && rm.boundaryPolygon.length >= 3) {
          ctx.save();
          ctx.beginPath();
          rm.boundaryPolygon.forEach(([wx, wy], idx) => {
            const [sx, sy] = worldToScreen(wx, wy);
            if (idx === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          });
          ctx.closePath();

          if (!isInc) {
            ctx.strokeStyle = 'rgba(113, 113, 122, 0.45)';
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1;
            ctx.stroke();
          } else if (isSel) {
            ctx.fillStyle = 'rgba(245, 158, 11, 0.22)';
            ctx.fill();
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 2;
            ctx.stroke();
          } else if (rm.isParapetEnclosed) {
            ctx.fillStyle = 'rgba(14, 165, 233, 0.12)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
            ctx.lineWidth = 1.4;
            ctx.stroke();
          } else if (rm.isVerified) {
            ctx.fillStyle = 'rgba(16, 185, 129, 0.10)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(52, 211, 153, 0.70)';
            ctx.lineWidth = 1.3;
            ctx.stroke();
          } else {
            ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.60)';
            ctx.setLineDash([5, 3]);
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }
          ctx.restore();
          continue;
        }

        if (!rm.bbox) continue;
        const [x1, y1] = worldToScreen(rm.bbox.min_x, rm.bbox.min_y);
        const [x2, y2] = worldToScreen(rm.bbox.max_x, rm.bbox.max_y);
        const rx = Math.min(x1, x2);
        const ry = Math.min(y1, y2);
        const rw = Math.abs(x2 - x1);
        const rh = Math.abs(y2 - y1);
        if (rw < 14 || rh < 10) continue;

        ctx.save();
        if (!isInc) {
          ctx.strokeStyle = 'rgba(113, 113, 122, 0.5)';
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 1;
          ctx.strokeRect(rx, ry, rw, rh);
        } else if (isSel) {
          ctx.fillStyle = 'rgba(245, 158, 11, 0.18)';
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 2;
          ctx.strokeRect(rx, ry, rw, rh);
        } else if (rm.isVerified) {
          ctx.fillStyle = 'rgba(16, 185, 129, 0.08)';
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeStyle = 'rgba(52, 211, 153, 0.65)';
          ctx.lineWidth = 1.2;
          ctx.strokeRect(rx, ry, rw, rh);
        } else {
          ctx.fillStyle = 'rgba(245, 158, 11, 0.07)';
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
          ctx.setLineDash([5, 3]);
          ctx.lineWidth = 1.2;
          ctx.strokeRect(rx, ry, rw, rh);
        }
        ctx.restore();
      }
    },
    [rooms, selectedRoomId]
  );

  // Clicking on the CAD canvas selects or unselects a room, or traces wall boundary
  const handleCanvasClickWorld = useCallback(
    (wx: number, wy: number) => {
      if (pickTarget?.kind === 'traceWallBoundary') {
        const scaleToM = Number(activeRaw?.scale_to_m) || 1.0;
        const res = traceWallBoundaryEnclosure(wx, wy, activeRaw, scaleToM, scanBox, roleOverrides);
        if (res) {
          const newRm: RoomDefinition = {
            id: `rm_wall_${Date.now()}`,
            name: res.isParapetEnclosed ? `Balcony ${rooms.length + 1}` : `Room ${rooms.length + 1}`,
            widthM: res.widthM,
            lengthM: res.lengthM,
            areaM2: res.areaM2,
            perimeterM: res.perimeterM,
            floorFinish: res.isParapetEnclosed ? 'concrete' : 'vitrified_tile',
            included: true,
            derivationMethod: 'wall_enclosure',
            dimensionText: res.isParapetEnclosed
              ? `Parapet Balcony (${res.areaM2} m² · ${res.parapetLengthM}m parapet)`
              : `Wall Enclosure (${res.widthM.toFixed(2)}m × ${res.lengthM.toFixed(2)}m)`,
            isVerified: true,
            bbox: res.bbox,
            boundaryPolygon: res.boundaryPolygon,
            parapetLengthM: res.parapetLengthM,
            isParapetEnclosed: res.isParapetEnclosed,
          };
          setRooms((prev) => [...prev, newRm]);
          setSelectedRoomId(newRm.id);
          showToast(
            `Traced wall boundary: ${res.areaM2} m² (${res.isParapetEnclosed ? 'Balcony' : 'Enclosure'})`
          );
        } else {
          showToast('No closed wall boundary found around click point. Check wall layers or crop box.');
        }
        setPickTarget(null);
        return true;
      }

      const hit = rooms.find((r) => {
        if (r.boundaryPolygon && r.boundaryPolygon.length >= 3) {
          return pointInPoly(wx, wy, r.boundaryPolygon);
        }
        return (
          r.bbox &&
          wx >= r.bbox.min_x &&
          wx <= r.bbox.max_x &&
          wy >= r.bbox.min_y &&
          wy <= r.bbox.max_y
        );
      });
      if (hit) {
        setSelectedRoomId((prev) => (prev === hit.id ? null : hit.id));
        setHighlightedMark((prev) => (prev === hit.name ? null : hit.name));
        return true;
      }
      if (selectedRoomId || highlightedMark) {
        setSelectedRoomId(null);
        setHighlightedMark(null);
      }
      return false;
    },
    [rooms, selectedRoomId, highlightedMark, pickTarget, activeRaw, scanBox, roleOverrides, showToast]
  );

  const activeRoomsCount = rooms.filter((r) => r.included !== false).length;
  const unverifiedRoomsCount = rooms.filter((r) => r.included !== false && !r.isVerified).length;

  const auditChecks = useMemo(() => {
    const openingRatio =
      summary.grossWallAreaM2 > 0
        ? (summary.totalOpeningsAreaM2 / summary.grossWallAreaM2) * 100
        : 0;
    return [
      {
        ok: unverifiedRoomsCount === 0 && activeRoomsCount > 0,
        title: 'Room geometry verification check',
        detail:
          unverifiedRoomsCount === 0
            ? `All ${activeRoomsCount} included room(s) have verified CAD geometry (${summary.totalFlooringAreaM2.toFixed(1)} m²)`
            : `${unverifiedRoomsCount} room(s) lacked explicit CAD dimension tags — click "Verify on CAD" in Step 2 to confirm`,
      },
      {
        ok: openingRatio <= 45,
        title: 'IS 1200 Part 3 opening deduction check',
        detail: `${summary.doorsCount} doors, ${summary.windowsCount} windows, ${summary.ventilatorsCount} ventilators deduct ${summary.totalOpeningsAreaM2.toFixed(
          1
        )} m² (${openingRatio.toFixed(1)}% of gross wall area)`,
      },
      {
        ok: activeSheetId !== 'all' || sheets.length <= 1,
        title: 'Sheet-scoped wall measurement check',
        detail:
          activeSheetId !== 'all' || sheets.length <= 1
            ? `Scoped to "${activeSheetName}" (Ext ${params.extWallLengthM}m · Int ${params.intWallLengthM}m)`
            : 'Currently viewing All Sheets Combined — select an individual floor sheet in the dropdown to avoid summing multiple floors',
      },
    ];
  }, [
    unverifiedRoomsCount,
    activeRoomsCount,
    summary,
    activeSheetId,
    sheets.length,
    activeSheetName,
    params.extWallLengthM,
    params.intWallLengthM,
  ]);

  return (
    <div className="h-screen w-screen bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden select-none">
      {/* Top Bar */}
      <header className="h-12 shrink-0 border-b border-white/[0.08] bg-zinc-950 px-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-zinc-300 hover:text-white hover:bg-zinc-900 border border-white/[0.08] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back</span>
          </button>
          <div className="h-4 w-px bg-white/[0.08]" />
          <div className="min-w-0 flex items-center gap-2">
            <h1 className="text-sm font-medium text-zinc-100 truncate">
              {plan?.title || plan?.name || 'Architectural takeoff'}
            </h1>
            <span className="text-[11px] text-amber-300 px-2 py-0.5 rounded bg-amber-400/10 border border-amber-400/30 truncate max-w-[180px]">
              {activeSheetName}
            </span>
          </div>
        </div>

        {/* Summary KPIs */}
        <div className="hidden xl:flex items-center gap-5 text-xs tabular-nums">
          <div>
            <span className="text-zinc-500 mr-1.5">Flooring</span>
            <span className="text-zinc-100 font-medium">{summary.totalFlooringAreaM2.toFixed(1)} m²</span>
          </div>
          <div>
            <span className="text-zinc-500 mr-1.5">Masonry</span>
            <span className="text-zinc-100 font-medium">{summary.totalMasonryVolumeM3.toFixed(1)} m³</span>
          </div>
          <div>
            <span className="text-zinc-500 mr-1.5">Doors / Win</span>
            <span className="text-zinc-100 font-medium">
              {summary.doorsCount}D · {summary.windowsCount}W
            </span>
          </div>
          <div>
            <span className="text-zinc-500 mr-1.5">Sheet Total</span>
            <span className="text-amber-400 font-medium">
              {params.currency}
              {summary.totalCost.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <VersionHistoryControl
            versions={versions}
            currency={params.currency}
            onRestoreVersion={handleRestoreVersion}
          />
          <button
            onClick={() => handleExportCsv(takeoffSubTab === 'combined')}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] transition-colors"
            title="Export CSV"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">CSV</span>
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 hover:bg-white text-zinc-950 transition-colors disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Saving...' : 'Save estimate'}</span>
          </button>
        </div>
      </header>

      {/* Main Split Workstation */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Interactive CAD Viewport */}
        <div className="lg:w-[55%] h-[45vh] lg:h-full border-b lg:border-b-0 lg:border-r border-white/[0.08] relative">
          <CadEstimatorCanvas
            rawData={activeRaw}
            sheets={sheets}
            activeSheetId={activeSheetId}
            onSelectSheetId={handleSelectSheet}
            highlightedLayers={highlightedLayers}
            highlightedMark={highlightedMark}
            layoutBox={scanBox}
            boxSelectLabel={
              isSelectingBox ? 'Drag box around floor plan area to scope walls & rooms' : null
            }
            onBoxSelected={(bbox) => {
              setScanBox(bbox);
              setIsSelectingBox(false);
              runCadInference(activeRaw, bbox, roleOverrides, false);
            }}
            twoPointPickLabel={
              pickTarget && pickTarget.kind !== 'traceWallBoundary' ? pickTarget.label : null
            }
            singlePointPickLabel={
              pickTarget && pickTarget.kind === 'traceWallBoundary' ? pickTarget.label : null
            }
            twoPointPickIsRect={
              pickTarget?.kind === 'verifyRoomRect' || pickTarget?.kind === 'newRoomRect'
            }
            onTwoPointPicked={(distM, p1, p2) => {
              if (!pickTarget) return;
              const scaleToM = Number(activeRaw?.scale_to_m) || 1.0;
              const wM = Math.round(Math.abs(p2[0] - p1[0]) * scaleToM * 100) / 100;
              const hM = Math.round(Math.abs(p2[1] - p1[1]) * scaleToM * 100) / 100;
              const rectBbox: WorldBBox = {
                min_x: Math.min(p1[0], p2[0]),
                min_y: Math.min(p1[1], p2[1]),
                max_x: Math.max(p1[0], p2[0]),
                max_y: Math.max(p1[1], p2[1]),
              };

              if (pickTarget.kind === 'verifyRoomRect' && pickTarget.roomId) {
                const area = Math.round(wM * hM * 100) / 100;
                const perim = Math.round(2 * (wM + hM) * 100) / 100;
                setRooms((prev) =>
                  prev.map((r) =>
                    r.id === pickTarget.roomId
                      ? {
                          ...r,
                          widthM: wM,
                          lengthM: hM,
                          areaM2: area > 0.2 ? area : r.areaM2,
                          perimeterM: perim > 0.5 ? perim : r.perimeterM,
                          derivationMethod: 'user_picked',
                          dimensionText: `CAD Picked (${wM.toFixed(2)}m × ${hM.toFixed(2)}m)`,
                          isVerified: true,
                          included: true,
                          bbox: rectBbox,
                        }
                      : r
                  )
                );
                showToast(`Verified room: ${wM.toFixed(2)}m × ${hM.toFixed(2)}m = ${area.toFixed(2)} m²`);
              } else if (pickTarget.kind === 'newRoomRect') {
                const area = Math.round(wM * hM * 100) / 100;
                const perim = Math.round(2 * (wM + hM) * 100) / 100;
                const newRm: RoomDefinition = {
                  id: `rm_pick_${Date.now()}`,
                  name: `Room ${rooms.length + 1}`,
                  widthM: wM,
                  lengthM: hM,
                  areaM2: area,
                  perimeterM: perim,
                  floorFinish: 'vitrified_tile',
                  included: true,
                  derivationMethod: 'user_picked',
                  dimensionText: `CAD Picked (${wM.toFixed(2)}m × ${hM.toFixed(2)}m)`,
                  isVerified: true,
                  bbox: rectBbox,
                };
                setRooms((prev) => [...prev, newRm]);
                setSelectedRoomId(newRm.id);
                showToast(`Added room from CAD: ${area.toFixed(2)} m²`);
              } else if (pickTarget.kind === 'extWall') {
                updateParam('extWallLengthM', Math.round((params.extWallLengthM + distM) * 10) / 10);
                showToast(`Added ${distM.toFixed(2)} m to external wall length`);
              } else if (pickTarget.kind === 'intWall') {
                updateParam('intWallLengthM', Math.round((params.intWallLengthM + distM) * 10) / 10);
                showToast(`Added ${distM.toFixed(2)} m to internal wall length`);
              } else if (pickTarget.kind === 'parapetWall') {
                updateParam(
                  'parapetWallLengthM',
                  Math.round(((params.parapetWallLengthM || 0) + distM) * 10) / 10
                );
                showToast(`Added ${distM.toFixed(2)} m to parapet wall length`);
              } else if (pickTarget.kind === 'roomPerim' && pickTarget.roomId) {
                setRooms((prev) =>
                  prev.map((r) =>
                    r.id === pickTarget.roomId
                      ? { ...r, perimeterM: Math.round(distM * 100) / 100 }
                      : r
                  )
                );
                showToast(`Updated room perimeter to ${distM.toFixed(2)} m`);
              }
              setPickTarget(null);
            }}
            onClickWorld={handleCanvasClickWorld}
            renderCustomOverlay={renderRoomOverlay}
            onCancelExternalTool={() => {
              setIsSelectingBox(false);
              setPickTarget(null);
            }}
          />
        </div>

        {/* Right 4-Step Guided Panel */}
        <div className="lg:w-[45%] flex-1 flex flex-col bg-zinc-950 overflow-hidden">
          {/* Stepper */}
          <div className="shrink-0 grid grid-cols-4 border-b border-white/[0.08] bg-zinc-900/50">
            {(
              [
                { id: 'scope', num: '1', label: 'Sheet & layers' },
                { id: 'elements', num: '2', label: 'Rooms & openings' },
                { id: 'specs', num: '3', label: 'Specs & rates' },
                { id: 'takeoff', num: '4', label: 'BOQ & reports' },
              ] as { id: ArchStep; num: string; label: string }[]
            ).map((s) => {
              const active = step === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setStep(s.id)}
                  className={`py-2.5 px-2 text-xs font-medium border-b-2 transition-colors flex items-center justify-center gap-1.5 ${
                    active
                      ? 'border-amber-400 text-zinc-100 bg-zinc-900'
                      : 'border-transparent text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded text-[10px] inline-flex items-center justify-center tabular-nums ${
                      active ? 'bg-amber-400 text-zinc-950 font-semibold' : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {s.num}
                  </span>
                  <span className="truncate">{s.label}</span>
                </button>
              );
            })}
          </div>

          {/* Step Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {step === 'scope' && (
              <>
                <div className="p-3.5 rounded-xl bg-zinc-900/70 border border-white/[0.08] space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xs font-medium text-zinc-100">
                        Active scope: {activeSheetName}
                      </h2>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        Wall lengths, room enclosures, and door/window tags are measured strictly within the selected sheet or cropped box
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => setIsSelectingBox((v) => !v)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
                          isSelectingBox
                            ? 'bg-amber-400/15 text-amber-300 border-amber-400/40'
                            : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border-white/[0.08]'
                        }`}
                      >
                        <Crop className="w-3.5 h-3.5" />
                        <span>{scanBox ? 'Re-crop area' : 'Crop area'}</span>
                      </button>
                      {scanBox && (
                        <button
                          onClick={() => {
                            setScanBox(null);
                            runCadInference(activeRaw, null, roleOverrides, false);
                          }}
                          className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-white/[0.08]"
                          title="Clear crop region"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => runCadInference(activeRaw, scanBox, roleOverrides, false)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-amber-400 hover:bg-amber-300 text-zinc-950 transition-colors"
                      >
                        <Scan className="w-3.5 h-3.5" />
                        <span>Scan sheet</span>
                      </button>
                    </div>
                  </div>

                  {lastScanNote && (
                    <div className="text-[11px] text-zinc-300 bg-zinc-950/80 border border-white/[0.06] rounded-lg px-3 py-2 tabular-nums">
                      {lastScanNote}
                    </div>
                  )}
                </div>

                {/* CAD Layer Classification Table */}
                <div className="rounded-xl border border-white/[0.08] bg-zinc-900/40 overflow-hidden">
                  <div className="px-3.5 py-2.5 border-b border-white/[0.08] flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-medium text-zinc-200">
                      <Layers className="w-3.5 h-3.5 text-zinc-400" />
                      <span>Sheet CAD layers ({layerStats.length})</span>
                    </div>
                    {highlightedLayers.length > 0 && (
                      <button
                        onClick={() => setHighlightedLayers([])}
                        className="text-[11px] text-amber-400 hover:underline"
                      >
                        Clear highlight
                      </button>
                    )}
                  </div>
                  <div className="max-h-[340px] overflow-y-auto divide-y divide-white/[0.05]">
                    {layerStats.length === 0 ? (
                      <div className="p-6 text-center text-xs text-zinc-500">
                        No CAD vector layers detected on this sheet.
                      </div>
                    ) : (
                      layerStats.map((st) => {
                        const isHi = highlightedLayers.includes(st.name);
                        return (
                          <div
                            key={st.name}
                            onClick={() =>
                              setHighlightedLayers((prev) =>
                                prev.includes(st.name) ? [] : [st.name]
                              )
                            }
                            className={`px-3.5 py-2 flex items-center justify-between gap-2 text-xs cursor-pointer transition-colors ${
                              isHi ? 'bg-amber-400/10' : 'hover:bg-zinc-900/80'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className="w-2.5 h-2.5 rounded-sm shrink-0 border border-white/20"
                                style={{ backgroundColor: st.color }}
                              />
                              <span className="text-zinc-200 truncate font-mono text-[11px]">
                                {st.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 tabular-nums">
                              <span className="text-[11px] text-zinc-400">
                                {st.lineLengthM > 0 ? `${st.lineLengthM} m` : `${st.entityCount} ent`}
                              </span>
                              <select
                                value={st.inferredRole}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => handleRoleChange(st.name, e.target.value)}
                                className="bg-zinc-950 text-zinc-200 text-[11px] rounded-md px-2 py-1 border border-white/[0.08] focus:outline-none focus:border-amber-400"
                              >
                                {ARCH_ROLE_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </>
            )}

            {step === 'elements' && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex rounded-lg p-0.5 bg-zinc-900 border border-white/[0.08]">
                    <button
                      onClick={() => setElementSubTab('rooms')}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors tabular-nums ${
                        elementSubTab === 'rooms'
                          ? 'bg-zinc-800 text-zinc-100'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Rooms ({activeRoomsCount}/{rooms.length})
                    </button>
                    <button
                      onClick={() => setElementSubTab('openings')}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors tabular-nums ${
                        elementSubTab === 'openings'
                          ? 'bg-zinc-800 text-zinc-100'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Doors & Windows ({summary.doorsCount + summary.windowsCount + summary.ventilatorsCount})
                    </button>
                  </div>

                  {elementSubTab === 'rooms' ? (
                    <div className="flex items-center gap-1.5">
                      {(selectedRoomId || highlightedMark) && (
                        <button
                          onClick={() => {
                            setSelectedRoomId(null);
                            setHighlightedMark(null);
                            setHighlightedLayers([]);
                          }}
                          className="px-2 py-1.5 rounded-lg text-[11px] text-zinc-400 hover:text-white bg-zinc-900 border border-white/[0.08]"
                        >
                          Unselect highlight
                        </button>
                      )}
                      <button
                        onClick={() => {
                          const anyUnchecked = rooms.some((r) => r.included === false);
                          setRooms((prev) => prev.map((r) => ({ ...r, included: anyUnchecked })));
                        }}
                        className="px-2 py-1.5 rounded-lg text-[11px] text-zinc-300 hover:text-white bg-zinc-900 border border-white/[0.08]"
                      >
                        {rooms.some((r) => r.included === false) ? 'Select all' : 'Unselect all'}
                      </button>
                      <button
                        onClick={() =>
                          setPickTarget({
                            kind: 'traceWallBoundary',
                            label: 'Click inside any room or balcony to trace wall/parapet boundary',
                          })
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-500 hover:bg-emerald-400 text-zinc-950"
                        title="Click inside room or balcony on CAD to auto-trace wall/parapet boundary"
                      >
                        <Scan className="w-3.5 h-3.5" />
                        <span>Trace boundary</span>
                      </button>
                      <button
                        onClick={() =>
                          setPickTarget({
                            kind: 'newRoomRect',
                            label: 'Click 2 opposite room corners on CAD (OSNAP) to add room',
                          })
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-white/[0.08]"
                        title="Pick 2 corners for rectangular room"
                      >
                        <Crosshair className="w-3.5 h-3.5" />
                        <span>2-Point box</span>
                      </button>
                      <button
                        onClick={() =>
                          setRooms((prev) => [
                            ...prev,
                            {
                              id: `rm_${Date.now()}`,
                              name: `Room ${prev.length + 1}`,
                              areaM2: 12.0,
                              perimeterM: 14.0,
                              floorFinish: 'vitrified_tile',
                              included: true,
                              derivationMethod: 'manual',
                              isVerified: true,
                            },
                          ])
                        }
                        className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-white/[0.08]"
                        title="Add blank room row"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() =>
                        setOpenings((prev) => [
                          ...prev,
                          {
                            id: `op_${Date.now()}`,
                            mark: `D${prev.length + 1}`,
                            type: 'door',
                            widthM: 0.9,
                            heightM: 2.1,
                            count: 1,
                            included: true,
                          },
                        ])
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-white/[0.08]"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add door / window</span>
                    </button>
                  )}
                </div>

                {elementSubTab === 'rooms' ? (
                  <div className="space-y-2">
                    {rooms.map((rm) => {
                      const isInc = rm.included !== false;
                      const isSel = selectedRoomId === rm.id;
                      return (
                        <div
                          key={rm.id}
                          onClick={() => {
                            if (isSel) {
                              setSelectedRoomId(null);
                              setHighlightedMark(null);
                            } else {
                              setSelectedRoomId(rm.id);
                              setHighlightedMark(rm.name);
                              if (rm.sourceLayer) setHighlightedLayers([rm.sourceLayer]);
                            }
                          }}
                          className={`p-3 rounded-xl border space-y-2 transition-colors cursor-pointer ${
                            !isInc
                              ? 'bg-zinc-950/50 border-white/[0.04] opacity-55'
                              : isSel
                              ? 'bg-amber-400/10 border-amber-400/40'
                              : 'bg-zinc-900/60 hover:bg-zinc-900 border-white/[0.08]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <input
                                type="checkbox"
                                checked={isInc}
                                title="Include room in takeoff"
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) =>
                                  setRooms((prev) =>
                                    prev.map((r) =>
                                      r.id === rm.id ? { ...r, included: e.target.checked } : r
                                    )
                                  )
                                }
                                className="w-3.5 h-3.5 accent-amber-400 rounded cursor-pointer shrink-0"
                              />
                              <input
                                value={rm.name}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) =>
                                  setRooms((prev) =>
                                    prev.map((r) =>
                                      r.id === rm.id ? { ...r, name: e.target.value } : r
                                    )
                                  )
                                }
                                className="bg-zinc-950 text-xs font-medium text-zinc-100 px-2 py-1 rounded-md border border-white/[0.08] flex-1 min-w-0"
                              />
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                              {rm.boundaryPolygon && rm.boundaryPolygon.length > 2 && (
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                                  {rm.boundaryPolygon.length}-pt poly
                                </span>
                              )}
                              {Boolean(rm.parapetLengthM && rm.parapetLengthM > 0) && (
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">
                                  Parapet {rm.parapetLengthM!.toFixed(1)}m
                                </span>
                              )}
                              <span
                                className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                                  rm.isVerified
                                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                                    : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                }`}
                              >
                                {rm.dimensionText || (rm.isVerified ? 'Verified' : 'Verify on CAD')}
                              </span>
                              <button
                                type="button"
                                title="Click inside room on CAD to trace surrounding walls/parapets"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPickTarget({
                                    kind: 'traceWallBoundary',
                                    roomId: rm.id,
                                    label: `Click inside "${rm.name}" on CAD to trace wall boundary`,
                                  });
                                }}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 hover:bg-emerald-400 hover:text-zinc-950 text-zinc-200 text-[11px] font-medium transition-colors"
                              >
                                <Scan className="w-3 h-3" />
                                <span>Trace</span>
                              </button>
                              <button
                                type="button"
                                title="Verify / Measure exact room corners on CAD (OSNAP)"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPickTarget({
                                    kind: 'verifyRoomRect',
                                    roomId: rm.id,
                                    label: `Click 2 opposite corners of "${rm.name}" on CAD`,
                                  });
                                }}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 hover:bg-amber-400 hover:text-zinc-950 text-zinc-200 text-[11px] font-medium transition-colors"
                              >
                                <Crosshair className="w-3 h-3" />
                                <span>2-pt box</span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRooms((prev) => prev.filter((r) => r.id !== rm.id));
                                }}
                                className="p-1 text-zinc-500 hover:text-rose-400"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          <div
                            className="grid grid-cols-3 gap-2 text-xs tabular-nums"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <label className="space-y-1">
                              <span className="text-[11px] text-zinc-400">
                                Area (m² · {Math.round(rm.areaM2 * 10.7639)} sq.ft)
                              </span>
                              <input
                                type="number"
                                step="0.1"
                                value={rm.areaM2}
                                onChange={(e) =>
                                  setRooms((prev) =>
                                    prev.map((r) =>
                                      r.id === rm.id
                                        ? {
                                            ...r,
                                            areaM2: Number(e.target.value) || 0,
                                            isVerified: true,
                                          }
                                        : r
                                    )
                                  )
                                }
                                className="w-full bg-zinc-950 text-zinc-100 px-2 py-1 rounded border border-white/[0.08]"
                              />
                            </label>
                            <label className="space-y-1">
                              <span className="text-[11px] text-zinc-400">Perimeter (m)</span>
                              <div className="flex gap-1">
                                <input
                                  type="number"
                                  step="0.1"
                                  value={rm.perimeterM}
                                  onChange={(e) =>
                                    setRooms((prev) =>
                                      prev.map((r) =>
                                        r.id === rm.id
                                          ? { ...r, perimeterM: Number(e.target.value) || 0 }
                                          : r
                                      )
                                    )
                                  }
                                  className="w-full bg-zinc-950 text-zinc-100 px-2 py-1 rounded border border-white/[0.08]"
                                />
                                <button
                                  type="button"
                                  title="Pick length on CAD"
                                  onClick={() =>
                                    setPickTarget({
                                      kind: 'roomPerim',
                                      roomId: rm.id,
                                      label: `Pick perimeter length for ${rm.name}`,
                                    })
                                  }
                                  className="px-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                                >
                                  <Ruler className="w-3 h-3" />
                                </button>
                              </div>
                            </label>
                            <label className="space-y-1">
                              <span className="text-[11px] text-zinc-400">Finish</span>
                              <select
                                value={rm.floorFinish}
                                onChange={(e) =>
                                  setRooms((prev) =>
                                    prev.map((r) =>
                                      r.id === rm.id
                                        ? { ...r, floorFinish: e.target.value as FloorFinishType }
                                        : r
                                    )
                                  )
                                }
                                className="w-full bg-zinc-950 text-zinc-100 px-2 py-1 rounded border border-white/[0.08]"
                              >
                                <option value="vitrified_tile">Vitrified tile</option>
                                <option value="marble">Marble</option>
                                <option value="granite">Granite</option>
                                <option value="wooden">Wooden</option>
                                <option value="concrete">IPS / Concrete</option>
                              </select>
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-6 gap-2 px-3 text-[11px] text-zinc-400">
                      <span>Mark</span>
                      <span>Type</span>
                      <span>Width (m)</span>
                      <span>Height (m)</span>
                      <span>Count</span>
                      <span className="text-right">Area</span>
                    </div>
                    {openings.map((op) => {
                      const isInc = op.included !== false;
                      return (
                        <div
                          key={op.id}
                          onClick={() => {
                            setHighlightedMark((prev) => (prev === op.mark ? null : op.mark));
                            if (op.sourceLayer) setHighlightedLayers([op.sourceLayer]);
                          }}
                          className={`p-2.5 rounded-xl border transition-colors cursor-pointer ${
                            !isInc
                              ? 'bg-zinc-950/50 border-white/[0.04] opacity-55'
                              : 'bg-zinc-900/60 hover:bg-zinc-900 border-white/[0.08]'
                          }`}
                        >
                          <div
                            className="grid grid-cols-6 gap-2 items-center text-xs tabular-nums"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={isInc}
                                onChange={(e) =>
                                  setOpenings((prev) =>
                                    prev.map((o) =>
                                      o.id === op.id ? { ...o, included: e.target.checked } : o
                                    )
                                  )
                                }
                                className="w-3.5 h-3.5 accent-amber-400 rounded"
                              />
                              <input
                                value={op.mark}
                                onChange={(e) =>
                                  setOpenings((prev) =>
                                    prev.map((o) =>
                                      o.id === op.id ? { ...o, mark: e.target.value } : o
                                    )
                                  )
                                }
                                className="w-full bg-zinc-950 text-zinc-100 font-mono px-2 py-1 rounded border border-white/[0.08]"
                              />
                            </div>
                            <select
                              value={op.type}
                              onChange={(e) =>
                                setOpenings((prev) =>
                                  prev.map((o) =>
                                    o.id === op.id
                                      ? { ...o, type: e.target.value as OpeningType }
                                      : o
                                  )
                                )
                              }
                              className="bg-zinc-950 text-zinc-100 px-2 py-1 rounded border border-white/[0.08]"
                            >
                              <option value="door">Door</option>
                              <option value="window">Window</option>
                              <option value="ventilator">Ventilator</option>
                            </select>
                            <input
                              type="number"
                              step="0.05"
                              value={op.widthM}
                              onChange={(e) =>
                                setOpenings((prev) =>
                                  prev.map((o) =>
                                    o.id === op.id
                                      ? { ...o, widthM: Number(e.target.value) || 0 }
                                      : o
                                  )
                                )
                              }
                              className="bg-zinc-950 text-zinc-100 px-2 py-1 rounded border border-white/[0.08]"
                            />
                            <input
                              type="number"
                              step="0.05"
                              value={op.heightM}
                              onChange={(e) =>
                                setOpenings((prev) =>
                                  prev.map((o) =>
                                    o.id === op.id
                                      ? { ...o, heightM: Number(e.target.value) || 0 }
                                      : o
                                  )
                                )
                              }
                              className="bg-zinc-950 text-zinc-100 px-2 py-1 rounded border border-white/[0.08]"
                            />
                            <input
                              type="number"
                              min="0"
                              value={op.count}
                              onChange={(e) =>
                                setOpenings((prev) =>
                                  prev.map((o) =>
                                    o.id === op.id
                                      ? { ...o, count: Number(e.target.value) || 0 }
                                      : o
                                  )
                                )
                              }
                              className="bg-zinc-950 text-zinc-100 px-2 py-1 rounded border border-white/[0.08]"
                            />
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-[11px] text-zinc-300 font-mono">
                                {(op.widthM * op.heightM * op.count).toFixed(1)}m²
                              </span>
                              <button
                                onClick={() =>
                                  setOpenings((prev) => prev.filter((o) => o.id !== op.id))
                                }
                                className="p-1 text-zinc-500 hover:text-rose-400"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {step === 'specs' && (
              <div className="space-y-4 text-xs tabular-nums">
                <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-white/[0.08] space-y-3">
                  <h3 className="font-medium text-zinc-200">
                    Sheet wall geometry & masonry unit ({activeSheetName})
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1">
                      <span className="text-zinc-400">Floor height (m)</span>
                      <input
                        type="number"
                        step="0.05"
                        value={params.floorHeightM}
                        onChange={(e) => updateParam('floorHeightM', Number(e.target.value) || 3)}
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">Block / brick type</span>
                      <select
                        value={params.blockType}
                        onChange={(e) => updateParam('blockType', e.target.value as BlockType)}
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      >
                        <option value="aac">AAC block (600×200)</option>
                        <option value="clay_brick">Clay brick (230×115×75)</option>
                        <option value="concrete_block">Solid concrete block</option>
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">External wall length (m)</span>
                      <div className="flex gap-1">
                        <input
                          type="number"
                          step="0.5"
                          value={params.extWallLengthM}
                          onChange={(e) =>
                            updateParam('extWallLengthM', Number(e.target.value) || 0)
                          }
                          className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setPickTarget({
                              kind: 'extWall',
                              label: 'Click 2 points on CAD to add external wall segment',
                            })
                          }
                          className="px-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                          title="Measure & add from CAD"
                        >
                          <Ruler className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">Internal wall length (m)</span>
                      <div className="flex gap-1">
                        <input
                          type="number"
                          step="0.5"
                          value={params.intWallLengthM}
                          onChange={(e) =>
                            updateParam('intWallLengthM', Number(e.target.value) || 0)
                          }
                          className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setPickTarget({
                              kind: 'intWall',
                              label: 'Click 2 points on CAD to add internal wall segment',
                            })
                          }
                          className="px-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                          title="Measure & add from CAD"
                        >
                          <Ruler className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">Ext wall thickness (m)</span>
                      <input
                        type="number"
                        step="0.015"
                        value={params.extWallThicknessM}
                        onChange={(e) =>
                          updateParam('extWallThicknessM', Number(e.target.value) || 0.23)
                        }
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">Int wall thickness (m)</span>
                      <input
                        type="number"
                        step="0.015"
                        value={params.intWallThicknessM}
                        onChange={(e) =>
                          updateParam('intWallThicknessM', Number(e.target.value) || 0.115)
                        }
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">Parapet wall length (m)</span>
                      <div className="flex gap-1">
                        <input
                          type="number"
                          step="0.5"
                          value={params.parapetWallLengthM ?? 0}
                          onChange={(e) =>
                            updateParam('parapetWallLengthM', Number(e.target.value) || 0)
                          }
                          className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setPickTarget({
                              kind: 'parapetWall',
                              label: 'Click 2 points on CAD to add parapet wall segment',
                            })
                          }
                          className="px-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                          title="Measure & add parapet from CAD"
                        >
                          <Ruler className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">Parapet height (m)</span>
                      <input
                        type="number"
                        step="0.1"
                        value={params.parapetWallHeightM ?? 1.0}
                        onChange={(e) =>
                          updateParam('parapetWallHeightM', Number(e.target.value) || 1.0)
                        }
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">Parapet thickness (m)</span>
                      <input
                        type="number"
                        step="0.015"
                        value={params.parapetWallThicknessM ?? 0.115}
                        onChange={(e) =>
                          updateParam('parapetWallThicknessM', Number(e.target.value) || 0.115)
                        }
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-white/[0.08] space-y-3">
                  <h3 className="font-medium text-zinc-200">Unit rates ({params.currency})</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1">
                      <span className="text-zinc-400">Masonry / m³</span>
                      <input
                        type="number"
                        value={params.masonryRatePerM3}
                        onChange={(e) =>
                          updateParam('masonryRatePerM3', Number(e.target.value) || 0)
                        }
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">Parapet masonry / m³</span>
                      <input
                        type="number"
                        value={params.parapetMasonryRatePerM3 ?? params.masonryRatePerM3}
                        onChange={(e) =>
                          updateParam('parapetMasonryRatePerM3', Number(e.target.value) || 0)
                        }
                        placeholder={String(params.masonryRatePerM3)}
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">Plaster / m²</span>
                      <input
                        type="number"
                        value={params.plasterRatePerM2}
                        onChange={(e) =>
                          updateParam('plasterRatePerM2', Number(e.target.value) || 0)
                        }
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">Paint / m²</span>
                      <input
                        type="number"
                        value={params.paintRatePerM2}
                        onChange={(e) =>
                          updateParam('paintRatePerM2', Number(e.target.value) || 0)
                        }
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">Flooring / m²</span>
                      <input
                        type="number"
                        value={params.flooringRatePerM2}
                        onChange={(e) =>
                          updateParam('flooringRatePerM2', Number(e.target.value) || 0)
                        }
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">Doors / m²</span>
                      <input
                        type="number"
                        value={params.doorRatePerM2 ?? 4200}
                        onChange={(e) => updateParam('doorRatePerM2', Number(e.target.value) || 0)}
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">Windows / m²</span>
                      <input
                        type="number"
                        value={params.windowRatePerM2 ?? 3600}
                        onChange={(e) =>
                          updateParam('windowRatePerM2', Number(e.target.value) || 0)
                        }
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}

            {step === 'takeoff' && (
              <div className="space-y-4">
                {/* Step 4 Sub-navigation: Sheet BOQ vs Order Quantities vs Combined Plan Report */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex rounded-lg p-0.5 bg-zinc-900 border border-white/[0.08]">
                    <button
                      onClick={() => setTakeoffSubTab('boq')}
                      className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        takeoffSubTab === 'boq'
                          ? 'bg-zinc-800 text-zinc-100'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Sheet BOQ & Openings
                    </button>
                    <button
                      onClick={() => setTakeoffSubTab('orders')}
                      className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors inline-flex items-center gap-1 ${
                        takeoffSubTab === 'orders'
                          ? 'bg-zinc-800 text-zinc-100'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <PackageCheck className="w-3.5 h-3.5" />
                      <span>Order quantities</span>
                    </button>
                    <button
                      onClick={() => setTakeoffSubTab('combined')}
                      className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors inline-flex items-center gap-1 ${
                        takeoffSubTab === 'combined'
                          ? 'bg-amber-400 text-zinc-950'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span>Combined plan ({allSheetRecords.length})</span>
                    </button>
                  </div>
                </div>

                {takeoffSubTab === 'boq' && (
                  <>
                    {/* Civil Bill of Quantities */}
                    <div className="rounded-xl border border-white/[0.08] bg-zinc-900/50 overflow-hidden">
                      <div className="px-3.5 py-2.5 border-b border-white/[0.08] flex items-center justify-between">
                        <div>
                          <span className="text-xs font-medium text-zinc-200">
                            Sheet BOQ — {activeSheetName}
                          </span>
                        </div>
                        <span className="text-xs font-semibold text-amber-400 tabular-nums">
                          {params.currency}
                          {summary.totalCost.toLocaleString()}
                        </span>
                      </div>
                      <table className="w-full text-xs tabular-nums">
                        <thead className="text-zinc-400 border-b border-white/[0.06] text-left">
                          <tr>
                            <th className="py-2 px-3 font-normal">Work item</th>
                            <th className="py-2 px-2 font-normal text-right">Qty</th>
                            <th className="py-2 px-3 font-normal text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.05]">
                          <tr>
                            <td className="py-2 px-3 text-zinc-200">
                              Masonry ({summary.totalBlocksRequired.toLocaleString()} units)
                            </td>
                            <td className="py-2 px-2 text-right text-zinc-300">
                              {summary.totalMasonryVolumeM3.toFixed(2)} m³
                            </td>
                            <td className="py-2 px-3 text-right text-zinc-100">
                              {params.currency}
                              {Math.round(
                                summary.totalMasonryVolumeM3 * params.masonryRatePerM3
                              ).toLocaleString()}
                            </td>
                          </tr>
                          <tr>
                            <td className="py-2 px-3 text-zinc-200">Internal & ceiling plaster</td>
                            <td className="py-2 px-2 text-right text-zinc-300">
                              {summary.internalPlasterAreaM2.toFixed(1)} m²
                            </td>
                            <td className="py-2 px-3 text-right text-zinc-100">
                              {params.currency}
                              {Math.round(
                                summary.internalPlasterAreaM2 * params.plasterRatePerM2
                              ).toLocaleString()}
                            </td>
                          </tr>
                          <tr>
                            <td className="py-2 px-3 text-zinc-200">External sand-faced plaster</td>
                            <td className="py-2 px-2 text-right text-zinc-300">
                              {summary.externalPlasterAreaM2.toFixed(1)} m²
                            </td>
                            <td className="py-2 px-3 text-right text-zinc-100">
                              {params.currency}
                              {Math.round(
                                summary.externalPlasterAreaM2 * params.plasterRatePerM2
                              ).toLocaleString()}
                            </td>
                          </tr>
                          <tr>
                            <td className="py-2 px-3 text-zinc-200">Interior & exterior paint</td>
                            <td className="py-2 px-2 text-right text-zinc-300">
                              {(
                                summary.internalPlasterAreaM2 + summary.externalPlasterAreaM2
                              ).toFixed(1)}{' '}
                              m²
                            </td>
                            <td className="py-2 px-3 text-right text-zinc-100">
                              {params.currency}
                              {Math.round(
                                (summary.internalPlasterAreaM2 + summary.externalPlasterAreaM2) *
                                  params.paintRatePerM2
                              ).toLocaleString()}
                            </td>
                          </tr>
                          <tr>
                            <td className="py-2 px-3 text-zinc-200">
                              Flooring ({activeRoomsCount} rooms) + {summary.totalSkirtingLengthM.toFixed(1)}m skirting
                            </td>
                            <td className="py-2 px-2 text-right text-zinc-300">
                              {summary.totalFlooringAreaM2.toFixed(1)} m²
                            </td>
                            <td className="py-2 px-3 text-right text-zinc-100">
                              {params.currency}
                              {Math.round(
                                summary.totalFlooringAreaM2 * params.flooringRatePerM2
                              ).toLocaleString()}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* Itemized Door & Window Schedule in BOQ */}
                    <div className="rounded-xl border border-white/[0.08] bg-zinc-900/50 overflow-hidden">
                      <div className="px-3.5 py-2.5 border-b border-white/[0.08] flex items-center justify-between">
                        <span className="text-xs font-medium text-zinc-200">
                          Door & window schedule ({summary.openingSchedule.length} types ·{' '}
                          {summary.doorsCount} doors, {summary.windowsCount} windows,{' '}
                          {summary.ventilatorsCount} vent.)
                        </span>
                        <span className="text-xs font-mono text-zinc-200 tabular-nums">
                          {params.currency}
                          {summary.openingsCost.toLocaleString()}
                        </span>
                      </div>
                      <table className="w-full text-xs tabular-nums">
                        <thead className="text-zinc-400 border-b border-white/[0.06] text-left">
                          <tr>
                            <th className="py-2 px-3 font-normal">Mark & type</th>
                            <th className="py-2 px-2 font-normal">Size (W × H)</th>
                            <th className="py-2 px-2 font-normal text-right">Nos</th>
                            <th className="py-2 px-2 font-normal text-right">Area</th>
                            <th className="py-2 px-3 font-normal text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.05]">
                          {summary.openingSchedule.map((op) => (
                            <tr key={op.id}>
                              <td className="py-2 px-3 text-zinc-200">
                                <span className="font-mono font-medium text-amber-300 mr-1.5">
                                  {op.mark}
                                </span>
                                <span className="text-zinc-400 capitalize">{op.type}</span>
                              </td>
                              <td className="py-2 px-2 text-zinc-300 font-mono">{op.sizeLabel}</td>
                              <td className="py-2 px-2 text-right text-zinc-100 font-medium">
                                {op.count}
                              </td>
                              <td className="py-2 px-2 text-right text-zinc-300">
                                {op.totalAreaM2.toFixed(2)} m²
                              </td>
                              <td className="py-2 px-3 text-right text-zinc-100">
                                {params.currency}
                                {op.amount.toLocaleString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Estimator Notes */}
                    <div className="p-3.5 rounded-xl bg-zinc-900/50 border border-white/[0.08] space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-zinc-200">
                          Estimator notes ({activeSheetName})
                        </span>
                        <span className="text-[11px] text-zinc-500">Saved with sheet & CSV</span>
                      </div>
                      <textarea
                        rows={2}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Add assumptions, finish specs, exclusions, or revision remarks for this sheet..."
                        className="w-full bg-zinc-950 text-xs text-zinc-100 placeholder-zinc-500 rounded-lg px-3 py-2 border border-white/[0.08] focus:outline-none focus:border-amber-400"
                      />
                    </div>

                    {/* Audit Checks */}
                    <div className="space-y-2">
                      <h3 className="text-xs font-medium text-zinc-300">Verification checks</h3>
                      {auditChecks.map((c, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-xl bg-zinc-900/50 border border-white/[0.08] flex items-start gap-2.5 text-xs"
                        >
                          {c.ok ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                          )}
                          <div>
                            <div className="text-zinc-200 font-medium">{c.title}</div>
                            <div className="text-zinc-400 text-[11px] mt-0.5 tabular-nums">
                              {c.detail}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {takeoffSubTab === 'orders' && (
                  <div className="rounded-xl border border-white/[0.08] bg-zinc-900/50 overflow-hidden">
                    <div className="px-3.5 py-2.5 border-b border-white/[0.08] flex items-center justify-between">
                      <div>
                        <span className="text-xs font-medium text-zinc-200">
                          Material procurement order quantities ({activeSheetName})
                        </span>
                        <p className="text-[11px] text-zinc-400">
                          Commercial order units including standard wastage & IS 2250 mix factors
                        </p>
                      </div>
                    </div>
                    <table className="w-full text-xs tabular-nums">
                      <thead className="text-zinc-400 border-b border-white/[0.06] text-left">
                        <tr>
                          <th className="py-2 px-3 font-normal">Material</th>
                          <th className="py-2 px-2 font-normal text-right">Net takeoff</th>
                          <th className="py-2 px-3 font-normal text-right">Order quantity</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.05]">
                        {summary.orderQuantities.map((ord) => (
                          <tr key={ord.id}>
                            <td className="py-2.5 px-3">
                              <div className="text-zinc-100 font-medium">{ord.item}</div>
                              <div className="text-[11px] text-zinc-400">{ord.specification}</div>
                            </td>
                            <td className="py-2.5 px-2 text-right text-zinc-400 font-mono">
                              {ord.netQuantity} {ord.netUnit}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <div className="text-amber-300 font-semibold font-mono">
                                {ord.orderQuantity.toLocaleString()}
                              </div>
                              <div className="text-[11px] text-zinc-300">{ord.commercialUnit}</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {takeoffSubTab === 'combined' && (
                  <div className="space-y-4">
                    <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-white/[0.08] flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-xs font-medium text-zinc-100">
                          Combined whole-plan report ({allSheetRecords.length} sheet
                          {allSheetRecords.length === 1 ? '' : 's'})
                        </h3>
                        <p className="text-[11px] text-zinc-400 mt-0.5">
                          Aggregates every sheet estimate saved in this plan into one consolidated takeoff
                        </p>
                      </div>
                      <button
                        onClick={() => handleExportCsv(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-400 hover:bg-amber-300 text-zinc-950 shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Export combined CSV</span>
                      </button>
                    </div>

                    {/* Sheet-by-Sheet Breakdown */}
                    <div className="rounded-xl border border-white/[0.08] bg-zinc-900/50 overflow-hidden">
                      <div className="px-3.5 py-2.5 border-b border-white/[0.08] flex items-center justify-between">
                        <span className="text-xs font-medium text-zinc-200">
                          Breakdown by sheet
                        </span>
                        <span className="text-xs font-semibold text-amber-400 tabular-nums">
                          Grand total: {params.currency}
                          {combinedReport.totalCost.toLocaleString()}
                        </span>
                      </div>
                      <table className="w-full text-xs tabular-nums">
                        <thead className="text-zinc-400 border-b border-white/[0.06] text-left">
                          <tr>
                            <th className="py-2 px-3 font-normal">Sheet name</th>
                            <th className="py-2 px-2 font-normal text-right">Masonry</th>
                            <th className="py-2 px-2 font-normal text-right">Flooring</th>
                            <th className="py-2 px-3 font-normal text-right">Sheet cost</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.05]">
                          {allSheetRecords.map((rec) => (
                            <tr key={rec.sheetId}>
                              <td className="py-2 px-3">
                                <div className="text-zinc-100 font-medium">{rec.sheetName}</div>
                                {rec.notes && (
                                  <div className="text-[11px] text-zinc-400 truncate max-w-[200px]">
                                    Note: {rec.notes}
                                  </div>
                                )}
                              </td>
                              <td className="py-2 px-2 text-right text-zinc-300">
                                {rec.summary.totalMasonryVolumeM3.toFixed(1)} m³
                              </td>
                              <td className="py-2 px-2 text-right text-zinc-300">
                                {rec.summary.totalFlooringAreaM2.toFixed(1)} m²
                              </td>
                              <td className="py-2 px-3 text-right text-zinc-100 font-medium">
                                {params.currency}
                                {rec.summary.totalCost.toLocaleString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Combined Procurement Rollup */}
                    <div className="rounded-xl border border-white/[0.08] bg-zinc-900/50 overflow-hidden">
                      <div className="px-3.5 py-2 border-b border-white/[0.08] text-xs font-medium text-zinc-200">
                        Consolidated plan order quantities
                      </div>
                      <table className="w-full text-xs tabular-nums">
                        <tbody className="divide-y divide-white/[0.05]">
                          {combinedReport.orders.map((ord, i) => (
                            <tr key={i}>
                              <td className="py-2 px-3 text-zinc-200">{ord.item}</td>
                              <td className="py-2 px-3 text-right">
                                <span className="text-amber-300 font-semibold font-mono mr-1.5">
                                  {ord.orderQuantity.toLocaleString()}
                                </span>
                                <span className="text-[11px] text-zinc-400">
                                  {ord.commercialUnit}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bottom Step Navigation */}
          <div className="shrink-0 h-12 px-4 border-t border-white/[0.08] bg-zinc-950 flex items-center justify-between text-xs">
            <span className="text-zinc-400 tabular-nums truncate">
              {activeSheetName} · {activeRoomsCount} rooms · {summary.doorsCount}D/{summary.windowsCount}W
            </span>
            {step !== 'takeoff' ? (
              <button
                onClick={() =>
                  setStep(
                    step === 'scope' ? 'elements' : step === 'elements' ? 'specs' : 'takeoff'
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-100 border border-white/[0.08]"
              >
                <span>Next step</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-zinc-950 font-medium"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save sheet & version</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
