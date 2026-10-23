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
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'crypto';
import { AgentHandoff, HANDOFFS_PER_TASK, HANDOFFS_TOTAL, parseHandoff, sameTask, TaskRef, validateTask } from './handoffs.js';
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, BackupFormatError, formatRecoveryKey, parseBackupFile, parseRecoveryKey } from './vaultKeys.js';
import { AgentPolicy, AgentTokenFields, AgentCiLimitError, checkDefaultProject, isExpired, normalizeAgentToken } from './agentPolicy.js';
import { matchesFilter, Note, NOTE_LIMITS, NoteComment, NoteFilter, NoteMigration, NoteNamespace, parseCommentBody, parseNoteInput } from './notes.js';

const VAULT_VERSION = 1;
const KDF_PARAMS = { N: 2 ** 16, r: 8, p: 1, keyLen: 32 };
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
const AAD_DEK = Buffer.from('lazylab:dek:v1');
const AAD_PAYLOAD = Buffer.from('lazylab:payload:v1');
const AAD_DEK_RECOVERY = Buffer.from('lazylab:dek-recovery:v1');
const HKDF_INFO_RECOVERY = Buffer.from('lazylab:recovery-kek:v1');

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
  /** Stable vault identity; vaults created before backups gain one on their next write. */
  id?: string;
  /** Increases on every write; restore compares it to refuse silently replacing newer data. */
  revision?: number;
  updatedAt?: string;
  /** Second copy of the DEK, wrapped with a key derived from the recovery key (HKDF-SHA256). */
  recovery?: { kdf: 'hkdf-sha256'; salt: string; dek: Sealed; createdAt: string };
}

export interface VaultBackup {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  exportedAt: string;
  vault: VaultFile;
}

/** Credentials that open a backup: its password, or its recovery key plus a new password. */
export interface BackupCredential {
  password?: string;
  recoveryKey?: string;
  newPassword?: string;
}

/** Wrong password or recovery key. */
export class BadCredentialsError extends Error {
  constructor(message = 'The password or recovery key does not open this vault') {
    super(message);
  }
}

/** The backup is older than, or not the same vault as, the running vault. */
export class RestoreConflictError extends Error {
  constructor(
    message: string,
    readonly details: { reason: 'older' | 'different-vault'; current: VaultMeta; backup: VaultMeta }
  ) {
    super(message);
  }
}

export interface VaultMeta {
  id: string | null;
  revision: number;
  updatedAt: string | null;
  username: string;
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

/** Access fields (scope, projects, default project, expiry, secrets) are described in server/agentPolicy.ts. */
export interface AgentToken extends AgentTokenFields {
  id: string;
  name: string;
  prefix: string;
  hash: string;
  createdAt: string;
  /** Last successful authentication; persisted at most once a minute per token. */
  lastUsedAt?: string | null;
  ciUsage?: { day: string; used: number };
}

export type AgentTokenView = Omit<AgentToken, 'hash'> & AgentPolicy & { lastUsedAt: string | null; expired: boolean; legacy: boolean };

export type AgentAuthResult = { ok: true; token: AgentPolicy } | { ok: false; reason: 'invalid' | 'expired'; expiresAt?: string };

const LAST_USED_PERSIST_MS = 60_000;

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
  agentHandoffs: AgentHandoff[];
  notes: Note[];
}

const emptyPayload = (): VaultPayload => ({
  profiles: [],
  activeProfileId: null,
  entries: [],
  agentTokens: [],
  agentHandoffs: [],
  notes: [],
  notify: { channels: [], rules: defaultNotifyRules(), watches: [] }
});

function deriveKey(password: string, salt: Buffer, p = KDF_PARAMS): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, p.keyLen, { N: p.N, r: p.r, p: p.p, maxmem: SCRYPT_MAXMEM }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

const recoveryKek = (key: Buffer, salt: Buffer) => Buffer.from(hkdfSync('sha256', key, salt, HKDF_INFO_RECOVERY, 32));

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

const defaultVaultPath = () => path.resolve(process.env.LAZYLAB_DATA_DIR || path.join(process.cwd(), '.data'), 'vault.json');

