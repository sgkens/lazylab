import React, { useState } from 'react';
import { Layers, Plus, X, Target } from 'lucide-react';
import { GitLabLabel, GitLabMilestone, GitLabProject, WorkItemType } from '../types/gitlab';
import { MarkdownEditor } from './MarkdownEditor';

interface CreateWorkItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: GitLabProject[];
  labels: GitLabLabel[];
  milestones: GitLabMilestone[];
  selectedProjectId: number | null;
  onCreate: (payload: {
    projectId: number;
    title: string;
    description?: string;
    issue_type: WorkItemType;
    labels?: string[];
    weight?: number;
    milestone_id?: number;
  }) => void;
}

export const CreateWorkItemModal: React.FC<CreateWorkItemModalProps> = ({
  isOpen,
  onClose,
  projects,
  labels,
  milestones,
  selectedProjectId,
  onCreate
}) => {
  const [projectId, setProjectId] = useState<number>(
    selectedProjectId || (projects.length > 0 ? projects[0].id : 0)
  );
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [issueType, setIssueType] = useState<WorkItemType>('Issue');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<number | undefined>(undefined);
  const [weight, setWeight] = useState<number | undefined>(undefined);

  if (!isOpen) return null;

  const toggleLabel = (labelName: string) => {
    if (selectedLabels.includes(labelName)) {
      setSelectedLabels(selectedLabels.filter((l) => l !== labelName));
    } else {
      setSelectedLabels([...selectedLabels, labelName]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !projectId) return;

    onCreate({
      projectId,
      title: title.trim(),
      description: description.trim() || undefined,
      issue_type: issueType,
      labels: selectedLabels.length > 0 ? selectedLabels : undefined,
      weight,
      milestone_id: selectedMilestoneId
    });

    setTitle('');
    setDescription('');
    setSelectedLabels([]);
    setSelectedMilestoneId(undefined);
    setWeight(undefined);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2 text-base font-semibold text-white">
            <Layers className="w-5 h-5 text-orange-400" />
            <span>Create Work Item</span>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4 text-xs flex-1">
          <div>
            <label className="block text-zinc-400 font-medium mb-1">Target Project</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(Number(e.target.value))}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-orange-500"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name_with_namespace || p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-zinc-400 font-medium mb-1">Work Item Type</label>
              <select
                value={issueType}
                onChange={(e) => setIssueType(e.target.value as WorkItemType)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-orange-500"
              >
                <option value="Issue">Issue</option>
                <option value="Task">Task</option>
                <option value="Incident">Incident</option>
                <option value="Objective">Objective</option>
                <option value="Key Result">Key Result</option>
              </select>
            </div>

            <div>
              <label className="block text-zinc-400 font-medium mb-1">Milestone (Optional)</label>
              <select
                value={selectedMilestoneId ?? ''}
                onChange={(e) => setSelectedMilestoneId(e.target.value ? Number(e.target.value) : undefined)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-orange-500"
              >
                <option value="">No Milestone</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-zinc-400 font-medium mb-1">Weight / Estimate</label>
              <input
                type="number"
                min="0"
                max="100"
                value={weight ?? ''}
                onChange={(e) => setWeight(e.target.value ? Number(e.target.value) : undefined)}
                placeholder="e.g. 5"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-orange-500 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-zinc-400 font-medium mb-1">Title</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Fix memory leak in WebSocket listener"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-orange-500 text-sm font-medium"
            />
          </div>

          <div>
            <label className="block text-zinc-400 font-medium mb-1">Description (Markdown & Attachments)</label>
            <MarkdownEditor
              value={description}
              onChange={setDescription}
              placeholder="Write description with checklist (- [ ]), code blocks, or drop screenshots..."
              minHeight="120px"
              allowAttachments={true}
            />
          </div>

          <div>
            <label className="block text-zinc-400 font-medium mb-1.5">Assign Labels</label>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-2 bg-zinc-950 rounded-lg border border-zinc-800">
              {labels.map((l) => {
                const isSelected = selectedLabels.includes(l.name);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => toggleLabel(l.name)}
                    className={`text-[11px] px-2 py-0.5 rounded border transition-colors flex items-center gap-1 ${
                      isSelected
                        ? 'bg-orange-950 text-orange-200 border-orange-700 font-medium'
                        : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: l.color }} />
                    <span>{l.name}</span>
                    {isSelected && <span className="ml-1 text-orange-400">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Work Item</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
