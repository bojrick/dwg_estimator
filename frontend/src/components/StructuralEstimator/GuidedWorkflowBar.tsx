import React from 'react';
import { SlidersHorizontal, FolderKanban, Layers, FileSpreadsheet, Check } from 'lucide-react';
import { GuidedWorkflowStep } from './types';

interface GuidedWorkflowBarProps {
  currentStep: GuidedWorkflowStep;
  onStepChange: (step: GuidedWorkflowStep) => void;
  memberCount: number;
  bbsItemCount: number;
  pendingMatchCount?: number;
  anomalyCount?: number;
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
    label: 'Project setup & IS code',
    desc: 'Rates, stock length & sheets',
    icon: SlidersHorizontal,
  },
  {
    id: 'catalog',
    number: 2,
    label: 'Members & sizes',
    desc: 'Marks, spans & b×D sections',
    icon: FolderKanban,
  },
  {
    id: 'reinforcement',
    number: 3,
    label: 'Reinforcement & sections',
    desc: 'Schedule & section linking',
    icon: Layers,
  },
  {
    id: 'takeoff',
    number: 4,
    label: 'BBS & steel takeoff',
    desc: 'Cut lengths, weight & IS audit',
    icon: FileSpreadsheet,
  },
];

export const GuidedWorkflowBar: React.FC<GuidedWorkflowBarProps> = ({
  currentStep,
  onStepChange,
  memberCount,
  bbsItemCount,
  pendingMatchCount = 0,
  anomalyCount = 0,
}) => {
  const currentIdx = STEPS.findIndex((s) => s.id === currentStep);

  return (
    <div className="bg-zinc-950 border-b border-zinc-800/80 px-4 py-1.5 shrink-0">
      <div className="flex items-center justify-between max-w-6xl mx-auto gap-2">
        {STEPS.map((step, idx) => {
          const isActive = step.id === currentStep;
          const isDone = idx < currentIdx;

          return (
            <React.Fragment key={step.id}>
              <button
                type="button"
                onClick={() => onStepChange(step.id)}
                className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg transition text-left shrink-0 ${
                  isActive
                    ? 'bg-zinc-900 border border-zinc-700 text-zinc-100'
                    : isDone
                    ? 'text-zinc-300 hover:bg-zinc-900/60 border border-transparent'
                    : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-md flex items-center justify-center text-[11px] font-medium font-mono tabular-nums transition ${
                    isActive
                      ? 'bg-zinc-100 text-zinc-950'
                      : isDone
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : 'bg-zinc-900 text-zinc-500 border border-zinc-800'
                  }`}
                >
                  {isDone ? <Check className="w-3 h-3" /> : step.number}
                </div>

                <div>
                  <div className="text-xs font-medium leading-tight flex items-center gap-1.5">
                    <span>{step.label}</span>
                    {step.id === 'catalog' && memberCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[10px] font-mono tabular-nums">
                        {memberCount}
                      </span>
                    )}
                    {step.id === 'reinforcement' && pendingMatchCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-mono tabular-nums">
                        {pendingMatchCount} review
                      </span>
                    )}
                    {step.id === 'takeoff' && bbsItemCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 text-[10px] font-mono tabular-nums">
                        {bbsItemCount} bars
                      </span>
                    )}
                    {step.id === 'takeoff' && anomalyCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[10px] font-mono tabular-nums">
                        {anomalyCount} flags
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-500 leading-tight hidden xl:block">
                    {step.desc}
                  </div>
                </div>
              </button>

              {idx < STEPS.length - 1 && (
                <div className="flex-1 max-w-8 h-px bg-zinc-800/80 hidden md:block" />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
