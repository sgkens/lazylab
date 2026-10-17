import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  X,
  Layers,
  GitPullRequest,
  Workflow,
  Cpu,
  Boxes,
  Rocket,
  Key,
  FolderGit2,
  Tag as TagIcon,
  Target,
  ArrowRight,
  CheckCircle,
  XCircle,
  Clock,
  ExternalLink,
  Command,
  Award,
  Bot
} from 'lucide-react';
import { ActiveTab } from './Navbar';
import {
  GitLabMergeRequest,
  GitLabMilestone,
  GitLabPackage,
  GitLabPipeline,
  GitLabProject,
  GitLabRunner,
  GitLabTag,
  GitLabWorkItem
} from '../types/gitlab';

export interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateTab: (tab: ActiveTab) => void;
  onSelectWorkItem?: (item: GitLabWorkItem) => void;
  onSelectMR?: (mr: GitLabMergeRequest) => void;
  onOpenAgentSkill?: () => void;
  onSelectSettingsSection?: (section: 'general' | 'badges' | 'pages') => void;
  workItems: GitLabWorkItem[];
  mergeRequests: GitLabMergeRequest[];
  pipelines: GitLabPipeline[];
  runners: GitLabRunner[];
  projects: GitLabProject[];
  milestones: GitLabMilestone[];
}

export type ScopedSearchCategory = 'plan' | 'cicd' | 'registry' | 'settings' | 'nav';