/** Exported for tests, which open isolated vault files; the server uses the `vault` singleton. */
export class Vault extends EventEmitter {
  private file: VaultFile | null = null;
  private dek: Buffer | null = null;
  private payload: VaultPayload | null = null;

  constructor(private readonly filePath: string = defaultVaultPath()) {
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
    this.file.id ??= randomUUID();
    this.file.revision = (this.file.revision ?? 0) + 1;
    this.file.updatedAt = new Date().toISOString();
    this.writeVaultFile(this.filePath, this.file);
  }

  /** Atomic write (temp file + rename). The previous file is kept as `.bak` first, on a best-effort basis. */
  private writeVaultFile(target: string, file: VaultFile) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
    if (target === this.filePath && fs.existsSync(target)) {
      try {
        fs.copyFileSync(target, `${target}.bak`);
        fs.chmodSync(`${target}.bak`, 0o600);
      } catch (err: any) {
        console.warn(`Could not keep ${target}.bak: ${err?.message || err}`);
      }
    }
    fs.renameSync(tmp, target);
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
    // Compare byte lengths: timingSafeEqual throws on buffers of different length.
    const given = Buffer.from(username);
    const stored = Buffer.from(this.file.username);
    if (given.length !== stored.length || !timingSafeEqual(given, stored)) return false;

