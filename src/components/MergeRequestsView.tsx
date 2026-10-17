import React, { useState, useEffect, useMemo } from 'react';
import {
  GitPullRequest,
  GitBranch,
  CheckCircle,
  XCircle,
  Clock,
  PlayCircle,
  ExternalLink,
  Tag as TagIcon,
  GitMerge,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  CornerDownRight,
  FolderTree,
  ShieldCheck,
  ThumbsUp,
  FileCode,
  MessageSquare,
  Send,
  Check
} from 'lucide-react';
import { renderMarkdownToHtml } from '../utils/markdown';
import { GitLabLabel, GitLabMergeRequest, GitLabNote, GitLabProject } from '../types/gitlab';
import { MarkdownEditor } from './MarkdownEditor';
import { api } from '../services/api';
import { reportError } from '../utils/reportError';

interface MergeRequestsViewProps {
  mergeRequests: GitLabMergeRequest[];
  projects: GitLabProject[];
  labels: GitLabLabel[];
  onToggleDraft: (iid: number, projectId: number, isDraft: boolean) => void;
  onMerge: (iid: number, projectId: number, options: {
    shouldRemoveSourceBranch: boolean;
    squash: boolean;
    commitMessage?: string;
    squashCommitMessage?: string;
  }) => void;
  onUpdateLabels: (iid: number, projectId: number, currentLabels: string[], label: string, isRemove: boolean) => void;
  onToggleState: (iid: number, projectId: number, currentState: 'opened' | 'closed') => void;
  onApproveMR: (iid: number, projectId: number) => void;
  onUnapproveMR: (iid: number, projectId: number) => void;
  /** Opens this MR in the drawer (from global search). */
  focusMr?: GitLabMergeRequest | null;
}

