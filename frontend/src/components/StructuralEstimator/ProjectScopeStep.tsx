import React from 'react';
import { ArrowRight, Table as TableIcon, Trash2 } from 'lucide-react';
import { AiBadge } from '../ui/AiBadge';
import {
  StructuralMemberType,
  StructuralEstimateState,
  ExtractedCadTable,
} from './types';

const PROJECT_DIAMETER_CHOICES = [8, 10, 12, 16, 20, 25, 28, 32];

interface ProjectScopeStepProps {
  selectedScope: StructuralMemberType;
  onSelectScope: (scope: StructuralMemberType) => void;
  params: StructuralEstimateState['parameters'];
  updateParameters: (patch: Partial<StructuralEstimateState['parameters']>) => void;
  toggleAllowedDiameter: (dia: number) => void;
  isAiAnalyzing: boolean;
  onAnalyzeSheetsAndSpecsAi: () => void;
  sheets: any[];
  activeSheetId: string;
  setActiveSheetId: (id: string) => void;
  scheduleSheetId?: string;
  onSelectScheduleSheetId: (id: string) => void;
  scheduleTables: ExtractedCadTable[];
  onAutoDetectAllTables: () => void;
  toolMode: string;
  setToolMode: (mode: any) => void;
  onViewTable: (table: ExtractedCadTable) => void;
  onDeleteTable: (tableId: string) => void;
  onContinue: () => void;
}

