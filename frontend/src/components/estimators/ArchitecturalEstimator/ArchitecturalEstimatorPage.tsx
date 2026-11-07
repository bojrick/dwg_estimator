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
} from 'lucide-react';
import {
  ArchitecturalParameters,
  RoomDefinition,
  OpeningDefinition,
  FloorFinishType,
  BlockType,
  OpeningType,
} from './types';
import { calculateArchTakeoff } from './archMath';
import { cropRawDataToSheet } from '../../SheetSelectorModal';
import { CadEstimatorCanvas, WorldBBox } from '../shared/CadEstimatorCanvas';
import { analyzeCadLayers, inferArchitecturalFromCad } from '../shared/cadLayerInference';

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
  currency: '₹',
};

const ARCH_ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'ext_wall', label: 'External wall' },
  { value: 'int_wall', label: 'Internal wall' },
  { value: 'wall', label: 'Wall (auto split)' },
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
  const hasSavedEstimate = Boolean(
    (savedState.rooms && savedState.rooms.length > 0) ||
      (savedState.openings && savedState.openings.length > 0)
  );

  const sheets = useMemo<any[]>(
    () => plan?.sheets || fullRawData?.sheets || rawData?.sheets || [],
    [plan?.sheets, fullRawData?.sheets, rawData?.sheets]
  );
  const [activeSheetId, setActiveSheetId] = useState<string>('all');
  const [step, setStep] = useState<ArchStep>('scope');
  const [elementSubTab, setElementSubTab] = useState<'rooms' | 'openings'>('rooms');

  const [params, setParams] = useState<ArchitecturalParameters>(() => ({
    ...DEFAULT_PARAMS,
    ...(savedState.parameters || {}),
  }));
  const [rooms, setRooms] = useState<(RoomDefinition & { sourceLayer?: string })[]>(
    () => savedState.rooms || []
  );
  const [openings, setOpenings] = useState<(OpeningDefinition & { sourceLayer?: string })[]>(
    () => savedState.openings || []
  );
  const [roleOverrides, setRoleOverrides] = useState<Record<string, string>>(
    () => savedState.roleOverrides || {}
  );
  const [scanBox, setScanBox] = useState<WorldBBox | null>(() => savedState.scanBox || null);
  const [lastScanNote, setLastScanNote] = useState<string>('');

  // Interactive CAD canvas states
  const [highlightedLayers, setHighlightedLayers] = useState<string[]>([]);
  const [highlightedMark, setHighlightedMark] = useState<string | null>(null);
  const [isSelectingBox, setIsSelectingBox] = useState(false);
  const [pickTarget, setPickTarget] = useState<
    null | { kind: 'extWall' | 'intWall' | 'roomPerim'; roomId?: string; label: string }
  >(null);
  const [isSaving, setIsSaving] = useState(false);

  const masterRawData = useMemo(() => fullRawData || rawData || null, [fullRawData, rawData]);
  const activeSheet = useMemo(
    () => sheets.find((s) => s.id === activeSheetId),
    [sheets, activeSheetId]
  );
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
    (boxOverride?: WorldBBox | null, overridesOverride?: Record<string, string>, silent?: boolean) => {
      if (!activeRaw) return;
      const res = inferArchitecturalFromCad(
        activeRaw,
        boxOverride !== undefined ? boxOverride : scanBox,
        overridesOverride || roleOverrides
      );
      if (res.rooms.length > 0) setRooms(res.rooms);
      if (res.openings.length > 0) setOpenings(res.openings);
      if (Object.keys(res.paramPatch).length > 0) {
        setParams((prev) => ({ ...prev, ...res.paramPatch }));
      }
      setLastScanNote(res.summaryNote);
      if (!silent) showToast(res.summaryNote);
    },
    [activeRaw, scanBox, roleOverrides, showToast]
  );

  // Auto-infer from actual CAD layers & geometry on initial mount when no estimate was saved yet
  useEffect(() => {
    if (!hasSavedEstimate && activeRaw && rooms.length === 0 && openings.length === 0) {
      runCadInference(scanBox, roleOverrides, true);
    }
  }, [hasSavedEstimate, activeRaw]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(
    () => calculateArchTakeoff(params, rooms, openings),
    [params, rooms, openings]
  );

  const updateParam = <K extends keyof ArchitecturalParameters>(
    key: K,
    val: ArchitecturalParameters[K]
  ) => {
    setParams((prev) => ({ ...prev, [key]: val }));
  };

  const handleRoleChange = (layerName: string, newRole: string) => {
    const next = { ...roleOverrides, [layerName]: newRole };
    setRoleOverrides(next);
    runCadInference(scanBox, next, false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSaveEstimate({
        architectural_estimate: {
          parameters: params,
          rooms,
          openings,
          roleOverrides,
          scanBox,
          summary,
          updatedAt: new Date().toISOString(),
        },
      });
      showToast('Architectural estimate saved');
    } catch {
      showToast('Failed to save estimate');
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportCsv = () => {
    const rows = [
      ['Item', 'Quantity', 'Unit', 'Rate', 'Amount'],
      [
        `External masonry (${Math.round(params.extWallThicknessM * 1000)}mm ${params.blockType.toUpperCase()})`,
        summary.extMasonryVolumeM3.toFixed(2),
        'm3',
        String(params.masonryRatePerM3),
        String(Math.round(summary.extMasonryVolumeM3 * params.masonryRatePerM3)),
      ],
      [
        `Internal masonry (${Math.round(params.intWallThicknessM * 1000)}mm ${params.blockType.toUpperCase()})`,
        summary.intMasonryVolumeM3.toFixed(2),
        'm3',
        String(params.masonryRatePerM3),
        String(Math.round(summary.intMasonryVolumeM3 * params.masonryRatePerM3)),
      ],
      ['Masonry units (incl. wastage)', String(summary.totalBlocksRequired), 'nos', '-', '-'],
      [
        `Internal & ceiling plaster (${params.internalPlasterThicknessMm}mm)`,
        summary.internalPlasterAreaM2.toFixed(2),
        'm2',
        String(params.plasterRatePerM2),
        String(Math.round(summary.internalPlasterAreaM2 * params.plasterRatePerM2)),
      ],
      [
        `External plaster (${params.externalPlasterThicknessMm}mm)`,
        summary.externalPlasterAreaM2.toFixed(2),
        'm2',
        String(params.plasterRatePerM2),
        String(Math.round(summary.externalPlasterAreaM2 * params.plasterRatePerM2)),
      ],
      [
        'Wall & ceiling paint',
        (summary.internalPlasterAreaM2 + summary.externalPlasterAreaM2).toFixed(2),
        'm2',
        String(params.paintRatePerM2),
        String(
          Math.round(
            (summary.internalPlasterAreaM2 + summary.externalPlasterAreaM2) * params.paintRatePerM2
          )
        ),
      ],
      [
        'Flooring',
        summary.totalFlooringAreaM2.toFixed(2),
        'm2',
        String(params.flooringRatePerM2),
        String(Math.round(summary.totalFlooringAreaM2 * params.flooringRatePerM2)),
      ],
      ['Skirting (net of doors)', summary.totalSkirtingLengthM.toFixed(2), 'm', '-', '-'],
      ['Total estimated cost', '', '', '', String(summary.totalCost)],
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(plan?.title || plan?.name || 'architectural').replace(/\s+/g, '_')}_BOQ.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // IS 1200 compliance checks
  const auditChecks = useMemo(() => {
    const checks: { ok: boolean; title: string; detail: string }[] = [];
    const openingRatio =
      summary.grossWallAreaM2 > 0 ? (summary.totalOpeningsAreaM2 / summary.grossWallAreaM2) * 100 : 0;
    checks.push({
      ok: openingRatio <= 45,
      title: 'IS 1200 Part 3 opening deduction check',
      detail: `Openings deduct ${summary.totalOpeningsAreaM2.toFixed(1)} m² (${openingRatio.toFixed(
        1
      )}% of gross wall area ${summary.grossWallAreaM2.toFixed(1)} m²)`,
    });
    checks.push({
      ok: rooms.length > 0 && summary.totalFlooringAreaM2 > 0,
      title: 'Room flooring & skirting coverage',
      detail: `${rooms.length} room(s) · ${summary.totalFlooringAreaM2.toFixed(
        1
      )} m² flooring · ${summary.totalSkirtingLengthM.toFixed(1)} m skirting`,
    });
    checks.push({
      ok: params.extWallThicknessM >= 0.2,
      title: 'External wall weather resistance thickness',
      detail: `External wall ${Math.round(params.extWallThicknessM * 1000)} mm · Internal partition ${Math.round(
        params.intWallThicknessM * 1000
      )} mm`,
    });
    return checks;
  }, [summary, rooms.length, params.extWallThicknessM, params.intWallThicknessM]);

  return (
    <div className="h-screen w-screen bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden select-none">
      {/* Quiet Top Bar */}
      <header className="h-12 shrink-0 border-b border-white/[0.08] bg-zinc-950 px-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-zinc-300 hover:text-white hover:bg-zinc-900 border border-white/[0.08] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back</span>
          </button>
          <div className="h-4 w-px bg-white/[0.08]" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-medium text-zinc-100 truncate">
                {plan?.title || plan?.name || 'Architectural takeoff'}
              </h1>
              <span className="text-[11px] text-zinc-400 px-2 py-0.5 rounded bg-zinc-900 border border-white/[0.08]">
                Architectural · IS 1200
              </span>
            </div>
          </div>
        </div>

        {/* Summary KPIs in tabular-nums */}
        <div className="hidden xl:flex items-center gap-6 text-xs tabular-nums">
          <div>
            <span className="text-zinc-500 mr-1.5">Masonry</span>
            <span className="text-zinc-100 font-medium">{summary.totalMasonryVolumeM3.toFixed(1)} m³</span>
          </div>
          <div>
            <span className="text-zinc-500 mr-1.5">Blocks</span>
            <span className="text-zinc-100 font-medium">{summary.totalBlocksRequired.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-zinc-500 mr-1.5">Flooring</span>
            <span className="text-zinc-100 font-medium">{summary.totalFlooringAreaM2.toFixed(1)} m²</span>
          </div>
          <div>
            <span className="text-zinc-500 mr-1.5">Estimate</span>
            <span className="text-amber-400 font-medium">
              {params.currency}
              {summary.totalCost.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
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
        {/* Left Interactive CAD Viewport (All Sheets + Measure + Layers + Crop/Pick) */}
        <div className="lg:w-[56%] h-[46vh] lg:h-full border-b lg:border-b-0 lg:border-r border-white/[0.08] relative">
          <CadEstimatorCanvas
            rawData={activeRaw}
            sheets={sheets}
            activeSheetId={activeSheetId}
            onSelectSheetId={setActiveSheetId}
            highlightedLayers={highlightedLayers}
            highlightedMark={highlightedMark}
            layoutBox={scanBox}
            boxSelectLabel={isSelectingBox ? 'Drag box around floor plan to scope takeoff' : null}
            onBoxSelected={(bbox) => {
              setScanBox(bbox);
              setIsSelectingBox(false);
              runCadInference(bbox, roleOverrides, false);
            }}
            twoPointPickLabel={pickTarget ? pickTarget.label : null}
            onTwoPointPicked={(distM) => {
              if (!pickTarget) return;
              if (pickTarget.kind === 'extWall') {
                updateParam('extWallLengthM', Math.round((params.extWallLengthM + distM) * 10) / 10);
                showToast(`Added ${distM.toFixed(2)} m to external wall length`);
              } else if (pickTarget.kind === 'intWall') {
                updateParam('intWallLengthM', Math.round((params.intWallLengthM + distM) * 10) / 10);
                showToast(`Added ${distM.toFixed(2)} m to internal wall length`);
              } else if (pickTarget.kind === 'roomPerim' && pickTarget.roomId) {
                setRooms((prev) =>
                  prev.map((r) =>
                    r.id === pickTarget.roomId ? { ...r, perimeterM: Math.round(distM * 100) / 100 } : r
                  )
                );
                showToast(`Updated room span to ${distM.toFixed(2)} m`);
              }
              setPickTarget(null);
            }}
            onCancelExternalTool={() => {
              setIsSelectingBox(false);
              setPickTarget(null);
            }}
          />
        </div>

        {/* Right 4-Step Guided Panel */}
        <div className="lg:w-[44%] flex-1 flex flex-col bg-zinc-950 overflow-hidden">
          {/* Stepper */}
          <div className="shrink-0 grid grid-cols-4 border-b border-white/[0.08] bg-zinc-900/50">
            {(
              [
                { id: 'scope', num: '1', label: 'Scope & layers' },
                { id: 'elements', num: '2', label: 'Rooms & openings' },
                { id: 'specs', num: '3', label: 'Specs & rates' },
                { id: 'takeoff', num: '4', label: 'BOQ & audit' },
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

          {/* Step Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {step === 'scope' && (
              <>
                <div className="p-3.5 rounded-xl bg-zinc-900/70 border border-white/[0.08] space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xs font-medium text-zinc-100">Drawing & layer intelligence</h2>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        Classify CAD layers to measure wall runs, room boundaries, and door/window tags directly from geometry
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
                        <span>{scanBox ? 'Re-crop area' : 'Crop scan area'}</span>
                      </button>
                      {scanBox && (
                        <button
                          onClick={() => {
                            setScanBox(null);
                            runCadInference(null, roleOverrides, false);
                          }}
                          className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-white/[0.08]"
                          title="Clear crop region"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => runCadInference(scanBox, roleOverrides, false)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-amber-400 hover:bg-amber-300 text-zinc-950 transition-colors"
                      >
                        <Scan className="w-3.5 h-3.5" />
                        <span>Scan CAD</span>
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
                      <span>Detected CAD layers ({layerStats.length})</span>
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
                  <div className="max-h-[360px] overflow-y-auto divide-y divide-white/[0.05]">
                    {layerStats.length === 0 ? (
                      <div className="p-6 text-center text-xs text-zinc-500">
                        No CAD vector layers detected on this plan. You can still enter schedule quantities manually.
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
                <div className="flex items-center justify-between gap-2">
                  <div className="inline-flex rounded-lg p-0.5 bg-zinc-900 border border-white/[0.08]">
                    <button
                      onClick={() => setElementSubTab('rooms')}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors tabular-nums ${
                        elementSubTab === 'rooms'
                          ? 'bg-zinc-800 text-zinc-100'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Rooms ({rooms.length})
                    </button>
                    <button
                      onClick={() => setElementSubTab('openings')}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors tabular-nums ${
                        elementSubTab === 'openings'
                          ? 'bg-zinc-800 text-zinc-100'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Openings ({openings.reduce((a, o) => a + o.count, 0)})
                    </button>
                  </div>

                  {elementSubTab === 'rooms' ? (
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
                          },
                        ])
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-white/[0.08]"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add room</span>
                    </button>
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
                          },
                        ])
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-white/[0.08]"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add opening</span>
                    </button>
                  )}
                </div>

                {elementSubTab === 'rooms' ? (
                  <div className="space-y-2">
                    {rooms.map((rm) => (
                      <div
                        key={rm.id}
                        onClick={() => {
                          setHighlightedMark(rm.name);
                          if (rm.sourceLayer) setHighlightedLayers([rm.sourceLayer]);
                        }}
                        className="p-3 rounded-xl bg-zinc-900/60 hover:bg-zinc-900 border border-white/[0.08] space-y-2 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <input
                            value={rm.name}
                            onChange={(e) =>
                              setRooms((prev) =>
                                prev.map((r) => (r.id === rm.id ? { ...r, name: e.target.value } : r))
                              )
                            }
                            className="bg-zinc-950 text-xs font-medium text-zinc-100 px-2.5 py-1 rounded-md border border-white/[0.08] flex-1"
                          />
                          {rm.sourceLayer && (
                            <span className="text-[10px] font-mono text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-950 border border-white/[0.06]">
                              {rm.sourceLayer}
                            </span>
                          )}
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
                        <div className="grid grid-cols-3 gap-2 text-xs tabular-nums">
                          <label className="space-y-1">
                            <span className="text-[11px] text-zinc-400">Area (m²)</span>
                            <input
                              type="number"
                              step="0.1"
                              value={rm.areaM2}
                              onChange={(e) =>
                                setRooms((prev) =>
                                  prev.map((r) =>
                                    r.id === rm.id ? { ...r, areaM2: Number(e.target.value) || 0 } : r
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
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPickTarget({
                                    kind: 'roomPerim',
                                    roomId: rm.id,
                                    label: `Pick length for ${rm.name}`,
                                  });
                                }}
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
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {openings.map((op) => (
                      <div
                        key={op.id}
                        onClick={() => {
                          setHighlightedMark(op.mark);
                          if (op.sourceLayer) setHighlightedLayers([op.sourceLayer]);
                        }}
                        className="p-3 rounded-xl bg-zinc-900/60 hover:bg-zinc-900 border border-white/[0.08] space-y-2 cursor-pointer"
                      >
                        <div className="grid grid-cols-5 gap-2 items-center text-xs tabular-nums">
                          <input
                            value={op.mark}
                            onChange={(e) =>
                              setOpenings((prev) =>
                                prev.map((o) => (o.id === op.id ? { ...o, mark: e.target.value } : o))
                              )
                            }
                            className="bg-zinc-950 text-zinc-100 font-mono px-2 py-1 rounded border border-white/[0.08]"
                          />
                          <select
                            value={op.type}
                            onChange={(e) =>
                              setOpenings((prev) =>
                                prev.map((o) =>
                                  o.id === op.id ? { ...o, type: e.target.value as OpeningType } : o
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
                            title="Width (m)"
                            onChange={(e) =>
                              setOpenings((prev) =>
                                prev.map((o) =>
                                  o.id === op.id ? { ...o, widthM: Number(e.target.value) || 0 } : o
                                )
                              )
                            }
                            className="bg-zinc-950 text-zinc-100 px-2 py-1 rounded border border-white/[0.08]"
                          />
                          <input
                            type="number"
                            step="0.05"
                            value={op.heightM}
                            title="Height (m)"
                            onChange={(e) =>
                              setOpenings((prev) =>
                                prev.map((o) =>
                                  o.id === op.id ? { ...o, heightM: Number(e.target.value) || 0 } : o
                                )
                              )
                            }
                            className="bg-zinc-950 text-zinc-100 px-2 py-1 rounded border border-white/[0.08]"
                          />
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min="1"
                              value={op.count}
                              title="Count"
                              onChange={(e) =>
                                setOpenings((prev) =>
                                  prev.map((o) =>
                                    o.id === op.id ? { ...o, count: Number(e.target.value) || 0 } : o
                                  )
                                )
                              }
                              className="w-full bg-zinc-950 text-zinc-100 px-2 py-1 rounded border border-white/[0.08]"
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenings((prev) => prev.filter((o) => o.id !== op.id));
                              }}
                              className="p-1 text-zinc-500 hover:text-rose-400"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {step === 'specs' && (
              <div className="space-y-4 text-xs tabular-nums">
                <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-white/[0.08] space-y-3">
                  <h3 className="font-medium text-zinc-200">Wall geometry & masonry unit</h3>
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
                          onChange={(e) => updateParam('extWallLengthM', Number(e.target.value) || 0)}
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
                          onChange={(e) => updateParam('intWallLengthM', Number(e.target.value) || 0)}
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
                        onChange={(e) => updateParam('extWallThicknessM', Number(e.target.value) || 0.23)}
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
                        onChange={(e) => updateParam('masonryRatePerM3', Number(e.target.value) || 0)}
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">Plaster / m²</span>
                      <input
                        type="number"
                        value={params.plasterRatePerM2}
                        onChange={(e) => updateParam('plasterRatePerM2', Number(e.target.value) || 0)}
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">Paint / m²</span>
                      <input
                        type="number"
                        value={params.paintRatePerM2}
                        onChange={(e) => updateParam('paintRatePerM2', Number(e.target.value) || 0)}
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">Flooring / m²</span>
                      <input
                        type="number"
                        value={params.flooringRatePerM2}
                        onChange={(e) => updateParam('flooringRatePerM2', Number(e.target.value) || 0)}
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}

            {step === 'takeoff' && (
              <div className="space-y-4">
                {/* Bill of Quantities */}
                <div className="rounded-xl border border-white/[0.08] bg-zinc-900/50 overflow-hidden">
                  <div className="px-3.5 py-2.5 border-b border-white/[0.08] flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-200">Bill of quantities</span>
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
                          Block / brick masonry ({summary.totalBlocksRequired.toLocaleString()} units)
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
                          {(summary.internalPlasterAreaM2 + summary.externalPlasterAreaM2).toFixed(1)} m²
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
                          Flooring + {summary.totalSkirtingLengthM.toFixed(1)} m skirting
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

                {/* IS 1200 Audit */}
                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-zinc-300">IS 1200 verification checks</h3>
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
                        <div className="text-zinc-400 text-[11px] mt-0.5 tabular-nums">{c.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Bottom Step Navigation */}
          <div className="shrink-0 h-12 px-4 border-t border-white/[0.08] bg-zinc-950 flex items-center justify-between text-xs">
            <span className="text-zinc-500 tabular-nums">
              {rooms.length} rooms · {openings.reduce((a, o) => a + o.count, 0)} openings
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
                <span>Save takeoff</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
