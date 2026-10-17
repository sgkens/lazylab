import React, { useEffect, useMemo, useState } from 'react';
import { History, Play, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { DeclaredVariable, GitLabBranch, GitLabPipeline, GitLabProject, PipelineVariableInput } from '../types/gitlab';
import { api } from '../services/api';

interface RunPipelineModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: GitLabProject[];
  defaultProjectId?: number | null;
  onStarted: (pipeline: GitLabPipeline, watched: boolean) => void;
}

interface Row extends PipelineVariableInput {
  description?: string;
  options?: string[];
}

interface LastRun {
  ref: string;
  variables: PipelineVariableInput[];
}

// The last run per project is a per-browser convenience; losing it only costs retyping.
const lastRunKey = (projectId: number) => `lazylab_last_run:${projectId}`;

function readLastRun(projectId: number): LastRun | null {
  try {
    const raw = localStorage.getItem(lastRunKey(projectId));
    return raw ? (JSON.parse(raw) as LastRun) : null;
  } catch {
    return null;
  }
}

function saveLastRun(projectId: number, run: LastRun) {
  try {
    localStorage.setItem(lastRunKey(projectId), JSON.stringify(run));
  } catch {
    // storage unavailable
  }
}

const KEY_RE = /^[A-Za-z0-9_]*$/;
const input =
  'bg-zinc-950 border border-zinc-800 text-zinc-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-orange-500 font-mono';

