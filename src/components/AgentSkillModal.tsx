import React, { useEffect, useState } from 'react';
import { AlertTriangle, Bot, Check, Copy, ExternalLink, FileText, Plug, Send, Terminal, X } from 'lucide-react';
import { GitLabProject } from '../types/gitlab';

interface AgentSkillModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: GitLabProject[];
  defaultProjectId?: number | null;
  onToast?: (msg: string) => void;
  /** Opens Vault → Agent tokens. */
  onOpenTokens?: () => void;
}

type Tab = 'mcp' | 'rest' | 'skill' | 'try';

const MCP_TOOLS = [
  ['get_inbox', 'What needs you across projects'],
  ['list_projects', 'Member projects'],
  ['list_work_items / get_work_item', 'Read issues with comments'],
  ['create_work_item / update_work_item', 'File or change issues'],
  ['add_comment', 'Comment on an issue or MR'],
  ['list_merge_requests / get_merge_request / create_merge_request', 'Merge requests'],
  ['list_pipelines / get_pipeline_failures / get_job_failure', 'Pipelines and why they failed'],
  ['run_pipeline / retry_job', 'Start work on GitLab, watched by default'],
  ['watch / list_watches', 'Notify you when something finishes']
];

function CopyBlock({ text, onCopied }: { text: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="p-3 pr-10 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-300 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">
        {text}
      </pre>
      <button
        type="button"
        title="Copy"
        className="absolute top-2 right-2 p-1 text-zinc-500 hover:text-zinc-200"
        onClick={async () => {
          await navigator.clipboard.writeText(text).catch(() => undefined);
          setCopied(true);
          onCopied?.();
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

export const AgentSkillModal: React.FC<AgentSkillModalProps> = ({ isOpen, onClose, projects, defaultProjectId, onToast, onOpenTokens }) => {
  const [tab, setTab] = useState<Tab>('mcp');
  const [skill, setSkill] = useState<string | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);

  // "Try it" form
  const [kind, setKind] = useState<'work-item' | 'merge-request'>('work-item');
  const [projectId, setProjectId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('### Summary\n\n### Acceptance criteria\n- [ ] ');
  const [labels, setLabels] = useState('');
  const [branch, setBranch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [response, setResponse] = useState<any>(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  useEffect(() => {
    if (!isOpen) return;
    setProjectId((cur) => cur ?? defaultProjectId ?? projects[0]?.id ?? null);
    if (skill === null) {
      fetch('/api/agent/skill.md')
        .then(async (r) => (r.ok ? setSkill(await r.text()) : setSkillError(`HTTP ${r.status}`)))
        .catch((e) => setSkillError(e.message));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId) return;
    setSubmitting(true);
    setResponse(null);
    const labelList = labels.split(',').map((l) => l.trim()).filter(Boolean);
    const [url, body] =
      kind === 'work-item'
        ? ['/api/agent/work-items', { projectId, title, description, labels: labelList }]
        : ['/api/agent/merge-requests', { projectId, title, description, labels: labelList, source_branch: branch }];
    try {
      // Same route an agent uses; the browser session authenticates it.
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }));
      setResponse(data);
      if (data.success) onToast?.(kind === 'work-item' ? `Created #${data.workItem?.iid}` : `Created !${data.mergeRequest?.iid}`);
    } catch (err: any) {
      setResponse({ success: false, error: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'mcp', label: 'MCP', icon: <Plug className="w-3.5 h-3.5 text-indigo-400" /> },
    { id: 'rest', label: 'REST', icon: <Terminal className="w-3.5 h-3.5 text-sky-400" /> },
    { id: 'skill', label: 'Skill', icon: <FileText className="w-3.5 h-3.5 text-zinc-400" /> },
    { id: 'try', label: 'Try it', icon: <Send className="w-3.5 h-3.5 text-emerald-400" /> }
  ];

  const input = 'w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-zinc-100 font-mono text-xs focus:outline-none focus:border-indigo-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-3xl flex flex-col shadow-2xl overflow-hidden max-h-[90vh] text-xs"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-950 text-indigo-400 rounded-lg border border-indigo-800/80">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-white text-sm">Agent access</h2>
              <p className="text-zinc-400 text-[11px] mt-0.5">
                Coding agents use lazylab through MCP at <code>/mcp</code> or REST at <code>/api/agent</code>, with an agent token.
              </p>
            </div>
          </div>
          <button onClick={onClose} title="Close" className="text-zinc-400 hover:text-white p-1 rounded hover:bg-zinc-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-1 px-6 py-2 border-b border-zinc-800 bg-zinc-950 shrink-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 font-medium ${
                tab === t.id ? 'bg-zinc-800 text-white border border-zinc-700' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
          {onOpenTokens && (
            <button onClick={onOpenTokens} className="ml-auto px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold">
              Create agent token
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {tab === 'mcp' && (
            <>
              <p className="text-zinc-400">
                Register lazylab as an MCP server in Claude Code. Vault → Agent tokens shows this command with the token filled in, plus the
                Codex configuration.
              </p>
              <CopyBlock
                text={`claude mcp add --transport http lazylab ${origin}/mcp \\\n  --header "Authorization: Bearer $LAZYLAB_TOKEN"`}
                onCopied={() => onToast?.('Copied')}
              />
              <table className="w-full text-left">
                <thead>
                  <tr className="text-zinc-500">
                    <th className="py-1 font-semibold">Tools</th>
                    <th className="py-1 font-semibold">Use</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900">
                  {MCP_TOOLS.map(([name, use]) => (
                    <tr key={name}>
                      <td className="py-1.5 pr-4 font-mono text-zinc-200">{name}</td>
                      <td className="py-1.5 text-zinc-400">{use}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {tab === 'rest' && (
            <>
              <p className="text-zinc-400">
                Every request needs <code>Authorization: Bearer $LAZYLAB_TOKEN</code>. Full endpoint list:{' '}
                <a href="/api/agent/docs" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">
                  /api/agent/docs
                </a>
                .
              </p>
              <CopyBlock text={`curl -s -H "Authorization: Bearer $LAZYLAB_TOKEN" ${origin}/api/agent/inbox`} />
              <CopyBlock
                text={`curl -s -X POST ${origin}/api/agent/work-items \\\n  -H "Authorization: Bearer $LAZYLAB_TOKEN" -H "Content-Type: application/json" \\\n  -d '{"projectId": 123, "title": "[cache] Expire entries on TTL", "description": "### Summary\\nEntries never expire.", "labels": ["backend"]}'`}
              />
              <CopyBlock
                text={`curl -s -X POST ${origin}/api/agent/pipelines \\\n  -H "Authorization: Bearer $LAZYLAB_TOKEN" -H "Content-Type: application/json" \\\n  -d '{"projectId": 123, "ref": "main"}'`}
              />
              <CopyBlock text={`curl -s -H "Authorization: Bearer $LAZYLAB_TOKEN" "${origin}/api/agent/pipelines/456/failures?projectId=123"`} />
            </>
          )}

          {tab === 'skill' && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-zinc-400">The agent skill shipped in <code>skills/</code>: writing rules and endpoints.</p>
                <a href="/api/agent/skill.md" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline flex items-center gap-1">
                  Raw <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              {skillError ? (
                <p className="text-rose-300">Could not load the skill: {skillError}</p>
              ) : skill === null ? (
                <p className="text-zinc-500">Loading…</p>
              ) : (
                <CopyBlock text={skill} onCopied={() => onToast?.('Copied skill')} />
              )}
            </>
          )}

          {tab === 'try' && (
            <form onSubmit={submit} className="space-y-3">
              <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-900/70 bg-amber-950/30 text-amber-200">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>This sends the same request an agent would. It creates a real {kind === 'work-item' ? 'issue' : 'merge request'} in the selected project.</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-zinc-400 font-semibold">Create</span>
                  <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={input}>
                    <option value="work-item">Work item</option>
                    <option value="merge-request">Merge request</option>
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-zinc-400 font-semibold">Project</span>
                  <select value={projectId ?? ''} onChange={(e) => setProjectId(Number(e.target.value))} className={input} required>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.path_with_namespace}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-zinc-400 font-semibold">Title</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={input} required placeholder="[scope] Imperative summary" />
              </label>
              {kind === 'merge-request' && (
                <label className="block space-y-1">
                  <span className="text-zinc-400 font-semibold">Source branch (must exist)</span>
                  <input value={branch} onChange={(e) => setBranch(e.target.value)} className={input} required />
                </label>
              )}
              <label className="block space-y-1">
                <span className="text-zinc-400 font-semibold">Description</span>
                <textarea rows={6} value={description} onChange={(e) => setDescription(e.target.value)} className={`${input} leading-relaxed`} />
              </label>
              <label className="block space-y-1">
                <span className="text-zinc-400 font-semibold">Labels (comma-separated)</span>
                <input value={labels} onChange={(e) => setLabels(e.target.value)} className={input} />
              </label>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-500 font-mono">
                  POST {kind === 'work-item' ? '/api/agent/work-items' : '/api/agent/merge-requests'}
                </span>
                <button
                  type="submit"
                  disabled={submitting || !projectId}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-lg flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  {submitting ? 'Sending…' : 'Send'}
                </button>
              </div>
              {response && (
                <div className={`p-3 rounded-lg border ${response.success ? 'border-emerald-900 bg-emerald-950/20' : 'border-rose-900 bg-rose-950/20'}`}>
                  <div className={`text-[11px] font-semibold mb-1 ${response.success ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {response.success ? 'Created' : 'Failed'}
                  </div>
                  <pre className="text-[11px] font-mono text-zinc-300 whitespace-pre-wrap break-all">{JSON.stringify(response, null, 2)}</pre>
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
