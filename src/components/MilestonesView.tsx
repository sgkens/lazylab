import React, { useState } from 'react';
import { Target, Calendar, Plus, CheckCircle, Clock } from 'lucide-react';
import { GitLabMilestone, GitLabProject } from '../types/gitlab';

interface MilestonesViewProps {
  milestones: GitLabMilestone[];
  projects: GitLabProject[];
  selectedProjectId: number | null;
  onCreateMilestone: (payload: {
    projectId: number;
    title: string;
    description?: string;
    due_date?: string;
    start_date?: string;
  }) => void;
}

export const MilestonesView: React.FC<MilestonesViewProps> = ({
  milestones,
  projects,
  selectedProjectId,
  onCreateMilestone
}) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [targetProjectId, setTargetProjectId] = useState<number>(
    selectedProjectId || (projects.length > 0 ? projects[0].id : 0)
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !targetProjectId) return;
    onCreateMilestone({
      projectId: targetProjectId,
      title: title.trim(),
      description: description.trim() || undefined,
      due_date: dueDate || undefined,
      start_date: startDate || undefined
    });
    setTitle('');
    setDescription('');
    setDueDate('');
    setStartDate('');
    setShowCreateModal(false);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-zinc-950 overflow-y-auto">
      {/* Sub-header Bar */}
      <div className="flex items-center justify-between gap-3 px-6 py-2.5 bg-zinc-900/40 border-b border-zinc-800 text-xs">
        <span className="text-zinc-400 font-mono">
          Milestones Tracked: <span className="text-white font-semibold">{milestones.length}</span>
        </span>

        <button
          onClick={() => setShowCreateModal(true)}
          className="px-3 py-1.5 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500 rounded-md transition-colors flex items-center gap-1.5 shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Milestone</span>
        </button>
      </div>

      {/* Milestones Cards Grid */}
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {milestones.map((m) => {
          // Undefined when GitLab issue statistics were unavailable.
          const pct = m.completion_percentage;
          return (
            <div
              key={m.id}
              className="p-5 bg-zinc-900/80 border border-zinc-800 rounded-xl flex flex-col justify-between hover:border-zinc-700 transition-colors shadow-sm"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-amber-400 shrink-0" />
                    <h3 className="text-sm font-semibold text-white">{m.title}</h3>
                  </div>
                  <span className="text-xs font-bold font-mono text-amber-400 tabular-nums">
                    {pct === undefined ? 'n/a' : `${pct}%`}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs text-zinc-500 font-mono mb-3">
                  <span>{m.project_name || 'Project'}</span>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {m.due_date ? new Date(m.due_date).toLocaleDateString() : 'No due date'}
                  </span>
                </div>

                <p className="text-xs text-zinc-400 min-h-[36px] line-clamp-2 leading-relaxed">
                  {m.description || 'No description provided.'}
                </p>

                {/* Progress bar */}
                <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden mt-4">
                  <div
                    className="bg-amber-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct ?? 0}%` }}
                  />
                </div>
              </div>

              <div className="pt-3 mt-4 border-t border-zinc-800/80 flex items-center justify-between text-[11px] font-mono text-zinc-500">
                <span className="flex items-center gap-1 text-emerald-400">
                  <CheckCircle className="w-3 h-3" />
                  <span>{m.closed_issues_count ?? '–'} closed</span>
                </span>
                <span className="flex items-center gap-1 text-zinc-400">
                  <Clock className="w-3 h-3" />
                  <span>{m.open_issues_count ?? '–'} open</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create Milestone Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmit}
            className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-md w-full shadow-2xl space-y-4 text-xs"
          >
            <div className="flex items-center gap-2 text-base font-semibold text-white mb-2">
              <Target className="w-5 h-5 text-amber-400" />
              <span>Create Milestone</span>
            </div>

            <div>
              <label className="block text-zinc-400 font-medium mb-1">Target Project</label>
              <select
                value={targetProjectId}
                onChange={(e) => setTargetProjectId(Number(e.target.value))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-orange-500"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name_with_namespace || p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-zinc-400 font-medium mb-1">Milestone Title</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Sprint 29 - Cache Layer, v2.5 GA"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-orange-500"
              />
            </div>

            <div>
              <label className="block text-zinc-400 font-medium mb-1">Description (Optional)</label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Key outcomes, roadmap themes, or release goals..."
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-zinc-200 focus:outline-none focus:border-orange-500 font-sans"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-zinc-400 font-medium mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-orange-500"
                />
              </div>
              <div>
                <label className="block text-zinc-400 font-medium mb-1">Due Date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-3.5 py-1.5 text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500 rounded-lg transition-colors"
              >
                Create Milestone
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
