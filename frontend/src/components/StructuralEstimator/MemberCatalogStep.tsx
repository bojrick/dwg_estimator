import React, { useState, useMemo } from 'react';
import {
  Plus,
  Trash2,
  Copy,
  Sparkles,
  Ruler,
  ArrowRight,
  ArrowLeft,
  Filter,
  CheckSquare,
  Square,
  Crop,
  Table as TableIcon,
  X,
  Search,
  AlertTriangle,
} from 'lucide-react';
import {
  StructuralMemberDefinition,
  StructuralMemberType,
  ExtractedCadTable,
  BoxCoords,
} from './types';
import {
  extractLegendSectionSizes,
  isLayerRelevantForScope,
} from './tagScanner';

interface MemberCatalogStepProps {
  scope: StructuralMemberType;
  members: StructuralMemberDefinition[];
  scheduleTables?: ExtractedCadTable[];
  cadTexts?: any[];
  cadLayers?: any[];
  layoutBoundingBox?: BoxCoords | null;
  activeLegendTableId?: string | null;
  inspectedMemberId?: string | null;
  defaultCoverMm?: number;
  defaultFloorHeightMm?: number;
  isAiNormalizing?: boolean;
  onChangeMembers: (members: StructuralMemberDefinition[]) => void;
  onScanLayoutTags: (options?: { allowedLayers?: string[]; customPrefix?: string }) => void;
  onNormalizeTablesAi?: () => void;
  onPickSpanOnDrawing: (memberId: string) => void;
  onHighlightMember: (mark: string) => void;
  onSelectMemberForInspection: (member: StructuralMemberDefinition | null) => void;
  onStartSelectLayoutBox: () => void;
  onClearLayoutBox: () => void;
  onChangeActiveLegendTableId: (tableId: string | null) => void;
  onBackToStep1?: () => void;
  onProceedToStep3: () => void;
  activePickingMemberId?: string | null;
}

