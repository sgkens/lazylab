import React, { useState, useEffect } from 'react';
import {
  Settings,
  Image,
  Upload,
  Globe,
  Award,
  Shield,
  ExternalLink,
  Plus,
  Trash2,
  Check,
  RefreshCw,
  FolderGit2,
  Lock,
  GitBranch,
  Save,
  CheckCircle,
  AlertTriangle,
  Clock,
  HardDrive,
  Copy,
  Tag,
  Workflow,
  Sparkles
} from 'lucide-react';
import { GitLabBadge, GitLabPagesInfo, GitLabProject } from '../types/gitlab';
import { BadgePipelineModal } from './BadgePipelineModal';
import { api } from '../services/api';
import { reportError } from '../utils/reportError';

interface ProjectSettingsViewProps {
  projects: GitLabProject[];
  selectedProjectId: number | null;
  onSelectProject: (id: number) => void;
  onProjectUpdated?: (updated: GitLabProject) => void;
  initialSection?: 'general' | 'badges' | 'pages';
  onSectionChange?: (section: 'general' | 'badges' | 'pages') => void;
}

export const ProjectSettingsView: React.FC<ProjectSettingsViewProps> = ({
  projects,
  selectedProjectId,
  onSelectProject,
  onProjectUpdated,
  initialSection = 'badges',
  onSectionChange
}) => {
  const currentProjectId = selectedProjectId || (projects[0]?.id || 0);
  const currentProject = projects.find((p) => p.id === currentProjectId) || projects[0];

  const [activeSection, setActiveSection] = useState<'general' | 'badges' | 'pages'>(initialSection);

  useEffect(() => {
    if (initialSection) {
      setActiveSection(initialSection);
    }
  }, [initialSection]);

  // General Settings State
  const [description, setDescription] = useState(currentProject?.description || '');
  const [topicsStr, setTopicsStr] = useState(currentProject?.topics?.join(', ') || '');
  const [visibility, setVisibility] = useState(currentProject?.visibility || 'private');
  const [defaultBranch, setDefaultBranch] = useState(currentProject?.default_branch || 'main');
  const [isSavingGeneral, setIsSavingGeneral] = useState(false);
  const [generalSaveSuccess, setGeneralSaveSuccess] = useState(false);

  // Logo Drag-and-Drop state
  const [avatarPreview, setAvatarPreview] = useState<string | null>(currentProject?.avatar_url || null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  // Badges state
  const [badges, setBadges] = useState<GitLabBadge[]>([]);
  const [isLoadingBadges, setIsLoadingBadges] = useState(false);
  const [isAddBadgeOpen, setIsAddBadgeOpen] = useState(false);
  const [isPipelineBadgesOpen, setIsPipelineBadgesOpen] = useState(false);
  const [newBadgeName, setNewBadgeName] = useState('');
  const [newBadgeLink, setNewBadgeLink] = useState('');
  const [newBadgeImage, setNewBadgeImage] = useState('');
  const [newBadgeKind, setNewBadgeKind] = useState<'project' | 'group'>('project');

  // Pages state
  const [pagesInfo, setPagesInfo] = useState<GitLabPagesInfo | null>(null);
  const [isLoadingPages, setIsLoadingPages] = useState(false);
  const [isUpdatingPages, setIsUpdatingPages] = useState(false);
  const [isRedeployingPages, setIsRedeployingPages] = useState(false);
  const [pagesMessage, setPagesMessage] = useState<string | null>(null);
  const [copiedPagesUrl, setCopiedPagesUrl] = useState(false);
  const [copiedBadgesMarkdown, setCopiedBadgesMarkdown] = useState(false);

  useEffect(() => {
    if (currentProject) {
      setDescription(currentProject.description || '');
      setTopicsStr(currentProject.topics?.join(', ') || '');
      setVisibility(currentProject.visibility || 'private');
      setDefaultBranch(currentProject.default_branch || 'main');
      setAvatarPreview(currentProject.avatar_url || null);
    }
    loadBadges();
    loadPages();
  }, [currentProjectId]);

  const group = currentProject?.namespace?.kind === 'group' ? currentProject.namespace : null;

  const loadBadges = async () => {
    try {
      setIsLoadingBadges(true);
      const [projBadges, grpBadges] = await Promise.all([
        api.getBadges('project', currentProjectId),
        // Group badges need group access a project maintainer may not have; that failure must not hide the project's own.
        group
          ? api.getBadges('group', group.id).catch((err) => {
              reportError('Could not load group badges', err);
              return { success: true, badges: [] as GitLabBadge[] };
            })
          : Promise.resolve({ success: true, badges: [] as GitLabBadge[] })
      ]);
      const combined: GitLabBadge[] = [
        ...(projBadges.success ? projBadges.badges : []),
        ...(grpBadges.success ? grpBadges.badges : [])
      ];
      setBadges(combined);
    } catch (err) {
      reportError('Could not load badges', err);
    } finally {
      setIsLoadingBadges(false);
    }
  };

  const loadPages = async () => {
    try {
      setIsLoadingPages(true);
      const res = await api.getPagesInfo(currentProjectId);
      if (res.success) {
        setPagesInfo(res.pages);
      }
    } catch (err: any) {
      setPagesInfo(null);
      setPagesMessage(`Could not read Pages settings: ${err.message}`);
    } finally {
      setIsLoadingPages(false);
    }
  };

  // Save General Settings
  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSavingGeneral(true);
      const topics = topicsStr
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const res = await api.updateProjectSettings(currentProjectId, {
        description,
        topics,
        visibility: visibility as any,
        default_branch: defaultBranch
      });

      if (res.success) {
        setGeneralSaveSuccess(true);
        if (onProjectUpdated) onProjectUpdated(res.project);
        setTimeout(() => setGeneralSaveSuccess(false), 3000);
      }
    } catch (err) {
      reportError('Could not update project settings', err);
    } finally {
      setIsSavingGeneral(false);
    }
  };

  // Logo file drop handler
  const handleDropLogo = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processLogoFile(e.dataTransfer.files[0]);
    }
  };

  const handleSelectLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processLogoFile(e.target.files[0]);
    }
  };

  const processLogoFile = (file: File) => {
    setLogoError(null);
    if (!file.type.startsWith('image/')) {
      setLogoError('Choose an image file (PNG, SVG, JPEG, WebP).');
      return;
    }
    // GitLab rejects avatars over 200 KB.
    if (file.size > 200 * 1024) {
      setLogoError('GitLab accepts avatars up to 200 KB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setAvatarPreview(dataUrl);

      try {
        setIsUploadingLogo(true);
        const res = await api.updateProjectAvatar(currentProjectId, dataUrl);
        if (res.success && currentProject && onProjectUpdated) {
          onProjectUpdated({ ...currentProject, avatar_url: res.avatar_url || dataUrl });
        }
      } catch (err: any) {
        setAvatarPreview(null);
        setLogoError(`Upload failed: ${err.message}`);
      } finally {
        setIsUploadingLogo(false);
      }
    };
    reader.readAsDataURL(file);
  };

  // Add Badge
  const handleAddBadge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBadgeName.trim() || !newBadgeLink.trim() || !newBadgeImage.trim()) return;

    try {
      const payload = {
        name: newBadgeName.trim(),
        link_url: newBadgeLink.trim(),
        image_url: newBadgeImage.trim(),
        kind: newBadgeKind,
        project_id: newBadgeKind === 'project' ? currentProjectId : undefined,
        group_id: newBadgeKind === 'group' ? group?.id : undefined
      };
      const res = await api.createBadge(payload);
      if (res.success) {
        setBadges([...badges, res.badge]);
        setIsAddBadgeOpen(false);
        setNewBadgeName('');
        setNewBadgeLink('');
        setNewBadgeImage('');
      }
    } catch (err) {
      reportError('Could not create badge', err);
    }
  };

  const handleDeleteBadge = async (b: GitLabBadge) => {
    try {
      const res = await api.deleteBadge(b.kind, b.kind === 'project' ? currentProjectId : b.group_id ?? group?.id ?? 0, b.id);
      if (res.success) {
        setBadges(badges.filter((item) => item.id !== b.id));
      }
    } catch (err) {
      reportError('Could not delete badge', err);
    }
  };

  // Toggle Pages HTTPS Only
  const handleToggleHttpsOnly = async () => {
    if (!pagesInfo) return;
    try {
      setIsUpdatingPages(true);
      const res = await api.updatePagesSettings(currentProjectId, {
        https_only: !pagesInfo.https_only
      });
      if (res.success) {
        setPagesInfo(res.pages);
      }
    } catch (err) {
      reportError('Could not update pages settings', err);
    } finally {
      setIsUpdatingPages(false);
    }
  };

  const handleCopyBadgesMarkdown = () => {
    if (badges.length === 0) return;
    const md = badges
      .map((b) => `[![${b.name}](${b.rendered_image_url || b.image_url})](${b.link_url})`)
      .join(' ');
    navigator.clipboard.writeText(md);
    setCopiedBadgesMarkdown(true);
    setTimeout(() => setCopiedBadgesMarkdown(false), 2000);
  };

  const handleRedeployPages = async () => {
    // Pages deploys from a pipeline: run one on the default branch and watch it.
    const ref = projects.find((p) => p.id === currentProjectId)?.default_branch || 'main';
    try {
      setIsRedeployingPages(true);
      setPagesMessage(null);
      const res = await api.runPipeline(currentProjectId, ref, [], true);
      setPagesMessage(`Pipeline #${res.pipeline.id} started on ${ref}. You will be notified when it finishes.`);
    } catch (err: any) {
      setPagesMessage(`Could not start a pipeline: ${err.message}`);
    } finally {
      setIsRedeployingPages(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-zinc-950 overflow-y-auto">
      {/* Sub-header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 bg-zinc-900/60 border-b border-zinc-800 text-xs shrink-0">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Project Selector */}
          <div className="flex items-center gap-2">
            <span className="text-zinc-500 font-medium">Project:</span>
            <select
              value={currentProjectId}
              onChange={(e) => onSelectProject(Number(e.target.value))}
              className="bg-zinc-900 border border-zinc-800 text-zinc-200 rounded px-2.5 py-1 text-xs focus:outline-none focus:border-orange-500"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Section Navigation Tabs */}
          <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded border border-zinc-800">
            <button
              onClick={() => {
                setActiveSection('badges');
                if (onSectionChange) onSectionChange('badges');
              }}
              className={`px-3 py-1 rounded transition-colors flex items-center gap-1.5 ${
                activeSection === 'badges' ? 'bg-purple-950 text-purple-200 border border-purple-800/80 font-bold shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Award className="w-3.5 h-3.5 text-purple-400" />
              <span>Badges ({badges.length})</span>
            </button>
            <button
              onClick={() => {
                setActiveSection('general');
                if (onSectionChange) onSectionChange('general');
              }}
              className={`px-3 py-1 rounded transition-colors flex items-center gap-1.5 ${
                activeSection === 'general' ? 'bg-zinc-800 text-white font-semibold shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Settings className="w-3.5 h-3.5 text-orange-400" />
              <span>General</span>
            </button>
            <button
              onClick={() => {
                setActiveSection('pages');
                if (onSectionChange) onSectionChange('pages');
              }}
              className={`px-3 py-1 rounded transition-colors flex items-center gap-1.5 ${
                activeSection === 'pages' ? 'bg-zinc-800 text-white font-semibold shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Globe className="w-3.5 h-3.5 text-emerald-400" />
              <span>Pages</span>
            </button>
          </div>

          {/* Quick Action: Set Badges */}
          <button
            onClick={() => {
              setActiveSection('badges');
              if (onSectionChange) onSectionChange('badges');
              setIsPipelineBadgesOpen(true);
            }}
            className="ml-auto px-3.5 py-1 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 rounded-md transition-colors flex items-center gap-1.5 shadow-sm"
            title="Configure and set CI/CD badges for tags, develop, and main branches"
          >
            <Workflow className="w-3.5 h-3.5" />
            <span>Set Badges</span>
          </button>
        </div>
      </div>

      {/* Main Content Sections */}
      <div className="p-6 max-w-5xl">
        {/* SECTION 1: REPOSITORY INFO & DRAG-AND-DROP LOGO */}
        {activeSection === 'general' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-orange-400" />
                <span>General</span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Manage repository metadata, topics, default branch, visibility, and custom logo for{' '}
                <span className="font-mono text-zinc-300">{currentProject?.name}</span>.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Logo Drag-and-Drop Card */}
              <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 flex flex-col items-center justify-between shadow-sm">
                <div className="w-full text-center">
                  <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1">
                    Project Avatar / Logo
                  </h3>
                  <p className="text-[11px] text-zinc-500 mb-4">
                    Drag and drop or browse to upload custom project icon
                  </p>

                  {/* Drop Zone */}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDropLogo}
                    className={`relative w-36 h-36 mx-auto rounded-2xl border-2 border-dashed flex flex-col items-center justify-center p-3 text-center transition-all cursor-pointer overflow-hidden ${
                      isDragging
                        ? 'border-orange-500 bg-orange-950/20 scale-105'
                        : 'border-zinc-700 bg-zinc-950 hover:border-zinc-600'
                    }`}
                  >
                    {avatarPreview ? (
                      <img
                        src={avatarPreview}
                        alt="Project Avatar"
                        className="w-full h-full object-cover rounded-xl"
                      />
                    ) : (
                      <div className="flex flex-col items-center text-zinc-500">
                        <Image className="w-8 h-8 mb-2 text-zinc-600" />
                        <span className="text-[11px] font-medium text-zinc-400">Drag & Drop icon</span>
                        <span className="text-[10px] text-zinc-600">PNG, SVG, JPG</span>
                      </div>
                    )}

                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleSelectLogoFile}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      title="Choose file"
                    />
                  </div>

                  {isUploadingLogo && (
                    <div className="text-xs text-orange-400 font-mono mt-2 flex items-center justify-center gap-1">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      <span>Saving logo to project...</span>
                    </div>
                  )}
                </div>

                <div className="mt-4 w-full">
                  <label className="w-full py-2 px-3 text-xs font-semibold text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer border border-zinc-700">
                    <Upload className="w-3.5 h-3.5 text-orange-400" />
                    <span>Upload New Logo</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleSelectLogoFile}
                      className="hidden"
                    />
                  </label>
                  {logoError && <p className="text-[11px] text-rose-300">{logoError}</p>}
                </div>
              </div>

              {/* Form Metadata */}
              <form
                onSubmit={handleSaveGeneral}
                className="lg:col-span-2 bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 space-y-4 shadow-sm text-xs"
              >
                <div>
                  <label className="block font-semibold text-zinc-300 mb-1">Project Description</label>
                  <textarea
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Brief description of the repository..."
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-orange-500 leading-relaxed font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-zinc-300 mb-1 flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-zinc-500" />
                    Topics / Tags (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={topicsStr}
                    onChange={(e) => setTopicsStr(e.target.value)}
                    placeholder="ci-cd, kubernetes, runners, typescript"
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-orange-500 font-mono"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-zinc-300 mb-1 flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-zinc-500" />
                      Visibility Level
                    </label>
                    <select
                      value={visibility}
                      onChange={(e) => setVisibility(e.target.value as any)}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:border-orange-500 font-mono capitalize"
                    >
                      <option value="private">Private (Only project members)</option>
                      <option value="internal">Internal (Any logged in user)</option>
                      <option value="public">Public (Anyone)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-zinc-300 mb-1 flex items-center gap-1.5">
                      <GitBranch className="w-3.5 h-3.5 text-zinc-500" />
                      Default Branch
                    </label>
                    <input
                      type="text"
                      value={defaultBranch}
                      onChange={(e) => setDefaultBranch(e.target.value)}
                      placeholder="main"
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 focus:outline-none focus:border-orange-500 font-mono"
                    />
                  </div>
                </div>

                <div className="pt-3 border-t border-zinc-800 flex items-center justify-between">
                  <div className="text-zinc-500 text-[11px] font-mono">
                    Path: {currentProject?.path_with_namespace}
                  </div>
                  <button
                    type="submit"
                    disabled={isSavingGeneral}
                    className={`px-4 py-2 font-semibold text-white rounded-lg flex items-center gap-1.5 transition-colors shadow-sm ${
                      generalSaveSuccess ? 'bg-emerald-600' : 'bg-orange-600 hover:bg-orange-500'
                    }`}
                  >
                    {generalSaveSuccess ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Saved Successfully</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-3.5 h-3.5" />
                        <span>{isSavingGeneral ? 'Saving...' : 'Save Settings'}</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* SECTION 2: PROJECT & NAMESPACE BADGES */}
        {activeSection === 'badges' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Award className="w-5 h-5 text-purple-400" />
                  <span>Badges</span>
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Visual badges displayed on repository overview and README files (pipeline status, test coverage, releases).
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsPipelineBadgesOpen(true)}
                  className="px-3 py-1.5 text-xs font-semibold text-purple-200 bg-purple-950/70 hover:bg-purple-900/90 border border-purple-800/80 rounded-md transition-colors flex items-center gap-1.5 shadow-sm"
                  title="Configure and set CI/CD badges for tags, develop, and main branches"
                >
                  <Workflow className="w-3.5 h-3.5 text-purple-400" />
                  <span>Set Badges</span>
                </button>
                <button
                  onClick={handleCopyBadgesMarkdown}
                  className="px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-md transition-colors flex items-center gap-1.5"
                  title="Copy markdown snippet for all badges to include in README.md"
                >
                  {copiedBadgesMarkdown ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedBadgesMarkdown ? 'Copied Markdown!' : 'Copy README Badges'}</span>
                </button>
                <button
                  onClick={() => setIsAddBadgeOpen(true)}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 rounded-md transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Badge</span>
                </button>
              </div>
            </div>

            {/* Badges Pipeline Setup Banner Card */}
            <div className="bg-gradient-to-r from-purple-950/40 via-zinc-900 to-zinc-900 border border-purple-800/60 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  <Workflow className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-white flex items-center gap-2">
                    <span>Badges for tags · develop · main</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-900/60 text-purple-300 border border-purple-700/60">
                      Automated Pipeline Badges
                    </span>
                  </h3>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Generate and set standard CI/CD pipeline, coverage, and release version badges across repository branches.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsPipelineBadgesOpen(true)}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors flex items-center gap-1.5 shadow-md"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Set Badges</span>
                </button>
              </div>
            </div>

            {/* Badges List */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {badges.map((b) => (
                <div
                  key={b.id}
                  className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4 flex flex-col justify-between hover:border-zinc-700 transition-colors shadow-sm"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-white">{b.name}</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 capitalize">
                        {b.kind} Badge
                      </span>
                    </div>

                    {/* Rendered Live Preview */}
                    <div className="my-3 p-3 bg-zinc-950 rounded-lg border border-zinc-800/80 flex items-center justify-center">
                      <img
                        src={b.rendered_image_url || b.image_url}
                        alt={b.name}
                        className="max-h-7"
                        onError={(e: any) => {
                          e.target.style.display = 'none';
                        }}
                      />
                    </div>

                    <div className="space-y-1 text-[11px] font-mono text-zinc-500">
                      <div className="truncate">
                        <span className="text-zinc-600">Link: </span>
                        <a href={b.link_url} target="_blank" rel="noreferrer" className="text-zinc-400 hover:underline">
                          {b.link_url}
                        </a>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-zinc-800 flex items-center justify-between text-xs">
                    <a
                      href={b.link_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-zinc-400 hover:text-white flex items-center gap-1"
                    >
                      <span>Visit Target</span>
                      <ExternalLink className="w-3 h-3 text-zinc-500" />
                    </a>
                    <button
                      onClick={() => handleDeleteBadge(b)}
                      className="text-zinc-500 hover:text-rose-400 p-1 rounded transition-colors"
                      title="Delete badge"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add Badge Modal */}
            {isAddBadgeOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
                <form
                  onSubmit={handleAddBadge}
                  className="bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-md flex flex-col shadow-2xl overflow-hidden text-xs"
                >
                  <div className="px-6 py-4 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
                    <h3 className="font-bold text-white flex items-center gap-2">
                      <Award className="w-4 h-4 text-purple-400" />
                      <span>Add New Badge</span>
                    </h3>
                  </div>
                  <div className="p-6 space-y-4">
                    <div>
                      <label className="block font-semibold text-zinc-300 mb-1">Badge Scope</label>
                      <select
                        value={newBadgeKind}
                        onChange={(e) => setNewBadgeKind(e.target.value as any)}
                        className="w-full bg-zinc-900 border border-zinc-800 text-zinc-200 rounded p-2 focus:outline-none focus:border-purple-500"
                      >
                        <option value="project">Project Badge ({currentProject?.name})</option>
                        <option value="group">Group / Namespace Badge (platform)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-semibold text-zinc-300 mb-1">Badge Name *</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Test Coverage"
                        value={newBadgeName}
                        onChange={(e) => setNewBadgeName(e.target.value)}
                        className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-200 focus:outline-none focus:border-purple-500"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-zinc-300 mb-1">Link URL *</label>
                      <input
                        type="url"
                        required
                        placeholder="https://gitlab.com/.../pipelines"
                        value={newBadgeLink}
                        onChange={(e) => setNewBadgeLink(e.target.value)}
                        className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-200 focus:outline-none focus:border-purple-500 font-mono"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-zinc-300 mb-1">Badge Image URL *</label>
                      <input
                        type="url"
                        required
                        placeholder="https://img.shields.io/badge/coverage-95%25-brightgreen.svg"
                        value={newBadgeImage}
                        onChange={(e) => setNewBadgeImage(e.target.value)}
                        className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-200 focus:outline-none focus:border-purple-500 font-mono"
                      />
                    </div>
                  </div>
                  <div className="px-6 py-3 bg-zinc-900 border-t border-zinc-800 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsAddBadgeOpen(false)}
                      className="px-4 py-2 text-zinc-400 hover:text-zinc-200"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 font-semibold text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors"
                    >
                      Add Badge
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        )}

        {/* SECTION 3: GITLAB PAGES DETAILS & METADATA */}
        {activeSection === 'pages' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Globe className="w-5 h-5 text-emerald-400" />
                <span>GitLab Pages Details & Deployment Metadata</span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Static website hosting configuration, HTTPS encryption, custom domains, and live deployment status.
              </p>
            </div>

            {isLoadingPages ? (
              <div className="py-20 flex flex-col items-center justify-center text-zinc-500">
                <RefreshCw className="w-6 h-6 animate-spin text-orange-400 mb-2" />
                <span>Retrieving GitLab Pages deployment status...</span>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Status Hero Card */}
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">
                        <Globe className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-white">Pages Deployment Status</h3>
                          {pagesInfo?.status === 'deployed' ? (
                            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-mono font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                              <span className="w-2 h-2 rounded-full bg-emerald-400" />
                              Deployed
                            </span>
                          ) : (
                            <span className="px-2.5 py-0.5 rounded text-xs font-mono font-bold bg-zinc-900 text-zinc-400 border border-zinc-800">
                              Not deployed
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-400 font-mono mt-0.5">
                          {pagesInfo?.deployed_at ? `Last deployed ${new Date(pagesInfo.deployed_at).toLocaleString()}` : 'No deployment recorded'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleRedeployPages}
                        disabled={isRedeployingPages}
                        className="px-3 py-1.5 text-xs font-semibold text-zinc-300 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
                        title="Trigger Pages deployment pipeline job"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isRedeployingPages ? 'animate-spin text-orange-400' : ''}`} />
                        <span>{isRedeployingPages ? 'Starting…' : 'Run Pages pipeline'}</span>
                      </button>

                      {pagesInfo?.url && (
                        <a
                          href={pagesInfo.url}
                          target="_blank"
                          rel="noreferrer"
                          className="px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
                        >
                          <span>Visit Site</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* URL Box */}
                  {pagesInfo?.url && (
                    <div className="bg-black/60 border border-zinc-800 rounded-lg p-3 flex items-center justify-between gap-2 text-xs font-mono">
                      <span className="text-emerald-400 font-semibold truncate">{pagesInfo.url}</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(pagesInfo.url);
                          setCopiedPagesUrl(true);
                          setTimeout(() => setCopiedPagesUrl(false), 2000);
                        }}
                        className="text-zinc-400 hover:text-white flex items-center gap-1 text-xs shrink-0"
                      >
                        {copiedPagesUrl ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy URL</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {pagesMessage && <p className="mt-3 text-xs text-zinc-300">{pagesMessage}</p>}

                  {/* Metrics Row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
                    <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800/80">
                      <span className="text-zinc-500 block">Deployed At</span>
                      <span className="font-mono text-zinc-200">
                        {pagesInfo?.deployed_at ? new Date(pagesInfo.deployed_at).toLocaleString() : 'Never'}
                      </span>
                    </div>
                    <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800/80">
                      <span className="text-zinc-500 block">Total Site Size</span>
                      <span className="font-mono text-zinc-200">
                        {pagesInfo?.size_bytes ? `${(pagesInfo.size_bytes / (1024 * 1024)).toFixed(1)} MB` : 'Not reported'}
                      </span>
                    </div>
                    <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800/80">
                      <span className="text-zinc-500 block">HTTPS Only</span>
                      <span className="font-semibold text-emerald-400">
                        {pagesInfo?.https_only ? 'Enforced' : 'Optional'}
                      </span>
                    </div>
                    <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800/80">
                      <span className="text-zinc-500 block">Access Control</span>
                      <span className="font-semibold text-zinc-300">
                        {pagesInfo?.access_control ? 'Project members' : 'Public'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* HTTPS Setting Switch */}
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 flex items-center justify-between text-xs shadow-sm">
                  <div>
                    <h4 className="font-bold text-white flex items-center gap-2">
                      <Shield className="w-4 h-4 text-emerald-400" />
                      <span>Enforce HTTPS Encryption</span>
                    </h4>
                    <p className="text-zinc-400 text-xs mt-0.5">
                      Automatically redirects any insecure HTTP traffic to HTTPS with TLS 1.3 certificates.
                    </p>
                  </div>
                  <button
                    onClick={handleToggleHttpsOnly}
                    disabled={isUpdatingPages}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      pagesInfo?.https_only ? 'bg-emerald-600' : 'bg-zinc-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
                        pagesInfo?.https_only ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Custom Domains */}
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 shadow-sm text-xs">
                  <h4 className="font-bold text-white mb-2">Custom Domains & SSL Certificates</h4>
                  {pagesInfo?.domains && pagesInfo.domains.length > 0 ? (
                    <div className="space-y-2">
                      {pagesInfo.domains.map((d) => (
                        <div
                          key={d.domain}
                          className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 flex items-center justify-between text-xs"
                        >
                          <div>
                            <span className="font-mono font-bold text-zinc-200">{d.domain}</span>
                            <div className="flex items-center gap-2 text-[11px] text-zinc-500 mt-0.5">
                              <span>Auto SSL: {d.auto_ssl_enabled ? 'Active (Let’s Encrypt)' : 'Manual'}</span>
                              <span>•</span>
                              <span>Expires: {d.certificate_expiration ? new Date(d.certificate_expiration).toLocaleDateString() : '74 days'}</span>
                            </div>
                          </div>
                          <span className="flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/60">
                            <CheckCircle className="w-3 h-3 text-emerald-400" />
                            Verified
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-zinc-500">No custom domains mapped to this GitLab Pages instance.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Badges Pipeline Modal (tags, develop, main) */}
      <BadgePipelineModal
        isOpen={isPipelineBadgesOpen}
        onClose={() => setIsPipelineBadgesOpen(false)}
        projects={projects}
        currentProjectId={currentProjectId}
        onBadgesUpdated={() => loadBadges()}
      />
    </div>
  );
};