export const RunPipelineModal: React.FC<RunPipelineModalProps> = ({ isOpen, onClose, projects, defaultProjectId, onStarted }) => {
  const [projectId, setProjectId] = useState<number | null>(null);
  const [ref, setRef] = useState('');
  const [branches, setBranches] = useState<GitLabBranch[]>([]);
  const [declared, setDeclared] = useState<DeclaredVariable[]>([]);
  const [loadingDeclared, setLoadingDeclared] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [watch, setWatch] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const project = projects.find((p) => p.id === projectId);
  const lastRun = useMemo(() => (projectId ? readLastRun(projectId) : null), [projectId, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const initial = defaultProjectId && projects.some((p) => p.id === defaultProjectId) ? defaultProjectId : projects[0]?.id ?? null;
    setProjectId(initial);
    setError(null);
    setWatch(true);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !projectId) return;
    setRef(project?.default_branch || 'main');
    setRows([]);
    setBranches([]);
    api
      .getBranches(projectId)
      .then((res) => setBranches(res.branches))
      .catch(() => setBranches([]));
  }, [projectId, isOpen]);

  // Declared variables depend on the ref's .gitlab-ci.yml; refetch when the ref settles.
  useEffect(() => {
    if (!isOpen || !projectId || !ref.trim()) return;
    const timer = setTimeout(() => {
      setLoadingDeclared(true);
      api
        .getDeclaredVariables(projectId, ref.trim())
        .then((res) => {
          setDeclared(res.variables);
          setRows((prev) => {
            const userRows = prev.filter((r) => !r.description && !r.options && !res.variables.some((d) => d.key === r.key));
            const kept = new Map(prev.map((r) => [r.key, r.value]));
            const fromConfig: Row[] = res.variables.map((d) => ({
              key: d.key,
              value: kept.get(d.key) ?? d.value,
              variable_type: 'env_var',
              description: d.description,
              options: d.options
            }));
            return [...fromConfig, ...userRows];
          });
        })
        .catch(() => setDeclared([]))
        .finally(() => setLoadingDeclared(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [ref, projectId, isOpen]);

  if (!isOpen) return null;

  const updateRow = (idx: number, patch: Partial<Row>) => setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const removeRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx));
  const addRow = () => setRows((prev) => [...prev, { key: '', value: '', variable_type: 'env_var' }]);

  const applyLastRun = () => {
    if (!lastRun) return;
    setRef(lastRun.ref);
    setRows((prev) => {
      const byKey = new Map(lastRun.variables.map((v) => [v.key, v]));
      const merged = prev.map((r) => (byKey.has(r.key) ? { ...r, ...byKey.get(r.key)! } : r));
      const extra = lastRun.variables.filter((v) => !prev.some((r) => r.key === v.key));
      return [...merged, ...extra];
    });
  };

  const badKey = rows.find((r) => r.key && !KEY_RE.test(r.key));

  const submit = async () => {
    if (!projectId || !ref.trim() || badKey) return;
    // Declared variables left at their default are not sent, so GitLab keeps applying the config value.
    const variables = rows
      .filter((r) => r.key.trim())
      .filter((r) => {
        const d = declared.find((x) => x.key === r.key);
        return !d || d.value !== r.value;
      })
      .map(({ key, value, variable_type }) => ({ key: key.trim(), value, variable_type }));
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.runPipeline(projectId, ref.trim(), variables, watch);
      saveLastRun(projectId, { ref: ref.trim(), variables });
      onStarted(res.pipeline, Boolean(res.watch));
      onClose();
    } catch (err: any) {
      setError(err.message || 'Could not start the pipeline');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-2xl flex flex-col max-h-[90vh] shadow-2xl overflow-hidden text-xs"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400">
              <Play className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Run pipeline</h2>
              <p className="text-zinc-500">Start a pipeline for a branch or tag, with variables.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="space-y-1.5 block">
              <span className="text-zinc-400 font-semibold">Project</span>
              <select value={projectId ?? ''} onChange={(e) => setProjectId(Number(e.target.value))} className={`${input} w-full`}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.path_with_namespace}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 block">
              <span className="text-zinc-400 font-semibold">Branch or tag</span>
              <input
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                list="run-pipeline-branches"
                className={`${input} w-full`}
                placeholder={project?.default_branch || 'main'}
              />
              <datalist id="run-pipeline-branches">
                {branches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.default ? 'default' : b.protected ? 'protected' : ''}
                  </option>
                ))}
              </datalist>
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400 font-semibold flex items-center gap-2">
                Variables
                {loadingDeclared && <RefreshCw className="w-3 h-3 animate-spin text-zinc-500" />}
              </span>
              <div className="flex items-center gap-2">
                {lastRun && (
                  <button
                    onClick={applyLastRun}
                    className="px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 flex items-center gap-1"
                    title={`Ref ${lastRun.ref}, ${lastRun.variables.length} variables`}
                  >
                    <History className="w-3.5 h-3.5" />
                    Use last run
                  </button>
                )}
                <button onClick={addRow} className="px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
              </div>
            </div>

            {rows.length === 0 ? (
              <p className="text-zinc-500">No variables. The pipeline runs with the values in .gitlab-ci.yml and CI/CD settings.</p>
            ) : (
              <div className="space-y-2">
                {rows.map((row, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <select
                        value={row.variable_type || 'env_var'}
                        onChange={(e) => updateRow(idx, { variable_type: e.target.value as Row['variable_type'] })}
                        className={`${input} w-24 shrink-0`}
                        title="Variable type"
                      >
                        <option value="env_var">env</option>
                        <option value="file">file</option>
                      </select>
                      <input
                        value={row.key}
                        onChange={(e) => updateRow(idx, { key: e.target.value })}
                        placeholder="KEY"
                        className={`${input} w-40 shrink-0 ${row.key && !KEY_RE.test(row.key) ? 'border-rose-600' : ''}`}
                        readOnly={Boolean(row.description || row.options)}
                      />
                      {row.options ? (
                        <select value={row.value} onChange={(e) => updateRow(idx, { value: e.target.value })} className={`${input} flex-1 min-w-0`}>
                          {row.options.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={row.value}
                          onChange={(e) => updateRow(idx, { value: e.target.value })}
                          placeholder="value"
                          className={`${input} flex-1 min-w-0`}
                        />
                      )}
                      <button onClick={() => removeRow(idx)} className="p-1.5 text-zinc-500 hover:text-rose-400" title="Remove">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {row.description && <p className="text-[11px] text-zinc-500 pl-[6.5rem]">{row.description}</p>}
                  </div>
                ))}
              </div>
            )}
            {badKey && <p className="text-rose-400">Keys may contain only letters, digits and underscores.</p>}
            <p className="text-[11px] text-zinc-500">
              Values are visible to anyone who can see the pipeline. Use masked CI/CD variables for secrets.
            </p>
          </div>

          <label className="flex items-center gap-2 text-zinc-300">
            <input type="checkbox" checked={watch} onChange={(e) => setWatch(e.target.checked)} />
            Notify me when it finishes
          </label>

          {error && <p className="text-rose-300 bg-rose-950/40 border border-rose-900 rounded-lg px-3 py-2 break-words">{error}</p>}
        </div>

        <div className="px-6 py-3 bg-zinc-900 border-t border-zinc-800 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-zinc-300 hover:bg-zinc-800">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || !projectId || !ref.trim() || Boolean(badKey)}
            className="px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-semibold flex items-center gap-1.5"
          >
            {submitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            Run pipeline
          </button>
        </div>
      </div>
    </div>
  );
};
