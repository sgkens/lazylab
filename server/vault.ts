/**
 * Encrypted secrets vault.
 *
 * On-disk layout (vault.json, mode 0600):
 *   - kdf:     scrypt parameters + salt used to derive the key-encryption key (KEK) from the login password
 *   - dek:     random 256-bit data-encryption key, wrapped with the KEK (AES-256-GCM)
 *   - payload: all secrets as one JSON document, encrypted with the DEK (AES-256-GCM, fresh IV per write)
 *
 * The DEK only lives in memory between a successful login and lock / process exit.
 */
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'crypto';

const VAULT_VERSION = 1;
const KDF_PARAMS = { N: 2 ** 16, r: 8, p: 1, keyLen: 32 };
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
const AAD_DEK = Buffer.from('lazylab:dek:v1');
const AAD_PAYLOAD = Buffer.from('lazylab:payload:v1');

interface Sealed {
  iv: string;
  tag: string;
  ct: string;
}

interface VaultFile {
  version: number;
  createdAt: string;
  username: string;
  kdf: { name: 'scrypt'; salt: string; N: number; r: number; p: number; keyLen: number };
  dek: Sealed;
  payload: Sealed;
}

export interface GitLabProfile {
  id: string;
  name: string;
  host: string;
  token: string;
  createdAt: string;
  updatedAt: string;
}

export type EntryKind = 'secret' | 'ci' | 'runner';

export interface CiPushTarget {
  scope_type: 'project' | 'group';
  scope_id: number;
  key: string;
  environment_scope: string;
  pushedAt: string;
}

export interface VaultEntry {
  id: string;
  kind: EntryKind;
  name: string;
  value: string;
  note?: string;
  /** runner: { runnerId, host }; ci: { targets: CiPushTarget[] } */
  meta?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface AgentToken {
  id: string;
  name: string;
  prefix: string;
  hash: string;
  /** May read CI variable values and vault secrets (get_env, for `lazy env pull` and `lazy run`). */
  secrets?: boolean;
  createdAt: string;
}

// ---- notifications (server/watch.ts owns the behaviour; the vault only stores it) ----

export type NotifyChannelType = 'ntfy' | 'gotify' | 'webhook';

export interface NotifyChannel {
  id: string;
  type: NotifyChannelType;
  name: string;
  /** ntfy: server base URL; gotify: server base URL; webhook: full POST URL (may embed a secret). */
  url: string;
  /** ntfy topic. */
  topic?: string;
  /** ntfy access token or gotify application token. */
  token?: string;
  /** webhook body shape. */
  format?: 'json' | 'slack' | 'discord';
  /** 'failures' delivers only failure-level notifications. */
  events: 'all' | 'failures';
  enabled: boolean;
  createdAt: string;
}

export interface NotifyRules {
  /** Auto-watch the running pipeline of each of my open MRs. */
  myMrPipelines: boolean;
  /** Notify when a new review request appears. */
  reviewRequests: boolean;
  /** Notify when an MR I review gets new commits. */
  reReview: boolean;
  /** Notify when a runner goes offline. */
  runnerOffline: boolean;
  /** Warn 14, 7, 3 and 1 days before a GitLab token expires, and when it has expired. */
  tokenExpiry: boolean;
}

export interface WatchRecord {
  id: string;
  kind: 'pipeline' | 'job' | 'merge_request';
  project_id: number;
  /** Pipeline id, job id, or MR iid. */
  target_id: number;
  label: string;
  web_url: string;
  source: 'manual' | 'auto' | 'agent';
  /** GitLab profile the ids belong to; null in demo mode. */
  profileId: string | null;
  createdAt: string;
}

export interface NotifySettings {
  channels: NotifyChannel[];
  rules: NotifyRules;
  watches: WatchRecord[];
  /** Token key → last expiry threshold warned about (see server/tokenExpiry.ts). */
  expiryWarned?: Record<string, number>;
}

export const defaultNotifyRules = (): NotifyRules => ({
  myMrPipelines: true,
  reviewRequests: true,
  reReview: true,
  runnerOffline: true,
  tokenExpiry: true
});

interface VaultPayload {
  profiles: GitLabProfile[];
  activeProfileId: string | null;
  entries: VaultEntry[];
  agentTokens: AgentToken[];
  notify: NotifySettings;
}

const emptyPayload = (): VaultPayload => ({
  profiles: [],
  activeProfileId: null,
  entries: [],
  agentTokens: [],
  notify: { channels: [], rules: defaultNotifyRules(), watches: [] }
});

function deriveKey(password: string, salt: Buffer, p = KDF_PARAMS): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, p.keyLen, { N: p.N, r: p.r, p: p.p, maxmem: SCRYPT_MAXMEM }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

function seal(key: Buffer, plaintext: Buffer, aad: Buffer): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

function open(key: Buffer, sealed: Sealed, aad: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(sealed.ct, 'base64')), decipher.final()]);
}

