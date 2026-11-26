import React, { useState } from 'react';
import { Compass, Upload, RefreshCw, ArrowRight } from 'lucide-react';

interface GuestLandingViewProps {
  uploading: boolean;
  onSelectFiles: (files: FileList | File[] | null) => void;
  onOpenSignUp: () => void;
}

const SAMPLE_BOQ_ROWS = [
  { item: 'Fe500 Rebar', spec: 'Structural · IS 456', qty: '14,820 kg', highlight: true },
  { item: 'AAC Masonry', spec: 'Architectural · IS 2185', qty: '118.4 m³', highlight: false },
  { item: 'Conduit & Wiring', spec: 'Electrical · IS 732', qty: '1,420 m', highlight: false },
  { item: 'Hydrant Riser', spec: 'Fire · IS 3844', qty: '86.0 m', highlight: false },
];

const DISCIPLINE_CHECKS = [
  { label: 'Structural BBS', active: true },
  { label: 'Masonry & finishes', active: false },
  { label: 'Electrical', active: false },
  { label: 'Plumbing & fire', active: false },
];

export const GuestLandingView: React.FC<GuestLandingViewProps> = ({
  uploading,
  onSelectFiles,
  onOpenSignUp,
}) => {
  const [isDragging, setIsDragging] = useState(false);

  return (
    <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10 flex items-center">
      <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10 items-center">
        {/* Left: Workstation Entry & Dropzone */}
        <div className="lg:col-span-7 space-y-5 min-w-0">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-amber-400 text-[11px] font-mono max-w-full">
            <Compass className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">DWG / DXF quantity takeoff · IS 456 &amp; IS 1200</span>
          </div>

          <div className="space-y-3">
            <h2 className="text-2xl sm:text-4xl font-medium text-zinc-100 tracking-tight leading-[1.15]">
              Inspect CAD sheets and extract site quantities in the browser
            </h2>
            <p className="text-sm sm:text-base text-zinc-400 max-w-xl leading-relaxed">
              Open DWG and DXF drawings on desktop or phone to generate bar bending schedules, masonry counts, plaster areas, and MEP runs
            </p>
          </div>

          <label
            onDragOver={(e) => {
              e.preventDefault();
              if (!uploading) setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (uploading) return;
              const dropped = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
              if (dropped.length > 0) onSelectFiles(dropped);
            }}
            className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-dashed rounded-xl p-5 sm:p-6 cursor-pointer transition group ${
              isDragging
                ? 'border-amber-400 bg-zinc-900'
                : 'border-zinc-700 hover:border-amber-400/60 bg-zinc-900/70'
            }`}
          >
            <div className="flex items-start sm:items-center gap-3.5 min-w-0">
              <div className="w-11 h-11 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center text-amber-400 shrink-0">
                {uploading ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : (
                  <Upload className="w-5 h-5" />
                )}
              </div>
              <div className="min-w-0 space-y-0.5">
                <div className="text-sm font-medium text-zinc-100">
                  {uploading ? 'Parsing CAD entities...' : 'Open DWG or DXF sheets'}
                </div>
                <div className="text-xs text-zinc-400">
                  {uploading
                    ? 'Extracting layers, blocks, and sheet frames'
                    : 'Instant guest preview · Upload one or multiple drawings'}
                </div>
              </div>
            </div>
            <span className="inline-flex items-center justify-center min-h-[42px] px-4 rounded-lg bg-zinc-100 group-hover:bg-white text-zinc-950 text-xs font-medium shrink-0 transition">
              Browse files
            </span>
            <input
              type="file"
              accept=".dwg,.dxf"
              multiple
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const picked = e.target.files ? Array.from(e.target.files) : [];
                e.target.value = '';
                if (picked.length > 0) onSelectFiles(picked);
              }}
            />
          </label>

          <div className="pt-4 border-t border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <span className="text-zinc-400">
              Save plans, organize projects, and configure default measurement units
            </span>
            <button
              type="button"
              onClick={onOpenSignUp}
              className="w-full sm:w-auto min-h-[42px] px-4 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 text-zinc-100 font-medium flex items-center justify-center gap-1.5 shrink-0 transition"
            >
              <span>Create account</span>
              <ArrowRight className="w-3.5 h-3.5 text-amber-400" />
            </button>
          </div>
        </div>

        {/* Right: Sheet Title Block & Sample BOQ Preview */}
        <div className="lg:col-span-5 min-w-0">
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl overflow-hidden">
            {/* Sheet Title Block Header */}
            <div className="px-4 py-3 bg-zinc-950/80 border-b border-zinc-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                <span className="text-xs font-mono text-zinc-200 truncate">
                  SHT-02 · Framing &amp; Conduit · 1:100 · mm
                </span>
              </div>
              <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[10px] font-mono text-zinc-400 shrink-0">
                Sample BOQ
              </span>
            </div>

            {/* Tabular Takeoff Rows */}
            <div className="divide-y divide-white/[0.06]">
              {SAMPLE_BOQ_ROWS.map((row) => (
                <div
                  key={row.item}
                  className="px-4 py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-zinc-100 truncate">
                      {row.item}
                    </div>
                    <div className="text-[11px] font-mono text-zinc-500 truncate">
                      {row.spec}
                    </div>
                  </div>
                  <span
                    className={`text-xs font-mono tabular-nums shrink-0 ${
                      row.highlight ? 'text-amber-400 font-medium' : 'text-zinc-200'
                    }`}
                  >
                    {row.qty}
                  </span>
                </div>
              ))}
            </div>

            {/* Quiet Discipline Status Footer */}
            <div className="px-4 py-3 bg-zinc-950/60 border-t border-zinc-800 flex flex-wrap items-center gap-x-4 gap-y-2">
              {DISCIPLINE_CHECKS.map((d) => (
                <span
                  key={d.label}
                  className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      d.active ? 'bg-amber-400' : 'bg-zinc-600'
                    }`}
                  />
                  <span>{d.label}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
};

