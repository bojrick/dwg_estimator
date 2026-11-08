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
  PlumbingParameters,
  PlumbingFixtureItem,
  PlumbingFixtureType,
} from './types';
import { calculatePlumbingTakeoff } from './plumbingMath';
import { cropRawDataToSheet } from '../../SheetSelectorModal';
import { CadEstimatorCanvas, WorldBBox } from '../shared/CadEstimatorCanvas';
import { analyzeCadLayers, inferPlumbingFromCad } from '../shared/cadLayerInference';
import { VersionHistoryControl } from '../shared/VersionHistoryControl';

interface PlumbingEstimatorPageProps {
  plan: any;
  rawData: any;
  fullRawData?: any;
  isGuest?: boolean;
  onBack: () => void;
  onSaveEstimate: (estimate: any) => Promise<void>;
  showToast: (msg: string) => void;
}

type PlumbStep = 'scope' | 'fixtures' | 'specs' | 'takeoff';

const DEFAULT_PARAMS: PlumbingParameters = {
  numOccupants: 8,
  dailyDemandLitersPerHead: 135,
  ohtReserveDays: 1.0,
  ugtReserveDays: 1.5,
  supplyCpvc15M: 35,
  supplyCpvc20M: 25,
  supplyCpvc25M: 15,
  drainPvc75M: 30,
  drainPvc110M: 20,
  rateCpvcPerM: 95,
  ratePvcPerM: 160,
  ratePerFixtureLabor: 1200,
  currency: '₹',
};

const PLUMB_ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'supply_15', label: 'CPVC 15mm branch' },
  { value: 'supply_20', label: 'CPVC 20mm hot/submain' },
  { value: 'supply_25', label: 'CPVC 25mm main/riser' },
  { value: 'drain_75', label: 'SWR PVC 75mm waste' },
  { value: 'drain_110', label: 'SWR PVC 110mm soil' },
  { value: 'fixture', label: 'Sanitary fixture' },
  { value: 'annotation', label: 'Annotation / ignore' },
  { value: 'general', label: 'General geometry' },
];

