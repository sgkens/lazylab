import React, { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle, Database } from 'lucide-react';

interface SyncProgressBarProps {
  isSyncing: boolean;
  lastSyncTime?: number;
  walEntriesCount?: number;
}

export const SyncProgressBar: React.FC<SyncProgressBarProps> = ({
  isSyncing,
  lastSyncTime,
  walEntriesCount = 0
}) => {
  const [progress, setProgress] = useState(0);
  const [stageText, setStageText] = useState('Synchronized');
  const [showFinishedNotice, setShowFinishedNotice] = useState(false);

  useEffect(() => {
    let interval: any;

    if (isSyncing) {
      setProgress(15);
      setStageText('Connecting to GitLab API & checking WAL journal...');
      setShowFinishedNotice(false);

      interval = setInterval(() => {
        setProgress((prev) => {
          if (prev < 40) {
            setStageText('Revalidating Work Items, MRs & Milestones...');
            return prev + 15;
          } else if (prev < 75) {
            setStageText('Fetching Pipelines, Fleet Runners & Packages...');
            return prev + 12;
          } else if (prev < 92) {
            setStageText('Committing WAL journal & updating in-memory index...');
            return prev + 5;
          }
          return prev;
        });
      }, 250);
    } else {
      if (progress > 0) {
        setProgress(100);
        setStageText('Sync complete · SQLite WAL journal in-sync');
        setShowFinishedNotice(true);
        const timer = setTimeout(() => {
          setProgress(0);
          setShowFinishedNotice(false);
        }, 1800);
        return () => clearTimeout(timer);
      }
    }

    return () => clearInterval(interval);
  }, [isSyncing]);

  if (!isSyncing && progress === 0 && !showFinishedNotice) {
    return null;
  }

  return (
    <div className="w-full bg-zinc-950/90 border-b border-zinc-800/80 shrink-0 text-xs font-mono relative overflow-hidden transition-all duration-300">
      {/* Animated gradient progress track */}
      <div className="w-full bg-zinc-900 h-1 relative">
        <div
          className="h-full bg-gradient-to-r from-orange-500 via-amber-400 to-emerald-400 transition-all duration-300 ease-out shadow-[0_0_8px_rgba(249,115,22,0.6)]"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Sync Step Micro-Bar */}
      <div className="flex items-center justify-between px-6 py-1 text-[11px] text-zinc-400">
        <div className="flex items-center gap-2">
          {isSyncing ? (
            <RefreshCw className="w-3 h-3 text-orange-400 animate-spin shrink-0" />
          ) : (
            <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" />
          )}
          <span className={isSyncing ? 'text-zinc-200' : 'text-emerald-400 font-semibold'}>
            {stageText}
          </span>
        </div>

        <div className="flex items-center gap-3 text-zinc-500">
          <span className="flex items-center gap-1">
            <Database className="w-3 h-3 text-emerald-500" />
            <span>WAL logs: {walEntriesCount}</span>
          </span>
          <span className="tabular-nums font-bold text-zinc-300">{Math.round(progress)}%</span>
        </div>
      </div>
    </div>
  );
};
