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
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center shrink-0">
              <Settings className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Profile Preferences</h3>
              <p className="text-[11px] text-zinc-400">{authSession?.user?.email}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <label className="block text-xs font-medium text-zinc-300">
            Default Takeoff Measurement Unit
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
                  className={`p-3 rounded-2xl border text-left transition ${
                    active
                      ? 'bg-blue-600/20 border-blue-500 text-white'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  <div className="text-xs font-medium">{u.label}</div>
                  <div className="text-[10px] text-zinc-400">{u.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-2 border-t border-zinc-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-medium transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

