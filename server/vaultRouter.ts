/**
 * /api/vault/* — manage vault contents. Mounted behind apiGuard (session required).
 * Secret values are never included in list responses; use POST /reveal to read one.
 */
import { Request, Response, Router } from 'express';
import { GitLabClient } from './gitlabClient.js';
import { CiPushTarget, EntryKind, vault, VaultLockedError } from './vault.js';

export const vaultRouter = Router();

const KINDS: EntryKind[] = ['secret', 'ci', 'runner'];

function fail(res: Response, err: any) {
  const status = err instanceof VaultLockedError ? 423 : /not found/i.test(err?.message) ? 404 : 400;
  res.status(status).json({ success: false, error: err?.message || String(err) });
}

vaultRouter.get('/summary', (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      profiles: vault.listProfiles(),
      entries: vault.listEntries(),
      agentTokens: vault.listAgentTokens()
    });
  } catch (err) {
    fail(res, err);
  }
});

vaultRouter.post('/reveal', (req: Request, res: Response) => {
  try {
    const { kind, id } = req.body || {};
    const value = kind === 'profile' ? vault.getProfile(String(id)).token : vault.getEntry(String(id)).value;
    res.json({ success: true, value });
  } catch (err) {
    fail(res, err);
  }
});

// ---- GitLab profiles ----------------------------------------------------------

vaultRouter.post('/profiles', async (req: Request, res: Response) => {
  try {
    const { name, host, token, activate = true, verify = true } = req.body || {};
    if (!host || !token) throw new Error('host and token are required');
    if (verify) await new GitLabClient(host, token).getCurrentUser();
    const profile = vault.upsertProfile({ name: name || new URL(host).host, host, token });
    if (activate) vault.setActiveProfile(profile.id);
    res.json({ success: true, profiles: vault.listProfiles() });
  } catch (err) {
    fail(res, err);
  }
});

vaultRouter.put('/profiles/:id', async (req: Request, res: Response) => {
  try {
    const { name, host, token, verify = true } = req.body || {};
    if (!name || !host) throw new Error('name and host are required');
    if (token && verify) await new GitLabClient(host, token).getCurrentUser();
    vault.upsertProfile({ id: req.params.id, name, host, token: token || undefined });
    res.json({ success: true, profiles: vault.listProfiles() });
  } catch (err) {
    fail(res, err);
  }
});

vaultRouter.post('/profiles/:id/activate', (req: Request, res: Response) => {
  try {
    vault.setActiveProfile(req.params.id);
    res.json({ success: true, profiles: vault.listProfiles() });
  } catch (err) {
    fail(res, err);
  }
});

vaultRouter.post('/profiles/deactivate', (_req: Request, res: Response) => {
  try {
    vault.setActiveProfile(null);
    res.json({ success: true, profiles: vault.listProfiles() });
  } catch (err) {
    fail(res, err);
  }
});

vaultRouter.delete('/profiles/:id', (req: Request, res: Response) => {
  try {
    vault.deleteProfile(req.params.id);
    res.json({ success: true, profiles: vault.listProfiles() });
  } catch (err) {
    fail(res, err);
  }
});

// ---- entries: generic secrets, CI secrets, runner tokens ----------------------

vaultRouter.post('/entries', (req: Request, res: Response) => {
  try {
    const { kind, name, value, note, meta } = req.body || {};
    if (!KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}`);
    if (!name || typeof value !== 'string' || !value) throw new Error('name and value are required');
    const entry = vault.addEntry({ kind, name, value, note, meta: kind === 'ci' ? { targets: [] } : meta });
    res.json({ success: true, id: entry.id, entries: vault.listEntries() });
  } catch (err) {
    fail(res, err);
  }
});

vaultRouter.put('/entries/:id', (req: Request, res: Response) => {
  try {
    const { name, value, note } = req.body || {};
    vault.updateEntry(req.params.id, { name, value: value || undefined, note });
    res.json({ success: true, entries: vault.listEntries() });
  } catch (err) {
    fail(res, err);
  }
});

vaultRouter.delete('/entries/:id', (req: Request, res: Response) => {
  try {
    vault.deleteEntry(req.params.id);
    res.json({ success: true, entries: vault.listEntries() });
  } catch (err) {
    fail(res, err);
  }
});

/** Push a CI secret's value to a GitLab project/group variable using the active profile. */
vaultRouter.post('/entries/:id/push', async (req: Request, res: Response) => {
  try {
    const entry = vault.getEntry(req.params.id);
    if (entry.kind !== 'ci') throw new Error('Only CI secrets can be pushed');
    const profile = vault.getActiveProfile();
    if (!profile) throw new Error('No active GitLab profile');

    const {
      scope_type = 'project',
      scope_id,
      key,
      environment_scope = '*',
      masked = true,
      protected: isProtected = false,
      variable_type = 'env_var'
    } = req.body || {};
    if (!['project', 'group'].includes(scope_type)) throw new Error('scope_type must be project or group');
    if (!scope_id || !key) throw new Error('scope_id and key are required');

    const client = new GitLabClient(profile.host, profile.token);
    await client.saveVariable({
      key,
      value: entry.value,
      variable_type,
      protected: Boolean(isProtected),
      masked: Boolean(masked),
      raw: false,
      environment_scope,
      scope_type,
      scope_id: Number(scope_id)
    });

    const target: CiPushTarget = { scope_type, scope_id: Number(scope_id), key, environment_scope, pushedAt: new Date().toISOString() };
    const targets: CiPushTarget[] = (entry.meta?.targets || []).filter(
      (t: CiPushTarget) => !(t.scope_type === target.scope_type && t.scope_id === target.scope_id && t.key === target.key && t.environment_scope === target.environment_scope)
    );
    vault.updateEntry(entry.id, { meta: { ...entry.meta, targets: [...targets, target] } });
    res.json({ success: true, entries: vault.listEntries() });
  } catch (err) {
    fail(res, err);
  }
});

// ---- agent API tokens ---------------------------------------------------------

vaultRouter.post('/agent-tokens', (req: Request, res: Response) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) throw new Error('name is required');
    const { token } = vault.createAgentToken(name, { secrets: req.body?.secrets === true });
    res.json({ success: true, token, agentTokens: vault.listAgentTokens() });
  } catch (err) {
    fail(res, err);
  }
});

vaultRouter.delete('/agent-tokens/:id', (req: Request, res: Response) => {
  try {
    vault.deleteAgentToken(req.params.id);
    res.json({ success: true, agentTokens: vault.listAgentTokens() });
  } catch (err) {
    fail(res, err);
  }
});
