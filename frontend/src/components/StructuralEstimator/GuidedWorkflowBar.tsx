import React from 'react';
import { Layers, FolderKanban, Sparkles, FileSpreadsheet, Check } from 'lucide-react';
import { GuidedWorkflowStep } from './types';

interface GuidedWorkflowBarProps {
  currentStep: GuidedWorkflowStep;
  onStepChange: (step: GuidedWorkflowStep) => void;
  memberCount: number;
  bbsItemCount: number;
}

const STEPS: {
  id: GuidedWorkflowStep;
  number: number;
  label: string;
  desc: string;
  icon: any;
}[] = [
  {
    id: 'scope',
    number: 1,
    label: 'Scope & Sheets',
    desc: 'Select element & sheets',
    icon: Layers,
  },
  {
    id: 'catalog',
    number: 2,
    label: 'Layout & Geometry',
    desc: 'Member marks, sizes & spans',
    icon: FolderKanban,
  },
  {
    id: 'reinforcement',
    number: 3,
    label: 'Reinforcement Specs',
    desc: 'Schedule / section inference',
    icon: Sparkles,
  },
  {
    id: 'takeoff',
    number: 4,
    label: 'BBS & Steel Takeoff',
    desc: 'Verified schedule & budget',
    icon: FileSpreadsheet,
  },
];

export const GuidedWorkflowBar: React.FC<GuidedWorkflowBarProps> = ({
  currentStep,
  onStepChange,
  memberCount,
  bbsItemCount,
}) => {
  const currentIdx = STEPS.findIndex((s) => s.id === currentStep);

  return (
    <div className="bg-zinc-950 border-b border-zinc-800 px-4 py-2 shrink-0">
      <div className="flex items-center justify-between max-w-5xl mx-auto overflow-x-auto gap-2">
        {STEPS.map((step, idx) => {
          const Icon = step.icon;
          const isActive = step.id === currentStep;
          const isDone = idx < currentIdx;

          return (
            <React.Fragment key={step.id}>
              <button
                onClick={() => onStepChange(step.id)}
                className={`flex items-center gap-2.5 px-3 py-1.5 rounded-xl transition text-left shrink-0 ${
                  isActive
                    ? 'bg-blue-600/15 border border-blue-500/40 text-white'
                    : isDone
                    ? 'text-zinc-300 hover:bg-zinc-900'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <div
                  className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold font-mono transition ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-sm'
                      : isDone
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  {isDone ? <Check className="w-3.5 h-3.5" /> : step.number}
                </div>

                <div>
                  <div className="text-xs font-semibold leading-tight flex items-center gap-1.5">
                    <span>{step.label}</span>
                    {step.id === 'catalog' && memberCount > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full bg-zinc-800 text-zinc-300 text-[10px] font-mono">
                        {memberCount}
                      </span>
                    )}
                    {step.id === 'takeoff' && bbsItemCount > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-mono">
                        {bbsItemCount} items
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-zinc-500 leading-tight hidden sm:block">
                    {step.desc}
                  </div>
                </div>
              </button>

              {idx < STEPS.length - 1 && (
                <div className="w-6 h-px bg-zinc-800 hidden md:block shrink-0" />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

