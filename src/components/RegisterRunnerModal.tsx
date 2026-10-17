import React, { useState } from 'react';
import { Cpu, Copy, Check, Terminal, X, ShieldAlert } from 'lucide-react';
import { GitLabProject } from '../types/gitlab';

interface RegisterRunnerModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: GitLabProject[];
  selectedProjectId: number | null;
  onRegister: (payload: {
    description: string;
    tagList?: string[];
    runUntagged?: boolean;
    locked?: boolean;
    projectId?: number;
  }) => Promise<{ registrationToken: string; registerCommand: string }>;
}

export const RegisterRunnerModal: React.FC<RegisterRunnerModalProps> = ({
  isOpen,
  onClose,
  projects,
  selectedProjectId,
  onRegister
}) => {
  const [description, setDescription] = useState('');
  const [tagsInput, setTagsInput] = useState('docker, linux, amd64');
  const [runUntagged, setRunUntagged] = useState(true);
  const [locked, setLocked] = useState(false);
  const [isShared, setIsShared] = useState(!selectedProjectId);
  const [targetProjectId, setTargetProjectId] = useState<number>(
    selectedProjectId || (projects.length > 0 ? projects[0].id : 0)
  );

  const [registrationResult, setRegistrationResult] = useState<{
    token: string;
    command: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    if (!registrationResult) return;
    navigator.clipboard.writeText(registrationResult.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;

    setIsSubmitting(true);
    try {
      const tagList = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const res = await onRegister({
        description: description.trim(),
        tagList,
        runUntagged,
        locked,
        projectId: isShared ? undefined : targetProjectId
      });

      setRegistrationResult({
        token: res.registrationToken,
        command: res.registerCommand
      });
    } catch (err) {
      console.error('Failed to register runner:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2 text-base font-semibold text-white">
            <Cpu className="w-5 h-5 text-purple-400" />
            <span>Register New GitLab Runner</span>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {!registrationResult ? (
          <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
            <div>
              <label className="block text-zinc-400 font-medium mb-1">Runner Description / Identifier</label>
              <input
                type="text"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. runner-spot-k8s-node-02 or dedicated-ci-builder"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-orange-500 font-mono"
              />
            </div>

            <div>
              <label className="block text-zinc-400 font-medium mb-1">Scope</label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer text-zinc-300">
                  <input
                    type="radio"
                    name="runnerScope"
                    checked={isShared}
                    onChange={() => setIsShared(true)}
                    className="text-orange-500 bg-zinc-950 border-zinc-800"
                  />
                  <span>Instance / Shared Runner</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-zinc-300">
                  <input
                    type="radio"
                    name="runnerScope"
                    checked={!isShared}
                    onChange={() => setIsShared(false)}
                    className="text-orange-500 bg-zinc-950 border-zinc-800"
                  />
                  <span>Project Specific</span>
                </label>
              </div>
            </div>

            {!isShared && (
              <div>
                <label className="block text-zinc-400 font-medium mb-1">Target Project</label>
                <select
                  value={targetProjectId}
                  onChange={(e) => setTargetProjectId(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-orange-500"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name_with_namespace || p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-zinc-400 font-medium mb-1">Execution Tags (comma separated)</label>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="docker, linux, amd64, gpu"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-orange-500 font-mono"
              />
            </div>

            <div className="space-y-2 pt-2 border-t border-zinc-800">
              <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
                <input
                  type="checkbox"
                  checked={runUntagged}
                  onChange={(e) => setRunUntagged(e.target.checked)}
                  className="rounded bg-zinc-950 border-zinc-800 text-orange-500"
                />
                <span>Run untagged jobs (accepts jobs with no specified tag)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
                <input
                  type="checkbox"
                  checked={locked}
                  onChange={(e) => setLocked(e.target.checked)}
                  className="rounded bg-zinc-950 border-zinc-800 text-orange-500"
                />
                <span>Lock to current project (cannot be assigned to other repos)</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-800">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>{isSubmitting ? 'Generating...' : 'Register Runner'}</span>
              </button>
            </div>
          </form>
        ) : (
          <div className="p-6 space-y-4 text-xs">
            <div className="p-3 bg-emerald-950/60 border border-emerald-800 rounded-lg text-emerald-300 flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Runner registration token generated successfully!</span>
            </div>

            <div>
              <span className="block text-zinc-400 font-medium mb-1">Registration Token:</span>
              <div className="p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-purple-300 select-all">
                {registrationResult.token}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-zinc-400 font-medium flex items-center gap-1">
                  <Terminal className="w-3.5 h-3.5 text-zinc-500" />
                  <span>Execute on Host / Container</span>
                </span>
                <button
                  onClick={handleCopy}
                  className="text-orange-400 hover:text-orange-300 flex items-center gap-1 font-mono text-[11px]"
                >
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? 'Copied' : 'Copy Command'}</span>
                </button>
              </div>
              <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-zinc-200 text-[11px] leading-relaxed overflow-x-auto">
                {registrationResult.command}
              </div>
            </div>

            <div className="flex items-center justify-end pt-3 border-t border-zinc-800">
              <button
                onClick={onClose}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
