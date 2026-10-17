import React, { useMemo } from 'react';
import {
  AlertTriangle,
  Bell,
  CircleDot,
  ExternalLink,
  GitPullRequest,
  Hourglass,
  Inbox as InboxIcon,
  RefreshCw,
  UserCheck,
  Zap
} from 'lucide-react';
import { GitLabProject } from '../types/gitlab';
import { Inbox, InboxBucket, InboxItem } from '../types/inbox';
import { WatchButton } from './WatchButton';

interface InboxViewProps {
  inbox: Inbox | null;
  projects: GitLabProject[];
  loading: boolean;
  onRefresh: () => void;
}

const SECTIONS: { bucket: InboxBucket; title: string; hint: string; icon: React.ReactNode; accent: string }[] = [
  {
    bucket: 'action',
    title: 'Needs your action',
    hint: 'Review requests, failed pipelines, conflicts, MRs ready to merge, mentions',
    icon: <Zap className="w-4 h-4 text-orange-400" />,
    accent: 'text-orange-300 bg-orange-950/50 border-orange-800/60'
  },
  {
    bucket: 'waiting',
    title: 'Waiting on others',
    hint: 'Your open MRs that are in review, running CI or still drafts',
    icon: <Hourglass className="w-4 h-4 text-sky-400" />,
    accent: 'text-sky-300 bg-sky-950/50 border-sky-800/60'
  },
  {
    bucket: 'assigned',
    title: 'Assigned to you',
    hint: 'Open issues and To-Dos assigned to you',
    icon: <UserCheck className="w-4 h-4 text-emerald-400" />,
    accent: 'text-emerald-300 bg-emerald-950/50 border-emerald-800/60'
  }
];

const PIPELINE_DOT: Record<string, string> = {
  success: 'bg-emerald-500',
  failed: 'bg-rose-500',
  running: 'bg-sky-500 animate-pulse',
  pending: 'bg-amber-500',
  canceled: 'bg-zinc-500',
  skipped: 'bg-zinc-600',
  manual: 'bg-purple-500'
};

function relativeTime(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function KindIcon({ kind }: { kind: InboxItem['kind'] }) {
  if (kind === 'merge_request') return <GitPullRequest className="w-4 h-4 text-emerald-400 shrink-0" />;
  if (kind === 'issue') return <CircleDot className="w-4 h-4 text-orange-400 shrink-0" />;
  return <Bell className="w-4 h-4 text-zinc-400 shrink-0" />;
}

function InboxRow({ item, projectName, accent }: { item: InboxItem; projectName?: string; accent: string }) {
  const mr = item.merge_request;
  const ref = item.reference || `${projectName ?? `project ${item.project_id}`}${item.kind === 'merge_request' ? '!' : '#'}${item.iid}`;

  return (
    <li className="flex items-start gap-3 px-4 py-3 hover:bg-zinc-900/60 transition-colors">
      <KindIcon kind={item.kind} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold uppercase tracking-wide ${accent}`}>
            {item.reason}
          </span>
          <a
            href={item.web_url}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-zinc-100 hover:text-orange-300 font-medium truncate"
            title={item.title}
          >
            {item.title}
          </a>
        </div>
        <div className="flex items-center gap-2 mt-1 text-[11px] font-mono text-zinc-500 flex-wrap">
          <span>{ref}</span>
          {mr && (
            <>
              <span>·</span>
              <span className="truncate max-w-[16rem]" title={`${mr.source_branch} → ${mr.target_branch}`}>
                {mr.source_branch} → {mr.target_branch}
              </span>
            </>
          )}
          {item.author && item.kind !== 'issue' && (
            <>
              <span>·</span>
              <span>@{item.author.username}</span>
            </>
          )}
          {item.todos.length > 0 && (
            <>
              <span>·</span>
              <span className="flex items-center gap-1 text-amber-400">
                <Bell className="w-3 h-3" />
                {item.todos.length} To-Do{item.todos.length > 1 ? 's' : ''}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0 text-[11px] font-mono text-zinc-500">
        {mr?.pipeline && (
          <a
            href={mr.pipeline.web_url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 hover:text-zinc-200"
            title={`Pipeline #${mr.pipeline.id}: ${mr.pipeline.status}`}
          >
            <span className={`w-2 h-2 rounded-full ${PIPELINE_DOT[mr.pipeline.status] ?? 'bg-zinc-500'}`} />
            {mr.pipeline.status}
          </a>
        )}
        {mr && <WatchButton kind="merge_request" projectId={mr.project_id} targetId={mr.iid} compact />}
        <span className="tabular-nums w-14 text-right">{relativeTime(item.updated_at)}</span>
        <a href={item.web_url} target="_blank" rel="noreferrer" className="hover:text-zinc-200" title="Open in GitLab">
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </li>
  );
}

export const InboxView: React.FC<InboxViewProps> = ({ inbox, projects, loading, onRefresh }) => {
  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const grouped = useMemo(() => {
    const map: Record<InboxBucket, InboxItem[]> = { action: [], waiting: [], assigned: [] };
    for (const item of inbox?.items ?? []) map[item.bucket].push(item);
    return map;
  }, [inbox]);

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-zinc-950 overflow-y-auto">
      <div className="flex items-center justify-between gap-3 px-6 py-2.5 bg-zinc-900/40 border-b border-zinc-800 text-xs">
        <span className="text-zinc-400 font-mono flex items-center gap-2">
          <InboxIcon className="w-3.5 h-3.5 text-orange-400" />
          {inbox?.user ? (
            <>
              Inbox for <span className="text-white font-semibold">@{inbox.user.username}</span>
              <span className="text-zinc-600">·</span>
              <span>updated {relativeTime(new Date(inbox.generatedAt).toISOString())}</span>
            </>
          ) : (
            'Inbox'
          )}
        </span>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="px-3 py-1.5 text-xs font-semibold text-zinc-200 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-60 rounded-md transition-colors flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {inbox && inbox.errors.length > 0 && (
        <div className="mx-6 mt-4 p-3 rounded-lg border border-amber-800/60 bg-amber-950/40 text-xs text-amber-200 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
          <div>
            <p className="font-semibold">Part of the inbox could not be loaded:</p>
            <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-amber-300/90">
              {inbox.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {!inbox && loading && <p className="p-6 text-xs text-zinc-500 font-mono">Loading inbox…</p>}

      {inbox && (
        <div className="p-6 space-y-6">
          {SECTIONS.map((section) => {
            const items = grouped[section.bucket];
            return (
              <section key={section.bucket} className="bg-zinc-900/60 border border-zinc-800 rounded-xl overflow-hidden">
                <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-zinc-800">
                  <div className="flex items-center gap-2">
                    {section.icon}
                    <h2 className="text-sm font-semibold text-white">{section.title}</h2>
                    <span className="text-xs font-mono text-zinc-500 tabular-nums">({items.length})</span>
                  </div>
                  <span className="text-[11px] text-zinc-500 hidden md:inline">{section.hint}</span>
                </header>
                {items.length === 0 ? (
                  <p className="px-4 py-4 text-xs text-zinc-500">Nothing here.</p>
                ) : (
                  <ul className="divide-y divide-zinc-800/70">
                    {items.map((item) => (
                      <InboxRow key={item.key} item={item} projectName={projectNames.get(item.project_id)} accent={section.accent} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};
