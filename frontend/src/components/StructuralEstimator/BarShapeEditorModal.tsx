import React, { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import { BarShapeCode, BbsBarItem, StructuralMemberType } from './types';
import { STANDARD_DIAMETERS, calculateCuttingLengthM, recalculateBarItem } from './bbsMath';

interface BarShapeEditorModalProps {
  item?: Partial<BbsBarItem>;
  availableSheets?: { id: string; name: string }[];
  currentSheetId?: string;
  onSave: (item: BbsBarItem) => void;
  onClose: () => void;
}

const SHAPES: { code: BarShapeCode; label: string; desc: string }[] = [
  { code: 'straight', label: 'Straight (00)', desc: 'Straight bar L = A' },
  { code: 'l_bend', label: 'L-Bend (11)', desc: '90° hook L = A + B - 2d' },
  { code: 'u_hook', label: 'U-Hook (21)', desc: 'Double bend L = A + B + C - 4d' },
  { code: 'crank', label: 'Cranked (41)', desc: 'Bent-up bar L = A + B + C + 0.42D - 2d' },
  { code: 'stirrup_rect', label: 'Stirrup / Tie (51)', desc: 'Rectangular link L = 2(A+B) + 20d' },
  { code: 'chair', label: 'Chair Bar', desc: 'Support stool L = 2A + 2B + C' },
];

export const BarShapeEditorModal: React.FC<BarShapeEditorModalProps> = ({
  item: initialItem,
  availableSheets = [],
  currentSheetId,
  onSave,
  onClose,
}) => {
  const [memberId, setMemberId] = useState(initialItem?.memberId || 'C1');
  const [memberType, setMemberType] = useState<StructuralMemberType>(
    initialItem?.memberType || 'column'
  );
  const [mark, setMark] = useState(initialItem?.mark || 'Main Longitudinal');
  const [diameter, setDiameter] = useState<number>(initialItem?.diameter || 16);
  const [shape, setShape] = useState<BarShapeCode>(initialItem?.shape || 'l_bend');

  const [dimA, setDimA] = useState<number>(initialItem?.dimA || 3000);
  const [dimB, setDimB] = useState<number>(initialItem?.dimB || 300);
  const [dimC, setDimC] = useState<number>(initialItem?.dimC || 0);
  const [dimD, setDimD] = useState<number>(initialItem?.dimD || 0);

  const [numMembers, setNumMembers] = useState<number>(initialItem?.numMembers || 1);
  const [barsPerMember, setBarsPerMember] = useState<number>(initialItem?.barsPerMember || 4);
  const [notes, setNotes] = useState(initialItem?.notes || '');

  const [cuttingLengthM, setCuttingLengthM] = useState<number>(0);

  useEffect(() => {
    const cl = calculateCuttingLengthM(shape, diameter, dimA, dimB, dimC, dimD);
    setCuttingLengthM(cl);
  }, [shape, diameter, dimA, dimB, dimC, dimD]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalItem = recalculateBarItem({
      id: initialItem?.id,
      memberId,
      memberType,
      mark,
      diameter,
      shape,
      dimA,
      dimB,
      dimC,
      dimD,
      numMembers,
      barsPerMember,
      notes,
      sourceSheetId: initialItem?.sourceSheetId || currentSheetId,
    });
    onSave(finalItem);
    onClose();
  };

  const renderShapeSvg = () => {
    switch (shape) {
      case 'straight':
        return (
          <svg className="w-full h-32" viewBox="0 0 200 80">
            <line x1="20" y1="40" x2="180" y2="40" stroke="#3b82f6" strokeWidth="4" strokeLinecap="round" />
            <text x="100" y="30" fill="#93c5fd" fontSize="12" textAnchor="middle" fontFamily="monospace">
              A = {dimA}mm
            </text>
          </svg>
        );

      case 'l_bend':
        return (
          <svg className="w-full h-32" viewBox="0 0 200 80">
            <polyline
              points="30,20 30,55 170,55"
              fill="none"
              stroke="#3b82f6"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <text x="18" y="38" fill="#93c5fd" fontSize="11" textAnchor="end" fontFamily="monospace">
              B={dimB}
            </text>
            <text x="100" y="70" fill="#93c5fd" fontSize="11" textAnchor="middle" fontFamily="monospace">
              A={dimA}
            </text>
          </svg>
        );

      case 'u_hook':
        return (
          <svg className="w-full h-32" viewBox="0 0 200 80">
            <polyline
              points="30,25 30,55 170,55 170,25"
              fill="none"
              stroke="#3b82f6"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <text x="20" y="42" fill="#93c5fd" fontSize="10" textAnchor="end" fontFamily="monospace">
              B={dimB}
            </text>
            <text x="100" y="70" fill="#93c5fd" fontSize="11" textAnchor="middle" fontFamily="monospace">
              A={dimA}
            </text>
            <text x="180" y="42" fill="#93c5fd" fontSize="10" textAnchor="start" fontFamily="monospace">
              C={dimC}
            </text>
          </svg>
        );

      case 'crank':
        return (
          <svg className="w-full h-32" viewBox="0 0 200 80">
            <polyline
              points="20,55 60,55 95,25 140,25 175,55"
              fill="none"
              stroke="#3b82f6"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <text x="40" y="70" fill="#93c5fd" fontSize="10" textAnchor="middle" fontFamily="monospace">
              A={dimA}
            </text>
            <text x="117" y="18" fill="#93c5fd" fontSize="10" textAnchor="middle" fontFamily="monospace">
              B={dimB}
            </text>
            <text x="157" y="70" fill="#93c5fd" fontSize="10" textAnchor="middle" fontFamily="monospace">
              C={dimC}
            </text>
            <text x="98" y="45" fill="#f59e0b" fontSize="10" textAnchor="start" fontFamily="monospace">
              D={dimD}
            </text>
          </svg>
        );

      case 'stirrup_rect':
        return (
          <svg className="w-full h-32" viewBox="0 0 200 80">
            <rect
              x="50"
              y="18"
              width="100"
              height="44"
              rx="6"
              fill="none"
              stroke="#3b82f6"
              strokeWidth="4"
            />
            <line x1="140" y1="18" x2="160" y2="30" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />
            <line x1="145" y1="22" x2="160" y2="10" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />
            <text x="100" y="14" fill="#93c5fd" fontSize="11" textAnchor="middle" fontFamily="monospace">
              A={dimA}
            </text>
            <text x="40" y="44" fill="#93c5fd" fontSize="11" textAnchor="end" fontFamily="monospace">
              B={dimB}
            </text>
            <text x="165" y="24" fill="#f59e0b" fontSize="9" fontFamily="monospace">
              135° hook
            </text>
          </svg>
        );

      case 'chair':
        return (
          <svg className="w-full h-32" viewBox="0 0 200 80">
            <polyline
              points="30,65 50,65 50,25 150,25 150,65 170,65"
              fill="none"
              stroke="#3b82f6"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <text x="35" y="60" fill="#93c5fd" fontSize="9" fontFamily="monospace">A</text>
            <text x="40" y="48" fill="#93c5fd" fontSize="9" fontFamily="monospace">B={dimB}</text>
            <text x="100" y="20" fill="#93c5fd" fontSize="10" textAnchor="middle" fontFamily="monospace">C={dimC}</text>
          </svg>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
      <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-700 rounded-2xl flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950">
          <div>
            <h3 className="text-sm font-semibold text-white">
              {initialItem?.id ? 'Edit Rebar Item' : 'Add Rebar Item to BBS'}
            </h3>
            <p className="text-xs text-zinc-400">Configure bar shape, legs, and cutting length</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto max-h-[80vh]">
          {/* Member & Mark */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1">Member ID</label>
              <input
                type="text"
                required
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                placeholder="e.g. C1, B-101, F1"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1">Member Type</label>
              <select
                value={memberType}
                onChange={(e) => setMemberType(e.target.value as StructuralMemberType)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white"
              >
                <option value="column">Column</option>
                <option value="beam">Beam</option>
                <option value="footing">Footing</option>
                <option value="slab">Slab</option>
                <option value="staircase">Staircase</option>
                <option value="wall">Shear Wall</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1">Bar Mark / Role</label>
              <input
                type="text"
                required
                value={mark}
                onChange={(e) => setMark(e.target.value)}
                placeholder="e.g. Main bottom, Ties"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white"
              />
            </div>
          </div>

          {/* Shape Selector */}
          <div>
            <label className="block text-[11px] font-medium text-zinc-400 mb-1.5">Bar Shape</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {SHAPES.map((s) => (
                <button
                  type="button"
                  key={s.code}
                  onClick={() => setShape(s.code)}
                  className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between ${
                    shape === s.code
                      ? 'border-blue-500 bg-blue-500/10 text-white'
                      : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'
                  }`}
                >
                  <div className="text-xs font-semibold">{s.label}</div>
                  <div className="text-[10px] text-zinc-500 mt-1">{s.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Shape Diagram & Calculated Cutting Length */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 flex flex-col items-center">
            {renderShapeSvg()}
            <div className="w-full mt-2 pt-2 border-t border-zinc-800/80 flex items-center justify-between text-xs px-2">
              <span className="text-zinc-400">Calculated Cutting Length:</span>
              <span className="text-emerald-400 font-mono font-bold text-sm">
                {cuttingLengthM.toFixed(3)} m
              </span>
            </div>
          </div>

          {/* Dimensions & Diameter */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                Diameter (mm)
              </label>
              <select
                value={diameter}
                onChange={(e) => setDiameter(Number(e.target.value))}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
              >
                {STANDARD_DIAMETERS.map((d) => (
                  <option key={d} value={d}>
                    Φ {d} mm
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                Dim A (mm)
              </label>
              <input
                type="number"
                value={dimA}
                onChange={(e) => setDimA(Number(e.target.value))}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                Dim B (mm)
              </label>
              <input
                type="number"
                value={dimB}
                onChange={(e) => setDimB(Number(e.target.value))}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
              />
            </div>
            {(shape === 'u_hook' || shape === 'crank' || shape === 'chair') && (
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  Dim C (mm)
                </label>
                <input
                  type="number"
                  value={dimC}
                  onChange={(e) => setDimC(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
                />
              </div>
            )}
            {shape === 'crank' && (
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  Crank Depth D (mm)
                </label>
                <input
                  type="number"
                  value={dimD}
                  onChange={(e) => setDimD(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
                />
              </div>
            )}
          </div>

          {/* Counts */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                No. of Similar Members
              </label>
              <input
                type="number"
                min="1"
                value={numMembers}
                onChange={(e) => setNumMembers(Math.max(1, Number(e.target.value)))}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                Bars per Member
              </label>
              <input
                type="number"
                min="1"
                value={barsPerMember}
                onChange={(e) => setBarsPerMember(Math.max(1, Number(e.target.value)))}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-400 mb-1">Notes / Remarks</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Lap at mid-height, 135 deg seismic hooks"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-lg"
            >
              <Check className="w-4 h-4" />
              <span>Save Bar Item</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

