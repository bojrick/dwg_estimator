import React, { useState, useEffect } from 'react';
import {
  X,
  Layers,
  Sparkles,
  Plus,
  Trash2,
  Check,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { LongitudinalSectionDefinition, LsSpanDefinition } from './types';

interface LongitudinalSectionDrawerProps {
  isOpen: boolean;
  section: LongitudinalSectionDefinition | null;
  onClose: () => void;
  onSave: (updated: LongitudinalSectionDefinition) => void;
  onDelete?: (id: string) => void;
  isInferring?: boolean;
}

export const LongitudinalSectionDrawer: React.FC<LongitudinalSectionDrawerProps> = ({
  isOpen,
  section,
  onClose,
  onSave,
  onDelete,
  isInferring = false,
}) => {
  const [draft, setDraft] = useState<LongitudinalSectionDefinition | null>(section);

  useEffect(() => {
    setDraft(section);
  }, [section]);

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
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-zinc-950 border-l border-zinc-800 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
      {/* Top Header */}
      <div className="p-4 border-b border-zinc-800/80 bg-zinc-900/60 flex items-center justify-between gap-3 shrink-0">
        <div className="min-w-0 flex items-center gap-2">
          <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 shrink-0">
            <Layers className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-zinc-100 truncate">
                Longitudinal Section (L-Section)
              </h3>
              {isInferring ? (
                <span className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-300 text-[10px] animate-pulse">
                  Analyzing CAD window...
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-[10px] font-mono">
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
          className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Main Scrollable Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 text-xs font-sans">
        {/* Name input */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-zinc-300">Section Title / Beam Series</label>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-zinc-100 focus:outline-none focus:border-blue-500 text-xs font-mono font-medium"
            placeholder="e.g. BEAM B1 (GRID 1): B1-1 TO B1-3"
          />
        </div>

        {/* Continuous Length Overview Card */}
        <div className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/80 space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-zinc-400">Total Continuous Length:</span>
            <span className="font-mono font-medium text-zinc-100">
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

        {/* Spans List */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-zinc-300">
              Continuous Spans ({draft.spans.length})
            </span>
            <button
              type="button"
              onClick={addSpan}
              className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 font-medium"
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
                    <span className="w-4 h-4 rounded-full bg-zinc-800 text-[10px] text-zinc-400 flex items-center justify-center font-mono">
                      {idx + 1}
                    </span>
                    <input
                      type="text"
                      value={span.beamMark}
                      onChange={(e) => updateSpan(idx, { beamMark: e.target.value })}
                      className="w-24 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-xs font-mono font-medium text-zinc-100"
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

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
                  <div>
                    <span className="text-[10px] font-sans text-zinc-500 block">Clear Span</span>
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
                    <span className="text-[10px] font-sans text-zinc-500 block">Col Support</span>
                    <div className="flex items-center gap-1 mt-0.5">
                      <input
                        type="number"
                        value={span.supportColRightMm || 350}
                        onChange={(e) => updateSpan(idx, { supportColRightMm: Number(e.target.value) })}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-200"
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
      <div className="p-4 border-t border-zinc-800 bg-zinc-900/60 flex items-center justify-between gap-2 shrink-0">
        {onDelete && (
          <button
            type="button"
            onClick={() => {
              onDelete(draft.id);
              onClose();
            }}
            className="px-3 py-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 text-xs font-medium transition"
          >
            Delete
          </button>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition flex items-center gap-1.5 shadow-lg shadow-blue-500/20"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Apply to BBS</span>
          </button>
        </div>
      </div>
    </div>
  );
};

