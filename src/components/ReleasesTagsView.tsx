import React, { useState, useEffect } from 'react';
import {
  Tag,
  Rocket,
  Plus,
  GitCommit,
  Calendar,
  User,
  Download,
  FolderArchive,
  ExternalLink,
  Shield,
  Search,
  RefreshCw,
  X,
  FileText,
  CheckCircle,
  Copy,
  Check,
  Sparkles,
  GitCompare,
  ArrowRight
} from 'lucide-react';
import { GitLabProject, GitLabRelease, GitLabTag } from '../types/gitlab';
import { api } from '../services/api';
import { reportError } from '../utils/reportError';

interface ReleasesTagsViewProps {
  projects: GitLabProject[];
  selectedProjectId: number | null;
  onSelectProject: (id: number) => void;
}

export const ReleasesTagsView: React.FC<ReleasesTagsViewProps> = ({
  projects,
  selectedProjectId,
  onSelectProject
}) => {
  const currentProjectId = selectedProjectId || (projects[0]?.id || 0);
  const [activeTab, setActiveTab] = useState<'releases' | 'tags'>('releases');
  const [releases, setReleases] = useState<GitLabRelease[]>([]);
  const [tags, setTags] = useState<GitLabTag[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [isCreateTagOpen, setIsCreateTagOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagRef, setNewTagRef] = useState('main');
  const [newTagMessage, setNewTagMessage] = useState('');

  const [isCreateReleaseOpen, setIsCreateReleaseOpen] = useState(false);
  const [newRelTag, setNewRelTag] = useState('');
  const [newRelName, setNewRelName] = useState('');
  const [newRelDesc, setNewRelDesc] = useState('');
  const [newRelRef, setNewRelRef] = useState('');
  const [notesInfo, setNotesInfo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isGeneratingNotes, setIsGeneratingNotes] = useState(false);
  const [compare, setCompare] = useState<{ markdown: string; commitCount: number; bump: string | null } | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);

  // Compare Tags Modal
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [baseTag, setBaseTag] = useState('');
  const [headTag, setHeadTag] = useState('');

  const [copiedSha, setCopiedSha] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [currentProjectId]);

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [relRes, tagsRes] = await Promise.all([
        api.getReleases(currentProjectId),
        api.getTags(currentProjectId)
      ]);
      if (relRes.success) setReleases(relRes.releases);
      if (tagsRes.success) {
        setTags(tagsRes.tags);
        if (tagsRes.tags.length >= 2) {
          setBaseTag(tagsRes.tags[1].name);
          setHeadTag(tagsRes.tags[0].name);
        } else if (tagsRes.tags.length === 1) {
          setBaseTag(tagsRes.tags[0].name);
          setHeadTag(tagsRes.tags[0].name);
        }
      }
    } catch (err) {
      reportError('Could not load releases/tags', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagName.trim()) return;
    try {
      const res = await api.createTag(currentProjectId, newTagName.trim(), newTagRef.trim(), newTagMessage.trim());
      if (res.success) {
        setTags([res.tag, ...tags]);
        setIsCreateTagOpen(false);
        setNewTagName('');
        setNewTagMessage('');
      }
    } catch (err: any) {
      setFormError(err.message || 'Could not create the tag');
    }
  };

  const handleCreateRelease = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRelTag.trim() || !newRelName.trim()) return;
    try {
      setFormError(null);
      const tagExists = tags.some((t) => t.name === newRelTag.trim());
      const res = await api.createRelease(currentProjectId, {
        tag_name: newRelTag.trim(),
        name: newRelName.trim(),
        description: newRelDesc.trim(),
        // GitLab creates the tag from `ref` when it does not exist yet.
        ref: tagExists ? undefined : newRelRef.trim() || defaultBranch
      });
      if (res.success) {
        setReleases([res.release, ...releases]);
        setIsCreateReleaseOpen(false);
        setNewRelTag('');
        setNewRelName('');
        setNewRelDesc('');
      }
    } catch (err: any) {
      setFormError(err.message || 'Could not create the release');
    }
  };

  const defaultBranch = projects.find((p) => p.id === currentProjectId)?.default_branch || 'main';

  // Notes from the commits since the newest tag, grouped by Conventional Commit type.
  const handleAutoGenerateReleaseNotes = async () => {
    const tag = newRelTag.trim();
    const to = tag && tags.some((t) => t.name === tag) ? tag : newRelRef.trim() || defaultBranch;
    setIsGeneratingNotes(true);
    setFormError(null);
    try {
      const { notes } = await api.getReleaseNotes(currentProjectId, to);
      setNewRelDesc(notes.markdown);
      if (!tag && notes.nextVersion) setNewRelTag(notes.nextVersion);
      if (!newRelName && (tag || notes.nextVersion)) setNewRelName(tag || notes.nextVersion || '');
      setNotesInfo(
        `${notes.commitCount} commits from ${notes.from ?? 'the first commit'} to ${to}` +
          (notes.bump ? `; suggested bump: ${notes.bump}${notes.nextVersion ? ` (${notes.nextVersion})` : ''}` : '')
      );
    } catch (err: any) {
      setFormError(`Could not read commits: ${err.message}`);
    } finally {
      setIsGeneratingNotes(false);
    }
  };

  useEffect(() => {
    if (!isCompareOpen) return;
    if (!baseTag && tags[1]) setBaseTag(tags[1].name);
    if (!headTag && tags[0]) setHeadTag(tags[0].name);
  }, [isCompareOpen, tags]);

  useEffect(() => {
    if (!isCompareOpen || !baseTag || !headTag || baseTag === headTag) {
      setCompare(null);
      return;
    }
    setCompareError(null);
    api
      .getReleaseNotes(currentProjectId, headTag, baseTag)
      .then(({ notes }) => setCompare({ markdown: notes.markdown, commitCount: notes.commitCount, bump: notes.bump }))
      .catch((err) => setCompareError(err.message));
  }, [isCompareOpen, baseTag, headTag, currentProjectId]);

  const handleCopySha = (sha: string) => {
    navigator.clipboard.writeText(sha);
    setCopiedSha(sha);
    setTimeout(() => setCopiedSha(null), 2000);
  };

  const filteredReleases = releases.filter((r) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return r.name.toLowerCase().includes(q) || r.tag_name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q);
  });

  const filteredTags = tags.filter((t) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return t.name.toLowerCase().includes(q) || (t.message && t.message.toLowerCase().includes(q));
  });

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-zinc-950 overflow-y-auto">
      {/* Top Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 bg-zinc-900/60 border-b border-zinc-800 text-xs shrink-0">
        <div className="flex items-center gap-4 flex-wrap">
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

          {/* Tab Switcher */}
          <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded border border-zinc-800">
            <button
              onClick={() => setActiveTab('releases')}
              className={`px-3 py-1 rounded transition-colors flex items-center gap-1.5 ${
                activeTab === 'releases' ? 'bg-zinc-800 text-white font-semibold shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Rocket className="w-3.5 h-3.5 text-orange-400" />
              <span>Releases ({releases.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('tags')}
              className={`px-3 py-1 rounded transition-colors flex items-center gap-1.5 ${
                activeTab === 'tags' ? 'bg-zinc-800 text-white font-semibold shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Tag className="w-3.5 h-3.5 text-purple-400" />
              <span>Git Tags ({tags.length})</span>
            </button>
          </div>
        </div>

        {/* Search & Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search release, tag, or notes..."
              className="w-40 sm:w-56 pl-8 pr-3 py-1 text-xs bg-zinc-900 border border-zinc-800 rounded-md text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-orange-500 font-mono"
            />
          </div>

          <button
            onClick={() => setIsCompareOpen(true)}
            className="px-2.5 py-1 text-xs font-medium text-zinc-300 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-md transition-colors flex items-center gap-1.5"
            title="Compare changes between two tags"
          >
            <GitCompare className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Compare Tags</span>
          </button>

          <button
            onClick={loadData}
            disabled={isLoading}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
            title="Refresh releases and tags"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-orange-400' : ''}`} />
          </button>

          {activeTab === 'releases' ? (
            <button
              onClick={() => (setFormError(null), setNotesInfo(null), setIsCreateReleaseOpen(true))}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500 rounded-md transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Release</span>
            </button>
          ) : (
            <button
              onClick={() => (setFormError(null), setIsCreateTagOpen(true))}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 rounded-md transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Tag</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="p-6">
        {/* RELEASES TAB */}
        {activeTab === 'releases' && (
          <div className="space-y-4">
            <div className="mb-4">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Rocket className="w-5 h-5 text-orange-400" />
                <span>GitLab Releases</span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Version milestones, changelogs, build binary tarballs, and deployable release assets.
              </p>
            </div>

            {isLoading && releases.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
                <RefreshCw className="w-6 h-6 animate-spin text-orange-400 mb-2" />
                <span>Loading releases...</span>
              </div>
            ) : filteredReleases.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center bg-zinc-900/30 rounded-xl border border-zinc-800/60 p-6">
                <Rocket className="w-10 h-10 text-zinc-600 mb-3" />
                <h3 className="text-sm font-semibold text-zinc-300">No releases found</h3>
                <p className="text-xs text-zinc-500 mt-1 max-w-sm">
                  Publish a release associated with a Git tag to summarize features and distribute binaries.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredReleases.map((rel) => (
                  <div
                    key={rel.tag_name}
                    className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 shadow-sm space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-orange-950/60 text-orange-400 border border-orange-800/60">
                          <Rocket className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-bold text-white font-mono">{rel.name}</h3>
                            <span className="px-2 py-0.5 text-xs font-mono font-semibold rounded bg-zinc-800 text-orange-400 border border-zinc-700">
                              {rel.tag_name}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-zinc-400 font-mono mt-1">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-zinc-500" />
                              {new Date(rel.released_at).toLocaleDateString()}
                            </span>
                            {rel.author && (
                              <span className="flex items-center gap-1">
                                <User className="w-3 h-3 text-zinc-500" />
                                {rel.author.name}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {rel.commit_path && (
                          <a
                            href={rel.commit_path}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2.5 py-1 text-xs font-mono text-zinc-400 hover:text-white bg-zinc-950 rounded border border-zinc-800 flex items-center gap-1"
                          >
                            <GitCommit className="w-3.5 h-3.5 text-zinc-500" />
                            <span>Commit Ref</span>
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Markdown Description */}
                    <div className="bg-black/60 p-4 rounded-lg border border-zinc-800/80 font-mono text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">
                      {rel.description}
                    </div>

                    {/* Release Assets */}
                    {rel.assets && (
                      <div className="pt-2">
                        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block mb-2">
                          Assets & Binaries ({rel.assets.count})
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                          {rel.assets.sources?.map((src) => (
                            <a
                              key={src.format}
                              href={src.url}
                              target="_blank"
                              rel="noreferrer"
                              className="p-2.5 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 flex items-center justify-between text-xs font-mono text-zinc-300 hover:text-orange-400 transition-colors"
                            >
                              <span className="flex items-center gap-2 truncate">
                                <Download className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                                <span>Source code ({src.format})</span>
                              </span>
                              <ExternalLink className="w-3 h-3 text-zinc-600 shrink-0" />
                            </a>
                          ))}
                          {rel.assets.links?.map((lnk) => (
                            <a
                              key={lnk.name}
                              href={lnk.url}
                              target="_blank"
                              rel="noreferrer"
                              className="p-2.5 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 flex items-center justify-between text-xs font-mono text-zinc-300 hover:text-orange-400 transition-colors"
                            >
                              <span className="flex items-center gap-2 truncate">
                                <FolderArchive className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                                <span>{lnk.name}</span>
                              </span>
                              <ExternalLink className="w-3 h-3 text-zinc-600 shrink-0" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAGS TAB */}
        {activeTab === 'tags' && (
          <div className="space-y-4">
            <div className="mb-4">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Tag className="w-5 h-5 text-purple-400" />
                <span>Git Tags</span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Immutable commit pointers used to mark specific release points in Git history.
              </p>
            </div>

            {isLoading && tags.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
                <RefreshCw className="w-6 h-6 animate-spin text-orange-400 mb-2" />
                <span>Loading git tags...</span>
              </div>
            ) : filteredTags.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center bg-zinc-900/30 rounded-xl border border-zinc-800/60 p-6">
                <Tag className="w-10 h-10 text-zinc-600 mb-3" />
                <h3 className="text-sm font-semibold text-zinc-300">No git tags found</h3>
                <p className="text-xs text-zinc-500 mt-1 max-w-sm">
                  Create a new Git tag on any branch or commit ref to mark a build target.
                </p>
              </div>
            ) : (
              <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-zinc-900 text-zinc-400 border-b border-zinc-800 uppercase text-[11px] tracking-wider">
                      <tr>
                        <th className="px-5 py-3 font-semibold">Tag Name</th>
                        <th className="px-4 py-3 font-semibold">Commit Target</th>
                        <th className="px-4 py-3 font-semibold">Message / Annotation</th>
                        <th className="px-4 py-3 font-semibold">Release</th>
                        <th className="px-5 py-3 font-semibold text-right">Attributes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {filteredTags.map((t) => (
                        <tr key={t.name} className="hover:bg-zinc-900/50 transition-colors">
                          <td className="px-5 py-3.5 font-bold text-white whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <Tag className="w-3.5 h-3.5 text-purple-400" />
                              <span className="text-purple-300">{t.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span className="text-zinc-400 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800 text-[11px]">
                                {t.commit?.short_id || t.target?.slice(0, 8) || 'HEAD'}
                              </span>
                              <button
                                onClick={() => handleCopySha(t.commit?.id || t.target)}
                                className="text-zinc-500 hover:text-zinc-300 p-1"
                                title="Copy commit SHA"
                              >
                                {copiedSha === (t.commit?.id || t.target) ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-zinc-300 max-w-sm truncate">
                            {t.message || t.commit?.title || 'No annotation message'}
                          </td>
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            {t.release ? (
                              <span className="px-2 py-0.5 rounded text-[11px] bg-orange-950/60 text-orange-400 border border-orange-800/60 flex items-center gap-1 w-max">
                                <Rocket className="w-3 h-3" />
                                Associated
                              </span>
                            ) : (
                              <button
                                onClick={() => {
                                  setNewRelTag(t.name);
                                  setNewRelName(`Release ${t.name}`);
                                  (setFormError(null), setNotesInfo(null), setIsCreateReleaseOpen(true));
                                }}
                                className="text-zinc-500 hover:text-orange-400 text-[11px] underline"
                              >
                                Create Release
                              </button>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-right whitespace-nowrap">
                            {t.protected && (
                              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">
                                <Shield className="w-2.5 h-2.5" />
                                Protected
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Compare Tags Modal */}
      {isCompareOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-md flex flex-col shadow-2xl overflow-hidden text-xs font-mono">
            <div className="flex items-center justify-between px-6 py-4 bg-zinc-900 border-b border-zinc-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <GitCompare className="w-4 h-4 text-amber-400" />
                <span>Compare Git Tags</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsCompareOpen(false)}
                className="text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Base Tag (Earlier)</label>
                <select
                  value={baseTag}
                  onChange={(e) => setBaseTag(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-200 focus:outline-none focus:border-amber-500"
                >
                  {tags.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-center text-zinc-600">
                <ArrowRight className="w-4 h-4" />
              </div>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Target / Head Tag (Later)</label>
                <select
                  value={headTag}
                  onChange={(e) => setHeadTag(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-200 focus:outline-none focus:border-amber-500"
                >
                  {tags.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bg-zinc-900/80 p-3 rounded-lg border border-zinc-800 text-zinc-400 space-y-1">
                <div className="text-white font-bold">Comparison Diff Range:</div>
                <div className="text-orange-400 font-bold">{baseTag}...{headTag}</div>
                {compareError ? (
                  <div className="text-[11px] text-rose-300 pt-1">{compareError}</div>
                ) : baseTag === headTag ? (
                  <div className="text-[11px] text-zinc-500 pt-1">Pick two different tags.</div>
                ) : !compare ? (
                  <div className="text-[11px] text-zinc-500 pt-1">Reading commits…</div>
                ) : (
                  <>
                    <div className="text-[11px] text-zinc-400 pt-1">
                      {compare.commitCount} commits{compare.bump ? `; Conventional Commits imply a ${compare.bump} bump` : ''}
                    </div>
                    <pre className="text-[11px] text-zinc-300 whitespace-pre-wrap max-h-64 overflow-y-auto pt-2">{compare.markdown}</pre>
                  </>
                )}
              </div>
            </div>

            <div className="px-6 py-3 bg-zinc-900 border-t border-zinc-800 flex justify-end">
              <button
                type="button"
                onClick={() => setIsCompareOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 rounded-lg transition-colors"
              >
                Close Comparison
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Tag Modal */}
      {isCreateTagOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <form
            onSubmit={handleCreateTag}
            className="bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-md flex flex-col shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-6 py-4 bg-zinc-900 border-b border-zinc-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Tag className="w-4 h-4 text-purple-400" />
                <span>Create New Git Tag</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsCreateTagOpen(false)}
                className="text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs font-mono">
              <div>
                <label className="block font-semibold text-zinc-300 mb-1">Tag Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. v2.4.2"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-md text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block font-semibold text-zinc-300 mb-1">Target Ref / Branch</label>
                <input
                  type="text"
                  value={newTagRef}
                  onChange={(e) => setNewTagRef(e.target.value)}
                  placeholder="main, HEAD, or commit sha"
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-md text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block font-semibold text-zinc-300 mb-1">Message (Annotation)</label>
                <textarea
                  rows={3}
                  placeholder="Release annotation message..."
                  value={newTagMessage}
                  onChange={(e) => setNewTagMessage(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-md text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-purple-500 resize-none"
                />
              </div>
            </div>
            {formError && <p className="px-6 pb-3 text-[11px] text-rose-300 font-mono">{formError}</p>}
            <div className="px-6 py-3 bg-zinc-900 border-t border-zinc-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCreateTagOpen(false)}
                className="px-4 py-2 text-xs text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors"
              >
                Create Tag
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Create Release Modal */}
      {isCreateReleaseOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <form
            onSubmit={handleCreateRelease}
            className="bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-lg flex flex-col shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-6 py-4 bg-zinc-900 border-b border-zinc-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Rocket className="w-4 h-4 text-orange-400" />
                <span>Publish New Release</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsCreateReleaseOpen(false)}
                className="text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs font-mono">
              <div>
                <label className="block font-semibold text-zinc-300 mb-1">Tag Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. v2.4.1"
                  value={newRelTag}
                  onChange={(e) => setNewRelTag(e.target.value)}
                  list="release-tag-options"
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-md text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-orange-500"
                />
                <datalist id="release-tag-options">
                  {tags.map((t) => (
                    <option key={t.name} value={t.name} />
                  ))}
                </datalist>
              </div>
              {newRelTag.trim() && !tags.some((t) => t.name === newRelTag.trim()) && (
                <div>
                  <label className="block font-semibold text-zinc-300 mb-1">Create the tag from</label>
                  <input
                    type="text"
                    placeholder={defaultBranch}
                    value={newRelRef}
                    onChange={(e) => setNewRelRef(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-md text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-orange-500"
                  />
                </div>
              )}
              <div>
                <label className="block font-semibold text-zinc-300 mb-1">Release Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Release v2.4.1 - Stability & Metrics"
                  value={newRelName}
                  onChange={(e) => setNewRelName(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-md text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-orange-500"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-zinc-300">Release Notes (Markdown)</label>
                  <button
                    type="button"
                    onClick={handleAutoGenerateReleaseNotes}
                    className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1 font-bold"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{isGeneratingNotes ? 'Reading commits…' : 'Generate from commits'}</span>
                  </button>
                </div>
                <textarea
                  rows={6}
                  placeholder="### What's Changed&#10;- Feature A&#10;- Bugfix B"
                  value={newRelDesc}
                  onChange={(e) => setNewRelDesc(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-md text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-orange-500 leading-5"
                />
                {notesInfo && <p className="mt-1 text-[11px] text-zinc-500">{notesInfo}</p>}
              </div>
              {formError && <p className="text-[11px] text-rose-300">{formError}</p>}
            </div>
            <div className="px-6 py-3 bg-zinc-900 border-t border-zinc-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCreateReleaseOpen(false)}
                className="px-4 py-2 text-xs text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500 rounded-lg transition-colors"
              >
                Publish Release
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