export const PlumbingEstimatorPage: React.FC<PlumbingEstimatorPageProps> = ({
  plan,
  rawData,
  fullRawData,
  onBack,
  onSaveEstimate,
  showToast,
}) => {
  const savedState = plan?.discipline_estimates?.plumbing || plan?.plumbing_estimate || {};
  const hasSavedEstimate = Boolean(savedState.fixtures && savedState.fixtures.length > 0);

  const sheets = useMemo<any[]>(
    () => plan?.sheets || fullRawData?.sheets || rawData?.sheets || [],
    [plan?.sheets, fullRawData?.sheets, rawData?.sheets]
  );
  const [activeSheetId, setActiveSheetId] = useState<string>(() => {
    const initialSheets = plan?.sheets || fullRawData?.sheets || rawData?.sheets || [];
    return savedState.active_sheet_id || plan?.active_sheet_id || initialSheets[0]?.id || 'all';
  });
  const [step, setStep] = useState<PlumbStep>('scope');
  const [notes, setNotes] = useState<string>(() => savedState.notes || '');
  const [bySheet, setBySheet] = useState<Record<string, any>>(() => savedState.by_sheet || {});
  const [versions, setVersions] = useState<any[]>(() => savedState.versions || []);

  const [params, setParams] = useState<PlumbingParameters>(() => ({
    ...DEFAULT_PARAMS,
    ...(savedState.parameters || {}),
  }));
  const [fixtures, setFixtures] = useState<(PlumbingFixtureItem & { sourceLayer?: string })[]>(
    () => savedState.fixtures || []
  );
  const [roleOverrides, setRoleOverrides] = useState<Record<string, string>>(
    () => savedState.roleOverrides || {}
  );
  const [scanBox, setScanBox] = useState<WorldBBox | null>(() => savedState.scanBox || null);
  const [lastScanNote, setLastScanNote] = useState<string>('');

  const [highlightedLayers, setHighlightedLayers] = useState<string[]>([]);
  const [isSelectingBox, setIsSelectingBox] = useState(false);
  const [pickPipeField, setPickPipeField] = useState<
    | null
    | {
        field: 'supplyCpvc15M' | 'supplyCpvc20M' | 'supplyCpvc25M' | 'drainPvc75M' | 'drainPvc110M';
        label: string;
      }
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
        fixtures,
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
      setFixtures(target.fixtures || []);
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
        const res = inferPlumbingFromCad(nextRaw, null, roleOverrides);
        setFixtures(res.fixtures);
        if (Object.keys(res.paramPatch).length > 0) {
          setParams((prev) => ({ ...prev, ...res.paramPatch }));
        }
        setLastScanNote(res.summaryNote);
      }
    }
  };

  const layerStats = useMemo(
    () => analyzeCadLayers(activeRaw, 'plumbing', scanBox, roleOverrides),
    [activeRaw, scanBox, roleOverrides]
  );

  const runCadInference = useCallback(
    (boxOverride?: WorldBBox | null, overridesOverride?: Record<string, string>, silent?: boolean) => {
      if (!activeRaw) return;
      const res = inferPlumbingFromCad(
        activeRaw,
        boxOverride !== undefined ? boxOverride : scanBox,
        overridesOverride || roleOverrides
      );
      if (res.fixtures.length > 0) setFixtures(res.fixtures);
      if (Object.keys(res.paramPatch).length > 0) {
        setParams((prev) => ({ ...prev, ...res.paramPatch }));
      }
      setLastScanNote(res.summaryNote);
      if (!silent) showToast(res.summaryNote);
    },
    [activeRaw, scanBox, roleOverrides, showToast]
  );

  useEffect(() => {
    if (!hasSavedEstimate && activeRaw && fixtures.length === 0) {
      runCadInference(scanBox, roleOverrides, true);
    }
  }, [hasSavedEstimate, activeRaw]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(
    () => calculatePlumbingTakeoff(params, fixtures),
    [params, fixtures]
  );

  const updateParam = <K extends keyof PlumbingParameters>(key: K, val: PlumbingParameters[K]) => {
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
      const updatedBySheet = {
        ...bySheet,
        [activeSheetId]: {
          sheetId: activeSheetId,
          sheetName: activeSheetName,
          parameters: params,
          fixtures,
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
          fixtures,
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
        plumbing_estimate: {
          active_sheet_id: activeSheetId,
          sheetName: activeSheetName,
          notes,
          parameters: params,
          fixtures,
          roleOverrides,
          scanBox,
          summary,
          by_sheet: updatedBySheet,
          versions: nextVersions,
          updatedAt: new Date().toISOString(),
        },
      });
      showToast(`Saved Plumbing estimate v${newVersion.versionNumber} (${activeSheetName})`);
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
    if (snap.fixtures) setFixtures(snap.fixtures);
    if (snap.roleOverrides) setRoleOverrides(snap.roleOverrides);
    setScanBox(snap.scanBox || null);
    setNotes(snap.notes || '');
    showToast(`Restored v${v.versionNumber} (${v.sheetName})`);
  };

  const handleExportCsv = () => {
    const rows = [
      ['Sheet', activeSheetName, '', '', ''],
      ['Estimator notes', notes || '-', '', '', ''],
      ['Item', 'Quantity', 'Unit', 'Rate', 'Amount'],
      [
        'CPVC water supply piping (15/20/25mm)',
        summary.totalSupplyPipeM.toFixed(1),
        'm',
        String(params.rateCpvcPerM),
        String(Math.round(summary.totalSupplyPipeM * params.rateCpvcPerM)),
      ],
      [
        'SWR PVC soil & waste piping (75/110mm)',
        summary.totalDrainPipeM.toFixed(1),
        'm',
        String(params.ratePvcPerM),
        String(Math.round(summary.totalDrainPipeM * params.ratePvcPerM)),
      ],
      ['Overhead tank (OHT)', String(summary.ohtCapacityLiters), 'L', '6.5', String(Math.round(summary.ohtCapacityLiters * 6.5))],
      ['Underground sump (UGT)', String(summary.ugtCapacityLiters), 'L', '5.0', String(Math.round(summary.ugtCapacityLiters * 5.0))],
      [
        'Sanitary fixture installation labor',
        String(summary.totalFixtures),
        'nos',
        String(params.ratePerFixtureLabor),
        String(summary.laborCost),
      ],
      ['Total estimated cost', '', '', '', String(summary.totalCost)],
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(plan?.title || plan?.name || 'plumbing').replace(/\s+/g, '_')}_Plumbing_BOQ.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const auditChecks = useMemo(() => {
    const wcCount = fixtures.filter((f) => f.type === 'wc').reduce((a, f) => a + f.count, 0);
    const trapCount = fixtures
      .filter((f) => f.type === 'floor_trap')
      .reduce((a, f) => a + f.count, 0);
    return [
      {
        ok: params.dailyDemandLitersPerHead >= 135,
        title: 'IS 1172 domestic water demand norm',
        detail: `${params.numOccupants} occupants × ${params.dailyDemandLitersPerHead} LPCD = ${summary.dailyWaterDemandLpd.toLocaleString()} L/day`,
      },
      {
        ok: summary.ohtCapacityLiters >= summary.dailyWaterDemandLpd * 0.5,
        title: 'OHT & UGT storage reserve sizing',
        detail: `OHT ${summary.ohtCapacityLiters.toLocaleString()} L (${params.ohtReserveDays}d) · UGT ${summary.ugtCapacityLiters.toLocaleString()} L (${params.ugtReserveDays}d)`,
      },
      {
        ok: wcCount === 0 || (params.drainPvc110M > 0 && trapCount >= wcCount),
        title: '110mm soil stack & floor trap coverage',
        detail: `${wcCount} WC(s) served by ${params.drainPvc110M} m of 110mm soil pipe and ${trapCount} floor trap(s)`,
      },
    ];
  }, [fixtures, params, summary]);

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
              {plan?.title || plan?.name || 'Plumbing takeoff'}
            </h1>
            <span className="text-[11px] text-zinc-400 px-2 py-0.5 rounded bg-zinc-900 border border-white/[0.08]">
              PHE · IS 1172
            </span>
          </div>
        </div>

        <div className="hidden xl:flex items-center gap-6 text-xs tabular-nums">
          <div>
            <span className="text-zinc-500 mr-1.5">Fixtures</span>
            <span className="text-zinc-100 font-medium">{summary.totalFixtures}</span>
          </div>
          <div>
            <span className="text-zinc-500 mr-1.5">Supply / Drain</span>
            <span className="text-zinc-100 font-medium">
              {summary.totalSupplyPipeM.toFixed(0)}m / {summary.totalDrainPipeM.toFixed(0)}m
            </span>
          </div>
          <div>
            <span className="text-zinc-500 mr-1.5">Demand</span>
            <span className="text-zinc-100 font-medium">
              {summary.dailyWaterDemandLpd.toLocaleString()} L/d
            </span>
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
            boxSelectLabel={isSelectingBox ? 'Drag box around wet areas / PHE layout to scope' : null}
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
                { id: 'fixtures', num: '2', label: 'Fixtures' },
                { id: 'specs', num: '3', label: 'Pipes & tanks' },
                { id: 'takeoff', num: '4', label: 'BOQ & audit' },
              ] as { id: PlumbStep; num: string; label: string }[]
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
                      <h2 className="text-xs font-medium text-zinc-100">PHE pipe & wet-room detection</h2>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        Measures CPVC supply and SWR drainage line lengths by layer, or infers fixtures from detected toilets & kitchens
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
                            <span className="text-[11px] text-zinc-400">{st.lineLengthM} m</span>
                            <select
                              value={st.inferredRole}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => handleRoleChange(st.name, e.target.value)}
                              className="bg-zinc-950 text-zinc-200 text-[11px] rounded-md px-2 py-1 border border-white/[0.08]"
                            >
                              {PLUMB_ROLE_OPTIONS.map((opt) => (
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

            {step === 'fixtures' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-300">
                    Sanitary fixtures ({summary.totalFixtures})
                  </span>
                  <button
                    onClick={() =>
                      setFixtures((prev) => [
                        ...prev,
                        { id: `pf_${Date.now()}`, name: 'Sanitary fixture', type: 'basin', count: 2 },
                      ])
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-white/[0.08]"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add fixture</span>
                  </button>
                </div>

                {fixtures.map((fx) => (
                  <div
                    key={fx.id}
                    onClick={() => {
                      if (fx.sourceLayer) setHighlightedLayers([fx.sourceLayer]);
                    }}
                    className="p-3 rounded-xl bg-zinc-900/60 hover:bg-zinc-900 border border-white/[0.08] space-y-2 cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <input
                        value={fx.name}
                        onChange={(e) =>
                          setFixtures((prev) =>
                            prev.map((f) => (f.id === fx.id ? { ...f, name: e.target.value } : f))
                          )
                        }
                        className="bg-zinc-950 text-xs font-medium text-zinc-100 px-2.5 py-1 rounded-md border border-white/[0.08] flex-1"
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setFixtures((prev) => prev.filter((f) => f.id !== fx.id));
                        }}
                        className="p-1 text-zinc-500 hover:text-rose-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs tabular-nums">
                      <select
                        value={fx.type}
                        onChange={(e) =>
                          setFixtures((prev) =>
                            prev.map((f) =>
                              f.id === fx.id
                                ? { ...f, type: e.target.value as PlumbingFixtureType }
                                : f
                            )
                          )
                        }
                        className="bg-zinc-950 text-zinc-100 px-2 py-1 rounded border border-white/[0.08]"
                      >
                        <option value="wc">Water closet (WC)</option>
                        <option value="basin">Wash basin</option>
                        <option value="sink">Kitchen / utility sink</option>
                        <option value="shower">Shower mixer</option>
                        <option value="urinal">Urinal</option>
                        <option value="floor_trap">Floor / nahani trap</option>
                      </select>
                      <input
                        type="number"
                        min="0"
                        value={fx.count}
                        onChange={(e) =>
                          setFixtures((prev) =>
                            prev.map((f) =>
                              f.id === fx.id ? { ...f, count: Number(e.target.value) || 0 } : f
                            )
                          )
                        }
                        className="bg-zinc-950 text-zinc-100 px-2 py-1 rounded border border-white/[0.08]"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {step === 'specs' && (
              <div className="space-y-4 text-xs tabular-nums">
                <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-white/[0.08] space-y-3">
                  <h3 className="font-medium text-zinc-200">Pipe run lengths (m) — click ruler to add from CAD</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {(
                      [
                        { field: 'supplyCpvc15M', label: 'CPVC 15mm (m)' },
                        { field: 'supplyCpvc20M', label: 'CPVC 20mm (m)' },
                        { field: 'supplyCpvc25M', label: 'CPVC 25mm (m)' },
                        { field: 'drainPvc75M', label: 'SWR PVC 75mm (m)' },
                        { field: 'drainPvc110M', label: 'SWR PVC 110mm (m)' },
                      ] as const
                    ).map((item) => (
                      <label key={item.field} className="space-y-1">
                        <span className="text-zinc-400">{item.label}</span>
                        <div className="flex gap-1">
                          <input
                            type="number"
                            step="0.5"
                            value={params[item.field]}
                            onChange={(e) => updateParam(item.field, Number(e.target.value) || 0)}
                            className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setPickPipeField({
                                field: item.field,
                                label: `Click 2 points on CAD to add ${item.label}`,
                              })
                            }
                            className="px-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                          >
                            <Ruler className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-white/[0.08] space-y-3">
                  <h3 className="font-medium text-zinc-200">IS 1172 demand & unit rates ({params.currency})</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1">
                      <span className="text-zinc-400">Occupants</span>
                      <input
                        type="number"
                        value={params.numOccupants}
                        onChange={(e) => updateParam('numOccupants', Number(e.target.value) || 1)}
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">Demand (L / head / day)</span>
                      <input
                        type="number"
                        value={params.dailyDemandLitersPerHead}
                        onChange={(e) =>
                          updateParam('dailyDemandLitersPerHead', Number(e.target.value) || 135)
                        }
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">CPVC rate / m</span>
                      <input
                        type="number"
                        value={params.rateCpvcPerM}
                        onChange={(e) => updateParam('rateCpvcPerM', Number(e.target.value) || 0)}
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">SWR PVC rate / m</span>
                      <input
                        type="number"
                        value={params.ratePvcPerM}
                        onChange={(e) => updateParam('ratePvcPerM', Number(e.target.value) || 0)}
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">Fixture labor / unit</span>
                      <input
                        type="number"
                        value={params.ratePerFixtureLabor}
                        onChange={(e) => updateParam('ratePerFixtureLabor', Number(e.target.value) || 0)}
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
                      <span className="text-xs font-medium text-zinc-200">Plumbing & PHE BOQ</span>
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
                        <td className="py-2 px-3 text-zinc-200">CPVC SDR-11 supply piping</td>
                        <td className="py-2 px-2 text-right text-zinc-300">
                          {summary.totalSupplyPipeM.toFixed(1)} m
                        </td>
                        <td className="py-2 px-3 text-right text-zinc-100">
                          {params.currency}
                          {Math.round(summary.totalSupplyPipeM * params.rateCpvcPerM).toLocaleString()}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 text-zinc-200">SWR PVC soil & waste piping</td>
                        <td className="py-2 px-2 text-right text-zinc-300">
                          {summary.totalDrainPipeM.toFixed(1)} m
                        </td>
                        <td className="py-2 px-3 text-right text-zinc-100">
                          {params.currency}
                          {Math.round(summary.totalDrainPipeM * params.ratePvcPerM).toLocaleString()}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 text-zinc-200">Overhead water tank (OHT)</td>
                        <td className="py-2 px-2 text-right text-zinc-300">
                          {summary.ohtCapacityLiters.toLocaleString()} L
                        </td>
                        <td className="py-2 px-3 text-right text-zinc-100">
                          {params.currency}
                          {Math.round(summary.ohtCapacityLiters * 6.5).toLocaleString()}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 text-zinc-200">Underground sump (UGT)</td>
                        <td className="py-2 px-2 text-right text-zinc-300">
                          {summary.ugtCapacityLiters.toLocaleString()} L
                        </td>
                        <td className="py-2 px-3 text-right text-zinc-100">
                          {params.currency}
                          {Math.round(summary.ugtCapacityLiters * 5.0).toLocaleString()}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 text-zinc-200">Sanitary fixture fixing labor</td>
                        <td className="py-2 px-2 text-right text-zinc-300">
                          {summary.totalFixtures} nos
                        </td>
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
                    placeholder="Add pipe pressure class, pump head assumptions, or external manhole notes..."
                    className="w-full bg-zinc-950 text-xs text-zinc-100 px-2.5 py-1.5 rounded-lg border border-white/[0.08] resize-none"
                  />
                </div>

                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-zinc-300">IS 1172 checks</h3>
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
              {summary.totalFixtures} fixtures · {(summary.totalSupplyPipeM + summary.totalDrainPipeM).toFixed(0)} m piping
            </span>
            {step !== 'takeoff' ? (
              <button
                onClick={() =>
                  setStep(
                    step === 'scope' ? 'fixtures' : step === 'fixtures' ? 'specs' : 'takeoff'
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
