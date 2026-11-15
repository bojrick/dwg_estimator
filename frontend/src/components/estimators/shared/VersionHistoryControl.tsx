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
        className={`inline-flex items-center gap-1.5 min-h-[36px] lg:min-h-0 px-2.5 py-1.5 rounded-lg text-xs border transition-colors tabular-nums ${
          open
            ? 'bg-amber-400/15 text-amber-300 border-amber-400/40'
            : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white border-white/[0.08]'
        }`}
        title="View & restore saved estimate versions"
      >
        <History className="w-3.5 h-3.5" strokeWidth={1.75} />
        <span className="hidden sm:inline">Versions</span>
        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-950 text-zinc-300">
          v{versions.length || 1}
        </span>
      </button>

      {open && (
        <div className="fixed inset-x-3 top-14 sm:absolute sm:inset-x-auto sm:right-0 sm:top-10 z-50 w-auto sm:w-80 max-h-[75dvh] sm:max-h-96 bg-zinc-900 border border-zinc-700/90 rounded-xl flex flex-col overflow-hidden">
          <div className="px-3.5 py-2 border-b border-zinc-800 flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-100">
              Estimate version history ({versions.length})
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close version history"
              className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            >
              <X className="w-3.5 h-3.5" strokeWidth={1.75} />
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
                        className="inline-flex items-center gap-1.5 min-h-[34px] px-2.5 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white text-[11px] font-medium transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.75} />
                        <span>Restore</span>
                      </button>
                    </div>

                    {ver.notes && (
                      <p className="text-[11px] text-zinc-400 line-clamp-2">
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

