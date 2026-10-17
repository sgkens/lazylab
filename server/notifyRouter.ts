/**
 * /api/notify/* — watches, notification history, push channels and rules. Mounted behind apiGuard.
 * Channel tokens and webhook URLs (which often embed a secret) are never returned in full.
 */
import { Request, Response, Router } from 'express';
import { randomUUID } from 'crypto';
import { NotifyChannel, NotifyChannelType, NotifyRules, tokenHint, vault, VaultLockedError, WatchRecord } from './vault.js';
import { watchManager } from './watch.js';

export const notifyRouter = Router();

const CHANNEL_TYPES: NotifyChannelType[] = ['ntfy', 'gotify', 'webhook'];
const WATCH_KINDS: WatchRecord['kind'][] = ['pipeline', 'job', 'merge_request'];

function fail(res: Response, err: any) {
  const status = err instanceof VaultLockedError ? 423 : /not found/i.test(err?.message) ? 404 : 400;
  res.status(status).json({ success: false, error: err?.message || String(err) });
}

function publicChannel(c: NotifyChannel) {
  let urlHint = c.url;
  if (c.type === 'webhook') {
    try {
      urlHint = `${new URL(c.url).origin}/…`;
    } catch {
      urlHint = '…';
    }
  }
  return {
    id: c.id,
    type: c.type,
    name: c.name,
    urlHint,
    topic: c.topic,
    tokenHint: c.token ? tokenHint(c.token) : undefined,
    format: c.format,
    events: c.events,
    enabled: c.enabled,
    createdAt: c.createdAt,
    ...watchManager.getChannelHealth(c.id)
  };
}

function validateChannel(c: Partial<NotifyChannel>) {
  if (!c.type || !CHANNEL_TYPES.includes(c.type)) throw new Error(`type must be one of ${CHANNEL_TYPES.join(', ')}`);
  if (!c.name?.trim()) throw new Error('name is required');
  let url: URL;
  try {
    url = new URL(String(c.url));
  } catch {
    throw new Error('url must be a valid http(s) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('url must be http or https');
  if (c.type === 'ntfy' && !c.topic?.trim()) throw new Error('topic is required for ntfy');
  if (c.type === 'gotify' && !c.token?.trim()) throw new Error('application token is required for gotify');
  if (c.format && !['json', 'slack', 'discord'].includes(c.format)) throw new Error('format must be json, slack or discord');
  if (c.events && !['all', 'failures'].includes(c.events)) throw new Error('events must be all or failures');
}

notifyRouter.get('/state', (_req: Request, res: Response) => {
  try {
    const settings = vault.getNotify();
    const notifications = watchManager.listNotifications();
    res.json({
      success: true,
      rules: settings.rules,
      channels: settings.channels.map(publicChannel),
      watches: watchManager.listWatches(),
      notifications,
      unread: notifications.filter((n) => !n.read).length
    });
  } catch (err) {
    fail(res, err);
  }
});

// ---- watches ----

notifyRouter.post('/watches', async (req: Request, res: Response) => {
  try {
    const { kind, projectId, targetId } = req.body || {};
    if (!WATCH_KINDS.includes(kind)) throw new Error(`kind must be one of ${WATCH_KINDS.join(', ')}`);
    if (!Number(projectId) || !Number(targetId)) throw new Error('projectId and targetId are required');
    const watch = await watchManager.addWatch({ kind, project_id: Number(projectId), target_id: Number(targetId), source: 'manual' });
    res.json({ success: true, watch });
  } catch (err) {
    fail(res, err);
  }
});

notifyRouter.delete('/watches/:id', (req: Request, res: Response) => {
  try {
    watchManager.removeWatch(req.params.id);
    res.json({ success: true });
  } catch (err) {
    fail(res, err);
  }
});

// ---- rules ----

notifyRouter.put('/rules', (req: Request, res: Response) => {
  try {
    const patch = req.body || {};
    const rules = vault.updateNotify((n) => {
      for (const key of Object.keys(n.rules) as (keyof NotifyRules)[]) {
        if (typeof patch[key] === 'boolean') n.rules[key] = patch[key];
      }
      return n.rules;
    });
    res.json({ success: true, rules });
  } catch (err) {
    fail(res, err);
  }
});

// ---- channels ----

notifyRouter.post('/channels', (req: Request, res: Response) => {
  try {
    const b = req.body || {};
    const channel: NotifyChannel = {
      id: randomUUID(),
      type: b.type,
      name: String(b.name || '').trim(),
      url: String(b.url || '').trim(),
      topic: b.topic ? String(b.topic).trim() : undefined,
      token: b.token ? String(b.token).trim() : undefined,
      format: b.type === 'webhook' ? b.format || 'json' : undefined,
      events: b.events || 'all',
      enabled: b.enabled !== false,
      createdAt: new Date().toISOString()
    };
    validateChannel(channel);
    vault.updateNotify((n) => n.channels.push(channel));
    res.json({ success: true, channel: publicChannel(channel) });
  } catch (err) {
    fail(res, err);
  }
});

notifyRouter.put('/channels/:id', (req: Request, res: Response) => {
  try {
    const b = req.body || {};
    const current = vault.getNotify().channels.find((c) => c.id === req.params.id);
    if (!current) throw new Error('Channel not found');
    // Empty token / url in the patch means "keep the stored one".
    const next: NotifyChannel = {
      ...current,
      ...(b.name !== undefined ? { name: String(b.name).trim() } : {}),
      ...(b.url ? { url: String(b.url).trim() } : {}),
      ...(b.topic !== undefined ? { topic: String(b.topic).trim() } : {}),
      ...(b.token ? { token: String(b.token).trim() } : {}),
      ...(b.format !== undefined ? { format: b.format } : {}),
      ...(b.events !== undefined ? { events: b.events } : {}),
      ...(typeof b.enabled === 'boolean' ? { enabled: b.enabled } : {})
    };
    validateChannel(next);
    vault.updateNotify((n) => {
      n.channels = n.channels.map((c) => (c.id === next.id ? next : c));
    });
    res.json({ success: true, channel: publicChannel(next) });
  } catch (err) {
    fail(res, err);
  }
});

notifyRouter.delete('/channels/:id', (req: Request, res: Response) => {
  try {
    vault.updateNotify((n) => {
      n.channels = n.channels.filter((c) => c.id !== req.params.id);
    });
    res.json({ success: true });
  } catch (err) {
    fail(res, err);
  }
});

notifyRouter.post('/channels/:id/test', async (req: Request, res: Response) => {
  try {
    await watchManager.deliverTo(req.params.id, {
      id: randomUUID(),
      title: 'lazylab test notification',
      body: 'If you can read this, the channel works.',
      level: 'info',
      source: 'test',
      createdAt: Date.now(),
      read: false
    });
    res.json({ success: true });
  } catch (err: any) {
    // Delivery errors are the user's channel config, not a server fault.
    res.status(/not found/i.test(err.message) ? 404 : 502).json({ success: false, error: err.message });
  }
});

// ---- notification history ----

notifyRouter.post('/notifications/read', (_req: Request, res: Response) => {
  watchManager.markAllRead();
  res.json({ success: true });
});

notifyRouter.delete('/notifications', (_req: Request, res: Response) => {
  watchManager.clearNotifications();
  res.json({ success: true });
});
