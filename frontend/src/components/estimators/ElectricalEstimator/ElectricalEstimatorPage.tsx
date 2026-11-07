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
  ElectricalParameters,
  ElectricalPointItem,
  ElectricalPointType,
} from './types';
import { calculateElectricalTakeoff } from './electricalMath';
import { cropRawDataToSheet } from '../../SheetSelectorModal';
import { CadEstimatorCanvas, WorldBBox } from '../shared/CadEstimatorCanvas';
import { analyzeCadLayers, inferElectricalFromCad } from '../shared/cadLayerInference';

interface ElectricalEstimatorPageProps {
  plan: any;
  rawData: any;
  fullRawData?: any;
  isGuest?: boolean;
  onBack: () => void;
  onSaveEstimate: (estimate: any) => Promise<void>;
  showToast: (msg: string) => void;
}

type ElecStep = 'scope' | 'points' | 'specs' | 'takeoff';

const DEFAULT_PARAMS: ElectricalParameters = {
  floorHeightM: 3.0,
  averageRunBetweenPointsM: 3.2,
  loopingWastagePct: 15,
  rateConduitPerM: 110,
  rateWire1_5PerM: 18,
  rateWire2_5PerM: 28,
  rateWire4_0PerM: 45,
  ratePerPointLabor: 350,
  currency: '₹',
};

const ELEC_ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'conduit', label: 'Conduit / cable run' },
  { value: 'light', label: 'Lighting fixture' },
  { value: 'fan', label: 'Ceiling / exhaust fan' },
  { value: 'socket', label: '6A socket / switchboard' },
  { value: 'power', label: '16A power / AC point' },
  { value: 'db', label: 'Distribution board (DB)' },
  { value: 'annotation', label: 'Annotation / ignore' },
  { value: 'general', label: 'General geometry' },
];

