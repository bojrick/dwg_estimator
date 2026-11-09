import React, { useState, useMemo } from 'react';
import {
  Sparkles,
  Table as TableIcon,
  Check,
  ArrowRight,
  ArrowLeft,
  Trash2,
  Tag,
  Scan,
  Layers,
  Copy,
  X,
} from 'lucide-react';
import {
  StructuralMemberDefinition,
  StructuralMemberType,
  AttachedRebarCallout,
  ExtractedCadTable,
  BeamCrossSectionInspection,
  LongitudinalSectionDefinition,
} from './types';
import { STANDARD_DIAMETERS } from './bbsMath';
import { AiBadge } from '../ui/AiBadge';

interface ReinforcementLinkStepProps {
  scope: StructuralMemberType;
  members: StructuralMemberDefinition[];
  scheduleTables: ExtractedCadTable[];
  allowedDiameters?: number[];
  isMatchingSectionsAi?: boolean;
  onChangeMembers: (members: StructuralMemberDefinition[]) => void;
  onOpenScheduleTableModal: (table: ExtractedCadTable) => void;
  onMatchSectionsAi?: () => void;
  onHighlightMember?: (mark: string) => void;
  onBackToStep2: () => void;
  onProceedToStep4: () => void;
  selectedPlanCallout?: any | null;
  onClearSelectedCallout?: () => void;
  inspectedCrossSection?: BeamCrossSectionInspection | null;
  onClearInspectedCrossSection?: () => void;
  onStartCrossSectionMarquee?: () => void;
  isCrossSectionToolActive?: boolean;
  onStartLongitudinalSectionWindow?: () => void;
  isLongitudinalSectionToolActive?: boolean;
  longitudinalSectionsCount?: number;
  longitudinalSections?: LongitudinalSectionDefinition[];
  onOpenLongitudinalSectionDrawer?: (ls: LongitudinalSectionDefinition) => void;
  onDeleteLongitudinalSection?: (id: string) => void;
}

