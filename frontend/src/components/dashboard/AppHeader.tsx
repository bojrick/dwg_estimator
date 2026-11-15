import React from 'react';
import { DraftingCompass, Settings, LogOut, Download, Plus } from 'lucide-react';
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
    <header className="sticky top-0 z-30 bg-[#111315]/95 backdrop-blur-md border-b border-white/[0.08] px-2.5 sm:px-6 pb-3 pt-[max(12px,env(safe-area-inset-top))] flex items-center justify-between gap-2 sm:gap-3">
      <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 overflow-hidden">
        <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-zinc-900 border border-zinc-700/80 text-amber-400 flex items-center justify-center shrink-0">
          <DraftingCompass className="w-4 h-4 sm:w-5 sm:h-5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-sm sm:text-base font-medium tracking-tight text-zinc-100 truncate">
              PlanVault
            </h1>
            {!authSession && (
              <span className="hidden sm:inline text-[11px] font-mono text-zinc-400 shrink-0">
                Guest
              </span>
            )}
          </div>
          <p className="text-[11px] text-zinc-400 truncate hidden sm:block">
            Multi-discipline AEC takeoff & drawings
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {authSession ? (
          <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg pl-1.5 sm:pl-2 pr-1 py-0.5 text-xs">
            <div className="w-6 h-6 rounded-md bg-zinc-800 text-amber-400 flex items-center justify-center text-[11px] font-medium shrink-0">
              {userInitial}
            </div>
            <span
              className="hidden sm:inline text-zinc-300 font-mono truncate max-w-[140px] px-1"
              title={userEmail}
            >
              {username}
            </span>
            <button
              onClick={onOpenProfile}
              className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-md text-zinc-400 hover:text-amber-400 hover:bg-zinc-800 transition"
              title="Preferences & Units"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onSignOut}
              className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-md text-zinc-400 hover:text-rose-400 hover:bg-zinc-800 transition"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => onOpenAuth('signin')}
              className="px-2.5 sm:px-3 min-h-[38px] rounded-lg text-xs font-medium text-zinc-300 hover:text-white whitespace-nowrap transition"
            >
              Sign in
            </button>
            <button
              onClick={() => onOpenAuth('signup')}
              className="px-2.5 sm:px-3.5 min-h-[38px] rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-medium whitespace-nowrap transition"
            >
              Sign up
            </button>
          </div>
        )}

        {installPrompt && (
          <button
            onClick={onInstallApp}
            className="w-9 sm:w-auto sm:px-3 min-h-[36px] sm:min-h-[38px] rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-xs font-medium flex items-center justify-center gap-1.5 border border-zinc-800 transition"
            title="Install App"
          >
            <Download className="w-3.5 h-3.5 text-zinc-300" />
            <span className="hidden sm:inline">Install app</span>
          </button>
        )}

        {!installPrompt && isIosBrowser && (
          <button
            onClick={() => showToast('Tap Share, then Add to Home Screen')}
            className="w-9 sm:w-auto sm:px-3 min-h-[36px] sm:min-h-[38px] rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-xs font-medium flex items-center justify-center gap-1.5 border border-zinc-800 transition"
            title="Install App"
          >
            <Download className="w-3.5 h-3.5 text-zinc-300" />
            <span className="hidden sm:inline">Install</span>
          </button>
        )}

        {authSession && (
          <button
            onClick={onOpenUpload}
            className="hidden sm:flex items-center gap-1.5 px-3.5 min-h-[38px] rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-medium transition"
          >
            <Plus className="w-4 h-4" />
            <span>Upload plan</span>
          </button>
        )}
      </div>
    </header>
  );
};

