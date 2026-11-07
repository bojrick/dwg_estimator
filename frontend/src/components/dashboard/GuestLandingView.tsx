import React from 'react';
import {
  Compass,
  Upload,
  RefreshCw,
  ArrowRight,
  Ruler,
  Layers,
  FileSpreadsheet,
  Zap,
} from 'lucide-react';

interface GuestLandingViewProps {
  uploading: boolean;
  onSelectFiles: (files: FileList | null) => void;
  onOpenSignUp: () => void;
}

export const GuestLandingView: React.FC<GuestLandingViewProps> = ({
  uploading,
  onSelectFiles,
  onOpenSignUp,
}) => {
  return (
    <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-8 sm:py-12 flex flex-col justify-center space-y-8">
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold">
          <Compass className="w-3.5 h-3.5" />
          <span>FOSS CAD Takeoff & Multi-Discipline Estimator</span>
        </div>
        <h2 className="text-2xl sm:text-4xl font-semibold text-white tracking-tight">
          Open, inspect, and extract quantities from CAD drawings in your browser
        </h2>
        <p className="text-sm sm:text-base text-zinc-400 max-w-xl mx-auto leading-relaxed">
          Open DWG and DXF files on desktop or phone. Generate bar bending schedules, masonry block counts, plaster areas, and electrical conduit runs.
        </p>
      </div>

      {/* Guest CAD Upload Card */}
      <div className="max-w-lg w-full mx-auto bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl">
        <div className="text-center space-y-1">
          <h3 className="text-base font-medium text-white">Try the viewer & estimators</h3>
          <p className="text-xs text-zinc-400">
            Upload a DWG or DXF file to view and calculate quantities immediately as a guest.
          </p>
        </div>

        <label className="flex flex-col items-center justify-center border-2 border-dashed border-zinc-700 hover:border-blue-500/50 rounded-2xl p-6 cursor-pointer bg-zinc-950/60 transition group">
          <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 group-hover:scale-105 transition mb-3">
            <Upload className="w-6 h-6" />
          </div>
          <span className="text-sm font-medium text-white">Tap to choose DWG or DXF files</span>
          <span className="text-xs text-zinc-400 mt-1">Free instant preview • Upload one or multiple drawings</span>
          <input
            type="file"
            accept=".dwg,.dxf"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={(e) => onSelectFiles(e.target.files)}
          />
        </label>

        {uploading && (
          <div className="flex items-center justify-center gap-2 text-xs font-medium text-blue-400 py-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Parsing and cleaning CAD entities...</span>
          </div>
        )}

        <div className="border-t border-zinc-800 pt-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <span className="text-zinc-400 text-center sm:text-left">
            Need to save plans, organize projects & sync?
          </span>
          <button
            onClick={onOpenSignUp}
            className="w-full sm:w-auto px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-medium flex items-center justify-center gap-1.5 transition"
          >
            <span>Create account</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Feature Highlights Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto pt-4">
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4 space-y-1.5">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400">
            <FileSpreadsheet className="w-4 h-4" />
          </div>
          <h4 className="text-xs font-medium text-white">Structural BBS & IS 456</h4>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            Extract schedule tables, calculate rebar cutting lengths, unit weights, and check IS 456 compliance.
          </p>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4 space-y-1.5">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400">
            <Ruler className="w-4 h-4" />
          </div>
          <h4 className="text-xs font-medium text-white">Architectural Finishes & Masonry</h4>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            Calculate net wall volumes, AAC block counts, plastering areas, room flooring, and openings schedules.
          </p>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4 space-y-1.5">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400">
            <Zap className="w-4 h-4" />
          </div>
          <h4 className="text-xs font-medium text-white">Electrical & Plumbing QTO</h4>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            Takeoff electrical points, conduit runs, wire lengths by gauge, sanitary fixtures, and IS 1172 tank sizing.
          </p>
        </div>
      </div>
    </main>
  );
};