interface SearchResultItem {
  id: string;
  category: ScopedSearchCategory;
  categoryLabel: string;
  title: string;
  subtitle: string;
  badge?: string;
  badgeColor?: string;
  status?: string;
  action: () => void;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  isOpen,
  onClose,
  onNavigateTab,
  onSelectWorkItem,
  onSelectMR,
  onOpenAgentSkill,
  onSelectSettingsSection,
  workItems,
  mergeRequests,
  pipelines,
  runners,
  projects,
  milestones
}) => {
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ScopedSearchCategory | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSelectedIndex(0);
    } else {
      setQuery('');
      setSelectedCategory(null);
    }
  }, [isOpen]);

  // Static navigation routes
  const navigationItems: SearchResultItem[] = [
    {
      id: 'nav-dashboard',
      category: 'nav',
      categoryLabel: 'Navigation',
      title: 'Go to Dashboard',
      subtitle: 'Overview metrics, WAL throughput, and project health',
      action: () => {
        onNavigateTab('dashboard');
        onClose();
      }
    },
    {
      id: 'nav-work-items',
      category: 'nav',
      categoryLabel: 'Navigation',
      title: 'Go to Work Items (Tree & Flat)',
      subtitle: 'Issues, tasks, and incidents with tree hierarchy',
      action: () => {
        onNavigateTab('work_items');
        onClose();
      }
    },
    {
      id: 'nav-mrs',
      category: 'nav',
      categoryLabel: 'Navigation',
      title: 'Go to Merge Requests',
      subtitle: 'Code review, branch merges, and approval gates',
      action: () => {
        onNavigateTab('merge_requests');
        onClose();
      }
    },
    {
      id: 'nav-pipelines',
      category: 'nav',
      categoryLabel: 'Navigation',
      title: 'Go to CI/CD Pipelines',
      subtitle: 'Pipeline execution graph, stage jobs, and retries',
      action: () => {
        onNavigateTab('pipelines');
        onClose();
      }
    },
    {
      id: 'nav-ci-editor',
      category: 'nav',
      categoryLabel: 'Navigation',
      title: 'Go to Pipeline CI Editor',
      subtitle: 'Live .gitlab-ci.yml editor, presets, and visual DAG graph',
      action: () => {
        onNavigateTab('pipeline_editor');
        onClose();
      }
    },
    {
      id: 'nav-runners',
      category: 'nav',
      categoryLabel: 'Navigation',
      title: 'Go to Fleet Runners',
      subtitle: 'GitLab runner instances, tags, and lazy-loaded job traces',
      action: () => {
        onNavigateTab('runners');
        onClose();
      }
    },
    {
      id: 'nav-packages',
      category: 'nav',
      categoryLabel: 'Navigation',
      title: 'Go to Package Registry',
      subtitle: 'npm, Maven, PyPI, Container registry, and generic packages',
      action: () => {
        onNavigateTab('packages');
        onClose();
      }
    },
    {
      id: 'nav-releases',
      category: 'nav',
      categoryLabel: 'Navigation',
      title: 'Go to Releases & Tags',
      subtitle: 'Git tags, changelogs, binary assets, and tag comparison',
      action: () => {
        onNavigateTab('releases_tags');
        onClose();
      }
    },
    {
      id: 'nav-variables',
      category: 'nav',
      categoryLabel: 'Navigation',
      title: 'Go to CI/CD Variables',
      subtitle: 'Project and Group scoped variables, .env import/export',
      action: () => {
        onNavigateTab('ci_variables');
        onClose();
      }
    },
    {
      id: 'nav-milestones',
      category: 'nav',
      categoryLabel: 'Navigation',
      title: 'Go to Milestones',
      subtitle: 'Sprint targets, release dates, and burndown progress',
      action: () => {
        onNavigateTab('milestones');
        onClose();
      }
    },
    {
      id: 'nav-labels',
      category: 'nav',
      categoryLabel: 'Navigation',
      title: 'Go to Labels Manager',
      subtitle: 'Issue categorization, priority badges, and label creation',
      action: () => {
        onNavigateTab('labels');
        onClose();
      }
    },
    {
      id: 'nav-settings',
      category: 'nav',
      categoryLabel: 'Navigation',
      title: 'Go to Settings',
      subtitle: 'Repository metadata, Badges, and GitLab Pages',
      action: () => {
        onNavigateTab('repo_settings');
        onClose();
      }
    },
    {
      id: 'nav-agent-skill',
      category: 'nav',
      categoryLabel: 'Navigation',
      title: 'Go to AI Agent Skill & API',
      subtitle: 'Agent content rules (zero slop/jargon), cURL templates, and live test simulator',
      action: () => {
        onClose();
        if (onOpenAgentSkill) onOpenAgentSkill();
      }
    }
  ];

  // Build searchable items from loaded state
  const searchResults: SearchResultItem[] = [];
  const q = query.trim().toLowerCase();

  // 1. Work Items (Scope: Plan)
  workItems.forEach((item) => {
    searchResults.push({
      id: `wi-${item.id}`,
      category: 'plan',
      categoryLabel: 'Plan · Work Item',
      title: `#${item.iid} ${item.title}`,
      subtitle: `${item.work_item_type} · ${item.project_name || 'Project'} · ${item.labels.join(', ') || 'No labels'}`,
      badge: item.work_item_type,
      badgeColor: 'text-orange-400 bg-orange-950/60 border-orange-800/60',
      status: item.state,
      action: () => {
        onNavigateTab('work_items');
        if (onSelectWorkItem) onSelectWorkItem(item);
        onClose();
      }
    });
  });

  // 2. Merge Requests (Scope: Plan)
  mergeRequests.forEach((mr) => {
    searchResults.push({
      id: `mr-${mr.id}`,
      category: 'plan',
      categoryLabel: 'Plan · Merge Request',
      title: `!${mr.iid} ${mr.title}`,
      subtitle: `${mr.source_branch} → ${mr.target_branch} · ${mr.project_name || 'Project'}`,
      badge: mr.state === 'opened' ? 'Open' : mr.state,
      badgeColor: 'text-emerald-400 bg-emerald-950/60 border-emerald-800/60',
      status: mr.merge_status,
      action: () => {
        onNavigateTab('merge_requests');
        if (onSelectMR) onSelectMR(mr);
        onClose();
      }
    });
  });

  // 3. Pipelines (Scope: CI/CD)
  pipelines.forEach((p) => {
    searchResults.push({
      id: `pipe-${p.id}`,
      category: 'cicd',
      categoryLabel: 'CI/CD · Pipeline',
      title: `Pipeline #${p.id} (${p.ref})`,
      subtitle: `Commit ${p.sha?.slice(0, 8)} · Stages: ${p.stages?.join(', ') || 'prepare, build, test'}`,
      badge: p.status,
      badgeColor: p.status === 'success' ? 'text-emerald-400' : p.status === 'failed' ? 'text-rose-400' : 'text-sky-400',
      action: () => {
        onNavigateTab('pipelines');
        onClose();
      }
    });
  });

  // 4. Runners (Scope: CI/CD)
  runners.forEach((r) => {
    searchResults.push({
      id: `runner-${r.id}`,
      category: 'cicd',
      categoryLabel: 'CI/CD · Runner Fleet',
      title: `Runner #${r.id}: ${r.description}`,
      subtitle: `${r.runner_type} · Tags: ${r.tag_list?.join(', ') || 'all'} · IP: ${r.ip_address || 'internal'}`,
      badge: r.status,
      badgeColor: 'text-purple-400 bg-purple-950/60 border-purple-800/60',
      action: () => {
        onNavigateTab('runners');
        onClose();
      }
    });
  });

  // 5. Packages (Scope: Packages & Releases)
  const packagesIndex = [
    { name: '@labwi/cache-engine', version: '2.4.1', type: 'npm' },
    { name: 'com.platform:auth-orchestrator', version: '1.10.0', type: 'maven' },
    { name: 'gitlab-wal-analyzer', version: '0.8.2', type: 'pypi' },
    { name: 'registry.gitlab.com/platform/gitlab-orchestrator/app', version: 'v2.4.1', type: 'container' },
    { name: 'deploy-k8s-artifacts', version: '2026.10', type: 'generic' }
  ];

  packagesIndex.forEach((pkg, idx) => {
    searchResults.push({
      id: `pkg-${idx}`,
      category: 'registry',
      categoryLabel: 'Packages & Releases · Package',
      title: `${pkg.name} (${pkg.type})`,
      subtitle: `Version v${pkg.version} · Container & Package Registry`,
      badge: pkg.type,
      badgeColor: 'text-blue-400 bg-blue-950/60 border-blue-800/60',
      action: () => {
        onNavigateTab('packages');
        onClose();
      }
    });
  });

  // 6. Releases & Tags (Scope: Packages & Releases)
  const releasesIndex = [
    { title: 'Release v2.4.0 - Zero Downtime & WAL Caching', tag: 'v2.4.0' },
    { title: 'Release v2.3.0 - Fleet Runners & Milestones', tag: 'v2.3.0' },
    { title: 'Tag v2.3.9 - Hotfix Token Refresh Race Condition', tag: 'v2.3.9' }
  ];

  releasesIndex.forEach((rel, idx) => {
    searchResults.push({
      id: `rel-${idx}`,
      category: 'registry',
      categoryLabel: 'Packages & Releases · Tag/Release',
      title: rel.title,
      subtitle: `Git Tag ${rel.tag} · Production binary tarball & release notes`,
      badge: rel.tag,
      badgeColor: 'text-amber-400 bg-amber-950/60 border-amber-800/60',
      action: () => {
        onNavigateTab('releases_tags');
        onClose();
      }
    });
  });

  // 7. Project Settings & Badges (Scope: Settings)
  searchResults.push({
    id: 'settings-badges',
    category: 'settings',
    categoryLabel: 'Settings',
    title: 'Badges',
    subtitle: 'Configure and set automated CI/CD pipeline, coverage, and release version badges',
    badge: 'Badges',
    badgeColor: 'text-purple-400 bg-purple-950/60 border-purple-800/60',
    action: () => {
      if (onSelectSettingsSection) onSelectSettingsSection('badges');
      onNavigateTab('repo_settings');
      onClose();
    }
  });

  searchResults.push({
    id: 'settings-repo-general',
    category: 'settings',
    categoryLabel: 'Settings',
    title: 'General',
    subtitle: 'Project metadata, topics, default branch, visibility, and custom logo',
    badge: 'General',
    badgeColor: 'text-orange-400 bg-orange-950/60 border-orange-800/60',
    action: () => {
      if (onSelectSettingsSection) onSelectSettingsSection('general');
      onNavigateTab('repo_settings');
      onClose();
    }
  });

  searchResults.push({
    id: 'settings-gitlab-pages',
    category: 'settings',
    categoryLabel: 'Settings',
    title: 'Pages',
    subtitle: 'Static website hosting, re-deploy trigger, and custom domain access',
    badge: 'Pages',
    badgeColor: 'text-emerald-400 bg-emerald-950/60 border-emerald-800/60',
    action: () => {
      if (onSelectSettingsSection) onSelectSettingsSection('pages');
      onNavigateTab('repo_settings');
      onClose();
    }
  });

  // Filter items
  const filtered = searchResults
    .concat(navigationItems)
    .filter((item) => {
      if (selectedCategory !== null && item.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        item.categoryLabel.toLowerCase().includes(q) ||
        (item.badge && item.badge.toLowerCase().includes(q))
      );
    })
    .slice(0, 25);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        filtered[selectedIndex].action();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const getCategoryIcon = (cat: ScopedSearchCategory) => {
    switch (cat) {
      case 'plan':
        return <Layers className="w-4 h-4 text-orange-400" />;
      case 'cicd':
        return <Workflow className="w-4 h-4 text-sky-400" />;
      case 'registry':
        return <Boxes className="w-4 h-4 text-amber-400" />;
      case 'settings':
        return <Award className="w-4 h-4 text-purple-400" />;
      default:
        return <ArrowRight className="w-4 h-4 text-zinc-400" />;
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-14 sm:pt-20 p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-zinc-950 border border-zinc-800 rounded-xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 bg-zinc-900 border-b border-zinc-800">
          <Search className="w-5 h-5 text-orange-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search work items, merge requests, badges, packages, pipelines... (Type or ↑↓ to navigate)"
            className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none font-mono"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-zinc-500 hover:text-zinc-300 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <div className="hidden sm:flex items-center gap-1 text-[11px] font-mono text-zinc-500 px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 shrink-0">
            <span>ESC</span>
          </div>
        </div>

        {/* Scoped Filter Pills (No 'All' category; clean scoped sections) */}
        <div className="flex items-center gap-1.5 px-4 py-2 bg-zinc-900/60 border-b border-zinc-800/80 overflow-x-auto scrollbar-none text-xs font-mono shrink-0">
          {[
            { id: 'plan', label: 'Plan', icon: <Layers className="w-3.5 h-3.5 text-orange-400" /> },
            { id: 'cicd', label: 'CI/CD', icon: <Workflow className="w-3.5 h-3.5 text-sky-400" /> },
            { id: 'registry', label: 'Packages', icon: <Boxes className="w-3.5 h-3.5 text-amber-400" /> },
            { id: 'settings', label: 'Settings', icon: <Award className="w-3.5 h-3.5 text-purple-400" /> },
            { id: 'nav', label: 'Navigation', icon: <Command className="w-3.5 h-3.5 text-zinc-400" /> }
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => {
                setSelectedCategory((prev) => (prev === cat.id ? null : (cat.id as ScopedSearchCategory)));
                setSelectedIndex(0);
              }}
              className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                selectedCategory === cat.id
                  ? 'bg-zinc-800 text-white font-bold border border-zinc-700 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              {cat.icon}
              <span>{cat.label}</span>
            </button>
          ))}
        </div>

        {/* Results List */}
        <div className="max-h-[60vh] overflow-y-auto divide-y divide-zinc-900 p-2">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-xs text-zinc-500 font-mono">
              No matching items or navigation routes found for &quot;{query}&quot;.
            </div>
          ) : (
            filtered.map((item, index) => {
              const isSelected = index === selectedIndex;

              return (
                <div
                  key={item.id}
                  onClick={item.action}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`p-3 rounded-lg cursor-pointer transition-colors flex items-center justify-between gap-3 text-xs ${
                    isSelected
                      ? 'bg-zinc-900 text-white ring-1 ring-orange-500/50'
                      : 'hover:bg-zinc-900/50 text-zinc-300'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-md bg-zinc-950 border border-zinc-800/80 shrink-0">
                      {getCategoryIcon(item.category)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-zinc-100 font-mono truncate">
                          {item.title}
                        </span>
                        {item.badge && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                              item.badgeColor || 'text-zinc-400 bg-zinc-950 border-zinc-800'
                            }`}
                          >
                            {item.badge}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-zinc-500 truncate block mt-0.5">
                        {item.subtitle}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-mono text-zinc-500 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800">
                      {item.categoryLabel}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-zinc-600" />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="px-4 py-2 bg-zinc-900/90 border-t border-zinc-800 flex items-center justify-between text-[11px] font-mono text-zinc-500">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>ESC Close</span>
          </div>
          <span>LabWI Global Command Engine</span>
        </div>
      </div>
    </div>
  );
};
