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
    <aside className="hidden md:block w-64 shrink-0 bg-zinc-900/80 border border-zinc-800 rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
          <FolderKanban className="w-3.5 h-3.5 text-amber-400" />
          Projects ({distinctProjects.length})
        </span>
        <button
          onClick={onOpenCreateProject}
          className="p-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition"
          title="Create new project"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-1">
        <button
          onClick={() => onSelectProject('ALL')}
          className={`w-full min-h-[38px] flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition ${
            selectedProject === 'ALL'
              ? 'bg-zinc-100 text-zinc-950'
              : 'text-zinc-300 hover:bg-zinc-800/70 hover:text-white'
          }`}
        >
          <div className="flex items-center gap-2 truncate">
            <FolderKanban className="w-4 h-4 opacity-70 shrink-0" />
            <span className="truncate">All plans</span>
          </div>
          <span
            className={`px-1.5 py-0.5 rounded-md text-[10px] tabular-nums font-mono ${
              selectedProject === 'ALL'
                ? 'bg-zinc-950/15 text-zinc-900 font-medium'
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
              className={`group w-full min-h-[38px] flex items-center justify-between px-3 py-2 rounded-lg text-xs transition text-left ${
                isSelected
                  ? 'bg-zinc-800 text-zinc-100 font-medium border border-zinc-700/70'
                  : 'text-zinc-300 hover:bg-zinc-800/50 hover:text-white border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                <FolderKanban
                  className={`w-3.5 h-3.5 shrink-0 ${
                    isSelected ? 'text-amber-400' : 'text-zinc-500 group-hover:text-zinc-400'
                  }`}
                />
                <span className="truncate">{proj}</span>
              </div>
              <span
                className={`ml-1.5 shrink-0 px-1.5 py-0.5 rounded-md text-[10px] tabular-nums font-mono ${
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

