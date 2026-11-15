import React from 'react';
import { Pencil, X, Trash2, FolderInput, FolderPlus } from 'lucide-react';

const ModalSheet: React.FC<{ onClose: () => void; children: React.ReactNode }> = ({
  onClose,
  children,
}) => (
  <div
    className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
    onClick={onClose}
  >
    <div
      className="w-full sm:max-w-sm bg-zinc-900 border-t sm:border border-zinc-800 rounded-t-2xl sm:rounded-xl p-5 pb-[max(20px,env(safe-area-inset-bottom))] sm:pb-5 space-y-4 max-h-[90dvh] overflow-y-auto"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  </div>
);

const inputClass =
  'w-full min-h-[42px] bg-zinc-950 border border-zinc-700/90 rounded-lg px-3 py-2 text-base sm:text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-400';
const cancelBtnClass =
  'px-4 min-h-[42px] rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition';
const primaryBtnClass =
  'px-4 min-h-[42px] rounded-lg bg-zinc-100 hover:bg-white disabled:opacity-50 text-xs font-medium text-zinc-950 transition';
const closeBtnClass =
  'p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition shrink-0';

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
    <ModalSheet onClose={onClose}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-zinc-100 flex items-center gap-2">
          <Pencil className="w-4 h-4 text-amber-400" />
          Rename project
        </h3>
        <button onClick={onClose} className={closeBtnClass}>
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
          <label className="block text-xs font-medium text-zinc-300 mb-1.5">Project name</label>
          <input
            type="text"
            autoFocus
            value={modal.newName}
            onChange={(e) => onChangeName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={cancelBtnClass}>
            Cancel
          </button>
          <button type="submit" disabled={!modal.newName.trim()} className={primaryBtnClass}>
            Save
          </button>
        </div>
      </form>
    </ModalSheet>
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
    <ModalSheet onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shrink-0">
            <Trash2 className="w-4 h-4 text-rose-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-zinc-100">Delete project?</h3>
            <p className="text-[11px] text-zinc-400 truncate">{modal.name}</p>
          </div>
        </div>
        <button onClick={onClose} className={closeBtnClass}>
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className="text-xs text-zinc-300 leading-relaxed">
        Are you sure you want to delete project <strong className="text-white">{modal.name}</strong>?
        This will permanently delete all{' '}
        <strong className="text-white">{modal.count} plan(s)</strong> and associated CAD drawings inside it.
      </p>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className={cancelBtnClass}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onConfirm(modal.name)}
          className="px-4 min-h-[42px] rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-medium text-white flex items-center gap-1.5 transition"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Delete project &amp; plans</span>
        </button>
      </div>
    </ModalSheet>
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
    <ModalSheet onClose={onClose}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-zinc-100 flex items-center gap-2">
          <FolderInput className="w-4 h-4 text-amber-400" />
          Move plan to project
        </h3>
        <button onClick={onClose} className={closeBtnClass}>
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
            Destination project
          </label>
          <select
            value={modal.targetProject}
            onChange={(e) => onChangeTargetProject(e.target.value)}
            className={inputClass}
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
              New project name
            </label>
            <input
              type="text"
              autoFocus
              placeholder="e.g. Tower 2"
              value={modal.customProject}
              onChange={(e) => onChangeCustomProject(e.target.value)}
              className={inputClass}
            />
          </div>
        )}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={cancelBtnClass}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={modal.targetProject === '__NEW__' && !modal.customProject.trim()}
            className={primaryBtnClass}
          >
            Move plan
          </button>
        </div>
      </form>
    </ModalSheet>
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
    <ModalSheet onClose={onClose}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-zinc-100 flex items-center gap-2">
          <Pencil className="w-4 h-4 text-amber-400" />
          Rename plan
        </h3>
        <button onClick={onClose} className={closeBtnClass}>
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
            Plan display name
          </label>
          <input
            type="text"
            autoFocus
            value={modal.newName}
            onChange={(e) => onChangeName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={cancelBtnClass}>
            Cancel
          </button>
          <button type="submit" disabled={!modal.newName.trim()} className={primaryBtnClass}>
            Save
          </button>
        </div>
      </form>
    </ModalSheet>
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
    <ModalSheet onClose={onClose}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-zinc-100 flex items-center gap-2">
          <FolderPlus className="w-4 h-4 text-amber-400" />
          New project
        </h3>
        <button onClick={onClose} className={closeBtnClass}>
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
          <label className="block text-xs font-medium text-zinc-300 mb-1.5">Project name</label>
          <input
            type="text"
            autoFocus
            placeholder="e.g. 1086 Mansa Tower B"
            value={modal.name}
            onChange={(e) => onChangeName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={cancelBtnClass}>
            Cancel
          </button>
          <button type="submit" disabled={!modal.name.trim()} className={primaryBtnClass}>
            Create &amp; upload
          </button>
        </div>
      </form>
    </ModalSheet>
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
    <ModalSheet onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shrink-0">
            <Trash2 className="w-4 h-4 text-rose-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-zinc-100">Delete plan?</h3>
            <p className="text-[11px] text-zinc-400 truncate">
              {plan.project_name || 'Default Project'}
            </p>
          </div>
        </div>
        <button onClick={onClose} className={closeBtnClass}>
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className="text-xs text-zinc-300 leading-relaxed">
        Are you sure you want to delete <strong className="text-white">{plan.name}</strong>? This
        will permanently remove its DWG drawing and parsed data from the vault.
      </p>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className={cancelBtnClass}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onConfirm(plan.id)}
          className="px-4 min-h-[42px] rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-medium text-white flex items-center gap-1.5 transition"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Delete plan</span>
        </button>
      </div>
    </ModalSheet>
  );
};

