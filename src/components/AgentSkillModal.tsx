import React, { useState } from 'react';
import {
  Bot,
  Copy,
  Check,
  X,
  Code,
  Sparkles,
  ExternalLink,
  Send,
  Terminal,
  FileText,
  AlertCircle,
  Layers,
  GitPullRequest
} from 'lucide-react';

interface AgentSkillModalProps {
  isOpen: boolean;
  onClose: () => void;
  onToast?: (msg: string) => void;
}

export const AgentSkillModal: React.FC<AgentSkillModalProps> = ({
  isOpen,
  onClose,
  onToast
}) => {
  const [activeTab, setActiveTab] = useState<'skill' | 'endpoints' | 'test'>('skill');
  const [copiedSkill, setCopiedSkill] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState<string | null>(null);

  // Test form state
  const [testType, setTestType] = useState<'work-item' | 'merge-request'>('work-item');
  const [testTitle, setTestTitle] = useState('Add automated regression test harness for WAL journal');
  const [testDescription, setTestDescription] = useState(
`### Summary
Create an automated test suite verifying SQLite WAL roll-forward and replay consistency during abrupt process restarts.

### What Changed & Added
- Added unit tests for checkpointing under load.
- Added mock concurrency test with 100 parallel worker threads.

### Features List
- Test harness CLI command \`npm run test:wal\`.

### Acceptance Criteria
- [ ] Passes 100% of stress tests without journal corruption.`
  );
  const [testLabels, setTestLabels] = useState('agent, test, sqlite');
  const [testBranch, setTestBranch] = useState('feature/agent-wal-tests');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [testResponse, setTestResponse] = useState<any>(null);

  if (!isOpen) return null;

  const skillPromptText = `You are an autonomous software engineering AI agent connected to lazylab via its REST API. Send "Authorization: Bearer $LAZYLAB_TOKEN" (an agent token from the lazylab Vault) on every request.

## Content & Tone Discipline Rules
1. ZERO SLOP & ZERO JARGON: Strictly eliminate filler, buzzwords, and marketing terms (e.g. "supercharging", "seamless integration", "paradigm shift", "cutting-edge"). Write direct, technical English.
2. PROFESSIONAL & CONCISE: State the exact architecture, functional purpose, and verifiable changes in clear, crisp technical prose.
3. STRUCTURE FOR WORK ITEMS (ISSUES):
   - Summary: 1-2 sharp sentences outlining the core requirement.
   - What Changed / What's Added: Bulleted technical breakdown of all additions and modifications.
   - Features List: Explicit bullet points if new user or developer capabilities were created.
   - Acceptance Criteria: Concrete markdown checklist (- [ ] criteria).
4. STRUCTURE FOR MERGE REQUESTS:
   - Title: [Scope] Imperative, clear action.
   - Overview: Purpose of the merge request.
   - Changes Made: Itemized technical details.
   - Verification: Exactly how it was tested.

## REST Endpoints (Authorization: Bearer <agent token>)
- List Work Items: GET /api/agent/work-items?state=all
- Create Work Item: POST /api/agent/work-items (Body: { title, description, labels: string[], assignee_ids?: number[] })
- Update Work Item: PUT /api/agent/work-items/:iid (Body: { title?, description?, labels?: string[], state_event?: 'close' | 'reopen' })
- List Merge Requests: GET /api/agent/merge-requests?state=all
- Create Merge Request: POST /api/agent/merge-requests (Body: { title, description, source_branch, target_branch?, labels?: string[] })
- Update Merge Request: PUT /api/agent/merge-requests/:iid (Body: { title?, description?, labels?: string[], draft?: boolean, state_event?: 'close' | 'reopen' })
`;

  const handleCopySkill = () => {
    navigator.clipboard.writeText(skillPromptText);
    setCopiedSkill(true);
    if (onToast) onToast('Copied Agent Skill prompt to clipboard!');
    setTimeout(() => setCopiedSkill(false), 2500);
  };

  const handleCopyCurl = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCurl(id);
    if (onToast) onToast('Copied cURL command to clipboard!');
    setTimeout(() => setCopiedCurl(null), 2500);
  };

  const handleRunTest = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      setTestResponse(null);

      const labels = testLabels.split(',').map(l => l.trim()).filter(Boolean);

      let url = '/api/agent/work-items';
      let payload: any = {
        title: testTitle,
        description: testDescription,
        labels
      };

      if (testType === 'merge-request') {
        url = '/api/agent/merge-requests';
        payload = {
          title: testTitle,
          description: testDescription,
          source_branch: testBranch,
          target_branch: 'main',
          labels
        };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      setTestResponse(data);
      if (onToast) onToast(`Successfully created ${testType === 'work-item' ? 'work item' : 'merge request'} via Agent API!`);
    } catch (err: any) {
      setTestResponse({ success: false, error: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-3xl flex flex-col shadow-2xl overflow-hidden max-h-[90vh] text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-950 text-indigo-400 rounded-lg border border-indigo-800/80">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-white text-sm">LazyLab AI Agent Integration & Skill</h2>
                <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-semibold">
                  Bearer token auth
                </span>
              </div>
              <p className="text-zinc-400 text-[11px] mt-0.5">
                Writing rules and REST endpoints for coding agents. Issue a token in Vault → Agent tokens.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1 rounded hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 px-6 pt-3 pb-2 bg-zinc-900/60 border-b border-zinc-800 shrink-0">
          <button
            onClick={() => setActiveTab('skill')}
            className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 font-medium ${
              activeTab === 'skill'
                ? 'bg-zinc-800 text-white font-bold border border-zinc-700 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>Agent Skill Prompt & Rules</span>
          </button>
          <button
            onClick={() => setActiveTab('endpoints')}
            className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 font-medium ${
              activeTab === 'endpoints'
                ? 'bg-zinc-800 text-white font-bold border border-zinc-700 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Code className="w-3.5 h-3.5 text-sky-400" />
            <span>Endpoints & cURL</span>
          </button>
          <button
            onClick={() => setActiveTab('test')}
            className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 font-medium ${
              activeTab === 'test'
                ? 'bg-zinc-800 text-white font-bold border border-zinc-700 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span>Live Agent Simulator</span>
          </button>

          <button
            onClick={handleCopySkill}
            className="ml-auto px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-colors flex items-center gap-1.5 shadow-sm"
          >
            {copiedSkill ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedSkill ? 'Skill Copied!' : 'Copy Agent Skill'}</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 font-sans">
          {activeTab === 'skill' && (
            <div className="space-y-4">
              {/* Rules highlight banner */}
              <div className="bg-indigo-950/30 border border-indigo-900/60 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-indigo-300 font-bold">
                  <AlertCircle className="w-4 h-4 text-indigo-400" />
                  <span>Mandatory Content Rules for AI Agents</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-zinc-300 text-[11px] pt-1">
                  <div className="p-2.5 rounded-lg bg-zinc-900/80 border border-zinc-800">
                    <div className="font-semibold text-rose-400 mb-1">❌ Zero Slop & Corporate Jargon</div>
                    <p className="text-zinc-400">
                      Never write &ldquo;seamlessly leverage cutting-edge paradigms&rdquo; or vague puffery. Strictly write facts and implementation details.
                    </p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-zinc-900/80 border border-zinc-800">
                    <div className="font-semibold text-emerald-400 mb-1">✔ Direct, Professional & Well-Worded</div>
                    <p className="text-zinc-400">
                      Include a 1-sentence Summary, explicit What Changed / Added list, and Features List if new features were introduced.
                    </p>
                  </div>
                </div>
              </div>

              {/* Raw Prompt viewer */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-zinc-300 font-mono flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-zinc-500" />
                    Agent System Instruction (Paste into Agent Config / Custom GPT / Cursor):
                  </span>
                  <a
                    href="/api/agent/skill.md"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-indigo-400 hover:underline flex items-center gap-1"
                  >
                    <span>View raw /api/agent/skill.md</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="relative">
                  <pre className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-300 font-mono text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap select-all">
                    {skillPromptText}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'endpoints' && (
            <div className="space-y-4">
              <p className="text-zinc-400 text-xs">
                These endpoints require no authentication headers. You can invoke them via curl, python, or direct fetch:
              </p>

              {/* Work Items: Create */}
              <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded font-mono font-bold text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800">
                      POST
                    </span>
                    <span className="font-mono text-xs font-bold text-white">/api/agent/work-items</span>
                  </div>
                  <button
                    onClick={() =>
                      handleCopyCurl(
`curl -X POST http://localhost:3000/api/agent/work-items \\
  -H "Authorization: Bearer $LAZYLAB_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Add agent REST endpoints for work items",
    "description": "### Summary\\nExpose token-authenticated REST API routes for agent automation.\\n\\n### What Changed & Added\\n- Added /api/agent/work-items and /api/agent/merge-requests.\\n\\n### Features List\\n- Work item creation and live updating.",
    "labels": ["agent", "backend"]
  }'`,
                        'curl-create-wi'
                      )
                    }
                    className="text-[11px] text-zinc-400 hover:text-white flex items-center gap-1"
                  >
                    {copiedCurl === 'curl-create-wi' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedCurl === 'curl-create-wi' ? 'Copied' : 'Copy cURL'}</span>
                  </button>
                </div>
                <p className="text-zinc-400 text-[11px]">
                  Creates a new work item with structured description, labels, and assignees.
                </p>
              </div>

              {/* Work Items: Update */}
              <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded font-mono font-bold text-[10px] bg-amber-950 text-amber-400 border border-amber-800">
                      PUT
                    </span>
                    <span className="font-mono text-xs font-bold text-white">/api/agent/work-items/:iid</span>
                  </div>
                  <button
                    onClick={() =>
                      handleCopyCurl(
`curl -X PUT http://localhost:3000/api/agent/work-items/1 \\
  -H "Authorization: Bearer $LAZYLAB_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "description": "### Summary\\nUpdated following implementation.\\n\\n### What Changed & Added\\n- Verified with unit tests.",
    "labels": ["verified"]
  }'`,
                        'curl-update-wi'
                      )
                    }
                    className="text-[11px] text-zinc-400 hover:text-white flex items-center gap-1"
                  >
                    {copiedCurl === 'curl-update-wi' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedCurl === 'curl-update-wi' ? 'Copied' : 'Copy cURL'}</span>
                  </button>
                </div>
                <p className="text-zinc-400 text-[11px]">
                  Updates issue description, content, labels, assignees, or closes/reopens the item.
                </p>
              </div>

              {/* Merge Requests: Create */}
              <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded font-mono font-bold text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800">
                      POST
                    </span>
                    <span className="font-mono text-xs font-bold text-white">/api/agent/merge-requests</span>
                  </div>
                  <button
                    onClick={() =>
                      handleCopyCurl(
`curl -X POST http://localhost:3000/api/agent/merge-requests \\
  -H "Authorization: Bearer $LAZYLAB_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "[agent-api] Add work items and merge requests routes",
    "description": "### Overview\\nEnables autonomous agent pipelines to create merge requests.\\n\\n### Changes Made\\n- Implemented agent router handlers.\\n\\n### Verification\\n- Tested via curl.",
    "source_branch": "feature/agent-api",
    "target_branch": "main",
    "labels": ["agent-api"]
  }'`,
                        'curl-create-mr'
                      )
                    }
                    className="text-[11px] text-zinc-400 hover:text-white flex items-center gap-1"
                  >
                    {copiedCurl === 'curl-create-mr' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedCurl === 'curl-create-mr' ? 'Copied' : 'Copy cURL'}</span>
                  </button>
                </div>
                <p className="text-zinc-400 text-[11px]">
                  Creates a new Merge Request with source/target branch and description.
                </p>
              </div>

              {/* Merge Requests: Update */}
              <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded font-mono font-bold text-[10px] bg-amber-950 text-amber-400 border border-amber-800">
                      PUT
                    </span>
                    <span className="font-mono text-xs font-bold text-white">/api/agent/merge-requests/:iid</span>
                  </div>
                  <button
                    onClick={() =>
                      handleCopyCurl(
`curl -X PUT http://localhost:3000/api/agent/merge-requests/1 \\
  -H "Authorization: Bearer $LAZYLAB_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "[agent-api] Add work items and merge requests routes (Ready)",
    "description": "Updated PR description with final verification logs."
  }'`,
                        'curl-update-mr'
                      )
                    }
                    className="text-[11px] text-zinc-400 hover:text-white flex items-center gap-1"
                  >
                    {copiedCurl === 'curl-update-mr' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedCurl === 'curl-update-mr' ? 'Copied' : 'Copy cURL'}</span>
                  </button>
                </div>
                <p className="text-zinc-400 text-[11px]">
                  Updates title, description, labels, or draft state of a merge request.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'test' && (
            <form onSubmit={handleRunTest} className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="font-bold text-zinc-300">Action:</span>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="testType"
                    checked={testType === 'work-item'}
                    onChange={() => setTestType('work-item')}
                    className="accent-indigo-500"
                  />
                  <Layers className="w-3.5 h-3.5 text-orange-400" />
                  <span>Create Work Item</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="testType"
                    checked={testType === 'merge-request'}
                    onChange={() => setTestType('merge-request')}
                    className="accent-indigo-500"
                  />
                  <GitPullRequest className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Create Merge Request</span>
                </label>
              </div>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Title</label>
                <input
                  type="text"
                  value={testTitle}
                  onChange={(e) => setTestTitle(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-zinc-100 font-mono text-xs focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              {testType === 'merge-request' && (
                <div>
                  <label className="block text-zinc-400 font-semibold mb-1">Source Branch</label>
                  <input
                    type="text"
                    value={testBranch}
                    onChange={(e) => setTestBranch(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-zinc-100 font-mono text-xs focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>
              )}

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">
                  Structured Content / Description (Follows Skill Discipline)
                </label>
                <textarea
                  rows={6}
                  value={testDescription}
                  onChange={(e) => setTestDescription(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded p-3 text-zinc-100 font-mono text-xs focus:outline-none focus:border-indigo-500 leading-relaxed"
                />
              </div>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Labels (comma-separated)</label>
                <input
                  type="text"
                  value={testLabels}
                  onChange={(e) => setTestLabels(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-zinc-100 font-mono text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-[11px] text-zinc-500 font-mono">
                  Target: {testType === 'work-item' ? 'POST /api/agent/work-items' : 'POST /api/agent/merge-requests'}
                </span>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isSubmitting ? 'Dispatching...' : 'Dispatch Agent Request'}</span>
                </button>
              </div>

              {testResponse && (
                <div className="mt-4 p-3 bg-zinc-900 border border-zinc-800 rounded-lg">
                  <div className="text-[11px] font-mono text-zinc-400 mb-1 font-bold">API Response:</div>
                  <pre className="text-[11px] font-mono text-zinc-300 overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(testResponse, null, 2)}
                  </pre>
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
