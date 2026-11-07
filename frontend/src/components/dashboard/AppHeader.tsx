import React from 'react';
import { Cloud, Settings, LogOut, Download, Plus } from 'lucide-react';
import { AuthSession } from '../../auth';

interface AppHeaderProps {
  authSession: AuthSession | null;
  username: string;
  userEmail: string;
  userInitial: string;
  onOpenAuth: (mode: 'signin' | 'signup') => void;
  onOpenProfile: () => void;
  onSignOut: () => void;
  onOpenUpload: () => void;
  installPrompt: any;
  onInstallApp: () => void;
  isIosBrowser: boolean;
  showToast: (msg: string) => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  authSession,
  username,
  userEmail,
  userInitial,
  onOpenAuth,
  onOpenProfile,
  onSignOut,
  onOpenUpload,
  installPrompt,
  onInstallApp,
  isIosBrowser,
  showToast,
}) => {
  return (
    <header className="sticky top-0 z-30 bg-zinc-900/95 backdrop-blur-md border-b border-zinc-800 px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))] flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm shrink-0">
          <Cloud className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold tracking-tight text-white">PlanVault</h1>
            {!authSession && <span className="text-[11px] text-zinc-400">Guest</span>}
          </div>
          <p className="text-[11px] text-zinc-400 truncate hidden sm:block">
            Multi-discipline AEC takeoff & drawings
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {authSession ? (
          <div className="flex items-center gap-1.5 bg-zinc-950 border border-zinc-800 rounded-xl px-2 py-1 sm:px-2.5 sm:py-1.5 text-xs">
            <div className="w-5 h-5 rounded-md bg-blue-600/20 text-blue-400 flex items-center justify-center text-[10px] font-semibold shrink-0">
              {userInitial}
            </div>
            <span
              className="text-zinc-300 font-mono truncate max-w-[70px] sm:max-w-[140px]"
              title={userEmail}
            >
              {username}
            </span>
            <button
              onClick={onOpenProfile}
              className="p-1 rounded-lg text-zinc-400 hover:text-blue-400 transition"
              title="Preferences & Units"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onSignOut}
              className="p-1 rounded-lg text-zinc-400 hover:text-rose-400 transition"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onOpenAuth('signin')}
              className="px-3 py-1.5 rounded-xl text-xs font-medium text-zinc-300 hover:text-white transition"
            >
              Sign In
            </button>
            <button
              onClick={() => onOpenAuth('signup')}
              className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow transition"
            >
              Sign Up
            </button>
          </div>
        )}

        {installPrompt && (
          <button
            onClick={onInstallApp}
            className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex items-center gap-1.5 border border-zinc-700"
          >
            <Download className="w-3.5 h-3.5 text-zinc-300" />
            <span className="hidden sm:inline">Install App</span>
          </button>
        )}

        {!installPrompt && isIosBrowser && (
          <button
            onClick={() => showToast('Tap Share, then Add to Home Screen')}
            className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex items-center gap-1.5 border border-zinc-700"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Install</span>
          </button>
        )}

        {authSession && (
          <button
            onClick={onOpenUpload}
            className="hidden sm:flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow-lg transition"
          >
            <Plus className="w-4 h-4" />
            <span>Upload plan</span>
          </button>
        )}
      </div>
    </header>
  );
};