export const ProjectScopeStep: React.FC<ProjectScopeStepProps> = ({
  selectedScope,
  onSelectScope,
  params,
  updateParameters,
  toggleAllowedDiameter,
  isAiAnalyzing,
  onAnalyzeSheetsAndSpecsAi,
  sheets,
  activeSheetId,
  setActiveSheetId,
  scheduleSheetId,
  onSelectScheduleSheetId,
  scheduleTables,
  onAutoDetectAllTables,
  toolMode,
  setToolMode,
  onViewTable,
  onDeleteTable,
  onContinue,
}) => {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top Bar: Element Scope + AI Auto-Fill */}
      <div className="p-3 bg-zinc-950 border-b border-zinc-800/80 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-zinc-300 mr-1">Element:</span>
          {[
            { id: 'beam', label: 'Beams' },
            { id: 'column', label: 'Columns' },
            { id: 'footing', label: 'Footings' },
            { id: 'slab', label: 'Slabs' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectScope(item.id as StructuralMemberType)}
              className={`min-h-[38px] sm:min-h-0 px-3 py-1 rounded-lg text-xs font-medium transition ${selectedScope === item.id
                  ? 'bg-zinc-100 text-zinc-950 font-medium'
                  : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-zinc-200'
                }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onAnalyzeSheetsAndSpecsAi}
          disabled={isAiAnalyzing}
          className="min-h-[38px] sm:min-h-0 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-700 hover:border-zinc-600 text-zinc-200 text-[11px] font-medium flex items-center gap-1.5 transition disabled:opacity-50"
          title="Read General Notes and title blocks to auto-fill grades, covers, and sheet names"
        >
          <AiBadge label="AI" />
          <span>
            {isAiAnalyzing ? 'Reading notes with AI...' : 'Auto-fill from drawing notes'}
          </span>
        </button>
      </div>

      {/* Fitted Middle Content: 2-Column Project & IS Code Setup + Schedule Tables */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 text-xs">
        {/* 2-Column Grid: Commercial Constraints vs IS 456 / 2502 / 13920 Assumptions */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {/* Card 1: Steel Pricing, Max Stock Length & Diameter Constraints */}
          <div className="bg-zinc-950 border border-zinc-800/90 rounded-xl p-3 space-y-2.5">
            <div className="flex items-center justify-between border-b border-zinc-900 pb-1.5">
              <span className="font-medium text-zinc-200">
                Steel pricing & stock constraints
              </span>
              <span className="text-[11px] text-emerald-400 font-mono tabular-nums">
                {params.currency} {((params.steelRatePerKg || 0) * 1000).toLocaleString('en-IN')} / tonne
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 font-mono tabular-nums">
              <div>
                <label className="block text-[10px] font-sans text-zinc-400 mb-1">
                  Steel rate per kg
                </label>
                <div className="flex items-center gap-1">
                  <select
                    value={params.currency}
                    onChange={(e) => updateParameters({ currency: e.target.value })}
                    className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-zinc-200 text-xs"
                  >
                    <option value="₹">₹</option>
                    <option value="$">$</option>
                    <option value="AED">AED</option>
                  </select>
                  <input
                    type="number"
                    step="1"
                    value={params.steelRatePerKg}
                    onChange={(e) =>
                      updateParameters({ steelRatePerKg: Math.max(0, Number(e.target.value)) })
                    }
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-zinc-100 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-sans text-zinc-400 mb-1">
                  Max bar stock length (m)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="3"
                  max="18"
                  value={params.maxStockLengthM ?? 12.0}
                  onChange={(e) =>
                    updateParameters({
                      maxStockLengthM: Math.max(3, Number(e.target.value)),
                    })
                  }
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-zinc-100 text-xs"
                  title="Bars longer than this automatically include a lap splice"
                />
              </div>

              <div>
                <label className="block text-[10px] font-sans text-zinc-400 mb-1">
                  Rolling wastage (%)
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={params.wastagePct}
                  onChange={(e) =>
                    updateParameters({ wastagePct: Math.max(0, Number(e.target.value)) })
                  }
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-zinc-100 text-xs"
                />
              </div>

              <div>
                <label className="block text-[10px] font-sans text-zinc-400 mb-1">
                  Binding wire (%)
                </label>
                <input
                  type="number"
                  step="0.25"
                  value={params.bindingWirePct}
                  onChange={(e) =>
                    updateParameters({
                      bindingWirePct: Math.max(0, Number(e.target.value)),
                    })
                  }
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-zinc-100 text-xs"
                />
              </div>
            </div>

            {/* Allowed Bar Diameter Constraints */}
            <div className="pt-1 border-t border-zinc-900 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">
                  Allowed bar diameters (mm)
                </span>
                <div className="flex items-center gap-2 text-[10px]">
                  <button
                    type="button"
                    onClick={() =>
                      updateParameters({ allowedDiameters: [8, 10, 12, 16, 20] })
                    }
                    className="text-zinc-400 hover:text-zinc-200 underline"
                  >
                    Residential (≤20)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateParameters({ allowedDiameters: PROJECT_DIAMETER_CHOICES })
                    }
                    className="text-zinc-400 hover:text-zinc-200 underline"
                  >
                    All sizes
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1 font-mono tabular-nums">
                {PROJECT_DIAMETER_CHOICES.map((d) => {
                  const isAllowed = (
                    params.allowedDiameters || PROJECT_DIAMETER_CHOICES
                  ).includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleAllowedDiameter(d)}
                      className={`px-2 py-0.5 rounded border text-[11px] transition ${isAllowed
                          ? 'bg-zinc-800 border-zinc-600 text-zinc-100 font-medium'
                          : 'bg-zinc-950 border-zinc-900 text-zinc-600 line-through'
                        }`}
                    >
                      Φ{d}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Card 2: IS 456 / IS 2502 / IS 13920 Assumptions */}
          <div className="bg-zinc-950 border border-zinc-800/90 rounded-xl p-3 space-y-2.5">
            <div className="flex items-center justify-between border-b border-zinc-900 pb-1.5">
              <span className="font-medium text-zinc-200">
                IS 456 & IS 13920 code assumptions
              </span>
              <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={params.seismicDuctileDetailing ?? true}
                  onChange={(e) =>
                    updateParameters({ seismicDuctileDetailing: e.target.checked })
                  }
                  className="rounded border-zinc-700 bg-zinc-900"
                />
                <span>IS 13920 ductile zones</span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2 font-mono tabular-nums">
              <div>
                <label className="block text-[10px] font-sans text-zinc-400 mb-1">
                  Concrete & steel grade
                </label>
                <div className="flex items-center gap-1">
                  <select
                    value={params.concreteGrade || 'M25'}
                    onChange={(e) => updateParameters({ concreteGrade: e.target.value })}
                    className="w-1/2 bg-zinc-900 border border-zinc-800 rounded-lg px-1.5 py-1 text-zinc-100 text-xs"
                  >
                    {['M20', 'M25', 'M30', 'M35', 'M40'].map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                  <select
                    value={params.steelGrade || 'Fe500D'}
                    onChange={(e) => updateParameters({ steelGrade: e.target.value })}
                    className="w-1/2 bg-zinc-900 border border-zinc-800 rounded-lg px-1.5 py-1 text-zinc-100 text-xs"
                  >
                    {['Fe415', 'Fe500', 'Fe500D', 'Fe550D'].map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-sans text-zinc-400 mb-1">
                  Lap / Ld & stirrup hook
                </label>
                <div className="flex items-center gap-1">
                  <select
                    value={params.lapLengthMultiplier ?? 50}
                    onChange={(e) =>
                      updateParameters({ lapLengthMultiplier: Number(e.target.value) })
                    }
                    className="w-1/2 bg-zinc-900 border border-zinc-800 rounded-lg px-1.5 py-1 text-zinc-100 text-xs"
                    title="Development & lap length multiplier (e.g. 50d)"
                  >
                    {[40, 45, 48, 50, 55, 60].map((m) => (
                      <option key={m} value={m}>
                        {m}d lap
                      </option>
                    ))}
                  </select>
                  <select
                    value={params.hookAllowanceMultiplier ?? 24}
                    onChange={(e) =>
                      updateParameters({ hookAllowanceMultiplier: Number(e.target.value) })
                    }
                    className="w-1/2 bg-zinc-900 border border-zinc-800 rounded-lg px-1.5 py-1 text-zinc-100 text-xs"
                    title="Stirrup hook allowance (24d for 135° seismic, 18d for 90°)"
                  >
                    <option value={24}>24d (135°)</option>
                    <option value={20}>20d (std)</option>
                    <option value={18}>18d (90°)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Clear Covers (mm) & Floor Height */}
            <div className="pt-1 border-t border-zinc-900 space-y-1">
              <span className="text-[10px] text-zinc-400 block">
                Clear cover (mm) & default floor height
              </span>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 font-mono tabular-nums text-[11px]">
                {(['footing', 'column', 'beam', 'slab'] as const).map((el) => (
                  <div key={el}>
                    <span className="text-[10px] font-sans text-zinc-500 capitalize block">
                      {el}
                    </span>
                    <input
                      type="number"
                      value={params.defaultCoverMm[el]}
                      onChange={(e) =>
                        updateParameters({
                          defaultCoverMm: {
                            ...params.defaultCoverMm,
                            [el]: Math.max(10, Number(e.target.value)),
                          },
                        })
                      }
                      className="w-full bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-center text-zinc-100"
                    />
                  </div>
                ))}
                <div>
                  <span className="text-[10px] font-sans text-zinc-500 block">
                    Floor ht
                  </span>
                  <input
                    type="number"
                    step="100"
                    value={params.defaultFloorHeightMm ?? 3000}
                    onChange={(e) =>
                      updateParameters({
                        defaultFloorHeightMm: Math.max(1500, Number(e.target.value)),
                      })
                    }
                    className="w-full bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-center text-zinc-100"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sheet Mapping & Schedule Table Extractor Card */}
        <div className="bg-zinc-950 border border-zinc-800/90 rounded-xl p-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <TableIcon className="w-3.5 h-3.5 text-zinc-400" />
              <span className="font-medium text-zinc-200">
                Schedule tables & sheet mapping ({scheduleTables.length})
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={onAutoDetectAllTables}
                className="min-h-[38px] sm:min-h-0 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-200 text-[11px] font-medium transition"
              >
                Scan all sheets for tables
              </button>
              <button
                type="button"
                onClick={() =>
                  setToolMode(toolMode === 'select_table' ? 'pan' : 'select_table')
                }
                className={`min-h-[38px] sm:min-h-0 px-2.5 py-1 rounded-lg text-[11px] font-medium transition ${toolMode === 'select_table'
                    ? 'bg-amber-400 text-zinc-950'
                    : 'bg-zinc-100 hover:bg-white text-zinc-950'
                  }`}
              >
                {toolMode === 'select_table' ? 'Cancel box' : 'Pick table on drawing'}
              </button>
            </div>
          </div>

          {sheets.length > 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-zinc-400 whitespace-nowrap">
                  Layout sheet:
                </span>
                <select
                  value={activeSheetId}
                  onChange={(e) => setActiveSheetId(e.target.value)}
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-zinc-200 text-[11px]"
                >
                  {sheets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-zinc-400 whitespace-nowrap">
                  Schedule sheet:
                </span>
                <select
                  value={scheduleSheetId || activeSheetId}
                  onChange={(e) => onSelectScheduleSheetId(e.target.value)}
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-zinc-200 text-[11px]"
                >
                  {sheets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {scheduleTables.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              {scheduleTables.map((tbl) => (
                <div
                  key={tbl.id}
                  className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <span className="font-medium text-[11px] text-zinc-100 truncate block">
                      {tbl.title || 'Schedule table'}
                    </span>
                    <span className="text-[10px] text-zinc-400 font-mono tabular-nums">
                      {tbl.rows.length} rows · {tbl.headers.length} cols
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onViewTable(tbl)}
                      className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px]"
                    >
                      View
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteTable(tbl.id)}
                      className="p-1 text-zinc-500 hover:text-rose-400"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pinned Bottom Footer (Zero Scroll needed to proceed) */}
      <div className="min-h-12 py-2 sm:py-0 sm:h-12 px-3 sm:px-4 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between gap-2 sm:gap-3 shrink-0">
        <div className="text-[11px] text-zinc-400 font-mono tabular-nums min-w-0 truncate">
          {params.concreteGrade} · {params.steelGrade} · Max bar {params.maxStockLengthM}m · Ld={params.lapLengthMultiplier}d
        </div>

        <button
          type="button"
          onClick={onContinue}
          className="min-h-[40px] sm:min-h-0 px-3 sm:px-4 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-medium flex items-center gap-1.5 transition shrink-0"
        >
          <span className="hidden sm:inline">Continue to members & sizes</span>
          <span className="sm:hidden">Members & sizes</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

