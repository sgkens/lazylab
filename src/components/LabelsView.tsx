import React, { useState } from 'react';
import { Tag, Plus, Check } from 'lucide-react';
import { GitLabLabel, GitLabProject } from '../types/gitlab';

interface LabelsViewProps {
  labels: GitLabLabel[];
  projects: GitLabProject[];
  selectedProjectId: number | null;
  onCreateLabel: (projectId: number, name: string, color: string, description?: string) => void;
}

const COLOR_PRESETS = [
  '#EF4444', // Red / Urgent
  '#F59E0B', // Amber / Priority
  '#10B981', // Emerald / Success
  '#06B6D4', // Cyan / Infra
  '#6366F1', // Indigo / Core
  '#8B5CF6', // Purple / Architecture
  '#EC4899', // Pink / Frontend
  '#64748B'  // Slate / Triage
];

export const LabelsView: React.FC<LabelsViewProps> = ({
  labels,
  projects,
  selectedProjectId,
  onCreateLabel
}) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedColor, setSelectedColor] = useState(COLOR_PRESETS[0]);
  const [targetProjectId, setTargetProjectId] = useState<number>(
    selectedProjectId || (projects.length > 0 ? projects[0].id : 0)
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !targetProjectId) return;
    onCreateLabel(targetProjectId, name.trim(), selectedColor, description.trim() || undefined);
    setName('');
    setDescription('');
    setShowCreateModal(false);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-slate-950 overflow-y-auto">
      {/* Sub-header Bar */}
      <div className="flex items-center justify-between gap-3 px-6 py-2.5 bg-slate-900/40 border-b border-slate-800 text-xs">
        <span className="text-slate-400 font-mono">
          Total Labels Indexed: <span className="text-white font-semibold">{labels.length}</span>
        </span>

        <button
          onClick={() => setShowCreateModal(true)}
          className="px-3 py-1.5 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500 rounded-md transition-colors flex items-center gap-1.5 shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Label</span>
        </button>
      </div>

      {/* Labels Grid */}
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {labels.map((label) => (
          <div
            key={label.id}
            className="p-4 bg-slate-900/80 border border-slate-800 rounded-xl flex flex-col justify-between hover:border-slate-700 transition-colors"
          >
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span
                  style={{
                    backgroundColor: `${label.color}20`,
                    borderColor: `${label.color}80`,
                    color: label.color
                  }}
                  className="px-2.5 py-1 text-xs font-semibold rounded-md border font-mono flex items-center gap-1.5"
                >
                  <Tag className="w-3 h-3" />
                  <span>{label.name}</span>
                </span>
                <span className="text-[11px] font-mono text-slate-500">{label.color}</span>
              </div>

              <p className="text-xs text-slate-400 mt-2 min-h-[36px] line-clamp-2">
                {label.description || 'No description provided.'}
              </p>
            </div>

            <div className="pt-3 mt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-500">
              <span>Issues: {label.open_issues_count ?? 0}</span>
              <span>MRs: {label.open_merge_requests_count ?? 0}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Create Label Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmit}
            className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-md w-full shadow-2xl"
          >
            <div className="flex items-center gap-2 text-base font-semibold text-white mb-4">
              <Tag className="w-5 h-5 text-orange-400" />
              <span>Create GitLab Label</span>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 font-medium mb-1">Target Project</label>
                <select
                  value={targetProjectId}
                  onChange={(e) => setTargetProjectId(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-orange-500"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name_with_namespace || p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">Label Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. backend, priority/p1, regression"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">Description (Optional)</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief explanation of when to assign this label"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1.5">Color Palette</label>
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  {COLOR_PRESETS.map((hex) => (
                    <button
                      type="button"
                      key={hex}
                      onClick={() => setSelectedColor(hex)}
                      style={{ backgroundColor: hex }}
                      className="w-7 h-7 rounded-full flex items-center justify-center transition-transform hover:scale-110"
                    >
                      {selectedColor === hex && <Check className="w-4 h-4 text-white" />}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={selectedColor}
                  onChange={(e) => setSelectedColor(e.target.value)}
                  className="w-32 bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs font-mono text-slate-200"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-3.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500 rounded-lg transition-colors"
              >
                Create Label
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
