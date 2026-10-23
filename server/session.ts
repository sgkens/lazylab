/**
 * Login sessions, first-run setup and request guards.
 *
 * - Sessions are in-memory only: a restart (which also locks the vault) logs every device out.
 * - Cookie: HttpOnly, SameSite=Strict, Secure when the request arrived over HTTPS (directly or via a trusted proxy).
 * - Mutating cookie-authenticated requests must carry an Origin whose hostname matches the request host.
 * - /api/agent/* additionally accepts `Authorization: Bearer llab_...` tokens issued from the vault.
 */
import { randomBytes, randomUUID } from 'crypto';
import { NextFunction, Request, Response, Router } from 'express';
import { vault } from './vault.js';

const COOKIE_NAME = 'lazylab_sid';
const IDLE_TTL_MS = 12 * 60 * 60 * 1000;
const ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 12;

interface Session {
  /** Public handle for listing and revoking; the cookie value (map key) is never sent back. */
  id: string;
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
/**
 * Failed sign-in counter per client address, with exponential back-off.
 * Bounded: an entry is dropped once its address has been quiet for `resetAfterMs` (its back-off has long ended),
 * and when more than `maxEntries` addresses are tracked the least recently failing ones are evicted.
 */
export class LoginThrottle {
  private failures = new Map<string, { count: number; until: number; last: number }>();
  private lastSweep = 0;

  constructor(
    private readonly opts: { freeAttempts: number; maxDelayMs: number; resetAfterMs: number; maxEntries: number; now?: () => number } = {
      freeAttempts: 4,
      maxDelayMs: 15 * 60 * 1000,
      resetAfterMs: 60 * 60 * 1000,
      maxEntries: 10_000
    }
  ) {}

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  get size() {
    return this.failures.size;
  }

  /** Milliseconds the address must wait before its next attempt; 0 when it may try now. */
  delayMs(ip: string): number {
    const f = this.failures.get(ip);
    if (!f) return 0;
    const now = this.now();
    if (now - f.last > this.opts.resetAfterMs) {
      this.failures.delete(ip);
      return 0;
    }
    return f.until > now ? f.until - now : 0;
  }

  recordFailure(ip: string) {
    const now = this.now();
    const prev = this.failures.get(ip);
    const f = prev && now - prev.last <= this.opts.resetAfterMs ? prev : { count: 0, until: 0, last: now };
    f.count += 1;
    f.last = now;
    // First `freeAttempts` failures are free; then 2s, 4s, 8s ... capped at maxDelayMs.
    if (f.count > this.opts.freeAttempts) {
      f.until = now + Math.min(2 ** Math.min(f.count - this.opts.freeAttempts, 30) * 1000, this.opts.maxDelayMs);
    }
    // Re-insert so Map order stays "least recently failed first" for eviction.
    this.failures.delete(ip);
    this.failures.set(ip, f);
    this.prune(now);
  }

  clear(ip: string) {
    this.failures.delete(ip);
  }

