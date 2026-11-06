import React, { useState } from 'react';
import {
  Sparkles,
  Table as TableIcon,
  Check,
  ArrowRight,
  ArrowLeft,
  Plus,
  Trash2,
  Tag,
  HelpCircle,
  FileSpreadsheet,
} from 'lucide-react';
import {
  StructuralMemberDefinition,
  StructuralMemberType,
  AttachedRebarCallout,
  ExtractedCadTable,
} from './types';
import { STANDARD_DIAMETERS } from './bbsMath';

interface ReinforcementLinkStepProps {
  scope: StructuralMemberType;
  members: StructuralMemberDefinition[];
  scheduleTables: ExtractedCadTable[];
  onChangeMembers: (members: StructuralMemberDefinition[]) => void;
  onOpenScheduleTableModal: (table: ExtractedCadTable) => void;
  onBackToStep2: () => void;
  onProceedToStep4: () => void;
  selectedPlanCallout?: any | null;
  onClearSelectedCallout?: () => void;
}

export const ReinforcementLinkStep: React.FC<ReinforcementLinkStepProps> = ({
  scope,
  members,
  scheduleTables,
  onChangeMembers,
  onOpenScheduleTableModal,
  onBackToStep2,
  onProceedToStep4,
  selectedPlanCallout,
  onClearSelectedCallout,
}) => {
  // Callout assignment modal/box state
  const [targetMemberId, setTargetMemberId] = useState<string>(members[0]?.id || '');
  const [calloutRole, setCalloutRole] = useState<'main' | 'top_extra' | 'bottom_extra' | 'stirrup' | 'custom'>('top_extra');

  const handleUpdateMember = (id: string, patch: Partial<StructuralMemberDefinition>) => {
    onChangeMembers(members.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  // Attach a plan callout to a member
  const handleAttachCallout = () => {
    if (!selectedPlanCallout || !targetMemberId) return;

    const target = members.find((m) => m.id === targetMemberId);
    if (!target) return;

    const newExtra: AttachedRebarCallout = {
      id: `callout_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      text: selectedPlanCallout.text,
      coords: [selectedPlanCallout.x, selectedPlanCallout.y],
      role: calloutRole,
      count: selectedPlanCallout.count || 2,
      diameter: selectedPlanCallout.diameter || 16,
      spacingMm: selectedPlanCallout.spacingMm,
      notes: `Attached from CAD annotation: "${selectedPlanCallout.text}"`,
    };

    const updatedExtras = [...(target.extraBars || []), newExtra];
    handleUpdateMember(targetMemberId, { extraBars: updatedExtras });

    if (onClearSelectedCallout) onClearSelectedCallout();
  };

  const handleRemoveExtraBar = (memberId: string, calloutId: string) => {
    const target = members.find((m) => m.id === memberId);
    if (!target) return;
    const updated = (target.extraBars || []).filter((e) => e.id !== calloutId);
    handleUpdateMember(memberId, { extraBars: updated });
  };

  return (
    <div className="space-y-4">
      {/* Step Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-zinc-950 p-4 rounded-xl border border-zinc-800">
        <div>
          <h3 className="text-sm font-semibold text-white">
            Step 3: Reinforcement Specifications & Details
          </h3>
          <p className="text-xs text-zinc-400">
            Link reinforcement from schedule tables, infer from cross-section drawings, or attach plan callouts
          </p>
        </div>

        {/* Schedule Table Link button if available */}
        {scheduleTables.length > 0 && (
          <button
            onClick={() => onOpenScheduleTableModal(scheduleTables[0])}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 transition shadow"
          >
            <TableIcon className="w-3.5 h-3.5" />
            <span>Map From Extracted Schedule Table</span>
          </button>
        )}
      </div>

      {/* Plan Annotation Attachment Banner (when an annotation on CAD is clicked) */}
      {selectedPlanCallout && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-amber-400" />
            <div>
              <span className="text-zinc-300">Selected CAD Callout: </span>
              <span className="font-mono font-bold text-amber-300">
                "{selectedPlanCallout.text}"
              </span>
              <span className="text-zinc-500 text-[11px] ml-2">
                (Dia: Φ{selectedPlanCallout.diameter || 16}
                {selectedPlanCallout.count ? `, Qty: ${selectedPlanCallout.count}` : ''})
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-zinc-400">Assign to:</span>
            <select
              value={targetMemberId}
              onChange={(e) => setTargetMemberId(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-white font-mono text-xs"
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.mark} ({m.floorLevel || 'All Floors'})
                </option>
              ))}
            </select>

            <select
              value={calloutRole}
              onChange={(e) => setCalloutRole(e.target.value as any)}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-white text-xs"
            >
              <option value="top_extra">Top Extra / Support</option>
              <option value="bottom_extra">Bottom Extra</option>
              <option value="main">Main Longitudinal</option>
              <option value="stirrup">Ties / Stirrups</option>
              <option value="custom">Custom Bar</option>
            </select>

            <button
              onClick={handleAttachCallout}
              className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold transition shadow"
            >
              Attach Bar
            </button>
            <button
              onClick={onClearSelectedCallout}
              className="px-2 py-1 rounded-lg bg-zinc-800 text-zinc-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Member Reinforcement Specification Cards */}
      <div className="space-y-3">
        {members.map((m) => (
          <div
            key={m.id}
            className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3 hover:border-zinc-750 transition"
          >
            {/* Member Card Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-850 pb-2.5">
              <div className="flex items-center gap-2.5">
                <span className="font-mono font-bold text-base text-white">{m.mark}</span>
                <span className="text-xs text-zinc-400">
                  {m.floorLevel || 'All Floors'} · Size: {m.widthMm}×{m.depthMm}mm · Span: {m.spanMm}mm · Count: {m.countOnLayout}
                </span>
              </div>
              <span className="text-[11px] text-zinc-500 font-mono">
                Cover: {m.clearCoverMm}mm
              </span>
            </div>

            {/* Quick Rebar Inputs for this member */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              {/* Main Bars */}
              <div className="bg-zinc-900 rounded-lg p-2.5 space-y-1.5">
                <div className="text-[11px] font-semibold text-zinc-300">
                  {scope === 'beam' ? 'Bottom Main Rebar' : scope === 'column' ? 'Vertical Main Bars' : 'Main Reinforcement'}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    value={m.mainBars?.count || 4}
                    onChange={(e) =>
                      handleUpdateMember(m.id, {
                        mainBars: { ...m.mainBars!, count: Number(e.target.value) },
                      })
                    }
                    className="w-14 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-center font-mono text-white"
                  />
                  <span className="text-zinc-400 font-mono">bars of</span>
                  <select
                    value={m.mainBars?.diameter || 16}
                    onChange={(e) =>
                      handleUpdateMember(m.id, {
                        mainBars: { ...m.mainBars!, diameter: Number(e.target.value) },
                      })
                    }
                    className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 font-mono text-blue-400 font-semibold"
                  >
                    {STANDARD_DIAMETERS.map((d) => (
                      <option key={d} value={d}>
                        Φ {d} mm
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Secondary / Top Bars */}
              <div className="bg-zinc-900 rounded-lg p-2.5 space-y-1.5">
                <div className="text-[11px] font-semibold text-zinc-300">
                  {scope === 'beam' ? 'Top Continuous / Hangers' : 'Secondary Bars'}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    value={m.secondaryBars?.count || 2}
                    onChange={(e) =>
                      handleUpdateMember(m.id, {
                        secondaryBars: { ...m.secondaryBars!, count: Number(e.target.value) },
                      })
                    }
                    className="w-14 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-center font-mono text-white"
                  />
                  <span className="text-zinc-400 font-mono">bars of</span>
                  <select
                    value={m.secondaryBars?.diameter || 12}
                    onChange={(e) =>
                      handleUpdateMember(m.id, {
                        secondaryBars: { ...m.secondaryBars!, diameter: Number(e.target.value) },
                      })
                    }
                    className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 font-mono text-blue-400 font-semibold"
                  >
                    {STANDARD_DIAMETERS.map((d) => (
                      <option key={d} value={d}>
                        Φ {d} mm
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Stirrups / Ties */}
              <div className="bg-zinc-900 rounded-lg p-2.5 space-y-1.5">
                <div className="text-[11px] font-semibold text-zinc-300">
                  {scope === 'column' ? 'Lateral Ties' : 'Stirrups / Links'}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={m.stirrups?.diameter || 8}
                    onChange={(e) =>
                      handleUpdateMember(m.id, {
                        stirrups: { ...m.stirrups!, diameter: Number(e.target.value) },
                      })
                    }
                    className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 font-mono text-blue-400 font-semibold"
                  >
                    {STANDARD_DIAMETERS.map((d) => (
                      <option key={d} value={d}>
                        Φ {d} mm
                      </option>
                    ))}
                  </select>
                  <span className="text-zinc-400 font-mono">@</span>
                  <input
                    type="number"
                    value={m.stirrups?.spacingMm || 150}
                    onChange={(e) =>
                      handleUpdateMember(m.id, {
                        stirrups: { ...m.stirrups!, spacingMm: Number(e.target.value) },
                      })
                    }
                    className="w-16 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-center font-mono text-white"
                  />
                  <span className="text-zinc-500 font-mono">mm c/c</span>
                </div>
              </div>
            </div>

            {/* Extra Attached Plan Callouts */}
            {m.extraBars && m.extraBars.length > 0 && (
              <div className="pt-2 border-t border-zinc-850 space-y-1.5">
                <span className="text-[11px] text-zinc-400 font-medium">
                  Attached Plan Callouts / Extra Bars:
                </span>
                <div className="flex flex-wrap gap-2">
                  {m.extraBars.map((extra) => (
                    <div
                      key={extra.id}
                      className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1 text-[11px] flex items-center gap-2"
                    >
                      <span className="text-amber-400 font-mono font-semibold">
                        {extra.count} × Φ{extra.diameter} ({extra.role})
                      </span>
                      <span className="text-zinc-400 truncate max-w-[120px]">
                        "{extra.text}"
                      </span>
                      <button
                        onClick={() => handleRemoveExtraBar(m.id, extra.id)}
                        className="text-zinc-500 hover:text-rose-400 transition"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Navigation Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-zinc-800">
        <button
          onClick={onBackToStep2}
          className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold flex items-center gap-1.5 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Catalog</span>
        </button>

        <button
          onClick={onProceedToStep4}
          className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-2 shadow-lg transition"
        >
          <span>Calculate & Verify BBS (Step 4)</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

