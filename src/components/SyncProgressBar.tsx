import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle, Database, Gauge, RefreshCw } from 'lucide-react';

interface SyncProgressBarProps {
  isSyncing: boolean;
  lastSyncTime?: number;
  walEntriesCount?: number;
  /** Request scheduler state from /api/status (GL-19), e.g. "GitLab rate limit: paused until 14:05". */
  throttleMessage?: string | null;
}

/**
 * Shown while a refresh runs and briefly after it ends. The refresh is a single request with no
 * progress reporting, so the bar is indeterminate and the only figure shown is the elapsed time.
 */
export const SyncProgressBar: React.FC<SyncProgressBarProps> = ({ isSyncing, lastSyncTime, walEntriesCount = 0, throttleMessage = null }) => {
  const [finishedIn, setFinishedIn] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (isSyncing) {
      startedAt.current = Date.now();
      setFinishedIn(null);
      setElapsed(0);
      const tick = setInterval(() => setElapsed(Date.now() - (startedAt.current ?? Date.now())), 200);
      return () => clearInterval(tick);
    }
    if (startedAt.current !== null) {
      setFinishedIn(Date.now() - startedAt.current);
      startedAt.current = null;
      const hide = setTimeout(() => setFinishedIn(null), 2000);
      return () => clearTimeout(hide);
    }
  }, [isSyncing]);

  if (!isSyncing && finishedIn === null) {
    if (!throttleMessage) return null;
    return (
      <div className="w-full bg-zinc-950/90 border-b border-amber-900/60 shrink-0 text-[11px] font-mono px-6 py-1 flex items-center gap-2 text-amber-300" role="status">
        <Gauge className="w-3 h-3 shrink-0" />
        <span>{throttleMessage}</span>
      </div>
    );
  }

  return (
    <div className="w-full bg-zinc-950/90 border-b border-zinc-800/80 shrink-0 text-xs font-mono relative overflow-hidden">
      <div className="w-full bg-zinc-900 h-1 relative overflow-hidden">
        {isSyncing ? (
          <div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-orange-400 to-transparent animate-[lazylab-slide_1.2s_ease-in-out_infinite]" />
        ) : (
          <div className="h-full w-full bg-emerald-500/70" />
        )}
      </div>
      <style>{`@keyframes lazylab-slide { from { left: -33%; } to { left: 100%; } }`}</style>

      <div className="flex items-center justify-between px-6 py-1 text-[11px] text-zinc-400">
        <div className="flex items-center gap-2">
          {isSyncing ? (
            <RefreshCw className="w-3 h-3 text-orange-400 animate-spin shrink-0" />
          ) : (
            <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" />
          )}
          <span className={isSyncing ? 'text-zinc-200' : 'text-emerald-400 font-semibold'}>
            {isSyncing
              ? `Refreshing from GitLab… ${(elapsed / 1000).toFixed(1)}s`
              : `Refreshed in ${((finishedIn ?? 0) / 1000).toFixed(1)}s`}
          </span>
          {throttleMessage && (
            <span className="flex items-center gap-1 text-amber-300" role="status">
              <Gauge className="w-3 h-3 shrink-0" />
              {throttleMessage}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-zinc-500">
          {lastSyncTime && !isSyncing && <span>at {new Date(lastSyncTime).toLocaleTimeString()}</span>}
          <span className="flex items-center gap-1" title="Entries in the local cache journal">
            <Database className="w-3 h-3 text-emerald-500" />
            <span>journal: {walEntriesCount}</span>
          </span>
        </div>
      </div>
    </div>
  );
};
