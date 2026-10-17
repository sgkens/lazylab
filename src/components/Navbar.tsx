import React, { useState } from 'react';
import {
  LayoutDashboard,
  Layers,
  GitPullRequest,
  Workflow,
  Cpu,
  Target,
  Tag,
  RefreshCw,
  Database,
  Settings,
  Sun,
  Moon,
  Boxes,
  Rocket,
  Key,
  FileCode,
  FolderGit2,
  Search,
  Command,
  ChevronDown,
  Globe,
  Award,
  Bot,
  ShieldCheck,
  LogOut,
  Inbox
} from 'lucide-react';
import { AppStatus } from '../types/gitlab';

export type ActiveTab =
  | 'inbox'
  | 'dashboard'
  | 'work_items'
  | 'merge_requests'
  | 'pipelines'
  | 'pipeline_editor'
  | 'runners'
  | 'packages'
  | 'releases_tags'
  | 'ci_variables'
  | 'repo_settings'
  | 'milestones'
  | 'labels'
  | 'vault';

export type NavCategory = 'plan' | 'cicd' | 'registry' | 'settings' | 'none';

interface NavbarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  status: AppStatus | null;
  onRefresh: () => void;
  isSyncing: boolean;
  onOpenSettings: () => void;
  onOpenWal: () => void;
  onOpenSearch: () => void;
  onOpenAgentSkill?: () => void;
  workItemsCount: number;
  mrsCount: number;
  pipelinesCount: number;
  milestonesCount: number;
  inboxActionCount?: number;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  settingsSection?: 'general' | 'badges' | 'pages';
  onSelectSettingsSection?: (section: 'general' | 'badges' | 'pages') => void;
  username?: string | null;
  onLogout?: () => void;
  /** Rendered next to the Vault button (notification centre). */
  notificationSlot?: React.ReactNode;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onTabChange,
  status,
  onRefresh,
  isSyncing,
  onOpenSettings,
  onOpenWal,
  onOpenSearch,
  onOpenAgentSkill,
  workItemsCount,
  mrsCount,
  pipelinesCount,
  milestonesCount,
  inboxActionCount = 0,
  theme,
  onToggleTheme,
  settingsSection = 'badges',
  onSelectSettingsSection,
  username,
  onLogout,
  notificationSlot
}) => {
  const [navCategory, setNavCategory] = useState<NavCategory>(() => {
    if (['inbox', 'dashboard', 'work_items', 'merge_requests', 'milestones', 'labels'].includes(activeTab)) return 'plan';
    if (['pipelines', 'pipeline_editor', 'runners', 'ci_variables'].includes(activeTab)) return 'cicd';
    if (['packages', 'releases_tags'].includes(activeTab)) return 'registry';
    if (activeTab === 'repo_settings') return 'settings';
    return 'none';
  });

  React.useEffect(() => {
    if (['inbox', 'dashboard', 'work_items', 'merge_requests', 'milestones', 'labels'].includes(activeTab)) {
      setNavCategory('plan');
    } else if (['pipelines', 'pipeline_editor', 'runners', 'ci_variables'].includes(activeTab)) {
      setNavCategory('cicd');
    } else if (['packages', 'releases_tags'].includes(activeTab)) {
      setNavCategory('registry');
    } else if (activeTab === 'repo_settings') {
      setNavCategory('settings');
    } else {
      // Vault and other pages outside the four groups: no group is highlighted.
      setNavCategory('none');
    }
  }, [activeTab]);

  return (
    <header className="sticky top-0 z-40 flex flex-col bg-zinc-950/95 dark:bg-[#09090b]/95 backdrop-blur-md border-b border-zinc-800 transition-colors">
      {/* Tier 1: Main Top Bar with Brand, Global Search, and Utility Controls */}
      <div className="flex items-center justify-between gap-4 px-6 py-2.5 border-b border-zinc-900/80">
        {/* Brand title wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onTabChange('inbox');
            }}
            className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 hover:text-orange-400 transition-colors flex items-center gap-2"
          >
            <span className="flex items-center justify-center w-7 h-7 rounded-md bg-gradient-to-br from-orange-500 to-amber-600 text-white font-mono font-black text-sm shadow-sm">
              lz
            </span>
            <span className="font-extrabold tracking-tight">lazylab</span>
          </a>
          <span className="text-xs text-zinc-500 font-mono hidden xl:inline">
            {status?.isDemo ? 'demo·mode' : (status?.host ? status.host.replace(/^https?:\/\//, '') : 'gitlab.com')}
          </span>
        </div>

        {/* Global Search Bar (Requested Feature) */}
        <div className="flex-1 max-w-md mx-2">
          <button
            onClick={onOpenSearch}
            className="flex items-center justify-between gap-3 w-full px-3.5 py-1.5 bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-lg text-xs font-mono transition-all group shadow-inner"
            title="Search across all work items, MRs, packages, tags, releases, and pipelines (Ctrl+K)"
          >
            <div className="flex items-center gap-2 truncate">
              <Search className="w-3.5 h-3.5 text-orange-400 shrink-0" />
              <span className="truncate">Search work items, MRs, packages, tags...</span>
            </div>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[10px] bg-zinc-950 border border-zinc-700 px-1.5 py-0.5 rounded text-zinc-400 font-mono shrink-0">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Right utility actions (Theme, WAL Cache, Refresh, Agent API, Settings) */}
        <div className="flex items-center gap-2 shrink-0">
          {/* AI Agent API & Skill Modal Trigger */}
          {onOpenAgentSkill && (
            <button
              onClick={onOpenAgentSkill}
              title="AI Agent Skill & No-Auth REST API"
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-300 hover:text-white border border-indigo-800/80 font-semibold transition-colors shadow-sm"
            >
              <Bot className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">Agent API</span>
            </button>
          )}

          {/* Theme Toggle Button */}
          <button
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Matte Black Dark Mode'}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-zinc-400" />}
          </button>

          {/* SQLite WAL Cache Monitor */}
          <button
            onClick={onOpenWal}
            title="SQLite WAL Cache Journal & Replay"
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono text-zinc-400 bg-zinc-900 hover:bg-zinc-800 hover:text-zinc-200 rounded border border-zinc-800 transition-colors"
          >
            <Database className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden md:inline">WAL</span>
            <span className="text-zinc-500 tabular-nums">
              {status?.walStats?.totalEntries ?? 0}
            </span>
          </button>

          {/* Sync / Refresh Button */}
          <button
            onClick={onRefresh}
            disabled={isSyncing}
            title="Revalidate & sync from GitLab"
            className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin text-orange-400' : ''}`} />
          </button>

          {/* Direct Project Settings link in Top Bar */}
          <button
            onClick={() => {
              onTabChange('repo_settings');
              if (onSelectSettingsSection) onSelectSettingsSection('badges');
            }}
            title="Adjust project settings, badges, and pages"
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors font-medium ${
              activeTab === 'repo_settings'
                ? 'bg-purple-950 text-purple-200 border border-purple-700 shadow-sm'
                : 'text-purple-300 bg-purple-950/40 hover:bg-purple-900/60 border border-purple-900/60'
            }`}
          >
            <Award className="w-3.5 h-3.5 text-purple-400" />
            <span className="hidden sm:inline">Settings</span>
          </button>

          {/* Connection Token Settings Modal */}
          <button
            onClick={onOpenSettings}
            title="GitLab Connection & Token Configuration"
            className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>

          {notificationSlot}

          {/* Vault: GitLab profiles, secrets, agent tokens, account */}
          <button
            onClick={() => onTabChange('vault')}
            title="Vault: GitLab profiles, secrets, agent tokens"
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors font-medium ${
              activeTab === 'vault'
                ? 'bg-emerald-950 text-emerald-200 border border-emerald-700 shadow-sm'
                : 'text-emerald-300 bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-900/60'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Vault</span>
          </button>

          {onLogout && (
            <button
              onClick={onLogout}
              title={username ? `Sign out ${username}` : 'Sign out'}
              className="flex items-center gap-1.5 p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
            >
              <LogOut className="w-4 h-4" />
              {username && <span className="hidden lg:inline text-xs font-mono">{username}</span>}
            </button>
          )}
        </div>
      </div>

      {/* Tier 2: Dedicated Scoped Navigation Strip (No 'All' category; clean scoped sections) */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-1.5 bg-zinc-950 text-xs">
        {/* Scoped Category Filter Pills */}
        <div className="flex items-center gap-1.5 border-r border-zinc-800/80 pr-3 mr-1 shrink-0">
          <button
            onClick={() => {
              setNavCategory('plan');
              if (!['inbox', 'dashboard', 'work_items', 'merge_requests', 'milestones', 'labels'].includes(activeTab)) {
                onTabChange('inbox');
              }
            }}
            className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              navCategory === 'plan'
                ? 'bg-zinc-800 text-orange-400 font-bold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-orange-400" />
            <span>Plan</span>
          </button>

          <button
            onClick={() => {
              setNavCategory('cicd');
              if (!['pipelines', 'pipeline_editor', 'runners', 'ci_variables'].includes(activeTab)) {
                onTabChange('pipelines');
              }
            }}
            className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              navCategory === 'cicd'
                ? 'bg-zinc-800 text-sky-400 font-bold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
            }`}
          >
            <Workflow className="w-3.5 h-3.5 text-sky-400" />
            <span>CI/CD</span>
          </button>

          <button
            onClick={() => {
              setNavCategory('registry');
              if (!['packages', 'releases_tags'].includes(activeTab)) {
                onTabChange('packages');
              }
            }}
            className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              navCategory === 'registry'
                ? 'bg-zinc-800 text-amber-400 font-bold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
            }`}
          >
            <Boxes className="w-3.5 h-3.5 text-amber-400" />
            <span>Packages & Releases</span>
          </button>

          <button
            onClick={() => {
              setNavCategory('settings');
              onTabChange('repo_settings');
              if (onSelectSettingsSection) onSelectSettingsSection('badges');
            }}
            className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              navCategory === 'settings' || activeTab === 'repo_settings'
                ? 'bg-purple-950 text-purple-200 border border-purple-700/80 font-bold shadow-sm'
                : 'text-purple-300 hover:text-white hover:bg-purple-950/40'
            }`}
          >
            <Award className="w-3.5 h-3.5 text-purple-400" />
            <span>Settings</span>
          </button>
        </div>

        {/* Tab Buttons (Rendered according to active scope) */}
        <nav className="flex-1 flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5">
          {/* SCOPE 1: PLAN */}
          {navCategory === 'plan' && (
            <>
              <button
                onClick={() => onTabChange('inbox')}
                className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeTab === 'inbox'
                    ? 'bg-zinc-800 text-white shadow-sm font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <Inbox className="w-3.5 h-3.5 text-orange-400" />
                <span>Inbox</span>
                {inboxActionCount > 0 && (
                  <span className="px-1.5 rounded-full bg-orange-600 text-white text-[10px] font-bold tabular-nums">
                    {inboxActionCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => onTabChange('dashboard')}
                className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeTab === 'dashboard'
                    ? 'bg-zinc-800 text-white shadow-sm font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <LayoutDashboard className="w-3.5 h-3.5 text-orange-400" />
                <span>Dashboard</span>
              </button>

              <button
                onClick={() => onTabChange('work_items')}
                className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeTab === 'work_items'
                    ? 'bg-zinc-800 text-white shadow-sm font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <Layers className="w-3.5 h-3.5 text-orange-400" />
                <span>Work Items</span>
                <span className="text-[11px] font-mono text-zinc-500 tabular-nums">({workItemsCount})</span>
              </button>

              <button
                onClick={() => onTabChange('merge_requests')}
                className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeTab === 'merge_requests'
                    ? 'bg-zinc-800 text-white shadow-sm font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <GitPullRequest className="w-3.5 h-3.5 text-emerald-400" />
                <span>Merge Requests</span>
                <span className="text-[11px] font-mono text-zinc-500 tabular-nums">({mrsCount})</span>
              </button>

              <button
                onClick={() => onTabChange('milestones')}
                className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeTab === 'milestones'
                    ? 'bg-zinc-800 text-white shadow-sm font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <Target className="w-3.5 h-3.5 text-teal-400" />
                <span>Milestones</span>
                <span className="text-[11px] font-mono text-zinc-500 tabular-nums">({milestonesCount})</span>
              </button>

              <button
                onClick={() => onTabChange('labels')}
                className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeTab === 'labels'
                    ? 'bg-zinc-800 text-white shadow-sm font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <Tag className="w-3.5 h-3.5 text-rose-400" />
                <span>Labels</span>
              </button>
            </>
          )}

          {/* SCOPE 2: CI/CD */}
          {navCategory === 'cicd' && (
            <>
              <button
                onClick={() => onTabChange('pipelines')}
                className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeTab === 'pipelines'
                    ? 'bg-zinc-800 text-white shadow-sm font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <Workflow className="w-3.5 h-3.5 text-sky-400" />
                <span>Pipelines</span>
                <span className="text-[11px] font-mono text-zinc-500 tabular-nums">({pipelinesCount})</span>
              </button>

              <button
                onClick={() => onTabChange('pipeline_editor')}
                className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeTab === 'pipeline_editor'
                    ? 'bg-zinc-800 text-white shadow-sm font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <FileCode className="w-3.5 h-3.5 text-orange-400" />
                <span>CI Editor</span>
              </button>

              <button
                onClick={() => onTabChange('runners')}
                className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeTab === 'runners'
                    ? 'bg-zinc-800 text-white shadow-sm font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <Cpu className="w-3.5 h-3.5 text-purple-400" />
                <span>Runners</span>
              </button>

              <button
                onClick={() => onTabChange('ci_variables')}
                className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeTab === 'ci_variables'
                    ? 'bg-zinc-800 text-white shadow-sm font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <Key className="w-3.5 h-3.5 text-emerald-400" />
                <span>Variables</span>
              </button>
            </>
          )}

          {/* SCOPE 3: PACKAGES & RELEASES */}
          {navCategory === 'registry' && (
            <>
              <button
                onClick={() => onTabChange('packages')}
                className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeTab === 'packages'
                    ? 'bg-zinc-800 text-white shadow-sm font-semibold ring-1 ring-blue-500/50'
                    : 'text-zinc-300 hover:text-white hover:bg-zinc-900/80 bg-blue-950/20 border border-blue-900/40'
                }`}
              >
                <Boxes className="w-3.5 h-3.5 text-blue-400" />
                <span>Packages</span>
              </button>

              <button
                onClick={() => onTabChange('releases_tags')}
                className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeTab === 'releases_tags'
                    ? 'bg-zinc-800 text-white shadow-sm font-semibold ring-1 ring-amber-500/50'
                    : 'text-zinc-300 hover:text-white hover:bg-zinc-900/80 bg-amber-950/20 border border-amber-900/40'
                }`}
              >
                <Rocket className="w-3.5 h-3.5 text-amber-400" />
                <span>Releases</span>
              </button>
            </>
          )}

          {/* SCOPE 4: SETTINGS */}
          {navCategory === 'settings' && (
            <>
              <button
                onClick={() => {
                  onTabChange('repo_settings');
                  if (onSelectSettingsSection) onSelectSettingsSection('badges');
                }}
                className={`px-3 py-1 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeTab === 'repo_settings' && settingsSection === 'badges'
                    ? 'bg-purple-950 text-purple-200 border border-purple-700 font-bold shadow-sm'
                    : 'text-purple-300 hover:text-white bg-purple-950/30 hover:bg-purple-900/50 border border-purple-900/40'
                }`}
              >
                <Award className="w-3.5 h-3.5 text-purple-400" />
                <span className="font-semibold">Badges</span>
              </button>

              <button
                onClick={() => {
                  onTabChange('repo_settings');
                  if (onSelectSettingsSection) onSelectSettingsSection('general');
                }}
                className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeTab === 'repo_settings' && settingsSection === 'general'
                    ? 'bg-zinc-800 text-white shadow-sm font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <FolderGit2 className="w-3.5 h-3.5 text-orange-400" />
                <span>General</span>
              </button>

              <button
                onClick={() => {
                  onTabChange('repo_settings');
                  if (onSelectSettingsSection) onSelectSettingsSection('pages');
                }}
                className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeTab === 'repo_settings' && settingsSection === 'pages'
                    ? 'bg-zinc-800 text-white shadow-sm font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <Globe className="w-3.5 h-3.5 text-emerald-400" />
                <span>Pages</span>
              </button>

              {onOpenAgentSkill && (
                <button
                  onClick={onOpenAgentSkill}
                  className="px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 text-indigo-300 hover:text-white bg-indigo-950/40 hover:bg-indigo-900/60 border border-indigo-900/60 font-semibold"
                >
                  <Bot className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Agent API</span>
                </button>
              )}

              <div className="h-4 w-px bg-zinc-800 mx-1 shrink-0" />

              <button
                onClick={onOpenSettings}
                className="px-2.5 py-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                title="Configure GitLab Host and Personal Access Token"
              >
                <Key className="w-3.5 h-3.5 text-amber-400" />
                <span>GitLab Token & Connection</span>
              </button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
};
