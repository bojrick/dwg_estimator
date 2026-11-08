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
  FireProtectionParameters,
  FireProtectionItem,
  FireItemType,
  HazardClass,
} from './types';
import { calculateFireTakeoff } from './fireMath';
import { cropRawDataToSheet } from '../../SheetSelectorModal';
import { CadEstimatorCanvas, WorldBBox } from '../shared/CadEstimatorCanvas';
import { analyzeCadLayers, inferFireFromCad } from '../shared/cadLayerInference';
import { VersionHistoryControl } from '../shared/VersionHistoryControl';

interface FireEstimatorPageProps {
  plan: any;
  rawData: any;
  fullRawData?: any;
  isGuest?: boolean;
  onBack: () => void;
  onSaveEstimate: (estimate: any) => Promise<void>;
  showToast: (msg: string) => void;
}

type FireStep = 'scope' | 'equipment' | 'specs' | 'takeoff';

const DEFAULT_PARAMS: FireProtectionParameters = {
  totalFloorAreaM2: 500,
  hazardClass: 'ordinary',
  sprinklerCoverageM2: 12,
  riserPipeLengthM: 35,
  branchPipeLengthM: 110,
  rateSprinkler: 450,
  rateExtinguisher: 2200,
  rateHoseReel: 8500,
  ratePipePerM: 450,
  currency: '₹',
};

const FIRE_ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'riser_pipe', label: 'MS wet riser / main (100/150mm)' },
  { value: 'branch_pipe', label: 'MS sprinkler branch (25–65mm)' },
  { value: 'sprinkler', label: 'Sprinkler head' },
  { value: 'hose_reel', label: 'Fire hose reel (FHR)' },
  { value: 'landing_valve', label: 'Hydrant landing valve' },
  { value: 'extinguisher', label: 'Fire extinguisher' },
  { value: 'annotation', label: 'Annotation / ignore' },
  { value: 'general', label: 'General geometry' },
];

