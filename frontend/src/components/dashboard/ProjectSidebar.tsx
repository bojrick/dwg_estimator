import React from 'react';
import { FolderKanban, Plus } from 'lucide-react';

interface ProjectSidebarProps {
  distinctProjects: string[];
  selectedProject: string;
  onSelectProject: (proj: string) => void;
  onOpenCreateProject: () => void;
  plans: any[];
}

export const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  distinctProjects,
  selectedProject,
  onSelectProject,
  onOpenCreateProject,
  plans,
}) => {
  return (
    <aside className="hidden md:block w-64 shrink-0 bg-zinc-900/80 border border-zinc-800 rounded-2xl p-3 space-y-3">
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] font-medium text-zinc-400 flex items-center gap-1.5">
          <FolderKanban className="w-3.5 h-3.5 text-blue-400" />
          Projects ({distinctProjects.length})
        </span>
        <button
          onClick={onOpenCreateProject}
          className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
          title="Create new project"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-1">
        <button
          onClick={() => onSelectProject('ALL')}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition ${
            selectedProject === 'ALL'
              ? 'bg-zinc-100 text-zinc-950 shadow-xs'
              : 'text-zinc-300 hover:bg-zinc-800/70 hover:text-white'
          }`}
        >
          <div className="flex items-center gap-2 truncate">
            <FolderKanban className="w-4 h-4 opacity-70 shrink-0" />
            <span className="truncate">All Plans</span>
          </div>
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] tabular-nums font-mono ${
              selectedProject === 'ALL'
                ? 'bg-black/20 text-zinc-900 font-semibold'
                : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            {plans.length}
          </span>
        </button>

        {distinctProjects.map((proj) => {
          const count = plans.filter((p) => (p.project_name || 'Default Project') === proj).length;
          const isSelected = selectedProject === proj;
          return (
            <button
              key={proj}
              onClick={() => onSelectProject(proj)}
              title={proj}
              className={`group w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition text-left ${
                isSelected
                  ? 'bg-zinc-800 text-white font-medium border border-zinc-700/60'
                  : 'text-zinc-300 hover:bg-zinc-900 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                <FolderKanban
                  className={`w-3.5 h-3.5 shrink-0 ${
                    isSelected ? 'text-blue-400' : 'text-zinc-500 group-hover:text-zinc-400'
                  }`}
                />
                <span className="truncate">{proj}</span>
              </div>
              <span
                className={`ml-1.5 shrink-0 px-1.5 py-0.5 rounded-full text-[10px] tabular-nums font-mono ${
                  isSelected ? 'bg-zinc-700 text-zinc-200' : 'bg-zinc-950 text-zinc-400'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
};

