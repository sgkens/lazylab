import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  Circle,
  AlertCircle,
  CheckSquare,
  Flame,
  Target,
  Bookmark,
  MessageSquare,
  ThumbsUp,
  ExternalLink,
  Tag as TagIcon,
  ChevronRight,
  ChevronDown,
  User,
  Plus,
  Send,
  Calendar,
  Check,
  Paperclip,
  Trash2,
  ListTodo,
  CornerDownRight,
  FolderTree
} from 'lucide-react';
import { renderMarkdownToHtml } from '../utils/markdown';
import {
  GitLabLabel,
  GitLabMilestone,
  GitLabNote,
  GitLabProject,
  GitLabWorkItem,
  SubTask,
  WorkItemType
} from '../types/gitlab';
import { MarkdownEditor } from './MarkdownEditor';
import { api } from '../services/api';

interface WorkItemsViewProps {
  workItems: GitLabWorkItem[];
  projects: GitLabProject[];
  labels: GitLabLabel[];
  milestones: GitLabMilestone[];
  onToggleState: (iid: number, projectId: number, currentState: 'opened' | 'closed') => void;
  onUpdateLabels: (iid: number, projectId: number, currentLabels: string[], newLabel: string, isRemove: boolean) => void;
  onSelectWorkItem: (item: GitLabWorkItem) => void;
  selectedItem: GitLabWorkItem | null;
  onCloseDrawer: () => void;
  onOpenCreateModal: () => void;
  onAssignMilestone: (iid: number, projectId: number, milestoneId: number | null) => void;
  onAddSubTask: (projectId: number, issueIid: number, title: string) => void;
  onToggleSubTask: (projectId: number, issueIid: number, subtaskId: number, completed: boolean) => void;
}

