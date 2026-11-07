import React, { useState, useEffect } from 'react';
import { Upload, X, FileCode2, RefreshCw, Clock } from 'lucide-react';
import { PlanDiscipline, DISCIPLINES, UploadProgressState } from '../../types/plan';
import { AiBadge } from '../ui/AiBadge';

interface UploadPlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  uploadDwgFiles: File[];
  onSelectDwgFiles: (files: FileList | null) => void;
  onRemoveDwgFile: (filename: string) => void;
  uploadProject: string;
  onChangeProject: (project: string) => void;
  distinctProjects: string[];
  uploadDiscipline: PlanDiscipline;
  onChangeDiscipline: (d: PlanDiscipline) => void;
  disciplineAutoDetected: boolean;
  uploadTitle: string;
  onChangeTitle: (title: string) => void;
  uploading: boolean;
  uploadProgress: UploadProgressState | null;
  uploadError: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onCleanTitleAi?: () => void;
  isAiCleaningTitle?: boolean;
}

export const UploadPlanModal: React.FC<UploadPlanModalProps> = ({
  isOpen,
  onClose,
  uploadDwgFiles,
  onSelectDwgFiles,
  onRemoveDwgFile,
  uploadProject,
  onChangeProject,
  distinctProjects,
  uploadDiscipline,
  onChangeDiscipline,
  disciplineAutoDetected,
  uploadTitle,
  onChangeTitle,
  uploading,
  uploadProgress,
  uploadError,
  onSubmit,
  onCleanTitleAi,
  isAiCleaningTitle = false,
}) => {
  const isCustomProject = Boolean(uploadProject && !distinctProjects.includes(uploadProject));
  const [creatingNewProject, setCreatingNewProject] = useState<boolean>(isCustomProject);

  useEffect(() => {
    if (uploadProject && !distinctProjects.includes(uploadProject)) {
      setCreatingNewProject(true);
    } else if (uploadProject && distinctProjects.includes(uploadProject)) {
      setCreatingNewProject(false);
    }
  }, [uploadProject, distinctProjects]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-lg bg-zinc-900 border-t sm:border border-zinc-700 rounded-t-3xl sm:rounded-2xl p-5 space-y-4 shadow-2xl max-h-[92dvh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-white flex items-center gap-2">
              <Upload className="w-4 h-4 text-blue-400" />
              Upload CAD Drawing to Cloud Vault
            </h3>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Organize by project & discipline; multi-sheet DWGs auto-clean to match your view.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={uploading}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3.5">
          {/* 1. DWG / DXF Input */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-zinc-200">
                1. CAD Drawing File(s) (.DWG or .DXF)
              </label>
              {uploadDwgFiles.length > 1 && (
                <span className="text-[10px] font-semibold text-blue-400">
                  {uploadDwgFiles.length} files selected — will merge into 1 plan
                </span>
              )}
            </div>
            <label className="flex items-center justify-between gap-2 p-3 rounded-xl bg-zinc-950 border border-dashed border-zinc-700 hover:border-blue-500 cursor-pointer transition">
              <div className="flex items-center gap-2.5 min-w-0">
                <FileCode2 className="w-5 h-5 text-blue-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white truncate">
                    {uploadDwgFiles.length === 0
                      ? 'Choose one or multiple .DWG / .DXF files'
                      : `${uploadDwgFiles.length} CAD file${uploadDwgFiles.length > 1 ? 's' : ''} selected`}
                  </div>
                  <div className="text-[10px] text-zinc-400">
                    {uploadDwgFiles.length > 1
                      ? 'All selected drawings will be merged into a single multi-sheet plan'
                      : 'Select multiple DWGs to merge all floor plans into one master sheet list'}
                  </div>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-lg bg-zinc-800 text-[11px] font-medium text-zinc-200 shrink-0">
                {uploadDwgFiles.length > 0 ? '+ Add More' : 'Browse'}
              </span>
              <input
                type="file"
                accept=".dwg,.dxf"
                multiple
                disabled={uploading}
                onChange={(e) => onSelectDwgFiles(e.target.files)}
                className="hidden"
              />
            </label>

            {/* File chips list */}
            {uploadDwgFiles.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {uploadDwgFiles.map((file) => (
                  <span
                    key={file.name}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800 text-xs font-medium text-zinc-200 border border-zinc-700"
                  >
                    <span className="truncate max-w-[200px]">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveDwgFile(file.name)}
                      className="text-zinc-400 hover:text-rose-400 p-0.5"
                      title="Remove file"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 2. Project Name */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-zinc-200">
              2. Project Name
            </label>
            <select
              value={creatingNewProject ? '__NEW__' : uploadProject}
              disabled={uploading}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '__NEW__') {
                  setCreatingNewProject(true);
                  if (distinctProjects.includes(uploadProject)) {
                    onChangeProject('');
                  }
                } else {
                  setCreatingNewProject(false);
                  onChangeProject(val);
                }
              }}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
            >
              <option value="">Auto-detect from filename / Default Project</option>
              {distinctProjects.map((proj) => (
                <option key={proj} value={proj}>
                  {proj}
                </option>
              ))}
              <option value="__NEW__">+ Create new project...</option>
            </select>
            {creatingNewProject && (
              <input
                type="text"
                autoFocus
                value={uploadProject}
                disabled={uploading}
                onChange={(e) => onChangeProject(e.target.value)}
                placeholder="Enter new project name (e.g., 1086 Mansa)"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
              />
            )}
          </div>

          {/* 3. Plan Discipline Type */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-zinc-200">
                3. Plan Type / Discipline
              </label>
              {disciplineAutoDetected && (
                <span className="text-[10px] font-semibold text-zinc-300">
                  Auto-detected from file name (click to change)
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
              {DISCIPLINES.map((d) => {
                const active = uploadDiscipline === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    disabled={uploading}
                    onClick={() => onChangeDiscipline(d.id)}
                    className={`py-2 px-2 rounded-xl text-[11px] font-medium border transition text-center truncate ${
                      active
                        ? d.pillActiveClass
                        : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200'
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. Plan Title + AI Clean Button */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-zinc-200">
                4. Plan Title (Optional — auto-detected from sheet title)
              </label>
              {onCleanTitleAi && uploadDwgFiles.length > 0 && (
                <button
                  type="button"
                  onClick={onCleanTitleAi}
                  disabled={uploading || isAiCleaningTitle}
                  className="inline-flex items-center gap-1.5 text-[11px] text-zinc-300 hover:text-white transition disabled:opacity-50"
                  title="Uses AI to clean up raw drawing filename into a standardized title"
                >
                  <AiBadge label="AI" />
                  <span>{isAiCleaningTitle ? 'Cleaning...' : 'Clean title'}</span>
                </button>
              )}
            </div>
            <input
              type="text"
              value={uploadTitle}
              disabled={uploading}
              onChange={(e) => onChangeTitle(e.target.value)}
              placeholder="e.g., Ground Floor Working Plan (Block A+B)"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Live Single Progress Bar */}
          {uploading && uploadProgress && (
            <div className="p-3.5 rounded-xl bg-zinc-950 border border-blue-500/40 space-y-2.5">
              <div className="flex items-center justify-between gap-2 text-xs font-medium">
                <span className="text-white flex items-center gap-2 truncate">
                  <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />
                  <span className="truncate">{uploadProgress.stage}</span>
                </span>
                <span className="text-blue-400 font-mono tabular-nums shrink-0">{uploadProgress.pct}%</span>
              </div>
              <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${uploadProgress.pct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono tabular-nums">
                <span>Elapsed: {uploadProgress.elapsedSec}s</span>
                <span className="text-zinc-300 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {uploadProgress.remainingSec > 0
                    ? `Est. ~${uploadProgress.remainingSec}s remaining`
                    : 'Almost done (<2s)...'}
                </span>
              </div>
            </div>
          )}

          {uploadError && (
            <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200">
              {uploadError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={uploading}
              className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-xs font-medium text-zinc-300 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploading || uploadDwgFiles.length === 0}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-medium text-white flex items-center gap-2 shadow transition"
            >
              {uploading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Processing ({uploadProgress?.pct ?? 0}%)...</span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  <span>Upload & Clean Plan</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