  private prune(now: number) {
    if (this.failures.size > this.opts.maxEntries || now - this.lastSweep > 60_000) {
      this.lastSweep = now;
      for (const [ip, f] of this.failures) {
        if (now - f.last > this.opts.resetAfterMs) this.failures.delete(ip);
      }
    }
    for (const ip of this.failures.keys()) {
      if (this.failures.size <= this.opts.maxEntries) break;
      this.failures.delete(ip);
    }
  }
}

const throttle = new LoginThrottle();

/** Sends 429 with Retry-After and returns true when the address is in back-off. */
function rejectIfThrottled(req: Request, res: Response): boolean {
  const wait = throttle.delayMs(req.ip || '');
  if (wait <= 0) return false;
  res.setHeader('Retry-After', String(Math.ceil(wait / 1000)));
  res.status(429).json({ success: false, error: `Too many attempts. Retry in ${Math.ceil(wait / 1000)}s.` });
  return true;
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

const isExpired = (s: Session, now: number) => now - s.lastSeen > IDLE_TTL_MS || now - s.createdAt > ABSOLUTE_TTL_MS;

/** Drops sessions past their idle or absolute lifetime, so listings show only live devices. */
function pruneSessions(now = Date.now()) {
  for (const [sid, s] of sessions) if (isExpired(s, now)) sessions.delete(sid);
}

function getSession(req: Request): { sid: string; session: Session } | null {
  const sid = readCookie(req, COOKIE_NAME);
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  const now = Date.now();
  if (isExpired(session, now) || !vault.isUnlocked()) {
    sessions.delete(sid);
    return null;
  }
  session.lastSeen = now;
  return { sid, session };
}

function createSession(req: Request, res: Response, username: string) {
  pruneSessions();
  const sid = randomBytes(32).toString('base64url');
  sessions.set(sid, {
    id: randomUUID(),
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

export function originMatches(req: Request): boolean {
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
    const result = vault.authenticateAgentToken(auth.slice(7).trim());
    if (!result.ok) {
      const error = result.reason === 'expired' ? `Agent token expired at ${result.expiresAt}` : 'Invalid agent token';
      return res.status(401).json({ success: false, error });
    }
    // Scope, project allowlist and caps are enforced by the agent routes (server/apiRouter.ts).
    res.locals.agentToken = result.token;
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
  if (process.env.NODE_ENV === 'production') {
    // React sets style attributes; fonts and GitLab avatars/badges are external.
    // Scripts and API connections remain restricted to the app's own origin.
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https: http:",
      "connect-src 'self'",
      "object-src 'none'",
      "frame-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ].join('; '));
  }
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
    if (rejectIfThrottled(req, res)) return;
    const { setupCode: code, username, password, gitlabHost, gitlabToken } = req.body || {};
    if (!setupCode || String(code || '').trim().toUpperCase() !== setupCode) {
      throttle.recordFailure(req.ip || '');
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
  if (rejectIfThrottled(req, res)) return;
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ success: false, error: 'username and password are required' });
  }
  try {
    const ok = await vault.verifyAndUnlock(username.trim(), password);
    if (!ok) {
      throttle.recordFailure(ip);
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }
    throttle.clear(ip);
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
  // A stolen session must not become an unthrottled password oracle.
  if (rejectIfThrottled(req, res)) return;
  const { currentPassword, newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ success: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  try {
    const ok = await vault.changePassword(String(currentPassword || ''), newPassword);
    if (!ok) {
      throttle.recordFailure(req.ip || '');
      return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

sessionRouter.get('/devices', (req, res) => {
  const current = getSession(req);
  if (!current) return res.status(401).json({ success: false, error: 'Not authenticated' });
  pruneSessions();
  res.json({
    success: true,
    devices: [...sessions.entries()].map(([sid, s]) => ({
      id: s.id,
      current: sid === current.sid,
      ip: s.ip,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastSeen: s.lastSeen
    }))
  });
});

/** Signs out one device. Revoking the current device also clears its cookie. */
sessionRouter.delete('/devices/:id', (req, res) => {
  const current = getSession(req);
  if (!current) return res.status(401).json({ success: false, error: 'Not authenticated' });
  const target = [...sessions.entries()].find(([, s]) => s.id === req.params.id);
  if (!target) return res.status(404).json({ success: false, error: 'Device session not found' });
  sessions.delete(target[0]);
  const self = target[0] === current.sid;
  if (self) clearSessionCookie(res);
  res.json({ success: true, self });
});

// Recovery operations share sign-in throttling and the session router's Origin guard.
sessionRouter.get('/recovery', (req, res) => {
  if (!getSession(req)) return res.status(401).json({ success: false, error: 'Not authenticated' });
  res.json({ success: true, ...vault.recoveryStatus() });
});

sessionRouter.post('/recover', async (req, res) => {
  if (rejectIfThrottled(req, res)) return;
  const { recoveryKey, newPassword } = req.body || {};
  if (typeof recoveryKey !== 'string' || typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ success: false, error: 'Recovery key and a new password of at least 12 characters are required' });
  }
  try {
    const username = await vault.resetPasswordWithRecoveryKey(recoveryKey, newPassword);
    throttle.clear(req.ip || '');
    createSession(req, res, username);
    res.json({ success: true });
  } catch (err: any) {
    throttle.recordFailure(req.ip || '');
    res.status(400).json({ success: false, error: err.message });
  }
});

sessionRouter.post(['/recovery', '/recovery/remove', '/backup', '/restore'], async (req, res) => {
  const fresh = req.path === '/restore' && !vault.isInitialized();
  if (!fresh && !getSession(req)) return res.status(401).json({ success: false, error: 'Not authenticated' });
  if (rejectIfThrottled(req, res)) return;
  const body = req.body || {};
  try {
    if (fresh) {
      if (!setupCode || String(body.setupCode || '').trim().toUpperCase() !== setupCode) {
        throttle.recordFailure(req.ip || '');
        return res.status(403).json({ success: false, error: 'Invalid setup code (see the server log)' });
      }
    } else if (!(await vault.verifyAndUnlock(vault.getUsername()!, String(body.currentPassword || '')))) {
      throttle.recordFailure(req.ip || '');
      return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    }
    res.setHeader('Cache-Control', 'no-store');
    if (req.path === '/recovery') {
      const recoveryKey = await vault.createRecoveryKey(body.currentPassword);
      if (!recoveryKey) throw new Error('Current password is incorrect');
      return res.json({ success: true, recoveryKey });
    }
    if (req.path === '/recovery/remove') {
      if (!(await vault.removeRecoveryKey(body.currentPassword))) throw new Error('Current password is incorrect');
      return res.json({ success: true });
    }
    if (req.path === '/backup') {
      const backup = await vault.exportBackup(body.currentPassword);
      if (!backup) throw new Error('Current password is incorrect');
      return res.json({ success: true, backup });
    }
    const restored = await vault.restoreBackup(body.backup, body.credential || {}, { mode: fresh ? 'fresh' : 'replace', replaceNewer: body.replaceNewer === true });
    setupCode = null;
    throttle.clear(req.ip || '');
    createSession(req, res, restored.username);
    res.json({ success: true });
  } catch (err: any) {
    if (err.details) return res.status(409).json({ success: false, error: err.message, conflict: err.details });
    throttle.recordFailure(req.ip || '');
    res.status(400).json({ success: false, error: err.message });
  }
});
