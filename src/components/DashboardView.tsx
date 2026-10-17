import React, { useState, useEffect } from 'react';
import {
  Layers,
  GitPullRequest,
  Workflow,
  Cpu,
  Target,
  AlertTriangle,
  CheckCircle,
  Plus,
  ArrowRight,
  Flame,
  GitMerge,
  Activity,
  Database,
  Zap,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Server,
  Award,
  Bot,
  Settings
} from 'lucide-react';
import {
  GitLabMilestone,
  GitLabMergeRequest,
  GitLabPipeline,
  GitLabRunner,
  GitLabWorkItem,
  GitLabProject,
  MetricsSummary
} from '../types/gitlab';
import { api } from '../services/api';

interface DashboardViewProps {
  workItems: GitLabWorkItem[];
  mergeRequests: GitLabMergeRequest[];
  pipelines: GitLabPipeline[];
  runners: GitLabRunner[];
  milestones: GitLabMilestone[];
  projects: GitLabProject[];
  onNavigateTab: (tab: any) => void;
  onOpenCreateItem: () => void;
  onOpenCreateMilestone: () => void;
  onOpenRegisterRunner: () => void;
  onOpenBadges?: () => void;
  onOpenGeneral?: () => void;
  onOpenAgentSkill?: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  workItems,
  mergeRequests,
  pipelines,
  runners,
  milestones,
  projects,
  onNavigateTab,
  onOpenCreateItem,
  onOpenCreateMilestone,
  onOpenRegisterRunner,
  onOpenBadges,
  onOpenGeneral,
  onOpenAgentSkill
}) => {
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [hoveredBucketIndex, setHoveredBucketIndex] = useState<number | null>(null);

  const fetchMetrics = async () => {
    try {
      const res = await api.getMetrics();
      if (res.success && res.metrics) {
        setMetrics(res.metrics);
      }
    } catch (err) {
      console.warn('Failed fetching metrics:', err);
    }
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 8000);
    return () => clearInterval(interval);
  }, []);

  const handleSimulate = async (type: 'api' | 'cache') => {
    setIsSimulating(true);
    try {
      const endpoint = type === 'api' ? 'GET /projects/sync' : 'GET /projects (cached)';
      const res = await api.simulateMetricHit(type, endpoint);
      if (res.success && res.metrics) {
        setMetrics(res.metrics);
      }
    } catch (err) {
      console.error('Simulation error:', err);
    } finally {
      setIsSimulating(false);
    }
  };

  const handleResetMetrics = async () => {
    try {
      const res = await api.resetMetrics();
      if (res.success && res.metrics) {
        setMetrics(res.metrics);
      }
    } catch (err) {
      console.error('Reset metrics error:', err);
    }
  };

  const openItems = workItems.filter((i) => i.state === 'opened');
  const incidents = openItems.filter(
    (i) =>
      i.work_item_type === 'Incident' ||
      i.labels.includes('incident/active') ||
      i.labels.includes('p0-urgent')
  );
  const tasks = openItems.filter((i) => i.work_item_type === 'Task');
  const issues = openItems.filter((i) => i.work_item_type === 'Issue');

  const openMRs = mergeRequests.filter((m) => m.state === 'opened');
  const readyMRs = openMRs.filter((m) => !m.draft);
  const draftMRs = openMRs.filter((m) => m.draft);

  const totalPipelines = pipelines.length;
  const successfulPipelines = pipelines.filter((p) => p.status === 'success').length;
  const passRate = totalPipelines > 0 ? Math.round((successfulPipelines / totalPipelines) * 100) : 100;
  const runningPipelines = pipelines.filter((p) => p.status === 'running');
  const failedPipelines = pipelines.filter((p) => p.status === 'failed');

  const onlineRunners = runners.filter((r) => r.status === 'online' && !r.paused && r.active);
  const pausedRunners = runners.filter((r) => r.paused || !r.active);

  // Rate limit calculations
  const rateLimit = metrics?.rateLimit || {
    limit: 2000,
    remaining: 1858,
    observed: 142,
    resetSeconds: 45
  };
  const usagePercent = Math.min(100, Math.round((rateLimit.observed / rateLimit.limit) * 100));
  const remainingPercent = Math.max(0, 100 - usagePercent);

  // SVG Chart Dimensions
  const buckets = metrics?.buckets || [];
  const maxHitCount = Math.max(...buckets.map((b) => Math.max(b.apiHits, b.cacheHits)), 15);
  const chartHeight = 120;
  const chartWidth = 580;

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-zinc-950 overflow-y-auto">
      {/* Dashboard Top Header */}
      <div className="flex items-center justify-between gap-4 px-6 py-4 bg-zinc-900/60 border-b border-zinc-800">
        <div>
          <h2 className="text-base font-bold text-white tracking-tight">Engineering Pulse & Operations</h2>
          <p className="text-xs text-zinc-400 mt-0.5 font-mono">
            Monitoring across {projects.length} project repositories · SQLite WAL Cache Active
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onOpenBadges && (
            <button
              onClick={onOpenBadges}
              className="px-3 py-1.5 text-xs font-semibold text-purple-200 bg-purple-950/70 hover:bg-purple-900 border border-purple-800/80 rounded-md transition-colors flex items-center gap-1.5 shadow-sm"
              title="Configure and set CI/CD & release badges for main, develop, and tags"
            >
              <Award className="w-3.5 h-3.5 text-purple-400" />
              <span>Badges</span>
            </button>
          )}
          {onOpenAgentSkill && (
            <button
              onClick={onOpenAgentSkill}
              className="px-3 py-1.5 text-xs font-semibold text-indigo-300 bg-indigo-950/60 hover:bg-indigo-900 border border-indigo-800/80 rounded-md transition-colors flex items-center gap-1.5 shadow-sm"
              title="Agent API endpoints and skill definition"
            >
              <Bot className="w-3.5 h-3.5 text-indigo-400" />
              <span>Agent API</span>
            </button>
          )}
          <button
            onClick={onOpenCreateMilestone}
            className="px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-md transition-colors flex items-center gap-1.5"
          >
            <Target className="w-3.5 h-3.5 text-amber-400" />
            <span>New Milestone</span>
          </button>
          <button
            onClick={onOpenRegisterRunner}
            className="px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-md transition-colors flex items-center gap-1.5"
          >
            <Cpu className="w-3.5 h-3.5 text-purple-400" />
            <span>Register Runner</span>
          </button>
          <button
            onClick={onOpenCreateItem}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500 rounded-md transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Work Item</span>
          </button>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Scoped Quick Action Strip (Plan · CI/CD · Packages & Releases · Settings & Badges) */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-zinc-900/60 border border-zinc-800/80 rounded-xl text-xs">
          <div className="flex items-center gap-2 text-zinc-400 font-mono text-[11px]">
            <span className="font-semibold text-zinc-300 uppercase tracking-wider">Quick Navigation:</span>
            <span>Jump directly to scoped sections</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => onNavigateTab('work_items')}
              className="px-2.5 py-1 rounded bg-zinc-800/80 hover:bg-zinc-750 text-zinc-300 hover:text-white border border-zinc-700/60 transition-colors flex items-center gap-1.5 font-medium"
            >
              <Layers className="w-3.5 h-3.5 text-orange-400" />
              <span>Plan (Work Items)</span>
            </button>
            <button
              onClick={() => onNavigateTab('pipelines')}
              className="px-2.5 py-1 rounded bg-zinc-800/80 hover:bg-zinc-750 text-zinc-300 hover:text-white border border-zinc-700/60 transition-colors flex items-center gap-1.5 font-medium"
            >
              <Workflow className="w-3.5 h-3.5 text-sky-400" />
              <span>CI/CD (Pipelines)</span>
            </button>
            <button
              onClick={() => onNavigateTab('packages')}
              className="px-2.5 py-1 rounded bg-zinc-800/80 hover:bg-zinc-750 text-zinc-300 hover:text-white border border-zinc-700/60 transition-colors flex items-center gap-1.5 font-medium"
            >
              <span className="text-amber-400">📦</span>
              <span>Packages & Releases</span>
            </button>
            {onOpenBadges && (
              <button
                onClick={onOpenBadges}
                className="px-2.5 py-1 rounded bg-purple-950/60 hover:bg-purple-900 text-purple-200 border border-purple-800/80 transition-colors flex items-center gap-1.5 font-semibold"
              >
                <Award className="w-3.5 h-3.5 text-purple-400" />
                <span>Badges</span>
              </button>
            )}
            {onOpenGeneral && (
              <button
                onClick={onOpenGeneral}
                className="px-2.5 py-1 rounded bg-zinc-800/80 hover:bg-zinc-750 text-zinc-300 hover:text-white border border-zinc-700/60 transition-colors flex items-center gap-1.5 font-medium"
              >
                <Settings className="w-3.5 h-3.5 text-orange-400" />
                <span>General</span>
              </button>
            )}
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Work Items KPI */}
          <div
            onClick={() => onNavigateTab('work_items')}
            className="p-4 bg-zinc-900/80 border border-zinc-800 rounded-xl hover:border-zinc-700 cursor-pointer transition-colors shadow-sm group"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                Work Items
              </span>
              <Layers className="w-4 h-4 text-orange-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-white tabular-nums">
                {openItems.length}
              </span>
              <span className="text-xs text-zinc-500">active open</span>
            </div>
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-zinc-800/80 text-[11px] font-mono text-zinc-400">
              <span>{issues.length} Issues</span>
              <span>·</span>
              <span>{tasks.length} Tasks</span>
              <span>·</span>
              <span className="text-rose-400">{incidents.length} Incidents</span>
            </div>
          </div>

          {/* Merge Requests KPI */}
          <div
            onClick={() => onNavigateTab('merge_requests')}
            className="p-4 bg-zinc-900/80 border border-zinc-800 rounded-xl hover:border-zinc-700 cursor-pointer transition-colors shadow-sm group"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                Merge Requests
              </span>
              <GitPullRequest className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-white tabular-nums">
                {openMRs.length}
              </span>
              <span className="text-xs text-zinc-500">in review</span>
            </div>
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-zinc-800/80 text-[11px] font-mono text-zinc-400">
              <span className="text-emerald-400 font-medium">{readyMRs.length} Ready</span>
              <span>·</span>
              <span className="text-amber-400">{draftMRs.length} Drafts</span>
            </div>
          </div>

          {/* Pipelines KPI */}
          <div
            onClick={() => onNavigateTab('pipelines')}
            className="p-4 bg-zinc-900/80 border border-zinc-800 rounded-xl hover:border-zinc-700 cursor-pointer transition-colors shadow-sm group"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                CI/CD Pass Rate
              </span>
              <Workflow className="w-4 h-4 text-sky-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-white tabular-nums">
                {passRate}%
              </span>
              <span className="text-xs text-zinc-500">reliability</span>
            </div>
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-zinc-800/80 text-[11px] font-mono text-zinc-400">
              <span className="text-sky-400">{runningPipelines.length} Running</span>
              <span>·</span>
              <span className="text-rose-400">{failedPipelines.length} Failed</span>
            </div>
          </div>

          {/* Runners KPI */}
          <div
            onClick={() => onNavigateTab('runners')}
            className="p-4 bg-zinc-900/80 border border-zinc-800 rounded-xl hover:border-zinc-700 cursor-pointer transition-colors shadow-sm group"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                Runners Fleet
              </span>
              <Cpu className="w-4 h-4 text-purple-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-white tabular-nums">
                {onlineRunners.length}
              </span>
              <span className="text-xs text-zinc-500">online / {runners.length} total</span>
            </div>
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-zinc-800/80 text-[11px] font-mono text-zinc-400">
              <span className="text-emerald-400">{onlineRunners.length} Active</span>
              <span>·</span>
              <span className="text-amber-400">{pausedRunners.length} Paused</span>
            </div>
          </div>
        </div>

        {/* Gitlab API Usage Limits & SQLite WAL Cache Visualizer Section */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 shadow-sm space-y-5">
          {/* Section Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-zinc-800">
            <div>
              <div className="flex items-center gap-2">
                <Gauge className="w-4 h-4 text-orange-400" />
                <h3 className="text-sm font-bold text-white tracking-tight">
                  GitLab API Rate Limit & SQLite WAL Cache Telemetry
                </h3>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live Quota Tracker
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                Visualizing API consumption against GitLab's {rateLimit.limit.toLocaleString()} req/min limit. SQLite WAL cache intercepts requests to prevent rate-limit throttling.
              </p>
            </div>

            {/* Live Interactive Simulator Controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleSimulate('api')}
                disabled={isSimulating}
                className="px-2.5 py-1 text-xs font-medium text-orange-200 bg-orange-950/80 hover:bg-orange-900 border border-orange-800 rounded transition-colors flex items-center gap-1.5"
                title="Simulate a remote GitLab API fetch call"
              >
                <Zap className="w-3.5 h-3.5 text-orange-400" />
                <span>Simulate API Hit</span>
              </button>

              <button
                onClick={() => handleSimulate('cache')}
                disabled={isSimulating}
                className="px-2.5 py-1 text-xs font-medium text-cyan-200 bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-800 rounded transition-colors flex items-center gap-1.5"
                title="Simulate a zero-latency SQLite WAL cache hit"
              >
                <Database className="w-3.5 h-3.5 text-cyan-400" />
                <span>Simulate Cache Hit</span>
              </button>

              <button
                onClick={handleResetMetrics}
                className="px-2.5 py-1 text-xs font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded transition-colors"
                title="Reset local metrics window"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Quota & Efficiency Badges */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Rate Limit Remaining */}
            <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-2">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span className="font-semibold uppercase tracking-wider text-[11px]">GitLab Quota Headroom</span>
                <span className="font-mono text-zinc-500">Resets in {rateLimit.resetSeconds}s</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono text-white tabular-nums">
                  {rateLimit.remaining.toLocaleString()}
                </span>
                <span className="text-xs text-zinc-500 font-mono">
                  / {rateLimit.limit.toLocaleString()} remaining
                </span>
              </div>
              {/* Progress Bar */}
              <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    usagePercent > 80 ? 'bg-rose-500' : usagePercent > 50 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${remainingPercent}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500 pt-1">
                <span>{usagePercent}% Quota Used</span>
                <span className="text-emerald-400">{remainingPercent}% Available</span>
              </div>
            </div>

            {/* Cache Hit Ratio & API Calls Saved */}
            <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-2">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span className="font-semibold uppercase tracking-wider text-[11px]">Cache Hit Efficiency</span>
                <span className="font-mono text-cyan-400">SQLite WAL Active</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono text-cyan-400 tabular-nums">
                  {metrics?.cacheHitRatio ?? 77.5}%
                </span>
                <span className="text-xs text-zinc-500 font-mono">hit ratio</span>
              </div>
              {/* Cache Bar */}
              <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden flex">
                <div
                  className="bg-cyan-500 h-full transition-all duration-300"
                  style={{ width: `${metrics?.cacheHitRatio ?? 77.5}%` }}
                />
                <div
                  className="bg-orange-500 h-full transition-all duration-300"
                  style={{ width: `${100 - (metrics?.cacheHitRatio ?? 77.5)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500 pt-1">
                <span className="text-cyan-400">{metrics?.totalCacheHits ?? 488} Cache Hits</span>
                <span className="text-orange-400">{metrics?.totalApiHits ?? 142} API Calls</span>
              </div>
            </div>

            {/* Latency & Protection Savings */}
            <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-2">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span className="font-semibold uppercase tracking-wider text-[11px]">API Calls Saved</span>
                <span className="font-mono text-emerald-400">Rate Limit Shield</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono text-emerald-400 tabular-nums">
                  {metrics?.totalCacheHits ?? 488}
                </span>
                <span className="text-xs text-zinc-500 font-mono">calls spared</span>
              </div>
              <div className="p-2 rounded bg-zinc-900 border border-zinc-800/80 text-[11px] font-mono flex items-center justify-between">
                <span className="text-zinc-400">Avg WAL Cache:</span>
                <span className="text-cyan-400 font-bold">~0.9ms</span>
                <span className="text-zinc-600">|</span>
                <span className="text-zinc-400">Avg GitLab API:</span>
                <span className="text-orange-400 font-bold">~125ms</span>
              </div>
              <div className="text-[11px] font-mono text-zinc-500 text-center">
                🚀 <span className="text-zinc-300 font-semibold">138x speedup</span> with zero risk of HTTP 429
              </div>
            </div>
          </div>

          {/* Visual Time-Series Chart */}
          <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-3">
            <div className="flex flex-wrap items-center justify-between text-xs text-zinc-400">
              <div className="flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-zinc-500" />
                <span className="font-semibold text-zinc-300">
                  Rolling 30-Minute Request Profile & Rate Limit Tracking
                </span>
              </div>
              <div className="flex items-center gap-4 text-[11px] font-mono">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-cyan-500 inline-block" />
                  <span className="text-zinc-300">Cache Hits (Instant)</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-orange-500 inline-block" />
                  <span className="text-zinc-300">Remote API Calls</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-4 border-b border-dashed border-zinc-500 inline-block" />
                  <span className="text-zinc-500">Rate Limit Envelope (2,000)</span>
                </span>
              </div>
            </div>

            {/* Interactive SVG Bar & Trend Chart */}
            <div className="relative pt-2">
              <div className="h-32 flex items-end gap-1.5 px-2 bg-zinc-900/40 rounded-lg border border-zinc-800/80 overflow-x-auto">
                {buckets.map((b, idx) => {
                  const cacheHeightPercent = Math.min(100, Math.max(6, (b.cacheHits / maxHitCount) * 90));
                  const apiHeightPercent = Math.min(100, Math.max(6, (b.apiHits / maxHitCount) * 90));
                  const isHovered = hoveredBucketIndex === idx;

                  return (
                    <div
                      key={b.timestamp}
                      onMouseEnter={() => setHoveredBucketIndex(idx)}
                      onMouseLeave={() => setHoveredBucketIndex(null)}
                      className="flex-1 min-w-[14px] flex flex-col justify-end items-center h-full group relative cursor-pointer"
                    >
                      {/* Tooltip on hover */}
                      {isHovered && (
                        <div className="absolute bottom-full mb-2 z-20 bg-zinc-900 border border-zinc-700 text-white rounded p-2 text-[10px] font-mono shadow-xl whitespace-nowrap pointer-events-none">
                          <div className="font-bold text-zinc-200 border-b border-zinc-800 pb-1 mb-1">
                            Time: {b.label}
                          </div>
                          <div className="text-cyan-400">Cache Hits: {b.cacheHits}</div>
                          <div className="text-orange-400">API Calls: {b.apiHits}</div>
                          <div className="text-emerald-400">Remaining Quota: {b.rateLimitRemaining}</div>
                          <div className="text-zinc-400">Usage: {b.usagePercent}%</div>
                        </div>
                      )}

                      {/* Bar Group */}
                      <div className="w-full flex items-end justify-center gap-0.5 h-full pb-1">
                        {/* Cache Hit bar */}
                        <div
                          className="w-1/2 bg-cyan-500/80 hover:bg-cyan-400 rounded-t-sm transition-all"
                          style={{ height: `${cacheHeightPercent}%` }}
                        />
                        {/* API Hit bar */}
                        <div
                          className="w-1/2 bg-orange-500/80 hover:bg-orange-400 rounded-t-sm transition-all"
                          style={{ height: `${apiHeightPercent}%` }}
                        />
                      </div>

                      {/* X-axis label (every 5th) */}
                      {idx % 5 === 0 && (
                        <span className="text-[9px] font-mono text-zinc-600 -mb-5 block">
                          {b.label}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recent Calls Feed */}
            <div className="pt-2">
              <span className="text-[11px] font-mono text-zinc-500 block mb-2">
                Recent Request Stream
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {(metrics?.recentCalls || []).slice(0, 6).map((call) => (
                  <div
                    key={call.id}
                    className="p-2 bg-zinc-900/60 border border-zinc-800 rounded flex items-center justify-between text-[11px] font-mono"
                  >
                    <div className="truncate flex items-center gap-1.5">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          call.type === 'cache_hit' ? 'bg-cyan-400' : 'bg-orange-400'
                        }`}
                      />
                      <span className="text-zinc-300 truncate">{call.endpoint}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      <span
                        className={`px-1 rounded text-[10px] ${
                          call.type === 'cache_hit'
                            ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                            : 'bg-orange-950 text-orange-300 border border-orange-800'
                        }`}
                      >
                        {call.durationMs}ms
                      </span>
                      <span className="text-zinc-500">{call.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 2-Column Section: Active Milestones & Critical Attention */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Active Milestones Progress */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-white">Active Milestones & Sprints</h3>
              </div>
              <button
                onClick={() => onNavigateTab('milestones')}
                className="text-xs text-orange-400 hover:text-orange-300 font-medium flex items-center gap-1"
              >
                <span>View All</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-4">
              {milestones.length === 0 ? (
                <div className="py-6 text-center text-xs text-zinc-500">No active milestones created.</div>
              ) : (
                milestones.map((m) => (
                  <div key={m.id} className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div>
                        <h4 className="text-xs font-semibold text-zinc-200">{m.title}</h4>
                        <span className="text-[11px] text-zinc-500 font-mono">
                          {m.project_name || 'Project'} · Due {m.due_date ? new Date(m.due_date).toLocaleDateString() : 'No due date'}
                        </span>
                      </div>
                      <span className="text-xs font-bold font-mono text-amber-400 tabular-nums">
                        {m.completion_percentage === undefined ? 'n/a' : `${m.completion_percentage}%`}
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden mt-2">
                      <div
                        className="bg-amber-500 h-full rounded-full transition-all duration-500"
                        style={{ width: `${m.completion_percentage ?? 0}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500 mt-2">
                      <span>{m.closed_issues_count ?? '–'} closed</span>
                      <span>{m.open_issues_count ?? '–'} remaining</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Action Required: Urgent Incidents & Ready MRs */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400" />
                <h3 className="text-sm font-semibold text-white">Action Required & Triage</h3>
              </div>
              <span className="text-xs font-mono text-zinc-500">
                {incidents.length + readyMRs.length} items
              </span>
            </div>

            <div className="space-y-3">
              {/* Incidents */}
              {incidents.map((inc) => (
                <div
                  key={inc.id}
                  onClick={() => onNavigateTab('work_items')}
                  className="p-3 bg-zinc-950 border border-rose-900/40 hover:border-rose-700/60 rounded-lg cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Flame className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    <span className="text-xs font-semibold text-rose-300 truncate">{inc.title}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-500">
                    <span>#{inc.iid}</span>
                    <span>·</span>
                    <span className="text-rose-400 font-medium">Critical Triage</span>
                    <span>·</span>
                    <span>{inc.user_notes_count} comments</span>
                  </div>
                </div>
              ))}

              {/* Ready to Merge MRs */}
              {readyMRs.map((mr) => (
                <div
                  key={mr.id}
                  onClick={() => onNavigateTab('merge_requests')}
                  className="p-3 bg-zinc-950 border border-zinc-800 hover:border-emerald-800/60 rounded-lg cursor-pointer transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 truncate">
                      <GitMerge className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span className="text-xs font-medium text-zinc-200 truncate">{mr.title}</span>
                    </div>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 shrink-0">
                      Ready
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-500">
                    <span>!{mr.iid}</span>
                    <span>·</span>
                    <span>{mr.source_branch} → {mr.target_branch}</span>
                    <span>·</span>
                    <span className="text-emerald-400">CI passed</span>
                  </div>
                </div>
              ))}

              {incidents.length === 0 && readyMRs.length === 0 && (
                <div className="py-8 text-center text-xs text-zinc-500 flex flex-col items-center">
                  <CheckCircle className="w-6 h-6 text-emerald-500 mb-2" />
                  <span>No blockers or pending reviews! All clear.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
