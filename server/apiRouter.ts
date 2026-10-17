import { readFileSync } from 'fs';
import path from 'path';
import express, { Router, Request, Response } from 'express';
import { cacheDb } from './cacheDb.js';
import { GitLabClient } from './gitlabClient.js';
import { redactVariable } from './variables.js';
import { metricsManager } from './metricsManager.js';
import { vault } from './vault.js';
import { getInbox } from './inbox.js';
import { watchManager } from './watch.js';
import { extractFailure, parseRunPipelineInput } from './triage.js';

export const apiRouter = Router();

// Runtime configuration. The GitLab host/token come from the active vault profile;
// with no active profile (or while the vault is locked) the client runs in demo mode.
let autoFetchIntervalSec = 30; // default 30s auto-fetch
let lastSyncTime = Date.now();
let gitlabClient = new GitLabClient();

/** The client for the active profile; other modules (MCP) must not hold on to it across profile changes. */
export const getGitlabClient = () => gitlabClient;

function rebuildClientFromVault() {
  const profile = vault.getActiveProfile();
  gitlabClient = profile ? new GitLabClient(profile.host, profile.token) : new GitLabClient();
}

// SSE connection pool for real-time live push updates
const sseClients = new Set<Response>();

export function broadcastEvent(event: string, payload: any) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch {
      sseClients.delete(client);
    }
  }
}

// Background auto-fetching scheduler
let autoFetchTimer: NodeJS.Timeout | null = null;

async function runAutoFetch() {
  if (!vault.isUnlocked()) return;
  try {
    lastSyncTime = Date.now();
    // Refresh core caches
    const projects = await gitlabClient.getProjects(true);
    // Each refresh is independent: one failing source must not stop the others or the inbox.
    // Milestones are not forced: each one costs an extra issues_statistics call, so their 2 min TTL applies.
    const refreshes = await Promise.allSettled([
      gitlabClient.getMilestones(undefined, false),
      gitlabClient.getWorkItems(undefined, 'all', true),
      gitlabClient.getMergeRequests(undefined, 'all', true),
      gitlabClient.getPipelines(undefined, true)
    ]);
    for (const r of refreshes) if (r.status === 'rejected') console.warn('Auto-fetch refresh failed:', r.reason?.message ?? r.reason);
    try {
      watchManager.onRunners(await gitlabClient.getRunners(true));
    } catch (err: any) {
      console.warn('Auto-fetch runners failed:', err?.message ?? err);
    }
    const inbox = await getInbox(gitlabClient, true);
    broadcastEvent('inbox_updated', { counts: inbox.counts, generatedAt: inbox.generatedAt });
    await watchManager.onInbox(inbox);

    broadcastEvent('sync_completed', {
      timestamp: lastSyncTime,
      projectsCount: projects.length,
      walStats: cacheDb.getStats()
    });
  } catch (err) {
    console.warn('Auto-fetch background error:', err);
  }
}

function restartAutoFetchTimer() {
  if (autoFetchTimer) {
    clearInterval(autoFetchTimer);
    autoFetchTimer = null;
  }
  if (autoFetchIntervalSec > 0 && vault.isUnlocked()) {
    autoFetchTimer = setInterval(runAutoFetch, autoFetchIntervalSec * 1000);
  }
}

// Initialize SQLite cache. Auto-fetch starts only once the vault is unlocked.
const cacheReady = cacheDb.init();

watchManager.attach(() => gitlabClient);
watchManager.on('notification', (n) => broadcastEvent('notification', n));
watchManager.on('watches-changed', () => broadcastEvent('watches_changed', { at: Date.now() }));

vault.on('unlocked', async () => {
  await cacheReady;
  rebuildClientFromVault();
  restartAutoFetchTimer();
  watchManager.start();
  runAutoFetch();
});

vault.on('profile-changed', async () => {
  await cacheReady;
  rebuildClientFromVault();
  // Rule baselines belong to the previous GitLab host; watches are filtered by profile.
  watchManager.start();
  cacheDb.clear();
  const profile = vault.getActiveProfile();
  cacheDb.logWal('AUTH_CHANGE', 'system', 'auth', profile ? `Switched to profile ${profile.name}` : 'Switched to demo mode');
  runAutoFetch();
});

vault.on('locked', () => {
  if (autoFetchTimer) clearInterval(autoFetchTimer);
  autoFetchTimer = null;
  watchManager.reset();
  gitlabClient = new GitLabClient();
});

// 1. Status & Configuration
apiRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    let user = null;
    try {
      user = await gitlabClient.getCurrentUser();
    } catch (e) {
      console.warn('Could not fetch user info:', e);
    }

    const walStats = cacheDb.getStats();
    const metrics = metricsManager.getSummary();
    const profile = vault.getActiveProfile();
    res.json({
      success: true,
      host: gitlabClient.getHost(),
      hasToken: Boolean(profile),
      profileName: profile?.name ?? null,
      isDemo: gitlabClient.isDemo(),
      user,
      autoFetchIntervalSec,
      lastSyncTime,
      walStats,
      metrics
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/auth/verify', async (req: Request, res: Response) => {
  try {
    const { host, token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, error: 'Token is required' });
    }
    const testClient = new GitLabClient(host || 'https://gitlab.com', token);
    const user = await testClient.getCurrentUser();
    res.json({ success: true, user });
  } catch (err: any) {
    res.status(401).json({ success: false, error: err.message });
  }
});

