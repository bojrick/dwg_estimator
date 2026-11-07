import React from 'react';
import { Pencil, X, Trash2, FolderInput, FolderPlus } from 'lucide-react';

interface RenameProjectModalProps {
  modal: { oldName: string; newName: string } | null;
  onClose: () => void;
  onSave: (oldName: string, newName: string) => void;
  onChangeName: (newName: string) => void;
}

export const RenameProjectModal: React.FC<RenameProjectModalProps> = ({
  modal,
  onClose,
  onSave,
  onChangeName,
}) => {
  if (!modal) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-2xl p-5 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-white flex items-center gap-2">
            <Pencil className="w-4 h-4 text-blue-400" />
            Rename Project
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg text-zinc-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(modal.oldName, modal.newName);
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">Project Name</label>
            <input
              type="text"
              autoFocus
              value={modal.newName}
              onChange={(e) => onChangeName(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-300 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!modal.newName.trim()}
              className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-medium text-white transition"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface DeleteProjectModalProps {
  modal: { name: string; count: number } | null;
  onClose: () => void;
  onConfirm: (name: string) => void;
}

export const DeleteProjectModal: React.FC<DeleteProjectModalProps> = ({
  modal,
  onClose,
  onConfirm,
}) => {
  if (!modal) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-2xl p-5 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shrink-0">
              <Trash2 className="w-4 h-4 text-rose-400" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-white">Delete Project?</h3>
              <p className="text-[11px] text-zinc-400">{modal.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-zinc-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-zinc-300 leading-relaxed">
          Are you sure you want to delete project <strong className="text-white">{modal.name}</strong>?
          This will permanently delete all{' '}
          <strong className="text-white">{modal.count} plan(s)</strong> and associated CAD drawings inside it.
        </p>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(modal.name)}
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-medium text-white flex items-center gap-1.5 transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete Project & Plans</span>
          </button>
        </div>
      </div>
    </div>
  );
};

interface MovePlanModalProps {
  modal: { plan: any; targetProject: string; customProject: string } | null;
  distinctProjects: string[];
  onClose: () => void;
  onConfirm: (planId: number, target: string) => void;
  onChangeTargetProject: (target: string) => void;
  onChangeCustomProject: (custom: string) => void;
}

export const MovePlanModal: React.FC<MovePlanModalProps> = ({
  modal,
  distinctProjects,
  onClose,
  onConfirm,
  onChangeTargetProject,
  onChangeCustomProject,
}) => {
  if (!modal) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-2xl p-5 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-white flex items-center gap-2">
            <FolderInput className="w-4 h-4 text-blue-400" />
            Move Plan to Project
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg text-zinc-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-zinc-300">
          Moving <strong className="text-white">{modal.plan.name}</strong> from{' '}
          <span className="font-mono text-zinc-400">
            {modal.plan.project_name || 'Default Project'}
          </span>
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const target =
              modal.targetProject === '__NEW__' ? modal.customProject : modal.targetProject;
            onConfirm(modal.plan.id, target);
          }}
          className="space-y-3.5"
        >
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Destination Project
            </label>
            <select
              value={modal.targetProject}
              onChange={(e) => onChangeTargetProject(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
            >
              {distinctProjects.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              <option value="__NEW__">+ Create new project...</option>
            </select>
          </div>
          {modal.targetProject === '__NEW__' && (
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                New Project Name
              </label>
              <input
                type="text"
                autoFocus
                placeholder="e.g. Tower 2"
                value={modal.customProject}
                onChange={(e) => onChangeCustomProject(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-300 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                modal.targetProject === '__NEW__' && !modal.customProject.trim()
              }
              className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-medium text-white transition"
            >
              Move Plan
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface RenamePlanModalProps {
  modal: { plan: any; newName: string } | null;
  onClose: () => void;
  onSave: (planId: number, newName: string) => void;
  onChangeName: (newName: string) => void;
}

export const RenamePlanModal: React.FC<RenamePlanModalProps> = ({
  modal,
  onClose,
  onSave,
  onChangeName,
}) => {
  if (!modal) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-2xl p-5 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-white flex items-center gap-2">
            <Pencil className="w-4 h-4 text-blue-400" />
            Rename Plan
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg text-zinc-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(modal.plan.id, modal.newName);
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Plan Display Name
            </label>
            <input
              type="text"
              autoFocus
              value={modal.newName}
              onChange={(e) => onChangeName(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-300 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!modal.newName.trim()}
              className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-medium text-white transition"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface CreateProjectModalProps {
  modal: { name: string } | null;
  onClose: () => void;
  onCreate: (name: string) => void;
  onChangeName: (name: string) => void;
}

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  modal,
  onClose,
  onCreate,
  onChangeName,
}) => {
  if (!modal) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-2xl p-5 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-white flex items-center gap-2">
            <FolderPlus className="w-4 h-4 text-blue-400" />
            New Project
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg text-zinc-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onCreate(modal.name);
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">Project Name</label>
            <input
              type="text"
              autoFocus
              placeholder="e.g. 1086 Mansa Tower B"
              value={modal.name}
              onChange={(e) => onChangeName(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-300 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!modal.name.trim()}
              className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-medium text-white transition"
            >
              Create & Upload
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface ConfirmDeletePlanModalProps {
  plan: any | null;
  onClose: () => void;
  onConfirm: (planId: number) => void;
}

export const ConfirmDeletePlanModal: React.FC<ConfirmDeletePlanModalProps> = ({
  plan,
  onClose,
  onConfirm,
}) => {
  if (!plan) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-2xl p-5 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shrink-0">
              <Trash2 className="w-4 h-4 text-rose-400" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-white">Delete Plan?</h3>
              <p className="text-[11px] text-zinc-400">
                {plan.project_name || 'Default Project'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-zinc-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-zinc-300 leading-relaxed">
          Are you sure you want to delete <strong className="text-white">{plan.name}</strong>? This
          will permanently remove its DWG drawing and parsed data from Cloud Vault.
        </p>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(plan.id)}
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-medium text-white flex items-center gap-1.5 transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete Plan</span>
          </button>
        </div>
      </div>
    </div>
  );
};

