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
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center shrink-0">
              <Lock className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">
                {authMode === 'signin' ? 'Sign In to PlanVault' : 'Create account'}
              </h3>
              <p className="text-[11px] text-zinc-400">
                {authMode === 'signin'
                  ? 'Access and sync your private vault'
                  : 'Save DWG plans & customize your measurement units'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-white"
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
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          {authError && (
            <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200">
              {authError}
            </div>
          )}

          {authNotice && (
            <div className="p-2.5 rounded-xl bg-zinc-900 border border-blue-500/40 text-xs text-blue-200">
              {authNotice}
            </div>
          )}

          <button
            type="submit"
            disabled={authBusy}
            className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-medium text-white shadow-lg transition"
          >
            {authBusy
              ? 'Please wait...'
              : authMode === 'signin'
              ? 'Sign In'
              : 'Create Account & Save'}
          </button>
        </form>

        <div className="text-center pt-2 border-t border-zinc-800">
          <button
            type="button"
            onClick={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')}
            className="text-xs text-blue-400 hover:text-blue-300 font-semibold"
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

