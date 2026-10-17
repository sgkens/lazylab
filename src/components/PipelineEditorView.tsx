import React, { useState, useEffect } from 'react';
import {
  Workflow,
  Code,
  Play,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Save,
  GitBranch,
  RefreshCw,
  FileCode,
  Layout,
  Maximize2,
  Minimize2,
  Sparkles,
  HelpCircle,
  Layers,
  Cpu,
  ArrowRight,
  Shield,
  Eye,
  Check,
  GitCompare,
  Plus,
  Wand2,
  CheckSquare
} from 'lucide-react';
import { CiConfig, CiLintResult, GitLabProject } from '../types/gitlab';
import { api } from '../services/api';

interface PipelineEditorViewProps {
  projects: GitLabProject[];
  selectedProjectId: number | null;
  onSelectProject: (id: number) => void;
}

const TEMPLATES: Record<string, { label: string; desc: string; yaml: string }> = {
  nodejs: {
    label: 'Node.js / React Full Pipeline',
    desc: 'Lint, unit test with coverage, build bundle, docker image, and multi-stage deploy',
    yaml: `stages:
  - prepare
  - build
  - test
  - security
  - deploy

default:
  image: node:22-alpine
  cache:
    key: \${CI_COMMIT_REF_SLUG}
    paths:
      - node_modules/
      - .npm/

lint:eslint:
  stage: prepare
  script:
    - npm ci --prefer-offline
    - npm run lint

compile:bundle:
  stage: build
  needs: ["lint:eslint"]
  script:
    - npm run build
  artifacts:
    paths:
      - dist/
    expire_in: 1 week

docker:image:
  stage: build
  image: docker:27-dind
  services:
    - docker:27-dind
  script:
    - docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA .
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA

test:unit:
  stage: test
  needs: ["compile:bundle"]
  script:
    - npm test -- --coverage
  artifacts:
    reports:
      coverage_report:
        coverage_format: cobertura
        path: coverage/cobertura.xml

sast:semgrep:
  stage: security
  image: returntocorp/semgrep
  script:
    - semgrep scan --config auto --error
  allow_failure: true

deploy:staging:
  stage: deploy
  environment:
    name: staging
    url: https://staging.example.com
  script:
    - ./scripts/deploy.sh staging
  rules:
    - if: $CI_COMMIT_BRANCH == "main"

deploy:production:
  stage: deploy
  environment:
    name: production
    url: https://example.com
  script:
    - ./scripts/deploy.sh production
  when: manual
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
`
  },
  python: {
    label: 'Python FastAPI / Flask',
    desc: 'Poetry/pip dependency install, Ruff linting, Pytest, and Docker build',
    yaml: `stages:
  - test
  - build
  - deploy

default:
  image: python:3.12-slim

lint:ruff:
  stage: test
  script:
    - pip install ruff
    - ruff check .

unit:pytest:
  stage: test
  script:
    - pip install -r requirements.txt pytest
    - pytest -v --cov=app

docker:publish:
  stage: build
  needs: ["lint:ruff", "unit:pytest"]
  script:
    - docker build -t $CI_REGISTRY_IMAGE:latest .
`
  },
  docker: {
    label: 'Docker Multi-Architecture Build',
    desc: 'Buildx multi-arch (amd64 / arm64) push to GitLab Container Registry',
    yaml: `stages:
  - build
  - scan
  - release

build:container:
  stage: build
  image: docker:27-dind
  script:
    - docker buildx create --use
    - docker buildx build --platform linux/amd64,linux/arm64 -t $CI_REGISTRY_IMAGE:$CI_COMMIT_TAG --push .

trivy:scan:
  stage: scan
  needs: ["build:container"]
  image: aquasec/trivy:latest
  script:
    - trivy image --exit-code 1 --severity CRITICAL $CI_REGISTRY_IMAGE:$CI_COMMIT_TAG
  allow_failure: true
`
  },
  rust: {
    label: 'Rust Cargo Build & Test',
    desc: 'Rustfmt, Clippy, cargo test, and optimized release build',
    yaml: `stages:
  - check
  - test
  - build

default:
  image: rust:1.80-alpine

clippy:
  stage: check
  script:
    - cargo clippy -- -D warnings

test:cargo:
  stage: test
  needs: ["clippy"]
  script:
    - cargo test --all

build:release:
  stage: build
  needs: ["test:cargo"]
  script:
    - cargo build --release
  artifacts:
    paths:
      - target/release/app
`
  }
};

