import React, { useState, useMemo } from 'react';
import {
  Plus,
  Trash2,
  Copy,
  Sparkles,
  Ruler,
  Eye,
  Check,
  ArrowRight,
  Layers,
  ChevronDown,
  ChevronUp,
  Filter,
  CheckSquare,
  Square,
  ShieldCheck,
  AlertCircle,
  Tag,
  Crop,
  Table as TableIcon,
  X,
  Compass,
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
  LegendSectionSize,
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
  onChangeMembers: (members: StructuralMemberDefinition[]) => void;
  onScanLayoutTags: (options?: { allowedLayers?: string[]; customPrefix?: string }) => void;
  onPickSpanOnDrawing: (memberId: string) => void;
  onHighlightMember: (mark: string) => void;
  onSelectMemberForInspection: (member: StructuralMemberDefinition | null) => void;
  onStartSelectLayoutBox: () => void;
  onClearLayoutBox: () => void;
  onChangeActiveLegendTableId: (tableId: string | null) => void;
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
  onChangeMembers,
  onScanLayoutTags,
  onPickSpanOnDrawing,
  onHighlightMember,
  onSelectMemberForInspection,
  onStartSelectLayoutBox,
  onClearLayoutBox,
  onChangeActiveLegendTableId,
  onProceedToStep3,
  activePickingMemberId,
}) => {
  // Extracted legend presets from schedule tables and drawing dimensions
  const legendSizes = useMemo(() => {
    return extractLegendSectionSizes(scheduleTables, cadTexts);
  }, [scheduleTables, cadTexts]);

  // Layer classification
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

  // Layer filter state
  const [isLayerFilterOpen, setIsLayerFilterOpen] = useState(false);
  const [selectedLayers, setSelectedLayers] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const lyr of availableLayers) {
      if (lyr.affinity !== 'exclude') set.add(lyr.name);
    }
    return set;
  });
  const [customPrefix, setCustomPrefix] = useState('');

  // Quick Add Member Form state
  const [newMark, setNewMark] = useState('');
  const [newWidth, setNewWidth] = useState(
    legendSizes[0]?.widthMm || (scope === 'beam' ? 230 : 300)
  );
  const [newDepth, setNewDepth] = useState(legendSizes[0]?.depthMm || 450);
  const [newSpan, setNewSpan] = useState(scope === 'column' ? 3000 : 4000);
  const [newFloor, setNewFloor] = useState('Ground Floor');

  // Batch actions state
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
  const [batchSizePreset, setBatchSizePreset] = useState<string>('');

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

    const item: StructuralMemberDefinition = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      mark: newMark.trim().toUpperCase(),
      category: scope,
      floorLevel: newFloor,
      countOnLayout: 1,
      widthMm: Number(newWidth) || 300,
      depthMm: Number(newDepth) || 450,
      spanMm: Number(newSpan) || 3000,
      clearCoverMm:
        scope === 'column' ? 40 : scope === 'beam' ? 25 : scope === 'footing' ? 50 : 20,
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

    const reducedDepth = scope === 'column' ? Math.max(200, m.depthMm - 100) : m.depthMm;

    const dup: StructuralMemberDefinition = {
      ...m,
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      floorLevel: nextFloor,
      depthMm: reducedDepth,
      notes: `Section reduced for ${nextFloor}`,
    };

    onChangeMembers([...members, dup]);
  };

  // Batch selection handlers
  const handleToggleSelectAll = () => {
    if (selectedMemberIds.size === members.length) {
      setSelectedMemberIds(new Set());
    } else {
      setSelectedMemberIds(new Set(members.map((m) => m.id)));
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
      members.map((m) => (selectedMemberIds.has(m.id) ? { ...m, widthMm: w, depthMm: d } : m))
    );
  };

  const handleDeleteSelected = () => {
    onChangeMembers(members.filter((m) => !selectedMemberIds.has(m.id)));
    setSelectedMemberIds(new Set());
  };

  // Find linked legend table object
  const activeLegend = scheduleTables.find((t) => t.id === activeLegendTableId);

  return (
    <div className="space-y-4">
      {/* Header Bar with Layout Box & Legend Source Controls */}
      <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <span>Step 2: Member Catalog & Geometry</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono uppercase">
                {scope}
              </span>
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Identify {scope} instances from framing layout with section sizes and spans
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsLayerFilterOpen(!isLayerFilterOpen)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition ${
                isLayerFilterOpen
                  ? 'bg-zinc-800 text-white border-zinc-700'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
              }`}
              title="Configure CAD layers and scanning filters"
            >
              <Filter className="w-3.5 h-3.5 text-blue-400" />
              <span>Layer Filters ({selectedLayers.size}/{availableLayers.length})</span>
              {isLayerFilterOpen ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>

            <button
              onClick={handleRunScan}
              className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"
              title="Scan text annotations on framing layout for member marks"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Scan Layout for {scope.toUpperCase()} Tags</span>
            </button>
          </div>
        </div>

        {/* Framing Window ROI & Linked Legend Table Bar */}
        <div className="pt-2 border-t border-zinc-850 flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Layout ROI Box Status / Trigger */}
          <div className="flex items-center gap-2">
            <span className="text-zinc-400 font-medium flex items-center gap-1">
              <Crop className="w-3.5 h-3.5 text-emerald-400" />
              <span>Framing Area:</span>
            </span>

            {layoutBoundingBox ? (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-800/80 text-emerald-300 font-mono text-[11px]">
                <span>
                  Window [{Math.round(layoutBoundingBox.min_x)}, {Math.round(layoutBoundingBox.min_y)}] to [
                  {Math.round(layoutBoundingBox.max_x)}, {Math.round(layoutBoundingBox.max_y)}]
                </span>
                <button
                  type="button"
                  onClick={onClearLayoutBox}
                  className="p-0.5 rounded hover:bg-emerald-800/60 text-emerald-400 hover:text-white transition"
                  title="Clear framing window and scan entire sheet"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <span className="text-zinc-500 text-[11px]">Entire Sheet (Unbounded)</span>
            )}

            <button
              type="button"
              onClick={onStartSelectLayoutBox}
              className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-700 hover:border-emerald-500 hover:text-emerald-300 text-zinc-300 text-[11px] font-medium flex items-center gap-1 transition"
              title="Click and drag a marquee box on the drawing around the framing plan only"
            >
              <Crop className="w-3 h-3 text-emerald-400" />
              <span>{layoutBoundingBox ? 'Re-select Area' : 'Select Layout Window'}</span>
            </button>
          </div>

          {/* Linked Legends Table for Auto b x D Sizing */}
          <div className="flex items-center gap-2">
            <span className="text-zinc-400 font-medium flex items-center gap-1">
              <TableIcon className="w-3.5 h-3.5 text-blue-400" />
              <span>Sizing Legend:</span>
            </span>

            {scheduleTables.length > 0 ? (
              <select
                value={activeLegendTableId || ''}
                onChange={(e) => onChangeActiveLegendTableId(e.target.value || null)}
                className="bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1 text-zinc-200 font-mono text-[11px]"
              >
                <option value="">Auto-Detect / Any Table</option>
                {scheduleTables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} ({t.rows.length} entries)
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-zinc-500 text-[11px]">No tables detected yet</span>
            )}
          </div>
        </div>

        {/* Collapsible Layer Filter & Prefix Drawer */}
        {isLayerFilterOpen && (
          <div className="mt-3 p-3 rounded-lg bg-zinc-900/90 border border-zinc-800 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-2">
              <div className="flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-zinc-400" />
                <span className="font-medium text-zinc-200">CAD Sheet Layer Affinity</span>
                <span className="text-[11px] text-zinc-500">
                  (Select layers containing structural marks; architectural layers excluded by default)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedLayers(new Set(availableLayers.map((l) => l.name)))}
                  className="text-[11px] text-blue-400 hover:underline"
                >
                  Select All
                </button>
                <span className="text-zinc-600">•</span>
                <button
                  type="button"
                  onClick={() => {
                    const rec = new Set<string>();
                    for (const l of availableLayers) {
                      if (l.affinity !== 'exclude') rec.add(l.name);
                    }
                    setSelectedLayers(rec);
                  }}
                  className="text-[11px] text-zinc-400 hover:underline"
                >
                  Reset Recommended
                </button>
              </div>
            </div>

            {/* Layer Pills */}
            <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
              {availableLayers.length === 0 ? (
                <span className="text-zinc-500">No layers detected on sheet</span>
              ) : (
                availableLayers.map((lyr) => {
                  const isChecked = selectedLayers.has(lyr.name);
                  const isHigh = lyr.affinity === 'high';
                  const isExcl = lyr.affinity === 'exclude';

                  return (
                    <button
                      key={lyr.name}
                      type="button"
                      onClick={() => toggleLayer(lyr.name)}
                      className={`px-2 py-1 rounded-md border text-[11px] flex items-center gap-1.5 transition ${
                        isChecked
                          ? isHigh
                            ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-200'
                            : 'bg-zinc-800 border-zinc-700 text-zinc-200'
                          : isExcl
                          ? 'bg-zinc-950/60 border-zinc-900 text-zinc-600 line-through'
                          : 'bg-zinc-950/60 border-zinc-800 text-zinc-500'
                      }`}
                    >
                      <span className="font-mono">{lyr.name}</span>
                      <span className="text-[10px] opacity-60">({lyr.textCount})</span>
                      {isHigh && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                    </button>
                  );
                })
              )}
            </div>

            {/* Custom Prefix Filter */}
            <div className="flex items-center gap-2 pt-1 border-t border-zinc-800/60">
              <span className="text-zinc-400 text-[11px]">Custom Tag Prefix (optional):</span>
              <input
                type="text"
                value={customPrefix}
                onChange={(e) => setCustomPrefix(e.target.value)}
                placeholder={
                  scope === 'beam'
                    ? 'e.g. B, PB, 1B'
                    : scope === 'column'
                    ? 'e.g. C, SC'
                    : 'e.g. S, NS'
                }
                className="w-32 bg-zinc-950 border border-zinc-700 rounded px-2 py-0.5 text-white font-mono text-xs uppercase"
              />
              <span className="text-[10px] text-zinc-500">
                Supports complex tags (e.g. B1-1, B2-5, NS1) with non-greedy token isolation.
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Quick Add Member Form */}
      <form
        onSubmit={handleAddMember}
        className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex flex-wrap items-center gap-3 text-xs"
      >
        <div className="flex items-center gap-1.5 min-w-[120px]">
          <span className="text-zinc-400 font-medium">Mark:</span>
          <input
            type="text"
            required
            value={newMark}
            onChange={(e) => setNewMark(e.target.value)}
            placeholder={scope === 'beam' ? 'e.g. B1' : scope === 'column' ? 'e.g. C1' : 'e.g. F1'}
            className="w-24 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-white font-mono uppercase"
          />
        </div>

        {/* Section Size Inputs */}
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-400 font-medium">Size (b×D):</span>
          <input
            type="number"
            value={newWidth}
            onChange={(e) => setNewWidth(Number(e.target.value))}
            className="w-16 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-white font-mono text-center"
          />
          <span className="text-zinc-500">×</span>
          <input
            type="number"
            value={newDepth}
            onChange={(e) => setNewDepth(Number(e.target.value))}
            className="w-16 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-white font-mono text-center"
          />
          <span className="text-zinc-500">mm</span>
        </div>

        {/* Legend Size Presets Dropdown */}
        {legendSizes.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-zinc-500 text-[11px]">Legend:</span>
            <select
              onChange={(e) => {
                if (!e.target.value) return;
                const [w, d] = e.target.value.split('x').map(Number);
                if (w && d) {
                  setNewWidth(w);
                  setNewDepth(d);
                }
              }}
              value=""
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-zinc-300 font-mono text-xs"
            >
              <option value="">Preset Sizes...</option>
              {legendSizes.map((s) => (
                <option key={`${s.widthMm}x${s.depthMm}`} value={`${s.widthMm}x${s.depthMm}`}>
                  {s.label} mm
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <span className="text-zinc-400 font-medium">
            {scope === 'column' ? 'Floor Ht:' : 'Span:'}
          </span>
          <input
            type="number"
            value={newSpan}
            onChange={(e) => setNewSpan(Number(e.target.value))}
            className="w-20 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-white font-mono text-center"
          />
          <span className="text-zinc-500">mm</span>
        </div>

        {scope === 'column' && (
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-400 font-medium">Level:</span>
            <input
              type="text"
              value={newFloor}
              onChange={(e) => setNewFloor(e.target.value)}
              className="w-28 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-white font-mono"
            />
          </div>
        )}

        <button
          type="submit"
          className="ml-auto px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold flex items-center gap-1 transition"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Member</span>
        </button>
      </form>

      {/* Batch Actions Toolbar (Shown when rows selected) */}
      {selectedMemberIds.size > 0 && (
        <div className="bg-blue-950/40 border border-blue-800/60 rounded-xl p-2.5 flex flex-wrap items-center justify-between gap-3 text-xs animate-in fade-in">
          <div className="flex items-center gap-2 text-blue-200">
            <CheckSquare className="w-4 h-4 text-blue-400" />
            <span className="font-semibold">{selectedMemberIds.size} members selected</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {legendSizes.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-zinc-300">Assign Section:</span>
                <select
                  value={batchSizePreset}
                  onChange={(e) => setBatchSizePreset(e.target.value)}
                  className="bg-zinc-950 border border-blue-700/60 rounded-lg px-2 py-1 text-white font-mono text-xs"
                >
                  <option value="">Select Size...</option>
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
                  className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-medium transition"
                >
                  Apply
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handleDeleteSelected}
              className="px-2.5 py-1 rounded bg-rose-950/60 border border-rose-800/60 hover:bg-rose-900/60 text-rose-300 transition flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              <span>Delete</span>
            </button>
          </div>
        </div>
      )}

      {/* Members Catalog Table */}
      <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950 shadow-sm">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-zinc-900 border-b border-zinc-800 text-zinc-400 text-left">
              <th className="p-2.5 w-8 text-center">
                <button
                  type="button"
                  onClick={handleToggleSelectAll}
                  className="text-zinc-400 hover:text-white"
                  title="Select all members"
                >
                  {members.length > 0 && selectedMemberIds.size === members.length ? (
                    <CheckSquare className="w-4 h-4 text-blue-400" />
                  ) : (
                    <Square className="w-4 h-4 text-zinc-600" />
                  )}
                </button>
              </th>
              <th className="p-2.5">Member Mark</th>
              <th className="p-2.5">Floor Level</th>
              <th className="p-2.5 text-center">Count on Layout</th>
              <th className="p-2.5 text-center">Section (b × D mm)</th>
              <th className="p-2.5 text-center">{scope === 'column' ? 'Height' : 'Clear Span'}</th>
              <th className="p-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-850">
            {members.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-zinc-500">
                  <div className="flex flex-col items-center gap-2">
                    <Tag className="w-6 h-6 text-zinc-600" />
                    <p>No {scope} members cataloged yet.</p>
                    <p className="text-[11px] text-zinc-600">
                      Click "Select Layout Window" to focus the framing area, then "Scan Layout for {scope.toUpperCase()} Tags".
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              members.map((m) => {
                const isPickingThis = activePickingMemberId === m.id;
                const isInspected = inspectedMemberId === m.id;
                const isSelected = selectedMemberIds.has(m.id);
                const currentSizeKey = `${m.widthMm}x${m.depthMm}`;

                return (
                  <tr
                    key={m.id}
                    onClick={() => onSelectMemberForInspection(m)}
                    className={`cursor-pointer transition ${
                      isInspected
                        ? 'bg-amber-950/20 border-l-2 border-l-amber-500'
                        : isSelected
                        ? 'bg-blue-950/20'
                        : 'hover:bg-zinc-900/50'
                    }`}
                  >
                    <td
                      className="p-2.5 text-center"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleSelectMember(m.id);
                      }}
                    >
                      <button type="button" className="text-zinc-400 hover:text-white">
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-blue-400" />
                        ) : (
                          <Square className="w-4 h-4 text-zinc-700" />
                        )}
                      </button>
                    </td>

                    <td className="p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white font-mono text-sm">{m.mark}</span>

                        {/* Verification & Layer Badges */}
                        {m.isVerifiedInLegend ? (
                          <span
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-800 text-[10px] text-emerald-400 font-medium"
                            title="Verified in Schedule Table"
                          >
                            <ShieldCheck className="w-3 h-3" />
                            <span>Verified</span>
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-400 font-medium"
                            title="Discovered on Layout Plan"
                          >
                            <span>Layout</span>
                          </span>
                        )}

                        {m.layerName && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-900 text-zinc-500 font-mono">
                            {m.layerName}
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onHighlightMember(m.mark);
                          }}
                          className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-blue-400 transition"
                          title="Highlight on CAD Layout"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>

                    <td className="p-2.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={m.floorLevel || 'All Floors'}
                        onChange={(e) => handleUpdateMember(m.id, { floorLevel: e.target.value })}
                        className="w-28 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-200 font-mono text-xs"
                      />
                    </td>

                    <td className="p-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="number"
                        min="1"
                        value={m.countOnLayout}
                        onChange={(e) =>
                          handleUpdateMember(m.id, {
                            countOnLayout: Math.max(1, Number(e.target.value)),
                          })
                        }
                        className="w-16 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-center font-mono font-bold text-blue-400"
                      />
                    </td>

                    <td className="p-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center gap-1">
                        <input
                          type="number"
                          value={m.widthMm}
                          onChange={(e) =>
                            handleUpdateMember(m.id, { widthMm: Number(e.target.value) })
                          }
                          className="w-14 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1 text-center font-mono text-zinc-200"
                        />
                        <span className="text-zinc-500">×</span>
                        <input
                          type="number"
                          value={m.depthMm}
                          onChange={(e) =>
                            handleUpdateMember(m.id, { depthMm: Number(e.target.value) })
                          }
                          className="w-14 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1 text-center font-mono text-zinc-200"
                        />

                        {/* Direct Section Size selector from Legends Table */}
                        {legendSizes.length > 0 && (
                          <select
                            value={
                              legendSizes.some(
                                (s) => `${s.widthMm}x${s.depthMm}` === currentSizeKey
                              )
                                ? currentSizeKey
                                : ''
                            }
                            onChange={(e) => {
                              if (!e.target.value) return;
                              const [w, d] = e.target.value.split('x').map(Number);
                              if (w && d) handleUpdateMember(m.id, { widthMm: w, depthMm: d });
                            }}
                            className="ml-1 bg-zinc-900 border border-zinc-800 rounded px-1 py-1 text-[11px] text-zinc-400 font-mono"
                            title="Select cross-section from Legend Table"
                          >
                            <option value="">Preset</option>
                            {legendSizes.map((s) => (
                              <option
                                key={`${s.widthMm}x${s.depthMm}`}
                                value={`${s.widthMm}x${s.depthMm}`}
                              >
                                {s.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </td>

                    <td className="p-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center gap-1.5">
                        <input
                          type="number"
                          value={m.spanMm}
                          onChange={(e) =>
                            handleUpdateMember(m.id, { spanMm: Number(e.target.value) })
                          }
                          className="w-20 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-center font-mono text-zinc-200"
                        />

                        {/* Geometric Span Detection Source Badge */}
                        {m.detectedGeometry?.sourceConfidence === 'high' ? (
                          <span
                            className="px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-800 text-[9px] text-emerald-400 font-medium"
                            title={m.detectedGeometry.notes || 'Span computed from CAD supports'}
                          >
                            CAD
                          </span>
                        ) : m.detectedGeometry?.sourceConfidence === 'approximate' ? (
                          <span
                            className="px-1.5 py-0.5 rounded bg-amber-950/80 border border-amber-800 text-[9px] text-amber-400 font-medium"
                            title={m.detectedGeometry.notes || 'Approximate CAD span'}
                          >
                            Approx
                          </span>
                        ) : null}

                        <button
                          type="button"
                          onClick={() => onPickSpanOnDrawing(m.id)}
                          className={`p-1.5 rounded-lg border transition ${
                            isPickingThis
                              ? 'bg-amber-500 text-zinc-950 font-bold border-amber-400'
                              : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-white'
                          }`}
                          title="Pick span directly from CAD drawing"
                        >
                          <Ruler className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>

                    <td className="p-2.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {scope === 'column' && (
                          <button
                            type="button"
                            onClick={() => handleDuplicateForUpperFloor(m)}
                            className="px-2 py-1 rounded bg-zinc-850 hover:bg-zinc-800 text-[11px] text-zinc-300 hover:text-white transition flex items-center gap-1"
                            title="Add upper floor level with reduced column size"
                          >
                            <Plus className="w-3 h-3 text-blue-400" />
                            <span>Upper Floor</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteMember(m.id)}
                          className="p-1 rounded text-zinc-500 hover:text-rose-400 transition"
                          title="Delete member"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
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

      {/* Next Step Action */}
      <div className="flex items-center justify-between pt-2">
        <span className="text-xs text-zinc-400 font-mono">
          {members.length} {scope} member marks cataloged
        </span>
        <button
          onClick={onProceedToStep3}
          disabled={members.length === 0}
          className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-2 shadow-lg transition"
        >
          <span>Proceed to Step 3: Reinforcement Specs</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