export const ReinforcementLinkStep: React.FC<ReinforcementLinkStepProps> = ({
  scope,
  members,
  scheduleTables,
  allowedDiameters = [8, 10, 12, 16, 20, 25, 28, 32],
  isMatchingSectionsAi = false,
  onChangeMembers,
  onOpenScheduleTableModal,
  onMatchSectionsAi,
  onHighlightMember,
  onBackToStep2,
  onProceedToStep4,
  selectedPlanCallout,
  onClearSelectedCallout,
  inspectedCrossSection,
  onClearInspectedCrossSection,
  onStartCrossSectionMarquee,
  isCrossSectionToolActive,
  onStartLongitudinalSectionWindow,
  isLongitudinalSectionToolActive,
  longitudinalSectionsCount = 0,
  longitudinalSections = [],
  onOpenLongitudinalSectionDrawer,
  onDeleteLongitudinalSection,
}) => {
  const [activeMemberId, setActiveMemberId] = useState<string>(members[0]?.id || '');
  const [filterMode, setFilterMode] = useState<'all' | 'pending' | 'warnings'>('all');
  const [calloutRole, setCalloutRole] = useState<'main' | 'top_extra' | 'bottom_extra' | 'stirrup'>('top_extra');

  const allowedSet = useMemo(() => new Set(allowedDiameters), [allowedDiameters]);

  const activeMember = useMemo(() => {
    return members.find((m) => m.id === activeMemberId) || members[0] || null;
  }, [members, activeMemberId]);

  const pendingMatchesCount = useMemo(
    () => members.filter((m) => m.pendingSectionMatch?.status === 'pending').length,
    [members]
  );

  const hasDiaWarning = (m: StructuralMemberDefinition) => {
    const dias = [
      m.mainBars?.diameter,
      m.secondaryBars?.diameter,
      m.topSupportExtraBars?.diameter,
      m.stirrups?.diameter,
    ].filter(Boolean) as number[];
    return dias.some((d) => !allowedSet.has(d));
  };

  const warningCount = useMemo(
    () => members.filter((m) => hasDiaWarning(m)).length,
    [members, allowedSet]
  );

  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      if (filterMode === 'pending') return m.pendingSectionMatch?.status === 'pending';
      if (filterMode === 'warnings') return hasDiaWarning(m);
      return true;
    });
  }, [members, filterMode, allowedSet]);

  const handleUpdateMember = (id: string, patch: Partial<StructuralMemberDefinition>) => {
    onChangeMembers(members.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  const handleConfirmPendingMatch = (member: StructuralMemberDefinition) => {
    const pm = member.pendingSectionMatch;
    if (!pm) return;
    handleUpdateMember(member.id, {
      widthMm: pm.widthMm || member.widthMm,
      depthMm: pm.depthMm || member.depthMm,
      mainBars: pm.bottomBars || member.mainBars,
      secondaryBars: pm.topBars || member.secondaryBars,
      topSupportExtraBars: pm.topExtraBars || member.topSupportExtraBars,
      stirrups: pm.stirrups || member.stirrups,
      isVerifiedInLegend: true,
      pendingSectionMatch: { ...pm, status: 'confirmed' },
    });
  };

  const handleConfirmAllPending = () => {
    onChangeMembers(
      members.map((m) => {
        const pm = m.pendingSectionMatch;
        if (!pm || pm.status !== 'pending') return m;
        return {
          ...m,
          widthMm: pm.widthMm || m.widthMm,
          depthMm: pm.depthMm || m.depthMm,
          mainBars: pm.bottomBars || m.mainBars,
          secondaryBars: pm.topBars || m.secondaryBars,
          topSupportExtraBars: pm.topExtraBars || m.topSupportExtraBars,
          stirrups: pm.stirrups || m.stirrups,
          isVerifiedInLegend: true,
          pendingSectionMatch: { ...pm, status: 'confirmed' },
        };
      })
    );
  };

  const handleDismissPendingMatch = (member: StructuralMemberDefinition) => {
    if (!member.pendingSectionMatch) return;
    handleUpdateMember(member.id, {
      pendingSectionMatch: { ...member.pendingSectionMatch, status: 'rejected' },
    });
  };

  const handleApplyCrossSection = (applyToSameSize: boolean = false) => {
    if (!inspectedCrossSection || !activeMember) return;
    const targetW = inspectedCrossSection.widthMm || activeMember.widthMm;
    const targetD = inspectedCrossSection.depthMm || activeMember.depthMm;

    const updated = members.map((m) => {
      const isMatch = applyToSameSize
        ? m.widthMm === targetW && m.depthMm === targetD
        : m.id === activeMember.id;
      if (!isMatch) return m;

      return {
        ...m,
        widthMm: inspectedCrossSection.widthMm || m.widthMm,
        depthMm: inspectedCrossSection.depthMm || m.depthMm,
        mainBars: inspectedCrossSection.bottomBars
          ? { count: inspectedCrossSection.bottomBars.count, diameter: inspectedCrossSection.bottomBars.diameter }
          : m.mainBars,
        secondaryBars: inspectedCrossSection.topBars
          ? { count: inspectedCrossSection.topBars.count, diameter: inspectedCrossSection.topBars.diameter }
          : m.secondaryBars,
        stirrups: inspectedCrossSection.stirrups
          ? {
              diameter: inspectedCrossSection.stirrups.diameter,
              spacingMm: inspectedCrossSection.stirrups.spacingMm,
              legs: inspectedCrossSection.stirrups.legs || 2,
            }
          : m.stirrups,
      };
    });

    onChangeMembers(updated);
    if (onClearInspectedCrossSection) onClearInspectedCrossSection();
  };

  const handleCopyRebarToSameSectionSize = () => {
    if (!activeMember) return;
    onChangeMembers(
      members.map((m) => {
        if (m.id === activeMember.id) return m;
        if (m.widthMm !== activeMember.widthMm || m.depthMm !== activeMember.depthMm) return m;
        return {
          ...m,
          mainBars: activeMember.mainBars ? { ...activeMember.mainBars } : undefined,
          secondaryBars: activeMember.secondaryBars ? { ...activeMember.secondaryBars } : undefined,
          topSupportExtraBars: activeMember.topSupportExtraBars
            ? { ...activeMember.topSupportExtraBars }
            : undefined,
          stirrups: activeMember.stirrups ? { ...activeMember.stirrups } : undefined,
        };
      })
    );
  };

  const handleAttachCallout = () => {
    if (!selectedPlanCallout || !activeMember) return;
    const newExtra: AttachedRebarCallout = {
      id: `callout_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      text: selectedPlanCallout.text,
      coords: [selectedPlanCallout.x, selectedPlanCallout.y],
      role: calloutRole,
      count: selectedPlanCallout.count || 2,
      diameter: selectedPlanCallout.diameter || 16,
      spacingMm: selectedPlanCallout.spacingMm,
      notes: `From plan: "${selectedPlanCallout.text}"`,
    };
    const updatedExtras = [...(activeMember.extraBars || []), newExtra];
    handleUpdateMember(activeMember.id, { extraBars: updatedExtras });
    if (onClearSelectedCallout) onClearSelectedCallout();
  };

  const handleRemoveExtraBar = (memberId: string, calloutId: string) => {
    const target = members.find((m) => m.id === memberId);
    if (!target) return;
    handleUpdateMember(memberId, {
      extraBars: (target.extraBars || []).filter((e) => e.id !== calloutId),
    });
  };

  const diameterOptions = useMemo(() => {
    const base = allowedDiameters.length > 0 ? allowedDiameters : STANDARD_DIAMETERS;
    return Array.from(new Set([...base, ...STANDARD_DIAMETERS])).sort((a, b) => a - b);
  }, [allowedDiameters]);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-zinc-900">
      {/* Pinned Top Action & Filter Bar */}
      <div className="p-3 bg-zinc-950 border-b border-zinc-800/80 space-y-2 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 bg-zinc-900 p-0.5 rounded-lg border border-zinc-800 text-[11px]">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`px-2.5 py-1 rounded-md font-medium tabular-nums transition ${
                filterMode === 'all' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              All ({members.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('pending')}
              className={`px-2.5 py-1 rounded-md font-medium tabular-nums transition flex items-center gap-1 ${
                filterMode === 'pending'
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span>Pending section review ({pendingMatchesCount})</span>
            </button>
            {warningCount > 0 && (
              <button
                type="button"
                onClick={() => setFilterMode('warnings')}
                className={`px-2.5 py-1 rounded-md font-medium tabular-nums transition ${
                  filterMode === 'warnings'
                    ? 'bg-rose-500/20 text-rose-300'
                    : 'text-rose-400/80 hover:text-rose-300'
                }`}
              >
                Dia constraint ({warningCount})
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {scope === 'beam' && onStartLongitudinalSectionWindow && (
              <button
                type="button"
                onClick={onStartLongitudinalSectionWindow}
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1.5 transition ${
                  isLongitudinalSectionToolActive
                    ? 'bg-blue-600 text-white border-blue-500'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                }`}
                title="Drag a box over a multi-span continuous beam Longitudinal Section (L-Section)"
              >
                <Layers className="w-3.5 h-3.5 text-blue-400" />
                <span>
                  {isLongitudinalSectionToolActive
                    ? 'Cancel box'
                    : `Window L-Section${longitudinalSectionsCount > 0 ? ` (${longitudinalSectionsCount})` : ''}`}
                </span>
              </button>
            )}

            {onStartCrossSectionMarquee && (
              <button
                type="button"
                onClick={onStartCrossSectionMarquee}
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1.5 transition ${
                  isCrossSectionToolActive
                    ? 'bg-amber-500 text-zinc-950 border-amber-400'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                }`}
                title="Drag a box over any cross-section detail on the drawing"
              >
                <Scan className="w-3.5 h-3.5" />
                <span>{isCrossSectionToolActive ? 'Cancel box' : 'Pick section on drawing'}</span>
              </button>
            )}

            {scheduleTables.length > 0 && (
              <button
                type="button"
                onClick={() => onOpenScheduleTableModal(scheduleTables[0])}
                className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-200 text-[11px] font-medium flex items-center gap-1.5 transition"
              >
                <TableIcon className="w-3.5 h-3.5 text-blue-400" />
                <span>Schedules ({scheduleTables.length})</span>
              </button>
            )}

            {onMatchSectionsAi && (
              <button
                type="button"
                onClick={onMatchSectionsAi}
                disabled={isMatchingSectionsAi}
                className="px-3 py-1 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-[11px] font-medium flex items-center gap-1.5 transition disabled:opacity-50"
                title="Uses AI to find cross-sections across sheets and propose matches for human review"
              >
                <AiBadge label="AI" className="bg-black/10 text-zinc-900 border-zinc-900/30" />
                <span>{isMatchingSectionsAi ? 'Matching with AI...' : 'Match scattered sections'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Defined Longitudinal Sections Manager Card */}
        {scope === 'beam' && longitudinalSections.length > 0 && (
          <div className="p-2.5 rounded-xl bg-zinc-900/70 border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-zinc-200 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-blue-400" />
                <span>Defined Longitudinal Sections ({longitudinalSections.length})</span>
              </span>
              <span className="text-[10px] text-zinc-500 font-mono">
                BBS takeoff strictly calculates beams from these sections
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {longitudinalSections.map((ls) => (
                <div
                  key={ls.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-blue-500/80 text-xs text-zinc-200 transition cursor-pointer"
                  onClick={() => onOpenLongitudinalSectionDrawer?.(ls)}
                  title="Click to view & edit continuous spans in L-Section drawer"
                >
                  <div className="min-w-0">
                    <span className="font-medium text-zinc-100 block truncate max-w-[200px]">
                      {ls.name}
                    </span>
                    <div className="text-[10px] text-zinc-400 font-mono mt-0.5">
                      {ls.spans.length} spans ·{' '}
                      {(ls.spans.reduce((s, sp) => s + sp.clearSpanMm, 0) / 1000).toFixed(2)}m
                    </div>
                  </div>
                  {onDeleteLongitudinalSection && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteLongitudinalSection(ls.id);
                      }}
                      className="p-1 text-zinc-500 hover:text-rose-400 transition"
                      title="Delete L-Section"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Inline Banner if CAD Cross-Section Marquee or Callout was just clicked */}
        {inspectedCrossSection && (
          <div className="p-2 rounded-lg bg-zinc-900 border border-zinc-700 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="font-mono tabular-nums text-zinc-200">
              <span className="text-zinc-400 font-sans">Picked section: </span>
              <strong>{inspectedCrossSection.mark || 'Detail'}</strong> (
              {inspectedCrossSection.widthMm || 230}×{inspectedCrossSection.depthMm || 450}mm)
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleApplyCrossSection(false)}
                className="px-2.5 py-1 rounded bg-zinc-100 text-zinc-950 text-[11px] font-medium"
              >
                Apply to {activeMember?.mark || 'selected'}
              </button>
              <button
                type="button"
                onClick={() => handleApplyCrossSection(true)}
                className="px-2.5 py-1 rounded bg-zinc-800 text-zinc-200 text-[11px]"
              >
                Apply to same size
              </button>
              <button
                type="button"
                onClick={onClearInspectedCrossSection}
                className="p-1 text-zinc-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {selectedPlanCallout && activeMember && (
          <div className="p-2 rounded-lg bg-amber-950/30 border border-amber-700/40 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 font-mono tabular-nums">
              <Tag className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-amber-200">"{selectedPlanCallout.text}"</span>
              <span className="text-zinc-400 font-sans">→ {activeMember.mark}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <select
                value={calloutRole}
                onChange={(e) => setCalloutRole(e.target.value as any)}
                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-0.5 text-[11px] text-zinc-200"
              >
                <option value="top_extra">Top support extra</option>
                <option value="bottom_extra">Bottom extra</option>
                <option value="main">Main bar</option>
                <option value="stirrup">Stirrups</option>
              </select>
              <button
                type="button"
                onClick={handleAttachCallout}
                className="px-2.5 py-0.5 rounded bg-amber-400 text-zinc-950 font-medium text-[11px]"
              >
                Attach to {activeMember.mark}
              </button>
              <button
                type="button"
                onClick={onClearSelectedCallout}
                className="p-0.5 text-zinc-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Compact 4-Column Master List (Zero Horizontal Scroll) */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-zinc-950">
        <table className="w-full border-collapse text-xs table-fixed">
          <thead className="sticky top-0 z-10 bg-zinc-900 border-b border-zinc-800 text-[11px] text-zinc-400">
            <tr>
              <th className="py-2 pl-3 pr-2 text-left font-medium w-[25%]">Member & section</th>
              <th className="py-2 px-2 text-left font-medium w-[25%]">
                {scope === 'beam' ? 'Bottom main' : 'Main rebar'}
              </th>
              <th className="py-2 px-2 text-left font-medium w-[26%]">
                {scope === 'beam' ? 'Top & support extra' : 'Secondary'}
              </th>
              <th className="py-2 pl-2 pr-3 text-right font-medium w-[24%]">Stirrups & status</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-zinc-900 font-mono tabular-nums">
            {filteredMembers.map((m) => {
              const isSelected = activeMember?.id === m.id;
              const isPending = m.pendingSectionMatch?.status === 'pending';
              const diaWarn = hasDiaWarning(m);
              const coveredLs =
                scope === 'beam'
                  ? longitudinalSections.find((ls) =>
                      (ls.spans || []).some(
                        (sp) => sp.beamMark?.trim().toUpperCase() === m.mark.trim().toUpperCase()
                      )
                    )
                  : null;

              return (
                <tr
                  key={m.id}
                  onClick={() => {
                    setActiveMemberId(m.id);
                    if (onHighlightMember) onHighlightMember(m.mark);
                  }}
                  className={`cursor-pointer transition ${
                    isSelected ? 'bg-zinc-900' : 'hover:bg-zinc-900/50'
                  }`}
                >
                  <td className="py-2 pl-3 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-zinc-100">{m.mark}</span>
                      <span className="text-[10px] text-zinc-500">
                        {m.widthMm}×{m.depthMm}
                      </span>
                      {coveredLs && (
                        <span className="px-1.5 py-0.2 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-sans text-[10px]">
                          In L-Sec
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-500 font-sans truncate">
                      {scope === 'beam' ? (
                        coveredLs ? (
                          <span className="text-emerald-400/80">{coveredLs.name}</span>
                        ) : (
                          <span className="text-zinc-500">No L-Section (takeoff excluded)</span>
                        )
                      ) : (
                        `${m.countOnLayout} × ${(m.spanMm / 1000).toFixed(2)}m`
                      )}
                    </div>
                  </td>

                  <td className="py-2 px-2 text-zinc-200">
                    {m.mainBars ? `${m.mainBars.count} - Φ${m.mainBars.diameter}` : '—'}
                  </td>

                  <td className="py-2 px-2 text-zinc-300">
                    <span>
                      {m.secondaryBars ? `${m.secondaryBars.count} - Φ${m.secondaryBars.diameter}` : '—'}
                    </span>
                    {m.topSupportExtraBars && m.topSupportExtraBars.count > 0 && (
                      <span className="block text-[10px] text-blue-400">
                        +{m.topSupportExtraBars.count} - Φ{m.topSupportExtraBars.diameter} supp
                      </span>
                    )}
                  </td>

                  <td className="py-2 pl-2 pr-3 text-right">
                    <div className="text-zinc-300 text-[11px]">
                      {m.stirrups
                        ? `${m.stirrups.legs || 2}L-Φ${m.stirrups.diameter}@${
                            m.stirrups.supportSpacingMm
                              ? `${m.stirrups.supportSpacingMm}/`
                              : ''
                          }${m.stirrups.spacingMm}`
                        : '—'}
                    </div>
                    {isPending ? (
                      <span className="inline-block px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[10px] font-sans">
                        Confirm section
                      </span>
                    ) : diaWarn ? (
                      <span className="inline-block px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 text-[10px] font-sans">
                        Dia constraint
                      </span>
                    ) : (
                      <span className="inline-block text-[10px] text-emerald-400 font-sans">
                        Ready
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Docked Active Member Editor & Human-in-the-Loop Section Confirmation Drawer */}
      {activeMember && (
        <div className="p-3 bg-zinc-900 border-t border-zinc-800 space-y-2.5 shrink-0 text-xs">
          {/* Human-in-the-Loop Section Match Confirmation Prompt */}
          {activeMember.pendingSectionMatch?.status === 'pending' && (
            <div className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-600/40 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-amber-200 flex items-center gap-1.5">
                  <span>Confirm scattered section match for {activeMember.mark}:</span>
                  <span className="font-mono text-amber-300">
                    {activeMember.pendingSectionMatch.sectionTitle}
                  </span>
                  <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono text-[10px] tabular-nums">
                    {Math.round(activeMember.pendingSectionMatch.confidence * 100)}% match
                  </span>
                </div>
                <div className="text-[11px] text-zinc-400 font-mono tabular-nums mt-0.5">
                  Proposed size: {activeMember.pendingSectionMatch.widthMm || activeMember.widthMm}×
                  {activeMember.pendingSectionMatch.depthMm || activeMember.depthMm}mm
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => handleConfirmPendingMatch(activeMember)}
                  className="px-2.5 py-1 rounded bg-amber-400 hover:bg-amber-300 text-zinc-950 font-medium text-[11px] flex items-center gap-1"
                >
                  <Check className="w-3 h-3" />
                  <span>Confirm match</span>
                </button>
                {pendingMatchesCount > 1 && (
                  <button
                    type="button"
                    onClick={handleConfirmAllPending}
                    className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px]"
                  >
                    Confirm all ({pendingMatchesCount})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDismissPendingMatch(activeMember)}
                  className="px-2 py-1 rounded bg-zinc-950 text-zinc-400 hover:text-zinc-200 text-[11px]"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Selected Member Header + Copy to Same Size */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-mono tabular-nums">
              <span className="text-sm font-medium text-zinc-100">{activeMember.mark}</span>
              <span className="text-[11px] text-zinc-400">
                {activeMember.widthMm}×{activeMember.depthMm} mm · Span {activeMember.spanMm} mm · Cover{' '}
                {activeMember.clearCoverMm} mm
              </span>
            </div>

            <button
              type="button"
              onClick={handleCopyRebarToSameSectionSize}
              className="px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-zinc-300 text-[11px] flex items-center gap-1 transition"
              title="Copy reinforcement specs only to other members sharing this exact b×D size"
            >
              <Copy className="w-3 h-3 text-zinc-400" />
              <span>
                Apply rebar to all {activeMember.widthMm}×{activeMember.depthMm} {scope}s
              </span>
            </button>
          </div>

          {/* Compact 4-Box Inline Rebar Editor */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono tabular-nums">
            {/* Box 1: Main / Bottom Bars */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2 space-y-1">
              <span className="text-[10px] font-sans text-zinc-400 block">
                {scope === 'beam' ? 'Bottom main bars' : 'Main longitudinal'}
              </span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="1"
                  value={activeMember.mainBars?.count || 4}
                  onChange={(e) =>
                    handleUpdateMember(activeMember.id, {
                      mainBars: {
                        ...(activeMember.mainBars || { diameter: 16 }),
                        count: Math.max(1, Number(e.target.value)),
                      },
                    })
                  }
                  className="w-11 bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-center text-zinc-100 text-[11px]"
                />
                <span className="text-zinc-500">×</span>
                <select
                  value={activeMember.mainBars?.diameter || 16}
                  onChange={(e) =>
                    handleUpdateMember(activeMember.id, {
                      mainBars: {
                        ...(activeMember.mainBars || { count: 4 }),
                        diameter: Number(e.target.value),
                      },
                    })
                  }
                  className={`flex-1 bg-zinc-900 border rounded px-1 py-0.5 text-[11px] ${
                    !allowedSet.has(activeMember.mainBars?.diameter || 16)
                      ? 'border-rose-500/60 text-rose-300'
                      : 'border-zinc-800 text-zinc-100'
                  }`}
                >
                  {diameterOptions.map((d) => (
                    <option key={d} value={d}>
                      Φ{d}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Box 2: Top Continuous / Secondary Bars */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2 space-y-1">
              <span className="text-[10px] font-sans text-zinc-400 block">
                {scope === 'beam' ? 'Top continuous' : 'Secondary bars'}
              </span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="0"
                  value={activeMember.secondaryBars?.count ?? 2}
                  onChange={(e) =>
                    handleUpdateMember(activeMember.id, {
                      secondaryBars: {
                        ...(activeMember.secondaryBars || { diameter: 12 }),
                        count: Math.max(0, Number(e.target.value)),
                      },
                    })
                  }
                  className="w-11 bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-center text-zinc-100 text-[11px]"
                />
                <span className="text-zinc-500">×</span>
                <select
                  value={activeMember.secondaryBars?.diameter || 12}
                  onChange={(e) =>
                    handleUpdateMember(activeMember.id, {
                      secondaryBars: {
                        ...(activeMember.secondaryBars || { count: 2 }),
                        diameter: Number(e.target.value),
                      },
                    })
                  }
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-zinc-100 text-[11px]"
                >
                  {diameterOptions.map((d) => (
                    <option key={d} value={d}>
                      Φ{d}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Box 3: Top Support Extra (IS 13920 0.25L Curtailment) */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2 space-y-1">
              <span className="text-[10px] font-sans text-zinc-400 block">
                Support extra (0.25L)
              </span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="0"
                  value={activeMember.topSupportExtraBars?.count ?? 0}
                  onChange={(e) =>
                    handleUpdateMember(activeMember.id, {
                      topSupportExtraBars: {
                        diameter: activeMember.topSupportExtraBars?.diameter || 16,
                        curtailmentRatio: 0.25,
                        count: Math.max(0, Number(e.target.value)),
                      },
                    })
                  }
                  className="w-11 bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-center text-zinc-100 text-[11px]"
                />
                <span className="text-zinc-500">×</span>
                <select
                  value={activeMember.topSupportExtraBars?.diameter || 16}
                  onChange={(e) =>
                    handleUpdateMember(activeMember.id, {
                      topSupportExtraBars: {
                        count: activeMember.topSupportExtraBars?.count || 0,
                        curtailmentRatio: 0.25,
                        diameter: Number(e.target.value),
                      },
                    })
                  }
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-zinc-100 text-[11px]"
                >
                  {diameterOptions.map((d) => (
                    <option key={d} value={d}>
                      Φ{d}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Box 4: Stirrups (Confinement End Spacing / Mid Spacing) */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2 space-y-1">
              <span className="text-[10px] font-sans text-zinc-400 block">
                Stirrups (end / mid mm)
              </span>
              <div className="flex items-center gap-1">
                <select
                  value={activeMember.stirrups?.diameter || 8}
                  onChange={(e) =>
                    handleUpdateMember(activeMember.id, {
                      stirrups: {
                        ...(activeMember.stirrups || { spacingMm: 150, legs: 2 }),
                        diameter: Number(e.target.value),
                      },
                    })
                  }
                  className="w-12 bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-zinc-100 text-[11px]"
                >
                  {diameterOptions.map((d) => (
                    <option key={d} value={d}>
                      Φ{d}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="25"
                  placeholder="End"
                  value={activeMember.stirrups?.supportSpacingMm || ''}
                  onChange={(e) =>
                    handleUpdateMember(activeMember.id, {
                      stirrups: {
                        ...(activeMember.stirrups || { diameter: 8, spacingMm: 150, legs: 2 }),
                        supportSpacingMm: Number(e.target.value) || undefined,
                      },
                    })
                  }
                  className="w-11 bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-center text-zinc-100 text-[11px]"
                  title="Support confinement zone spacing (mm)"
                />
                <span className="text-zinc-600">/</span>
                <input
                  type="number"
                  step="25"
                  value={activeMember.stirrups?.spacingMm || 150}
                  onChange={(e) =>
                    handleUpdateMember(activeMember.id, {
                      stirrups: {
                        ...(activeMember.stirrups || { diameter: 8, legs: 2 }),
                        spacingMm: Math.max(50, Number(e.target.value)),
                      },
                    })
                  }
                  className="w-11 bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-center text-zinc-100 text-[11px]"
                  title="Mid-span stirrup spacing (mm)"
                />
              </div>
            </div>
          </div>

          {/* Attached Extra Callouts */}
          {activeMember.extraBars && activeMember.extraBars.length > 0 && (
            <div className="flex items-center flex-wrap gap-1.5 pt-1">
              <span className="text-[10px] text-zinc-500">Attached callouts:</span>
              {activeMember.extraBars.map((extra) => (
                <span
                  key={extra.id}
                  className="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-[10px] font-mono text-zinc-300 flex items-center gap-1"
                >
                  {extra.count}×Φ{extra.diameter} ({extra.text})
                  <button
                    type="button"
                    onClick={() => handleRemoveExtraBar(activeMember.id, extra.id)}
                    className="text-zinc-500 hover:text-rose-400"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pinned Step Footer (Always visible without scrolling) */}
      <div className="h-12 px-4 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between gap-3 shrink-0">
        <button
          type="button"
          onClick={onBackToStep2}
          className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-xs font-medium flex items-center gap-1.5 transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Members & sizes</span>
        </button>

        <div className="text-[11px] text-zinc-400 font-mono tabular-nums hidden sm:block">
          {pendingMatchesCount > 0
            ? `${pendingMatchesCount} section matches awaiting review`
            : `All ${members.length} members configured`}
        </div>

        <button
          type="button"
          onClick={onProceedToStep4}
          className="px-4 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-medium flex items-center gap-1.5 transition"
        >
          <span>View BBS & steel takeoff</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
