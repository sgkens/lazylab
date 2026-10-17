/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { VaultView, VaultSection } from './components/VaultView';
import { NotificationCenter } from './components/NotificationCenter';
import { WatchContext } from './components/WatchButton';
import { NotifyState, WatchKind, LazyNotification } from './types/notify';
import { InboxView } from './components/InboxView';
import { Inbox } from './types/inbox';
import { Navbar, ActiveTab } from './components/Navbar';
import { ProjectSelector } from './components/ProjectSelector';
import { DashboardView } from './components/DashboardView';
import { WorkItemsView } from './components/WorkItemsView';
import { MergeRequestsView } from './components/MergeRequestsView';
import { PipelinesView } from './components/PipelinesView';
import { RunnersView } from './components/RunnersView';
import { MilestonesView } from './components/MilestonesView';
import { LabelsView } from './components/LabelsView';
import { CreateWorkItemModal } from './components/CreateWorkItemModal';
import { RegisterRunnerModal } from './components/RegisterRunnerModal';
import { SettingsModal } from './components/SettingsModal';
import { WalMonitorModal } from './components/WalMonitorModal';
import { JobTraceModal } from './components/JobTraceModal';
import { RunPipelineModal } from './components/RunPipelineModal';
import { PackagesView } from './components/PackagesView';
import { ReleasesTagsView } from './components/ReleasesTagsView';
import { PipelineEditorView } from './components/PipelineEditorView';
import { VariablesView } from './components/VariablesView';
import { ProjectSettingsView } from './components/ProjectSettingsView';
import { GlobalSearchModal } from './components/GlobalSearchModal';
import { SyncProgressBar } from './components/SyncProgressBar';
import { AgentSkillModal } from './components/AgentSkillModal';
import { api, notifyApi, sessionApi } from './services/api';
import { SessionState } from './types/vault';
import {
  AppStatus,
  GitLabLabel,
  GitLabMergeRequest,
  GitLabMilestone,
  GitLabPipeline,
  GitLabProject,
  GitLabRunner,
  GitLabWorkItem,
  WorkItemType
} from './types/gitlab';

/** Session gate: shows setup/login until the server reports an authenticated session. */
export default function App() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    try {
      setSession(await sessionApi.state());
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err.message || 'Cannot reach the lazylab server');
    }
  }, []);

  useEffect(() => {
    refreshSession();
    const onUnauthorized = () => refreshSession();
    window.addEventListener('lazylab:unauthorized', onUnauthorized);
    return () => window.removeEventListener('lazylab:unauthorized', onUnauthorized);
  }, [refreshSession]);

  if (!session) {
    return (
      <div className="min-h-screen bg-[#09090b] text-zinc-400 flex items-center justify-center text-xs font-mono">
        {loadError ?? 'Connecting…'}
      </div>
    );
  }

  if (!session.authenticated) {
    return <AuthScreen state={session} onAuthenticated={refreshSession} />;
  }

  return (
    <Workspace
      username={session.username}
      onSignedOut={refreshSession}
    />
  );
}

