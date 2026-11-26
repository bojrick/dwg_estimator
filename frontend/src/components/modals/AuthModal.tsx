import React from 'react';
import { Lock, X } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  authMode: 'signin' | 'signup';
  setAuthMode: (mode: 'signin' | 'signup') => void;
  authEmail: string;
  setAuthEmail: (email: string) => void;
  authPassword: string;
  setAuthPassword: (pwd: string) => void;
  authBusy: boolean;
  authError: string | null;
  authNotice: string | null;
  onSubmit: (e: React.FormEvent) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  authMode,
  setAuthMode,
  authEmail,
  setAuthEmail,
  authPassword,
  setAuthPassword,
  authBusy,
  authError,
  authNotice,
  onSubmit,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-sm bg-zinc-900 border-t sm:border border-zinc-800 rounded-t-2xl sm:rounded-xl p-5 pb-[max(20px,env(safe-area-inset-bottom))] sm:pb-5 space-y-5 max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center shrink-0">
              <Lock className="w-4 h-4 text-amber-400" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-zinc-100 truncate">
                {authMode === 'signin' ? 'Sign in to PlanVault' : 'Create account'}
              </h3>
              <p className="text-[11px] text-zinc-400 truncate">
                {authMode === 'signin'
                  ? 'Access and sync your private vault'
                  : 'Save DWG plans and customize measurement units'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Email</label>
            <input
              type="email"
              required
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full min-h-[42px] bg-zinc-950 border border-zinc-700/90 rounded-lg px-3.5 py-2 text-base sm:text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-400"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Password</label>
            <input
              type="password"
              required
              minLength={authMode === 'signup' ? 6 : undefined}
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full min-h-[42px] bg-zinc-950 border border-zinc-700/90 rounded-lg px-3.5 py-2 text-base sm:text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-400"
            />
          </div>

          {authError && (
            <div className="p-2.5 rounded-lg bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200">
              {authError}
            </div>
          )}

          {authNotice && (
            <div className="p-2.5 rounded-lg bg-zinc-950 border border-amber-400/35 text-xs text-amber-200">
              {authNotice}
            </div>
          )}

          <button
            type="submit"
            disabled={authBusy}
            className="w-full min-h-[44px] py-2.5 rounded-lg bg-zinc-100 hover:bg-white disabled:opacity-50 text-xs font-medium text-zinc-950 transition"
          >
            {authBusy
              ? 'Please wait...'
              : authMode === 'signin'
              ? 'Sign in'
              : 'Create account & save'}
          </button>
        </form>

        <div className="text-center pt-2 border-t border-white/[0.08]">
          <button
            type="button"
            onClick={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')}
            className="min-h-[36px] px-2 text-xs text-amber-400 hover:text-amber-300 font-medium transition"
          >
            {authMode === 'signin'
              ? "Don't have an account? Sign up"
              : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
};

