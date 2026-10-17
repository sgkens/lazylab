import React, { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, CheckCircle2, Eye, Info, Trash2, X, XCircle } from 'lucide-react';
import { LazyNotification, NotifyState, WatchView } from '../types/notify';

interface NotificationCenterProps {
  state: NotifyState | null;
  onMarkRead: () => void;
  onClear: () => void;
  onRemoveWatch: (id: string) => void;
  onOpenSettings: () => void;
  /** Opens the failure view of a job. */
  onOpenFailure: (projectId: number, jobId: number, jobName: string) => void;
}

const LEVEL_ICON = {
  success: <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />,
  failure: <XCircle className="w-4 h-4 text-rose-400 shrink-0" />,
  info: <Info className="w-4 h-4 text-sky-400 shrink-0" />
};

function ago(ts: number) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

type Permission = NotificationPermission | 'unsupported';

function browserPermission(): Permission {
  if (typeof Notification === 'undefined' || !window.isSecureContext) return 'unsupported';
  return Notification.permission;
}

function NotificationRow({ n, onOpenFailure }: { n: LazyNotification; onOpenFailure: NotificationCenterProps['onOpenFailure'] }) {
  const title = <p className={`text-xs ${n.read ? 'text-zinc-300' : 'text-white font-semibold'}`}>{n.title}</p>;
  return (
    <div className="flex items-start gap-2 px-3 py-2 hover:bg-zinc-800/40">
      {LEVEL_ICON[n.level]}
      <div className="flex-1 min-w-0">
        {n.url ? (
          <a href={n.url} target="_blank" rel="noreferrer" className="hover:text-orange-300 block">
            {title}
          </a>
        ) : (
          title
        )}
        <p className="text-[11px] text-zinc-500 whitespace-pre-line line-clamp-2 break-words">{n.body}</p>
        {n.failedJob && (
          <button
            onClick={() => onOpenFailure(n.failedJob!.projectId, n.failedJob!.jobId, n.failedJob!.name)}
            className="mt-1 text-[11px] text-rose-300 hover:text-rose-200 underline underline-offset-2"
          >
            Why it failed
          </button>
        )}
      </div>
      <span className="text-[10px] font-mono text-zinc-600 shrink-0">{ago(n.createdAt)}</span>
    </div>
  );
}

function WatchRow({ w, onRemove }: { w: WatchView; onRemove: () => void }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2">
      <Eye className="w-4 h-4 text-amber-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <a href={w.web_url} target="_blank" rel="noreferrer" className="text-xs text-white hover:text-orange-300 truncate block">
          {w.kind === 'pipeline' ? `Pipeline #${w.target_id}` : w.kind === 'job' ? `Job #${w.target_id}` : `MR !${w.target_id}`}
          <span className="text-zinc-500"> · {w.label}</span>
        </a>
        <p className="text-[11px] font-mono text-zinc-500">
          {w.status ?? 'checking…'}
          {w.source !== 'manual' && <span className="text-zinc-600"> · {w.source}</span>}
          {w.error && <span className="text-rose-400"> · {w.error}</span>}
        </p>
      </div>
      <button onClick={onRemove} title="Stop watching" className="p-1 text-zinc-500 hover:text-white">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  state,
  onMarkRead,
  onClear,
  onRemoveWatch,
  onOpenSettings,
  onOpenFailure
}) => {
  const [open, setOpen] = useState(false);
  const openFailure: NotificationCenterProps['onOpenFailure'] = (projectId, jobId, name) => {
    setOpen(false);
    onOpenFailure(projectId, jobId, name);
  };
  const [tab, setTab] = useState<'notifications' | 'watching'>('notifications');
  const [permission, setPermission] = useState<Permission>(browserPermission);
  const ref = useRef<HTMLDivElement>(null);
  const unread = state?.unread ?? 0;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) onMarkRead();
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        title="Notifications and watches"
        className="relative p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-orange-600 text-white text-[10px] font-bold leading-4 text-center tabular-nums">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 max-w-[calc(100vw-2rem)] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
            <div className="flex gap-1 text-xs">
              {(['notifications', 'watching'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-2 py-1 rounded ${tab === t ? 'bg-zinc-800 text-white font-semibold' : 'text-zinc-400 hover:text-white'}`}
                >
                  {t === 'notifications' ? 'Notifications' : `Watching (${state?.watches.length ?? 0})`}
                </button>
              ))}
            </div>
            {tab === 'notifications' && (state?.notifications.length ?? 0) > 0 && (
              <button onClick={onClear} title="Clear history" className="p-1 text-zinc-500 hover:text-white">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {permission === 'default' && (
            <button
              onClick={async () => setPermission(await Notification.requestPermission())}
              className="w-full px-3 py-2 text-left text-[11px] text-amber-200 bg-amber-950/40 border-b border-amber-900/50 hover:bg-amber-950/70"
            >
              Enable desktop notifications in this browser
            </button>
          )}
          {permission === 'unsupported' && (
            <p className="px-3 py-2 text-[11px] text-zinc-500 border-b border-zinc-800 flex items-center gap-1.5">
              <BellOff className="w-3 h-3" />
              Desktop notifications need HTTPS or localhost. Push channels still work.
            </p>
          )}

          <div className="max-h-96 overflow-y-auto divide-y divide-zinc-800/70">
            {tab === 'notifications' &&
              (state?.notifications.length ? (
                state.notifications.map((n) => <NotificationRow key={n.id} n={n} onOpenFailure={openFailure} />)
              ) : (
                <p className="px-3 py-6 text-xs text-zinc-500 text-center">No notifications yet.</p>
              ))}
            {tab === 'watching' &&
              (state?.watches.length ? (
                state.watches.map((w) => <WatchRow key={w.id} w={w} onRemove={() => onRemoveWatch(w.id)} />)
              ) : (
                <p className="px-3 py-6 text-xs text-zinc-500 text-center">
                  Nothing watched. Use the bell on a pipeline or merge request.
                </p>
              ))}
          </div>

          <button
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
            className="w-full px-3 py-2 text-[11px] text-zinc-400 hover:text-white border-t border-zinc-800 text-left"
          >
            Push channels and rules (ntfy, Gotify, webhooks) →
          </button>
        </div>
      )}
    </div>
  );
};
