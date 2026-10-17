/**
 * Login sessions, first-run setup and request guards.
 *
 * - Sessions are in-memory only: a restart (which also locks the vault) logs every device out.
 * - Cookie: HttpOnly, SameSite=Strict, Secure when the request arrived over HTTPS (directly or via a trusted proxy).
 * - Mutating cookie-authenticated requests must carry an Origin whose hostname matches the request host.
 * - /api/agent/* additionally accepts `Authorization: Bearer llab_...` tokens issued from the vault.
 */
import { randomBytes } from 'crypto';
import { NextFunction, Request, Response, Router } from 'express';
import { vault } from './vault.js';

const COOKIE_NAME = 'lazylab_sid';
const IDLE_TTL_MS = 12 * 60 * 60 * 1000;
const ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 12;

interface Session {
  username: string;
  createdAt: number;
  lastSeen: number;
  userAgent: string;
  ip: string;
}

const sessions = new Map<string, Session>();

// ---- first-run setup code ---------------------------------------------------
// Printed to the server log so only someone with console / `docker logs` access can claim the instance.
let setupCode: string | null = null;

export function announceSetupIfNeeded() {
  if (vault.isInitialized()) return;
  setupCode = randomBytes(4).toString('hex').toUpperCase();
  console.log('');
  console.log('  lazylab first-run setup');
  console.log(`  setup code: ${setupCode}`);
  console.log('  Open the UI and enter this code to create the admin account.');
  console.log('');
}

// ---- login throttling -------------------------------------------------------
const failures = new Map<string, { count: number; until: number }>();

function throttleDelayMs(ip: string): number {
  const f = failures.get(ip);
  return f && f.until > Date.now() ? f.until - Date.now() : 0;
}

function recordFailure(ip: string) {
  const f = failures.get(ip) ?? { count: 0, until: 0 };
  f.count += 1;
  // First 4 failures are free; then 2s, 4s, 8s ... capped at 15 minutes.
  if (f.count > 4) f.until = Date.now() + Math.min(2 ** (f.count - 4) * 1000, 15 * 60 * 1000);
  failures.set(ip, f);
}