export const FireEstimatorPage: React.FC<FireEstimatorPageProps> = ({
  plan,
  rawData,
  fullRawData,
  onBack,
  onSaveEstimate,
  showToast,
}) => {
  const savedState = plan?.discipline_estimates?.fire || plan?.fire_estimate || {};
  const hasSavedEstimate = Boolean(savedState.items && savedState.items.length > 0);

  const sheets = useMemo<any[]>(
    () => plan?.sheets || fullRawData?.sheets || rawData?.sheets || [],
    [plan?.sheets, fullRawData?.sheets, rawData?.sheets]
  );
  const [activeSheetId, setActiveSheetId] = useState<string>(() => {
    const initialSheets = plan?.sheets || fullRawData?.sheets || rawData?.sheets || [];
    return savedState.active_sheet_id || plan?.active_sheet_id || initialSheets[0]?.id || 'all';
  });
  const [step, setStep] = useState<FireStep>('scope');
  const [notes, setNotes] = useState<string>(() => savedState.notes || '');
  const [bySheet, setBySheet] = useState<Record<string, any>>(() => savedState.by_sheet || {});
  const [versions, setVersions] = useState<any[]>(() => savedState.versions || []);

  const [params, setParams] = useState<FireProtectionParameters>(() => ({
    ...DEFAULT_PARAMS,
    ...(savedState.parameters || {}),
  }));
  const [items, setItems] = useState<(FireProtectionItem & { sourceLayer?: string })[]>(
    () => savedState.items || []
  );
  const [roleOverrides, setRoleOverrides] = useState<Record<string, string>>(
    () => savedState.roleOverrides || {}
  );
  const [scanBox, setScanBox] = useState<WorldBBox | null>(() => savedState.scanBox || null);
  const [lastScanNote, setLastScanNote] = useState<string>('');

  const [highlightedLayers, setHighlightedLayers] = useState<string[]>([]);
  const [isSelectingBox, setIsSelectingBox] = useState(false);
  const [pickPipeField, setPickPipeField] = useState<
    null | { field: 'riserPipeLengthM' | 'branchPipeLengthM'; label: string }
  >(null);
  const [isSaving, setIsSaving] = useState(false);

  const masterRawData = useMemo(() => fullRawData || rawData || null, [fullRawData, rawData]);
  const activeSheet = useMemo(
    () => sheets.find((s) => s.id === activeSheetId),
    [sheets, activeSheetId]
  );
  const activeSheetName = useMemo(
    () => (activeSheetId === 'all' ? 'All sheets combined' : activeSheet?.name || 'Sheet 1'),
    [activeSheetId, activeSheet]
  );
  const activeRaw = useMemo(() => {
    if (!masterRawData) return null;
    if (!activeSheet || activeSheetId === 'all') return masterRawData;
    return cropRawDataToSheet(masterRawData, activeSheet);
  }, [masterRawData, activeSheet, activeSheetId]);

  const handleSelectSheet = (newSheetId: string) => {
    if (newSheetId === activeSheetId) return;
    setBySheet((prev) => ({
      ...prev,
      [activeSheetId]: {
        sheetId: activeSheetId,
        sheetName: activeSheetName,
        parameters: params,
        items,
        roleOverrides,
        scanBox,
        notes,
        summary,
        updatedAt: new Date().toISOString(),
      },
    }));
    const target = bySheet[newSheetId];
    setActiveSheetId(newSheetId);
    if (target) {
      setParams({ ...DEFAULT_PARAMS, ...(target.parameters || {}) });
      setItems(target.items || []);
      setRoleOverrides(target.roleOverrides || {});
      setScanBox(target.scanBox || null);
      setNotes(target.notes || '');
    } else {
      setScanBox(null);
      const nextSheet = sheets.find((s) => s.id === newSheetId);
      const nextRaw =
        !masterRawData || !nextSheet || newSheetId === 'all'
          ? masterRawData
          : cropRawDataToSheet(masterRawData, nextSheet);
      if (nextRaw) {
        const res = inferFireFromCad(nextRaw, null, roleOverrides);
        setItems(res.items);
        if (Object.keys(res.paramPatch).length > 0) {
          setParams((prev) => ({ ...prev, ...res.paramPatch }));
        }
        setLastScanNote(res.summaryNote);
      }
    }
  };

  const layerStats = useMemo(
    () => analyzeCadLayers(activeRaw, 'fire', scanBox, roleOverrides),
    [activeRaw, scanBox, roleOverrides]
  );

  const runCadInference = useCallback(
    (boxOverride?: WorldBBox | null, overridesOverride?: Record<string, string>, silent?: boolean) => {
      if (!activeRaw) return;
      const res = inferFireFromCad(
        activeRaw,
        boxOverride !== undefined ? boxOverride : scanBox,
        overridesOverride || roleOverrides
      );
      if (res.items.length > 0) setItems(res.items);
      if (Object.keys(res.paramPatch).length > 0) {
        setParams((prev) => ({ ...prev, ...res.paramPatch }));
      }
      setLastScanNote(res.summaryNote);
      if (!silent) showToast(res.summaryNote);
    },
    [activeRaw, scanBox, roleOverrides, showToast]
  );

  useEffect(() => {
    if (!hasSavedEstimate && activeRaw && items.length === 0) {
      runCadInference(scanBox, roleOverrides, true);
    }
  }, [hasSavedEstimate, activeRaw]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(() => calculateFireTakeoff(params, items), [params, items]);

  const updateParam = <K extends keyof FireProtectionParameters>(
    key: K,
    val: FireProtectionParameters[K]
  ) => {
    setParams((prev) => ({ ...prev, [key]: val }));
  };

  const handleHazardChange = (hc: HazardClass) => {
    const cov = hc === 'light' ? 18 : hc === 'ordinary' ? 12 : 9;
    setParams((prev) => ({ ...prev, hazardClass: hc, sprinklerCoverageM2: cov }));
  };

  const handleRoleChange = (layerName: string, newRole: string) => {
    const next = { ...roleOverrides, [layerName]: newRole };
    setRoleOverrides(next);
    runCadInference(scanBox, next, false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updatedBySheet = {
        ...bySheet,
        [activeSheetId]: {
          sheetId: activeSheetId,
          sheetName: activeSheetName,
          parameters: params,
          items,
          roleOverrides,
          scanBox,
          notes,
          summary,
          updatedAt: new Date().toISOString(),
        },
      };
      const newVersion = {
        versionId: `v_${Date.now()}`,
        versionNumber: versions.length + 1,
        createdAt: new Date().toISOString(),
        sheetId: activeSheetId,
        sheetName: activeSheetName,
        notes,
        totalCost: summary.totalCost,
        snapshot: {
          activeSheetId,
          sheetName: activeSheetName,
          parameters: params,
          items,
          roleOverrides,
          scanBox,
          notes,
          summary,
        },
      };
      const nextVersions = [...versions, newVersion].slice(-20);
      setBySheet(updatedBySheet);
      setVersions(nextVersions);

      await onSaveEstimate({
        fire_estimate: {
          active_sheet_id: activeSheetId,
          sheetName: activeSheetName,
          notes,
          parameters: params,
          items,
          roleOverrides,
          scanBox,
          summary,
          by_sheet: updatedBySheet,
          versions: nextVersions,
          updatedAt: new Date().toISOString(),
        },
      });
      showToast(`Saved Fire protection estimate v${newVersion.versionNumber} (${activeSheetName})`);
    } catch {
      showToast('Failed to save estimate');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRestoreVersion = (v: any) => {
    if (!v?.snapshot) return;
    const snap = v.snapshot;
    if (snap.activeSheetId) setActiveSheetId(snap.activeSheetId);
    if (snap.parameters) setParams({ ...DEFAULT_PARAMS, ...snap.parameters });
    if (snap.items) setItems(snap.items);
    if (snap.roleOverrides) setRoleOverrides(snap.roleOverrides);
    setScanBox(snap.scanBox || null);
    setNotes(snap.notes || '');
    showToast(`Restored v${v.versionNumber} (${v.sheetName})`);
  };

  const handleExportCsv = () => {
    const sprUsed = summary.sprinklersInstalled || summary.minRecommendedSprinklers;
    const rows = [
      ['Sheet', activeSheetName, '', '', ''],
      ['Estimator notes', notes || '-', '', '', ''],
      ['Item', 'Quantity', 'Unit', 'Rate', 'Amount'],
      [
        'Sprinkler heads (K-80 68C)',
        String(sprUsed),
        'nos',
        String(params.rateSprinkler),
        String(sprUsed * params.rateSprinkler),
      ],
      [
        'Portable fire extinguishers',
        String(summary.extinguishersCount),
        'nos',
        String(params.rateExtinguisher),
        String(summary.extinguishersCount * params.rateExtinguisher),
      ],
      [
        'First-aid fire hose reels (IS 884)',
        String(summary.hoseReelsCount),
        'nos',
        String(params.rateHoseReel),
        String(summary.hoseReelsCount * params.rateHoseReel),
      ],
      [
        'MS C-class heavy piping (IS 1239)',
        summary.totalPipingM.toFixed(1),
        'm',
        String(params.ratePipePerM),
        String(Math.round(summary.totalPipingM * params.ratePipePerM)),
      ],
      ['Testing, commissioning & erection labor', '1', 'LS', '-', String(summary.laborCost)],
      ['Total estimated cost', '', '', '', String(summary.totalCost)],
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(plan?.title || plan?.name || 'fire').replace(/\s+/g, '_')}_Fire_BOQ.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const auditChecks = useMemo(() => {
    const sprOk = summary.sprinklersInstalled >= summary.minRecommendedSprinklers;
    return [
      {
        ok: sprOk,
        title: 'IS 15105 / NBC Part 4 sprinkler coverage density',
        detail: sprOk
          ? `${summary.sprinklersInstalled} sprinklers provided ≥ ${summary.minRecommendedSprinklers} required (${params.sprinklerCoverageM2} m²/head for ${params.hazardClass} hazard)`
          : `${summary.sprinklersInstalled} sprinklers < ${summary.minRecommendedSprinklers} required for ${params.totalFloorAreaM2} m² (${params.sprinklerCoverageM2} m²/head)`,
      },
      {
        ok: summary.hoseReelsCount >= Math.max(1, Math.ceil(params.totalFloorAreaM2 / 500)),
        title: 'NBC staircase hose reel travel coverage (30m hose)',
        detail: `${summary.hoseReelsCount} hose reel(s) across ${params.totalFloorAreaM2} m² floor plate`,
      },
      {
        ok: summary.extinguishersCount >= 2,
        title: 'IS 2190 portable fire extinguisher provision',
        detail: `${summary.extinguishersCount} portable extinguisher unit(s) scheduled`,
      },
    ];
  }, [summary, params]);

  return (
    <div className="h-screen w-screen bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden select-none">
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
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-sm font-medium text-zinc-100 truncate">
              {plan?.title || plan?.name || 'Fire protection takeoff'}
            </h1>
            <span className="text-[11px] text-zinc-400 px-2 py-0.5 rounded bg-zinc-900 border border-white/[0.08]">
              Fire · NBC Part 4
            </span>
          </div>
        </div>

        <div className="hidden xl:flex items-center gap-6 text-xs tabular-nums">
          <div>
            <span className="text-zinc-500 mr-1.5">Sprinklers</span>
            <span className="text-zinc-100 font-medium">
              {summary.sprinklersInstalled}/{summary.minRecommendedSprinklers}
            </span>
          </div>
          <div>
            <span className="text-zinc-500 mr-1.5">MS pipe</span>
            <span className="text-zinc-100 font-medium">{summary.totalPipingM.toFixed(1)} m</span>
          </div>
          <div>
            <span className="text-zinc-500 mr-1.5">Floor area</span>
            <span className="text-zinc-100 font-medium">{params.totalFloorAreaM2} m²</span>
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
          <VersionHistoryControl
            versions={versions}
            currency={params.currency}
            onRestoreVersion={handleRestoreVersion}
          />
          <button
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08]"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 hover:bg-white text-zinc-950 disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Saving...' : 'Save estimate'}</span>
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        <div className="lg:w-[56%] h-[46vh] lg:h-full border-b lg:border-b-0 lg:border-r border-white/[0.08] relative">
          <CadEstimatorCanvas
            rawData={activeRaw}
            sheets={sheets}
            activeSheetId={activeSheetId}
            onSelectSheetId={handleSelectSheet}
            highlightedLayers={highlightedLayers}
            layoutBox={scanBox}
            boxSelectLabel={
              isSelectingBox ? 'Drag box around fire protection zone to measure floor area & heads' : null
            }
            onBoxSelected={(bbox) => {
              setScanBox(bbox);
              setIsSelectingBox(false);
              runCadInference(bbox, roleOverrides, false);
            }}
            twoPointPickLabel={pickPipeField ? pickPipeField.label : null}
            onTwoPointPicked={(distM) => {
              if (!pickPipeField) return;
              const cur = params[pickPipeField.field] || 0;
              updateParam(pickPipeField.field, Math.round((cur + distM) * 10) / 10);
              showToast(`Added ${distM.toFixed(2)} m to ${pickPipeField.field}`);
              setPickPipeField(null);
            }}
            onCancelExternalTool={() => {
              setIsSelectingBox(false);
              setPickPipeField(null);
            }}
          />
        </div>

        <div className="lg:w-[44%] flex-1 flex flex-col bg-zinc-950 overflow-hidden">
          <div className="shrink-0 grid grid-cols-4 border-b border-white/[0.08] bg-zinc-900/50">
            {(
              [
                { id: 'scope', num: '1', label: 'Scope & layers' },
                { id: 'equipment', num: '2', label: 'Apparatus' },
                { id: 'specs', num: '3', label: 'Hazard & piping' },
                { id: 'takeoff', num: '4', label: 'BOQ & audit' },
              ] as { id: FireStep; num: string; label: string }[]
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

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {step === 'scope' && (
              <>
                <div className="p-3.5 rounded-xl bg-zinc-900/70 border border-white/[0.08] space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xs font-medium text-zinc-100">Fire fighting layer & coverage scan</h2>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        Detects sprinkler heads, FHR/hydrant tags, and MS pipe runs; sizes NBC Part 4 grid from floor footprint when layers are architectural
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => setIsSelectingBox((v) => !v)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border ${
                          isSelectingBox
                            ? 'bg-amber-400/15 text-amber-300 border-amber-400/40'
                            : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border-white/[0.08]'
                        }`}
                      >
                        <Crop className="w-3.5 h-3.5" />
                        <span>{scanBox ? 'Re-crop' : 'Crop area'}</span>
                      </button>
                      {scanBox && (
                        <button
                          onClick={() => {
                            setScanBox(null);
                            runCadInference(null, roleOverrides, false);
                          }}
                          className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border border-white/[0.08]"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => runCadInference(scanBox, roleOverrides, false)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-amber-400 hover:bg-amber-300 text-zinc-950"
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

                <div className="rounded-xl border border-white/[0.08] bg-zinc-900/40 overflow-hidden">
                  <div className="px-3.5 py-2.5 border-b border-white/[0.08] flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-medium text-zinc-200">
                      <Layers className="w-3.5 h-3.5 text-zinc-400" />
                      <span>CAD layers ({layerStats.length})</span>
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
                    {layerStats.map((st) => {
                      const isHi = highlightedLayers.includes(st.name);
                      return (
                        <div
                          key={st.name}
                          onClick={() =>
                            setHighlightedLayers((prev) => (prev.includes(st.name) ? [] : [st.name]))
                          }
                          className={`px-3.5 py-2 flex items-center justify-between gap-2 text-xs cursor-pointer ${
                            isHi ? 'bg-amber-400/10' : 'hover:bg-zinc-900/80'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="w-2.5 h-2.5 rounded-sm shrink-0 border border-white/20"
                              style={{ backgroundColor: st.color }}
                            />
                            <span className="text-zinc-200 truncate font-mono text-[11px]">{st.name}</span>
                          </div>
                          <div className="flex items-center gap-3 shrink-0 tabular-nums">
                            <span className="text-[11px] text-zinc-400">
                              {st.circleArcCount > 0 ? `${st.circleArcCount} sym` : `${st.lineLengthM} m`}
                            </span>
                            <select
                              value={st.inferredRole}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => handleRoleChange(st.name, e.target.value)}
                              className="bg-zinc-950 text-zinc-200 text-[11px] rounded-md px-2 py-1 border border-white/[0.08]"
                            >
                              {FIRE_ROLE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {step === 'equipment' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-300">
                    Fire protection apparatus ({items.reduce((a, i) => a + i.count, 0)})
                  </span>
                  <button
                    onClick={() =>
                      setItems((prev) => [
                        ...prev,
                        {
                          id: `fp_${Date.now()}`,
                          name: 'ABC fire extinguisher (6kg)',
                          type: 'extinguisher',
                          count: 2,
                          specs: 'IS 15683',
                        },
                      ])
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-white/[0.08]"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add item</span>
                  </button>
                </div>

                {items.map((it) => (
                  <div
                    key={it.id}
                    onClick={() => {
                      if (it.sourceLayer) setHighlightedLayers([it.sourceLayer]);
                    }}
                    className="p-3 rounded-xl bg-zinc-900/60 hover:bg-zinc-900 border border-white/[0.08] space-y-2 cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <input
                        value={it.name}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((x) => (x.id === it.id ? { ...x, name: e.target.value } : x))
                          )
                        }
                        className="bg-zinc-950 text-xs font-medium text-zinc-100 px-2.5 py-1 rounded-md border border-white/[0.08] flex-1"
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setItems((prev) => prev.filter((x) => x.id !== it.id));
                        }}
                        className="p-1 text-zinc-500 hover:text-rose-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs tabular-nums">
                      <select
                        value={it.type}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((x) =>
                              x.id === it.id ? { ...x, type: e.target.value as FireItemType } : x
                            )
                          )
                        }
                        className="bg-zinc-950 text-zinc-100 px-2 py-1 rounded border border-white/[0.08]"
                      >
                        <option value="sprinkler">Sprinkler head</option>
                        <option value="extinguisher">Extinguisher</option>
                        <option value="hose_reel">Hose reel</option>
                        <option value="landing_valve">Landing valve</option>
                      </select>
                      <input
                        type="number"
                        min="0"
                        value={it.count}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((x) =>
                              x.id === it.id ? { ...x, count: Number(e.target.value) || 0 } : x
                            )
                          )
                        }
                        className="bg-zinc-950 text-zinc-100 px-2 py-1 rounded border border-white/[0.08]"
                      />
                      <input
                        value={it.specs || ''}
                        placeholder="Spec"
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((x) => (x.id === it.id ? { ...x, specs: e.target.value } : x))
                          )
                        }
                        className="bg-zinc-950 text-zinc-300 px-2 py-1 rounded border border-white/[0.08]"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {step === 'specs' && (
              <div className="space-y-4 text-xs tabular-nums">
                <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-white/[0.08] space-y-3">
                  <h3 className="font-medium text-zinc-200">NBC Part 4 hazard class & MS piping</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1">
                      <span className="text-zinc-400">Protected floor area (m²)</span>
                      <input
                        type="number"
                        value={params.totalFloorAreaM2}
                        onChange={(e) => updateParam('totalFloorAreaM2', Number(e.target.value) || 100)}
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">Hazard occupancy</span>
                      <select
                        value={params.hazardClass}
                        onChange={(e) => handleHazardChange(e.target.value as HazardClass)}
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      >
                        <option value="light">Light hazard (18 m²/head)</option>
                        <option value="ordinary">Ordinary hazard (12 m²/head)</option>
                        <option value="high">High hazard (9 m²/head)</option>
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">Wet riser / header (m)</span>
                      <div className="flex gap-1">
                        <input
                          type="number"
                          step="0.5"
                          value={params.riserPipeLengthM}
                          onChange={(e) => updateParam('riserPipeLengthM', Number(e.target.value) || 0)}
                          className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setPickPipeField({
                              field: 'riserPipeLengthM',
                              label: 'Click 2 points on CAD to add riser/header pipe length',
                            })
                          }
                          className="px-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                        >
                          <Ruler className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">Sprinkler branch pipe (m)</span>
                      <div className="flex gap-1">
                        <input
                          type="number"
                          step="0.5"
                          value={params.branchPipeLengthM}
                          onChange={(e) => updateParam('branchPipeLengthM', Number(e.target.value) || 0)}
                          className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setPickPipeField({
                              field: 'branchPipeLengthM',
                              label: 'Click 2 points on CAD to add branch pipe length',
                            })
                          }
                          className="px-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                        >
                          <Ruler className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-white/[0.08] space-y-3">
                  <h3 className="font-medium text-zinc-200">Unit rates ({params.currency})</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1">
                      <span className="text-zinc-400">Sprinkler head / unit</span>
                      <input
                        type="number"
                        value={params.rateSprinkler}
                        onChange={(e) => updateParam('rateSprinkler', Number(e.target.value) || 0)}
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">Extinguisher / unit</span>
                      <input
                        type="number"
                        value={params.rateExtinguisher}
                        onChange={(e) => updateParam('rateExtinguisher', Number(e.target.value) || 0)}
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">Fire hose reel / set</span>
                      <input
                        type="number"
                        value={params.rateHoseReel}
                        onChange={(e) => updateParam('rateHoseReel', Number(e.target.value) || 0)}
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">MS C-class pipe / m</span>
                      <input
                        type="number"
                        value={params.ratePipePerM}
                        onChange={(e) => updateParam('ratePipePerM', Number(e.target.value) || 0)}
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}

            {step === 'takeoff' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-white/[0.08] bg-zinc-900/50 overflow-hidden">
                  <div className="px-3.5 py-2.5 border-b border-white/[0.08] flex items-center justify-between">
                    <div>
                      <span className="text-xs font-medium text-zinc-200">Fire protection BOQ</span>
                      <span className="ml-2 text-[10px] font-mono text-amber-300 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0.5 rounded">
                        {activeSheetName}
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
                        <th className="py-2 px-3 font-normal">Item</th>
                        <th className="py-2 px-2 font-normal text-right">Qty</th>
                        <th className="py-2 px-3 font-normal text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.05]">
                      <tr>
                        <td className="py-2 px-3 text-zinc-200">Pendant K-80 sprinklers (68°C)</td>
                        <td className="py-2 px-2 text-right text-zinc-300">
                          {summary.sprinklersInstalled || summary.minRecommendedSprinklers} nos
                        </td>
                        <td className="py-2 px-3 text-right text-zinc-100">
                          {params.currency}
                          {(
                            (summary.sprinklersInstalled || summary.minRecommendedSprinklers) *
                            params.rateSprinkler
                          ).toLocaleString()}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 text-zinc-200">Fire hose reels (30m drum)</td>
                        <td className="py-2 px-2 text-right text-zinc-300">
                          {summary.hoseReelsCount} sets
                        </td>
                        <td className="py-2 px-3 text-right text-zinc-100">
                          {params.currency}
                          {(summary.hoseReelsCount * params.rateHoseReel).toLocaleString()}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 text-zinc-200">Portable fire extinguishers</td>
                        <td className="py-2 px-2 text-right text-zinc-300">
                          {summary.extinguishersCount} nos
                        </td>
                        <td className="py-2 px-3 text-right text-zinc-100">
                          {params.currency}
                          {(summary.extinguishersCount * params.rateExtinguisher).toLocaleString()}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 text-zinc-200">MS C-class heavy piping (IS 1239)</td>
                        <td className="py-2 px-2 text-right text-zinc-300">
                          {summary.totalPipingM.toFixed(1)} m
                        </td>
                        <td className="py-2 px-3 text-right text-zinc-100">
                          {params.currency}
                          {Math.round(summary.totalPipingM * params.ratePipePerM).toLocaleString()}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 text-zinc-200">Erection, hydro-testing & labor</td>
                        <td className="py-2 px-2 text-right text-zinc-300">LS</td>
                        <td className="py-2 px-3 text-right text-zinc-100">
                          {params.currency}
                          {summary.laborCost.toLocaleString()}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="p-3 rounded-xl bg-zinc-900/50 border border-white/[0.08] space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-300 font-medium">Estimator notes ({activeSheetName})</span>
                  </div>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add fire pump room exclusions, NBC hazard assumptions, or NOC notes..."
                    className="w-full bg-zinc-950 text-xs text-zinc-100 px-2.5 py-1.5 rounded-lg border border-white/[0.08] resize-none"
                  />
                </div>

                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-zinc-300">NBC Part 4 / IS 15105 checks</h3>
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

          <div className="shrink-0 h-12 px-4 border-t border-white/[0.08] bg-zinc-950 flex items-center justify-between text-xs">
            <span className="text-zinc-500 tabular-nums">
              {summary.sprinklersInstalled} sprinklers · {summary.totalPipingM.toFixed(0)} m MS pipe
            </span>
            {step !== 'takeoff' ? (
              <button
                onClick={() =>
                  setStep(
                    step === 'scope' ? 'equipment' : step === 'equipment' ? 'specs' : 'takeoff'
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
