import React, { useState } from 'react';
import {
  Cpu,
  Pause,
  Play,
  Plus,
  Trash2,
  FolderPlus,
  X,
  Server,
  Tag,
  Check,
  Activity,
  Terminal,
  Clock,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  CheckCircle,
  XCircle
} from 'lucide-react';
import { GitLabProject, GitLabRunner, RunnerJob } from '../types/gitlab';
import { api } from '../services/api';
import { reportError } from '../utils/reportError';

interface RunnersViewProps {
  runners: GitLabRunner[];
  projects: GitLabProject[];
  onToggleRunner: (runnerId: number, currentPaused: boolean) => void;
  onOpenRegisterModal: () => void;
  onAssignRunner: (runnerId: number, projectId: number) => void;
  onUnassignRunner: (runnerId: number, projectId: number) => void;
  onStopRunner: (runnerId: number) => void;
  onViewJobTrace?: (projectId: number, jobId: number, jobName?: string) => void;
}

export const RunnersView: React.FC<RunnersViewProps> = ({
  runners,
  projects,
  onToggleRunner,
  onOpenRegisterModal,
  onAssignRunner,
  onUnassignRunner,
  onStopRunner,
  onViewJobTrace
}) => {
  const [tagFilter, setTagFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [assigningRunnerId, setAssigningRunnerId] = useState<number | null>(null);
  const [targetProjectId, setTargetProjectId] = useState<number>(projects.length > 0 ? projects[0].id : 0);

  // Lazy-loaded runner jobs to save API hits!
  const [expandedRunnerId, setExpandedRunnerId] = useState<number | null>(null);
  const [runnerJobs, setRunnerJobs] = useState<Record<number, RunnerJob[]>>({});
  const [isLoadingJobs, setIsLoadingJobs] = useState<Record<number, boolean>>({});

  const allTags = Array.from(new Set(runners.flatMap((r) => r.tag_list)));

  const filteredRunners = runners.filter((r) => {
    if (tagFilter !== 'all' && !r.tag_list.includes(tagFilter)) return false;
    if (typeFilter !== 'all' && r.runner_type !== typeFilter) return false;
    return true;
  });

  const getRunnerTypeLabel = (type: string, isShared: boolean) => {
    if (isShared || type === 'instance_type') return 'Shared Runner';
    if (type === 'group_type') return 'Group Runner';
    return 'Project Specific';
  };

  const getProjectName = (projId: number) => {
    const p = projects.find((proj) => proj.id === projId);
    return p ? p.name : `proj-${projId}`;
  };

  // Lazy-fetch jobs only when user requests details to save API hits!
  const toggleRunnerDetails = async (runnerId: number) => {
    if (expandedRunnerId === runnerId) {
      setExpandedRunnerId(null);
      return;
    }

    setExpandedRunnerId(runnerId);

    // If already loaded, don't re-query
    if (runnerJobs[runnerId]) return;

    try {
      setIsLoadingJobs((prev) => ({ ...prev, [runnerId]: true }));
      const res = await api.getRunnerJobs(runnerId);
      if (res.success) {
        setRunnerJobs((prev) => ({ ...prev, [runnerId]: res.jobs }));
      }
    } catch (err) {
      reportError('Could not load runner jobs', err);
    } finally {
      setIsLoadingJobs((prev) => ({ ...prev, [runnerId]: false }));
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <Clock className="w-3.5 h-3.5 text-sky-400 animate-spin" />;
      case 'success':
        return <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />;
      case 'failed':
        return <XCircle className="w-3.5 h-3.5 text-rose-500" />;
      default:
        return <Activity className="w-3.5 h-3.5 text-zinc-400" />;
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-zinc-950 overflow-y-auto">
      {/* Sub-header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 bg-zinc-900/40 border-b border-zinc-800 text-xs shrink-0">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-zinc-500">Fleet Scope:</span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 text-zinc-200 rounded px-2.5 py-1 text-xs focus:outline-none focus:border-orange-500 font-mono"
            >
              <option value="all">All Runners ({runners.length})</option>
              <option value="instance_type">Instance / Shared</option>
              <option value="group_type">Group Runners</option>
              <option value="project_type">Project Specific</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-zinc-500">Filter Tag:</span>
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 text-zinc-200 rounded px-2.5 py-1 text-xs focus:outline-none focus:border-orange-500 font-mono"
            >
              <option value="all">All Tags</option>
              {allTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={onOpenRegisterModal}
          className="px-3 py-1.5 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 rounded-md transition-colors flex items-center gap-1.5 shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Register Runner</span>
        </button>
      </div>

      {filteredRunners.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center px-4">
          <Cpu className="w-10 h-10 text-zinc-600 mb-3" />
          <h3 className="text-sm font-semibold text-zinc-300">No runners available</h3>
          <p className="text-xs text-zinc-500 mt-1">No CI/CD runners match the chosen filter.</p>
        </div>
      ) : (
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
          {filteredRunners.map((runner) => {
            const isPaused = runner.paused || !runner.active;
            const isOnline = runner.status === 'online' && !isPaused;
            const isExpanded = expandedRunnerId === runner.id;
            const jobs = runnerJobs[runner.id] || [];
            const loadingJobs = isLoadingJobs[runner.id];

            return (
              <div
                key={runner.id}
                className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-4 flex flex-col justify-between hover:border-zinc-700 transition-colors shadow-sm"
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                          isOnline
                            ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50'
                            : isPaused
                            ? 'bg-amber-500'
                            : 'bg-zinc-600'
                        }`}
                      />
                      <span className="text-sm font-semibold text-white truncate" title={runner.description}>
                        {runner.description}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* Pause / Resume Button */}
                      <button
                        onClick={() => onToggleRunner(runner.id, !isPaused)}
                        title={isPaused ? 'Resume Runner' : 'Pause Runner'}
                        className={`p-1.5 rounded-lg border transition-colors ${
                          isPaused
                            ? 'bg-amber-950/60 text-amber-300 border-amber-800 hover:bg-amber-900/60'
                            : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700'
                        }`}
                      >
                        {isPaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5" />}
                      </button>

                      {/* Stop / Delete runner */}
                      <button
                        onClick={() => {
                          if (confirm(`Are you sure you want to stop/remove runner #${runner.id}?`)) {
                            onStopRunner(runner.id);
                          }
                        }}
                        title="Stop & remove runner"
                        className="p-1.5 rounded-lg border border-zinc-800 bg-zinc-950 text-rose-400 hover:bg-rose-950/40 hover:border-rose-900 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono mb-3">
                    <span className="text-zinc-300">{getRunnerTypeLabel(runner.runner_type, runner.is_shared)}</span>
                    <span>·</span>
                    <span className="text-zinc-500">#{runner.id}</span>
                  </div>

                  {/* Architecture & OS specs */}
                  <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800/80 mb-3 space-y-1 text-xs font-mono">
                    <div className="flex items-center justify-between text-zinc-400">
                      <span>Platform:</span>
                      <span className="text-zinc-200">
                        {runner.platform || 'linux'} / {runner.architecture || 'x86_64'}
                      </span>
                    </div>
                    {runner.ip_address && (
                      <div className="flex items-center justify-between text-zinc-400">
                        <span>IP Address:</span>
                        <span className="text-zinc-300">{runner.ip_address}</span>
                      </div>
                    )}
                    {runner.version && (
                      <div className="flex items-center justify-between text-zinc-400">
                        <span>GitLab Runner:</span>
                        <span className="text-zinc-300">v{runner.version}</span>
                      </div>
                    )}
                  </div>

                  {/* Assigned Projects */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                        Assigned Projects
                      </span>
                      <button
                        onClick={() => setAssigningRunnerId(assigningRunnerId === runner.id ? null : runner.id)}
                        className="text-[11px] text-purple-400 hover:text-purple-300 flex items-center gap-1 font-mono"
                      >
                        <FolderPlus className="w-3 h-3" />
                        <span>Assign</span>
                      </button>
                    </div>

                    {/* Assign popover */}
                    {assigningRunnerId === runner.id && (
                      <div className="p-2 mb-2 bg-zinc-950 border border-zinc-800 rounded-lg flex items-center gap-2">
                        <select
                          value={targetProjectId}
                          onChange={(e) => setTargetProjectId(Number(e.target.value))}
                          className="flex-1 bg-zinc-900 border border-zinc-800 text-zinc-200 rounded px-2 py-1 text-xs"
                        >
                          {projects.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => {
                            onAssignRunner(runner.id, targetProjectId);
                            setAssigningRunnerId(null);
                          }}
                          className="px-2 py-1 bg-purple-600 text-white rounded text-xs font-medium hover:bg-purple-500"
                        >
                          Add
                        </button>
                        <button
                          onClick={() => setAssigningRunnerId(null)}
                          className="text-zinc-400 hover:text-white text-xs px-1"
                        >
                          ✕
                        </button>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-1">
                      {runner.project_ids && runner.project_ids.length > 0 ? (
                        runner.project_ids.map((pid) => (
                          <span
                            key={pid}
                            className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-950 text-zinc-300 border border-zinc-800 flex items-center gap-1"
                          >
                            <span>{getProjectName(pid)}</span>
                            <button
                              onClick={() => onUnassignRunner(runner.id, pid)}
                              title="Unassign project"
                              className="text-zinc-500 hover:text-rose-400 ml-0.5"
                            >
                              ×
                            </button>
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] text-zinc-500 font-mono">
                          {runner.is_shared ? 'Available to all projects' : 'No specific project assigned'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Tags */}
                  <div className="mb-3">
                    <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider block mb-1.5">
                      Execution Tags
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {runner.tag_list.length > 0 ? (
                        runner.tag_list.map((tag) => (
                          <span
                            key={tag}
                            className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700"
                          >
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] text-zinc-600 font-mono">Untagged (accepts all jobs)</span>
                      )}
                    </div>
                  </div>

                  {/* Runner Jobs Tracker (Lazy fetched on click to save API hits!) */}
                  <div className="mt-2 pt-2 border-t border-zinc-800">
                    <button
                      onClick={() => toggleRunnerDetails(runner.id)}
                      className="w-full py-1.5 px-2 bg-zinc-950 hover:bg-zinc-800 rounded-lg text-xs font-mono text-zinc-300 flex items-center justify-between transition-colors border border-zinc-800/80"
                    >
                      <span className="flex items-center gap-1.5 text-orange-400 font-semibold">
                        <Activity className="w-3.5 h-3.5" />
                        <span>Jobs Tracker & CI Output</span>
                      </span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>

                    {isExpanded && (
                      <div className="mt-2 space-y-1.5 animate-in fade-in duration-150">
                        {loadingJobs ? (
                          <div className="py-3 text-center text-xs text-zinc-500 font-mono flex items-center justify-center gap-1.5">
                            <RefreshCw className="w-3 h-3 animate-spin text-orange-400" />
                            <span>Fetching runner jobs...</span>
                          </div>
                        ) : jobs.length === 0 ? (
                          <div className="py-3 text-center text-xs text-zinc-500 font-mono">
                            No active or recent jobs found for this runner.
                          </div>
                        ) : (
                          jobs.map((job) => (
                            <div
                              key={job.id}
                              onClick={() => {
                                if (onViewJobTrace) {
                                  if (job.project_id) onViewJobTrace(job.project_id, job.id, job.name);
                                }
                              }}
                              className="p-2 rounded bg-zinc-950 hover:bg-zinc-900 border border-zinc-800/80 cursor-pointer transition-colors flex items-center justify-between text-xs font-mono group"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span>{getStatusIcon(job.status)}</span>
                                <div className="truncate">
                                  <span className="text-white group-hover:text-orange-400 font-bold block truncate">
                                    {job.name}
                                  </span>
                                  <span className="text-[11px] text-zinc-500">
                                    #{job.id} · {job.stage}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 text-zinc-400 shrink-0">
                                {job.duration && <span>{job.duration}s</span>}
                                <Terminal className="w-3.5 h-3.5 text-zinc-500 group-hover:text-orange-400" />
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-3 mt-3 border-t border-zinc-800/80 flex items-center justify-between text-[11px] font-mono text-zinc-500">
                  <span>State: {isPaused ? 'paused' : 'active'}</span>
                  {runner.contacted_at && (
                    <span>Last ping: {new Date(runner.contacted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