// ---- cookie helpers ---------------------------------------------------------
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1 && part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function setSessionCookie(req: Request, res: Response, sid: string) {
  const attrs = [`${COOKIE_NAME}=${sid}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${ABSOLUTE_TTL_MS / 1000}`];
  if (req.secure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res: Response) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

function getSession(req: Request): { sid: string; session: Session } | null {
  const sid = readCookie(req, COOKIE_NAME);
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  const now = Date.now();
  if (now - session.lastSeen > IDLE_TTL_MS || now - session.createdAt > ABSOLUTE_TTL_MS || !vault.isUnlocked()) {
    sessions.delete(sid);
    return null;
  }
  session.lastSeen = now;
  return { sid, session };
}

function createSession(req: Request, res: Response, username: string) {
  const sid = randomBytes(32).toString('base64url');
  sessions.set(sid, {
    username,
    createdAt: Date.now(),
    lastSeen: Date.now(),
    userAgent: String(req.headers['user-agent'] || ''),
    ip: req.ip || ''
  });
  setSessionCookie(req, res, sid);
}

export function destroyAllSessions() {
  sessions.clear();
}

vault.on('locked', destroyAllSessions);

// ---- guards -----------------------------------------------------------------
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Extra hostnames the UI is served under, for proxies that rewrite the Host header (comma-separated).
const publicHosts = new Set(
  String(process.env.LAZYLAB_PUBLIC_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
);

function originMatches(req: Request): boolean {
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === req.hostname.toLowerCase() || publicHosts.has(host);
  } catch {
    return false;
  }
}

/** Guards everything mounted under /api except /api/session. */
export function apiGuard(req: Request, res: Response, next: NextFunction) {
  // Agent routes: bearer token or a browser session.
  const auth = req.headers.authorization;
  if (req.path.startsWith('/agent/') && auth?.startsWith('Bearer ')) {
    if (!vault.isUnlocked()) {
      return res.status(423).json({ success: false, error: 'Vault is locked. Log in to lazylab in a browser to unlock it.' });
    }
    if (!vault.verifyAgentToken(auth.slice(7).trim())) {
      return res.status(401).json({ success: false, error: 'Invalid agent token' });
    }
    return next();
  }

  const current = getSession(req);
  if (!current) {
    return res.status(401).json({ success: false, error: 'Not authenticated', locked: !vault.isUnlocked() });
  }
  if (MUTATING.has(req.method) && !originMatches(req)) {
    return res.status(403).json({ success: false, error: 'Cross-origin request rejected' });
  }
  return next();
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
}

// ---- /api/session routes (public) -------------------------------------------
export const sessionRouter = Router();

sessionRouter.use((req, res, next) => {
  if (MUTATING.has(req.method) && !originMatches(req)) {
    return res.status(403).json({ success: false, error: 'Cross-origin request rejected' });
  }
  next();
});

sessionRouter.get('/state', (req, res) => {
  const current = getSession(req);
  res.json({
    success: true,
    setupRequired: !vault.isInitialized(),
    authenticated: Boolean(current),
    vaultUnlocked: vault.isUnlocked(),
    username: current?.session.username ?? null,
    secure: req.secure
  });
});

sessionRouter.post('/setup', async (req, res) => {
  try {
    if (vault.isInitialized()) return res.status(409).json({ success: false, error: 'Already set up' });
    const wait = throttleDelayMs(req.ip || '');
    if (wait > 0) {
      res.setHeader('Retry-After', String(Math.ceil(wait / 1000)));
      return res.status(429).json({ success: false, error: `Too many attempts. Retry in ${Math.ceil(wait / 1000)}s.` });
    }
    const { setupCode: code, username, password, gitlabHost, gitlabToken } = req.body || {};
    if (!setupCode || String(code || '').trim().toUpperCase() !== setupCode) {
      recordFailure(req.ip || '');
      return res.status(403).json({ success: false, error: 'Invalid setup code (see the server log)' });
    }
    if (!username || typeof username !== 'string' || username.trim().length < 3) {
      return res.status(400).json({ success: false, error: 'Username must be at least 3 characters' });
    }
    if (!password || typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ success: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    // Seed a GitLab profile from the form, or import GITLAB_TOKEN from the environment once.
    const seedHost = (gitlabHost || process.env.GITLAB_HOST || 'https://gitlab.com').replace(/\/+$/, '');
    const seedToken = (gitlabToken || process.env.GITLAB_TOKEN || '').trim();
    await vault.initialize(username.trim(), password);
    if (seedToken) {
      const profile = vault.upsertProfile({ name: new URL(seedHost).host, host: seedHost, token: seedToken });
      vault.setActiveProfile(profile.id);
      if (!gitlabToken && process.env.GITLAB_TOKEN) {
        console.warn('Imported GITLAB_TOKEN into the vault. Remove it from .env; it is no longer read.');
      }
    }
    setupCode = null;
    createSession(req, res, username.trim());
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

sessionRouter.post('/login', async (req, res) => {
  const ip = req.ip || '';
  const wait = throttleDelayMs(ip);
  if (wait > 0) {
    res.setHeader('Retry-After', String(Math.ceil(wait / 1000)));
    return res.status(429).json({ success: false, error: `Too many attempts. Retry in ${Math.ceil(wait / 1000)}s.` });
  }
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ success: false, error: 'username and password are required' });
  }
  try {
    const ok = await vault.verifyAndUnlock(username.trim(), password);
    if (!ok) {
      recordFailure(ip);
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }
    failures.delete(ip);
    createSession(req, res, username.trim());
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

sessionRouter.post('/logout', (req, res) => {
  const current = getSession(req);
  if (current) sessions.delete(current.sid);
  clearSessionCookie(res);
  res.json({ success: true });
});

/** Locks the vault: wipes the key from memory, logs out every device, stops GitLab sync. */
sessionRouter.post('/lock', (req, res) => {
  if (!getSession(req)) return res.status(401).json({ success: false, error: 'Not authenticated' });
  vault.lock();
  clearSessionCookie(res);
  res.json({ success: true });
});

sessionRouter.post('/password', async (req, res) => {
  if (!getSession(req)) return res.status(401).json({ success: false, error: 'Not authenticated' });
  const { currentPassword, newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ success: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  try {
    const ok = await vault.changePassword(String(currentPassword || ''), newPassword);
    if (!ok) return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

sessionRouter.get('/devices', (req, res) => {
  const current = getSession(req);
  if (!current) return res.status(401).json({ success: false, error: 'Not authenticated' });
  res.json({
    success: true,
    devices: [...sessions.entries()].map(([sid, s]) => ({
      current: sid === current.sid,
      ip: s.ip,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastSeen: s.lastSeen
    }))
  });
});
