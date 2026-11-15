import React from 'react';
import { RefreshCw, Clock } from 'lucide-react';
import { UploadProgressState } from '../../types/plan';

interface UploadProgressOverlayProps {
  progress: UploadProgressState | null;
}

export const UploadProgressOverlay: React.FC<UploadProgressOverlayProps> = ({ progress }) => {
  if (!progress) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between gap-2 text-xs font-medium text-zinc-100">
          <span className="flex items-center gap-2 min-w-0">
            <RefreshCw className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
            <span className="truncate">{progress.stage}</span>
          </span>
          <span className="text-amber-400 font-mono tabular-nums shrink-0">{progress.pct}%</span>
        </div>
        <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-400 transition-all duration-300"
            style={{ width: `${progress.pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono tabular-nums">
          <span>Elapsed: {progress.elapsedSec}s</span>
          <span className="text-zinc-300 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {progress.remainingSec > 0
              ? `~${progress.remainingSec}s remaining`
              : 'Finishing up...'}
          </span>
        </div>
      </div>
    </div>
  );
};