    if (!this.dek) {
      // Decrypt before keeping the key: a tampered payload must leave the vault fully locked.
      const payload = { ...emptyPayload(), ...JSON.parse(open(dek, this.file.payload, AAD_PAYLOAD).toString('utf-8')) };
      this.dek = dek;
      this.payload = payload;
      this.emit('unlocked');
    }
    return true;
  }

  async changePassword(current: string, next: string): Promise<boolean> {
    if (!this.file || !this.dek) throw new VaultLockedError();
    if (!(await this.verifyAndUnlock(this.file.username, current))) return false;
    const salt = randomBytes(16);
    const kek = await deriveKey(next, salt);
    const previous = { kdf: this.file.kdf, dek: this.file.dek };
    this.file.kdf = { name: 'scrypt', salt: salt.toString('base64'), ...KDF_PARAMS };
    this.file.dek = seal(kek, this.dek, AAD_DEK);
    try {
      this.writeFile();
    } catch (err) {
      // The file on disk still holds the old wrapping; keep memory consistent with it.
      Object.assign(this.file, previous);
      throw err;
    }
    return true;
  }

  lock() {
    if (this.dek) this.dek.fill(0);
    this.dek = null;
    this.payload = null;
    this.emit('locked');
  }

  // ---- recovery key and backups (design: docs/src/guide/vault.md#backup-and-recovery) ----

  private static metaOf(file: VaultFile): VaultMeta {
    return { id: file.id ?? null, revision: file.revision ?? 0, updatedAt: file.updatedAt ?? null, username: file.username };
  }

  private static async openWithPassword(file: VaultFile, password: string): Promise<Buffer> {
    const { salt, N, r, p, keyLen } = file.kdf;
    const kek = await deriveKey(password, Buffer.from(salt, 'base64'), { N, r, p, keyLen });
    try {
      return open(kek, file.dek, AAD_DEK);
    } catch {
      throw new BadCredentialsError('The password does not open this vault');
    }
  }

  /** Throws RecoveryKeyFormatError for a mistyped key and BadCredentialsError for a wrong one. */
  private static openWithRecoveryKey(file: VaultFile, keyText: string): Buffer {
    const key = parseRecoveryKey(keyText);
    if (!file.recovery) throw new BadCredentialsError('This vault has no recovery key');
    try {
      return open(recoveryKek(key, Buffer.from(file.recovery.salt, 'base64')), file.recovery.dek, AAD_DEK_RECOVERY);
    } catch {
      throw new BadCredentialsError('The recovery key does not open this vault');
    } finally {
      key.fill(0);
    }
  }

  private static decryptPayload(file: VaultFile, dek: Buffer): VaultPayload {
    try {
      return { ...emptyPayload(), ...JSON.parse(open(dek, file.payload, AAD_PAYLOAD).toString('utf-8')) };
    } catch {
      throw new BackupFormatError('The vault contents are damaged or were modified (integrity check failed)');
    }
  }

  private static async wrapWithPassword(dek: Buffer, password: string): Promise<Pick<VaultFile, 'kdf' | 'dek'>> {
    const salt = randomBytes(16);
    const kek = await deriveKey(password, salt);
    return { kdf: { name: 'scrypt', salt: salt.toString('base64'), ...KDF_PARAMS }, dek: seal(kek, dek, AAD_DEK) };
  }

  private async checkPassword(password: string): Promise<boolean> {
    if (!this.file || !this.dek) throw new VaultLockedError();
    const file = this.file;
    const dek = this.dek;
    let candidate: Buffer;
    try { candidate = await Vault.openWithPassword(file, password); }
    catch (err) { if (err instanceof BadCredentialsError) return false; throw err; }
    candidate.fill(0);
    if (this.file !== file || this.dek !== dek) throw new VaultLockedError();
    return true;
  }

  /** Applies `change` to the vault file and writes it; a failed write restores the previous fields. */
  private writeFileChange(change: Partial<VaultFile>, remove: (keyof VaultFile)[] = []) {
    const file = this.file!;
    const previous = structuredClone(file);
    Object.assign(file, change);
    for (const key of remove) delete file[key];
    try {
      this.writeFile();
    } catch (err) {
      for (const key of Object.keys(file) as (keyof VaultFile)[]) delete file[key];
      Object.assign(file, previous);
      throw err;
    }
  }

  recoveryStatus(): { configured: boolean; createdAt: string | null } {
    return { configured: Boolean(this.file?.recovery), createdAt: this.file?.recovery?.createdAt ?? null };
  }

  /** Creates or replaces the recovery key. Returns its text (shown once), or null for a wrong password. */
  async createRecoveryKey(currentPassword: string): Promise<string | null> {
    if (!(await this.checkPassword(currentPassword))) return null;
    const key = randomBytes(32);
    const salt = randomBytes(16);
    try {
      const dek = seal(recoveryKek(key, salt), this.dek!, AAD_DEK_RECOVERY);
      this.writeFileChange({ recovery: { kdf: 'hkdf-sha256', salt: salt.toString('base64'), dek, createdAt: new Date().toISOString() } });
      return formatRecoveryKey(key);
    } finally {
      key.fill(0);
    }
  }

  /** Deletes the recovery key's copy of the data key. Returns false for a wrong password. */
  async removeRecoveryKey(currentPassword: string): Promise<boolean> {
    if (!(await this.checkPassword(currentPassword))) return false;
    if (this.file!.recovery) this.writeFileChange({}, ['recovery']);
    return true;
  }

  /**
   * Replaces the password using the recovery key and unlocks the vault. Returns the username.
   * The recovery key stays valid.
   */
  async resetPasswordWithRecoveryKey(recoveryKey: string, newPassword: string): Promise<string> {
    if (!this.file) throw new Error('Vault is not set up');
    if (typeof newPassword !== 'string' || newPassword.length < 12) throw new Error('Password must be at least 12 characters');
    const file = this.file;
    const revision = file.revision;
    const dek = Vault.openWithRecoveryKey(file, recoveryKey);
    // Prove the payload opens before changing anything.
    const payload = Vault.decryptPayload(file, dek);
    const wrapped = await Vault.wrapWithPassword(dek, newPassword);
    if (this.file !== file || file.revision !== revision) throw new Error('The vault changed during the reset; try again');
    this.writeFileChange(wrapped);
    this.lock();
    this.dek = dek;
    this.payload = payload;
    this.emit('unlocked');
    return file.username;
  }

  /** The vault file as stored on disk, wrapped as a backup. Returns null for a wrong password. */
  async exportBackup(currentPassword: string): Promise<VaultBackup | null> {
    if (!(await this.checkPassword(currentPassword))) return null;
    // Vaults from before backups get their identity written first, so every backup of them carries the same id.
    if (!this.file!.id) this.writeFile();
    const onDisk = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as VaultFile;
    // Check the copy before handing it out: same identity and opens with the key in memory.
    if (onDisk.id !== this.file!.id) throw new Error('The vault file on disk does not match the open vault');
    Vault.decryptPayload(onDisk, this.dek!);
    return { format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, exportedAt: new Date().toISOString(), vault: onDisk };
  }

  /**
   * Restores a backup (or a bare vault.json) after proving that the credential opens it.
   * - mode 'fresh': only when no vault exists (first-run setup).
   * - mode 'replace': over the open vault. Refuses an older backup or a different vault unless `replaceNewer`;
   *   the replaced file is kept as vault.json.pre-restore-<time>. The vault is locked (every session ends) and
   *   reopened with the backup's data key.
   * With a recovery key, `newPassword` becomes the restored vault's password.
   */
  async restoreBackup(
    input: unknown,
    cred: BackupCredential,
    opts: { mode: 'fresh' | 'replace'; replaceNewer?: boolean }
  ): Promise<{ username: string; meta: VaultMeta }> {
    const backup = structuredClone(parseBackupFile<VaultFile>(input, VAULT_VERSION));
    const startingFile = this.file;
    const startingRevision = this.file?.revision;
    const assertMode = () => {
      if (opts.mode === 'fresh' && this.file) throw new Error('Vault already initialized');
      if (opts.mode === 'replace' && (!this.file || !this.dek)) throw new VaultLockedError();
    };
    assertMode();

    let dek: Buffer;
    let wrapped: Pick<VaultFile, 'kdf' | 'dek'> | null = null;
    if (typeof cred.recoveryKey === 'string' && cred.recoveryKey.trim()) {
      if (typeof cred.newPassword !== 'string' || cred.newPassword.length < 12) throw new Error('A new password is required with a recovery key');
      dek = Vault.openWithRecoveryKey(backup, cred.recoveryKey);
      Vault.decryptPayload(backup, dek);
      wrapped = await Vault.wrapWithPassword(dek, cred.newPassword);
    } else if (typeof cred.password === 'string' && cred.password) {
      dek = await Vault.openWithPassword(backup, cred.password);
    } else {
      throw new BadCredentialsError('The backup password or recovery key is required');
    }
    const payload = Vault.decryptPayload(backup, dek);

    // Synchronous from here on, so no other vault write can interleave.
    assertMode();
    if (this.file !== startingFile || this.file?.revision !== startingRevision) throw new Error('The vault changed during restore; try again');
    const previous = this.file;
    if (previous && !opts.replaceNewer) {
      const current = Vault.metaOf(previous);
      const incoming = Vault.metaOf(backup);
      if (!current.id || current.id !== incoming.id) {
        throw new RestoreConflictError('The backup is from a different vault (or one too old to tell). Confirm to replace the running vault.', {
          reason: 'different-vault', current, backup: incoming
        });
      }
      if (incoming.revision < current.revision) {
        throw new RestoreConflictError(`The backup (revision ${incoming.revision}) is older than the running vault (revision ${current.revision}). Confirm to replace it.`, {
          reason: 'older', current, backup: incoming
        });
      }
    }

    if (previous) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const keep = `${this.filePath}.pre-restore-${stamp}`;
      if (fs.existsSync(this.filePath)) fs.copyFileSync(this.filePath, keep);
      else fs.writeFileSync(keep, JSON.stringify(previous, null, 2));
      fs.chmodSync(keep, 0o600);
    }

    const next: VaultFile = {
      ...structuredClone(backup),
      ...(wrapped ?? {}),
      id: backup.id ?? randomUUID(),
      // writeFile adds one, so the restored vault counts as newer than both.
      revision: Math.max(backup.revision ?? 0, previous?.revision ?? 0)
    };
    this.file = next;
    try {
      this.writeFile();
    } catch (err) {
      this.file = previous;
      throw err;
    }
    if (this.dek) this.lock();
    this.dek = dek;
    this.payload = payload;
    this.emit('unlocked');
    if (previous) this.emit('profile-changed');
    return { username: next.username, meta: Vault.metaOf(next) };
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
      if (existing.host !== host) p.agentHandoffs = p.agentHandoffs.filter((h) => h.profile_id !== existing.id);
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
    p.agentHandoffs = p.agentHandoffs.filter((h) => h.profile_id !== id);
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

  // ---- persistent agent handoffs -----------------------------------------

  getAgentHandoffs(profileId: string | null, task: TaskRef, limit = 5): AgentHandoff[] {
    validateTask(task);
    if (!Number.isInteger(limit) || limit < 1 || limit > HANDOFFS_PER_TASK) throw new Error('limit must be between 1 and 20');
    return structuredClone(this.requireOpen().agentHandoffs
      .filter((h) => h.profile_id === profileId && sameTask(h, task)).slice(-limit).reverse());
  }

  saveAgentHandoff(profileId: string | null, task: TaskRef, input: unknown, author: AgentHandoff['author']): AgentHandoff {
    const p = this.requireOpen();
    if (profileId !== null && !p.profiles.some((pr) => pr.id === profileId)) throw new Error('GitLab profile no longer exists');
    validateTask(task);
    const content = parseHandoff(input);
    const record: AgentHandoff = {
      ...content, project_id: task.project_id, kind: task.kind, iid: task.iid,
      id: randomUUID(), profile_id: profileId, created_at: new Date().toISOString(), author: { ...author }
    };
    const history = p.agentHandoffs.filter((h) => h.profile_id === profileId && sameTask(h, task));
    const expired = new Set(history.slice(0, Math.max(0, history.length - HANDOFFS_PER_TASK + 1)).map((h) => h.id));
    const previous = p.agentHandoffs;
    p.agentHandoffs = [...previous.filter((h) => !expired.has(h.id)), record].slice(-HANDOFFS_TOTAL);
    try {
      this.persist();
    } catch (err) {
      p.agentHandoffs = previous;
      throw err;
    }
    return structuredClone(record);
  }

  // ---- personal notes and tasks (profile-independent; see server/notes.ts) ----

  /** Vaults created before notes existed have no `notes` array; it is added on first use and persisted on first write. */
  private notesOf(p: VaultPayload): Note[] {
    if (!Array.isArray(p.notes)) p.notes = [];
    return p.notes;
  }

  private findNote(ns: NoteNamespace, id: string): Note {
    const note = this.notesOf(this.requireOpen()).find((n) => n.namespace === ns && n.id === id);
    if (!note) throw new Error('Note not found');
    return note;
  }

  /** Applies `fn` to the notes and persists; a failed write restores the previous in-memory notes. */
  private mutateNotes<T>(ns: NoteNamespace, fn: (notes: Note[]) => T): T {
    const p = this.requireOpen();
    const previous = structuredClone(this.notesOf(p));
    try {
      const result = fn(p.notes);
      const own = p.notes.filter((n) => n.namespace === ns);
      if (own.length > NOTE_LIMITS.notes) throw new Error(`at most ${NOTE_LIMITS.notes} notes are kept; delete or export some first`);
      if (JSON.stringify(own).length > NOTE_LIMITS.totalChars) throw new Error('notes storage is full; delete or export some first');
      this.persist();
      return structuredClone(result);
    } catch (err) {
      p.notes = previous;
      throw err;
    }
  }

  listNotes(ns: NoteNamespace, filter: NoteFilter = {}): Note[] {
    return structuredClone(this.notesOf(this.requireOpen())
      .filter((n) => n.namespace === ns && matchesFilter(n, filter))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
  }

  getNote(ns: NoteNamespace, id: string): Note {
    return structuredClone(this.findNote(ns, id));
  }

  createNote(ns: NoteNamespace, input: unknown): Note {
    const content = parseNoteInput(input, false);
    const now = new Date().toISOString();
    const note: Note = {
      id: randomUUID(), namespace: ns, kind: content.kind ?? 'note', title: content.title!, body: content.body ?? '',
      status: content.status ?? 'open', tags: content.tags ?? [], project: content.project ?? null, migrated: null,
      comments: [], created_at: now, updated_at: now
    };
    return this.mutateNotes(ns, (notes) => (notes.push(note), note));
  }

  updateNote(ns: NoteNamespace, id: string, input: unknown): Note {
    const patch = parseNoteInput(input, true);
    this.findNote(ns, id);
    return this.mutateNotes(ns, () => {
      const note = this.findNote(ns, id);
      if (note.status === 'migrated' && patch.status) throw new Error('a migrated note keeps its status; GitLab is the source of truth');
      Object.assign(note, patch, { updated_at: new Date().toISOString() });
      return note;
    });
  }

  deleteNote(ns: NoteNamespace, id: string) {
    this.findNote(ns, id);
    this.mutateNotes(ns, () => {
      const p = this.requireOpen();
      p.notes = p.notes.filter((n) => !(n.namespace === ns && n.id === id));
    });
  }

  addNoteComment(ns: NoteNamespace, id: string, input: unknown): Note {
    const text = parseCommentBody(input);
    this.findNote(ns, id);
    return this.mutateNotes(ns, () => {
      const note = this.findNote(ns, id);
      if (note.comments.length >= NOTE_LIMITS.comments) throw new Error(`a note keeps at most ${NOTE_LIMITS.comments} comments`);
      const now = new Date().toISOString();
      const comment: NoteComment = { id: randomUUID(), body: text, created_at: now, updated_at: now };
      note.comments.push(comment);
      note.updated_at = now;
      return note;
    });
  }

  updateNoteComment(ns: NoteNamespace, id: string, commentId: string, input: unknown): Note {
    const text = parseCommentBody(input);
    this.findNote(ns, id);
    return this.mutateNotes(ns, () => {
      const note = this.findNote(ns, id);
      const comment = note.comments.find((c) => c.id === commentId);
      if (!comment) throw new Error('Comment not found');
      comment.body = text;
      comment.updated_at = note.updated_at = new Date().toISOString();
      return note;
    });
  }

  deleteNoteComment(ns: NoteNamespace, id: string, commentId: string): Note {
    this.findNote(ns, id);
    return this.mutateNotes(ns, () => {
      const note = this.findNote(ns, id);
      if (!note.comments.some((c) => c.id === commentId)) throw new Error('Comment not found');
      note.comments = note.comments.filter((c) => c.id !== commentId);
      note.updated_at = new Date().toISOString();
      return note;
    });
  }

  /** Called after the GitLab issue exists; the server sets the link, never the client. */
  markNoteMigrated(ns: NoteNamespace, id: string, link: Omit<NoteMigration, 'migrated_at'>): Note {
    this.findNote(ns, id);
    return this.mutateNotes(ns, () => {
      const note = this.findNote(ns, id);
      const now = new Date().toISOString();
      note.status = 'migrated';
      note.migrated = { project_id: link.project_id, iid: link.iid, web_url: link.web_url, migrated_at: now };
      note.updated_at = now;
      return note;
    });
  }

  // ---- agent API tokens ---------------------------------------------------

  private lastUsedPersisted = new Map<string, number>();

  private viewAgentToken(t: AgentToken): AgentTokenView {
    const { hash, ...rest } = t;
    const policy = normalizeAgentToken(t);
    return { ...rest, ...policy, lastUsedAt: t.lastUsedAt ?? null, expired: isExpired(policy.expiresAt), legacy: t.scope === undefined };
  }

  listAgentTokens(): AgentTokenView[] {
    return this.requireOpen().agentTokens.map((t) => this.viewAgentToken(t));
  }

  /** Returns the plaintext token once; only its SHA-256 is stored. `settings` comes from parseAgentTokenSettings. */
  createAgentToken(name: string, settings: AgentTokenFields = {}): { token: string; record: AgentTokenView } {
    const p = this.requireOpen();
    const token = `llab_${randomBytes(32).toString('base64url')}`;
    const record: AgentToken = {
      id: randomUUID(),
      name,
      prefix: token.slice(0, 9),
      hash: hashAgentToken(token),
      scope: settings.scope ?? 'read',
      dailyCiLimit: settings.dailyCiLimit === undefined ? 50 : settings.dailyCiLimit,
      tools: settings.tools ? [...settings.tools] : null,
      secrets: Boolean(settings.secrets),
      projects: settings.projects ?? null,
      defaultProjectId: settings.defaultProjectId ?? null,
      expiresAt: settings.expiresAt ?? null,
      lastUsedAt: null,
      createdAt: new Date().toISOString()
    };
    checkDefaultProject(record);
    p.agentTokens.push(record);
    this.persist();
    return { token, record: this.viewAgentToken(record) };
  }

  /** Changes a token's access. A legacy token edited here gets explicit fields and stops being legacy. */
  updateAgentToken(id: string, settings: AgentTokenFields): AgentTokenView {
    const p = this.requireOpen();
    const t = p.agentTokens.find((x) => x.id === id);
    if (!t) throw new Error('Agent token not found');
    const current = normalizeAgentToken(t);
    const next: AgentToken = {
      ...t,
      scope: settings.scope ?? current.scope,
      dailyCiLimit: settings.dailyCiLimit !== undefined ? settings.dailyCiLimit : current.dailyCiLimit,
      tools: settings.tools !== undefined ? (settings.tools === null ? null : [...settings.tools]) : current.tools,
      secrets: settings.secrets ?? current.secrets,
      projects: settings.projects !== undefined ? settings.projects : current.projects,
      defaultProjectId: settings.defaultProjectId !== undefined ? settings.defaultProjectId : current.defaultProjectId,
      expiresAt: settings.expiresAt !== undefined ? settings.expiresAt : current.expiresAt
    };
    checkDefaultProject(next);
    const index = p.agentTokens.indexOf(t);
    p.agentTokens[index] = next;
    try {
      this.persist();
    } catch (err) {
      p.agentTokens[index] = t;
      throw err;
    }
    return this.viewAgentToken(next);
  }

  /** Reserve and persist one CI attempt before contacting GitLab. Failed attempts are not refunded.
   * Synchronous persistence makes concurrent requests share one counter, including after restart.
   */
  consumeAgentCi(id: string, now = Date.now()): void {
    const t = this.requireOpen().agentTokens.find((item) => item.id === id);
    if (!t || isExpired(t.expiresAt) || normalizeAgentToken(t).scope !== 'write') throw new Error('Agent token cannot run CI');
    const limit = normalizeAgentToken(t).dailyCiLimit;
    if (limit === null) return;
    const day = new Date(now).toISOString().slice(0, 10);
    const used = t.ciUsage?.day === day ? t.ciUsage.used : 0;
    const resetAt = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString();
    if (used >= limit) throw new AgentCiLimitError(limit, resetAt);
    const previous = t.ciUsage;
    t.ciUsage = { day, used: used + 1 };
    try {
      this.persist();
    } catch (err) {
      t.ciUsage = previous;
      throw err;
    }
  }

  deleteAgentToken(id: string) {
    const p = this.requireOpen();
    p.agentTokens = p.agentTokens.filter((t) => t.id !== id);
    this.lastUsedPersisted.delete(id);
    this.persist();
  }

  private findAgentToken(token: string): AgentToken | null {
    if (!this.payload) return null;
    const hash = Buffer.from(hashAgentToken(token), 'hex');
    return this.payload.agentTokens.find((t) => timingSafeEqual(Buffer.from(t.hash, 'hex'), hash)) ?? null;
  }

  /** The stored record of a valid, unexpired token, or null. Does not record use; see authenticateAgentToken. */
  verifyAgentToken(token: string): AgentToken | null {
    const t = this.findAgentToken(token);
    return t && !isExpired(t.expiresAt) ? t : null;
  }

  /** Checks a bearer token, records its use, and returns its effective policy. */
  authenticateAgentToken(token: string): AgentAuthResult {
    const t = this.findAgentToken(token);
    if (!t) return { ok: false, reason: 'invalid' };
    if (isExpired(t.expiresAt)) return { ok: false, reason: 'expired', expiresAt: t.expiresAt ?? undefined };
    const now = Date.now();
    t.lastUsedAt = new Date(now).toISOString();
    // Every MCP call authenticates; rewriting the vault file each time is not worth a precise timestamp.
    if (now - (this.lastUsedPersisted.get(t.id) ?? 0) >= LAST_USED_PERSIST_MS) {
      this.lastUsedPersisted.set(t.id, now);
      try {
        this.persist();
      } catch (err: any) {
        console.warn('Could not record agent token use:', err?.message || err);
      }
    }
    return { ok: true, token: normalizeAgentToken(t) };
  }
}

export const vault = new Vault();