// Saves host+token as a vault profile (updating the profile for the same host if one exists) and activates it.
apiRouter.post('/auth/save', async (req: Request, res: Response) => {
  try {
    const { host, token } = req.body;
    const cleanHost = (host || 'https://gitlab.com').replace(/\/+$/, '');
    const cleanToken = typeof token === 'string' ? token.trim() : '';
    if (!cleanToken) {
      return res.status(400).json({ success: false, error: 'Token is required' });
    }

    const user = await new GitLabClient(cleanHost, cleanToken).getCurrentUser();
    const existing = vault.listProfiles().find((p) => p.host === cleanHost);
    const profile = vault.upsertProfile({ id: existing?.id, name: existing?.name || new URL(cleanHost).host, host: cleanHost, token: cleanToken });
    vault.setActiveProfile(profile.id);

    res.json({ success: true, host: cleanHost, isDemo: false, user });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Deactivates the current profile (demo mode). Stored profiles are kept in the vault.
apiRouter.post('/auth/clear', async (_req: Request, res: Response) => {
  try {
    vault.setActiveProfile(null);
    res.json({ success: true, isDemo: true });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

apiRouter.post('/config/autofetch', (req: Request, res: Response) => {
  const { intervalSec } = req.body;
  autoFetchIntervalSec = Number(intervalSec) || 0;
  restartAutoFetchTimer();
  res.json({ success: true, autoFetchIntervalSec });
});

apiRouter.post('/sync/refresh', async (_req: Request, res: Response) => {
  await runAutoFetch();
  res.json({ success: true, lastSyncTime, walStats: cacheDb.getStats() });
});

// SSE Endpoint for Live Updates
apiRouter.get('/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);
  res.write(`data: ${JSON.stringify({ type: 'connected', time: Date.now() })}\n\n`);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// My work inbox
apiRouter.get('/inbox', async (req: Request, res: Response) => {
  try {
    const inbox = await getInbox(gitlabClient, req.query.force === 'true');
    res.json({ success: true, inbox });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Projects
apiRouter.get('/projects', async (req: Request, res: Response) => {
  try {
    const force = req.query.force === 'true';
    const projects = await gitlabClient.getProjects(force);
    res.json({ success: true, projects });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Milestones
apiRouter.get('/milestones', async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const force = req.query.force === 'true';
    const milestones = await gitlabClient.getMilestones(projectId, force);
    res.json({ success: true, milestones });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/milestones', async (req: Request, res: Response) => {
  try {
    const { projectId, title, description, due_date, start_date } = req.body;
    if (!projectId || !title) {
      return res.status(400).json({ success: false, error: 'projectId and title are required' });
    }
    const milestone = await gitlabClient.createMilestone(Number(projectId), {
      title,
      description,
      due_date,
      start_date
    });
    broadcastEvent('milestone_created', milestone);
    res.json({ success: true, milestone });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Work-Items & Issues
apiRouter.get('/work_items', async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const state = (req.query.state as any) || 'all';
    const force = req.query.force === 'true';
    const items = await gitlabClient.getWorkItems(projectId, state, force);
    res.json({ success: true, workItems: items });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/work_items', async (req: Request, res: Response) => {
  try {
    const { projectId, title, description, issue_type, labels, assignee_ids, weight, milestone_id } = req.body;
    if (!projectId || !title) {
      return res.status(400).json({ success: false, error: 'projectId and title are required' });
    }
    const item = await gitlabClient.createWorkItem(Number(projectId), {
      title,
      description,
      issue_type,
      labels,
      assignee_ids,
      weight,
      milestone_id
    });
    broadcastEvent('work_item_created', item);
    res.json({ success: true, workItem: item });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.patch('/work_items/:iid', async (req: Request, res: Response) => {
  try {
    const issueIid = Number(req.params.iid);
    const { projectId, title, description, state_event, labels, add_labels, remove_labels, milestone_id } = req.body;
    if (!projectId) {
      return res.status(400).json({ success: false, error: 'projectId is required' });
    }
    const updated = await gitlabClient.updateWorkItem(Number(projectId), issueIid, {
      title,
      description,
      state_event,
      labels,
      add_labels,
      remove_labels,
      milestone_id
    });
    broadcastEvent('work_item_updated', updated);
    res.json({ success: true, workItem: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Sub-tasks routes
apiRouter.post('/work_items/:iid/subtasks', async (req: Request, res: Response) => {
  try {
    const issueIid = Number(req.params.iid);
    const { projectId, title } = req.body;
    if (!projectId || !title) {
      return res.status(400).json({ success: false, error: 'projectId and title are required' });
    }
    const subtask = await gitlabClient.addSubTask(Number(projectId), issueIid, title);
    broadcastEvent('work_item_updated', { iid: issueIid, subtask });
    res.json({ success: true, subtask });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.patch('/work_items/:iid/subtasks/:subtaskId', async (req: Request, res: Response) => {
  try {
    const issueIid = Number(req.params.iid);
    const subtaskId = Number(req.params.subtaskId);
    const { projectId, completed } = req.body;
    if (!projectId) {
      return res.status(400).json({ success: false, error: 'projectId is required' });
    }
    const subtasks = await gitlabClient.toggleSubTask(Number(projectId), issueIid, subtaskId, Boolean(completed));
    broadcastEvent('work_item_updated', { iid: issueIid, subtaskId, completed });
    res.json({ success: true, subtasks });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Notes / Comments
apiRouter.get('/work_items/:iid/notes', async (req: Request, res: Response) => {
  try {
    const issueIid = Number(req.params.iid);
    const projectId = Number(req.query.projectId);
    if (!projectId) {
      return res.status(400).json({ success: false, error: 'projectId query param is required' });
    }
    const notes = await gitlabClient.getWorkItemNotes(projectId, issueIid);
    res.json({ success: true, notes });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/work_items/:iid/notes', async (req: Request, res: Response) => {
  try {
    const issueIid = Number(req.params.iid);
    const { projectId, body, attachment } = req.body;
    if (!projectId || !body) {
      return res.status(400).json({ success: false, error: 'projectId and body are required' });
    }
    const note = await gitlabClient.createWorkItemNote(Number(projectId), issueIid, body, attachment);
    broadcastEvent('note_created', { issueIid, note });
    res.json({ success: true, note });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Merge Requests
apiRouter.get('/merge_requests', async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const state = (req.query.state as any) || 'all';
    const force = req.query.force === 'true';
    const mrs = await gitlabClient.getMergeRequests(projectId, state, force);
    res.json({ success: true, mergeRequests: mrs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.patch('/merge_requests/:iid', async (req: Request, res: Response) => {
  try {
    const mrIid = Number(req.params.iid);
    const { projectId, title, description, draft, labels, state_event } = req.body;
    if (!projectId) {
      return res.status(400).json({ success: false, error: 'projectId is required' });
    }
    const updated = await gitlabClient.updateMergeRequest(Number(projectId), mrIid, {
      title,
      description,
      draft,
      labels,
      state_event
    });
    broadcastEvent('merge_request_updated', updated);
    res.json({ success: true, mergeRequest: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/merge_requests/:iid/approve', async (req: Request, res: Response) => {
  try {
    const mrIid = Number(req.params.iid);
    const { projectId } = req.body;
    if (!projectId) {
      return res.status(400).json({ success: false, error: 'projectId is required' });
    }
    const result = await gitlabClient.approveMergeRequest(Number(projectId), mrIid);
    broadcastEvent('merge_request_updated', { mrIid, approved: true });
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/merge_requests/:iid/unapprove', async (req: Request, res: Response) => {
  try {
    const mrIid = Number(req.params.iid);
    const { projectId } = req.body;
    if (!projectId) {
      return res.status(400).json({ success: false, error: 'projectId is required' });
    }
    const result = await gitlabClient.unapproveMergeRequest(Number(projectId), mrIid);
    broadcastEvent('merge_request_updated', { mrIid, approved: false });
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/merge_requests/:iid/merge', async (req: Request, res: Response) => {
  try {
    const mrIid = Number(req.params.iid);
    const { projectId, shouldRemoveSourceBranch, squash, squashCommitMessage, commitMessage } = req.body;
    if (!projectId) {
      return res.status(400).json({ success: false, error: 'projectId is required' });
    }
    const result = await gitlabClient.mergeMergeRequest(Number(projectId), mrIid, {
      shouldRemoveSourceBranch,
      squash,
      squashCommitMessage,
      commitMessage
    });
    broadcastEvent('merge_request_merged', { mrIid, projectId });
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/merge_requests/:iid/notes', async (req: Request, res: Response) => {
  try {
    const mrIid = Number(req.params.iid);
    const projectId = Number(req.query.projectId);
    if (!projectId) {
      return res.status(400).json({ success: false, error: 'projectId query param is required' });
    }
    const notes = await gitlabClient.getMergeRequestNotes(projectId, mrIid);
    res.json({ success: true, notes });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/merge_requests/:iid/notes', async (req: Request, res: Response) => {
  try {
    const mrIid = Number(req.params.iid);
    const { projectId, body, attachment } = req.body;
    if (!projectId || !body) {
      return res.status(400).json({ success: false, error: 'projectId and body are required' });
    }
    const note = await gitlabClient.createMergeRequestNote(Number(projectId), mrIid, body, attachment);
    broadcastEvent('mr_note_created', { mrIid, note });
    res.json({ success: true, note });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Pipelines & Jobs
apiRouter.get('/pipelines', async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const force = req.query.force === 'true';
    const pipelines = await gitlabClient.getPipelines(projectId, force);
    res.json({ success: true, pipelines });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/pipelines/:id/jobs', async (req: Request, res: Response) => {
  try {
    const pipelineId = Number(req.params.id);
    const projectId = Number(req.query.projectId);
    if (!projectId) {
      return res.status(400).json({ success: false, error: 'projectId query param is required' });
    }
    const jobsData = await gitlabClient.getPipelineJobs(projectId, pipelineId);
    res.json({ success: true, ...jobsData });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/pipelines/:id/retry', async (req: Request, res: Response) => {
  try {
    const pipelineId = Number(req.params.id);
    const { projectId } = req.body;
    const result = await gitlabClient.retryPipeline(Number(projectId), pipelineId);
    broadcastEvent('pipeline_updated', { pipelineId, status: 'running' });
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/pipelines/:id/cancel', async (req: Request, res: Response) => {
  try {
    const pipelineId = Number(req.params.id);
    const { projectId } = req.body;
    const result = await gitlabClient.cancelPipeline(Number(projectId), pipelineId);
    broadcastEvent('pipeline_updated', { pipelineId, status: 'canceled' });
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/jobs/:id/play', async (req: Request, res: Response) => {
  try {
    const jobId = Number(req.params.id);
    const { projectId } = req.body;
    const result = await gitlabClient.playJob(Number(projectId), jobId);
    broadcastEvent('job_updated', { jobId, status: 'running' });
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/jobs/:id/retry', async (req: Request, res: Response) => {
  try {
    const jobId = Number(req.params.id);
    const projectId = Number(req.body?.projectId);
    const job = await gitlabClient.retryJob(projectId, jobId);
    broadcastEvent('job_updated', { jobId: job.id, status: job.status });
    const watch =
      req.body?.watch === false
        ? null
        : await watchManager.addWatch({ kind: 'job', project_id: projectId, target_id: job.id, source: 'manual' }).catch(() => null);
    res.json({ success: true, job, watch });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Runners
apiRouter.get('/runners', async (req: Request, res: Response) => {
  try {
    const force = req.query.force === 'true';
    const runners = await gitlabClient.getRunners(force);
    res.json({ success: true, runners });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/runners/:id/toggle', async (req: Request, res: Response) => {
  try {
    const runnerId = Number(req.params.id);
    const { paused } = req.body;
    const result = await gitlabClient.toggleRunner(runnerId, Boolean(paused));
    broadcastEvent('runner_updated', { runnerId, paused: Boolean(paused) });
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/runners/register', async (req: Request, res: Response) => {
  try {
    const { description, tagList, runUntagged, locked, projectId } = req.body;
    if (!description) {
      return res.status(400).json({ success: false, error: 'description is required' });
    }
    const result = await gitlabClient.registerRunner({
      description,
      tagList,
      runUntagged,
      locked,
      projectId: projectId ? Number(projectId) : undefined
    });
    if (!gitlabClient.isDemo() && result.registrationToken) {
      vault.addEntry({
        kind: 'runner',
        name: description,
        value: result.registrationToken,
        meta: { runnerId: result.runner.id, host: gitlabClient.getHost() }
      });
    }
    broadcastEvent('runner_registered', result.runner);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/runners/:id/assign', async (req: Request, res: Response) => {
  try {
    const runnerId = Number(req.params.id);
    const { projectId } = req.body;
    if (!projectId) {
      return res.status(400).json({ success: false, error: 'projectId is required' });
    }
    const result = await gitlabClient.assignRunnerToProject(runnerId, Number(projectId));
    broadcastEvent('runner_updated', { runnerId });
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/runners/:id/unassign', async (req: Request, res: Response) => {
  try {
    const runnerId = Number(req.params.id);
    const { projectId } = req.body;
    if (!projectId) {
      return res.status(400).json({ success: false, error: 'projectId is required' });
    }
    const result = await gitlabClient.unassignRunnerFromProject(runnerId, Number(projectId));
    broadcastEvent('runner_updated', { runnerId });
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.delete('/runners/:id', async (req: Request, res: Response) => {
  try {
    const runnerId = Number(req.params.id);
    const result = await gitlabClient.stopRunner(runnerId);
    broadcastEvent('runner_stopped', { runnerId });
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Labels
apiRouter.get('/labels', async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const force = req.query.force === 'true';
    const labels = await gitlabClient.getLabels(projectId, force);
    res.json({ success: true, labels });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/labels', async (req: Request, res: Response) => {
  try {
    const { projectId, name, color, description } = req.body;
    if (!projectId || !name || !color) {
      return res.status(400).json({ success: false, error: 'projectId, name, and color are required' });
    }
    const label = await gitlabClient.createLabel(Number(projectId), { name, color, description });
    broadcastEvent('label_created', label);
    res.json({ success: true, label });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. API Usage & Cache Metrics
apiRouter.get('/metrics', (_req: Request, res: Response) => {
  try {
    const summary = metricsManager.getSummary();
    res.json({ success: true, metrics: summary });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/metrics/reset', (_req: Request, res: Response) => {
  try {
    metricsManager.reset();
    const updated = metricsManager.getSummary();
    broadcastEvent('metrics_updated', updated);
    res.json({ success: true, metrics: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Packages Endpoints
apiRouter.get('/packages', async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const packageType = req.query.packageType ? String(req.query.packageType) : undefined;
    const force = req.query.force === 'true';
    const packages = await gitlabClient.getPackages(projectId, packageType, force);
    res.json({ success: true, packages });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/projects/:projectId/packages/:packageId', async (req: Request, res: Response) => {
  try {
    const pkg = await gitlabClient.getPackage(Number(req.params.projectId), Number(req.params.packageId));
    if (!pkg) return res.status(404).json({ success: false, error: 'Package not found' });
    res.json({ success: true, package: pkg });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Tags & Releases Endpoints
apiRouter.get('/projects/:projectId/tags', async (req: Request, res: Response) => {
  try {
    const force = req.query.force === 'true';
    const tags = await gitlabClient.getTags(Number(req.params.projectId), force);
    res.json({ success: true, tags });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/projects/:projectId/tags', async (req: Request, res: Response) => {
  try {
    const { tag_name, ref, message } = req.body;
    if (!tag_name || !ref) {
      return res.status(400).json({ success: false, error: 'tag_name and ref are required' });
    }
    const tag = await gitlabClient.createTag(Number(req.params.projectId), { tag_name, ref, message });
    broadcastEvent('tag_created', tag);
    res.json({ success: true, tag });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/projects/:projectId/releases', async (req: Request, res: Response) => {
  try {
    const force = req.query.force === 'true';
    const releases = await gitlabClient.getReleases(Number(req.params.projectId), force);
    res.json({ success: true, releases });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/projects/:projectId/releases', async (req: Request, res: Response) => {
  try {
    const { tag_name, name, description, ref } = req.body;
    if (!tag_name || !name) {
      return res.status(400).json({ success: false, error: 'tag_name and name are required' });
    }
    const release = await gitlabClient.createRelease(Number(req.params.projectId), {
      tag_name,
      name,
      description: description || '',
      ref
    });
    broadcastEvent('release_created', release);
    res.json({ success: true, release });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Attachments for issue/MR descriptions and comments. Raw body; the file name travels in X-Filename.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
apiRouter.post(
  '/projects/:projectId/uploads',
  express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
  async (req: Request, res: Response) => {
    try {
      const filename = decodeURIComponent(String(req.headers['x-filename'] || '')).replace(/[\\/]/g, '_').trim();
      if (!filename) return res.status(400).json({ success: false, error: 'X-Filename header is required' });
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ success: false, error: 'Empty file' });
      const contentType = String(req.headers['content-type'] || 'application/octet-stream');
      const upload = await gitlabClient.uploadFile(Number(req.params.projectId), filename, contentType, req.body);
      res.json({ success: true, ...upload });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

apiRouter.get('/projects/:projectId/release-notes', async (req: Request, res: Response) => {
  try {
    const to = String(req.query.to || '').trim();
    if (!to) return res.status(400).json({ success: false, error: 'to is required (branch, tag or sha)' });
    const notes = await gitlabClient.getReleaseNotes(Number(req.params.projectId), to, req.query.from ? String(req.query.from) : undefined);
    res.json({ success: true, notes });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// TRIAGE: failure excerpts
apiRouter.get('/projects/:projectId/jobs/:jobId/failure', async (req: Request, res: Response) => {
  try {
    const failure = await gitlabClient.getJobFailure(Number(req.params.projectId), Number(req.params.jobId));
    res.json({ success: true, failure });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/projects/:projectId/pipelines/:pipelineId/failures', async (req: Request, res: Response) => {
  try {
    const failures = await gitlabClient.getPipelineFailures(Number(req.params.projectId), Number(req.params.pipelineId));
    res.json({ success: true, failures });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// TRIAGE: run a pipeline for a ref with variables
apiRouter.get('/projects/:projectId/branches', async (req: Request, res: Response) => {
  try {
    const branches = await gitlabClient.getBranches(Number(req.params.projectId), String(req.query.search || ''));
    res.json({ success: true, branches });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/projects/:projectId/pipeline-variables', async (req: Request, res: Response) => {
  try {
    const ref = String(req.query.ref || '');
    if (!ref) return res.status(400).json({ success: false, error: 'ref is required' });
    const variables = await gitlabClient.getDeclaredVariables(Number(req.params.projectId), ref);
    res.json({ success: true, variables });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

async function runPipeline(req: Request, res: Response, projectId: number, source: 'manual' | 'agent') {
  const parsed = parseRunPipelineInput(req.body);
  if ('error' in parsed) return res.status(400).json({ success: false, error: parsed.error });
  try {
    const pipeline = await gitlabClient.createPipeline(projectId, parsed.ref, parsed.variables);
    broadcastEvent('pipeline_updated', { pipelineId: pipeline.id, status: pipeline.status });
    let watch = null;
    if (parsed.watch) {
      watch = await watchManager
        .addWatch({ kind: 'pipeline', project_id: pipeline.project_id, target_id: pipeline.id, source })
        .catch((err) => {
          console.warn('Watch on new pipeline failed:', err.message);
          return null;
        });
    }
    res.json({ success: true, pipeline, watch });
  } catch (err: any) {
    // GitLab answers 400 with the reason for refs it cannot run (missing ref, no jobs, rules exclude all).
    res.status(/\(400\)/.test(err.message) ? 400 : 500).json({ success: false, error: err.message });
  }
}

apiRouter.post('/projects/:projectId/pipelines', (req: Request, res: Response) =>
  runPipeline(req, res, Number(req.params.projectId), 'manual')
);

// Job Trace & Runner Jobs Endpoints
apiRouter.get('/projects/:projectId/jobs/:jobId/trace', async (req: Request, res: Response) => {
  try {
    const trace = await gitlabClient.getJobTrace(Number(req.params.projectId), Number(req.params.jobId));
    // Failed jobs carry the excerpt too, so the log view does not fetch the trace twice.
    const failure = trace.status === 'failed' ? extractFailure(trace.trace, { failureReason: trace.failure_reason }) : null;
    res.json({ success: true, trace, failure });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/runners/:runnerId/jobs', async (req: Request, res: Response) => {
  try {
    // Only fetched when runner details is requested to save API hits!
    const jobs = await gitlabClient.getRunnerJobs(Number(req.params.runnerId));
    res.json({ success: true, jobs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// CI/CD Pipeline Editor & Visualizer Endpoints
apiRouter.get('/projects/:projectId/ci-config', async (req: Request, res: Response) => {
  try {
    const config = await gitlabClient.getCiConfig(Number(req.params.projectId), req.query.ref ? String(req.query.ref) : undefined);
    res.json({ success: true, config });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/projects/:projectId/ci-config', async (req: Request, res: Response) => {
  try {
    const { content, commit_message, branch } = req.body;
    if (!content || !commit_message) {
      return res.status(400).json({ success: false, error: 'content and commit_message are required' });
    }
    const result = await gitlabClient.saveCiConfig(Number(req.params.projectId), { content, commit_message, branch });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/ci-lint', async (req: Request, res: Response) => {
  try {
    const { content, projectId, remote } = req.body;
    if (!content) return res.status(400).json({ success: false, error: 'content is required' });
    // Remote (GitLab) lint only on request: the editor lints locally on every keystroke.
    const result = await gitlabClient.lintCiConfig(content, remote && projectId ? Number(projectId) : undefined);
    res.json({ success: true, lint: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// CI/CD Variables Endpoints
apiRouter.get('/variables', async (req: Request, res: Response) => {
  try {
    const scope = (req.query.scope as any) || 'project';
    const id = req.query.id ? Number(req.query.id) : undefined;
    const variables = (await gitlabClient.getVariables(scope, id)).map(redactVariable);
    res.json({ success: true, variables });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/variables/value', async (req: Request, res: Response) => {
  try {
    const scope = req.query.scope === 'group' ? 'group' : 'project';
    const id = Number(req.query.id);
    const key = String(req.query.key || '');
    if (!id || !key) return res.status(400).json({ success: false, error: 'id and key are required' });
    const environmentScope = String(req.query.environment_scope || '*');
    const variable = await gitlabClient.getVariable(scope, id, key, environmentScope);
    cacheDb.logWal('READ_VARIABLE', `${scope}:${key}`, 'variables', `Revealed ${scope} variable "${key}" (${environmentScope})`);
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, value: variable.value });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/variables', async (req: Request, res: Response) => {
  try {
    const variable = redactVariable(await gitlabClient.saveVariable(req.body));
    broadcastEvent('variable_saved', variable);
    res.json({ success: true, variable });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.delete('/variables', async (req: Request, res: Response) => {
  try {
    const scope = (req.query.scope as any) || 'project';
    const scope_id = Number(req.query.scope_id || req.body.scope_id);
    const key = String(req.query.key || req.body.key);
    await gitlabClient.deleteVariable(scope, scope_id, key);
    broadcastEvent('variable_deleted', { scope, scope_id, key });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Badges Endpoints
apiRouter.get('/badges', async (req: Request, res: Response) => {
  try {
    const kind = (req.query.kind as any) || 'project';
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ success: false, error: 'id is required' });
    const badges = await gitlabClient.getBadges(kind, id);
    res.json({ success: true, badges });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/badges', async (req: Request, res: Response) => {
  try {
    const badge = await gitlabClient.createBadge(req.body);
    broadcastEvent('badge_created', badge);
    res.json({ success: true, badge });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.delete('/badges/:badgeId', async (req: Request, res: Response) => {
  try {
    const kind = (req.query.kind as any) || 'project';
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ success: false, error: 'id is required' });
    const badgeId = Number(req.params.badgeId);
    await gitlabClient.deleteBadge(kind, id, badgeId);
    broadcastEvent('badge_deleted', { badgeId });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/projects/:projectId/badges', async (req: Request, res: Response) => {
  try {
    const projectId = Number(req.params.projectId);
    const badges = await gitlabClient.getBadges('project', projectId);
    res.json({ success: true, badges });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Badges Pipeline Configurator for tags, develop, main
apiRouter.post('/projects/:projectId/badges/pipeline-setup', async (req: Request, res: Response) => {
  try {
    const projectId = Number(req.params.projectId);
    const {
      targets = ['tags', 'develop', 'main'],
      includePipeline = true,
      includeCoverage = true,
      includeRelease = true,
      style = 'flat',
      replaceExisting = true
    } = req.body;

    const projects = await gitlabClient.getProjects();
    const project = projects.find((p) => p.id === projectId);
    if (!project) return res.status(404).json({ success: false, error: `Project ${projectId} not found` });
    // Badge images come from the project's own instance, so self-hosted GitLab works.
    const baseUrl = project.web_url.replace(/\/+$/, '');

    // If replaceExisting, purge current pipeline/coverage/release badges for this project
    if (replaceExisting) {
      const existing = await gitlabClient.getBadges('project', projectId);
      const toRemove = existing.filter((b) =>
        b.name.toLowerCase().includes('pipeline') ||
        b.name.toLowerCase().includes('coverage') ||
        b.name.toLowerCase().includes('release')
      );
      for (const b of toRemove) {
        await gitlabClient.deleteBadge('project', projectId, b.id);
      }
    }

    const createdBadges = [];
    const targetOrder = ['main', 'develop', 'tags'];
    const activeTargets = targetOrder.filter((t) => targets.includes(t));

    for (const target of activeTargets) {
      if (target === 'main') {
        if (includePipeline) {
          const badge = await gitlabClient.createBadge({
            name: 'Pipeline: main',
            link_url: `${baseUrl}/-/commits/main`,
            image_url: `${baseUrl}/badges/main/pipeline.svg?style=${style}`,
            kind: 'project',
            project_id: projectId
          });
          createdBadges.push(badge);
        }
        if (includeCoverage) {
          const badge = await gitlabClient.createBadge({
            name: 'Coverage: main',
            link_url: `${baseUrl}/-/commits/main`,
            image_url: `${baseUrl}/badges/main/coverage.svg?style=${style}`,
            kind: 'project',
            project_id: projectId
          });
          createdBadges.push(badge);
        }
      } else if (target === 'develop') {
        if (includePipeline) {
          const badge = await gitlabClient.createBadge({
            name: 'Pipeline: develop',
            link_url: `${baseUrl}/-/commits/develop`,
            image_url: `${baseUrl}/badges/develop/pipeline.svg?style=${style}`,
            kind: 'project',
            project_id: projectId
          });
          createdBadges.push(badge);
        }
        if (includeCoverage) {
          const badge = await gitlabClient.createBadge({
            name: 'Coverage: develop',
            link_url: `${baseUrl}/-/commits/develop`,
            image_url: `${baseUrl}/badges/develop/coverage.svg?style=${style}`,
            kind: 'project',
            project_id: projectId
          });
          createdBadges.push(badge);
        }
      } else if (target === 'tags') {
        if (includePipeline) {
          const badge = await gitlabClient.createBadge({
            name: 'Pipeline: tags (release)',
            link_url: `${baseUrl}/-/releases`,
            image_url: `${baseUrl}/badges/tags/pipeline.svg?style=${style}`,
            kind: 'project',
            project_id: projectId
          });
          createdBadges.push(badge);
        }
        if (includeRelease) {
          const badge = await gitlabClient.createBadge({
            name: 'Release: latest',
            link_url: `${baseUrl}/-/releases`,
            image_url: `${baseUrl}/-/badges/release.svg`,
            kind: 'project',
            project_id: projectId
          });
          createdBadges.push(badge);
        }
      }
    }

    broadcastEvent('badges_updated', { projectId, badges: createdBadges });
    res.json({ success: true, count: createdBadges.length, badges: createdBadges });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Repository Settings & Avatar Endpoints
apiRouter.put('/projects/:projectId/settings', async (req: Request, res: Response) => {
  try {
    const updated = await gitlabClient.updateProjectSettings(Number(req.params.projectId), req.body);
    broadcastEvent('project_updated', updated);
    res.json({ success: true, project: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/projects/:projectId/avatar', async (req: Request, res: Response) => {
  try {
    const { avatar } = req.body;
    if (!avatar) return res.status(400).json({ success: false, error: 'avatar is required' });
    const result = await gitlabClient.updateProjectAvatar(Number(req.params.projectId), avatar);
    broadcastEvent('project_avatar_updated', { projectId: req.params.projectId, avatar_url: result.avatar_url });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GitLab Pages Endpoints
apiRouter.get('/projects/:projectId/pages', async (req: Request, res: Response) => {
  try {
    const pages = await gitlabClient.getPagesInfo(Number(req.params.projectId));
    res.json({ success: true, pages });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.patch('/projects/:projectId/pages', async (req: Request, res: Response) => {
  try {
    const updated = await gitlabClient.updatePagesSettings(Number(req.params.projectId), req.body);
    broadcastEvent('pages_updated', updated);
    res.json({ success: true, pages: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// AGENT API (Scope: Work Items & Merge Requests)
// Auth: bearer agent token from the vault, or a browser session (see server/session.ts)
// ============================================================================


// Helper to determine active project ID
async function resolveAgentProjectId(requestedId?: any): Promise<number> {
  if (requestedId) return Number(requestedId);
  try {
    const projects = await gitlabClient.getProjects();
    return projects[0]?.id || 901;
  } catch {
    return 901;
  }
}

// 1. Agent Skill & Documentation
apiRouter.get('/agent/skill.md', (_req: Request, res: Response) => {
  // One source of truth: the skill shipped in skills/ (copied into the Docker image).
  try {
    const md = readFileSync(path.resolve(process.cwd(), 'skills/.claude/lazylab-agent/SKILL.md'), 'utf8');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send(md);
  } catch {
    res.status(404).json({ success: false, error: 'skills/.claude/lazylab-agent/SKILL.md not found next to the server' });
  }
});

apiRouter.get('/agent/skill', (_req: Request, res: Response) => {
  res.json({
    success: true,
    skill: 'lazylab-agent-integration',
    version: '1.0.0',
    description: 'Instructions and rules for AI agents creating/updating work items and merge requests with zero slop.',
    rules: [
      'No slop, no corporate jargon, directly to the point.',
      'Professional and well-worded technical descriptions.',
      'Always include What Changed / What is Added.',
      'Include a Features List whenever new features are added.',
      'Work items and merge requests must follow clean, imperative titles.'
    ],
    markdown_url: '/api/agent/skill.md',
    endpoints: {
      inbox: 'GET /api/agent/inbox',
      watches: { list: 'GET /api/agent/watches', create: 'POST /api/agent/watches' },
      pipelines: {
        run: 'POST /api/agent/pipelines',
        failures: 'GET /api/agent/pipelines/:pipelineId/failures',
        job_failure: 'GET /api/agent/jobs/:jobId/failure'
      },
      work_items: {
        list: 'GET /api/agent/work-items',
        get: 'GET /api/agent/work-items/:iid',
        create: 'POST /api/agent/work-items',
        update: 'PUT /api/agent/work-items/:iid'
      },
      merge_requests: {
        list: 'GET /api/agent/merge-requests',
        get: 'GET /api/agent/merge-requests/:iid',
        create: 'POST /api/agent/merge-requests',
        update: 'PUT /api/agent/merge-requests/:iid'
      }
    }
  });
});

apiRouter.get('/agent/docs', (_req: Request, res: Response) => {
  res.json({
    success: true,
    service: 'LazyLab AI Agent API',
    authentication: 'Authorization: Bearer <agent token> (issue tokens in the Vault view)',
    endpoints: [
      {
        method: 'POST',
        path: '/api/agent/pipelines',
        description: 'Run a pipeline for a ref with variables; watches it by default so a notification arrives when it finishes',
        body: {
          ref: 'string (required)',
          projectId: 'number (optional, defaults to primary project)',
          variables: '{ key, value, variable_type?: env_var | file }[] (optional)',
          watch: 'boolean (optional, default true)'
        }
      },
      {
        method: 'GET',
        path: '/api/agent/pipelines/:pipelineId/failures',
        description: 'Failing section of each failed job (allowed failures excluded): error line, exit code, failure reason, retryable',
        queryParams: { projectId: 'number (optional)' }
      },
      {
        method: 'GET',
        path: '/api/agent/jobs/:jobId/failure',
        description: 'Failing section of one job log',
        queryParams: { projectId: 'number (optional)' }
      },
      {
        method: 'GET',
        path: '/api/agent/work-items',
        description: 'List work items (issues)',
        queryParams: { projectId: 'number (optional)', state: 'opened | closed | all (optional)' }
      },
      {
        method: 'POST',
        path: '/api/agent/work-items',
        description: 'Create a new work item with clean description and feature list',
        body: {
          title: 'string (required)',
          description: 'string (optional, Markdown)',
          projectId: 'number (optional, defaults to primary project)',
          labels: 'string[] (optional)',
          assignee_ids: 'number[] (optional)',
          issue_type: 'issue | incident | task (optional)'
        }
      },
      {
        method: 'PUT / PATCH',
        path: '/api/agent/work-items/:iid',
        description: 'Update work item content, description, labels, assignees, or state',
        body: {
          title: 'string (optional)',
          description: 'string (optional, Markdown)',
          projectId: 'number (optional)',
          labels: 'string[] (optional)',
          assignee_ids: 'number[] (optional)',
          state_event: 'close | reopen (optional)'
        }
      },
      {
        method: 'GET',
        path: '/api/agent/merge-requests',
        description: 'List merge requests',
        queryParams: { projectId: 'number (optional)', state: 'opened | closed | merged | all (optional)' }
      },
      {
        method: 'POST',
        path: '/api/agent/merge-requests',
        description: 'Create a new merge request with clear title and summary',
        body: {
          title: 'string (required)',
          description: 'string (optional, Markdown)',
          source_branch: 'string (required)',
          target_branch: 'string (optional, default main)',
          projectId: 'number (optional)',
          labels: 'string[] (optional)',
          assignee_ids: 'number[] (optional)'
        }
      },
      {
        method: 'PUT / PATCH',
        path: '/api/agent/merge-requests/:iid',
        description: 'Update merge request title, description, labels, draft, or state',
        body: {
          title: 'string (optional)',
          description: 'string (optional, Markdown)',
          projectId: 'number (optional)',
          labels: 'string[] (optional)',
          draft: 'boolean (optional)',
          state_event: 'close | reopen (optional)'
        }
      }
    ]
  });
});

// Inbox: what needs the user, across projects
apiRouter.get('/agent/inbox', async (req: Request, res: Response) => {
  try {
    const inbox = await getInbox(gitlabClient, req.query.force === 'true');
    res.json({ success: true, ...inbox });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Watches: agents (and the `lazy` CLI) ask to be told when a pipeline, job or MR finishes
apiRouter.get('/agent/watches', (_req: Request, res: Response) => {
  res.json({ success: true, watches: watchManager.listWatches() });
});

apiRouter.post('/agent/watches', async (req: Request, res: Response) => {
  try {
    const { kind, projectId, targetId } = req.body || {};
    if (!['pipeline', 'job', 'merge_request'].includes(kind)) {
      return res.status(400).json({ success: false, error: 'kind must be pipeline, job or merge_request' });
    }
    if (!Number(projectId) || !Number(targetId)) {
      return res.status(400).json({ success: false, error: 'projectId and targetId are required' });
    }
    const watch = await watchManager.addWatch({ kind, project_id: Number(projectId), target_id: Number(targetId), source: 'agent' });
    res.json({ success: true, watch });
  } catch (err: any) {
    res.status(/not found|404/i.test(err.message) ? 404 : 500).json({ success: false, error: err.message });
  }
});

// Triage and pipelines for agents and the `lazy` CLI
apiRouter.get('/agent/jobs/:jobId/failure', async (req: Request, res: Response) => {
  try {
    const projectId = await resolveAgentProjectId(req.query.projectId);
    const failure = await gitlabClient.getJobFailure(projectId, Number(req.params.jobId));
    res.json({ success: true, failure });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/agent/pipelines/:pipelineId/failures', async (req: Request, res: Response) => {
  try {
    const projectId = await resolveAgentProjectId(req.query.projectId);
    const failures = await gitlabClient.getPipelineFailures(projectId, Number(req.params.pipelineId));
    res.json({ success: true, failures });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/agent/pipelines', async (req: Request, res: Response) => {
  try {
    const projectId = await resolveAgentProjectId(req.body?.projectId);
    return runPipeline(req, res, projectId, 'agent');
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Work Items: List
apiRouter.get('/agent/work-items', async (req: Request, res: Response) => {
  try {
    const projectId = await resolveAgentProjectId(req.query.projectId);
    const state = (req.query.state as any) || 'all';
    const items = await gitlabClient.getWorkItems(projectId, state, true);
    res.json({
      success: true,
      count: items.length,
      projectId,
      workItems: items
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Work Items: Get single
apiRouter.get('/agent/work-items/:iid', async (req: Request, res: Response) => {
  try {
    const issueIid = Number(req.params.iid);
    const projectId = await resolveAgentProjectId(req.query.projectId);
    const item = await gitlabClient.getWorkItem(projectId, issueIid).catch(() => null);
    if (!item) {
      return res.status(404).json({ success: false, error: `Work item #${issueIid} not found` });
    }
    const notes = await gitlabClient.getWorkItemNotes(projectId, issueIid);
    res.json({ success: true, workItem: item, notes });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Work Items: Create
apiRouter.post('/agent/work-items', async (req: Request, res: Response) => {
  try {
    const { title, description, issue_type = 'issue', labels = [], assignee_ids = [], weight, milestone_id } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, error: 'title is required' });
    }
    const projectId = await resolveAgentProjectId(req.body.projectId);
    const item = await gitlabClient.createWorkItem(projectId, {
      title,
      description: description || '',
      issue_type,
      labels,
      assignee_ids,
      weight,
      milestone_id
    });
    broadcastEvent('work_item_created', item);
    res.status(201).json({
      success: true,
      message: `Work item #${item.iid} successfully created by AI Agent`,
      workItem: item
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Work Items: Update
const handleAgentWorkItemUpdate = async (req: Request, res: Response) => {
  try {
    const issueIid = Number(req.params.iid);
    const projectId = await resolveAgentProjectId(req.body.projectId || req.query.projectId);
    const { title, description, state_event, labels, add_labels, remove_labels, assignee_ids, milestone_id } = req.body;

    const updated = await gitlabClient.updateWorkItem(projectId, issueIid, {
      title,
      description,
      state_event,
      labels,
      add_labels,
      remove_labels,
      assignee_ids,
      milestone_id
    });

    broadcastEvent('work_item_updated', updated);
    res.json({
      success: true,
      message: `Work item #${issueIid} successfully updated by AI Agent`,
      workItem: updated
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};

apiRouter.put('/agent/work-items/:iid', handleAgentWorkItemUpdate);
apiRouter.patch('/agent/work-items/:iid', handleAgentWorkItemUpdate);

// 3. Merge Requests: List
apiRouter.get('/agent/merge-requests', async (req: Request, res: Response) => {
  try {
    const projectId = await resolveAgentProjectId(req.query.projectId);
    const state = (req.query.state as any) || 'all';
    const mrs = await gitlabClient.getMergeRequests(projectId, state, true);
    res.json({
      success: true,
      count: mrs.length,
      projectId,
      mergeRequests: mrs
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Merge Requests: Get single
apiRouter.get('/agent/merge-requests/:iid', async (req: Request, res: Response) => {
  try {
    const mrIid = Number(req.params.iid);
    const projectId = await resolveAgentProjectId(req.query.projectId);
    const mr = await gitlabClient.getMergeRequest(projectId, mrIid).catch(() => null);
    if (!mr) {
      return res.status(404).json({ success: false, error: `Merge request !${mrIid} not found` });
    }
    const notes = await gitlabClient.getMergeRequestNotes(projectId, mrIid);
    res.json({ success: true, mergeRequest: mr, notes });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Merge Requests: Create
apiRouter.post('/agent/merge-requests', async (req: Request, res: Response) => {
  try {
    const { title, description, source_branch, target_branch = 'main', labels = [], assignee_ids = [] } = req.body;
    if (!title || !source_branch) {
      return res.status(400).json({ success: false, error: 'title and source_branch are required' });
    }
    const projectId = await resolveAgentProjectId(req.body.projectId);
    const mr = await gitlabClient.createMergeRequest(projectId, {
      title,
      description: description || '',
      source_branch,
      target_branch,
      labels,
      assignee_ids
    });
    broadcastEvent('merge_request_created', mr);
    res.status(201).json({
      success: true,
      message: `Merge request !${mr.iid} successfully created by AI Agent`,
      mergeRequest: mr
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Merge Requests: Update
const handleAgentMergeRequestUpdate = async (req: Request, res: Response) => {
  try {
    const mrIid = Number(req.params.iid);
    const projectId = await resolveAgentProjectId(req.body.projectId || req.query.projectId);
    const { title, description, labels, draft, state_event } = req.body;

    const updated = await gitlabClient.updateMergeRequest(projectId, mrIid, {
      title,
      description,
      labels,
      draft,
      state_event
    });

    broadcastEvent('merge_request_updated', updated);
    res.json({
      success: true,
      message: `Merge request !${mrIid} successfully updated by AI Agent`,
      mergeRequest: updated
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};

apiRouter.put('/agent/merge-requests/:iid', handleAgentMergeRequestUpdate);
apiRouter.patch('/agent/merge-requests/:iid', handleAgentMergeRequestUpdate);


