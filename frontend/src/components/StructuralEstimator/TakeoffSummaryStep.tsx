import React from 'react';
import { Download, Save, CheckCircle2, AlertTriangle, ArrowLeft } from 'lucide-react';
import {
  BbsBarItem,
  CivilAuditAnomaly,
  StructuralEstimateState,
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
  diameterSummary: { dia: number; lengthM: number; weightKg: number; count: number }[];
  auditAnomalies: CivilAuditAnomaly[];
  onExportBbsCsv: () => void;
  onHighlightMember: (mark: string) => void;
  onSaveAll: () => void;
  isSaving: boolean;
  onBackToStep3: () => void;
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
}) => {
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

        {/* Sub-View Tabs & CSV Export */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded-lg border border-zinc-800 text-[11px]">
            <button
              type="button"
              onClick={() => setTakeoffTab('bbs')}
              className={`px-3 py-1 rounded-md font-medium tabular-nums transition ${
                takeoffTab === 'bbs'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Bar bending schedule ({bbsItems.length})
            </button>
            <button
              type="button"
              onClick={() => setTakeoffTab('diameter')}
              className={`px-3 py-1 rounded-md font-medium tabular-nums transition ${
                takeoffTab === 'diameter'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              By diameter ({diameterSummary.length})
            </button>
            <button
              type="button"
              onClick={() => setTakeoffTab('audit')}
              className={`px-3 py-1 rounded-md font-medium tabular-nums transition flex items-center gap-1 ${
                takeoffTab === 'audit'
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
                      <span>{item.mark}</span>
                      <span className="block text-[10px] text-zinc-500 font-mono">
                        {item.shape.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-center text-zinc-200">Φ{item.diameter}</td>
                    <td className="py-2 px-2 text-right text-zinc-200">
                      {item.cuttingLengthM.toFixed(2)}
                    </td>
                    <td className="py-2 px-2 text-center text-zinc-200">{item.barCount}</td>
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
          <div className="p-3 space-y-2">
            <table className="w-full border-collapse text-xs">
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
                  <tr key={d.dia} className="hover:bg-zinc-900/40">
                    <td className="py-2 pl-3 font-medium text-zinc-100">Φ{d.dia} mm</td>
                    <td className="py-2 text-right text-zinc-400">
                      {((d.dia * d.dia) / 162).toFixed(3)}
                    </td>
                    <td className="py-2 text-center text-zinc-300">{d.count}</td>
                    <td className="py-2 text-right text-zinc-300">{d.lengthM.toFixed(1)}</td>
                    <td className="py-2 pr-3 text-right font-medium text-zinc-100">
                      {d.weightKg.toFixed(1)}
                    </td>
                  </tr>
                ))}
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
                    className={`p-2.5 rounded-xl border flex items-start gap-2 text-xs ${
                      anom.severity === 'error'
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
      <div className="h-12 px-4 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between gap-3 shrink-0">
        <button
          type="button"
          onClick={onBackToStep3}
          className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 text-xs font-medium flex items-center gap-1.5 transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to reinforcement</span>
        </button>

        <button
          type="button"
          onClick={onSaveAll}
          disabled={isSaving}
          className="px-5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 shadow transition"
        >
          <Save className="w-3.5 h-3.5" />
          <span>{isSaving ? 'Saving estimate...' : 'Save structural estimate'}</span>
        </button>
      </div>
    </div>
  );
};