function Workspace({ username, onSignedOut }: { username: string | null; onSignedOut: () => void }) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('inbox');
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [notifyState, setNotifyState] = useState<NotifyState | null>(null);
  const [vaultSection, setVaultSection] = useState<VaultSection | undefined>(undefined);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [projects, setProjects] = useState<GitLabProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Matte Black Dark Mode vs Light Mode
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('labwi_theme') as 'dark' | 'light') || 'dark';
  });

  // Domain entities
  const [workItems, setWorkItems] = useState<GitLabWorkItem[]>([]);
  const [mergeRequests, setMergeRequests] = useState<GitLabMergeRequest[]>([]);
  const [pipelines, setPipelines] = useState<GitLabPipeline[]>([]);
  const [runners, setRunners] = useState<GitLabRunner[]>([]);
  const [milestones, setMilestones] = useState<GitLabMilestone[]>([]);
  const [labels, setLabels] = useState<GitLabLabel[]>([]);

  // UI state
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedWorkItem, setSelectedWorkItem] = useState<GitLabWorkItem | null>(null);
  const [isCreateWorkItemOpen, setIsCreateWorkItemOpen] = useState(false);
  const [isRegisterRunnerOpen, setIsRegisterRunnerOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isWalOpen, setIsWalOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isAgentSkillOpen, setIsAgentSkillOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<'general' | 'badges' | 'pages'>('badges');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Global Cmd+K / Ctrl+K keyboard shortcut for fast search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Job Trace modal state
  const [traceModal, setTraceModal] = useState<{
    isOpen: boolean;
    projectId: number;
    jobId: number | null;
    jobName?: string;
  }>({ isOpen: false, projectId: 901, jobId: null });

  const [isRunPipelineOpen, setIsRunPipelineOpen] = useState(false);

  const handleOpenJobTrace = (projectId: number, jobId: number, jobName?: string) => {
    setTraceModal({ isOpen: true, projectId, jobId, jobName });
  };

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('labwi_theme', next);
  };

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Initial load
  const loadInitialData = useCallback(async (force = false) => {
    try {
      setIsSyncing(true);
      const [statusRes, projectsRes, labelsRes, milestonesRes] = await Promise.all([
        api.getStatus(),
        api.getProjects(force),
        api.getLabels(undefined, force),
        api.getMilestones(undefined, force)
      ]);

      setStatus(statusRes);
      setProjects(projectsRes.projects || []);
      setLabels(labelsRes.labels || []);
      setMilestones(milestonesRes.milestones || []);

      // Preload data for Dashboard & Tabs
      const [wRes, mRes, pRes, rRes] = await Promise.all([
        api.getWorkItems(selectedProjectId || undefined, 'all', force),
        api.getMergeRequests(selectedProjectId || undefined, 'all', force),
        api.getPipelines(selectedProjectId || undefined, force),
        api.getRunners(force)
      ]);

      setWorkItems(wRes.workItems || []);
      setMergeRequests(mRes.mergeRequests || []);
      setPipelines(pRes.pipelines || []);
      setRunners(rRes.runners || []);
    } catch (err: any) {
      console.error('Failed loading initial data:', err);
      showToast(err.message || 'Error syncing data');
    } finally {
      setIsSyncing(false);
    }
  }, [selectedProjectId]);

  const loadNotify = useCallback(async () => {
    try {
      setNotifyState(await notifyApi.state());
    } catch (err) {
      console.error('Failed loading notifications:', err);
    }
  }, []);

  useEffect(() => {
    loadNotify();
  }, [loadNotify]);

  const watchKey = (kind: WatchKind, projectId: number, targetId: number) => `${kind}:${projectId}:${targetId}`;
  const watchedIds = React.useMemo(
    () => new Map((notifyState?.watches ?? []).map((w) => [watchKey(w.kind, w.project_id, w.target_id), w.id])),
    [notifyState]
  );

  const watchContext = React.useMemo(
    () => ({
      isWatched: (kind: WatchKind, projectId: number, targetId: number) => watchedIds.has(watchKey(kind, projectId, targetId)),
      toggleWatch: async (kind: WatchKind, projectId: number, targetId: number) => {
        const existing = watchedIds.get(watchKey(kind, projectId, targetId));
        try {
          if (existing) {
            await notifyApi.removeWatch(existing);
            showToast('Stopped watching');
          } else {
            await notifyApi.addWatch(kind, projectId, targetId);
            showToast("Watching. You'll be notified when it finishes.");
          }
        } catch (err: any) {
          showToast(err.message || 'Watch failed');
        }
        loadNotify();
      }
    }),
    [watchedIds, loadNotify]
  );

  /** Desktop notification when the tab is in the background; the toast covers the foreground case. */
  const announce = (n: LazyNotification) => {
    showToast(`${n.title}${n.body ? ` · ${n.body}` : ''}`);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
      const desktop = new Notification(n.title, { body: n.body, tag: n.id });
      const job = n.failedJob;
      if (job) {
        desktop.onclick = () => {
          window.focus();
          handleOpenJobTrace(job.projectId, job.jobId, job.name);
        };
      } else if (n.url) {
        desktop.onclick = () => window.open(n.url, '_blank', 'noopener');
      }
    }
  };

  const loadInbox = async (force = false) => {
    setInboxLoading(true);
    try {
      const res = await api.getInbox(force);
      setInbox(res.inbox);
    } catch (err: any) {
      console.error('Failed loading inbox:', err);
    } finally {
      setInboxLoading(false);
    }
  };

  const loadTabData = async (tab: ActiveTab, projId: number | null, force = false) => {
    try {
      if (tab === 'inbox') {
        await loadInbox(force);
      }
      if (tab === 'work_items' || tab === 'dashboard') {
        const res = await api.getWorkItems(projId || undefined, 'all', force);
        setWorkItems(res.workItems || []);
      }
      if (tab === 'merge_requests' || tab === 'dashboard') {
        const res = await api.getMergeRequests(projId || undefined, 'all', force);
        setMergeRequests(res.mergeRequests || []);
      }
      if (tab === 'pipelines' || tab === 'dashboard') {
        const res = await api.getPipelines(projId || undefined, force);
        setPipelines(res.pipelines || []);
      }
      if (tab === 'runners' || tab === 'dashboard') {
        const res = await api.getRunners(force);
        setRunners(res.runners || []);
      }
      if (tab === 'milestones' || tab === 'dashboard') {
        const res = await api.getMilestones(projId || undefined, force);
        setMilestones(res.milestones || []);
      }
      if (tab === 'labels') {
        const res = await api.getLabels(projId || undefined, force);
        setLabels(res.labels || []);
      }
    } catch (err: any) {
      console.error('Failed loading tab data:', err);
    }
  };

  useEffect(() => {
    loadInitialData(false);
  }, []);

  useEffect(() => {
    loadTabData(activeTab, selectedProjectId, false);
  }, [activeTab, selectedProjectId]);

  // Subscribe to real-time events via SSE
  useEffect(() => {
    const unsubscribe = api.subscribeEvents((event, data) => {
      if (event === 'notification') {
        announce(data as LazyNotification);
        loadNotify();
      } else if (event === 'watches_changed') {
        loadNotify();
      } else if (event === 'inbox_updated') {
        loadInbox(false);
      } else if (event === 'sync_completed') {
        loadTabData(activeTab, selectedProjectId, false);
        api.getStatus().then(setStatus).catch(() => {});
      } else if (event === 'work_item_updated' || event === 'work_item_created' || event === 'note_created') {
        loadTabData('work_items', selectedProjectId, true);
      } else if (event === 'merge_request_updated' || event === 'merge_request_merged' || event === 'mr_note_created') {
        loadTabData('merge_requests', selectedProjectId, true);
      } else if (event === 'pipeline_updated' || event === 'job_updated') {
        loadTabData('pipelines', selectedProjectId, true);
      } else if (event === 'runner_updated' || event === 'runner_registered' || event === 'runner_stopped') {
        loadTabData('runners', selectedProjectId, true);
      } else if (event === 'milestone_created') {
        loadTabData('milestones', selectedProjectId, true);
      }
    });

    return unsubscribe;
  }, [activeTab, selectedProjectId]);

  // Work Item Actions
  const handleToggleWorkItemState = async (
    iid: number,
    projectId: number,
    currentState: 'opened' | 'closed'
  ) => {
    const nextState = currentState === 'opened' ? 'close' : 'reopen';
    setWorkItems((prev) =>
      prev.map((item) =>
        item.iid === iid && item.project_id === projectId
          ? { ...item, state: nextState === 'close' ? 'closed' : 'opened' }
          : item
      )
    );
    if (selectedWorkItem && selectedWorkItem.iid === iid && selectedWorkItem.project_id === projectId) {
      setSelectedWorkItem((prev) =>
        prev ? { ...prev, state: nextState === 'close' ? 'closed' : 'opened' } : null
      );
    }

    try {
      await api.updateWorkItem(iid, { projectId, state_event: nextState });
      showToast(`Work item #${iid} marked as ${nextState === 'close' ? 'closed' : 'opened'}`);
    } catch (err: any) {
      showToast(`Error updating item #${iid}: ${err.message}`);
      loadTabData('work_items', selectedProjectId, true);
    }
  };

  const handleUpdateItemLabels = async (
    iid: number,
    projectId: number,
    currentLabels: string[],
    label: string,
    isRemove: boolean
  ) => {
    const newLabels = isRemove
      ? currentLabels.filter((l) => l !== label)
      : [...currentLabels, label];

    setWorkItems((prev) =>
      prev.map((item) =>
        item.iid === iid && item.project_id === projectId ? { ...item, labels: newLabels } : item
      )
    );
    if (selectedWorkItem && selectedWorkItem.iid === iid && selectedWorkItem.project_id === projectId) {
      setSelectedWorkItem((prev) => (prev ? { ...prev, labels: newLabels } : null));
    }

    try {
      await api.updateWorkItem(iid, { projectId, labels: newLabels });
      showToast(`Label "${label}" ${isRemove ? 'removed from' : 'assigned to'} #${iid}`);
    } catch (err: any) {
      showToast(`Error updating labels: ${err.message}`);
      loadTabData('work_items', selectedProjectId, true);
    }
  };

  const handleAssignMilestone = async (iid: number, projectId: number, milestoneId: number | null) => {
    const m = milestoneId ? milestones.find((mil) => mil.id === milestoneId) : null;
    setWorkItems((prev) =>
      prev.map((item) =>
        item.iid === iid && item.project_id === projectId
          ? { ...item, milestone: m ? { id: m.id, title: m.title } : null }
          : item
      )
    );
    if (selectedWorkItem && selectedWorkItem.iid === iid && selectedWorkItem.project_id === projectId) {
      setSelectedWorkItem((prev) =>
        prev ? { ...prev, milestone: m ? { id: m.id, title: m.title } : null } : null
      );
    }

    try {
      await api.updateWorkItem(iid, { projectId, milestone_id: milestoneId });
      showToast(`Milestone ${m ? `"${m.title}" assigned` : 'removed'} for #${iid}`);
    } catch (err: any) {
      showToast(`Error updating milestone: ${err.message}`);
      loadTabData('work_items', selectedProjectId, true);
    }
  };

  const handleAddSubTask = async (projectId: number, issueIid: number, title: string) => {
    try {
      const res = await api.addSubTask(projectId, issueIid, title);
      if (res.success && res.subtask) {
        setWorkItems((prev) =>
          prev.map((item) =>
            item.iid === issueIid && item.project_id === projectId
              ? { ...item, subtasks: [...(item.subtasks || []), res.subtask] }
              : item
          )
        );
        if (selectedWorkItem && selectedWorkItem.iid === issueIid && selectedWorkItem.project_id === projectId) {
          setSelectedWorkItem((prev) =>
            prev ? { ...prev, subtasks: [...(prev.subtasks || []), res.subtask] } : null
          );
        }
        showToast(`Subtask added to #${issueIid}`);
      }
    } catch (err: any) {
      showToast(`Failed adding subtask: ${err.message}`);
    }
  };

  const handleToggleSubTask = async (
    projectId: number,
    issueIid: number,
    subtaskId: number,
    completed: boolean
  ) => {
    setWorkItems((prev) =>
      prev.map((item) =>
        item.iid === issueIid && item.project_id === projectId
          ? {
              ...item,
              subtasks: (item.subtasks || []).map((s) =>
                s.id === subtaskId ? { ...s, completed } : s
              )
            }
          : item
      )
    );
    if (selectedWorkItem && selectedWorkItem.iid === issueIid && selectedWorkItem.project_id === projectId) {
      setSelectedWorkItem((prev) =>
        prev
          ? {
              ...prev,
              subtasks: (prev.subtasks || []).map((s) =>
                s.id === subtaskId ? { ...s, completed } : s
              )
            }
          : null
      );
    }

    try {
      await api.toggleSubTask(projectId, issueIid, subtaskId, completed);
    } catch (err: any) {
      showToast(`Failed toggling subtask: ${err.message}`);
    }
  };

  const handleCreateWorkItem = async (payload: {
    projectId: number;
    title: string;
    description?: string;
    issue_type: WorkItemType;
    labels?: string[];
    weight?: number;
    milestone_id?: number;
  }) => {
    try {
      const res = await api.createWorkItem(payload);
      if (res.success && res.workItem) {
        setWorkItems((prev) => [res.workItem, ...prev]);
        showToast(`Work item #${res.workItem.iid} created successfully`);
      }
    } catch (err: any) {
      showToast(`Failed creating work item: ${err.message}`);
    }
  };

  // Merge Request Actions
  const handleToggleMRDraft = async (iid: number, projectId: number, currentDraft: boolean) => {
    const nextDraft = !currentDraft;
    setMergeRequests((prev) =>
      prev.map((mr) =>
        mr.iid === iid && mr.project_id === projectId
          ? {
              ...mr,
              draft: nextDraft,
              title: nextDraft
                ? `Draft: ${mr.title.replace(/^Draft:\s*/, '')}`
                : mr.title.replace(/^Draft:\s*/, '')
            }
          : mr
      )
    );

    try {
      await api.updateMergeRequest(iid, { projectId, draft: nextDraft });
      showToast(`MR !${iid} marked as ${nextDraft ? 'Draft' : 'Ready for review'}`);
    } catch (err: any) {
      showToast(`Failed updating MR: ${err.message}`);
      loadTabData('merge_requests', selectedProjectId, true);
    }
  };

  const handleApproveMR = async (iid: number, projectId: number) => {
    setMergeRequests((prev) =>
      prev.map((mr) =>
        mr.iid === iid && mr.project_id === projectId ? { ...mr, approved: true } : mr
      )
    );
    try {
      await api.approveMergeRequest(projectId, iid);
      showToast(`MR !${iid} approved`);
    } catch (err: any) {
      showToast(`Failed approving MR: ${err.message}`);
      loadTabData('merge_requests', selectedProjectId, true);
    }
  };

  const handleUnapproveMR = async (iid: number, projectId: number) => {
    setMergeRequests((prev) =>
      prev.map((mr) =>
        mr.iid === iid && mr.project_id === projectId ? { ...mr, approved: false } : mr
      )
    );
    try {
      await api.unapproveMergeRequest(projectId, iid);
      showToast(`MR !${iid} approval removed`);
    } catch (err: any) {
      showToast(`Failed unapproving MR: ${err.message}`);
      loadTabData('merge_requests', selectedProjectId, true);
    }
  };

  const handleMergeMR = async (iid: number, projectId: number, options: {
    shouldRemoveSourceBranch: boolean;
    squash: boolean;
    commitMessage?: string;
    squashCommitMessage?: string;
  }) => {
    try {
      await api.mergeMergeRequest(iid, projectId, options);
      setMergeRequests((prev) =>
        prev.map((mr) =>
          mr.iid === iid && mr.project_id === projectId ? { ...mr, state: 'merged' } : mr
        )
      );
      showToast(`Merge Request !${iid} successfully merged`);
    } catch (err: any) {
      showToast(`Failed merging MR !${iid}: ${err.message}`);
    }
  };

  const handleUpdateMRLabels = async (
    iid: number,
    projectId: number,
    currentLabels: string[],
    label: string,
    isRemove: boolean
  ) => {
    const newLabels = isRemove
      ? currentLabels.filter((l) => l !== label)
      : [...currentLabels, label];

    setMergeRequests((prev) =>
      prev.map((mr) =>
        mr.iid === iid && mr.project_id === projectId ? { ...mr, labels: newLabels } : mr
      )
    );

    try {
      await api.updateMergeRequest(iid, { projectId, labels: newLabels });
      showToast(`Label "${label}" ${isRemove ? 'removed from' : 'assigned to'} MR !${iid}`);
    } catch (err: any) {
      showToast(`Error updating MR labels: ${err.message}`);
      loadTabData('merge_requests', selectedProjectId, true);
    }
  };

  const handleToggleMRState = async (
    iid: number,
    projectId: number,
    currentState: 'opened' | 'closed'
  ) => {
    const nextEvent = currentState === 'opened' ? 'close' : 'reopen';
    setMergeRequests((prev) =>
      prev.map((mr) =>
        mr.iid === iid && mr.project_id === projectId
          ? { ...mr, state: nextEvent === 'close' ? 'closed' : 'opened' }
          : mr
      )
    );

    try {
      await api.updateMergeRequest(iid, { projectId, state_event: nextEvent });
      showToast(`MR !${iid} ${nextEvent === 'close' ? 'closed' : 'reopened'}`);
    } catch (err: any) {
      showToast(`Failed updating MR: ${err.message}`);
      loadTabData('merge_requests', selectedProjectId, true);
    }
  };

  // Pipeline Actions
  const handleRetryPipeline = async (pipelineId: number, projectId: number) => {
    try {
      await api.retryPipeline(pipelineId, projectId);
      setPipelines((prev) =>
        prev.map((p) => (p.id === pipelineId ? { ...p, status: 'running' } : p))
      );
      showToast(`Retrying Pipeline #${pipelineId}...`);
    } catch (err: any) {
      showToast(`Failed retrying pipeline: ${err.message}`);
    }
  };

  const handleCancelPipeline = async (pipelineId: number, projectId: number) => {
    try {
      await api.cancelPipeline(pipelineId, projectId);
      setPipelines((prev) =>
        prev.map((p) => (p.id === pipelineId ? { ...p, status: 'canceled' } : p))
      );
      showToast(`Pipeline #${pipelineId} canceled`);
    } catch (err: any) {
      showToast(`Failed canceling pipeline: ${err.message}`);
    }
  };

  const handlePlayJob = async (jobId: number, projectId: number) => {
    try {
      await api.playJob(jobId, projectId);
      showToast(`Manual Job #${jobId} queued and triggered`);
    } catch (err: any) {
      showToast(`Failed playing job: ${err.message}`);
    }
  };

  // Runner Actions
  const handleToggleRunner = async (runnerId: number, currentPaused: boolean) => {
    const nextPaused = !currentPaused;
    setRunners((prev) =>
      prev.map((r) =>
        r.id === runnerId
          ? {
              ...r,
              paused: nextPaused,
              active: !nextPaused,
              status: nextPaused ? 'paused' : 'online'
            }
          : r
      )
    );

    try {
      await api.toggleRunner(runnerId, nextPaused);
      showToast(`Runner #${runnerId} ${nextPaused ? 'paused' : 'resumed'}`);
    } catch (err: any) {
      showToast(`Failed toggling runner: ${err.message}`);
      loadTabData('runners', selectedProjectId, true);
    }
  };

  const handleRegisterRunner = async (payload: {
    description: string;
    tagList?: string[];
    runUntagged?: boolean;
    locked?: boolean;
    projectId?: number;
  }) => {
    const res = await api.registerRunner(payload);
    if (res.success && res.runner) {
      setRunners((prev) => [res.runner, ...prev]);
      showToast(`Runner registered successfully`);
    }
    return { registrationToken: res.registrationToken, registerCommand: res.registerCommand };
  };

  const handleAssignRunner = async (runnerId: number, projectId: number) => {
    try {
      await api.assignRunner(runnerId, projectId);
      setRunners((prev) =>
        prev.map((r) =>
          r.id === runnerId
            ? { ...r, project_ids: [...(r.project_ids || []), projectId] }
            : r
        )
      );
      showToast(`Runner #${runnerId} assigned to project #${projectId}`);
    } catch (err: any) {
      showToast(`Failed assigning runner: ${err.message}`);
    }
  };

  const handleUnassignRunner = async (runnerId: number, projectId: number) => {
    try {
      await api.unassignRunner(runnerId, projectId);
      setRunners((prev) =>
        prev.map((r) =>
          r.id === runnerId
            ? { ...r, project_ids: (r.project_ids || []).filter((p) => p !== projectId) }
            : r
        )
      );
      showToast(`Runner #${runnerId} unassigned from project #${projectId}`);
    } catch (err: any) {
      showToast(`Failed unassigning runner: ${err.message}`);
    }
  };

  const handleStopRunner = async (runnerId: number) => {
    try {
      await api.stopRunner(runnerId);
      setRunners((prev) => prev.filter((r) => r.id !== runnerId));
      showToast(`Runner #${runnerId} removed`);
    } catch (err: any) {
      showToast(`Failed stopping runner: ${err.message}`);
    }
  };

  // Milestone Creation
  const handleCreateMilestone = async (payload: {
    projectId: number;
    title: string;
    description?: string;
    due_date?: string;
    start_date?: string;
  }) => {
    try {
      const res = await api.createMilestone(payload);
      if (res.success && res.milestone) {
        setMilestones((prev) => [res.milestone, ...prev]);
        showToast(`Milestone "${res.milestone.title}" created`);
      }
    } catch (err: any) {
      showToast(`Failed creating milestone: ${err.message}`);
    }
  };

  // Label Creation
  const handleCreateLabel = async (
    projectId: number,
    name: string,
    color: string,
    description?: string
  ) => {
    try {
      const res = await api.createLabel(projectId, name, color, description);
      if (res.success && res.label) {
        setLabels((prev) => [res.label, ...prev]);
        showToast(`Label "${name}" created`);
      }
    } catch (err: any) {
      showToast(`Failed creating label: ${err.message}`);
    }
  };

  // Filtered by Search Query
  const filteredWorkItems = workItems.filter((i) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      i.title.toLowerCase().includes(q) ||
      i.description?.toLowerCase().includes(q) ||
      String(i.iid).includes(q) ||
      i.labels.some((l) => l.toLowerCase().includes(q))
    );
  });

  const filteredMRs = mergeRequests.filter((m) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      m.title.toLowerCase().includes(q) ||
      m.source_branch.toLowerCase().includes(q) ||
      String(m.iid).includes(q) ||
      m.labels.some((l) => l.toLowerCase().includes(q))
    );
  });

  return (
    <div className="min-h-screen bg-[#09090b] dark:bg-[#09090b] text-zinc-100 flex flex-col font-sans transition-colors">
      {/* 3-zone Top Bar Contract with Theme Switcher & Global Search */}
      <Navbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        status={status}
        onRefresh={() => loadInitialData(true)}
        isSyncing={isSyncing}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenWal={() => setIsWalOpen(true)}
        onOpenSearch={() => setIsSearchOpen(true)}
        workItemsCount={workItems.length}
        mrsCount={mergeRequests.length}
        pipelinesCount={pipelines.length}
        milestonesCount={milestones.length}
        inboxActionCount={inbox?.counts.action ?? 0}
        theme={theme}
        onToggleTheme={toggleTheme}
        settingsSection={settingsSection}
        onSelectSettingsSection={(sec) => {
          setSettingsSection(sec);
          setActiveTab('repo_settings');
        }}
        username={username}
        notificationSlot={
          <NotificationCenter
            state={notifyState}
            onMarkRead={() => notifyApi.markRead().then(loadNotify).catch(() => undefined)}
            onClear={() => notifyApi.clearNotifications().then(loadNotify).catch(() => undefined)}
            onRemoveWatch={(id) => notifyApi.removeWatch(id).then(loadNotify).catch(() => undefined)}
            onOpenSettings={() => {
              setVaultSection('notify');
              setActiveTab('vault');
            }}
            onOpenFailure={handleOpenJobTrace}
          />
        }
        onLogout={async () => {
          await sessionApi.logout().catch(() => undefined);
          onSignedOut();
        }}
      />

      {/* Dynamic Sync Progress Bar */}
      <SyncProgressBar
        isSyncing={isSyncing}
        lastSyncTime={status?.lastSyncTime}
        walEntriesCount={status?.walStats?.walEntriesCount}
      />

      {/* Multi-Project & Search Toolbar */}
      <ProjectSelector
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelectProject={setSelectedProjectId}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpenProjectSettings={(section) => {
          setActiveTab('repo_settings');
          setSettingsSection(section || 'badges');
        }}
      />

      {/* Main Content Workspace View */}
      <WatchContext.Provider value={watchContext}>
      <main className="flex-1 flex overflow-hidden">
        {activeTab === 'inbox' && (
          <InboxView inbox={inbox} projects={projects} loading={inboxLoading} onRefresh={() => loadInbox(true)} />
        )}

        {activeTab === 'dashboard' && (
          <DashboardView
            workItems={filteredWorkItems}
            mergeRequests={filteredMRs}
            pipelines={pipelines}
            runners={runners}
            milestones={milestones}
            projects={projects}
            onNavigateTab={setActiveTab}
            onOpenCreateItem={() => setIsCreateWorkItemOpen(true)}
            onOpenCreateMilestone={() => setActiveTab('milestones')}
            onOpenRegisterRunner={() => setIsRegisterRunnerOpen(true)}
          />
        )}

        {activeTab === 'work_items' && (
          <WorkItemsView
            workItems={filteredWorkItems}
            projects={projects}
            labels={labels}
            milestones={milestones}
            onToggleState={handleToggleWorkItemState}
            onUpdateLabels={handleUpdateItemLabels}
            onSelectWorkItem={setSelectedWorkItem}
            selectedItem={selectedWorkItem}
            onCloseDrawer={() => setSelectedWorkItem(null)}
            onOpenCreateModal={() => setIsCreateWorkItemOpen(true)}
            onAssignMilestone={handleAssignMilestone}
            onAddSubTask={handleAddSubTask}
            onToggleSubTask={handleToggleSubTask}
          />
        )}

        {activeTab === 'merge_requests' && (
          <MergeRequestsView
            mergeRequests={filteredMRs}
            projects={projects}
            labels={labels}
            onToggleDraft={handleToggleMRDraft}
            onMerge={handleMergeMR}
            onUpdateLabels={handleUpdateMRLabels}
            onToggleState={handleToggleMRState}
            onApproveMR={handleApproveMR}
            onUnapproveMR={handleUnapproveMR}
          />
        )}

        {activeTab === 'pipelines' && (
          <PipelinesView
            pipelines={pipelines}
            projects={projects}
            onRetryPipeline={handleRetryPipeline}
            onCancelPipeline={handleCancelPipeline}
            onPlayJob={handlePlayJob}
            onViewJobTrace={handleOpenJobTrace}
            onRunPipeline={() => setIsRunPipelineOpen(true)}
          />
        )}

        {activeTab === 'pipeline_editor' && (
          <PipelineEditorView
            projects={projects}
            selectedProjectId={selectedProjectId}
            onSelectProject={setSelectedProjectId}
          />
        )}

        {activeTab === 'runners' && (
          <RunnersView
            runners={runners}
            projects={projects}
            onToggleRunner={handleToggleRunner}
            onOpenRegisterModal={() => setIsRegisterRunnerOpen(true)}
            onAssignRunner={handleAssignRunner}
            onUnassignRunner={handleUnassignRunner}
            onStopRunner={handleStopRunner}
            onViewJobTrace={handleOpenJobTrace}
          />
        )}

        {activeTab === 'packages' && (
          <PackagesView
            projects={projects}
            selectedProjectId={selectedProjectId}
            onSelectProject={setSelectedProjectId}
          />
        )}

        {activeTab === 'releases_tags' && (
          <ReleasesTagsView
            projects={projects}
            selectedProjectId={selectedProjectId}
            onSelectProject={setSelectedProjectId}
          />
        )}

        {activeTab === 'ci_variables' && (
          <VariablesView
            projects={projects}
            selectedProjectId={selectedProjectId}
            onSelectProject={setSelectedProjectId}
          />
        )}

        {activeTab === 'repo_settings' && (
          <ProjectSettingsView
            projects={projects}
            selectedProjectId={selectedProjectId}
            onSelectProject={setSelectedProjectId}
            initialSection={settingsSection}
            onSectionChange={setSettingsSection}
            onProjectUpdated={(updated) => {
              setProjects(projects.map((p) => (p.id === updated.id ? updated : p)));
              setToastMessage(`Updated repository settings for ${updated.name}`);
              setTimeout(() => setToastMessage(null), 3000);
            }}
          />
        )}

        {activeTab === 'vault' && (
          <VaultView
            projects={projects}
            onProfileChanged={() => loadInitialData(true)}
            onLocked={onSignedOut}
            showToast={showToast}
            initialSection={vaultSection}
          />
        )}

        {activeTab === 'milestones' && (
          <MilestonesView
            milestones={milestones}
            projects={projects}
            selectedProjectId={selectedProjectId}
            onCreateMilestone={handleCreateMilestone}
          />
        )}

        {activeTab === 'labels' && (
          <LabelsView
            labels={labels}
            projects={projects}
            selectedProjectId={selectedProjectId}
            onCreateLabel={handleCreateLabel}
          />
        )}
      </main>
      </WatchContext.Provider>

      {/* Modals */}
      <CreateWorkItemModal
        isOpen={isCreateWorkItemOpen}
        onClose={() => setIsCreateWorkItemOpen(false)}
        projects={projects}
        labels={labels}
        milestones={milestones}
        selectedProjectId={selectedProjectId}
        onCreate={handleCreateWorkItem}
      />

      <RegisterRunnerModal
        isOpen={isRegisterRunnerOpen}
        onClose={() => setIsRegisterRunnerOpen(false)}
        projects={projects}
        selectedProjectId={selectedProjectId}
        onRegister={handleRegisterRunner}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        status={status}
        onStatusUpdated={() => loadInitialData(true)}
      />

      <WalMonitorModal
        isOpen={isWalOpen}
        onClose={() => setIsWalOpen(false)}
        walStats={status?.walStats || null}
        lastSyncTime={status?.lastSyncTime || Date.now()}
      />

      <JobTraceModal
        isOpen={traceModal.isOpen}
        onClose={() => setTraceModal((prev) => ({ ...prev, isOpen: false }))}
        projectId={traceModal.projectId}
        jobId={traceModal.jobId}
        jobName={traceModal.jobName}
        onJobRetried={(newJobId) => {
          setTraceModal((prev) => ({ ...prev, jobId: newJobId }));
          loadNotify();
        }}
      />

      <RunPipelineModal
        isOpen={isRunPipelineOpen}
        onClose={() => setIsRunPipelineOpen(false)}
        projects={projects}
        defaultProjectId={selectedProjectId}
        onStarted={(pipeline, watched) => {
          showToast(`Pipeline #${pipeline.id} started on ${pipeline.ref}${watched ? '. You will be notified when it finishes.' : ''}`);
          loadTabData('pipelines', selectedProjectId, true);
          loadNotify();
        }}
      />

      {/* Global Search & Command Switcher Modal */}
      <GlobalSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onNavigateTab={(tab) => {
          setActiveTab(tab);
          if (tab === 'repo_settings') {
            setSettingsSection('badges');
          }
        }}
        onSelectWorkItem={(item) => {
          setActiveTab('work_items');
          setSelectedWorkItem(item);
        }}
        workItems={workItems}
        mergeRequests={mergeRequests}
        pipelines={pipelines}
        runners={runners}
        projects={projects}
        milestones={milestones}
      />

      {/* Ephemeral Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-zinc-900 border border-zinc-700 text-xs text-white px-4 py-2.5 rounded-lg shadow-2xl flex items-center gap-2 animate-fade-in font-medium">
          <span className="w-2 h-2 rounded-full bg-orange-500" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