export const WorkItemsView: React.FC<WorkItemsViewProps> = ({
  workItems,
  projects,
  labels,
  milestones,
  onToggleState,
  onUpdateLabels,
  onSelectWorkItem,
  selectedItem,
  onCloseDrawer,
  onOpenCreateModal,
  onAssignMilestone,
  onAddSubTask,
  onToggleSubTask
}) => {
  const [stateFilter, setStateFilter] = useState<'all' | 'opened' | 'closed'>('opened');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [labelFilter, setLabelFilter] = useState<string>('all');
  const [isTreeView, setIsTreeView] = useState(true);
  const [collapsedNodes, setCollapsedNodes] = useState<Record<number, boolean>>({});

  // Drawer Notes state
  const [notes, setNotes] = useState<GitLabNote[]>([]);
  const [newCommentBody, setNewCommentBody] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');

  // Fetch comments when selected item changes
  useEffect(() => {
    if (selectedItem) {
      api.getWorkItemNotes(selectedItem.project_id, selectedItem.iid)
        .then((res) => {
          if (res.success) setNotes(res.notes);
        })
        .catch((err) => console.error('Failed fetching notes:', err));
    } else {
      setNotes([]);
      setNewCommentBody('');
    }
  }, [selectedItem]);

  const handleSendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || !newCommentBody.trim()) return;

    setIsSubmittingComment(true);
    try {
      const res = await api.createWorkItemNote(selectedItem.project_id, selectedItem.iid, newCommentBody.trim());
      if (res.success && res.note) {
        setNotes((prev) => [...prev, res.note]);
        setNewCommentBody('');
      }
    } catch (err) {
      console.error('Failed to post comment:', err);
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleCreateSubTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || !newSubtaskTitle.trim()) return;
    onAddSubTask(selectedItem.project_id, selectedItem.iid, newSubtaskTitle.trim());
    setNewSubtaskTitle('');
  };

  const toggleNodeCollapse = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedNodes((prev) => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const filteredItems = workItems.filter((item) => {
    if (stateFilter !== 'all' && item.state !== stateFilter) return false;
    if (typeFilter !== 'all' && item.work_item_type !== typeFilter) return false;
    if (labelFilter !== 'all' && !item.labels.includes(labelFilter)) return false;
    return true;
  });

  const getTypeIcon = (type: WorkItemType) => {
    switch (type) {
      case 'Task':
        return <CheckSquare className="w-3.5 h-3.5 text-blue-400" />;
      case 'Incident':
        return <Flame className="w-3.5 h-3.5 text-rose-500" />;
      case 'Objective':
        return <Target className="w-3.5 h-3.5 text-amber-400" />;
      case 'Key Result':
        return <Bookmark className="w-3.5 h-3.5 text-emerald-400" />;
      default:
        return <Circle className="w-3.5 h-3.5 text-orange-400" />;
    }
  };

  const getProjectName = (projectId: number) => {
    const p = projects.find((proj) => proj.id === projectId);
    return p ? p.name : `proj-${projectId}`;
  };

  const renderMarkdown = (content: string) => {
    try {
      return { __html: renderMarkdownToHtml(content || '') };
    } catch {
      return { __html: content };
    }
  };

  // Group items for tree structure:
  // Root items: Objectives, Issues, Incidents (or items with subtasks/children)
  // Child items: Tasks, Key Results (or child items linked by context)
  const rootItems = filteredItems.filter((item) => {
    if (!isTreeView) return true;
    // In tree mode, Tasks & Key Results are nested under their related parent Issue/Objective if available
    return item.work_item_type === 'Objective' || item.work_item_type === 'Issue' || item.work_item_type === 'Incident';
  });

  const orphanItems = filteredItems.filter((item) => {
    if (!isTreeView) return false;
    return item.work_item_type === 'Task' || item.work_item_type === 'Key Result';
  });

  // Render a standard work item row
  const renderItemCard = (item: GitLabWorkItem, isNestedChild = false) => {
    const isSelected = selectedItem?.id === item.id;
    const isClosed = item.state === 'closed';
    const completedSubtasks = item.subtasks?.filter((s) => s.completed).length ?? 0;
    const totalSubtasks = item.subtasks?.length ?? 0;
    const isCollapsed = collapsedNodes[item.id];
    const hasChildren = totalSubtasks > 0 || (isTreeView && (item.work_item_type === 'Issue' || item.work_item_type === 'Objective'));

    return (
      <div key={item.id} className="transition-all">
        <div
          onClick={() => onSelectWorkItem(item)}
          className={`group flex items-start justify-between gap-4 px-6 py-3.5 hover:bg-zinc-900/50 cursor-pointer transition-colors ${
            isSelected ? 'bg-zinc-900/90 ring-1 ring-inset ring-orange-500/40' : ''
          } ${isNestedChild ? 'bg-zinc-900/30' : ''}`}
        >
          <div className="flex items-start gap-3 min-w-0 flex-1">
            {/* Tree node collapse/expand chevron (only in tree view) */}
            {isTreeView && hasChildren ? (
              <button
                onClick={(e) => toggleNodeCollapse(item.id, e)}
                className="mt-0.5 p-0.5 text-zinc-500 hover:text-orange-400 rounded hover:bg-zinc-800 transition-colors shrink-0"
                title={isCollapsed ? 'Expand child tasks & checklist' : 'Collapse tree node'}
              >
                {isCollapsed ? (
                  <ChevronRight className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            ) : isTreeView ? (
              <span className="w-4 h-4 shrink-0 inline-block" />
            ) : null}

            {/* State check circle button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleState(item.iid, item.project_id, item.state);
              }}
              title={isClosed ? 'Reopen work item' : 'Mark as closed'}
              className="mt-0.5 text-zinc-500 hover:text-orange-400 transition-colors shrink-0"
            >
              {isClosed ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : (
                <Circle className="w-4 h-4 text-zinc-400 hover:text-orange-400" />
              )}
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="flex items-center gap-1 text-[11px] font-mono text-zinc-400 font-medium"
                  title={`Type: ${item.work_item_type}`}
                >
                  {getTypeIcon(item.work_item_type)}
                  <span>{item.work_item_type}</span>
                </span>

                <span className="text-zinc-500 text-xs font-mono">
                  {getProjectName(item.project_id)}#{item.iid}
                </span>

                <h4
                  className={`text-sm font-medium ${
                    isClosed ? 'text-zinc-500 line-through' : 'text-zinc-100 group-hover:text-orange-300'
                  } transition-colors`}
                >
                  {item.title}
                </h4>
              </div>

              {/* Metadata row */}
              <div className="flex items-center gap-3 mt-1.5 text-xs text-zinc-400 flex-wrap">
                {item.milestone && (
                  <span className="flex items-center gap-1 text-amber-300 font-medium">
                    <Target className="w-3 h-3 text-amber-400" />
                    <span>{item.milestone.title}</span>
                  </span>
                )}

                {totalSubtasks > 0 && (
                  <span className="flex items-center gap-1 font-mono text-[11px] text-zinc-400">
                    <ListTodo className="w-3 h-3 text-blue-400" />
                    <span>{completedSubtasks}/{totalSubtasks} tasks</span>
                  </span>
                )}

                {item.weight !== undefined && (
                  <span className="font-mono">Weight: {item.weight}</span>
                )}

                <span>
                  {new Date(item.created_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric'
                  })}
                </span>

                {item.user_notes_count > 0 && (
                  <span className="flex items-center gap-1 font-mono text-[11px] text-zinc-400">
                    <MessageSquare className="w-3 h-3" />
                    {item.user_notes_count}
                  </span>
                )}

                {item.upvotes > 0 && (
                  <span className="flex items-center gap-1 font-mono text-[11px] text-emerald-400">
                    <ThumbsUp className="w-3 h-3" />
                    {item.upvotes}
                  </span>
                )}

                {/* Labels */}
                {item.labels.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {item.labels.map((lbl) => {
                      const match = labels.find((l) => l.name === lbl);
                      const color = match?.color || '#475569';
                      return (
                        <span
                          key={lbl}
                          style={{
                            borderColor: `${color}88`,
                            backgroundColor: `${color}15`,
                            color: color
                          }}
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded border"
                        >
                          {lbl}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right side actions */}
          <div className="flex items-center gap-3 shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
            {item.assignees && item.assignees.length > 0 ? (
              <div className="flex -space-x-1.5">
                {item.assignees.map((a) => (
                  <img
                    key={a.id}
                    src={a.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=64&q=80'}
                    alt={a.name}
                    referrerPolicy="no-referrer"
                    className="w-5 h-5 rounded-full ring-1 ring-zinc-900 object-cover"
                    title={a.name || a.username}
                  />
                ))}
              </div>
            ) : (
              <span className="text-zinc-600" title="Unassigned">
                <User className="w-4 h-4" />
              </span>
            )}

            <a
              href={item.web_url}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in GitLab"
              className="p-1 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>

            <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400" />
          </div>
        </div>

        {/* Tree Children & Subtasks Connector Section (when isTreeView is enabled & not collapsed) */}
        {isTreeView && !isCollapsed && (
          <>
            {/* Subtasks Tree Checklist */}
            {item.subtasks && item.subtasks.length > 0 && (
              <div className="border-l-2 border-zinc-800/80 ml-10 pl-4 py-1.5 space-y-1.5 bg-zinc-950">
                {item.subtasks.map((sub, sIdx) => {
                  const isLast = sIdx === (item.subtasks?.length || 0) - 1;
                  return (
                    <div
                      key={sub.id}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900/40 hover:bg-zinc-900/90 border border-zinc-800/60 transition-colors text-xs font-mono group"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <CornerDownRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-orange-400 shrink-0" />
                      <input
                        type="checkbox"
                        checked={sub.completed}
                        onChange={(e) => {
                          e.stopPropagation();
                          onToggleSubTask(item.project_id, item.iid, sub.id, !sub.completed);
                        }}
                        className="rounded bg-zinc-950 border-zinc-700 text-orange-500 focus:ring-0 cursor-pointer"
                      />
                      <span
                        className={`truncate flex-1 select-none ${
                          sub.completed ? 'line-through text-zinc-500' : 'text-zinc-300'
                        }`}
                      >
                        {sub.title}
                      </span>
                      <span className="text-[10px] text-zinc-600 font-mono">
                        subtask #{sub.id}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Main List Column */}
      <div className="flex-1 flex flex-col min-w-0 bg-zinc-950 overflow-y-auto">
        {/* Sub-filter Bar with Scope Action & Tree View Checkbox */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 bg-zinc-900/40 border-b border-zinc-800 text-xs shrink-0">
          <div className="flex items-center gap-3 flex-wrap">
            {/* State filter buttons */}
            <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded border border-zinc-800">
              <button
                onClick={() => setStateFilter('opened')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  stateFilter === 'opened' ? 'bg-zinc-800 text-white font-medium shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Open ({workItems.filter((i) => i.state === 'opened').length})
              </button>
              <button
                onClick={() => setStateFilter('closed')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  stateFilter === 'closed' ? 'bg-zinc-800 text-white font-medium shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Closed ({workItems.filter((i) => i.state === 'closed').length})
              </button>
              <button
                onClick={() => setStateFilter('all')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  stateFilter === 'all' ? 'bg-zinc-800 text-white font-medium shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                All ({workItems.length})
              </button>
            </div>

            {/* Type & Label dropdowns */}
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">Type:</span>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 text-zinc-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-orange-500 font-mono"
              >
                <option value="all">All Types</option>
                <option value="Issue">Issue</option>
                <option value="Task">Task</option>
                <option value="Incident">Incident</option>
                <option value="Objective">Objective</option>
                <option value="Key Result">Key Result</option>
              </select>

              <span className="text-zinc-500 ml-2">Label:</span>
              <select
                value={labelFilter}
                onChange={(e) => setLabelFilter(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 text-zinc-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-orange-500 max-w-[130px] truncate font-mono"
              >
                <option value="all">All Labels</option>
                {labels.map((l) => (
                  <option key={l.id} value={l.name}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Tree View Toggle Option (Can be disabled / unchecked to un-group items) */}
            <label
              className={`flex items-center gap-1.5 cursor-pointer text-xs font-mono select-none px-2.5 py-1 rounded border transition-colors ${
                isTreeView
                  ? 'bg-orange-950/40 text-orange-300 border-orange-800/80 font-semibold'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
              }`}
              title="Toggle subtle tree hierarchy view with subtask branches or uncheck to un-group"
            >
              <input
                type="checkbox"
                checked={isTreeView}
                onChange={(e) => setIsTreeView(e.target.checked)}
                className="rounded bg-zinc-950 border-zinc-700 text-orange-600 focus:ring-0 cursor-pointer"
              />
              <FolderTree className="w-3.5 h-3.5" />
              <span>Tree View</span>
            </label>
          </div>

          {/* Scope New Item Button (Kept in scope as requested!) */}
          <button
            onClick={onOpenCreateModal}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500 active:bg-orange-700 rounded-md transition-colors flex items-center gap-1.5 shadow-sm shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Work Item</span>
          </button>
        </div>

        {/* Work items list */}
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-4">
            <AlertCircle className="w-10 h-10 text-zinc-600 mb-3" />
            <h3 className="text-sm font-semibold text-zinc-300">No work items found</h3>
            <p className="text-xs text-zinc-500 mt-1 max-w-sm">
              No work items match the current state or label filter.
            </p>
            <button
              onClick={onOpenCreateModal}
              className="mt-4 px-3 py-1.5 text-xs bg-orange-600 hover:bg-orange-500 text-white rounded font-medium transition-colors flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create First Work Item</span>
            </button>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/80">
            {isTreeView ? (
              <>
                {/* Tree View: Roots with nested subtasks & child items */}
                {rootItems.map((item) => renderItemCard(item, false))}
                {orphanItems.length > 0 && (
                  <div className="pt-2">
                    <div className="px-6 py-2 bg-zinc-900/40 text-[11px] font-mono text-zinc-500 uppercase tracking-wider border-t border-b border-zinc-800">
                      Standalone Tasks & Key Results
                    </div>
                    {orphanItems.map((item) => renderItemCard(item, false))}
                  </div>
                )}
              </>
            ) : (
              // Flat View: Ungrouped items as requested
              filteredItems.map((item) => renderItemCard(item, false))
            )}
          </div>
        )}
      </div>

      {/* Enhanced Inspection Drawer on right side */}
      {selectedItem && (
        <div className="w-[450px] border-l border-zinc-800 bg-zinc-950 p-6 flex flex-col justify-between overflow-y-auto shrink-0 shadow-2xl">
          <div className="space-y-5">
            {/* Drawer Header */}
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <span className="text-xs font-mono text-zinc-400">
                {getProjectName(selectedItem.project_id)}#{selectedItem.iid}
              </span>
              <div className="flex items-center gap-2">
                <a
                  href={selectedItem.web_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1 font-medium"
                >
                  <span>GitLab</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
                <button
                  onClick={onCloseDrawer}
                  className="text-zinc-400 hover:text-zinc-200 text-xs px-1.5 py-0.5 rounded hover:bg-zinc-800"
                >
                  ✕
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                {getTypeIcon(selectedItem.work_item_type)}
                <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                  {selectedItem.work_item_type}
                </span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                    selectedItem.state === 'closed'
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : 'bg-orange-950 text-orange-300 border border-orange-800'
                  }`}
                >
                  {selectedItem.state}
                </span>
              </div>
              <h3 className="text-base font-semibold text-white leading-snug">{selectedItem.title}</h3>
            </div>

            {/* Milestone Assign Section */}
            <div>
              <label className="text-xs font-semibold text-zinc-400 block mb-1.5 flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5 text-amber-400" />
                <span>Assigned Milestone</span>
              </label>
              <select
                value={selectedItem.milestone?.id ?? ''}
                onChange={(e) => {
                  const val = e.target.value ? Number(e.target.value) : null;
                  onAssignMilestone(selectedItem.iid, selectedItem.project_id, val);
                }}
                className="w-full bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-orange-500 font-mono"
              >
                <option value="">No Milestone</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title} ({m.project_name || 'Project'})
                  </option>
                ))}
              </select>
            </div>

            {/* Styled Markdown Description */}
            <div>
              <label className="text-xs font-semibold text-zinc-400 block mb-1.5">Description</label>
              <div
                className="p-3.5 bg-zinc-900/60 border border-zinc-800 rounded-lg text-xs text-zinc-200 leading-relaxed font-sans max-h-56 overflow-y-auto prose prose-invert max-w-none prose-p:my-1 prose-headings:my-1.5 prose-pre:my-1"
                dangerouslySetInnerHTML={renderMarkdown(selectedItem.description)}
              />
            </div>

            {/* Sub-tasks Section */}
            <div className="pt-3 border-t border-zinc-800">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                  <ListTodo className="w-3.5 h-3.5 text-blue-400" />
                  <span>Sub-tasks & Checklist</span>
                </label>
                <span className="text-[11px] font-mono text-zinc-500">
                  {selectedItem.subtasks?.filter((s) => s.completed).length ?? 0}/
                  {selectedItem.subtasks?.length ?? 0} done
                </span>
              </div>

              {/* Sub-task checklist */}
              <div className="space-y-1.5 mb-3">
                {selectedItem.subtasks && selectedItem.subtasks.length > 0 ? (
                  selectedItem.subtasks.map((task) => (
                    <label
                      key={task.id}
                      className="flex items-center gap-2 p-2 rounded bg-zinc-900/80 border border-zinc-800 hover:border-zinc-700 cursor-pointer text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={task.completed}
                        onChange={(e) =>
                          onToggleSubTask(selectedItem.project_id, selectedItem.iid, task.id, e.target.checked)
                        }
                        className="rounded bg-zinc-950 border-zinc-700 text-orange-500 focus:ring-0"
                      />
                      <span className={`flex-1 ${task.completed ? 'line-through text-zinc-500' : 'text-zinc-200'}`}>
                        {task.title}
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="text-[11px] text-zinc-500 italic">No sub-tasks added yet.</p>
                )}
              </div>

              {/* Add subtask input */}
              <form onSubmit={handleCreateSubTask} className="flex items-center gap-2">
                <input
                  type="text"
                  value={newSubtaskTitle}
                  onChange={(e) => setNewSubtaskTitle(e.target.value)}
                  placeholder="Add a new sub-task..."
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  disabled={!newSubtaskTitle.trim()}
                  className="px-2.5 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 rounded font-medium transition-colors"
                >
                  Add
                </button>
              </form>
            </div>

            {/* Labels section */}
            <div>
              <label className="text-xs font-semibold text-zinc-400 block mb-1.5">Labels</label>
              <div className="flex flex-wrap gap-1.5">
                {selectedItem.labels.map((lbl) => (
                  <span
                    key={lbl}
                    className="text-xs px-2 py-0.5 rounded bg-zinc-900 text-zinc-200 border border-zinc-800 flex items-center gap-1.5"
                  >
                    <span>{lbl}</span>
                    <button
                      onClick={() =>
                        onUpdateLabels(selectedItem.iid, selectedItem.project_id, selectedItem.labels, lbl, true)
                      }
                      className="text-zinc-500 hover:text-red-400 font-bold"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Discussion & Comments with Drag & Drop */}
            <div className="pt-4 border-t border-zinc-800">
              <label className="text-xs font-semibold text-zinc-300 block mb-2 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-orange-400" />
                <span>Discussion & Attachments ({notes.length})</span>
              </label>

              {/* Comments list */}
              <div className="space-y-3 mb-4 max-h-56 overflow-y-auto">
                {notes.map((n) => (
                  <div key={n.id} className="p-3 bg-zinc-900/70 border border-zinc-800 rounded-lg text-xs space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-zinc-300">@{n.author.username}</span>
                        {n.system && <span className="text-[10px] text-zinc-600">(system)</span>}
                      </div>
                      <span className="font-mono">{new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>

                    <div
                      className="text-zinc-300 prose prose-invert max-w-none text-xs leading-relaxed"
                      dangerouslySetInnerHTML={renderMarkdown(n.body)}
                    />

                    {n.attachment && (
                      <div className="pt-2">
                        {n.attachment.type?.startsWith('image/') || n.attachment.name.match(/\.(png|jpg|jpeg|gif)$/i) ? (
                          <img
                            src={n.attachment.url}
                            alt={n.attachment.name}
                            referrerPolicy="no-referrer"
                            className="max-h-36 rounded border border-zinc-800 object-cover"
                          />
                        ) : (
                          <a
                            href={n.attachment.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-orange-400 hover:underline flex items-center gap-1"
                          >
                            <Paperclip className="w-3.5 h-3.5" />
                            <span>{n.attachment.name}</span>
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Markdown Editor for Comment */}
              <form onSubmit={handleSendComment} className="space-y-2">
                <MarkdownEditor
                  value={newCommentBody}
                  onChange={setNewCommentBody}
                  placeholder="Leave a comment or drop screenshot here..."
                  minHeight="80px"
                  allowAttachments={true}
                />
                <div className="flex items-center justify-end">
                  <button
                    type="submit"
                    disabled={isSubmittingComment || !newCommentBody.trim()}
                    className="px-3.5 py-1.5 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{isSubmittingComment ? 'Sending...' : 'Post Comment'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Bottom State Switcher */}
          <div className="pt-4 mt-4 border-t border-zinc-800">
            <button
              onClick={() =>
                onToggleState(selectedItem.iid, selectedItem.project_id, selectedItem.state)
              }
              className={`w-full py-2 px-3 rounded text-xs font-medium flex items-center justify-center gap-2 transition-colors ${
                selectedItem.state === 'closed'
                  ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                  : 'bg-emerald-700 hover:bg-emerald-600 text-white'
              }`}
            >
              {selectedItem.state === 'closed' ? (
                <>
                  <Circle className="w-3.5 h-3.5" />
                  <span>Reopen Work Item</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Close Work Item</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
