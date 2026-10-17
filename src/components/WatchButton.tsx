import React, { createContext, useContext } from 'react';
import { Bell, BellRing } from 'lucide-react';
import { WatchKind } from '../types/notify';

interface WatchContextValue {
  isWatched: (kind: WatchKind, projectId: number, targetId: number) => boolean;
  toggleWatch: (kind: WatchKind, projectId: number, targetId: number) => void;
}

export const WatchContext = createContext<WatchContextValue>({
  isWatched: () => false,
  toggleWatch: () => undefined
});

const NOUN: Record<WatchKind, string> = { pipeline: 'pipeline', job: 'job', merge_request: 'merge request' };

/** Bell toggle: watch a pipeline, job or MR and get notified when it finishes or changes. */
export function WatchButton({
  kind,
  projectId,
  targetId,
  compact = false
}: {
  kind: WatchKind;
  projectId: number;
  targetId: number;
  compact?: boolean;
}) {
  const { isWatched, toggleWatch } = useContext(WatchContext);
  const watched = isWatched(kind, projectId, targetId);
  const title = watched ? `Stop watching this ${NOUN[kind]}` : `Watch this ${NOUN[kind]}: notify me when it finishes`;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggleWatch(kind, projectId, targetId);
      }}
      title={title}
      aria-pressed={watched}
      className={`flex items-center gap-1 rounded transition-colors ${
        compact ? 'p-1' : 'px-2.5 py-1 text-xs border'
      } ${
        watched
          ? 'text-amber-300 border-amber-800/70 bg-amber-950/40 hover:bg-amber-950/70'
          : 'text-zinc-400 border-zinc-700 hover:text-white hover:bg-zinc-800'
      }`}
    >
      {watched ? <BellRing className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
      {!compact && <span>{watched ? 'Watching' : 'Watch'}</span>}
    </button>
  );
}
