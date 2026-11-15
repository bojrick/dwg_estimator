import React, { useState } from 'react';
import {
  X,
  Table as TableIcon,
  Download,
  Check,
  ArrowRight,
  Tag,
  Plus,
  Trash2,
  Copy,
  ArrowUp,
  ArrowDown,
  Settings2,
  Sliders,
  Save,
  Share2,
} from 'lucide-react';
import { ExtractedCadTable, BbsBarItem, StructuralMemberType } from './types';
import { convertScheduleTableToBbsItems, standardizeScheduleHeaders } from './cadTableParser';

interface ScheduleTableModalProps {
  table: ExtractedCadTable;
  onClose: () => void;
  onImportToBbs: (items: BbsBarItem[], updatedTable: ExtractedCadTable) => void;
  onSaveTable?: (updatedTable: ExtractedCadTable) => void;
  onShareToProject?: (table: ExtractedCadTable) => void;
}

const CATEGORY_ROLE_OPTIONS: Record<string, string[]> = {
  beam: [
    'Member ID',
    'Section Size (WxD)',
    'Bottom Main Bars',
    'Bottom Curtail / Extra',
    'Top Continuous / Anchor',
    'Top Support Extra (L/3)',
    'Stirrups Support Zone',
    'Stirrups Mid Zone',
    'Stirrup Legs',
    'Remarks / Notes',
    'Ignore / Custom',
  ],
  column: [
    'Member ID',
    'Floor Level',
    'Section Size (WxD)',
    'Vertical Bars',
    'Lateral Ties',
    'Tie Arrangement / Legs',
    'Lap Length',
    'Remarks / Notes',
    'Ignore / Custom',
  ],
  footing: [
    'Member ID',
    'Dimensions (LxWxD)',
    'Bottom Mesh X-dir',
    'Bottom Mesh Y-dir',
    'Top Mesh',
    'Pedestal Rebar',
    'Remarks / Notes',
    'Ignore / Custom',
  ],
  slab: [
    'Member ID',
    'Thickness',
    'Bottom Main (Short Span)',
    'Bottom Distribution (Long Span)',
    'Top Support Extra',
    'Remarks / Notes',
    'Ignore / Custom',
  ],
  staircase: ['Member ID', 'Waist Slab Thk', 'Main Waist Rebar', 'Distribution Rebar', 'Remarks / Notes', 'Ignore / Custom'],
  wall: ['Member ID', 'Wall Thickness', 'Vertical Rebar', 'Horizontal Rebar', 'Remarks / Notes', 'Ignore / Custom'],
  door_window: [
    'Tag / Mark',
    'Width (mm)',
    'Height (mm)',
    'Sill Height',
    'Lintel Level',
    'Type / Shutter',
    'Material / Glazing',
    'Location',
    'Remarks',
  ],
  room_finish: [
    'Room / Area',
    'Floor Finish',
    'Skirting',
    'Wall Finish',
    'Ceiling Finish',
    'Remarks',
  ],
  electrical: [
    'Circuit ID',
    'Connected Load',
    'Breaker Rating',
    'Phase',
    'Wire Gauge',
    'Conduit Size',
    'Remarks',
  ],
  general: [
    'Item ID',
    'Description',
    'Quantity',
    'Unit',
    'Dimensions',
    'Specification',
    'Remarks',
  ],
  other: ['Member ID', 'Section Size (WxD)', 'Main Reinforcement', 'Secondary Rebar', 'Stirrups / Ties', 'Remarks / Notes', 'Ignore / Custom'],
};

