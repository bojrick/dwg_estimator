import React, { useState } from 'react';
import { X, Check, ArrowRight } from 'lucide-react';
import { AiBadge } from '../ui/AiBadge';
import { PlanDiscipline, DISCIPLINES } from '../../types/plan';

interface AiCleanProposal {
  cleaned_title: string;
  discipline: PlanDiscipline;
  sheets: { id: string; name: string }[];
}

interface AiNameCleanupModalProps {
  originalTitle: string;
  originalDiscipline?: PlanDiscipline;
  originalSheets: { id: string; name: string }[];
  proposal: AiCleanProposal;
  onApply: (applied: { title: string; discipline: PlanDiscipline; sheets: { id: string; name: string }[] }) => void;
  onClose: () => void;
}

export const AiNameCleanupModal: React.FC<AiNameCleanupModalProps> = ({
  originalTitle,
  originalDiscipline = 'architectural',
  originalSheets,
  proposal,
  onApply,
  onClose,
}) => {
  const [selectedTitle, setSelectedTitle] = useState(proposal.cleaned_title || originalTitle);
  const [selectedDiscipline, setSelectedDiscipline] = useState<PlanDiscipline>(proposal.discipline || originalDiscipline);
  const [sheetNames, setSheetNames] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const s of proposal.sheets || []) {
      map[s.id] = s.name;
    }
    return map;
  });

  const handleApply = () => {
    const updatedSheets = originalSheets.map((s) => ({
      id: s.id,
      name: sheetNames[s.id] || s.name,
    }));
    onApply({
      title: selectedTitle.trim() || originalTitle,
      discipline: selectedDiscipline,
      sheets: updatedSheets,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4 shadow-2xl overflow-hidden max-h-[90dvh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            <AiBadge label="AI" />
            <div>
              <h3 className="text-sm font-semibold text-white">Cleaned drawing names</h3>
              <p className="text-[11px] text-zinc-400">
                Review proposed title and sheet names before applying
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto space-y-4 text-xs pr-1">
          {/* Plan Title Section */}
          <div className="space-y-1.5 bg-zinc-950 p-3 rounded-xl border border-zinc-800/80">
            <span className="text-[11px] font-medium text-zinc-400">Plan title</span>
            <div className="flex items-center gap-2 text-zinc-500 text-[11px] truncate">
              <span className="truncate max-w-[200px]" title={originalTitle}>{originalTitle}</span>
              <ArrowRight className="w-3 h-3 shrink-0 text-zinc-600" />
            </div>
            <input
              type="text"
              value={selectedTitle}
              onChange={(e) => setSelectedTitle(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 font-medium"
            />
          </div>

          {/* Discipline Selector */}
          <div className="space-y-1.5 bg-zinc-950 p-3 rounded-xl border border-zinc-800/80">
            <span className="text-[11px] font-medium text-zinc-400">Discipline</span>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {DISCIPLINES.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setSelectedDiscipline(d.id)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-medium border transition ${
                    selectedDiscipline === d.id
                      ? 'bg-zinc-100 text-zinc-950 border-white'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sheet Names Section */}
          {originalSheets.length > 0 && (
            <div className="space-y-2">
              <span className="text-[11px] font-medium text-zinc-400">
                Sheets ({originalSheets.length})
              </span>
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {originalSheets.map((s) => {
                  const proposed = sheetNames[s.id] || s.name;
                  return (
                    <div
                      key={s.id}
                      className="bg-zinc-950 p-2.5 rounded-xl border border-zinc-800/80 space-y-1"
                    >
                      <div className="text-[10px] text-zinc-500 truncate" title={s.name}>
                        Original: {s.name}
                      </div>
                      <input
                        type="text"
                        value={proposed}
                        onChange={(e) =>
                          setSheetNames((prev) => ({
                            ...prev,
                            [s.id]: e.target.value,
                          }))
                        }
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-1.5 shadow transition"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Apply changes</span>
          </button>
        </div>
      </div>
    </div>
  );
};

