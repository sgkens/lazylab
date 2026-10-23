import React, { useEffect, useState } from 'react';
import { Settings, Globe, RefreshCw, KeyRound, Gauge } from 'lucide-react';
import { AppStatus, BudgetPlan, RequestBudget } from '../types/gitlab';
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

const PLANS: { val: BudgetPlan; label: string; hint: string }[] = [
  { val: 'free', label: 'GitLab.com Free', hint: '4,000/h, 80/min' },
  { val: 'premium', label: 'Premium', hint: '12,000/h, 1,000/min' },
  { val: 'ultimate', label: 'Ultimate', hint: '20,000/h, 1,600/min' },
  { val: 'unlimited', label: 'No cap', hint: 'self-managed without limits' },
  { val: 'custom', label: 'Custom', hint: '' }
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  status,
  onStatusUpdated,
  onOpenProfiles
}) => {
  const [intervalSec, setIntervalSec] = useState<number>(status?.autoFetchIntervalSec ?? 30);
  const [watchPollSec, setWatchPollSec] = useState(status?.watchPollSec ?? 15);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [budget, setBudget] = useState<RequestBudget>(status?.scheduler?.budget ?? { plan: 'free', perHour: 4000, perMinute: 80 });

  useEffect(() => {
    if (isOpen && status) setIntervalSec(status.autoFetchIntervalSec);
  }, [isOpen, status?.autoFetchIntervalSec]);

  useEffect(() => {
    if (isOpen && status?.scheduler) setBudget(status.scheduler.budget);
  }, [isOpen, status?.scheduler?.budget.plan, status?.scheduler?.budget.perHour, status?.scheduler?.budget.perMinute]);

  useEffect(() => {
    if (isOpen) setWatchPollSec(status?.watchPollSec ?? 15);
  }, [isOpen, status?.watchPollSec]);

  if (!isOpen) return null;

  const handleWatchInterval = async (value: number) => {
    const previous = watchPollSec;
    setWatchPollSec(value);
    try {
      await api.updateWatchPoll(value);
      onStatusUpdated();
    } catch (err) {
      setWatchPollSec(previous);
      reportError('Could not change the watch interval', err);
    }
  };

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

  const saveBudget = async (next: RequestBudget) => {
    const previous = budget;
    setBudget(next);
    try {
      const res = await api.updateRequestBudget(next);
      setBudget(res.budget);
      onStatusUpdated();
    } catch (err) {
      setBudget(previous);
      reportError('Could not change the request budget', err);
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

          <div className="pt-3 border-t border-slate-800">
            <label htmlFor="watch-poll" className="block text-slate-400 font-medium mb-1.5">Watch check interval</label>
            <select id="watch-poll" value={watchPollSec} onChange={(e) => handleWatchInterval(Number(e.target.value))}
              className="bg-slate-950 text-slate-300 border border-slate-800 rounded px-3 py-1.5">
              {[...new Set([10, 15, 30, 60, 120, 300, watchPollSec])].sort((a, b) => a - b).map((sec) => <option key={sec} value={sec}>{sec} seconds</option>)}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">Older pipelines and unchanged merge requests are checked less often, up to 10 minutes. The setting survives restarts.</p>
          </div>

          {/* Request budget (GL-19) */}
          <div className="pt-3 border-t border-slate-800">
            <label htmlFor="budget-plan" className="block text-slate-400 font-medium mb-1.5 flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5 text-slate-500" />
              <span>GitLab request budget</span>
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                id="budget-plan"
                value={budget.plan}
                onChange={(e) => {
                  const plan = e.target.value as BudgetPlan;
                  void saveBudget({ ...budget, plan });
                }}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200"
              >
                {PLANS.map((p) => (
                  <option key={p.val} value={p.val}>
                    {p.hint ? `${p.label} (${p.hint})` : p.label}
                  </option>
                ))}
              </select>
              {budget.plan === 'custom' && (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void saveBudget({ plan: 'custom', perHour: Number(f.get('perHour')), perMinute: Number(f.get('perMinute')) });
                  }}
                >
                  <input name="perHour" type="number" min={0} defaultValue={budget.perHour} aria-label="Requests per hour" className="w-24 bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200 font-mono" />
                  <span className="text-slate-500">/h</span>
                  <input name="perMinute" type="number" min={0} defaultValue={budget.perMinute} aria-label="Requests per minute" className="w-20 bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200 font-mono" />
                  <span className="text-slate-500">/min</span>
                  <button type="submit" className="px-2.5 py-1.5 rounded bg-slate-800 text-slate-200 hover:bg-slate-700">Save</button>
                </form>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              GitLab counts requests per user across every token and tool, so the presets leave about 20% for glab and other
              clients. Clicks go first, then watches, then background refresh; 0 means no cap.
              {status?.scheduler?.message ? ` Now: ${status.scheduler.message}.` : ''}
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
