import React, { useState } from 'react';
import {
  Award,
  Check,
  Copy,
  ExternalLink,
  GitBranch,
  Info,
  RefreshCw,
  Rocket,
  Shield,
  Sparkles,
  Tag,
  Trash2,
  Workflow,
  X
} from 'lucide-react';
import { GitLabProject, GitLabBadge } from '../types/gitlab';
import { api } from '../services/api';
import { reportError } from '../utils/reportError';

export interface BadgePipelineModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: GitLabProject[];
  currentProjectId: number;
  onBadgesUpdated?: (badges: GitLabBadge[]) => void;
  onShowToast?: (msg: string) => void;
}

export const BadgePipelineModal: React.FC<BadgePipelineModalProps> = ({
  isOpen,
  onClose,
  projects,
  currentProjectId: initialProjectId,
  onBadgesUpdated,
  onShowToast
}) => {
  const [projectId, setProjectId] = useState<number>(initialProjectId || projects[0]?.id || 0);
  const [selectedTargets, setSelectedTargets] = useState<{
    main: boolean;
    develop: boolean;
    tags: boolean;
  }>({
    main: true,
    develop: true,
    tags: true
  });

  const [includePipeline, setIncludePipeline] = useState(true);
  const [includeCoverage, setIncludeCoverage] = useState(true);
  const [includeRelease, setIncludeRelease] = useState(true);
  const [badgeStyle, setBadgeStyle] = useState<'flat' | 'flat-square' | 'plastic' | 'for-the-badge'>('flat');
  const [replaceExisting, setReplaceExisting] = useState(true);

  const [isApplying, setIsApplying] = useState(false);
  const [copiedMarkdown, setCopiedMarkdown] = useState(false);
  const [setupSuccess, setSetupSuccess] = useState(false);

  if (!isOpen) return null;

  const currentProject = projects.find((p) => p.id === projectId) || projects[0];
  // Badges are served by the project's own GitLab instance.
  const baseUrl = (currentProject?.web_url || '').replace(/\/+$/, '');

  const toggleTarget = (target: 'main' | 'develop' | 'tags') => {
    setSelectedTargets((prev) => ({
      ...prev,
      [target]: !prev[target]
    }));
  };

  // Build live preview items
  interface PreviewBadgeItem {
    target: 'main' | 'develop' | 'tags';
    title: string;
    type: 'pipeline' | 'coverage' | 'release';
    imageUrl: string;
    linkUrl: string;
  }

  const previewItems: PreviewBadgeItem[] = [];

  if (selectedTargets.main) {
    if (includePipeline) {
      previewItems.push({
        target: 'main',
        title: 'Pipeline Status: main',
        type: 'pipeline',
        imageUrl: `${baseUrl}/badges/main/pipeline.svg?style=${badgeStyle}`,
        linkUrl: `${baseUrl}/-/commits/main`
      });
    }
    if (includeCoverage) {
      previewItems.push({
        target: 'main',
        title: 'Coverage: main',
        type: 'coverage',
        imageUrl: `${baseUrl}/badges/main/coverage.svg?style=${badgeStyle}`,
        linkUrl: `${baseUrl}/-/commits/main`
      });
    }
  }

  if (selectedTargets.develop) {
    if (includePipeline) {
      previewItems.push({
        target: 'develop',
        title: 'Pipeline Status: develop',
        type: 'pipeline',
        imageUrl: `${baseUrl}/badges/develop/pipeline.svg?style=${badgeStyle}`,
        linkUrl: `${baseUrl}/-/commits/develop`
      });
    }
    if (includeCoverage) {
      previewItems.push({
        target: 'develop',
        title: 'Coverage: develop',
        type: 'coverage',
        imageUrl: `${baseUrl}/badges/develop/coverage.svg?style=${badgeStyle}`,
        linkUrl: `${baseUrl}/-/commits/develop`
      });
    }
  }

  if (selectedTargets.tags) {
    if (includePipeline) {
      previewItems.push({
        target: 'tags',
        title: 'Pipeline Status: tags',
        type: 'pipeline',
        imageUrl: `${baseUrl}/badges/tags/pipeline.svg?style=${badgeStyle}`,
        linkUrl: `${baseUrl}/-/releases`
      });
    }
    if (includeRelease) {
      previewItems.push({
        target: 'tags',
        title: 'Release Version: tags',
        type: 'release',
        imageUrl: `${baseUrl}/-/badges/release.svg`,
        linkUrl: `${baseUrl}/-/releases`
      });
    }
  }

  const handleApplyBadges = async () => {
    const activeTargets: Array<'main' | 'develop' | 'tags'> = [];
    if (selectedTargets.main) activeTargets.push('main');
    if (selectedTargets.develop) activeTargets.push('develop');
    if (selectedTargets.tags) activeTargets.push('tags');

    if (activeTargets.length === 0) {
      reportError('Badges', new Error('select at least one branch or tag'));
      return;
    }

    try {
      setIsApplying(true);
      const res = await api.setupPipelineBadges(projectId, {
        targets: activeTargets,
        includePipeline,
        includeCoverage,
        includeRelease,
        style: badgeStyle,
        replaceExisting
      });

      if (res.success) {
        setSetupSuccess(true);
        if (onBadgesUpdated) onBadgesUpdated(res.badges);
        if (onShowToast) {
          onShowToast(`Successfully configured ${res.count} pipeline badges for tags, develop, and main!`);
        }
        setTimeout(() => {
          setSetupSuccess(false);
          onClose();
        }, 1200);
      }
    } catch (err: any) {
      reportError('Could not apply pipeline badges', err);
    } finally {
      setIsApplying(false);
    }
  };

  const generateMarkdownSnippet = () => {
    if (previewItems.length === 0) return '';
    return previewItems
      .map((item) => `[![${item.title}](${item.imageUrl})](${item.linkUrl})`)
      .join('\n');
  };

  const handleCopyMarkdown = () => {
    const md = generateMarkdownSnippet();
    if (!md) return;
    navigator.clipboard.writeText(md);
    setCopiedMarkdown(true);
    setTimeout(() => setCopiedMarkdown(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-3xl flex flex-col max-h-[90vh] shadow-2xl overflow-hidden text-xs">
        {/* Header */}
        <div className="px-6 py-4 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <span>Badges Pipeline for Repository</span>
                <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-purple-950 text-purple-300 border border-purple-800/80">
                  tags · develop · main
                </span>
              </h2>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Automatically generate, format, and set official pipeline status and coverage badges for your repository.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-zinc-200 rounded-md hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Target Repository Selector */}
          <div className="bg-zinc-900/60 border border-zinc-800/90 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-200">Target Repository</label>
              <p className="text-[11px] text-zinc-400">Badges will be registered on this project in GitLab.</p>
            </div>
            <select
              value={projectId}
              onChange={(e) => setProjectId(Number(e.target.value))}
              className="bg-zinc-950 border border-zinc-800 text-zinc-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-purple-500 font-mono"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.path_with_namespace})
                </option>
              ))}
            </select>
          </div>

          {/* Target Branches Selection (tags, develop, main) */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-zinc-200">
              Select Branches & Target Refs:
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* main card */}
              <div
                onClick={() => toggleTarget('main')}
                className={`cursor-pointer rounded-xl p-3.5 border transition-all select-none ${
                  selectedTargets.main
                    ? 'bg-purple-950/20 border-purple-500/60 ring-1 ring-purple-500/40 text-white'
                    : 'bg-zinc-900/40 border-zinc-800/80 text-zinc-400 hover:bg-zinc-900/70'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 font-bold">
                    <GitBranch className="w-4 h-4 text-emerald-400" />
                    <span>main</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={selectedTargets.main}
                    onChange={() => {}}
                    className="accent-purple-500 rounded w-4 h-4"
                  />
                </div>
                <p className="text-[11px] text-zinc-400 leading-normal">
                  Production branch. Generates pipeline status & live coverage badges.
                </p>
              </div>

              {/* develop card */}
              <div
                onClick={() => toggleTarget('develop')}
                className={`cursor-pointer rounded-xl p-3.5 border transition-all select-none ${
                  selectedTargets.develop
                    ? 'bg-purple-950/20 border-purple-500/60 ring-1 ring-purple-500/40 text-white'
                    : 'bg-zinc-900/40 border-zinc-800/80 text-zinc-400 hover:bg-zinc-900/70'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 font-bold">
                    <GitBranch className="w-4 h-4 text-sky-400" />
                    <span>develop</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={selectedTargets.develop}
                    onChange={() => {}}
                    className="accent-purple-500 rounded w-4 h-4"
                  />
                </div>
                <p className="text-[11px] text-zinc-400 leading-normal">
                  Development branch. Tracks ongoing continuous integration and nightly builds.
                </p>
              </div>

              {/* tags card */}
              <div
                onClick={() => toggleTarget('tags')}
                className={`cursor-pointer rounded-xl p-3.5 border transition-all select-none ${
                  selectedTargets.tags
                    ? 'bg-purple-950/20 border-purple-500/60 ring-1 ring-purple-500/40 text-white'
                    : 'bg-zinc-900/40 border-zinc-800/80 text-zinc-400 hover:bg-zinc-900/70'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 font-bold">
                    <Tag className="w-4 h-4 text-amber-400" />
                    <span>tags</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={selectedTargets.tags}
                    onChange={() => {}}
                    className="accent-purple-500 rounded w-4 h-4"
                  />
                </div>
                <p className="text-[11px] text-zinc-400 leading-normal">
                  Release tags. Tracks production releases, release versions, and release pipeline.
                </p>
              </div>
            </div>
          </div>

          {/* Badges Inclusion & Style Controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-zinc-900/40 p-4 rounded-xl border border-zinc-800/80">
            {/* Toggles */}
            <div className="space-y-2.5">
              <span className="text-xs font-semibold text-zinc-200 block mb-1">Included Badge Metrics</span>
              <label className="flex items-center gap-2 text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includePipeline}
                  onChange={(e) => setIncludePipeline(e.target.checked)}
                  className="accent-purple-500 rounded w-3.5 h-3.5"
                />
                <Workflow className="w-3.5 h-3.5 text-orange-400" />
                <span>CI/CD Pipeline Status Badge (pipeline.svg)</span>
              </label>

              <label className="flex items-center gap-2 text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeCoverage}
                  onChange={(e) => setIncludeCoverage(e.target.checked)}
                  className="accent-purple-500 rounded w-3.5 h-3.5"
                />
                <Shield className="w-3.5 h-3.5 text-emerald-400" />
                <span>Test Code Coverage Badge (coverage.svg)</span>
              </label>

              <label className="flex items-center gap-2 text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeRelease}
                  onChange={(e) => setIncludeRelease(e.target.checked)}
                  className="accent-purple-500 rounded w-3.5 h-3.5"
                />
                <Rocket className="w-3.5 h-3.5 text-blue-400" />
                <span>Release Version Badge (for tags target)</span>
              </label>
            </div>

            {/* Style & Options */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-200 mb-1">Badge Render Style</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['flat', 'flat-square', 'plastic', 'for-the-badge'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setBadgeStyle(st)}
                      className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-mono transition-colors text-center ${
                        badgeStyle === st
                          ? 'bg-purple-900/40 text-purple-200 border-purple-500 font-bold'
                          : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 text-zinc-400 cursor-pointer select-none text-[11px] pt-1">
                <input
                  type="checkbox"
                  checked={replaceExisting}
                  onChange={(e) => setReplaceExisting(e.target.checked)}
                  className="accent-purple-500 rounded w-3.5 h-3.5"
                />
                <span>Replace / update existing pipeline badges on repository</span>
              </label>
            </div>
          </div>

          {/* Live Preview List */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                <span>Live Generated Badges Preview ({previewItems.length} badges)</span>
              </span>
              <button
                type="button"
                onClick={handleCopyMarkdown}
                className="text-[11px] text-zinc-400 hover:text-white flex items-center gap-1 font-mono transition-colors"
                title="Copy markdown code for README.md"
              >
                {copiedMarkdown ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedMarkdown ? 'Copied Markdown!' : 'Copy README Markdown'}</span>
              </button>
            </div>

            {previewItems.length === 0 ? (
              <div className="p-8 text-center bg-zinc-900/30 rounded-xl border border-zinc-800/80 text-zinc-500">
                Please select at least one target and badge metric above to preview.
              </div>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {previewItems.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 bg-zinc-900/60 border border-zinc-800/80 rounded-xl flex items-center justify-between gap-3 hover:border-zinc-700 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase shrink-0 ${
                          item.target === 'main'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/80'
                            : item.target === 'develop'
                            ? 'bg-sky-950 text-sky-300 border border-sky-800/80'
                            : 'bg-amber-950 text-amber-300 border border-amber-800/80'
                        }`}
                      >
                        {item.target}
                      </span>
                      <div className="truncate">
                        <span className="font-semibold text-zinc-200 block truncate">{item.title}</span>
                        <span className="text-[10px] font-mono text-zinc-500 truncate block">{item.linkUrl}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="bg-black/60 px-2 py-1 rounded border border-zinc-800 flex items-center">
                        <img
                          src={item.imageUrl}
                          alt={item.title}
                          className="h-5"
                          onError={(e: any) => {
                            e.target.style.display = 'none';
                          }}
                        />
                      </div>
                      <a
                        href={item.linkUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1 text-zinc-500 hover:text-zinc-200"
                        title="Test link destination"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 bg-zinc-900 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-1.5 text-zinc-400 text-[11px] font-mono">
            <Info className="w-3.5 h-3.5 text-purple-400 shrink-0" />
            <span>Updates SQLite WAL journal and syncs to GitLab repository badges.</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleApplyBadges}
              disabled={isApplying || previewItems.length === 0}
              className={`px-5 py-2 font-semibold text-white rounded-lg transition-all flex items-center gap-2 shadow-lg ${
                setupSuccess
                  ? 'bg-emerald-600 hover:bg-emerald-500'
                  : 'bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed'
              }`}
            >
              {isApplying ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Applying to Repository...</span>
                </>
              ) : setupSuccess ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Badges Configured!</span>
                </>
              ) : (
                <>
                  <Award className="w-4 h-4" />
                  <span>Set Badges for Repository ({previewItems.length})</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
