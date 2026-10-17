import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal,
  X,
  Copy,
  Check,
  Download,
  ArrowDown,
  RefreshCw,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Cpu,
  Search,
  Maximize2,
  Minimize2,
  Play,
  Flame,
  Radio,
  ExternalLink
} from 'lucide-react';
import { FailureExcerpt, JobTrace } from '../types/gitlab';
import { api } from '../services/api';
import { reportError } from '../utils/reportError';

interface JobTraceModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: number;
  jobId: number | null;
  jobName?: string;
  /** Called with the id of the new job GitLab created for a retry (the same id for a manual play). */
  onJobRetried?: (newJobId: number) => void;
}

export const JobTraceModal: React.FC<JobTraceModalProps> = ({
  isOpen,
  onClose,
  projectId,
  jobId,
  jobName,
  onJobRetried
}) => {
  const [traceData, setTraceData] = useState<JobTrace | null>(null);
  const [failure, setFailure] = useState<FailureExcerpt | null>(null);
  const [view, setView] = useState<'failure' | 'log'>('log');
  const [retryError, setRetryError] = useState<string | null>(null);
  const [excerptCopied, setExcerptCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retrySuccess, setRetrySuccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [wrapText, setWrapText] = useState(true);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [liveTail, setLiveTail] = useState(true);

  const terminalRef = useRef<HTMLDivElement>(null);
  const firstErrorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && jobId) {
      loadTrace();
    } else {
      setTraceData(null);
      setFailure(null);
      setView('log');
      setSearchQuery('');
      setRetrySuccess(false);
      setRetryError(null);
    }
  }, [isOpen, jobId, projectId]);

  const loadTrace = async () => {
    if (!jobId) return;
    try {
      setIsLoading(true);
      const res = await api.getJobTrace(projectId, jobId);
      if (res.success) {
        setTraceData(res.trace);
        setFailure(res.failure);
        setView(res.failure && res.failure.lines.length > 0 ? 'failure' : 'log');
        if (liveTail) {
          setTimeout(() => {
            scrollToBottom();
          }, 100);
        }
      }
    } catch (err) {
      reportError('Could not load job trace', err);
    } finally {
      setIsLoading(false);
    }
  };

  const scrollToBottom = () => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  };

  const scrollToError = () => {
    if (firstErrorRef.current) {
      firstErrorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // Manual jobs are played; finished jobs are retried, which creates a new job that is watched.
  const handleRetry = async () => {
    if (!jobId) return;
    try {
      setIsRetrying(true);
      setRetryError(null);
      let newJobId = jobId;
      if (traceData?.status === 'manual') {
        await api.playJob(jobId, projectId);
      } else {
        const res = await api.retryJob(jobId, projectId, true);
        newJobId = res.job.id;
      }
      setRetrySuccess(true);
      setTimeout(() => {
        setRetrySuccess(false);
        if (onJobRetried && newJobId !== jobId) onJobRetried(newJobId);
        else loadTrace();
      }, 1200);
    } catch (err: any) {
      setRetryError(err.message || 'Retry failed');
    } finally {
      setIsRetrying(false);
    }
  };

  const handleCopyExcerpt = () => {
    if (!failure) return;
    const head = [
      `${traceData?.job_name || `Job #${jobId}`} failed${failure.failureReason ? ` (${failure.failureReason})` : ''}`,
      failure.exitCode !== null ? `exit code ${failure.exitCode}` : null,
      traceData?.web_url || null
    ].filter(Boolean);
    navigator.clipboard.writeText([...head, '', ...failure.lines.map((l) => l.text)].join('\n'));
    setExcerptCopied(true);
    setTimeout(() => setExcerptCopied(false), 2000);
  };

  if (!isOpen || !jobId) return null;

  const handleCopy = () => {
    if (!traceData?.trace) return;
    // Strip ANSI codes for clean text copying
    const plainText = traceData.trace.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    navigator.clipboard.writeText(plainText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!traceData?.trace) return;
    const plainText = traceData.trace.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    const blob = new Blob([plainText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `job-${jobId}-output.log`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Find lines with errors
  const lines = traceData?.trace ? traceData.trace.split('\n') : [];
  const errorLineIndices = lines
    .map((line, idx) => {
      const lower = line.toLowerCase();
      if (
        lower.includes('error:') ||
        lower.includes('fatal:') ||
        lower.includes('fail') ||
        lower.includes('exit code 1')
      ) {
        return idx;
      }
      return -1;
    })
    .filter((idx) => idx !== -1);

  // Search match count
  const matchCount = searchQuery.trim()
    ? lines.filter((l) => l.toLowerCase().includes(searchQuery.toLowerCase())).length
    : 0;

  const parseAnsiToHtml = (text: string) => {
    if (!text) return 'No output log found for this job.';

    let foundFirstError = false;

    return lines.map((line, idx) => {
      let isErrorLine = errorLineIndices.includes(idx);
      let attachErrorRef = false;
      if (isErrorLine && !foundFirstError) {
        foundFirstError = true;
        attachErrorRef = true;
      }

      // Color replacements
      let colored = line
        .replace(/\x1b\[31(?:;1)?m/g, '<span class="text-rose-400 font-semibold">')
        .replace(/\x1b\[32m/g, '<span class="text-emerald-400">')
        .replace(/\x1b\[33m/g, '<span class="text-amber-300">')
        .replace(/\x1b\[34(?:;1)?m/g, '<span class="text-sky-400">')
        .replace(/\x1b\[35m/g, '<span class="text-purple-400">')
        .replace(/\x1b\[36m/g, '<span class="text-cyan-300">')
        .replace(/\x1b\[37m/g, '<span class="text-zinc-200">')
        .replace(/\x1b\[90m/g, '<span class="text-zinc-500">')
        .replace(/\x1b\[0;?m/g, '</span>')
        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

      if (searchQuery.trim() && line.toLowerCase().includes(searchQuery.toLowerCase())) {
        return (
          <div
            key={idx}
            className="bg-amber-950/60 text-amber-200 border-l-2 border-amber-500 pl-2 -ml-2 py-0.5"
            dangerouslySetInnerHTML={{ __html: colored }}
          />
        );
      }

      if (isErrorLine) {
        return (
          <div
            key={idx}
            ref={attachErrorRef ? firstErrorRef : undefined}
            className="bg-rose-950/40 border-l-2 border-rose-500 pl-2 -ml-2 py-0.5 text-rose-200 font-semibold"
            dangerouslySetInnerHTML={{ __html: colored }}
          />
        );
      }

      return (
        <div
          key={idx}
          className="hover:bg-zinc-900/60 transition-colors py-0.5 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: colored }}
        />
      );
    });
  };

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-emerald-400" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-rose-500" />;
      case 'running':
        return <Clock className="w-4 h-4 text-sky-400 animate-spin" />;
      default:
        return <AlertCircle className="w-4 h-4 text-amber-400" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className={`bg-zinc-950 border border-zinc-800 rounded-xl flex flex-col shadow-2xl overflow-hidden transition-all duration-200 ${
          isFullScreen ? 'w-full h-full rounded-none' : 'w-full max-w-5xl h-[88vh]'
        }`}
      >
        {/* Terminal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 bg-zinc-900/90 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center justify-center w-7 h-7 rounded-md bg-zinc-800 text-orange-400">
              <Terminal className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-white tracking-tight">
                  {jobName || traceData?.job_name || `Job #${jobId}`}
                </span>
                <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">
                  {getStatusIcon(traceData?.status)}
                  <span className="capitalize">{traceData?.status || 'Processing'}</span>
                </span>
                {traceData?.stage && (
                  <span className="text-xs font-mono text-zinc-400 bg-zinc-800/80 px-2 py-0.5 rounded border border-zinc-700/60">
                    stage: {traceData.stage}
                  </span>
                )}
                {traceData?.duration && (
                  <span className="text-xs font-mono text-zinc-400 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-zinc-500" />
                    {traceData.duration}s
                  </span>
                )}
              </div>
              {traceData?.runner && (
                <div className="flex items-center gap-1.5 text-xs text-zinc-500 font-mono mt-0.5">
                  <Cpu className="w-3 h-3 text-purple-400" />
                  <span>{traceData.runner.description}</span>
                  {traceData.runner.ip_address && <span>({traceData.runner.ip_address})</span>}
                </div>
              )}
            </div>
          </div>

          {/* Action Tools */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Retry Job button */}
            <button
              onClick={handleRetry}
              disabled={isRetrying}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-colors ${
                retrySuccess
                  ? 'bg-emerald-600 text-white'
                  : 'bg-orange-600 hover:bg-orange-500 text-white'
              }`}
              title={
                traceData?.status === 'manual'
                  ? 'Run this manual job'
                  : 'Retry this job; lazylab watches the new job and notifies you when it finishes'
              }
            >
              {isRetrying ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : retrySuccess ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
              <span>{retrySuccess ? 'Queued' : traceData?.status === 'manual' ? 'Run' : 'Retry'}</span>
            </button>

            {failure && (
              <div className="flex rounded-md border border-zinc-700 overflow-hidden text-xs font-mono">
                <button
                  onClick={() => setView('failure')}
                  className={`px-2 py-1 ${view === 'failure' ? 'bg-rose-900/70 text-rose-200' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  Failure
                </button>
                <button
                  onClick={() => setView('log')}
                  className={`px-2 py-1 border-l border-zinc-700 ${view === 'log' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  Full log
                </button>
              </div>
            )}

            {/* Jump to error QOL button */}
            {errorLineIndices.length > 0 && (
              <button
                onClick={scrollToError}
                className="px-2.5 py-1 text-xs font-mono rounded bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 flex items-center gap-1 transition-colors"
                title={`Jump to first error (${errorLineIndices.length} error lines found)`}
              >
                <Flame className="w-3.5 h-3.5 text-rose-400" />
                <span>Jump to Error ({errorLineIndices.length})</span>
              </button>
            )}

            {/* Scroll to bottom */}
            <button
              onClick={scrollToBottom}
              className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
              title="Scroll to bottom"
            >
              <ArrowDown className="w-4 h-4" />
            </button>

            {/* Live Tail Toggle */}
            <button
              onClick={() => setLiveTail(!liveTail)}
              className={`px-2 py-1 text-xs font-mono rounded border flex items-center gap-1 transition-colors ${
                liveTail
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/80'
                  : 'text-zinc-500 border-zinc-800 hover:text-zinc-300'
              }`}
              title="Auto-scroll on new output lines"
            >
              <Radio className={`w-3 h-3 ${liveTail ? 'text-emerald-400 animate-pulse' : 'text-zinc-600'}`} />
              <span>Tail</span>
            </button>

            {/* Search Filter */}
            <div className="relative hidden sm:block">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter logs..."
                className="w-32 lg:w-44 pl-8 pr-7 py-1 text-xs bg-zinc-950 border border-zinc-800 rounded-md text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-orange-500 font-mono"
              />
              {matchCount > 0 && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-amber-400">
                  {matchCount}
                </span>
              )}
            </div>

            <button
              onClick={() => setWrapText(!wrapText)}
              className={`px-2 py-1 text-xs font-mono rounded border transition-colors ${
                wrapText ? 'bg-zinc-800 text-orange-400 border-zinc-700' : 'text-zinc-400 border-zinc-800 hover:text-zinc-200'
              }`}
              title="Toggle line wrapping"
            >
              Wrap
            </button>

            <button
              onClick={loadTrace}
              disabled={isLoading}
              className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
              title="Refresh logs"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-orange-400' : ''}`} />
            </button>

            <button
              onClick={handleCopy}
              className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors flex items-center gap-1 text-xs"
              title="Copy log to clipboard"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>

            <button
              onClick={handleDownload}
              className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
              title="Download raw log"
            >
              <Download className="w-4 h-4" />
            </button>

            <button
              onClick={() => setIsFullScreen(!isFullScreen)}
              className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
              title="Toggle full screen"
            >
              {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            <button
              onClick={onClose}
              title="Close"
              className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded transition-colors ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Terminal Content Screen */}
        <div
          ref={terminalRef}
          className="flex-1 bg-black p-4 font-mono text-xs overflow-y-auto text-zinc-300 selection:bg-orange-500/30 selection:text-orange-200"
        >
          {view === 'failure' && failure ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-rose-900/70 bg-rose-950/30 p-3 font-sans">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span className="font-semibold text-rose-200">
                      {failure.failureReason ? failure.failureReason.replace(/_/g, ' ') : 'Failed'}
                    </span>
                    {failure.exitCode !== null && (
                      <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-300">exit {failure.exitCode}</span>
                    )}
                    {failure.section && (
                      <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400">in {failure.section}</span>
                    )}
                    {failure.retryable && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-200">likely passes on retry</span>
                    )}
                  </div>
                  {failure.failureHint && <p className="text-xs text-zinc-400">{failure.failureHint}</p>}
                  {failure.errorLine && (
                    <p className="text-xs font-mono text-rose-200 break-all">{failure.errorLine}</p>
                  )}
                  {retryError && <p className="text-xs text-rose-300">Retry failed: {retryError}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={handleCopyExcerpt}
                    className="px-2 py-1 text-xs rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 flex items-center gap-1"
                    title="Copy the excerpt as plain text, for a ticket or an agent"
                  >
                    {excerptCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    Copy excerpt
                  </button>
                  {traceData?.web_url && (
                    <a
                      href={traceData.web_url}
                      target="_blank"
                      rel="noreferrer"
                      className="px-2 py-1 text-xs rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 flex items-center gap-1"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      GitLab
                    </a>
                  )}
                </div>
              </div>
              <div className="whitespace-pre-wrap break-all">
                {failure.lines.map((line) => (
                  <div
                    key={line.n}
                    className={`flex gap-3 py-0.5 ${line.hl ? 'bg-rose-950/40 border-l-2 border-rose-500 -ml-2 pl-2 text-rose-200' : ''}`}
                  >
                    <span className="w-12 shrink-0 text-right text-zinc-600 select-none">{line.n}</span>
                    <span>{line.text || ' '}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-zinc-500 font-sans">
                {failure.lines.length} of {failure.totalLines} lines. Switch to Full log for the rest.
              </p>
            </div>
          ) : isLoading && !traceData ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-500">
              <RefreshCw className="w-6 h-6 animate-spin text-orange-400 mb-2" />
              <span>Streaming CI output trace from runner...</span>
            </div>
          ) : (
            <div className={`space-y-0.5 ${wrapText ? 'whitespace-pre-wrap break-all' : 'whitespace-pre overflow-x-auto'}`}>
              {parseAnsiToHtml(traceData?.trace || '')}
            </div>
          )}
        </div>

        {/* Terminal Footer Bar */}
        <div className="flex items-center justify-between px-5 py-2 bg-zinc-900 border-t border-zinc-800 text-xs font-mono text-zinc-500 shrink-0">
          <div className="flex items-center gap-4">
            <span>Terminal: UTF-8 / xterm-256color</span>
            {traceData?.artifacts && traceData.artifacts.length > 0 && (
              <span className="text-zinc-400">
                Artifacts: {traceData.artifacts.map((a) => `${a.filename} (${Math.round(a.size / 1024)} KB)`).join(', ')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {errorLineIndices.length > 0 && (
              <span className="text-rose-400 font-semibold">{errorLineIndices.length} error signals detected</span>
            )}
            {traceData?.status === 'success' && <span className="text-zinc-400">Exit status: 0</span>}
            {failure?.exitCode != null && <span className="text-zinc-400">Exit status: {failure.exitCode}</span>}
          </div>
        </div>
      </div>
    </div>
  );
};