const JOB_SNIPPETS: { label: string; desc: string; snippet: string }[] = [
  {
    label: 'Pages Deployment',
    desc: 'Publish GitLab Pages static site from public/',
    snippet: `
pages:
  stage: deploy
  script:
    - mkdir -p public
    - cp -r dist/* public/
  artifacts:
    paths:
      - public
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
`
  },
  {
    label: 'SAST Security Audit',
    desc: 'Run automated Semgrep code vulnerability analysis',
    snippet: `
sast:semgrep:
  stage: security
  image: returntocorp/semgrep
  script:
    - semgrep scan --config auto --error
  allow_failure: true
`
  },
  {
    label: 'Docker in Docker Build',
    desc: 'Build container and push to GitLab Registry',
    snippet: `
docker:build:
  stage: build
  image: docker:27-dind
  services:
    - docker:27-dind
  script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
    - docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA .
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA
`
  },
  {
    label: 'Manual Production Gate',
    desc: 'Manual approval step for production deployment',
    snippet: `
deploy:production:
  stage: deploy
  environment:
    name: production
  script:
    - echo "Deploying to production..."
  when: manual
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
`
  }
];

export const PipelineEditorView: React.FC<PipelineEditorViewProps> = ({
  projects,
  selectedProjectId,
  onSelectProject
}) => {
  const currentProjectId = selectedProjectId || (projects.length > 0 ? projects[0].id : 901);
  const [originalContent, setOriginalContent] = useState('');
  const [content, setContent] = useState('');
  const [branch, setBranch] = useState('main');
  const [commitMessage, setCommitMessage] = useState('ci: update .gitlab-ci.yml pipeline configuration');
  const [triggerPipelineOnCommit, setTriggerPipelineOnCommit] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lintResult, setLintResult] = useState<CiLintResult | null>(null);
  const [isLinting, setIsLinting] = useState(false);
  const [viewMode, setViewMode] = useState<'split' | 'editor' | 'graph' | 'diff'>('split');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [isSnippetMenuOpen, setIsSnippetMenuOpen] = useState(false);
  const [formatSuccess, setFormatSuccess] = useState(false);

  useEffect(() => {
    loadCiConfig();
  }, [currentProjectId]);

  const loadCiConfig = async () => {
    try {
      setIsLoading(true);
      const res = await api.getCiConfig(currentProjectId);
      if (res.success) {
        setOriginalContent(res.config.content);
        setContent(res.config.content);
        setBranch(res.config.branch || 'main');
        lintContent(res.config.content);
      }
    } catch (err) {
      console.error('Failed to load CI config:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const lintContent = async (yamlText: string) => {
    try {
      setIsLinting(true);
      const res = await api.lintCiConfig(yamlText);
      if (res.success) {
        setLintResult(res.lint);
      }
    } catch (err) {
      console.error('Lint error:', err);
    } finally {
      setIsLinting(false);
    }
  };

  const handleContentChange = (val: string) => {
    setContent(val);
    lintContent(val);
  };

  const handleApplyTemplate = (key: string) => {
    const tpl = TEMPLATES[key];
    if (tpl) {
      setContent(tpl.yaml);
      lintContent(tpl.yaml);
    }
  };

  const handleInsertSnippet = (snippet: string) => {
    const updated = content.trimEnd() + '\n' + snippet.trim() + '\n';
    setContent(updated);
    lintContent(updated);
    setIsSnippetMenuOpen(false);
  };

  const handleFormatYaml = () => {
    try {
      // Standardize 2-space indentation, remove tabs, trim trailing spaces
      const formatted = content
        .split('\n')
        .map((line) => line.replace(/\t/g, '  ').trimEnd())
        .join('\n')
        .trim() + '\n';
      setContent(formatted);
      lintContent(formatted);
      setFormatSuccess(true);
      setTimeout(() => setFormatSuccess(false), 2000);
    } catch (err) {
      console.error('Format YAML failed:', err);
    }
  };

  const handleCommit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || !commitMessage.trim()) return;
    try {
      setIsSaving(true);
      const res = await api.saveCiConfig(currentProjectId, content, commitMessage, branch);
      if (res.success) {
        setOriginalContent(content);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);

        if (triggerPipelineOnCommit) {
          // Trigger test pipeline
          await api.retryPipeline(30101, currentProjectId);
        }
      }
    } catch (err) {
      console.error('Failed to save CI config:', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Group parsed jobs by stage for DAG visualization
  const stages = lintResult?.stages || ['build', 'test', 'deploy'];
  const jobsByStage: Record<string, any[]> = {};
  stages.forEach((st) => (jobsByStage[st] = []));

  (lintResult?.jobs || []).forEach((job) => {
    const st = job.stage || 'test';
    if (!jobsByStage[st]) jobsByStage[st] = [];
    jobsByStage[st].push(job);
  });

  const activeJobData = lintResult?.jobs?.find((j) => j.name === selectedJob);

  // Compute simple unified diff
  const originalLines = originalContent.split('\n');
  const currentLines = content.split('\n');

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-zinc-950 overflow-hidden h-full">
      {/* Top Header / Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 bg-zinc-900/90 border-b border-zinc-800 text-xs shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Project Selector */}
          <div className="flex items-center gap-2">
            <span className="text-zinc-500 font-medium">Project:</span>
            <select
              value={currentProjectId}
              onChange={(e) => onSelectProject(Number(e.target.value))}
              className="bg-zinc-900 border border-zinc-800 text-zinc-200 rounded px-2.5 py-1 text-xs focus:outline-none focus:border-orange-500 font-mono"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 font-mono text-zinc-400 bg-zinc-900 px-2.5 py-1 rounded border border-zinc-800">
            <FileCode className="w-3.5 h-3.5 text-orange-400" />
            <span>.gitlab-ci.yml</span>
          </div>

          {/* Quick Preset Templates */}
          <div className="flex items-center gap-1">
            <span className="text-zinc-500">Preset:</span>
            <select
              onChange={(e) => {
                if (e.target.value) handleApplyTemplate(e.target.value);
                e.target.value = '';
              }}
              defaultValue=""
              className="bg-zinc-900 border border-zinc-800 text-zinc-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-orange-500"
            >
              <option value="" disabled>
                Load Template...
              </option>
              {Object.entries(TEMPLATES).map(([key, t]) => (
                <option key={key} value={key}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Snippet Insertion Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsSnippetMenuOpen(!isSnippetMenuOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded font-medium transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-orange-400" />
              <span>Insert Job Snippet</span>
            </button>

            {isSnippetMenuOpen && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl p-1.5 z-50 text-xs animate-in fade-in duration-150">
                {JOB_SNIPPETS.map((snip) => (
                  <button
                    key={snip.label}
                    onClick={() => handleInsertSnippet(snip.snippet)}
                    className="w-full text-left p-2 rounded hover:bg-zinc-800 transition-colors block"
                  >
                    <span className="font-bold text-white block">{snip.label}</span>
                    <span className="text-[11px] text-zinc-400 block mt-0.5">{snip.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Format YAML Button */}
          <button
            onClick={handleFormatYaml}
            title="Auto-format and align YAML structure"
            className="flex items-center gap-1 px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded transition-colors"
          >
            <Wand2 className={`w-3.5 h-3.5 ${formatSuccess ? 'text-emerald-400' : 'text-purple-400'}`} />
            <span>{formatSuccess ? 'Formatted!' : 'Format'}</span>
          </button>
        </div>

        {/* View Mode & Commit Action */}
        <div className="flex items-center gap-2">
          {/* Lint Status Badge */}
          <button
            onClick={() => lintContent(content)}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 font-mono text-xs hover:bg-zinc-800 transition-colors"
            title="Re-run GitLab CI YAML lint"
          >
            {lintResult?.valid ? (
              <>
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400 font-semibold">Valid CI</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                <span className="text-rose-400 font-semibold">{lintResult?.errors.length || 1} Error</span>
              </>
            )}
          </button>

          {/* View Mode Toggle */}
          <div className="flex items-center bg-zinc-900 p-0.5 rounded border border-zinc-800">
            <button
              onClick={() => setViewMode('split')}
              className={`px-2 py-1 rounded transition-colors ${
                viewMode === 'split' ? 'bg-zinc-800 text-white font-semibold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Split View
            </button>
            <button
              onClick={() => setViewMode('editor')}
              className={`px-2 py-1 rounded transition-colors ${
                viewMode === 'editor' ? 'bg-zinc-800 text-white font-semibold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              YAML Only
            </button>
            <button
              onClick={() => setViewMode('graph')}
              className={`px-2 py-1 rounded transition-colors ${
                viewMode === 'graph' ? 'bg-zinc-800 text-white font-semibold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              DAG Graph
            </button>
            <button
              onClick={() => setViewMode('diff')}
              className={`px-2 py-1 rounded transition-colors flex items-center gap-1 ${
                viewMode === 'diff' ? 'bg-zinc-800 text-white font-semibold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <GitCompare className="w-3 h-3 text-orange-400" />
              <span>Diff</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Workspace (Split / Editor / DAG Graph / Diff) */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Diff View */}
        {viewMode === 'diff' && (
          <div className="flex-1 flex flex-col bg-zinc-950 p-6 overflow-y-auto font-mono text-xs">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-zinc-800">
              <span className="font-bold text-white text-sm">
                Uncommitted Changes vs Server Version ({branch})
              </span>
              <span className="text-zinc-500">
                {originalLines.length} original lines → {currentLines.length} new lines
              </span>
            </div>

            <div className="space-y-0.5 bg-black p-4 rounded-lg border border-zinc-800 overflow-x-auto">
              {currentLines.map((line, idx) => {
                const origLine = originalLines[idx];
                const isNew = origLine === undefined;
                const isChanged = origLine !== undefined && origLine !== line;

                if (isNew || isChanged) {
                  return (
                    <div key={idx} className="bg-emerald-950/40 text-emerald-300 px-2 py-0.5 rounded flex items-center gap-2">
                      <span className="w-6 text-emerald-500 select-none text-right">+{idx + 1}</span>
                      <span className="whitespace-pre">{line}</span>
                    </div>
                  );
                }

                return (
                  <div key={idx} className="text-zinc-400 hover:bg-zinc-900/50 px-2 py-0.5 flex items-center gap-2">
                    <span className="w-6 text-zinc-600 select-none text-right">{idx + 1}</span>
                    <span className="whitespace-pre">{line}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Left Side: Code Editor */}
        {(viewMode === 'split' || viewMode === 'editor') && (
          <div
            className={`flex flex-col bg-zinc-950 border-r border-zinc-800 overflow-hidden ${
              viewMode === 'split' ? 'w-full lg:w-1/2' : 'w-full'
            }`}
          >
            {/* Editor Top Bar */}
            <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/60 border-b border-zinc-800 text-xs font-mono text-zinc-400">
              <span className="flex items-center gap-1.5">
                <Code className="w-3.5 h-3.5 text-orange-400" />
                <span>Editor ({content.split('\n').length} lines)</span>
              </span>
              <span>Syntax: YAML / GitLab CI Spec</span>
            </div>

            {/* Monospace Code Editor Area */}
            <div className="flex-1 relative overflow-hidden flex">
              {/* Line Numbers */}
              <div className="w-12 bg-zinc-900/40 text-zinc-600 font-mono text-xs select-none p-3 text-right overflow-hidden shrink-0 border-r border-zinc-800/60">
                {content.split('\n').map((_, i) => (
                  <div key={i} className="leading-5">
                    {i + 1}
                  </div>
                ))}
              </div>

              {/* Textarea */}
              <textarea
                value={content}
                onChange={(e) => handleContentChange(e.target.value)}
                spellCheck={false}
                className="flex-1 p-3 bg-zinc-950 text-zinc-200 font-mono text-xs leading-5 resize-none focus:outline-none selection:bg-orange-500/30 selection:text-orange-200"
                placeholder="# Paste or write .gitlab-ci.yml definition..."
              />
            </div>

            {/* Commit Form Bottom Bar */}
            <form
              onSubmit={handleCommit}
              className="p-3 bg-zinc-900 border-t border-zinc-800 flex flex-wrap items-center gap-2 shrink-0"
            >
              <div className="flex items-center gap-1 text-xs text-zinc-400 bg-zinc-950 px-2 py-1.5 rounded border border-zinc-800 font-mono">
                <GitBranch className="w-3.5 h-3.5 text-zinc-500" />
                <input
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="bg-transparent text-zinc-200 w-16 focus:outline-none"
                  title="Target Branch"
                />
              </div>

              <input
                type="text"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="Commit message..."
                className="flex-1 min-w-[180px] px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-orange-500 font-mono"
              />

              <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={triggerPipelineOnCommit}
                  onChange={(e) => setTriggerPipelineOnCommit(e.target.checked)}
                  className="rounded bg-zinc-950 border-zinc-800 text-orange-600 focus:ring-0"
                />
                <span className="hidden xl:inline">Trigger pipeline</span>
              </label>

              <button
                type="submit"
                disabled={isSaving}
                className={`px-4 py-1.5 text-xs font-semibold text-white rounded flex items-center gap-1.5 transition-colors shrink-0 shadow-sm ${
                  saveSuccess ? 'bg-emerald-600' : 'bg-orange-600 hover:bg-orange-500'
                }`}
              >
                {saveSuccess ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Committed!</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>{isSaving ? 'Committing...' : 'Commit Changes'}</span>
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* Right Side: Visual DAG / Pipeline Graph */}
        {(viewMode === 'split' || viewMode === 'graph') && (
          <div
            className={`flex flex-col bg-zinc-950 overflow-hidden ${
              viewMode === 'split' ? 'w-full lg:w-1/2' : 'w-full'
            }`}
          >
            {/* Visualizer Top Bar */}
            <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/60 border-b border-zinc-800 text-xs font-mono text-zinc-400 shrink-0">
              <span className="flex items-center gap-1.5 font-bold text-white">
                <Workflow className="w-3.5 h-3.5 text-orange-400" />
                <span>Visual Pipeline DAG & Stages Graph</span>
              </span>
              <span>
                {stages.length} Stages • {lintResult?.jobs?.length || 0} Jobs
              </span>
            </div>

            {/* Warnings / Errors Banner if any */}
            {lintResult && (!lintResult.valid || lintResult.warnings.length > 0) && (
              <div className="p-3 bg-zinc-900/90 border-b border-zinc-800 space-y-1 text-xs shrink-0 max-h-32 overflow-y-auto">
                {lintResult.errors.map((err, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 text-rose-400 font-mono">
                    <XCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{err}</span>
                  </div>
                ))}
                {lintResult.warnings.map((warn, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 text-amber-400 font-mono">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>{warn}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Visual Graph Layout */}
            <div className="flex-1 p-6 overflow-x-auto overflow-y-auto bg-dot-pattern flex items-start gap-8">
              {stages.map((stageName, stageIdx) => {
                const stageJobs = jobsByStage[stageName] || [];

                return (
                  <div key={stageName} className="flex items-start shrink-0">
                    {/* Stage Column */}
                    <div className="w-64 flex flex-col bg-zinc-900/50 border border-zinc-800/80 rounded-xl overflow-hidden shadow-md">
                      {/* Stage Header */}
                      <div className="px-4 py-2.5 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
                        <span className="text-xs font-bold font-mono text-white capitalize flex items-center gap-2">
                          <span className="flex items-center justify-center w-4 h-4 rounded-full bg-zinc-800 text-[10px] text-zinc-400 font-bold">
                            {stageIdx + 1}
                          </span>
                          {stageName}
                        </span>
                        <span className="text-[11px] font-mono text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">
                          {stageJobs.length} {stageJobs.length === 1 ? 'job' : 'jobs'}
                        </span>
                      </div>

                      {/* Stage Jobs List */}
                      <div className="p-3 space-y-2.5">
                        {stageJobs.length === 0 ? (
                          <div className="py-6 text-center text-xs text-zinc-600 font-mono">
                            No jobs defined in this stage
                          </div>
                        ) : (
                          stageJobs.map((job) => {
                            const isSelected = selectedJob === job.name;
                            const hasNeeds = job.needs && job.needs.length > 0;

                            return (
                              <div
                                key={job.name}
                                onClick={() => setSelectedJob(isSelected ? null : job.name)}
                                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                                  isSelected
                                    ? 'bg-orange-950/40 border-orange-500 shadow-md ring-1 ring-orange-500'
                                    : 'bg-zinc-950 border-zinc-800/90 hover:border-zinc-700 hover:bg-zinc-900'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-1.5">
                                  <span className="text-xs font-bold font-mono text-zinc-100 truncate block">
                                    {job.name}
                                  </span>
                                  {job.when === 'manual' && (
                                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-800/60 shrink-0">
                                      manual
                                    </span>
                                  )}
                                  {job.allow_failure && (
                                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 shrink-0">
                                      optional
                                    </span>
                                  )}
                                </div>

                                {/* Dependencies indicator */}
                                {hasNeeds && (
                                  <div className="mt-2 text-[11px] font-mono text-zinc-400 flex items-center gap-1">
                                    <Layers className="w-3 h-3 text-orange-400 shrink-0" />
                                    <span className="truncate">needs: {job.needs.join(', ')}</span>
                                  </div>
                                )}

                                {/* Tags indicator */}
                                {job.tags && job.tags.length > 0 && (
                                  <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                                    {job.tags.map((tg: string) => (
                                      <span key={tg} className="text-[10px] font-mono text-zinc-500 bg-zinc-900 px-1 rounded">
                                        #{tg}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/* Arrow Connector between Stages */}
                    {stageIdx < stages.length - 1 && (
                      <div className="h-full flex items-center justify-center px-3 pt-6 text-zinc-700">
                        <ArrowRight className="w-5 h-5 text-zinc-700" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Selected Job Inspector Drawer */}
            {activeJobData && (
              <div className="p-4 bg-zinc-900 border-t border-zinc-800 shrink-0 text-xs animate-in slide-in-from-bottom duration-150">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white font-mono text-sm">{activeJobData.name}</span>
                    <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">
                      stage: {activeJobData.stage}
                    </span>
                  </div>
                  <button
                    onClick={() => setSelectedJob(null)}
                    className="text-zinc-500 hover:text-zinc-300 text-xs font-mono"
                  >
                    Close Inspector
                  </button>
                </div>

                <div className="space-y-1.5 font-mono text-zinc-400">
                  {activeJobData.script && activeJobData.script.length > 0 && (
                    <div className="bg-black/60 p-2.5 rounded border border-zinc-800">
                      <span className="text-zinc-500 block mb-1">Execution script commands:</span>
                      {activeJobData.script.map((cmd: string, idx: number) => (
                        <div key={idx} className="text-zinc-200">
                          $ {cmd}
                        </div>
                      ))}
                    </div>
                  )}
                  {activeJobData.needs && (
                    <div className="text-[11px]">
                      <span className="text-zinc-500">DAG Dependencies (needs): </span>
                      <span className="text-orange-400 font-semibold">{activeJobData.needs.join(', ')}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