export const hashAgentToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const tokenHint = (value: string) => (value.length <= 8 ? '••••' : `${value.slice(0, 4)}…${value.slice(-4)}`);

export class VaultLockedError extends Error {
  constructor() {
    super('Vault is locked');
  }
}

class Vault extends EventEmitter {
  private filePath = path.resolve(
    process.env.LAZYLAB_DATA_DIR || path.join(process.cwd(), '.data'),
    'vault.json'
  );
  private file: VaultFile | null = null;
  private dek: Buffer | null = null;
  private payload: VaultPayload | null = null;

  constructor() {
    super();
    this.loadFile();
  }

  private loadFile() {
    if (!fs.existsSync(this.filePath)) return;
    const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as VaultFile;
    if (parsed.version !== VAULT_VERSION) {
      throw new Error(`Unsupported vault version ${parsed.version} in ${this.filePath}`);
    }
    this.file = parsed;
  }

  private writeFile() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.file, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
  }

  private persist() {
    if (!this.file || !this.dek || !this.payload) throw new VaultLockedError();
    this.file.payload = seal(this.dek, Buffer.from(JSON.stringify(this.payload)), AAD_PAYLOAD);
    this.writeFile();
  }

  private requireOpen(): VaultPayload {
    if (!this.payload) throw new VaultLockedError();
    return this.payload;
  }

  // ---- lifecycle ----------------------------------------------------------

  isInitialized() {
    return this.file !== null;
  }

  isUnlocked() {
    return this.dek !== null;
  }

  getUsername() {
    return this.file?.username ?? null;
  }

  async initialize(username: string, password: string, seed?: Partial<VaultPayload>) {
    if (this.file) throw new Error('Vault already initialized');
    const salt = randomBytes(16);
    const kek = await deriveKey(password, salt);
    const dek = randomBytes(32);
    this.file = {
      version: VAULT_VERSION,
      createdAt: new Date().toISOString(),
      username,
      kdf: { name: 'scrypt', salt: salt.toString('base64'), ...KDF_PARAMS },
      dek: seal(kek, dek, AAD_DEK),
      payload: { iv: '', tag: '', ct: '' }
    };
    this.dek = dek;
    this.payload = { ...emptyPayload(), ...seed };
    this.persist();
    this.emit('unlocked');
  }

  /** Verifies credentials. Unlocks the vault if it is locked. Returns false on bad credentials. */
  async verifyAndUnlock(username: string, password: string): Promise<boolean> {
    if (!this.file) return false;
    const { salt, N, r, p, keyLen } = this.file.kdf;
    const kek = await deriveKey(password, Buffer.from(salt, 'base64'), { N, r, p, keyLen });
    let dek: Buffer;
    try {
      dek = open(kek, this.file.dek, AAD_DEK);
    } catch {
      return false;
    }
    const userOk =
      username.length === this.file.username.length &&
      timingSafeEqual(Buffer.from(username), Buffer.from(this.file.username));
    if (!userOk) return false;

    if (!this.dek) {
      this.dek = dek;
      this.payload = { ...emptyPayload(), ...JSON.parse(open(dek, this.file.payload, AAD_PAYLOAD).toString('utf-8')) };
      this.emit('unlocked');
    }
    return true;
  }

  async changePassword(current: string, next: string): Promise<boolean> {
    if (!this.file || !this.dek) throw new VaultLockedError();
    if (!(await this.verifyAndUnlock(this.file.username, current))) return false;
    const salt = randomBytes(16);
    const kek = await deriveKey(next, salt);
    this.file.kdf = { name: 'scrypt', salt: salt.toString('base64'), ...KDF_PARAMS };
    this.file.dek = seal(kek, this.dek, AAD_DEK);
    this.writeFile();
    return true;
  }

  lock() {
    if (this.dek) this.dek.fill(0);
    this.dek = null;
    this.payload = null;
    this.emit('locked');
  }

  // ---- GitLab profiles ----------------------------------------------------

  listProfiles() {
    const p = this.requireOpen();
    return p.profiles.map(({ token, ...rest }) => ({ ...rest, tokenHint: tokenHint(token), active: rest.id === p.activeProfileId }));
  }

  getProfile(id: string): GitLabProfile {
    const profile = this.requireOpen().profiles.find((pr) => pr.id === id);
    if (!profile) throw new Error('Profile not found');
    return profile;
  }

  getActiveProfile(): GitLabProfile | null {
    if (!this.payload) return null;
    return this.payload.profiles.find((pr) => pr.id === this.payload!.activeProfileId) ?? null;
  }

  upsertProfile(input: { id?: string; name: string; host: string; token?: string }): GitLabProfile {
    const p = this.requireOpen();
    const now = new Date().toISOString();
    const host = input.host.replace(/\/+$/, '');
    const existing = input.id ? p.profiles.find((pr) => pr.id === input.id) : undefined;
    if (existing) {
      existing.name = input.name;
      existing.host = host;
      if (input.token) existing.token = input.token;
      existing.updatedAt = now;
      this.persist();
      if (existing.id === p.activeProfileId) this.emit('profile-changed');
      return existing;
    }
    if (!input.token) throw new Error('token is required for a new profile');
    const profile: GitLabProfile = { id: randomUUID(), name: input.name, host, token: input.token, createdAt: now, updatedAt: now };
    p.profiles.push(profile);
    this.persist();
    return profile;
  }

  deleteProfile(id: string) {
    const p = this.requireOpen();
    p.profiles = p.profiles.filter((pr) => pr.id !== id);
    if (p.notify) p.notify.watches = p.notify.watches.filter((w) => w.profileId !== id);
    const wasActive = p.activeProfileId === id;
    if (wasActive) p.activeProfileId = null;
    this.persist();
    if (wasActive) this.emit('profile-changed');
  }

  setActiveProfile(id: string | null) {
    const p = this.requireOpen();
    if (id && !p.profiles.some((pr) => pr.id === id)) throw new Error('Profile not found');
    p.activeProfileId = id;
    this.persist();
    this.emit('profile-changed');
  }

  // ---- entries (generic secrets, CI secrets, runner tokens) ---------------

  listEntries(kind?: EntryKind) {
    return this.requireOpen()
      .entries.filter((e) => !kind || e.kind === kind)
      .map(({ value, ...rest }) => ({ ...rest, valueHint: tokenHint(value) }));
  }

  getEntry(id: string): VaultEntry {
    const entry = this.requireOpen().entries.find((e) => e.id === id);
    if (!entry) throw new Error('Entry not found');
    return entry;
  }

  addEntry(input: { kind: EntryKind; name: string; value: string; note?: string; meta?: Record<string, any> }): VaultEntry {
    const p = this.requireOpen();
    const now = new Date().toISOString();
    const entry: VaultEntry = { id: randomUUID(), ...input, createdAt: now, updatedAt: now };
    p.entries.push(entry);
    this.persist();
    return entry;
  }

  updateEntry(id: string, patch: { name?: string; value?: string; note?: string; meta?: Record<string, any> }): VaultEntry {
    const entry = this.getEntry(id);
    if (patch.name !== undefined) entry.name = patch.name;
    if (patch.value !== undefined) entry.value = patch.value;
    if (patch.note !== undefined) entry.note = patch.note;
    if (patch.meta !== undefined) entry.meta = patch.meta;
    entry.updatedAt = new Date().toISOString();
    this.persist();
    return entry;
  }

  /** Entries with their values, for server-side use only (env resolution). Never send these to a browser. */
  entriesWithValues(kinds: EntryKind[]): VaultEntry[] {
    return this.requireOpen().entries.filter((e) => kinds.includes(e.kind));
  }

  deleteEntry(id: string) {
    const p = this.requireOpen();
    p.entries = p.entries.filter((e) => e.id !== id);
    this.persist();
  }

  // ---- notification settings ---------------------------------------------

  /** Read-only view of the notification settings. Callers must not mutate it; use updateNotify. */
  getNotify(): NotifySettings {
    const n = this.requireOpen().notify;
    // Vaults created before notifications existed, or before a rule was added.
    n.rules = { ...defaultNotifyRules(), ...n.rules };
    return n;
  }

  /** Applies `fn` to the notification settings and persists the vault. */
  updateNotify<T>(fn: (settings: NotifySettings) => T): T {
    const result = fn(this.getNotify());
    this.persist();
    return result;
  }

  // ---- agent API tokens ---------------------------------------------------

  listAgentTokens() {
    return this.requireOpen().agentTokens.map(({ hash, ...rest }) => rest);
  }

  /** Returns the plaintext token once; only its SHA-256 is stored. */
  createAgentToken(name: string, opts: { secrets?: boolean } = {}): { token: string; record: Omit<AgentToken, 'hash'> } {
    const p = this.requireOpen();
    const token = `llab_${randomBytes(32).toString('base64url')}`;
    const record: AgentToken = {
      id: randomUUID(),
      name,
      prefix: token.slice(0, 9),
      hash: hashAgentToken(token),
      secrets: Boolean(opts.secrets),
      createdAt: new Date().toISOString()
    };
    p.agentTokens.push(record);
    this.persist();
    const { hash, ...rest } = record;
    return { token, record: rest };
  }

  deleteAgentToken(id: string) {
    const p = this.requireOpen();
    p.agentTokens = p.agentTokens.filter((t) => t.id !== id);
    this.persist();
  }

  verifyAgentToken(token: string): AgentToken | null {
    if (!this.payload) return null;
    const hash = Buffer.from(hashAgentToken(token), 'hex');
    return this.payload.agentTokens.find((t) => timingSafeEqual(Buffer.from(t.hash, 'hex'), hash)) ?? null;
  }
}

export const vault = new Vault();
