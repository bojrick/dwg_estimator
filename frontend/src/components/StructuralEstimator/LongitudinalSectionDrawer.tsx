import React, { useState, useEffect } from 'react';
import {
  X,
  Layers,
  Plus,
  Trash2,
  Check,
  AlertCircle,
} from 'lucide-react';
import { LongitudinalSectionDefinition, LsSpanDefinition } from './types';

interface LongitudinalSectionDrawerProps {
  isOpen: boolean;
  section: LongitudinalSectionDefinition | null;
  onClose: () => void;
  onSave: (updated: LongitudinalSectionDefinition) => void;
  onDelete?: (id: string) => void;
  isInferring?: boolean;
  definedMembers?: import('./types').StructuralMemberDefinition[];
}

const ElevationSvg: React.FC<{ draft: LongitudinalSectionDefinition }> = ({ draft }) => {
  const spans = draft.spans || [];
  if (spans.length === 0) return null;

  const svgW = 460;
  const svgH = 130;
  const padX = 24;
  const availW = svgW - 2 * padX;

  const totalMm = spans.reduce((s, sp) => {
    const colW = sp.supportColRightMm || 350;
    return s + sp.clearSpanMm + colW;
  }, spans[0]?.supportColLeftMm || 300);

  const scale = availW / Math.max(1000, totalMm);

  let curX = padX;
  const startColW = Math.max(8, (spans[0]?.supportColLeftMm || 300) * scale);
  const columns: { x1: number; x2: number; label: string; widthMm: number }[] = [];
  const spanBoxes: { x1: number; x2: number; span: any; mark: string }[] = [];

  columns.push({
    x1: curX,
    x2: curX + startColW,
    label: spans[0]?.colLeftLabel || 'C1',
    widthMm: spans[0]?.supportColLeftMm || 300,
  });
  curX += startColW;

  spans.forEach((sp, idx) => {
    const spanW = Math.max(20, sp.clearSpanMm * scale);
    const colW = Math.max(8, (sp.supportColRightMm || 350) * scale);

    spanBoxes.push({
      x1: curX,
      x2: curX + spanW,
      span: sp,
      mark: sp.beamMark || `Span ${idx + 1}`,
    });
    curX += spanW;

    columns.push({
      x1: curX,
      x2: curX + colW,
      label: sp.colRightLabel || `C${idx + 2}`,
      widthMm: sp.supportColRightMm || 350,
    });
    curX += colW;
  });

  const beamTopY = 38;
  const beamBtmY = 78;
  const beamH = beamBtmY - beamTopY;
  const totalLengthM = totalMm / 1000;
  const needsLap = totalLengthM > 12.0;

  return (
    <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-2.5 overflow-x-auto">
      <div className="flex items-center justify-between mb-1.5 px-1 text-[10px]">
        <span className="font-semibold text-zinc-200">Elevation Schematic (Measured CAD Spans)</span>
        <span className="font-mono text-zinc-400">IS 13920 Detailing</span>
      </div>
      <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-auto select-none font-mono">
        <defs>
          <pattern id="diagHatch" width="6" height="6" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#52525b" strokeWidth="1" />
          </pattern>
        </defs>

        {/* Continuous Beam Outline */}
        <rect
          x={padX}
          y={beamTopY}
          width={Math.max(10, curX - padX)}
          height={beamH}
          fill="#18181b"
          stroke="#3f3f46"
          strokeWidth="1.5"
        />

        {/* Column Supports */}
        {columns.map((col, idx) => (
          <g key={`col_${idx}`}>
            <rect
              x={col.x1}
              y={24}
              width={Math.max(4, col.x2 - col.x1)}
              height={70}
              fill="url(#diagHatch)"
              stroke="#71717a"
              strokeWidth="1.2"
              opacity="0.8"
            />
            <text
              x={(col.x1 + col.x2) / 2}
              y={104}
              textAnchor="middle"
              fontSize="7.5"
              fill="#a1a1aa"
              className="font-sans"
            >
              {col.label}
            </text>
            <text
              x={(col.x1 + col.x2) / 2}
              y={114}
              textAnchor="middle"
              fontSize="6.5"
              fill="#71717a"
              className="font-mono"
            >
              {col.widthMm}w
            </text>
          </g>
        ))}

        {/* Rebar lines: Continuous Top Hanger (Zinc) */}
        {draft.reinforcement.topContinuousBars && (
          <path
            d={`M ${padX + 4} ${beamTopY + 16} L ${padX + 4} ${beamTopY + 6} L ${curX - 4} ${beamTopY + 6} L ${curX - 4} ${beamTopY + 16}`}
            fill="none"
            stroke="#e4e4e7"
            strokeWidth="2"
            strokeLinecap="round"
          />
        )}

        {/* Top Extra Bars Over Supports (Emerald) */}
        {columns.slice(1, -1).map((col, idx) => {
          const leftSpanW = spanBoxes[idx] ? spanBoxes[idx].x2 - spanBoxes[idx].x1 : 40;
          const rightSpanW = spanBoxes[idx + 1] ? spanBoxes[idx + 1].x2 - spanBoxes[idx + 1].x1 : 40;
          const xStart = col.x1 - leftSpanW * 0.33;
          const xEnd = col.x2 + rightSpanW * 0.33;
          return (
            <line
              key={`top_extra_${idx}`}
              x1={xStart}
              y1={beamTopY + 12}
              x2={xEnd}
              y2={beamTopY + 12}
              stroke="#34d399"
              strokeWidth="2"
              strokeLinecap="round"
            />
          );
        })}

        {/* Rebar lines: Continuous Bottom (Amber) */}
        {draft.reinforcement.bottomContinuousBars && (
          <path
            d={`M ${padX + 4} ${beamBtmY - 16} L ${padX + 4} ${beamBtmY - 6} L ${curX - 4} ${beamBtmY - 6} L ${curX - 4} ${beamBtmY - 16}`}
            fill="none"
            stroke="#f59e0b"
            strokeWidth="2"
            strokeLinecap="round"
          />
        )}

        {/* Curtailed Bottom Bars in Spans (Orange) */}
        {spanBoxes.map((sb, idx) => {
          const spanW = sb.x2 - sb.x1;
          const curtX1 = sb.x1 + spanW * 0.15;
          const curtX2 = sb.x2 - spanW * 0.15;
          return (
            <line
              key={`curt_${idx}`}
              x1={curtX1}
              y1={beamBtmY - 12}
              x2={curtX2}
              y2={beamBtmY - 12}
              stroke="#fb923c"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          );
        })}

        {/* Lap Splice Marker if > 12m */}
        {needsLap && (
          <g>
            <line
              x1={padX + (curX - padX) * 0.55}
              y1={beamTopY - 4}
              x2={padX + (curX - padX) * 0.55}
              y2={beamBtmY + 4}
              stroke="#ef4444"
              strokeWidth="1.5"
              strokeDasharray="2 2"
            />
            <text
              x={padX + (curX - padX) * 0.55}
              y={beamTopY - 6}
              textAnchor="middle"
              fontSize="7.5"
              fill="#f87171"
              fontWeight="bold"
            >
              50d LAP
            </text>
          </g>
        )}

        {/* Span Labels & Clear Dimensions */}
        {spanBoxes.map((sb, idx) => {
          const midX = (sb.x1 + sb.x2) / 2;
          const clearM = (sb.span.clearSpanMm / 1000).toFixed(2);
          const ccM = sb.span.centerToCenterSpanMm ? (sb.span.centerToCenterSpanMm / 1000).toFixed(2) : null;
          return (
            <g key={`span_txt_${idx}`}>
              <text
                x={midX}
                y={beamTopY - 6}
                textAnchor="middle"
                fontSize="9"
                fontWeight="600"
                fill="#f4f4f5"
              >
                {sb.mark}
              </text>
              <text
                x={midX}
                y={118}
                textAnchor="middle"
                fontSize="8"
                fill="#71717a"
              >
                {clearM}m clear{ccM ? ` (${ccM}m c/c)` : ''}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="flex flex-wrap items-center justify-between gap-2 mt-2 pt-1.5 border-t border-zinc-800/80 text-[10px]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1 text-zinc-300">
            <span className="w-2.5 h-0.5 bg-zinc-200 rounded-full inline-block" /> Top cont
          </span>
          <span className="flex items-center gap-1 text-emerald-400">
            <span className="w-2.5 h-0.5 bg-emerald-400 rounded-full inline-block" /> Extra L/3
          </span>
          <span className="flex items-center gap-1 text-amber-400">
            <span className="w-2.5 h-0.5 bg-amber-400 rounded-full inline-block" /> Btm cont
          </span>
          <span className="flex items-center gap-1 text-orange-400">
            <span className="w-2.5 h-0.5 bg-orange-400 rounded-full inline-block" /> Curt 0.15L
          </span>
        </div>
      </div>
    </div>
  );
};

export const LongitudinalSectionDrawer: React.FC<LongitudinalSectionDrawerProps> = ({
  isOpen,
  section,
  onClose,
  onSave,
  onDelete,
  isInferring = false,
  definedMembers = [],
}) => {
  const [draft, setDraft] = useState<LongitudinalSectionDefinition | null>(section);

  useEffect(() => {
    if (!section) {
      setDraft(null);
      return;
    }
    // Auto-inherit column widths from Step 2 Member Catalog if matched
    const colMembers = (definedMembers || []).filter((m) => m.category === 'column');
    if (colMembers.length > 0 && section.spans) {
      const enrichedSpans = section.spans.map((sp) => {
        let leftW = sp.supportColLeftMm;
        let rightW = sp.supportColRightMm;
        if (sp.colLeftLabel) {
          const matchCol = colMembers.find(
            (c) => c.mark === sp.colLeftLabel || c.mark.toUpperCase() === sp.colLeftLabel?.toUpperCase()
          );
          if (matchCol?.widthMm) leftW = matchCol.widthMm;
        }
        if (sp.colRightLabel) {
          const matchCol = colMembers.find(
            (c) => c.mark === sp.colRightLabel || c.mark.toUpperCase() === sp.colRightLabel?.toUpperCase()
          );
          if (matchCol?.widthMm) rightW = matchCol.widthMm;
        }
        return {
          ...sp,
          supportColLeftMm: leftW || 300,
          supportColRightMm: rightW || 350,
        };
      });
      setDraft({ ...section, spans: enrichedSpans });
    } else {
      setDraft(section);
    }
  }, [section, definedMembers]);

  if (!isOpen || !draft) return null;

  const totalClearSpanMm = (draft.spans || []).reduce((sum, s) => sum + (Number(s.clearSpanMm) || 0), 0);
  const totalColsMm = (draft.spans || []).slice(0, -1).reduce((sum, s) => sum + (Number(s.supportColRightMm) || 350), 0);
  const totalContLengthM = (totalClearSpanMm + totalColsMm) / 1000;
  const needsLap = totalContLengthM > 12.0;

  const updateSpan = (index: number, patch: Partial<LsSpanDefinition>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const nextSpans = [...prev.spans];
      nextSpans[index] = { ...nextSpans[index], ...patch };
      return { ...prev, spans: nextSpans };
    });
  };

  const addSpan = () => {
    setDraft((prev) => {
      if (!prev) return prev;
      const idx = prev.spans.length + 1;
      const newSpan: LsSpanDefinition = {
        id: `span_${Date.now()}`,
        beamMark: `B${idx}`,
        clearSpanMm: 3800,
        widthMm: 230,
        depthMm: 450,
        supportColLeftMm: 300,
        supportColRightMm: 350,
      };
      return { ...prev, spans: [...prev.spans, newSpan] };
    });
  };

  const removeSpan = (index: number) => {
    setDraft((prev) => {
      if (!prev || prev.spans.length <= 1) return prev;
      const nextSpans = prev.spans.filter((_, i) => i !== index);
      return { ...prev, spans: nextSpans };
    });
  };

  const handleSave = () => {
    if (!draft) return;
    onSave(draft);
    onClose();
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-zinc-950 border-l border-zinc-800 flex flex-col overflow-hidden">
      {/* Top Header */}
      <div className="pt-[max(14px,env(safe-area-inset-top))] sm:pt-4 px-3.5 pb-3 sm:p-4 border-b border-zinc-800/80 bg-zinc-900/60 flex items-center justify-between gap-3 shrink-0">
        <div className="min-w-0 flex items-center gap-2">
          <div className="p-2 rounded-xl bg-amber-400/10 border border-amber-400/25 text-amber-400 shrink-0">
            <Layers className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xs font-semibold text-zinc-100 truncate">
                Longitudinal Section (L-Section)
              </h3>
              {isInferring ? (
                <span className="px-2 py-0.5 rounded bg-amber-400/10 border border-amber-400/25 text-amber-300 text-[10px] font-mono">
                  Analyzing CAD window...
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-[10px] font-mono">
                  {draft.spans.length} Continuous Spans
                </span>
              )}
            </div>
            <p className="text-[11px] text-zinc-400 truncate mt-0.5">
              Continuous multi-span beam detailing with automated lap splices & curtailments
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="min-h-[34px] min-w-[34px] sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Main Scrollable Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3.5 sm:p-4 space-y-4 text-xs font-sans">
        {/* Name input */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-zinc-300">Section Title / Beam Series</label>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="w-full min-h-[36px] sm:min-h-0 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-zinc-100 focus:outline-none focus:border-amber-400 text-xs font-mono font-medium"
            placeholder="e.g. BEAM B1 (GRID 1): B1-1 TO B1-3"
          />
        </div>

        {/* Continuous Length Overview Card */}
        <div className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/80 space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-zinc-400">Total Continuous Length:</span>
            <span className="font-mono font-medium text-zinc-100 tabular-nums">
              {totalContLengthM.toFixed(2)} m ({draft.spans.length} spans)
            </span>
          </div>
          {needsLap ? (
            <div className="flex items-center gap-1.5 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-lg">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>
                Length exceeds 12.0m commercial stock bar. Automatic 50d lap splice applied.
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-lg">
              <Check className="w-3.5 h-3.5 shrink-0" />
              <span>Fits within single 12m stock bar length (0 lap splices required).</span>
            </div>
          )}
        </div>

        {/* Live Elevation SVG Schematic */}
        <ElevationSvg draft={draft} />

        {/* Spans List */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-zinc-300">
              Continuous Spans ({draft.spans.length})
            </span>
            <button
              type="button"
              onClick={addSpan}
              className="inline-flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 font-medium"
            >
              <Plus className="w-3 h-3" />
              <span>Add Span</span>
            </button>
          </div>

          <div className="space-y-2">
            {draft.spans.map((span, idx) => (
              <div
                key={span.id || idx}
                className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded bg-zinc-800 text-[10px] text-zinc-400 flex items-center justify-center font-mono">
                      {idx + 1}
                    </span>
                    <input
                      type="text"
                      value={span.beamMark}
                      onChange={(e) => updateSpan(idx, { beamMark: e.target.value })}
                      className="w-24 min-h-[34px] sm:min-h-0 bg-zinc-950 border border-zinc-800 focus:border-amber-400 outline-none rounded px-1.5 py-0.5 text-xs font-mono font-medium text-zinc-100"
                      placeholder="e.g. B1-1"
                    />
                  </div>
                  {draft.spans.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSpan(idx)}
                      className="p-1 text-zinc-500 hover:text-rose-400 transition"
                      title="Remove span"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {idx === 0 && (
                  <div className="p-2 bg-zinc-950/60 rounded border border-zinc-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] mb-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-zinc-400 font-sans">Left End Support Bearing (w<sub>s</sub>):</span>
                      <span className="font-mono text-zinc-300 font-medium">{span.colLeftLabel || 'Start Support (C1)'}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={span.supportColLeftMm || 300}
                        onChange={(e) => updateSpan(0, { supportColLeftMm: Number(e.target.value) })}
                        className="w-20 min-h-[34px] sm:min-h-0 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-200 font-mono text-center"
                        title="Bearing width of left end support"
                      />
                      <span className="text-zinc-500 text-[10px]">mm</span>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
                  <div>
                    <span className="text-[10px] font-sans text-zinc-500 block">Clear Span (L<sub>c</sub>)</span>
                    <div className="flex items-center gap-1 mt-0.5">
                      <input
                        type="number"
                        value={span.clearSpanMm}
                        onChange={(e) => updateSpan(idx, { clearSpanMm: Number(e.target.value) })}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-200"
                      />
                      <span className="text-zinc-500 text-[10px]">mm</span>
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] font-sans text-zinc-500 block">Width (b)</span>
                    <div className="flex items-center gap-1 mt-0.5">
                      <input
                        type="number"
                        value={span.widthMm}
                        onChange={(e) => updateSpan(idx, { widthMm: Number(e.target.value) })}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-200"
                      />
                      <span className="text-zinc-500 text-[10px]">mm</span>
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] font-sans text-zinc-500 block">Depth (D)</span>
                    <div className="flex items-center gap-1 mt-0.5">
                      <input
                        type="number"
                        value={span.depthMm}
                        onChange={(e) => updateSpan(idx, { depthMm: Number(e.target.value) })}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-200"
                      />
                      <span className="text-zinc-500 text-[10px]">mm</span>
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] font-sans text-zinc-400 block" title="Support Bearing Width (ws)">
                      Support Bearing (w<sub>s</sub>)
                    </span>
                    <span className="text-[9px] text-zinc-500 block truncate font-mono">
                      {span.colRightLabel ? `Right: ${span.colRightLabel}` : `Support ${idx + 2}`}
                    </span>
                    <div className="flex items-center gap-1 mt-0.5">
                      <input
                        type="number"
                        value={span.supportColRightMm || 350}
                        onChange={(e) => updateSpan(idx, { supportColRightMm: Number(e.target.value) })}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-200"
                        title="Bearing width of right support"
                      />
                      <span className="text-zinc-500 text-[10px]">mm</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Reinforcement Configuration Form */}
        <div className="space-y-2.5 pt-2 border-t border-zinc-800">
          <span className="text-[11px] font-medium text-zinc-300 block">
            Reinforcement Detailing (IS 456 / IS 13920)
          </span>

          {/* Bottom Continuous */}
          <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1.5">
            <span className="text-[11px] font-medium text-zinc-200 block">Bottom Continuous Bars</span>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <div>
                <span className="text-[10px] font-sans text-zinc-500 block">Bar Count</span>
                <input
                  type="number"
                  min={1}
                  value={draft.reinforcement.bottomContinuousBars?.count || 3}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      reinforcement: {
                        ...draft.reinforcement,
                        bottomContinuousBars: {
                          diameter: draft.reinforcement.bottomContinuousBars?.diameter || 20,
                          count: Number(e.target.value),
                        },
                      },
                    })
                  }
                  className="w-full mt-0.5 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
                />
              </div>
              <div>
                <span className="text-[10px] font-sans text-zinc-500 block">Diameter (mm)</span>
                <select
                  value={draft.reinforcement.bottomContinuousBars?.diameter || 20}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      reinforcement: {
                        ...draft.reinforcement,
                        bottomContinuousBars: {
                          count: draft.reinforcement.bottomContinuousBars?.count || 3,
                          diameter: Number(e.target.value),
                        },
                      },
                    })
                  }
                  className="w-full mt-0.5 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
                >
                  {[12, 16, 20, 25, 28, 32].map((d) => (
                    <option key={d} value={d}>
                      Φ{d} mm
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Bottom Curtailed */}
          <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1.5">
            <span className="text-[11px] font-medium text-zinc-200 block">
              Mid-Span Curtailed Bottom Bars
            </span>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <div>
                <span className="text-[10px] font-sans text-zinc-500 block">Bar Count</span>
                <input
                  type="number"
                  min={0}
                  value={draft.reinforcement.bottomCurtailedBars?.count || 0}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      reinforcement: {
                        ...draft.reinforcement,
                        bottomCurtailedBars: {
                          diameter: draft.reinforcement.bottomCurtailedBars?.diameter || 16,
                          count: Number(e.target.value),
                          curtailRatio: 0.15,
                        },
                      },
                    })
                  }
                  className="w-full mt-0.5 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
                />
              </div>
              <div>
                <span className="text-[10px] font-sans text-zinc-500 block">Diameter (mm)</span>
                <select
                  value={draft.reinforcement.bottomCurtailedBars?.diameter || 16}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      reinforcement: {
                        ...draft.reinforcement,
                        bottomCurtailedBars: {
                          count: draft.reinforcement.bottomCurtailedBars?.count || 2,
                          diameter: Number(e.target.value),
                          curtailRatio: 0.15,
                        },
                      },
                    })
                  }
                  className="w-full mt-0.5 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
                >
                  {[12, 16, 20, 25].map((d) => (
                    <option key={d} value={d}>
                      Φ{d} mm
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Top Continuous */}
          <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1.5">
            <span className="text-[11px] font-medium text-zinc-200 block">Top Continuous Hanger Bars</span>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <div>
                <span className="text-[10px] font-sans text-zinc-500 block">Bar Count</span>
                <input
                  type="number"
                  min={1}
                  value={draft.reinforcement.topContinuousBars?.count || 2}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      reinforcement: {
                        ...draft.reinforcement,
                        topContinuousBars: {
                          diameter: draft.reinforcement.topContinuousBars?.diameter || 12,
                          count: Number(e.target.value),
                        },
                      },
                    })
                  }
                  className="w-full mt-0.5 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
                />
              </div>
              <div>
                <span className="text-[10px] font-sans text-zinc-500 block">Diameter (mm)</span>
                <select
                  value={draft.reinforcement.topContinuousBars?.diameter || 12}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      reinforcement: {
                        ...draft.reinforcement,
                        topContinuousBars: {
                          count: draft.reinforcement.topContinuousBars?.count || 2,
                          diameter: Number(e.target.value),
                        },
                      },
                    })
                  }
                  className="w-full mt-0.5 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
                >
                  {[10, 12, 16, 20].map((d) => (
                    <option key={d} value={d}>
                      Φ{d} mm
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Support Top Extra */}
          <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1.5">
            <span className="text-[11px] font-medium text-zinc-200 block">
              Support Top Extra Bars (Over Columns)
            </span>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <div>
                <span className="text-[10px] font-sans text-zinc-500 block">Bar Count</span>
                <input
                  type="number"
                  min={0}
                  value={draft.reinforcement.supportTopExtraBars?.count || 2}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      reinforcement: {
                        ...draft.reinforcement,
                        supportTopExtraBars: {
                          diameter: draft.reinforcement.supportTopExtraBars?.diameter || 20,
                          count: Number(e.target.value),
                          extensionRatio: 0.33,
                        },
                      },
                    })
                  }
                  className="w-full mt-0.5 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
                />
              </div>
              <div>
                <span className="text-[10px] font-sans text-zinc-500 block">Diameter (mm)</span>
                <select
                  value={draft.reinforcement.supportTopExtraBars?.diameter || 20}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      reinforcement: {
                        ...draft.reinforcement,
                        supportTopExtraBars: {
                          count: draft.reinforcement.supportTopExtraBars?.count || 2,
                          diameter: Number(e.target.value),
                          extensionRatio: 0.33,
                        },
                      },
                    })
                  }
                  className="w-full mt-0.5 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
                >
                  {[12, 16, 20, 25, 28].map((d) => (
                    <option key={d} value={d}>
                      Φ{d} mm
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Stirrups */}
          <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1.5">
            <span className="text-[11px] font-medium text-zinc-200 block">
              Shear Stirrups (Confinement & Mid Zones)
            </span>
            <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
              <div>
                <span className="text-[10px] font-sans text-zinc-500 block">Dia (mm)</span>
                <input
                  type="number"
                  value={draft.reinforcement.stirrups?.diameter || 8}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      reinforcement: {
                        ...draft.reinforcement,
                        stirrups: {
                          ...draft.reinforcement.stirrups,
                          diameter: Number(e.target.value),
                          spacingEndMm: draft.reinforcement.stirrups?.spacingEndMm || 100,
                          spacingMidMm: draft.reinforcement.stirrups?.spacingMidMm || 175,
                        },
                      },
                    })
                  }
                  className="w-full mt-0.5 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
                />
              </div>
              <div>
                <span className="text-[10px] font-sans text-zinc-500 block">End Zone @ (mm)</span>
                <input
                  type="number"
                  value={draft.reinforcement.stirrups?.spacingEndMm || 100}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      reinforcement: {
                        ...draft.reinforcement,
                        stirrups: {
                          ...draft.reinforcement.stirrups,
                          diameter: draft.reinforcement.stirrups?.diameter || 8,
                          spacingEndMm: Number(e.target.value),
                          spacingMidMm: draft.reinforcement.stirrups?.spacingMidMm || 175,
                        },
                      },
                    })
                  }
                  className="w-full mt-0.5 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
                />
              </div>
              <div>
                <span className="text-[10px] font-sans text-zinc-500 block">Mid Zone @ (mm)</span>
                <input
                  type="number"
                  value={draft.reinforcement.stirrups?.spacingMidMm || 175}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      reinforcement: {
                        ...draft.reinforcement,
                        stirrups: {
                          ...draft.reinforcement.stirrups,
                          diameter: draft.reinforcement.stirrups?.diameter || 8,
                          spacingEndMm: draft.reinforcement.stirrups?.spacingEndMm || 100,
                          spacingMidMm: Number(e.target.value),
                        },
                      },
                    })
                  }
                  className="w-full mt-0.5 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="p-3.5 sm:p-4 pb-[max(14px,env(safe-area-inset-bottom))] sm:pb-4 border-t border-zinc-800 bg-zinc-900/60 flex items-center justify-between gap-2 shrink-0">
        {onDelete && (
          <button
            type="button"
            onClick={() => {
              onDelete(draft.id);
              onClose();
            }}
            className="min-h-[38px] sm:min-h-0 px-3 py-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 text-xs font-medium transition"
          >
            Delete
          </button>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[38px] sm:min-h-0 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="min-h-[38px] sm:min-h-0 px-4 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-medium transition flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Apply to BBS</span>
          </button>
        </div>
      </div>
    </div>
  );
};