export const ScheduleTableModal: React.FC<ScheduleTableModalProps> = ({
  table: initialTable,
  onClose,
  onImportToBbs,
  onSaveTable,
  onShareToProject,
}) => {
  const [table, setTable] = useState<ExtractedCadTable>(initialTable);
  const [memberType, setMemberType] = useState<string>(
    String(initialTable.detectedType || 'column')
  );

  // Civil BBS Parameters
  const [clearCoverMm, setClearCoverMm] = useState<number>(() => {
    const dt = String(initialTable.detectedType || 'column');
    return dt === 'column'
      ? 40
      : dt === 'beam'
        ? 25
        : dt === 'footing'
          ? 50
          : 20;
  });
  const [floorHeightM, setFloorHeightM] = useState<number>(3.0);
  const [beamSpanM, setBeamSpanM] = useState<number>(4.0);
  const [devLengthMultiplier, setDevLengthMultiplier] = useState<number>(50); // 50d
  const [topCurtailmentFraction, setTopCurtailmentFraction] = useState<number>(0.25); // 0.25L
  const [isParamsOpen, setIsParamsOpen] = useState(false);

  // Table cell and header edits
  const handleCellChange = (rowIndex: number, colIndex: number, value: string) => {
    setTable((prev) => {
      const newRows = prev.rows.map((r, rIdx) => {
        if (rIdx !== rowIndex) return r;
        const newCells = [...r];
        newCells[colIndex] = value;
        return newCells;
      });
      return { ...prev, rows: newRows };
    });
  };

  const handleHeaderChange = (colIndex: number, value: string) => {
    setTable((prev) => {
      const newHeaders = [...prev.headers];
      newHeaders[colIndex] = value;
      return { ...prev, headers: newHeaders };
    });
  };

  // Row Manipulation
  const handleAddRow = () => {
    const emptyRow = new Array(table.headers.length).fill('');
    emptyRow[0] = `${memberType === 'beam' ? 'B' : memberType === 'column' ? 'C' : 'M'}-${table.rows.length + 1}`;
    setTable((prev) => ({
      ...prev,
      rows: [...prev.rows, emptyRow],
    }));
  };

  const handleDuplicateRow = (rowIndex: number) => {
    const target = table.rows[rowIndex];
    if (!target) return;
    const dup = [...target];
    dup[0] = `${dup[0] || 'M'}-copy`;
    const newRows = [...table.rows];
    newRows.splice(rowIndex + 1, 0, dup);
    setTable((prev) => ({ ...prev, rows: newRows }));
  };

  const handleDeleteRow = (rowIndex: number) => {
    setTable((prev) => ({
      ...prev,
      rows: prev.rows.filter((_, idx) => idx !== rowIndex),
    }));
  };

  const handleMoveRow = (rowIndex: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? rowIndex - 1 : rowIndex + 1;
    if (targetIdx < 0 || targetIdx >= table.rows.length) return;
    const newRows = [...table.rows];
    const temp = newRows[rowIndex];
    newRows[rowIndex] = newRows[targetIdx];
    newRows[targetIdx] = temp;
    setTable((prev) => ({ ...prev, rows: newRows }));
  };

  // Column Manipulation
  const handleAddColumn = () => {
    const newColName = `Column ${table.headers.length + 1}`;
    setTable((prev) => ({
      ...prev,
      headers: [...prev.headers, newColName],
      rows: prev.rows.map((r) => [...r, '']),
    }));
  };

  const handleDeleteColumn = (colIndex: number) => {
    if (table.headers.length <= 1) return;
    setTable((prev) => ({
      ...prev,
      headers: prev.headers.filter((_, idx) => idx !== colIndex),
      rows: prev.rows.map((r) => r.filter((_, idx) => idx !== colIndex)),
    }));
  };

  const handleExportCsv = () => {
    const csvRows = [
      table.headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(','),
      ...table.rows.map((r) => r.map((c) => `"${(c || '').replace(/"/g, '""')}"`).join(',')),
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${table.title.toLowerCase().replace(/\s+/g, '_')}_schedule.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveOnly = () => {
    if (onSaveTable) {
      onSaveTable({ ...table, detectedType: memberType as any });
    }
  };

  const handleConvert = () => {
    const items = convertScheduleTableToBbsItems(
      { ...table, detectedType: memberType as any },
      {
        clearCoverMm,
        defaultFloorHeightM: floorHeightM,
        defaultBeamSpanM: beamSpanM,
      }
    );
    onImportToBbs(items, { ...table, detectedType: memberType as any });
    onClose();
  };

  const availableRoles = CATEGORY_ROLE_OPTIONS[memberType] || CATEGORY_ROLE_OPTIONS.other;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-black/80">
      <div className="w-full h-full sm:h-auto max-w-6xl sm:max-h-[94vh] bg-zinc-900 border-0 sm:border border-zinc-800 rounded-none sm:rounded-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 pt-[max(10px,env(safe-area-inset-top))] sm:pt-4 sm:px-6 sm:py-4 border-b border-zinc-800 bg-zinc-950 shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="p-2 sm:p-2.5 rounded-xl bg-amber-400/10 text-amber-400 border border-amber-400/25 shrink-0">
              <TableIcon className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={table.title}
                  onChange={(e) => setTable((prev) => ({ ...prev, title: e.target.value }))}
                  className="min-w-0 max-w-full text-sm font-medium text-zinc-100 bg-transparent border-b border-dashed border-zinc-700 hover:border-amber-400 focus:border-amber-400 outline-none px-1"
                  title="Click to rename schedule table title"
                />
                <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono shrink-0">
                  Exact Vector Table
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5 truncate">
                {table.rows.length} rows · {table.headers.length} columns · Editable Civil Engineering Schedule
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={handleAddRow}
              className="min-h-[34px] sm:min-h-0 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex items-center gap-1 transition"
              title="Add a new row to schedule"
            >
              <Plus className="w-3.5 h-3.5 text-amber-400" />
              <span>Row</span>
            </button>
            <button
              type="button"
              onClick={handleAddColumn}
              className="min-h-[34px] sm:min-h-0 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex items-center gap-1 transition"
              title="Add a new column to schedule"
            >
              <Plus className="w-3.5 h-3.5 text-amber-400" />
              <span>Column</span>
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="min-h-[34px] sm:min-h-0 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex items-center gap-1 transition"
              title="Download raw table CSV"
            >
              <Download className="w-3.5 h-3.5 text-zinc-400" />
              <span>CSV</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="min-h-[34px] min-w-[34px] sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition sm:ml-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Conversion & Structural Parameter Controls */}
        <div className="bg-zinc-900/90 px-3.5 py-2.5 sm:px-6 sm:py-3 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 text-xs shrink-0">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-400 font-medium">Table Role:</span>
              <select
                value={memberType}
                onChange={(e) => {
                  const nextType = e.target.value as any;
                  setMemberType(nextType);
                  setClearCoverMm(
                    nextType === 'column' ? 40 : nextType === 'beam' ? 25 : nextType === 'footing' ? 50 : 20
                  );
                }}
                className="min-h-[34px] sm:min-h-0 bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-zinc-200 font-medium"
              >
                <optgroup label="Structural Schedules">
                  <option value="column">Column Schedule</option>
                  <option value="beam">Beam Schedule</option>
                  <option value="footing">Footing Schedule</option>
                  <option value="slab">Slab Schedule</option>
                </optgroup>
                <optgroup label="Architectural Schedules">
                  <option value="door_window">Door & Window Schedule</option>
                  <option value="room_finish">Room Finish Schedule</option>
                </optgroup>
                <optgroup label="MEP & General">
                  <option value="electrical">Electrical Schedule</option>
                  <option value="general">General Bill of Quantities</option>
                  <option value="other">General CAD Table</option>
                </optgroup>
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-zinc-400">Cover:</span>
              <input
                type="number"
                value={clearCoverMm}
                onChange={(e) => setClearCoverMm(Number(e.target.value))}
                className="w-16 min-h-[34px] sm:min-h-0 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-zinc-200 font-mono text-center"
              />
              <span className="text-zinc-500">mm</span>
            </div>

            {memberType === 'column' && (
              <div className="flex items-center gap-1.5">
                <span className="text-zinc-400">Floor Ht:</span>
                <input
                  type="number"
                  step="0.1"
                  value={floorHeightM}
                  onChange={(e) => setFloorHeightM(Number(e.target.value))}
                  className="w-16 min-h-[34px] sm:min-h-0 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-zinc-200 font-mono text-center"
                />
                <span className="text-zinc-500">m</span>
              </div>
            )}

            {memberType === 'beam' && (
              <div className="flex items-center gap-1.5">
                <span className="text-zinc-400">Avg Span:</span>
                <input
                  type="number"
                  step="0.1"
                  value={beamSpanM}
                  onChange={(e) => setBeamSpanM(Number(e.target.value))}
                  className="w-16 min-h-[34px] sm:min-h-0 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-zinc-200 font-mono text-center"
                />
                <span className="text-zinc-500">m</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => setIsParamsOpen(!isParamsOpen)}
              className={`min-h-[34px] sm:min-h-0 px-2.5 py-1 rounded-lg border text-xs font-medium flex items-center gap-1 transition ${isParamsOpen
                  ? 'bg-zinc-800 text-zinc-100 border-zinc-700'
                  : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                }`}
            >
              <Settings2 className="w-3.5 h-3.5 text-amber-400" />
              <span>BBS Detail Specs</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {onShareToProject && (
              <button
                type="button"
                onClick={() => onShareToProject({ ...table, detectedType: memberType as any })}
                className="min-h-[36px] sm:min-h-0 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-amber-300 text-xs font-medium flex items-center gap-1 transition"
                title="Share this schedule table with all plans in the project"
              >
                <Share2 className="w-3.5 h-3.5 text-amber-400" />
                <span>Share with Project</span>
              </button>
            )}

            {onSaveTable && (
              <button
                type="button"
                onClick={handleSaveOnly}
                className="min-h-[36px] sm:min-h-0 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs font-medium flex items-center gap-1 transition"
                title="Save table edits without generating BBS"
              >
                <Save className="w-3.5 h-3.5 text-zinc-400" />
                <span>Save Edits</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleConvert}
              className="min-h-[36px] sm:min-h-0 px-3.5 sm:px-4 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-medium flex items-center gap-1.5 transition"
            >
              <span>Generate BBS Line Items</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Civil BBS Parameters Drawer */}
        {isParamsOpen && (
          <div className="bg-zinc-950 px-3.5 sm:px-6 py-3 border-b border-zinc-800 grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 text-xs shrink-0">
            <div>
              <span className="text-zinc-400 block mb-1">Development Length (Ld):</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={devLengthMultiplier}
                  onChange={(e) => setDevLengthMultiplier(Number(e.target.value))}
                  className="w-16 min-h-[34px] sm:min-h-0 bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5 text-white font-mono text-center"
                />
                <span className="text-zinc-500">× dia (50d)</span>
              </div>
            </div>

            <div>
              <span className="text-zinc-400 block mb-1">Top Extra Curtailment:</span>
              <select
                value={topCurtailmentFraction}
                onChange={(e) => setTopCurtailmentFraction(Number(e.target.value))}
                className="w-full min-h-[34px] sm:min-h-0 bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5 text-white font-mono"
              >
                <option value={0.25}>L / 4 (0.25L)</option>
                <option value={0.333}>L / 3 (0.33L)</option>
                <option value={0.3}>0.30L</option>
              </select>
            </div>

            <div>
              <span className="text-zinc-400 block mb-1">Bend Deductions:</span>
              <span className="text-zinc-300 font-mono text-[11px]">
                90° = 2d · 45° = 1d · 135° = 3d
              </span>
            </div>

            <div>
              <span className="text-zinc-400 block mb-1">Standard Hooks:</span>
              <span className="text-zinc-300 font-mono text-[11px]">
                Stirrups: 135° (10d hook)
              </span>
            </div>
          </div>
        )}

        {/* Table View / Editor */}
        <div className="flex-1 min-h-0 overflow-auto p-2.5 sm:p-4">
          <div className="border border-zinc-800 rounded-xl overflow-x-auto bg-zinc-950 max-w-full">
            <table className="w-full min-w-max border-collapse text-xs">
              <thead>
                <tr className="bg-zinc-900 border-b border-zinc-800 text-zinc-400">
                  <th className="p-2 text-center font-mono w-16 text-zinc-500">Row</th>
                  {table.headers.map((h, colIdx) => (
                    <th key={colIdx} className="p-2 text-left font-medium min-w-[150px]">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-1">
                          <select
                            value={availableRoles.includes(h) ? h : 'Ignore / Custom'}
                            onChange={(e) => {
                              if (e.target.value !== 'Ignore / Custom') {
                                handleHeaderChange(colIdx, e.target.value);
                              }
                            }}
                            className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-[10px] text-amber-400 font-mono outline-none flex-1 truncate"
                          >
                            {availableRoles.map((opt) => (
                              <option key={opt} value={opt}>
                                Role: {opt}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => handleDeleteColumn(colIdx)}
                            className="p-0.5 rounded text-zinc-500 hover:text-rose-400 transition"
                            title="Delete column"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                        <input
                          type="text"
                          value={h}
                          onChange={(e) => handleHeaderChange(colIdx, e.target.value)}
                          className="w-full bg-transparent border-b border-dashed border-zinc-700 focus:border-amber-400 outline-none text-zinc-100 font-medium px-1 py-0.5"
                          placeholder="Header Name"
                        />
                      </div>
                    </th>
                  ))}
                  <th className="p-2 text-center w-20 text-zinc-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                {table.rows.map((row, rowIdx) => (
                  <tr key={rowIdx} className="hover:bg-zinc-900/60 transition group">
                    <td className="p-2 text-center font-mono text-zinc-500 select-none">
                      {rowIdx + 1}
                    </td>
                    {row.map((cell, colIdx) => (
                      <td key={colIdx} className="p-1.5">
                        <input
                          type="text"
                          value={cell || ''}
                          onChange={(e) => handleCellChange(rowIdx, colIdx, e.target.value)}
                          className="w-full min-h-[32px] sm:min-h-0 bg-transparent rounded px-2 py-1 text-zinc-100 hover:bg-zinc-900 focus:bg-zinc-800 focus:ring-1 focus:ring-amber-400 outline-none font-mono text-xs"
                        />
                      </td>
                    ))}
                    <td className="p-1.5 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1 opacity-75 sm:opacity-60 group-hover:opacity-100 transition">
                        <button
                          type="button"
                          onClick={() => handleMoveRow(rowIdx, 'up')}
                          disabled={rowIdx === 0}
                          className="p-1 rounded text-zinc-400 hover:text-white disabled:opacity-20"
                          title="Move row up"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveRow(rowIdx, 'down')}
                          disabled={rowIdx === table.rows.length - 1}
                          className="p-1 rounded text-zinc-400 hover:text-white disabled:opacity-20"
                          title="Move row down"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDuplicateRow(rowIdx)}
                          className="p-1 rounded text-zinc-400 hover:text-amber-400"
                          title="Duplicate row"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRow(rowIdx)}
                          className="p-1 rounded text-zinc-400 hover:text-rose-400"
                          title="Delete row"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="px-3.5 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))] sm:px-6 sm:py-3 border-t border-zinc-800 bg-zinc-950 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Tag className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <span className="truncate">Click any cell to edit. Rebar callouts (e.g. 3-T16, 8@150) are parsed automatically.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[36px] sm:min-h-0 px-4 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium shrink-0"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
