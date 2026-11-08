import React, { useState } from 'react';
import { History, RotateCcw, X } from 'lucide-react';
import { EstimateVersion } from '../ArchitecturalEstimator/types';

interface VersionHistoryControlProps {
  versions: EstimateVersion[];
  currency?: string;
  onRestoreVersion: (version: EstimateVersion) => void;
}

export const VersionHistoryControl: React.FC<VersionHistoryControlProps> = ({
  versions = [],
  currency = '₹',
  onRestoreVersion,
}) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-colors tabular-nums ${
          open
            ? 'bg-amber-400/15 text-amber-300 border-amber-400/40'
            : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white border-white/[0.08]'
        }`}
        title="View & restore saved estimate versions"
      >
        <History className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Versions</span>
        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-950 text-zinc-300">
          v{versions.length || 1}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-80 max-h-96 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-zinc-800 flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-100">
              Estimate version history ({versions.length})
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-0.5 text-zinc-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/70">
            {versions.length === 0 ? (
              <div className="p-5 text-center text-xs text-zinc-400">
                No saved versions yet. Clicking &ldquo;Save estimate&rdquo; creates a version snapshot automatically.
              </div>
            ) : (
              [...versions]
                .slice()
                .reverse()
                .map((ver) => (
                  <div
                    key={ver.id}
                    className="p-3 hover:bg-zinc-800/50 transition-colors space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-300 font-mono text-[10px] font-medium shrink-0">
                          v{ver.versionNumber}
                        </span>
                        <span className="text-zinc-200 font-medium truncate">
                          {ver.sheetName || ver.label || 'Sheet estimate'}
                        </span>
                      </div>
                      <span className="font-mono text-zinc-100 tabular-nums shrink-0">
                        {currency}
                        {Math.round(ver.totalCost || 0).toLocaleString()}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
                      <span className="tabular-nums">
                        {new Date(ver.timestamp).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          onRestoreVersion(ver);
                          setOpen(false);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white text-[11px]"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Restore</span>
                      </button>
                    </div>

                    {ver.notes && (
                      <p className="text-[11px] text-zinc-400 line-clamp-2 italic">
                        &ldquo;{ver.notes}&rdquo;
                      </p>
                    )}
                  </div>
                ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

