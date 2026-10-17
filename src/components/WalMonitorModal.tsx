import React from 'react';
import { Database, Clock, HardDrive, FileText, CheckCircle2 } from 'lucide-react';
import { WalStats } from '../types/gitlab';

interface WalMonitorModalProps {
  isOpen: boolean;
  onClose: () => void;
  walStats: WalStats | null;
  lastSyncTime: number;
}

export const WalMonitorModal: React.FC<WalMonitorModalProps> = ({
  isOpen,
  onClose,
  walStats,
  lastSyncTime
}) => {
  if (!isOpen) return null;

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2 text-base font-semibold text-white">
            <Database className="w-5 h-5 text-emerald-400" />
            <span>SQLite WAL Engine & Cache Telemetry</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            ✕
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5 text-xs flex-1">
          {/* Metrics 3-card grid */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
              <span className="text-[11px] text-slate-500 font-mono block mb-1">
                Active Cached Keys
              </span>
              <span className="text-xl font-bold font-mono text-white tabular-nums">
                {walStats?.totalEntries ?? 0}
              </span>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
              <span className="text-[11px] text-slate-500 font-mono block mb-1">
                WAL Append Entries
              </span>
              <span className="text-xl font-bold font-mono text-emerald-400 tabular-nums">
                {walStats?.walEntriesCount ?? 0}
              </span>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
              <span className="text-[11px] text-slate-500 font-mono block mb-1">
                WAL Disk Journal
              </span>
              <span className="text-xl font-bold font-mono text-sky-400 tabular-nums">
                {formatBytes(walStats?.walSizeBytes ?? 0)}
              </span>
            </div>
          </div>

          <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-between text-slate-400 font-mono text-xs">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>WAL Checkpoint Status: Active (Auto-flushing)</span>
            </span>
            <span className="text-slate-500">
              Synced: {new Date(lastSyncTime).toLocaleTimeString()}
            </span>
          </div>

          {/* WAL Operations Stream */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-slate-500" />
                <span>Write-Ahead Log (WAL) Journal Tail</span>
              </span>
              <span className="text-[11px] font-mono text-slate-500">Recent Transactions</span>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-lg divide-y divide-slate-800/80 font-mono text-[11px]">
              {walStats?.recentLogs && walStats.recentLogs.length > 0 ? (
                walStats.recentLogs.map((log) => (
                  <div key={log.id} className="p-2.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 truncate">
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-orange-300 text-[10px] uppercase font-bold shrink-0">
                        {log.operation}
                      </span>
                      <span className="text-slate-300 truncate">{log.details || log.key}</span>
                    </div>
                    <span className="text-slate-500 shrink-0 text-[10px] tabular-nums">
                      {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                ))
              ) : (
                <div className="p-4 text-center text-slate-500">No WAL transactions recorded yet.</div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end px-6 py-3 bg-slate-950 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            Close Telemetry
          </button>
        </div>
      </div>
    </div>
  );
};
