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
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3 shadow-2xl">
        <div className="flex items-center justify-between text-xs font-medium text-white">
          <span className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />
            <span className="truncate">{progress.stage}</span>
          </span>
          <span className="text-blue-400 font-mono tabular-nums">{progress.pct}%</span>
        </div>
        <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
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

