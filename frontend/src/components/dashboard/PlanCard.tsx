import React from 'react';
import {
  FolderKanban,
  FolderInput,
  Pencil,
  Share2,
  Trash2,
  FileCode2,
  Layers,
  Ruler,
  FileSpreadsheet,
} from 'lucide-react';
import { DISCIPLINES, PlanDiscipline } from '../../types/plan';

interface PlanCardProps {
  plan: any;
  selectedProject: string;
  onOpenPlan: (plan: any) => void;
  onOpenEstimator: (plan: any) => void;
  onMovePlan: (plan: any) => void;
  onRenamePlan: (plan: any) => void;
  onSharePlan: (plan: any) => void;
  onDeletePlan: (plan: any) => void;
}

export const PlanCard: React.FC<PlanCardProps> = ({
  plan,
  selectedProject,
  onOpenPlan,
  onOpenEstimator,
  onMovePlan,
  onRenamePlan,
  onSharePlan,
  onDeletePlan,
}) => {
  const s = plan.summary || {};
  const totalSheets = s.total_sheets_in_dwg || (plan.sheets?.length ?? 0);
  const discObj =
    DISCIPLINES.find((d) => d.id === (plan.discipline || 'architectural')) || DISCIPLINES[0];

  return (
    <div className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-2xl p-3.5 sm:p-4 flex flex-col justify-between gap-3 transition shadow-xs overflow-hidden">
      <div className="space-y-2">
        {/* Row 1: Discipline Tag + Project & Actions */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`px-2 py-0.5 rounded-md border text-[10px] font-medium shrink-0 ${discObj.badgeClass}`}
            >
              {discObj.label}
            </span>
            {selectedProject === 'ALL' && (
              <span className="text-[10px] font-mono text-zinc-400 flex items-center gap-1 truncate min-w-0">
                <FolderKanban className="w-2.5 h-2.5 opacity-60 shrink-0" />
                <span className="truncate max-w-[110px] sm:max-w-[150px]">
                  {plan.project_name || 'Default Project'}
                </span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onMovePlan(plan)}
              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition"
              title="Move to another project"
            >
              <FolderInput className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onRenamePlan(plan)}
              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition"
              title="Rename plan"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onSharePlan(plan)}
              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-blue-600 text-zinc-400 hover:text-white transition"
              title="Share plan link"
            >
              <Share2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onDeletePlan(plan)}
              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-600 text-zinc-400 hover:text-white transition"
              title="Delete plan"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Row 2: Title & Original DWG File */}
        <div>
          <h3
            onClick={() => onOpenPlan(plan)}
            className="text-sm sm:text-base font-semibold text-white hover:text-blue-400 transition cursor-pointer line-clamp-1"
            title={plan.name}
          >
            {plan.name}
          </h3>
          <div className="flex items-center gap-1.5 text-zinc-400 text-[11px] font-mono mt-0.5 truncate">
            <FileCode2 className="w-3 h-3 text-zinc-500 shrink-0" />
            <span className="truncate" title={plan.dwg_filename || ''}>
              {plan.dwg_filename || 'Vector CAD Drawing'}
            </span>
          </div>
        </div>

        {/* Row 3: Metadata Badges */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono tabular-nums text-zinc-400 pt-0.5">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-300">
            <Layers className="w-3 h-3 text-zinc-400" />
            <span>
              {totalSheets} {totalSheets === 1 ? 'sheet' : 'sheets'}
            </span>
          </span>

          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-300">
            <Ruler className="w-3 h-3 text-zinc-400" />
            <span>{plan.unit_name || 'm'}</span>
          </span>

          {plan.active_sheet_name && plan.active_sheet_name !== 'Full Plan View' && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-400 truncate max-w-[130px]"
              title={plan.active_sheet_name}
            >
              <span className="truncate">{plan.active_sheet_name}</span>
            </span>
          )}
        </div>
      </div>

      {/* Row 4: Action Buttons */}
      <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between gap-2">
        <button
          onClick={() => onOpenPlan(plan)}
          className="flex-1 py-1.5 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white transition text-center truncate"
        >
          Open drawing
        </button>
        <button
          onClick={() => onOpenEstimator(plan)}
          className="py-1.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition shrink-0 shadow-xs"
          title={`Launch ${discObj.estimatorLabel}`}
        >
          <FileSpreadsheet className="w-3.5 h-3.5" />
          <span>{discObj.estimatorLabel.replace(' Estimator', '')}</span>
        </button>
      </div>
    </div>
  );
};