export const MergeRequestsView: React.FC<MergeRequestsViewProps> = ({
  mergeRequests,
  projects,
  labels,
  onToggleDraft,
  onMerge,
  onUpdateLabels,
  onToggleState,
  onApproveMR,
  onUnapproveMR,
  focusMr
}) => {
  const [stateFilter, setStateFilter] = useState<'all' | 'opened' | 'merged' | 'closed'>('opened');
  const [selectedMR, setSelectedMR] = useState<GitLabMergeRequest | null>(null);
  const [mergeModalMR, setMergeModalMR] = useState<GitLabMergeRequest | null>(null);

  // Merge options form state
  const [deleteSourceBranch, setDeleteSourceBranch] = useState(true);
  const [squashCommits, setSquashCommits] = useState(true);
  const [commitMessage, setCommitMessage] = useState('');
  const [squashCommitMessage, setSquashCommitMessage] = useState('');

  // MR Comments state
  const [mrNotes, setMrNotes] = useState<GitLabNote[]>([]);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [newCommentBody, setNewCommentBody] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [activeLabelMenuIid, setActiveLabelMenuIid] = useState<number | null>(null);

  // Tree View and branch hierarchy grouping
  const [isTreeView, setIsTreeView] = useState(true);
  const [collapsedBranches, setCollapsedBranches] = useState<Record<string, boolean>>({});

  const toggleBranchCollapse = (branch: string) => {
    setCollapsedBranches((prev) => ({
      ...prev,
      [branch]: !prev[branch]
    }));
  };

  useEffect(() => {
    if (!focusMr) return;
    setSelectedMR(focusMr);
    if (stateFilter !== 'all' && focusMr.state !== stateFilter) setStateFilter('all');
  }, [focusMr]);

  // Keep the drawer in step with list updates (draft, labels, state, approval).
  useEffect(() => {
    if (!selectedMR) return;
    const fresh = mergeRequests.find((m) => m.id === selectedMR.id);
    if (fresh && fresh !== selectedMR) setSelectedMR(fresh);
  }, [mergeRequests]);

  // Fetch MR notes on drawer select
  useEffect(() => {
    setCommentError(null);
    if (selectedMR) {
      api.getMergeRequestNotes(selectedMR.project_id, selectedMR.iid)
        .then((res) => {
          if (res.success) setMrNotes(res.notes);
        })
        .catch((err) => reportError('Could not load MR comments', err));
    } else {
      setMrNotes([]);
      setNewCommentBody('');
    }
  }, [selectedMR?.id]);

  const handleSendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMR || !newCommentBody.trim()) return;

    setIsSubmittingComment(true);
    try {
      const res = await api.createMergeRequestNote(selectedMR.project_id, selectedMR.iid, newCommentBody.trim());
      if (res.success && res.note) {
        setMrNotes((prev) => [...prev, res.note]);
        setNewCommentBody('');
      }
    } catch (err: any) {
      setCommentError(err.message || 'Comment failed');
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const openMergeModal = (mr: GitLabMergeRequest) => {
    setMergeModalMR(mr);
    setCommitMessage(`Merge branch '${mr.source_branch}' into '${mr.target_branch}'\n\nCloses !${mr.iid}`);
    setSquashCommitMessage(`${mr.title} (!${mr.iid})`);
  };

  const filteredMRs = mergeRequests.filter((mr) => {
    if (stateFilter !== 'all' && mr.state !== stateFilter) return false;
    return true;
  });

  const getProjectName = (projectId: number) => {
    const p = projects.find((proj) => proj.id === projectId);
    return p ? p.name : `proj-${projectId}`;
  };

  const renderPipelineBadge = (pipeline?: GitLabMergeRequest['pipeline']) => {
    if (!pipeline) return <span className="text-[11px] text-zinc-600 font-mono">no·ci</span>;

    switch (pipeline.status) {
      case 'success':
        return (
          <span className="flex items-center gap-1 text-[11px] font-mono text-emerald-400 font-medium">
            <CheckCircle className="w-3.5 h-3.5" />
            <span>passed</span>
          </span>
        );
      case 'running':
        return (
          <span className="flex items-center gap-1 text-[11px] font-mono text-sky-400 font-medium">
            <Clock className="w-3.5 h-3.5 animate-spin" />
            <span>running</span>
          </span>
        );
      case 'failed':
        return (
          <span className="flex items-center gap-1 text-[11px] font-mono text-rose-400 font-medium">
            <XCircle className="w-3.5 h-3.5" />
            <span>failed</span>
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-[11px] font-mono text-zinc-400">
            <PlayCircle className="w-3.5 h-3.5" />
            <span>{pipeline.status}</span>
          </span>
        );
    }
  };

  const groupedByBranch = useMemo(() => {
    const groups: Record<string, GitLabMergeRequest[]> = {};
    filteredMRs.forEach((mr) => {
      const branch = mr.target_branch || 'main';
      if (!groups[branch]) groups[branch] = [];
      groups[branch].push(mr);
    });
    return groups;
  }, [filteredMRs]);

  const renderMRItem = (mr: GitLabMergeRequest, isNested = false) => {
    const isSelected = selectedMR?.id === mr.id;
    const isMerged = mr.state === 'merged';
    const isClosed = mr.state === 'closed';

    return (
      <div
        key={mr.id}
        onClick={() => setSelectedMR(mr)}
        className={`group flex items-start justify-between gap-4 px-6 py-3.5 hover:bg-zinc-900/50 cursor-pointer transition-colors ${
          isSelected ? 'bg-zinc-900/90 ring-1 ring-inset ring-orange-500/40' : ''
        } ${isNested ? 'bg-zinc-900/20 hover:bg-zinc-900/40' : ''}`}
      >
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {isNested && (
            <CornerDownRight className="w-3.5 h-3.5 text-zinc-600 mt-1 shrink-0" />
          )}

          <span className="mt-0.5 text-zinc-400 shrink-0">
            {isMerged ? (
              <GitMerge className="w-4 h-4 text-purple-400" />
            ) : isClosed ? (
              <XCircle className="w-4 h-4 text-rose-500" />
            ) : (
              <GitPullRequest className="w-4 h-4 text-emerald-400" />
            )}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {mr.draft && (
                <span className="text-[10px] font-mono font-semibold uppercase px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800/80">
                  Draft
                </span>
              )}

              <span className="text-zinc-500 text-xs font-mono">
                {getProjectName(mr.project_id)}!{mr.iid}
              </span>

              <h4 className="text-sm font-medium text-zinc-100 group-hover:text-emerald-300 transition-colors">
                {mr.title}
              </h4>
            </div>

            {/* Branch Flow: source -> target */}
            <div className="flex items-center gap-2 mt-1.5 text-xs text-zinc-400 font-mono">
              <span className="flex items-center gap-1 text-zinc-300 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                <GitBranch className="w-3 h-3 text-zinc-500" />
                <span>{mr.source_branch}</span>
              </span>
              <span className="text-zinc-600">→</span>
              <span className="text-zinc-400 font-semibold">{mr.target_branch}</span>

              <span className="text-zinc-700">·</span>
              {renderPipelineBadge(mr.pipeline)}

              {mr.approved && (
                <>
                  <span className="text-zinc-700">·</span>
                  <span className="text-emerald-400 flex items-center gap-0.5 text-[11px]">
                    <Check className="w-3 h-3" />
                    <span>Approved</span>
                  </span>
                </>
              )}

              <span className="text-zinc-700">·</span>
              <span className="text-zinc-500">
                {new Date(mr.updated_at).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric'
                })}
              </span>
            </div>

            {/* Labels */}
            {mr.labels.length > 0 && (
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {mr.labels.map((lbl) => {
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

        {/* Right actions */}
        <div className="flex items-center gap-2.5 shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
          {/* Approve button */}
          {mr.state === 'opened' && (
            <button
              onClick={() => {
                if (mr.approved) onUnapproveMR(mr.iid, mr.project_id);
                else onApproveMR(mr.iid, mr.project_id);
              }}
              className={`text-[11px] px-2 py-1 rounded border transition-colors flex items-center gap-1 ${
                mr.approved
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
              }`}
            >
              <ThumbsUp className="w-3 h-3" />
              <span>{mr.approved ? 'Approved' : 'Approve'}</span>
            </button>
          )}

          {/* Fast Draft Toggle button */}
          {mr.state === 'opened' && (
            <button
              onClick={() => onToggleDraft(mr.iid, mr.project_id, mr.draft)}
              className={`text-[11px] font-mono px-2 py-1 rounded border transition-colors ${
                mr.draft
                  ? 'bg-zinc-900 text-amber-300 border-amber-800/60 hover:bg-amber-950'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
              }`}
              title={mr.draft ? 'Mark as Ready for review' : 'Mark as Draft (WIP)'}
            >
              {mr.draft ? 'Ready' : 'Draft'}
            </button>
          )}

          {/* Full Merge button */}
          {mr.state === 'opened' && (
            <button
              onClick={() => openMergeModal(mr)}
              className="px-2.5 py-1 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-600 rounded transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <GitMerge className="w-3.5 h-3.5" />
              <span>Merge</span>
            </button>
          )}

          <a
            href={mr.web_url}
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
    );
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* MR Table */}
      <div className="flex-1 flex flex-col min-w-0 bg-zinc-950 overflow-y-auto">
        {/* Sub-filter Bar */}
        <div className="flex items-center justify-between gap-3 px-6 py-2.5 bg-zinc-900/40 border-b border-zinc-800 text-xs shrink-0">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded border border-zinc-800">
              <button
                onClick={() => setStateFilter('opened')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  stateFilter === 'opened' ? 'bg-zinc-800 text-white font-medium shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Open ({mergeRequests.filter((m) => m.state === 'opened').length})
              </button>
              <button
                onClick={() => setStateFilter('merged')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  stateFilter === 'merged' ? 'bg-zinc-800 text-white font-medium shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Merged ({mergeRequests.filter((m) => m.state === 'merged').length})
              </button>
              <button
                onClick={() => setStateFilter('closed')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  stateFilter === 'closed' ? 'bg-zinc-800 text-white font-medium shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Closed ({mergeRequests.filter((m) => m.state === 'closed').length})
              </button>
              <button
                onClick={() => setStateFilter('all')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  stateFilter === 'all' ? 'bg-zinc-800 text-white font-medium shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                All ({mergeRequests.length})
              </button>
            </div>

            {/* Tree View Toggle Option (Can be disabled / unchecked to un-group MRs) */}
            <label
              className={`flex items-center gap-1.5 cursor-pointer text-xs font-mono select-none px-2.5 py-1 rounded border transition-colors ${
                isTreeView
                  ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/80 font-semibold'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
              }`}
              title="Group merge requests hierarchically by target branch tree or un-check to un-group"
            >
              <input
                type="checkbox"
                checked={isTreeView}
                onChange={(e) => setIsTreeView(e.target.checked)}
                className="accent-emerald-500 rounded cursor-pointer w-3.5 h-3.5"
              />
              <FolderTree className="w-3.5 h-3.5" />
              <span>Tree View</span>
            </label>
          </div>
        </div>

        {filteredMRs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-4">
            <GitPullRequest className="w-10 h-10 text-zinc-600 mb-3" />
            <h3 className="text-sm font-semibold text-zinc-300">No merge requests found</h3>
            <p className="text-xs text-zinc-500 mt-1">There are no merge requests matching the selected filter.</p>
          </div>
        ) : isTreeView ? (
          /* Subtle Branch Tree View (Grouped by Target Branch) */
          <div className="space-y-4 p-4">
            {Object.entries(groupedByBranch).map(([targetBranch, branchMRs]) => {
              const isCollapsed = collapsedBranches[targetBranch];

              return (
                <div key={targetBranch} className="border border-zinc-800/90 rounded-lg bg-zinc-900/30 overflow-hidden shadow-sm">
                  {/* Branch Node Header */}
                  <div
                    onClick={() => toggleBranchCollapse(targetBranch)}
                    className="flex items-center justify-between px-4 py-2.5 bg-zinc-900/80 hover:bg-zinc-800/60 cursor-pointer border-b border-zinc-800/70 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleBranchCollapse(targetBranch);
                        }}
                        className="p-0.5 text-zinc-400 hover:text-white rounded"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-emerald-400" />
                        )}
                      </button>

                      <GitBranch className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-mono font-bold text-zinc-200">
                        target: <span className="text-emerald-300">{targetBranch}</span>
                      </span>

                      <span className="text-[11px] font-mono text-zinc-500">
                        ({branchMRs.length} {branchMRs.length === 1 ? 'MR' : 'MRs'})
                      </span>
                    </div>

                    <span className="text-[11px] text-zinc-500 font-mono">
                      {isCollapsed ? 'Click to expand branch' : 'Branch trunk'}
                    </span>
                  </div>

                  {/* Branch Children */}
                  {!isCollapsed && (
                    <div className="divide-y divide-zinc-800/60 pl-2 border-l-2 border-emerald-600/30 ml-4 my-1">
                      {branchMRs.map((mr) => renderMRItem(mr, true))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* Flat Ungrouped List */
          <div className="divide-y divide-zinc-800/80">
            {filteredMRs.map((mr) => renderMRItem(mr, false))}
          </div>
        )}
      </div>

      {/* Enhanced MR Detail Drawer */}
      {selectedMR && (
        <div className="w-[440px] border-l border-zinc-800 bg-zinc-950 p-6 flex flex-col justify-between overflow-y-auto shrink-0 shadow-2xl">
          <div className="space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <span className="text-xs font-mono text-zinc-400">
                {getProjectName(selectedMR.project_id)}!{selectedMR.iid}
              </span>
              <div className="flex items-center gap-2">
                <a
                  href={selectedMR.web_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-medium"
                >
                  <span>GitLab</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
                <button
                  onClick={() => setSelectedMR(null)}
                  className="text-zinc-400 hover:text-zinc-200 text-xs px-1.5 py-0.5 rounded hover:bg-zinc-800"
                >
                  ✕
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium ${
                    selectedMR.state === 'merged'
                      ? 'bg-purple-950 text-purple-300 border border-purple-800'
                      : selectedMR.state === 'closed'
                      ? 'bg-zinc-800 text-zinc-400'
                      : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  }`}
                >
                  {selectedMR.state}
                </span>

                {selectedMR.draft && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-amber-950 text-amber-300 border border-amber-800">
                    Draft / WIP
                  </span>
                )}
              </div>

              <h3 className="text-base font-semibold text-white leading-snug">{selectedMR.title}</h3>
            </div>

            {/* Merge status & Changed Files */}
            <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-zinc-300">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Merge Readiness: {selectedMR.detailed_merge_status || selectedMR.merge_status}</span>
                </div>
                {selectedMR.changes_count && (
                  <span className="text-zinc-500 font-mono text-[11px] flex items-center gap-1">
                    <FileCode className="w-3 h-3" />
                    <span>{selectedMR.changes_count} files changed</span>
                  </span>
                )}
              </div>

              {selectedMR.diff_stats && selectedMR.diff_stats.length > 0 && (
                <div className="space-y-1 pt-2 border-t border-zinc-800 text-[11px] font-mono">
                  {selectedMR.diff_stats.map((d) => (
                    <div key={d.file} className="flex items-center justify-between text-zinc-400">
                      <span className="truncate max-w-[240px]">{d.file}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-emerald-400">+{d.additions}</span>
                        <span className="text-rose-400">-{d.deletions}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Labels */}
            <div>
              <label className="text-xs font-semibold text-zinc-400 block mb-1.5">Labels</label>
              <div className="flex flex-wrap items-center gap-1.5">
                {selectedMR.labels.map((lbl) => (
                  <span key={lbl} className="text-xs px-2 py-0.5 rounded bg-zinc-900 text-zinc-200 border border-zinc-800 flex items-center gap-1.5">
                    <span>{lbl}</span>
                    <button
                      title={`Remove ${lbl}`}
                      onClick={() => onUpdateLabels(selectedMR.iid, selectedMR.project_id, selectedMR.labels, lbl, true)}
                      className="text-zinc-500 hover:text-red-400 font-bold"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) onUpdateLabels(selectedMR.iid, selectedMR.project_id, selectedMR.labels, e.target.value, false);
                  }}
                  className="bg-zinc-900 border border-zinc-800 text-zinc-400 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-emerald-500"
                  aria-label="Add label"
                >
                  <option value="">+ label</option>
                  {labels
                    .filter((l) => !selectedMR.labels.includes(l.name))
                    .map((l) => (
                      <option key={l.id} value={l.name}>
                        {l.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="text-xs font-semibold text-zinc-400 block mb-1">Description</label>
              <div
                className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-lg text-xs text-zinc-200 leading-relaxed font-sans max-h-48 overflow-y-auto prose prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(selectedMR.description || '*No description provided.*') }}
              />
            </div>

            {/* Review Discussion & Comments */}
            <div className="pt-3 border-t border-zinc-800">
              <label className="text-xs font-semibold text-zinc-300 block mb-2 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                <span>Review Comments ({mrNotes.length})</span>
              </label>

              <div className="space-y-2.5 mb-3 max-h-48 overflow-y-auto">
                {mrNotes.map((n) => (
                  <div key={n.id} className="p-2.5 bg-zinc-900/80 border border-zinc-800 rounded-lg text-xs space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                      <span className="font-semibold text-zinc-300">@{n.author.username}</span>
                      <span className="font-mono">{new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div
                      className="text-zinc-300 prose prose-invert max-w-none text-xs"
                      dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(n.body) }}
                    />
                  </div>
                ))}
              </div>

              {/* Add comment */}
              <form onSubmit={handleSendComment} className="space-y-2">
                <MarkdownEditor
                  projectId={selectedMR.project_id}
                  value={newCommentBody}
                  onChange={setNewCommentBody}
                  placeholder="Leave a review comment..."
                  minHeight="70px"
                  allowAttachments={true}
                />
                <div className="flex items-center justify-end gap-3">
                  {commentError && <span className="text-[11px] text-rose-300 mr-auto">{commentError}</span>}
                  <button
                    type="submit"
                    disabled={isSubmittingComment || !newCommentBody.trim()}
                    className="px-3.5 py-1 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <Send className="w-3 h-3" />
                    <span>Comment</span>
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Bottom Actions */}
          {selectedMR.state === 'opened' && (
            <div className="pt-4 mt-4 border-t border-zinc-800 flex flex-col gap-2">
              <button
                onClick={() => openMergeModal(selectedMR)}
                className="w-full py-2 px-3 rounded text-xs font-semibold bg-emerald-700 hover:bg-emerald-600 text-white flex items-center justify-center gap-2 transition-colors"
              >
                <GitMerge className="w-4 h-4" />
                <span>Direct Merge into {selectedMR.target_branch}</span>
              </button>

              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() =>
                    selectedMR.approved
                      ? onUnapproveMR(selectedMR.iid, selectedMR.project_id)
                      : onApproveMR(selectedMR.iid, selectedMR.project_id)
                  }
                  className="py-1.5 px-3 rounded text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-300 transition-colors"
                >
                  {selectedMR.approved ? 'Revoke approval' : 'Approve'}
                </button>
                <button
                  onClick={() => onToggleDraft(selectedMR.iid, selectedMR.project_id, selectedMR.draft)}
                  className="py-1.5 px-3 rounded text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-300 transition-colors"
                >
                  {selectedMR.draft ? 'Mark ready' : 'Mark as draft'}
                </button>
                <button
                  onClick={() => onToggleState(selectedMR.iid, selectedMR.project_id, 'opened')}
                  className="py-1.5 px-3 rounded text-xs font-medium bg-zinc-900 hover:bg-rose-950 text-rose-300 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          )}
          {selectedMR.state === 'closed' && (
            <div className="pt-4 mt-4 border-t border-zinc-800">
              <button
                onClick={() => onToggleState(selectedMR.iid, selectedMR.project_id, 'closed')}
                className="w-full py-1.5 px-3 rounded text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-300 transition-colors"
              >
                Reopen
              </button>
            </div>
          )}
        </div>
      )}

      {/* Advanced Merge Confirmation Modal */}
      {mergeModalMR && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-lg w-full shadow-2xl space-y-4 text-xs">
            <div className="flex items-center gap-2.5 text-base font-semibold text-white">
              <GitMerge className="w-5 h-5 text-emerald-400" />
              <span>Complete Merge Request !{mergeModalMR.iid}</span>
            </div>

            <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
              <div className="text-zinc-200 font-medium">{mergeModalMR.title}</div>
              <div className="text-zinc-500 font-mono mt-1">
                {mergeModalMR.source_branch} → {mergeModalMR.target_branch}
              </div>
            </div>

            {mergeModalMR.pipeline?.status === 'failed' && (
              <div className="p-3 bg-rose-950/70 border border-rose-800 rounded-lg text-rose-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>Warning: The associated pipeline has failed. Merge with caution.</span>
              </div>
            )}

            <div>
              <label className="block text-zinc-400 font-medium mb-1">Merge Commit Message</label>
              <textarea
                rows={2}
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-zinc-200 focus:outline-none focus:border-emerald-500 font-mono text-xs"
              />
            </div>

            <div>
              <label className="flex items-center gap-2 cursor-pointer text-zinc-300 mb-1">
                <input
                  type="checkbox"
                  checked={squashCommits}
                  onChange={(e) => setSquashCommits(e.target.checked)}
                  className="rounded bg-zinc-950 border-zinc-800 text-emerald-500"
                />
                <span className="font-medium">Squash commits into single commit</span>
              </label>
              {squashCommits && (
                <input
                  type="text"
                  value={squashCommitMessage}
                  onChange={(e) => setSquashCommitMessage(e.target.value)}
                  placeholder="Squash commit message"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 font-mono text-xs focus:outline-none focus:border-emerald-500"
                />
              )}
            </div>

            <div>
              <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
                <input
                  type="checkbox"
                  checked={deleteSourceBranch}
                  onChange={(e) => setDeleteSourceBranch(e.target.checked)}
                  className="rounded bg-zinc-950 border-zinc-800 text-emerald-500"
                />
                <span>Delete source branch ({mergeModalMR.source_branch}) after merge</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
              <button
                onClick={() => setMergeModalMR(null)}
                className="px-3.5 py-1.5 text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onMerge(mergeModalMR.iid, mergeModalMR.project_id, {
                    shouldRemoveSourceBranch: deleteSourceBranch,
                    squash: squashCommits,
                    commitMessage: commitMessage.trim() || undefined,
                    squashCommitMessage: squashCommits ? squashCommitMessage.trim() : undefined
                  });
                  setMergeModalMR(null);
                }}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors flex items-center gap-2"
              >
                <GitMerge className="w-3.5 h-3.5" />
                <span>Confirm & Execute Merge</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
