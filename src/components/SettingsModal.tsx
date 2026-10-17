import React, { useState } from 'react';
import { Settings, Key, Globe, Check, AlertCircle, RefreshCw, Trash2, Shield, Eye, EyeOff } from 'lucide-react';
import { AppStatus } from '../types/gitlab';
import { api } from '../services/api';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: AppStatus | null;
  onStatusUpdated: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  status,
  onStatusUpdated
}) => {
  const [host, setHost] = useState(status?.host || 'https://gitlab.com');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [intervalSec, setIntervalSec] = useState<number>(status?.autoFetchIntervalSec ?? 30);

  if (!isOpen) return null;

  const handleTestToken = async () => {
    if (!token.trim()) {
      setTestResult({ success: false, message: 'Please enter a GitLab Personal Access Token.' });
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await api.verifyToken(host, token);
      if (res.success) {
        setTestResult({
          success: true,
          message: `Authenticated as @${res.user.username} (${res.user.name || 'User'})`
        });
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || 'Verification failed.' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveAuth = async () => {
    setIsSaving(true);
    try {
      await api.saveAuth(host, token);
      onStatusUpdated();
      onClose();
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || 'Failed saving auth.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearAuth = async () => {
    await api.clearAuth();
    setToken('');
    setHost('https://gitlab.com');
    onStatusUpdated();
    onClose();
  };

  const handleUpdateInterval = async (val: number) => {
    setIntervalSec(val);
    await api.updateAutoFetch(val);
    onStatusUpdated();
  };

  const handlePurgeCache = async () => {
    await api.triggerSync();
    onStatusUpdated();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2 text-base font-semibold text-white">
            <Settings className="w-5 h-5 text-orange-400" />
            <span>GitLab Connection & Sync Configuration</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            ✕
          </button>
        </div>

        <div className="p-6 space-y-5 text-xs">
          {/* Host URL */}
          <div>
            <label className="block text-slate-400 font-medium mb-1 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-slate-500" />
              <span>GitLab Instance Host</span>
            </label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="https://gitlab.com or https://gitlab.corp.internal"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-orange-500 font-mono"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Supports gitlab.com or any private self-hosted GitLab instance URL.
            </p>
          </div>

          {/* Token input */}
          <div>
            <label className="block text-slate-400 font-medium mb-1 flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-slate-500" />
              <span>Personal Access Token (PAT)</span>
            </label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={status?.hasToken ? '•••••••••••••••••••• (Active)' : 'glpat-xxxxxxxxxxxxxxxxxxxx'}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-3 pr-10 py-2 text-slate-200 focus:outline-none focus:border-orange-500 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="flex items-center justify-between mt-1 text-[11px] text-slate-500">
              <span>Scope: `api`. Saved encrypted in the Vault as a profile.</span>
              <button
                type="button"
                onClick={handleTestToken}
                disabled={isTesting || !token.trim()}
                className="text-orange-400 hover:text-orange-300 disabled:opacity-40 font-medium"
              >
                {isTesting ? 'Verifying...' : 'Test Connection'}
              </button>
            </div>

            {testResult && (
              <div
                className={`mt-2 p-2.5 rounded border text-xs flex items-center gap-2 ${
                  testResult.success
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                    : 'bg-rose-950/80 text-rose-300 border-rose-800'
                }`}
              >
                {testResult.success ? (
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>

          {/* Auto-fetching interval */}
          <div className="pt-3 border-t border-slate-800">
            <label className="block text-slate-400 font-medium mb-1.5 flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
              <span>Background Auto-Fetching Interval</span>
            </label>
            <div className="flex items-center gap-2">
              {[
                { label: 'Off', val: 0 },
                { label: '15s', val: 15 },
                { label: '30s', val: 30 },
                { label: '60s', val: 60 },
                { label: '120s', val: 120 }
              ].map((opt) => (
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
              Refreshes projects, work items, pipelines, and runners on background timer with SQLite WAL cache updates.
            </p>
          </div>

          {/* Cache & Sandbox Reset */}
          <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
            <button
              type="button"
              onClick={handlePurgeCache}
              className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1.5 py-1 px-2.5 rounded bg-slate-950 border border-slate-800 hover:bg-slate-800 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
              <span>Force Re-fetch All</span>
            </button>

            <button
              type="button"
              onClick={handleClearAuth}
              className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1.5 py-1 px-2.5 rounded bg-slate-950 border border-slate-800 hover:bg-rose-950/40 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Switch to Demo Mode</span>
            </button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 bg-slate-950 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={handleSaveAuth}
            className="px-4 py-1.5 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <Shield className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Connecting...' : 'Save & Connect'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