export const ElectricalEstimatorPage: React.FC<ElectricalEstimatorPageProps> = ({
  plan,
  rawData,
  fullRawData,
  onBack,
  onSaveEstimate,
  showToast,
}) => {
  const savedState = plan?.discipline_estimates?.electrical || plan?.electrical_estimate || {};
  const hasSavedEstimate = Boolean(savedState.points && savedState.points.length > 0);

  const sheets = useMemo<any[]>(
    () => plan?.sheets || fullRawData?.sheets || rawData?.sheets || [],
    [plan?.sheets, fullRawData?.sheets, rawData?.sheets]
  );
  const [activeSheetId, setActiveSheetId] = useState<string>('all');
  const [step, setStep] = useState<ElecStep>('scope');

  const [params, setParams] = useState<ElectricalParameters>(() => ({
    ...DEFAULT_PARAMS,
    ...(savedState.parameters || {}),
  }));
  const [points, setPoints] = useState<(ElectricalPointItem & { sourceLayer?: string })[]>(
    () => savedState.points || []
  );
  const [roleOverrides, setRoleOverrides] = useState<Record<string, string>>(
    () => savedState.roleOverrides || {}
  );
  const [scanBox, setScanBox] = useState<WorldBBox | null>(() => savedState.scanBox || null);
  const [lastScanNote, setLastScanNote] = useState<string>('');

  const [highlightedLayers, setHighlightedLayers] = useState<string[]>([]);
  const [highlightedMark, setHighlightedMark] = useState<string | null>(null);
  const [isSelectingBox, setIsSelectingBox] = useState(false);
  const [pickingAvgRun, setPickingAvgRun] = useState(false);
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
    () => analyzeCadLayers(activeRaw, 'electrical', scanBox, roleOverrides),
    [activeRaw, scanBox, roleOverrides]
  );

  const runCadInference = useCallback(
    (boxOverride?: WorldBBox | null, overridesOverride?: Record<string, string>, silent?: boolean) => {
      if (!activeRaw) return;
      const res = inferElectricalFromCad(
        activeRaw,
        boxOverride !== undefined ? boxOverride : scanBox,
        overridesOverride || roleOverrides
      );
      if (res.points.length > 0) setPoints(res.points);
      if (Object.keys(res.paramPatch).length > 0) {
        setParams((prev) => ({ ...prev, ...res.paramPatch }));
      }
      setLastScanNote(res.summaryNote);
      if (!silent) showToast(res.summaryNote);
    },
    [activeRaw, scanBox, roleOverrides, showToast]
  );

  useEffect(() => {
    if (!hasSavedEstimate && activeRaw && points.length === 0) {
      runCadInference(scanBox, roleOverrides, true);
    }
  }, [hasSavedEstimate, activeRaw]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(
    () => calculateElectricalTakeoff(params, points),
    [params, points]
  );

  const updateParam = <K extends keyof ElectricalParameters>(
    key: K,
    val: ElectricalParameters[K]
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
        electrical_estimate: {
          parameters: params,
          points,
          roleOverrides,
          scanBox,
          summary,
          updatedAt: new Date().toISOString(),
        },
      });
      showToast('Electrical estimate saved');
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
        '25mm HMS PVC conduit & accessories',
        summary.totalConduitLengthM.toFixed(1),
        'm',
        String(params.rateConduitPerM),
        String(Math.round(summary.totalConduitLengthM * params.rateConduitPerM)),
      ],
      [
        '1.5 sq.mm FRLS copper wire (lighting/fan)',
        String(summary.wire1_5M),
        'm',
        String(params.rateWire1_5PerM),
        String(Math.round(summary.wire1_5M * params.rateWire1_5PerM)),
      ],
      [
        '2.5 sq.mm FRLS copper wire (6A circuit)',
        String(summary.wire2_5M),
        'm',
        String(params.rateWire2_5PerM),
        String(Math.round(summary.wire2_5M * params.rateWire2_5PerM)),
      ],
      [
        '4.0 sq.mm FRLS copper wire (16A / AC)',
        String(summary.wire4_0M),
        'm',
        String(params.rateWire4_0PerM),
        String(Math.round(summary.wire4_0M * params.rateWire4_0PerM)),
      ],
      ['Green copper earth wire', String(summary.earthWireM), 'm', '14', String(summary.earthWireM * 14)],
      [
        'Point wiring labor',
        String(summary.totalPoints),
        'pts',
        String(params.ratePerPointLabor),
        String(summary.totalLaborCost),
      ],
      ['Total estimated cost', '', '', '', String(summary.totalCost)],
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(plan?.title || plan?.name || 'electrical').replace(/\s+/g, '_')}_Electrical_BOQ.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // IS 732 circuit loading audit
  const auditChecks = useMemo(() => {
    const lightFanPts = points
      .filter((p) => p.type === 'light' || p.type === 'fan' || p.type === 'socket_6a')
      .reduce((a, p) => a + p.count, 0);
    const minLightCircuits = Math.max(1, Math.ceil(lightFanPts / 10));
    const dbCount = points
      .filter((p) => p.type === 'distribution_board')
      .reduce((a, p) => a + p.count, 0);

    return [
      {
        ok: lightFanPts <= minLightCircuits * 10,
        title: 'IS 732 sub-circuit point limit (max 10 pts / 800W)',
        detail: `${lightFanPts} light/fan/6A points → recommend at least ${minLightCircuits} lighting sub-circuit(s)`,
      },
      {
        ok: dbCount >= 1,
        title: 'MCB distribution board provision',
        detail:
          dbCount >= 1
            ? `${dbCount} distribution board(s) included in schedule`
            : 'No DB listed — add at least 1 MCB distribution board for circuit protection',
      },
      {
        ok: summary.earthWireM > 0,
        title: 'IS 3043 continuous protective earthing',
        detail: `${summary.earthWireM} m dedicated FRLS earth conductor included across ${summary.totalConduitLengthM} m conduit`,
      },
    ];
  }, [points, summary]);

  return (
    <div className="h-screen w-screen bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden select-none">
      {/* Header */}
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
              {plan?.title || plan?.name || 'Electrical takeoff'}
            </h1>
            <span className="text-[11px] text-zinc-400 px-2 py-0.5 rounded bg-zinc-900 border border-white/[0.08]">
              Electrical · IS 732
            </span>
          </div>
        </div>

        <div className="hidden xl:flex items-center gap-6 text-xs tabular-nums">
          <div>
            <span className="text-zinc-500 mr-1.5">Points</span>
            <span className="text-zinc-100 font-medium">{summary.totalPoints}</span>
          </div>
          <div>
            <span className="text-zinc-500 mr-1.5">Conduit</span>
            <span className="text-zinc-100 font-medium">{summary.totalConduitLengthM} m</span>
          </div>
          <div>
            <span className="text-zinc-500 mr-1.5">FRLS wire</span>
            <span className="text-zinc-100 font-medium">
              {summary.wire1_5M + summary.wire2_5M + summary.wire4_0M} m
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

      {/* Split Workstation */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        <div className="lg:w-[56%] h-[46vh] lg:h-full border-b lg:border-b-0 lg:border-r border-white/[0.08] relative">
          <CadEstimatorCanvas
            rawData={activeRaw}
            sheets={sheets}
            activeSheetId={activeSheetId}
            onSelectSheetId={setActiveSheetId}
            highlightedLayers={highlightedLayers}
            highlightedMark={highlightedMark}
            layoutBox={scanBox}
            boxSelectLabel={isSelectingBox ? 'Drag box around electrical layout to scope points' : null}
            onBoxSelected={(bbox) => {
              setScanBox(bbox);
              setIsSelectingBox(false);
              runCadInference(bbox, roleOverrides, false);
            }}
            twoPointPickLabel={
              pickingAvgRun ? 'Click 2 points on CAD to measure typical conduit run between points' : null
            }
            onTwoPointPicked={(distM) => {
              updateParam('averageRunBetweenPointsM', Math.round(distM * 100) / 100);
              setPickingAvgRun(false);
              showToast(`Set average point run to ${distM.toFixed(2)} m`);
            }}
            onCancelExternalTool={() => {
              setIsSelectingBox(false);
              setPickingAvgRun(false);
            }}
          />
        </div>

        <div className="lg:w-[44%] flex-1 flex flex-col bg-zinc-950 overflow-hidden">
          <div className="shrink-0 grid grid-cols-4 border-b border-white/[0.08] bg-zinc-900/50">
            {(
              [
                { id: 'scope', num: '1', label: 'Scope & layers' },
                { id: 'points', num: '2', label: 'Point schedule' },
                { id: 'specs', num: '3', label: 'Conduit & rates' },
                { id: 'takeoff', num: '4', label: 'BOQ & audit' },
              ] as { id: ElecStep; num: string; label: string }[]
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
                      <h2 className="text-xs font-medium text-zinc-100">Electrical layer & symbol detection</h2>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        Counts fixture symbols, switchboard tags, and conduit polylines; falls back to room-by-room load inference on architectural plans
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
                              {st.circleArcCount > 0
                                ? `${st.circleArcCount} sym`
                                : `${st.lineLengthM} m`}
                            </span>
                            <select
                              value={st.inferredRole}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => handleRoleChange(st.name, e.target.value)}
                              className="bg-zinc-950 text-zinc-200 text-[11px] rounded-md px-2 py-1 border border-white/[0.08]"
                            >
                              {ELEC_ROLE_OPTIONS.map((opt) => (
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

            {step === 'points' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-300">
                    Detected electrical points ({summary.totalPoints})
                  </span>
                  <button
                    onClick={() =>
                      setPoints((prev) => [
                        ...prev,
                        {
                          id: `ep_${Date.now()}`,
                          name: 'Additional point group',
                          type: 'light',
                          count: 4,
                          dropHeightM: 0.4,
                        },
                      ])
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-white/[0.08]"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add point row</span>
                  </button>
                </div>

                {points.map((pt) => (
                  <div
                    key={pt.id}
                    onClick={() => {
                      if (pt.sourceLayer) setHighlightedLayers([pt.sourceLayer]);
                      setHighlightedMark(pt.type === 'distribution_board' ? 'DB' : null);
                    }}
                    className="p-3 rounded-xl bg-zinc-900/60 hover:bg-zinc-900 border border-white/[0.08] space-y-2 cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <input
                        value={pt.name}
                        onChange={(e) =>
                          setPoints((prev) =>
                            prev.map((p) => (p.id === pt.id ? { ...p, name: e.target.value } : p))
                          )
                        }
                        className="bg-zinc-950 text-xs font-medium text-zinc-100 px-2.5 py-1 rounded-md border border-white/[0.08] flex-1"
                      />
                      {pt.sourceLayer && (
                        <span className="text-[10px] font-mono text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-950 border border-white/[0.06]">
                          {pt.sourceLayer}
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPoints((prev) => prev.filter((p) => p.id !== pt.id));
                        }}
                        className="p-1 text-zinc-500 hover:text-rose-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs tabular-nums">
                      <label className="space-y-1">
                        <span className="text-[11px] text-zinc-400">Category</span>
                        <select
                          value={pt.type}
                          onChange={(e) =>
                            setPoints((prev) =>
                              prev.map((p) =>
                                p.id === pt.id
                                  ? { ...p, type: e.target.value as ElectricalPointType }
                                  : p
                              )
                            )
                          }
                          className="w-full bg-zinc-950 text-zinc-100 px-2 py-1 rounded border border-white/[0.08]"
                        >
                          <option value="light">Light point</option>
                          <option value="fan">Fan point</option>
                          <option value="socket_6a">6A socket</option>
                          <option value="socket_16a">16A power</option>
                          <option value="ac_point">AC point</option>
                          <option value="switchboard">Switchboard</option>
                          <option value="distribution_board">MCB DB</option>
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] text-zinc-400">Quantity</span>
                        <input
                          type="number"
                          min="0"
                          value={pt.count}
                          onChange={(e) =>
                            setPoints((prev) =>
                              prev.map((p) =>
                                p.id === pt.id ? { ...p, count: Number(e.target.value) || 0 } : p
                              )
                            )
                          }
                          className="w-full bg-zinc-950 text-zinc-100 px-2 py-1 rounded border border-white/[0.08]"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] text-zinc-400">Wall drop (m)</span>
                        <input
                          type="number"
                          step="0.1"
                          value={pt.dropHeightM}
                          onChange={(e) =>
                            setPoints((prev) =>
                              prev.map((p) =>
                                p.id === pt.id
                                  ? { ...p, dropHeightM: Number(e.target.value) || 0 }
                                  : p
                              )
                            )
                          }
                          className="w-full bg-zinc-950 text-zinc-100 px-2 py-1 rounded border border-white/[0.08]"
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {step === 'specs' && (
              <div className="space-y-4 text-xs tabular-nums">
                <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-white/[0.08] space-y-3">
                  <h3 className="font-medium text-zinc-200">Conduit routing & looping parameters</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1">
                      <span className="text-zinc-400">Avg horizontal run / pt (m)</span>
                      <div className="flex gap-1">
                        <input
                          type="number"
                          step="0.1"
                          value={params.averageRunBetweenPointsM}
                          onChange={(e) =>
                            updateParam('averageRunBetweenPointsM', Number(e.target.value) || 3)
                          }
                          className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                        />
                        <button
                          type="button"
                          onClick={() => setPickingAvgRun(true)}
                          className="px-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                          title="Measure run on CAD"
                        >
                          <Ruler className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">Looping & termination (%)</span>
                      <input
                        type="number"
                        value={params.loopingWastagePct}
                        onChange={(e) => updateParam('loopingWastagePct', Number(e.target.value) || 0)}
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-white/[0.08] space-y-3">
                  <h3 className="font-medium text-zinc-200">Unit rates ({params.currency})</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1">
                      <span className="text-zinc-400">25mm PVC conduit / m</span>
                      <input
                        type="number"
                        value={params.rateConduitPerM}
                        onChange={(e) => updateParam('rateConduitPerM', Number(e.target.value) || 0)}
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">Point wiring labor / pt</span>
                      <input
                        type="number"
                        value={params.ratePerPointLabor}
                        onChange={(e) => updateParam('ratePerPointLabor', Number(e.target.value) || 0)}
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">1.5 sq.mm FRLS / m</span>
                      <input
                        type="number"
                        value={params.rateWire1_5PerM}
                        onChange={(e) => updateParam('rateWire1_5PerM', Number(e.target.value) || 0)}
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">2.5 sq.mm FRLS / m</span>
                      <input
                        type="number"
                        value={params.rateWire2_5PerM}
                        onChange={(e) => updateParam('rateWire2_5PerM', Number(e.target.value) || 0)}
                        className="w-full bg-zinc-950 px-2.5 py-1.5 rounded-lg border border-white/[0.08]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-zinc-400">4.0 sq.mm FRLS / m</span>
                      <input
                        type="number"
                        value={params.rateWire4_0PerM}
                        onChange={(e) => updateParam('rateWire4_0PerM', Number(e.target.value) || 0)}
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
                    <span className="text-xs font-medium text-zinc-200">Electrical bill of quantities</span>
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
                        <td className="py-2 px-3 text-zinc-200">25mm HMS PVC conduit</td>
                        <td className="py-2 px-2 text-right text-zinc-300">
                          {summary.totalConduitLengthM} m
                        </td>
                        <td className="py-2 px-3 text-right text-zinc-100">
                          {params.currency}
                          {Math.round(
                            summary.totalConduitLengthM * params.rateConduitPerM
                          ).toLocaleString()}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 text-zinc-200">1.5 sq.mm FRLS copper wire</td>
                        <td className="py-2 px-2 text-right text-zinc-300">{summary.wire1_5M} m</td>
                        <td className="py-2 px-3 text-right text-zinc-100">
                          {params.currency}
                          {Math.round(summary.wire1_5M * params.rateWire1_5PerM).toLocaleString()}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 text-zinc-200">2.5 sq.mm FRLS copper wire</td>
                        <td className="py-2 px-2 text-right text-zinc-300">{summary.wire2_5M} m</td>
                        <td className="py-2 px-3 text-right text-zinc-100">
                          {params.currency}
                          {Math.round(summary.wire2_5M * params.rateWire2_5PerM).toLocaleString()}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 text-zinc-200">4.0 sq.mm FRLS copper wire</td>
                        <td className="py-2 px-2 text-right text-zinc-300">{summary.wire4_0M} m</td>
                        <td className="py-2 px-3 text-right text-zinc-100">
                          {params.currency}
                          {Math.round(summary.wire4_0M * params.rateWire4_0PerM).toLocaleString()}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 text-zinc-200">Protective earth conductor</td>
                        <td className="py-2 px-2 text-right text-zinc-300">{summary.earthWireM} m</td>
                        <td className="py-2 px-3 text-right text-zinc-100">
                          {params.currency}
                          {(summary.earthWireM * 14).toLocaleString()}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 text-zinc-200">Point wiring installation labor</td>
                        <td className="py-2 px-2 text-right text-zinc-300">
                          {summary.totalPoints} pts
                        </td>
                        <td className="py-2 px-3 text-right text-zinc-100">
                          {params.currency}
                          {summary.totalLaborCost.toLocaleString()}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-zinc-300">IS 732 / IS 3043 checks</h3>
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
              {summary.totalPoints} points · {summary.totalConduitLengthM} m conduit
            </span>
            {step !== 'takeoff' ? (
              <button
                onClick={() =>
                  setStep(
                    step === 'scope' ? 'points' : step === 'points' ? 'specs' : 'takeoff'
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
