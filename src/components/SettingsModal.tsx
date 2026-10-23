import React, { useEffect, useState } from 'react';
import { Settings, Globe, RefreshCw, KeyRound } from 'lucide-react';
import { AppStatus } from '../types/gitlab';
import { api } from '../services/api';
import { reportError } from '../utils/reportError';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: AppStatus | null;
  onStatusUpdated: () => void;
  /** GitLab hosts and tokens are managed only in Vault → GitLab profiles. */
  onOpenProfiles: () => void;
}

const INTERVALS = [
  { label: 'Off', val: 0 },
  { label: '30s', val: 30 },
  { label: '60s', val: 60 },
  { label: '2m', val: 120 },
  { label: '5m', val: 300 }
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  status,
  onStatusUpdated,
  onOpenProfiles
}) => {
  const [intervalSec, setIntervalSec] = useState<number>(status?.autoFetchIntervalSec ?? 30);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (isOpen && status) setIntervalSec(status.autoFetchIntervalSec);
  }, [isOpen, status?.autoFetchIntervalSec]);

  if (!isOpen) return null;

  const handleUpdateInterval = async (val: number) => {
    const previous = intervalSec;
    setIntervalSec(val);
    try {
      await api.updateAutoFetch(val);
      onStatusUpdated();
    } catch (err) {
      setIntervalSec(previous);
      reportError('Could not change the refresh interval', err);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await api.triggerSync();
      onStatusUpdated();
    } catch (err) {
      reportError('Could not refresh', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2 text-base font-semibold text-white">
            <Settings className="w-5 h-5 text-orange-400" />
            <span>Connection and sync</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="p-6 space-y-5 text-xs">
          {/* Active connection (read-only; profiles live in the vault) */}
          <div>
            <label className="block text-slate-400 font-medium mb-1.5 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-slate-500" />
              <span>GitLab connection</span>
            </label>
            <div className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                {status?.isDemo ? (
                  <span className="text-amber-300">Demo mode: no active GitLab profile</span>
                ) : (
                  <>
                    <div className="text-slate-200 font-mono truncate">{status?.host ?? 'unknown host'}</div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {status?.profileName ? `${status.profileName} · ` : ''}
                      {status?.user ? `@${status.user.username}` : 'user not loaded'}
                    </div>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={onOpenProfiles}
                className="shrink-0 flex items-center gap-1.5 text-orange-400 hover:text-orange-300 font-medium"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>GitLab profiles</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Add, switch or deactivate GitLab hosts and tokens in Vault → GitLab profiles.
            </p>
          </div>

          {/* Auto-fetching interval */}
          <div className="pt-3 border-t border-slate-800">
            <label className="block text-slate-400 font-medium mb-1.5 flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
              <span>Background refresh interval</span>
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              {INTERVALS.map((opt) => (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() => handleUpdateInterval(opt.val)}
                  className={`px-3 py-1.5 rounded text-xs font-mono transition-colors ${
                    intervalSec === opt.val
                      ? 'bg-orange-600 text-white font-semibold'
                      : 'bg-slate-950 text-slate-400 border border-slate-800 hover:bg-slate-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Refreshes projects, work items, merge requests, pipelines, runners and the inbox, and checks watches.
              The server allows 30 seconds at minimum, starts the next refresh only after the previous one finished,
              and keeps the setting across restarts.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 bg-slate-950 border-t border-slate-800">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1.5 py-1 px-2.5 rounded bg-slate-950 border border-slate-800 hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'Refreshing...' : 'Refresh now'}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500 rounded-lg transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