export const MemberCatalogStep: React.FC<MemberCatalogStepProps> = ({
  scope,
  members,
  scheduleTables = [],
  cadTexts = [],
  cadLayers = [],
  layoutBoundingBox,
  activeLegendTableId,
  inspectedMemberId,
  defaultCoverMm,
  defaultFloorHeightMm = 3000,
  isAiNormalizing = false,
  onChangeMembers,
  onScanLayoutTags,
  onNormalizeTablesAi,
  onPickSpanOnDrawing,
  onHighlightMember,
  onSelectMemberForInspection,
  onStartSelectLayoutBox,
  onClearLayoutBox,
  onChangeActiveLegendTableId,
  onBackToStep1,
  onProceedToStep3,
  activePickingMemberId,
}) => {
  const legendSizes = useMemo(() => {
    return extractLegendSectionSizes(scheduleTables, cadTexts);
  }, [scheduleTables, cadTexts]);

  const availableLayers = useMemo(() => {
    const layerNames = new Set<string>();
    for (const t of cadTexts) {
      if (t.layer) layerNames.add(t.layer);
    }
    for (const lyr of cadLayers) {
      if (typeof lyr === 'string') layerNames.add(lyr);
      else if (lyr?.name) layerNames.add(lyr.name);
    }

    return Array.from(layerNames)
      .map((name) => {
        const affinity = isLayerRelevantForScope(name, scope);
        const textCount = cadTexts.filter((t) => t.layer === name).length;
        return { name, affinity, textCount };
      })
      .sort((a, b) => {
        if (a.affinity === 'high' && b.affinity !== 'high') return -1;
        if (b.affinity === 'high' && a.affinity !== 'high') return 1;
        return b.textCount - a.textCount;
      });
  }, [cadTexts, cadLayers, scope]);

  const [isFilterPopoverOpen, setIsFilterPopoverOpen] = useState(false);
  const [selectedLayers, setSelectedLayers] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const lyr of availableLayers) {
      if (lyr.affinity !== 'exclude') set.add(lyr.name);
    }
    return set;
  });
  const [customPrefix, setCustomPrefix] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'verified' | 'review'>('all');

  // Quick Add Member Form state
  const [newMark, setNewMark] = useState('');
  const [newWidth, setNewWidth] = useState(
    legendSizes[0]?.widthMm || (scope === 'beam' ? 230 : 300)
  );
  const [newDepth, setNewDepth] = useState(legendSizes[0]?.depthMm || 450);
  const [newSpan, setNewSpan] = useState(scope === 'column' ? defaultFloorHeightMm : 4000);
  const [newFloor, setNewFloor] = useState('Ground Floor');

  // Batch actions state
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
  const [batchSizePreset, setBatchSizePreset] = useState<string>('');

  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        if (
          !m.mark.toLowerCase().includes(q) &&
          !(m.floorLevel || '').toLowerCase().includes(q) &&
          !`${m.widthMm}x${m.depthMm}`.includes(q)
        ) {
          return false;
        }
      }
      if (statusFilter === 'verified') return Boolean(m.isVerifiedInLegend);
      if (statusFilter === 'review') return !m.isVerifiedInLegend || Boolean(m.scheduleConflict);
      return true;
    });
  }, [members, searchQuery, statusFilter]);

  const verifiedCount = useMemo(
    () => members.filter((m) => m.isVerifiedInLegend).length,
    [members]
  );

  const toggleLayer = (layerName: string) => {
    setSelectedLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layerName)) next.delete(layerName);
      else next.add(layerName);
      return next;
    });
  };

  const handleRunScan = () => {
    onScanLayoutTags({
      allowedLayers: selectedLayers.size > 0 ? Array.from(selectedLayers) : undefined,
      customPrefix: customPrefix.trim() || undefined,
    });
  };

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMark.trim()) return;

    const cover =
      defaultCoverMm ||
      (scope === 'column' ? 40 : scope === 'beam' ? 25 : scope === 'footing' ? 50 : 20);

    const item: StructuralMemberDefinition = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      mark: newMark.trim().toUpperCase(),
      category: scope,
      floorLevel: newFloor,
      countOnLayout: 1,
      widthMm: Number(newWidth) || 230,
      depthMm: Number(newDepth) || 450,
      spanMm: Number(newSpan) || 3000,
      clearCoverMm: cover,
      sizeSource: 'manual',
      mainBars: { count: 4, diameter: 16 },
      secondaryBars: { count: 2, diameter: 12 },
      stirrups: { diameter: 8, spacingMm: 150, legs: 2 },
    };

    onChangeMembers([...members, item]);
    setNewMark('');
  };

  const handleUpdateMember = (id: string, patch: Partial<StructuralMemberDefinition>) => {
    onChangeMembers(members.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  const handleDeleteMember = (id: string) => {
    onChangeMembers(members.filter((m) => m.id !== id));
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleDuplicateForUpperFloor = (m: StructuralMemberDefinition) => {
    const nextFloor = m.floorLevel?.includes('Ground')
      ? '1st Floor'
      : m.floorLevel?.includes('1st')
      ? '2nd Floor'
      : m.floorLevel?.includes('2nd')
      ? '3rd Floor'
      : 'Upper Floor';

    const reducedDepth = scope === 'column' ? Math.max(200, m.depthMm - 75) : m.depthMm;

    const dup: StructuralMemberDefinition = {
      ...m,
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      floorLevel: nextFloor,
      depthMm: reducedDepth,
      notes: `Section for ${nextFloor}`,
    };

    onChangeMembers([...members, dup]);
  };

  const handleToggleSelectAll = () => {
    if (selectedMemberIds.size === filteredMembers.length && filteredMembers.length > 0) {
      setSelectedMemberIds(new Set());
    } else {
      setSelectedMemberIds(new Set(filteredMembers.map((m) => m.id)));
    }
  };

  const handleToggleSelectMember = (id: string) => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApplyBatchSectionSize = () => {
    if (!batchSizePreset || selectedMemberIds.size === 0) return;
    const [wStr, dStr] = batchSizePreset.split('x');
    const w = parseInt(wStr, 10);
    const d = parseInt(dStr, 10);
    if (!w || !d) return;

    onChangeMembers(
      members.map((m) =>
        selectedMemberIds.has(m.id)
          ? { ...m, widthMm: w, depthMm: d, sizeSource: 'schedule', isVerifiedInLegend: true }
          : m
      )
    );
  };

  const handleDeleteSelected = () => {
    onChangeMembers(members.filter((m) => !selectedMemberIds.has(m.id)));
    setSelectedMemberIds(new Set());
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-zinc-900">
      {/* Pinned Top Action & Filter Bar */}
      <div className="p-3 bg-zinc-950 border-b border-zinc-800/80 space-y-2.5 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-medium text-zinc-100">
              Members & section sizes
            </h3>
            <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 text-[11px] font-mono tabular-nums capitalize">
              {scope}s ({members.length})
            </span>
          </div>

          <div className="flex items-center gap-1.5 relative">
            <button
              type="button"
              onClick={onStartSelectLayoutBox}
              className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1.5 transition ${
                layoutBoundingBox
                  ? 'bg-emerald-950/50 border-emerald-700/60 text-emerald-300'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'
              }`}
              title="Drag a box on the drawing to scan only inside the floor plan boundary"
            >
              <Crop className="w-3.5 h-3.5 text-emerald-400" />
              <span>{layoutBoundingBox ? 'Area cropped' : 'Crop drawing area'}</span>
            </button>
            {layoutBoundingBox && (
              <button
                type="button"
                onClick={onClearLayoutBox}
                className="p-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200"
                title="Clear crop area"
              >
                <X className="w-3 h-3" />
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsFilterPopoverOpen(!isFilterPopoverOpen)}
              className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1.5 transition ${
                isFilterPopoverOpen
                  ? 'bg-zinc-800 text-zinc-100 border-zinc-700'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Layers ({selectedLayers.size})</span>
            </button>

            {scheduleTables.length > 0 && onNormalizeTablesAi && (
              <button
                type="button"
                onClick={onNormalizeTablesAi}
                disabled={isAiNormalizing}
                className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-700 hover:border-zinc-600 text-zinc-200 text-[11px] font-medium flex items-center gap-1.5 transition disabled:opacity-50"
                title="Expand grouped marks (e.g. B1-1 to B1-4) and match schedule sizes"
              >
                <TableIcon className="w-3.5 h-3.5 text-blue-400" />
                <span>{isAiNormalizing ? 'Syncing...' : 'Sync schedule sizes'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleRunScan}
              className="px-3 py-1 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-[11px] font-medium flex items-center gap-1.5 transition"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Auto-detect {scope}s</span>
            </button>

            {/* Layer Filter Popover */}
            {isFilterPopoverOpen && (
              <div className="absolute right-0 top-9 z-30 w-80 p-3 rounded-xl bg-zinc-950 border border-zinc-800 shadow-xl space-y-2.5 text-xs">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
                  <span className="font-medium text-zinc-200">Filter CAD layers</span>
                  <div className="flex items-center gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setSelectedLayers(new Set(availableLayers.map((l) => l.name)))}
                      className="text-blue-400 hover:underline"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsFilterPopoverOpen(false)}
                      className="text-zinc-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 max-h-36 overflow-y-auto">
                  {availableLayers.map((lyr) => {
                    const isChecked = selectedLayers.has(lyr.name);
                    return (
                      <button
                        key={lyr.name}
                        type="button"
                        onClick={() => toggleLayer(lyr.name)}
                        className={`px-2 py-0.5 rounded border text-[11px] font-mono transition ${
                          isChecked
                            ? 'bg-zinc-800 border-zinc-700 text-zinc-200'
                            : 'bg-zinc-950 border-zinc-900 text-zinc-600'
                        }`}
                      >
                        {lyr.name} ({lyr.textCount})
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2 pt-1 border-t border-zinc-800">
                  <span className="text-[11px] text-zinc-400">Prefix:</span>
                  <input
                    type="text"
                    value={customPrefix}
                    onChange={(e) => setCustomPrefix(e.target.value)}
                    placeholder="e.g. B, PB, C"
                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-white font-mono text-xs uppercase"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Search, Filter Pills & Schedule Selector */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
            <div className="relative flex-1 max-w-xs">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter mark (e.g. B1-1, B2-5)..."
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-8 pr-2.5 py-1 text-xs text-zinc-100 placeholder:text-zinc-500"
              />
            </div>

            <div className="flex items-center bg-zinc-900 p-0.5 rounded-lg border border-zinc-800 text-[11px]">
              {[
                { id: 'all', label: `All (${members.length})` },
                { id: 'verified', label: `Verified (${verifiedCount})` },
                { id: 'review', label: `Review (${members.length - verifiedCount})` },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id as any)}
                  className={`px-2 py-0.5 rounded-md font-medium tabular-nums transition ${
                    statusFilter === tab.id
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {scheduleTables.length > 0 && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="text-zinc-500">Schedule:</span>
              <select
                value={activeLegendTableId || ''}
                onChange={(e) => onChangeActiveLegendTableId(e.target.value || null)}
                className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-zinc-200 font-mono text-[11px]"
              >
                <option value="">All extracted tables ({scheduleTables.length})</option>
                {scheduleTables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} ({t.rows.length} rows)
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Batch Selection Bar (Only shown when items checked) */}
      {selectedMemberIds.size > 0 && (
        <div className="px-3 py-1.5 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between gap-2 text-xs shrink-0">
          <span className="text-zinc-200 font-medium tabular-nums">
            {selectedMemberIds.size} selected
          </span>
          <div className="flex items-center gap-2">
            {legendSizes.length > 0 && (
              <div className="flex items-center gap-1">
                <select
                  value={batchSizePreset}
                  onChange={(e) => setBatchSizePreset(e.target.value)}
                  className="bg-zinc-950 border border-zinc-700 rounded px-2 py-0.5 text-zinc-200 font-mono text-[11px]"
                >
                  <option value="">Assign section size...</option>
                  {legendSizes.map((s) => (
                    <option key={`${s.widthMm}x${s.depthMm}`} value={`${s.widthMm}x${s.depthMm}`}>
                      {s.label} mm
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleApplyBatchSectionSize}
                  disabled={!batchSizePreset}
                  className="px-2 py-0.5 rounded bg-zinc-100 text-zinc-950 font-medium text-[11px] disabled:opacity-40"
                >
                  Apply
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={handleDeleteSelected}
              className="px-2 py-0.5 rounded bg-rose-950/60 border border-rose-800/50 text-rose-300 text-[11px] flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              <span>Delete</span>
            </button>
          </div>
        </div>
      )}

      {/* Contained 4-Column Master List (Zero Horizontal Scroll) */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-zinc-950">
        <table className="w-full border-collapse text-xs table-fixed">
          <thead className="sticky top-0 z-10 bg-zinc-900 border-b border-zinc-800 text-[11px] text-zinc-400">
            <tr>
              <th className="py-2 pl-3 pr-1 w-8 text-center">
                <button
                  type="button"
                  onClick={handleToggleSelectAll}
                  className="text-zinc-400 hover:text-zinc-200"
                >
                  {selectedMemberIds.size === filteredMembers.length && filteredMembers.length > 0 ? (
                    <CheckSquare className="w-3.5 h-3.5 text-zinc-200" />
                  ) : (
                    <Square className="w-3.5 h-3.5" />
                  )}
                </button>
              </th>
              <th className="py-2 px-2 text-left font-medium w-[24%]">Member mark</th>
              <th className="py-2 px-2 text-left font-medium w-[28%]">
                {scope === 'column' ? 'Qty & height (mm)' : 'Qty & clear span (mm)'}
              </th>
              <th className="py-2 px-2 text-left font-medium w-[28%]">Section (b × D mm)</th>
              <th className="py-2 pl-2 pr-3 text-right font-medium w-[20%]">Source</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-zinc-900">
            {filteredMembers.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-zinc-500 text-xs">
                  No {scope} members in this view. Click <strong>Auto-detect {scope}s</strong> above or add one below.
                </td>
              </tr>
            ) : (
              filteredMembers.map((m) => {
                const isSelected = selectedMemberIds.has(m.id);
                const isInspected = inspectedMemberId === m.id;
                const isPickingThis = activePickingMemberId === m.id;

                return (
                  <tr
                    key={m.id}
                    onClick={() => {
                      onSelectMemberForInspection(m);
                      onHighlightMember(m.mark);
                    }}
                    className={`cursor-pointer transition ${
                      isInspected
                        ? 'bg-zinc-900'
                        : isSelected
                        ? 'bg-zinc-900/60'
                        : 'hover:bg-zinc-900/40'
                    }`}
                  >
                    <td
                      className="py-2 pl-3 pr-1 text-center"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleSelectMember(m.id);
                      }}
                    >
                      {isSelected ? (
                        <CheckSquare className="w-3.5 h-3.5 text-zinc-200 mx-auto" />
                      ) : (
                        <Square className="w-3.5 h-3.5 text-zinc-600 hover:text-zinc-400 mx-auto" />
                      )}
                    </td>

                    {/* Column 1: Member Mark (Compound marks like B1-1, B2-5, B5-100 preserved) */}
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-medium text-zinc-100 tabular-nums">
                          {m.mark}
                        </span>
                        {m.countOnLayout > 1 && (
                          <span className="px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-300 font-mono text-[10px] tabular-nums">
                            ×{m.countOnLayout}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-500 truncate">
                        {m.floorLevel || 'Ground Floor'}
                      </div>
                    </td>

                    {/* Column 2: Qty & Clear Span */}
                    <td className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1 font-mono tabular-nums">
                        <input
                          type="number"
                          min="1"
                          value={m.countOnLayout}
                          onChange={(e) =>
                            handleUpdateMember(m.id, { countOnLayout: Math.max(1, Number(e.target.value)) })
                          }
                          className="w-10 bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-center text-zinc-200 text-[11px]"
                          title="Count on layout"
                        />
                        <span className="text-zinc-600">×</span>
                        <input
                          type="number"
                          step="50"
                          value={m.spanMm}
                          onChange={(e) =>
                            handleUpdateMember(m.id, { spanMm: Math.max(200, Number(e.target.value)) })
                          }
                          className="w-16 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-right text-zinc-100 text-[11px]"
                          title="Span or height in mm"
                        />
                        <button
                          type="button"
                          onClick={() => onPickSpanOnDrawing(m.id)}
                          className={`p-1 rounded border transition ${
                            isPickingThis
                              ? 'bg-amber-500 text-zinc-950 border-amber-400'
                              : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                          }`}
                          title="Pick 2 points on drawing to measure clear span"
                        >
                          <Ruler className="w-3 h-3" />
                        </button>
                      </div>
                    </td>

                    {/* Column 3: Independent Section Size (b x D) per beam/column */}
                    <td className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1 font-mono tabular-nums">
                        <input
                          type="number"
                          step="10"
                          value={m.widthMm}
                          onChange={(e) =>
                            handleUpdateMember(m.id, {
                              widthMm: Math.max(100, Number(e.target.value)),
                              sizeSource: 'manual',
                            })
                          }
                          className="w-14 bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-center text-zinc-100 text-[11px]"
                        />
                        <span className="text-zinc-500">×</span>
                        <input
                          type="number"
                          step="25"
                          value={m.depthMm}
                          onChange={(e) =>
                            handleUpdateMember(m.id, {
                              depthMm: Math.max(100, Number(e.target.value)),
                              sizeSource: 'manual',
                            })
                          }
                          className="w-14 bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-center text-zinc-100 text-[11px]"
                        />
                      </div>
                      {m.scheduleConflict && (
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateMember(m.id, {
                              widthMm: m.scheduleConflict!.scheduleWidthMm,
                              depthMm: m.scheduleConflict!.scheduleDepthMm,
                              sizeSource: 'schedule',
                              scheduleConflict: undefined,
                            })
                          }
                          className="mt-0.5 text-[10px] text-amber-400 hover:underline flex items-center gap-1 font-mono tabular-nums"
                          title="Click to use schedule table dimension instead of plan text"
                        >
                          <AlertTriangle className="w-2.5 h-2.5" />
                          <span>
                            Sched: {m.scheduleConflict.scheduleWidthMm}×{m.scheduleConflict.scheduleDepthMm}
                          </span>
                        </button>
                      )}
                    </td>

                    {/* Column 4: Size Source & Quick Actions */}
                    <td className="py-2 pl-2 pr-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            m.sizeSource === 'schedule'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : m.sizeSource === 'inline_text'
                              ? 'bg-blue-500/15 text-blue-300'
                              : m.sizeSource === 'geometry'
                              ? 'bg-zinc-800 text-zinc-300'
                              : 'bg-amber-500/15 text-amber-300'
                          }`}
                        >
                          {m.sizeSource === 'schedule'
                            ? 'Schedule'
                            : m.sizeSource === 'inline_text'
                            ? 'Plan text'
                            : m.sizeSource === 'geometry'
                            ? 'CAD geom'
                            : 'Default'}
                        </span>

                        {scope === 'column' && (
                          <button
                            type="button"
                            onClick={() => handleDuplicateForUpperFloor(m)}
                            className="p-1 rounded text-zinc-500 hover:text-zinc-200"
                            title="Duplicate column for upper floor"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => handleDeleteMember(m.id)}
                          className="p-1 rounded text-zinc-500 hover:text-rose-400"
                          title="Remove member"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Docked Single-Line Quick Add Bar */}
      <form
        onSubmit={handleAddMember}
        className="px-3 py-2 bg-zinc-900 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0"
      >
        <div className="flex items-center gap-2 flex-wrap font-mono tabular-nums">
          <input
            type="text"
            required
            value={newMark}
            onChange={(e) => setNewMark(e.target.value)}
            placeholder={scope === 'beam' ? 'Mark (e.g. B2-5)' : 'Mark (e.g. C1)'}
            className="w-28 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-zinc-100 uppercase text-[11px]"
          />
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-zinc-500 font-sans">Size:</span>
            <input
              type="number"
              value={newWidth}
              onChange={(e) => setNewWidth(Number(e.target.value))}
              className="w-14 bg-zinc-950 border border-zinc-800 rounded-lg px-1.5 py-1 text-center text-zinc-100 text-[11px]"
            />
            <span className="text-zinc-500">×</span>
            <input
              type="number"
              value={newDepth}
              onChange={(e) => setNewDepth(Number(e.target.value))}
              className="w-14 bg-zinc-950 border border-zinc-800 rounded-lg px-1.5 py-1 text-center text-zinc-100 text-[11px]"
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-zinc-500 font-sans">
              {scope === 'column' ? 'Ht:' : 'Span:'}
            </span>
            <input
              type="number"
              value={newSpan}
              onChange={(e) => setNewSpan(Number(e.target.value))}
              className="w-16 bg-zinc-950 border border-zinc-800 rounded-lg px-1.5 py-1 text-center text-zinc-100 text-[11px]"
            />
          </div>
        </div>

        <button
          type="submit"
          className="px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-[11px] font-medium flex items-center gap-1 transition"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add member</span>
        </button>
      </form>

      {/* Pinned Step Footer (Always visible without scrolling) */}
      <div className="h-12 px-4 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between gap-3 shrink-0">
        {onBackToStep1 ? (
          <button
            type="button"
            onClick={onBackToStep1}
            className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-xs font-medium flex items-center gap-1.5 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Project setup</span>
          </button>
        ) : (
          <div />
        )}

        <div className="text-[11px] text-zinc-400 font-mono tabular-nums hidden sm:block">
          {members.length} {scope}s · {verifiedCount} verified sections
        </div>

        <button
          type="button"
          onClick={onProceedToStep3}
          className="px-4 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-medium flex items-center gap-1.5 transition"
        >
          <span>Continue to reinforcement</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
