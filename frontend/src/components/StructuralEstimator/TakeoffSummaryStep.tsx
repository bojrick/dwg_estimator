import React, { useMemo } from 'react';
import { Download, Save, CheckCircle2, AlertTriangle, ArrowLeft, Layers } from 'lucide-react';
import {
  BbsBarItem,
  CivilAuditAnomaly,
  DiameterSummary,
  LongitudinalSectionDefinition,
  StructuralEstimateState,
  StructuralMemberDefinition,
} from './types';

interface TakeoffSummaryStepProps {
  takeoffTotals: {
    netWeightKg: number;
    netWeightTonnes: number;
    wastageKg: number;
    totalWeightWithWastageKg: number;
    bindingWireKg: number;
    totalCost: number;
  };
  params: StructuralEstimateState['parameters'];
  takeoffTab: 'bbs' | 'diameter' | 'audit';
  setTakeoffTab: (tab: 'bbs' | 'diameter' | 'audit') => void;
  bbsItems: BbsBarItem[];
  diameterSummary: DiameterSummary[];
  auditAnomalies: CivilAuditAnomaly[];
  onExportBbsCsv: () => void;
  onHighlightMember: (mark: string) => void;
  onSaveAll: () => void;
  isSaving: boolean;
  onBackToStep3: () => void;
  longitudinalSections?: LongitudinalSectionDefinition[];
  definedMembers?: StructuralMemberDefinition[];
}

