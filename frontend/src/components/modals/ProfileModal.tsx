import React from 'react';
import { Settings, X } from 'lucide-react';
import { AuthSession, updateUserProfile } from '../../auth';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  authSession: AuthSession | null;
  setAuthSession: React.Dispatch<React.SetStateAction<AuthSession | null>>;
  showToast: (msg: string) => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  authSession,
  setAuthSession,
  showToast,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-sm bg-zinc-900 border-t sm:border border-zinc-800 rounded-t-2xl sm:rounded-xl p-5 pb-[max(20px,env(safe-area-inset-bottom))] sm:pb-5 space-y-5 max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center shrink-0">
              <Settings className="w-4 h-4 text-amber-400" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-zinc-100">Profile preferences</h3>
              <p className="text-[11px] text-zinc-400 font-mono truncate">{authSession?.user?.email}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <label className="block text-xs font-medium text-zinc-300">
            Default takeoff measurement unit
          </label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: 'm', label: 'Meters (m)', desc: 'Metric standard' },
              { id: 'mm', label: 'Millimeters (mm)', desc: 'Architectural details' },
              { id: 'ft', label: 'Feet (ft)', desc: 'Imperial standard' },
              { id: 'in', label: 'Inches (in)', desc: 'Imperial engineering' },
            ].map((u) => {
              const active = (authSession?.user?.default_unit || 'm') === u.id;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={async () => {
                    try {
                      const updated = await updateUserProfile(u.id as any);
                      setAuthSession((s) => (s ? { ...s, user: updated } : null));
                      showToast(`Default unit set to ${u.label}`);
                    } catch {
                      showToast('Failed to update unit preference');
                    }
                  }}
                  className={`min-h-[56px] p-3 rounded-xl border text-left transition ${
                    active
                      ? 'bg-amber-400/10 border-amber-400/60 text-zinc-100'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-700'
                  }`}
                >
                  <div className="text-xs font-medium">{u.label}</div>
                  <div className="text-[10px] text-zinc-400 mt-0.5">{u.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-2 border-t border-white/[0.08] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 min-h-[42px] rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-medium transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

