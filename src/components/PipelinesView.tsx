import React, { useState, useEffect } from 'react';
import {
  Workflow,
  CheckCircle,
  XCircle,
  Clock,
  PlayCircle,
  RotateCcw,
  Ban,
  GitCommit,
  GitBranch,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Cpu,
  RefreshCw,
  Play,
  Terminal,
  Award,
  AlertTriangle
} from 'lucide-react';
import { GitLabJob, GitLabPipeline, GitLabProject, JobFailure } from '../types/gitlab';
import { BadgePipelineModal } from './BadgePipelineModal';
import { api } from '../services/api';
import { WatchButton } from './WatchButton';

// Statuses that can still change; only these get a Watch button.
const IN_PROGRESS = new Set(['created', 'waiting_for_resource', 'preparing', 'pending', 'running', 'scheduled']);

interface PipelinesViewProps {
  pipelines: GitLabPipeline[];
  projects: GitLabProject[];
  onRetryPipeline: (pipelineId: number, projectId: number) => void;
  onCancelPipeline: (pipelineId: number, projectId: number) => void;
  onPlayJob: (jobId: number, projectId: number) => void;
  onViewJobTrace?: (projectId: number, jobId: number, jobName?: string) => void;
  onRunPipeline?: () => void;
}

/** The error line of each failed job, so the cause shows without opening a log. */
const PipelineFailures: React.FC<{
  pipeline: GitLabPipeline;
  onOpen?: (projectId: number, jobId: number, jobName?: string) => void;
}> = ({ pipeline, onOpen }) => {
  const [failures, setFailures] = useState<JobFailure[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getPipelineFailures(pipeline.project_id, pipeline.id)
      .then((res) => !cancelled && setFailures(res.failures))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [pipeline.id, pipeline.project_id]);

  if (error) return <p className="text-xs text-slate-500 mb-3">Could not read failed jobs: {error}</p>;
  if (!failures) {
    return (
      <p className="text-xs text-slate-500 mb-3 flex items-center gap-1">
        <RefreshCw className="w-3 h-3 animate-spin" /> Reading failed job logs...
      </p>
    );
  }
  if (failures.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-rose-900/70 bg-rose-950/20 divide-y divide-rose-900/40">
      <div className="px-3 py-2 text-xs font-semibold text-rose-200 flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
        Why it failed
      </div>
      {failures.map((f) => (
        <div key={f.job_id} className="px-3 py-2 flex items-start gap-3 text-xs">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-white">{f.job_name}</span>
              <span className="font-mono text-slate-500">{f.stage}</span>
              {f.excerpt.failureReason && (
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-300">
                  {f.excerpt.failureReason.replace(/_/g, ' ')}
                </span>
              )}
              {f.excerpt.exitCode !== null && <span className="font-mono text-slate-500">exit {f.excerpt.exitCode}</span>}
              {f.excerpt.retryable && (
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-200">likely passes on retry</span>
              )}
            </div>
            <p className="font-mono text-rose-200 mt-1 break-all">{f.excerpt.errorLine || f.excerpt.failureHint || 'No error line found'}</p>
          </div>
          {onOpen && (
            <button
              onClick={() => onOpen(f.project_id, f.job_id, f.job_name)}
              className="px-2 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 shrink-0 flex items-center gap-1"
            >
              <Terminal className="w-3.5 h-3.5" />
              Excerpt
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

export const PipelinesView: React.FC<PipelinesViewProps> = ({
  pipelines,
  projects,
  onRetryPipeline,
  onCancelPipeline,
  onPlayJob,
  onViewJobTrace,
  onRunPipeline
}) => {
  const [expandedPipelineId, setExpandedPipelineId] = useState<number | null>(
    pipelines.length > 0 ? pipelines[0].id : null
  );
  const [pipelineJobs, setPipelineJobs] = useState<Record<number, { stages: string[]; jobs: GitLabJob[] }>>({});
  const [isLoadingJobs, setIsLoadingJobs] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'failed' | 'success'>('all');
  const [isBadgePipelineOpen, setIsBadgePipelineOpen] = useState(false);

  const getProjectName = (projectId: number) => {
    const p = projects.find((proj) => proj.id === projectId);
    return p ? p.name : `proj-${projectId}`;
  };

  const loadJobsForPipeline = async (pipeline: GitLabPipeline) => {
    if (pipelineJobs[pipeline.id]) return;
    try {
      setIsLoadingJobs(true);
      const res = await api.getPipelineJobs(pipeline.project_id, pipeline.id);
      if (res.success) {
        setPipelineJobs((prev) => ({
          ...prev,
          [pipeline.id]: { stages: res.stages, jobs: res.jobs }
        }));
      }
    } catch (err) {
      console.error('Failed loading pipeline jobs:', err);
    } finally {
      setIsLoadingJobs(false);
    }
  };

  useEffect(() => {
    if (expandedPipelineId) {
      const p = pipelines.find((pipe) => pipe.id === expandedPipelineId);
      if (p) loadJobsForPipeline(p);
    }
  }, [expandedPipelineId, pipelines]);

  const toggleExpand = (pipeline: GitLabPipeline) => {
    if (expandedPipelineId === pipeline.id) {
      setExpandedPipelineId(null);
    } else {
      setExpandedPipelineId(pipeline.id);
      loadJobsForPipeline(pipeline);
    }
  };

  const filteredPipelines = pipelines.filter((p) => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    return true;
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-emerald-400" />;
      case 'running':
        return <Clock className="w-4 h-4 text-sky-400 animate-spin" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-rose-500" />;
      case 'canceled':
        return <Ban className="w-4 h-4 text-slate-500" />;
      default:
        return <PlayCircle className="w-4 h-4 text-amber-400" />;
    }
  };

  const getJobStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
        return <span className="w-2 h-2 rounded-full bg-emerald-400" title="Success" />;
      case 'running':
        return <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" title="Running" />;
      case 'failed':
        return <span className="w-2 h-2 rounded-full bg-rose-500" title="Failed" />;
      case 'manual':
        return <span className="w-2 h-2 rounded-full bg-amber-400" title="Manual" />;
      case 'skipped':
        return <span className="w-2 h-2 rounded-full bg-slate-600" title="Skipped" />;
      default:
        return <span className="w-2 h-2 rounded-full bg-slate-500" title={status} />;
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-slate-950 overflow-y-auto">
      {/* Sub-filter Bar */}
      <div className="flex items-center justify-between gap-3 px-6 py-2.5 bg-slate-900/40 border-b border-slate-800 text-xs">
        <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded border border-slate-800">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-2.5 py-1 rounded transition-colors ${
              statusFilter === 'all' ? 'bg-slate-800 text-white font-medium shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All ({pipelines.length})
          </button>
          <button
            onClick={() => setStatusFilter('running')}
            className={`px-2.5 py-1 rounded transition-colors ${
              statusFilter === 'running' ? 'bg-slate-800 text-white font-medium shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Running ({pipelines.filter((p) => p.status === 'running').length})
          </button>
          <button
            onClick={() => setStatusFilter('failed')}
            className={`px-2.5 py-1 rounded transition-colors ${
              statusFilter === 'failed' ? 'bg-slate-800 text-white font-medium shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Failed ({pipelines.filter((p) => p.status === 'failed').length})
          </button>
          <button
            onClick={() => setStatusFilter('success')}
            className={`px-2.5 py-1 rounded transition-colors ${
              statusFilter === 'success' ? 'bg-slate-800 text-white font-medium shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Passed ({pipelines.filter((p) => p.status === 'success').length})
          </button>
        </div>

        {/* Badges Pipeline Setup Action */}
        <div className="flex items-center gap-2">
          {onRunPipeline && (
            <button
              onClick={onRunPipeline}
              className="px-2.5 py-1 rounded bg-orange-600 hover:bg-orange-500 text-white transition-colors flex items-center gap-1.5 font-medium shadow-sm"
              title="Run a pipeline for a branch or tag, with variables"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Run pipeline</span>
            </button>
          )}
          <button
            onClick={() => setIsBadgePipelineOpen(true)}
            className="px-2.5 py-1 rounded bg-purple-950/60 hover:bg-purple-900/80 border border-purple-800/80 text-purple-300 hover:text-white transition-colors flex items-center gap-1.5 font-medium shadow-sm"
            title="Configure CI/CD badges pipeline for tags, develop, and main branches"
          >
            <Award className="w-3.5 h-3.5 text-purple-400" />
            <span>Badges Pipeline (tags · develop · main)</span>
          </button>
        </div>
      </div>

      {filteredPipelines.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center px-4">
          <Workflow className="w-10 h-10 text-slate-600 mb-3" />
          <h3 className="text-sm font-semibold text-slate-300">No pipelines found</h3>
          <p className="text-xs text-slate-500 mt-1">No CI/CD pipelines match the current filter.</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-800/80">
          {filteredPipelines.map((pipeline) => {
            const isExpanded = expandedPipelineId === pipeline.id;
            const currentJobsData = pipelineJobs[pipeline.id];

            return (
              <div key={pipeline.id} className="transition-colors hover:bg-slate-900/30">
                {/* Pipeline Summary Row */}
                <div
                  onClick={() => toggleExpand(pipeline)}
                  className="flex items-center justify-between gap-4 px-6 py-3.5 cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="shrink-0">{getStatusIcon(pipeline.status)}</span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-white">
                          #{pipeline.id}
                        </span>
                        <span className="text-xs font-mono text-slate-500">
                          {getProjectName(pipeline.project_id)}
                        </span>
                        <span className="flex items-center gap-1 text-xs font-mono text-slate-300 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                          <GitBranch className="w-3 h-3 text-slate-500" />
                          <span>{pipeline.ref}</span>
                        </span>
                        <span className="flex items-center gap-1 text-xs font-mono text-slate-400">
                          <GitCommit className="w-3 h-3 text-slate-600" />
                          <span>{pipeline.sha.slice(0, 8)}</span>
                        </span>
                      </div>

                      <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">
                        {pipeline.user && <span>Triggered by {pipeline.user.name}</span>}
                        <span>·</span>
                        <span className="font-mono tabular-nums">
                          Duration: {formatDuration(pipeline.duration)}
                        </span>
                        <span>·</span>
                        <span>
                          {new Date(pipeline.created_at).toLocaleTimeString(undefined, {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions on Pipeline */}
                  <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {IN_PROGRESS.has(pipeline.status) && (
                      <WatchButton kind="pipeline" projectId={pipeline.project_id} targetId={pipeline.id} />
                    )}
                    {pipeline.status === 'running' ? (
                      <button
                        onClick={() => onCancelPipeline(pipeline.id, pipeline.project_id)}
                        className="px-2.5 py-1 text-xs text-rose-400 hover:text-rose-200 hover:bg-rose-950/60 rounded border border-rose-900 transition-colors flex items-center gap-1"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        <span>Cancel</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => onRetryPipeline(pipeline.id, pipeline.project_id)}
                        className="px-2.5 py-1 text-xs text-slate-300 hover:text-white hover:bg-slate-800 rounded border border-slate-700 transition-colors flex items-center gap-1"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Retry</span>
                      </button>
                    )}

                    <a
                      href={pipeline.web_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open Pipeline in GitLab"
                      className="p-1 text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>

                    <button
                      onClick={() => toggleExpand(pipeline)}
                      className="p-1 text-slate-500 hover:text-slate-300"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Expanded Stage & Job DAG Visualizer */}
                {isExpanded && (
                  <div className="px-6 py-4 bg-slate-950/80 border-t border-slate-900">
                    {pipeline.status === 'failed' && <PipelineFailures pipeline={pipeline} onOpen={onViewJobTrace} />}
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Workflow className="w-3.5 h-3.5 text-sky-400" />
                        <span>Pipeline Stages & Job Graph</span>
                      </div>
                      {isLoadingJobs && (
                        <span className="flex items-center gap-1 text-[11px] text-slate-500 font-mono">
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          <span>Fetching graph...</span>
                        </span>
                      )}
                    </div>

                    {currentJobsData && currentJobsData.stages.length > 0 ? (
                      <div className="flex items-start gap-4 overflow-x-auto pb-3 pt-1">
                        {currentJobsData.stages.map((stageName, stageIdx) => {
                          const stageJobs = currentJobsData.jobs.filter((j) => j.stage === stageName);

                          return (
                            <React.Fragment key={stageName}>
                              {/* Stage Column */}
                              <div className="min-w-[190px] max-w-[220px] bg-slate-900/90 border border-slate-800 rounded-lg p-3 shrink-0 shadow-md">
                                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/80">
                                  <span className="text-xs font-semibold text-slate-200 capitalize">
                                    {stageName}
                                  </span>
                                  <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                                    {stageJobs.length} job{stageJobs.length > 1 ? 's' : ''}
                                  </span>
                                </div>

                                <div className="space-y-2">
                                  {stageJobs.map((job) => (
                                    <div
                                      key={job.id}
                                      className="p-2.5 rounded bg-slate-950 border border-slate-800/80 hover:border-slate-700 transition-colors"
                                    >
                                      <div className="flex items-center justify-between gap-1 mb-1">
                                        <div
                                          onClick={() => onViewJobTrace && onViewJobTrace(pipeline.project_id, job.id, job.name)}
                                          className="flex items-center gap-1.5 truncate cursor-pointer hover:text-orange-400 transition-colors"
                                          title="View Terminal CI Output Log"
                                        >
                                          {getJobStatusBadge(job.status)}
                                          <span className="text-xs font-medium text-slate-200 hover:text-orange-400 truncate font-mono">
                                            {job.name}
                                          </span>
                                        </div>

                                        <div className="flex items-center gap-1">
                                          {IN_PROGRESS.has(job.status) && (
                                            <WatchButton kind="job" projectId={pipeline.project_id} targetId={job.id} compact />
                                          )}
                                          {/* Terminal Output Log button */}
                                          {onViewJobTrace && (
                                            <button
                                              onClick={() => onViewJobTrace(pipeline.project_id, job.id, job.name)}
                                              title="View Job Terminal Trace"
                                              className="p-1 rounded text-slate-500 hover:text-orange-400 hover:bg-slate-900 transition-colors"
                                            >
                                              <Terminal className="w-3 h-3" />
                                            </button>
                                          )}

                                          {/* Manual play button */}
                                          {job.status === 'manual' && (
                                            <button
                                              onClick={() => onPlayJob(job.id, pipeline.project_id)}
                                              title="Trigger manual job"
                                              className="p-1 rounded text-amber-400 hover:text-amber-200 hover:bg-amber-950 transition-colors"
                                            >
                                              <Play className="w-3 h-3 fill-current" />
                                            </button>
                                          )}
                                        </div>
                                      </div>

                                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 pt-1">
                                        <span className="capitalize">{job.status}</span>
                                        <span className="tabular-nums">{formatDuration(job.duration)}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Flow Arrow between sequential stages */}
                              {stageIdx < currentJobsData.stages.length - 1 && (
                                <div className="flex items-center justify-center self-center shrink-0 text-slate-600 font-mono text-sm px-1">
                                  →
                                </div>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="py-6 text-center text-xs text-slate-500">
                        {isLoadingJobs ? 'Loading stage visualizer...' : 'No jobs found for this pipeline.'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Badges Pipeline Modal for tags, develop, main */}
      <BadgePipelineModal
        isOpen={isBadgePipelineOpen}
        onClose={() => setIsBadgePipelineOpen(false)}
        projects={projects}
        currentProjectId={pipelines.length > 0 ? pipelines[0].project_id : (projects[0]?.id || 901)}
      />
    </div>
  );
};