export const TakeoffSummaryStep: React.FC<TakeoffSummaryStepProps> = ({
  takeoffTotals,
  params,
  takeoffTab,
  setTakeoffTab,
  bbsItems,
  diameterSummary,
  auditAnomalies,
  onExportBbsCsv,
  onHighlightMember,
  onSaveAll,
  isSaving,
  onBackToStep3,
  longitudinalSections = [],
  definedMembers = [],
}) => {
  const hasLs = longitudinalSections.length > 0;
  const totalSpans = useMemo(
    () => longitudinalSections.reduce((sum, ls) => sum + (ls.spans?.length || 0), 0),
    [longitudinalSections]
  );
  const coveredBeamMarks = useMemo(() => {
    const set = new Set<string>();
    for (const ls of longitudinalSections) {
      for (const s of ls.spans || []) {
        if (s.beamMark) set.add(s.beamMark.trim().toUpperCase());
      }
    }
    return set;
  }, [longitudinalSections]);

  const excludedBeamCount = useMemo(() => {
    if (!hasLs) return 0;
    return definedMembers.filter(
      (m) => m.category === 'beam' && !coveredBeamMarks.has(m.mark.trim().toUpperCase())
    ).length;
  }, [hasLs, definedMembers, coveredBeamMarks]);
  return (
    <div className="h-full flex flex-col overflow-hidden bg-zinc-950">
      {/* Pinned Top Metrics Bar */}
      <div className="p-3 bg-zinc-950 border-b border-zinc-800/80 space-y-2.5 shrink-0">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono tabular-nums">
          <div className="bg-zinc-900 border border-zinc-800/80 rounded-lg p-2">
            <div className="text-[10px] font-sans text-zinc-400">Net rebar weight</div>
            <div className="text-sm font-medium text-zinc-100 mt-0.5">
              {takeoffTotals.netWeightKg.toLocaleString('en-IN')} kg
            </div>
            <div className="text-[10px] text-zinc-500">
              {takeoffTotals.netWeightTonnes} t
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800/80 rounded-lg p-2">
            <div className="text-[10px] font-sans text-zinc-400">
              Gross (+{params.wastagePct}% waste)
            </div>
            <div className="text-sm font-medium text-amber-300 mt-0.5">
              {takeoffTotals.totalWeightWithWastageKg.toLocaleString('en-IN')} kg
            </div>
            <div className="text-[10px] text-zinc-500">
              +{takeoffTotals.wastageKg} kg waste
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800/80 rounded-lg p-2">
            <div className="text-[10px] font-sans text-zinc-400">
              Binding wire ({params.bindingWirePct}%)
            </div>
            <div className="text-sm font-medium text-zinc-200 mt-0.5">
              {takeoffTotals.bindingWireKg} kg
            </div>
            <div className="text-[10px] font-sans text-zinc-500">
              Max stock {params.maxStockLengthM}m
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-2">
            <div className="text-[10px] font-sans text-zinc-400">
              Total steel budget
            </div>
            <div className="text-sm font-medium text-emerald-400 mt-0.5">
              {params.currency} {takeoffTotals.totalCost.toLocaleString('en-IN')}
            </div>
            <div className="text-[10px] text-zinc-500">
              @ {params.currency}
              {params.steelRatePerKg}/kg
            </div>
          </div>
        </div>

        {/* Longitudinal Section Coverage Banner */}
        {hasLs && (
          <div className="p-2.5 rounded-lg bg-zinc-900/80 border border-zinc-700/80 flex items-start gap-2.5 text-xs">
            <div className="p-1 rounded bg-amber-400/10 text-amber-400 shrink-0 mt-0.5">
              <Layers className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <span className="font-medium text-zinc-100">
                Beam BBS calculated strictly from {longitudinalSections.length} Longitudinal Section{longitudinalSections.length > 1 ? 's' : ''} ({totalSpans} continuous spans per IS 13920 detailing)
              </span>
              {excludedBeamCount > 0 && (
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  {excludedBeamCount} plan beam mark{excludedBeamCount > 1 ? 's have' : ' has'} no L-Section and {excludedBeamCount > 1 ? 'are' : 'is'} excluded from takeoff.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Sub-View Tabs & CSV Export */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded-lg border border-zinc-800 text-[11px] overflow-x-auto no-scrollbar max-w-full">
            <button
              type="button"
              onClick={() => setTakeoffTab('bbs')}
              className={`shrink-0 px-3 py-1 rounded-md font-medium tabular-nums transition ${takeoffTab === 'bbs'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
                }`}
            >
              Bar bending schedule ({bbsItems.length})
            </button>
            <button
              type="button"
              onClick={() => setTakeoffTab('diameter')}
              className={`shrink-0 px-3 py-1 rounded-md font-medium tabular-nums transition ${takeoffTab === 'diameter'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
                }`}
            >
              By diameter ({diameterSummary.length})
            </button>
            <button
              type="button"
              onClick={() => setTakeoffTab('audit')}
              className={`shrink-0 px-3 py-1 rounded-md font-medium tabular-nums transition flex items-center gap-1 ${takeoffTab === 'audit'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
                }`}
            >
              <span>IS 456 check</span>
              {auditAnomalies.length > 0 ? (
                <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[10px]">
                  {auditAnomalies.length}
                </span>
              ) : (
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={onExportBbsCsv}
            disabled={bbsItems.length === 0}
            className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-200 text-[11px] font-medium flex items-center gap-1.5 transition disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Contained Tab Body (Zero Outer Page Scroll) */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-zinc-950">
        {takeoffTab === 'bbs' && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs min-w-[650px]">
              <thead className="sticky top-0 z-10 bg-zinc-900 border-b border-zinc-800 text-[11px] text-zinc-400">
                <tr>
                  <th className="py-2 pl-3 pr-2 text-left font-medium w-[18%]">Member</th>
                  <th className="py-2 px-2 text-left font-medium w-[28%]">Bar role & shape</th>
                  <th className="py-2 px-2 text-center font-medium w-[12%]">Dia</th>
                  <th className="py-2 px-2 text-right font-medium w-[14%]">Cut L (m)</th>
                  <th className="py-2 px-2 text-center font-medium w-[14%]">Bars</th>
                  <th className="py-2 pl-2 pr-3 text-right font-medium w-[14%]">Weight (kg)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900 font-mono tabular-nums">
                {bbsItems.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => onHighlightMember(item.memberId)}
                    className="hover:bg-zinc-900/50 cursor-pointer transition"
                  >
                    <td className="py-2 pl-3 pr-2 font-medium text-zinc-100 truncate">
                      {item.memberId}
                    </td>
                    <td className="py-2 px-2 font-sans text-zinc-300 truncate">
                      <span className="font-medium text-zinc-200">{item.mark}</span>
                      <span className="block text-[10px] text-zinc-400 font-mono truncate" title={item.notes || ''}>
                        {item.shape.replace('_', ' ')}{item.notes ? ` · ${item.notes}` : ''}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-center text-zinc-200">Φ{item.diameter}</td>
                    <td className="py-2 px-2 text-right text-zinc-200">
                      {item.cuttingLengthM.toFixed(2)}
                    </td>
                    <td className="py-2 px-2 text-center text-zinc-200">{item.totalBars}</td>
                    <td className="py-2 pl-2 pr-3 text-right font-medium text-zinc-100">
                      {item.totalWeightKg.toFixed(1)}
                    </td>
                  </tr>
                ))}
                {bbsItems.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-zinc-500 font-sans">
                      No structural bars generated. Check Step 2 (members) and Step 3 (reinforcement).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {takeoffTab === 'diameter' && (
          <div className="p-3 space-y-2 overflow-x-auto">
            <table className="w-full min-w-[460px] border-collapse text-xs">
              <thead className="bg-zinc-900 border-b border-zinc-800 text-[11px] text-zinc-400">
                <tr>
                  <th className="py-2 pl-3 text-left font-medium">Diameter</th>
                  <th className="py-2 text-right font-medium">Unit wt (kg/m)</th>
                  <th className="py-2 text-center font-medium">Bar count</th>
                  <th className="py-2 text-right font-medium">Total length (m)</th>
                  <th className="py-2 pr-3 text-right font-medium">Total weight (kg)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900 font-mono tabular-nums">
                {diameterSummary.map((d) => (
                  <tr key={d.diameter} className="hover:bg-zinc-900/40">
                    <td className="py-2 pl-3 font-medium text-zinc-100">Φ{d.diameter} mm</td>
                    <td className="py-2 text-right text-zinc-400">
                      {d.unitWeightKgM ? d.unitWeightKgM.toFixed(3) : ((d.diameter * d.diameter) / 162).toFixed(3)}
                    </td>
                    <td className="py-2 text-center text-zinc-300">{d.totalBars}</td>
                    <td className="py-2 text-right text-zinc-300">{(d.totalLengthM || 0).toFixed(1)}</td>
                    <td className="py-2 pr-3 text-right font-medium text-zinc-100">
                      {(d.totalWeightKg || 0).toFixed(1)}
                    </td>
                  </tr>
                ))}
                {diameterSummary.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-zinc-500 font-sans">
                      No rebar diameter summary available yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {takeoffTab === 'audit' && (
          <div className="p-3 space-y-2">
            {auditAnomalies.length === 0 ? (
              <div className="p-6 text-center space-y-1 bg-zinc-900/40 border border-zinc-800/80 rounded-xl">
                <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto" />
                <div className="text-sm font-medium text-zinc-100">All IS 456 checks passed</div>
                <div className="text-xs text-zinc-400">
                  Steel ratios, clear covers, stirrup spacings, and allowed diameters are verified.
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {auditAnomalies.map((anom, idx) => (
                  <div
                    key={idx}
                    className={`p-2.5 rounded-xl border flex items-start gap-2 text-xs ${anom.severity === 'error'
                        ? 'bg-rose-950/25 border-rose-500/30 text-rose-200'
                        : 'bg-amber-950/25 border-amber-500/30 text-amber-200'
                      }`}
                  >
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold">{anom.codeClause}: {anom.memberMark}</div>
                      <div className="text-[11px] opacity-90">{anom.message}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pinned Bottom Actions */}
      <div className="min-h-12 py-2 sm:py-0 sm:h-12 px-3 sm:px-4 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between gap-2 sm:gap-3 shrink-0">
        <button
          type="button"
          onClick={onBackToStep3}
          className="min-h-[40px] sm:min-h-0 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 text-xs font-medium flex items-center gap-1.5 transition shrink-0"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Back to reinforcement</span>
          <span className="sm:hidden">Reinforcement</span>
        </button>

        <button
          type="button"
          onClick={onSaveAll}
          disabled={isSaving}
          className="min-h-[40px] sm:min-h-0 px-3 sm:px-5 py-1.5 rounded-lg bg-zinc-100 hover:bg-white disabled:opacity-50 text-zinc-950 text-xs font-medium flex items-center gap-1.5 transition shrink-0"
        >
          <Save className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{isSaving ? 'Saving estimate...' : 'Save structural estimate'}</span>
          <span className="sm:hidden">{isSaving ? 'Saving...' : 'Save estimate'}</span>
        </button>
      </div>
    </div>
  );
};

