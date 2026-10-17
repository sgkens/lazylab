import React from 'react';
import { FolderGit2, Search, X, Award, Settings } from 'lucide-react';
import { GitLabProject } from '../types/gitlab';

interface ProjectSelectorProps {
  projects: GitLabProject[];
  selectedProjectId: number | null;
  onSelectProject: (id: number | null) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenProjectSettings?: (section?: 'general' | 'badges') => void;
}

export const ProjectSelector: React.FC<ProjectSelectorProps> = ({
  projects,
  selectedProjectId,
  onSelectProject,
  searchQuery,
  onSearchChange,
  onOpenProjectSettings
}) => {
  return (
    <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 px-6 py-2.5 bg-slate-900/60 border-b border-slate-800 text-sm">
      <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap shrink-0 mr-1 flex items-center gap-1">
          <FolderGit2 className="w-3.5 h-3.5" />
          Projects:
        </span>

        <button
          onClick={() => onSelectProject(null)}
          className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 ${
            selectedProjectId === null
              ? 'bg-slate-700 text-white font-medium shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          All Projects ({projects.length})
        </button>

        {projects.map((p) => {
          const isSelected = selectedProjectId === p.id;
          return (
            <button
              key={p.id}
              onClick={() => onSelectProject(p.id)}
              className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                isSelected
                  ? 'bg-orange-950/80 text-orange-200 border border-orange-700/50 font-medium'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-transparent'
              }`}
            >
              <span>{p.name}</span>
              <span className="text-slate-500 font-mono text-[11px] tabular-nums">
                · {p.open_issues_count}
              </span>
            </button>
          );
        })}

        {onOpenProjectSettings && (
          <div className="flex items-center gap-1.5 ml-2 border-l border-zinc-800 pl-2 shrink-0">
            <button
              onClick={() => onOpenProjectSettings('badges')}
              title="Adjust and set repository CI/CD & release badges"
              className="px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 text-purple-300 hover:text-white bg-purple-950/70 hover:bg-purple-900/90 border border-purple-800/80 font-semibold shadow-sm"
            >
              <Award className="w-3.5 h-3.5 text-purple-400" />
              <span>Badges</span>
            </button>
            <button
              onClick={() => onOpenProjectSettings('general')}
              title="Project metadata, topics, default branch, and logo"
              className="px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 text-zinc-300 hover:text-white bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-700"
            >
              <Settings className="w-3.5 h-3.5 text-orange-400" />
              <span>General</span>
            </button>
          </div>
        )}
      </div>

      <div className="relative min-w-[220px]">
        <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Filter items (title, label, #id)..."
          className="w-full bg-slate-950 border border-slate-800 rounded px-8 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-orange-500 transition-colors"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
};
