import React, { useState, useEffect } from 'react';
import { Upload, X, FileCode2, RefreshCw, Clock } from 'lucide-react';
import { PlanDiscipline, DISCIPLINES, UploadProgressState } from '../../types/plan';

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
      <div className="w-full sm:max-w-lg bg-zinc-900 border-t sm:border border-zinc-800 rounded-t-2xl sm:rounded-xl p-5 pb-[max(20px,env(safe-area-inset-bottom))] sm:pb-5 space-y-4 max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-zinc-100 flex items-center gap-2">
              <Upload className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="truncate">Upload CAD drawing to vault</span>
            </h3>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Organize by project and discipline; multi-sheet DWGs auto-clean to match your view
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={uploading}
            className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-40 transition shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3.5">
          {/* 1. DWG / DXF Input */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label className="block text-xs font-medium text-zinc-200">
                1. CAD drawing file(s) (.DWG or .DXF)
              </label>
              {uploadDwgFiles.length > 1 && (
                <span className="text-[10px] font-medium text-amber-400">
                  {uploadDwgFiles.length} files selected — will merge into 1 plan
                </span>
              )}
            </div>
            <label className="flex items-center justify-between gap-2 min-h-[56px] p-3 rounded-xl bg-zinc-950 border border-dashed border-zinc-700 hover:border-amber-400/60 cursor-pointer transition">
              <div className="flex items-center gap-2.5 min-w-0">
                <FileCode2 className="w-5 h-5 text-amber-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-medium text-zinc-100 truncate">
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
              <span className="px-3 py-1.5 rounded-lg bg-zinc-800 text-[11px] font-medium text-zinc-200 shrink-0">
                {uploadDwgFiles.length > 0 ? '+ Add more' : 'Browse'}
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
                      className="text-zinc-400 hover:text-rose-400 p-1"
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
              2. Project name
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
              className="w-full min-h-[42px] bg-zinc-950 border border-zinc-700/90 rounded-lg px-3 py-2 text-base sm:text-xs text-zinc-100 focus:outline-none focus:border-amber-400"
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
                placeholder="Enter new project name (e.g. 1086 Mansa)"
                className="w-full min-h-[42px] bg-zinc-950 border border-zinc-700/90 rounded-lg px-3 py-2 text-base sm:text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-400"
              />
            )}
          </div>

          {/* 3. Plan Discipline Type */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label className="block text-xs font-medium text-zinc-200">
                3. Plan type / discipline
              </label>
              {disciplineAutoDetected && (
                <span className="text-[10px] font-medium text-zinc-400">
                  Auto-detected from filename
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
              {DISCIPLINES.map((d) => {
                const active = uploadDiscipline === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    disabled={uploading}
                    onClick={() => onChangeDiscipline(d.id)}
                    className={`min-h-[40px] py-2 px-2 rounded-lg text-[11px] font-medium border transition text-center truncate ${
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

          {/* 4. Plan Title */}
          <div>
            <label className="block text-xs font-medium text-zinc-200 mb-1">
              4. Plan title (optional — auto-detected from sheet title)
            </label>
            <input
              type="text"
              value={uploadTitle}
              disabled={uploading}
              onChange={(e) => onChangeTitle(e.target.value)}
              placeholder="e.g. Ground Floor Working Plan (Block A+B)"
              className="w-full min-h-[42px] bg-zinc-950 border border-zinc-700/90 rounded-lg px-3 py-2 text-base sm:text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-400"
            />
          </div>

          {/* Live Single Progress Bar */}
          {uploading && uploadProgress && (
            <div className="p-3.5 rounded-xl bg-zinc-950 border border-amber-400/35 space-y-2.5">
              <div className="flex items-center justify-between gap-2 text-xs font-medium">
                <span className="text-zinc-100 flex items-center gap-2 truncate">
                  <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
                  <span className="truncate">{uploadProgress.stage}</span>
                </span>
                <span className="text-amber-400 font-mono tabular-nums shrink-0">{uploadProgress.pct}%</span>
              </div>
              <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-400 transition-all duration-300"
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
            <div className="p-2.5 rounded-lg bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200">
              {uploadError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={uploading}
              className="px-4 min-h-[44px] rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-xs font-medium text-zinc-200 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploading || uploadDwgFiles.length === 0}
              className="px-5 min-h-[44px] rounded-lg bg-zinc-100 hover:bg-white disabled:opacity-50 text-xs font-medium text-zinc-950 flex items-center justify-center gap-2 transition"
            >
              {uploading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Processing ({uploadProgress?.pct ?? 0}%)...</span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  <span>Upload &amp; clean plan</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

