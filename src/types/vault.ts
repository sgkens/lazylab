export interface SessionState {
  success: boolean;
  setupRequired: boolean;
  authenticated: boolean;
  vaultUnlocked: boolean;
  username: string | null;
  secure: boolean;
}

export interface VaultProfile {
  id: string;
  name: string;
  host: string;
  tokenHint: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type VaultEntryKind = 'secret' | 'ci' | 'runner';

/** A GitLab token with an expiry date (see server/tokenExpiry.ts). */
export interface TrackedToken {
  key: string;
  kind: 'personal' | 'project' | 'group' | 'deploy';
  name: string;
  owner: string;
  host: string;
  expires_at: string | null;
  days_left: number | null;
  scopes: string[];
  last_used_at?: string | null;
  web_url?: string;
  profileId?: string;
}

export interface TokenOverview {
  tokens: TrackedToken[];
  errors: string[];
  checkedAt: number;
}

export interface CiPushTarget {
  scope_type: 'project' | 'group';
  scope_id: number;
  key: string;
  environment_scope: string;
  pushedAt: string;
}

export interface VaultEntry {
  id: string;
  kind: VaultEntryKind;
  name: string;
  valueHint: string;
  note?: string;
  meta?: { targets?: CiPushTarget[]; runnerId?: number; host?: string; [k: string]: any };
  createdAt: string;
  updatedAt: string;
}

export type AgentScope = 'read' | 'write';

/** Agent token as listed by the vault (no hash). Policy fields are server/agentPolicy.ts. */
export interface AgentTokenInfo {
  id: string;
  name: string;
  prefix: string;
  /** read: read GitLab and local writes (watches, handoffs, notes); write: also GitLab writes and CI runs. */
  scope: AgentScope;
  dailyCiLimit: number | null;
  ciUsage?: { day: string; used: number };
  /** MCP-only allowlist; null allows every tool, [] allows none. */
  tools: string[] | null;
  /** May read CI variable values and vault secrets (lazy env pull, lazy run). */
  secrets: boolean;
  /** Allowed GitLab project ids; null means every project. */
  projects: number[] | null;
  defaultProjectId: number | null;
  expiresAt: string | null;
  expired: boolean;
  lastUsedAt: string | null;
  /** Created before scopes existed; kept write access to every project. */
  legacy: boolean;
  createdAt: string;
}

/** Create or edit payload; absent fields are left unchanged on edit. */
export interface AgentTokenSettings {
  scope?: AgentScope;
  dailyCiLimit?: number | null;
  tools?: string[] | null;
  secrets?: boolean;
  projects?: number[] | null;
  defaultProjectId?: number | null;
  /** 1..3650, or null for no expiry. */
  expiresInDays?: number | null;
}

export interface VaultSummary {
  success: boolean;
  profiles: VaultProfile[];
  entries: VaultEntry[];
  agentTokens: AgentTokenInfo[];
}

export interface DeviceSession {
  /** Public handle used to revoke the session; not the cookie value. */
  id: string;
  current: boolean;
  ip: string;
  userAgent: string;
  createdAt: number;
  lastSeen: number;
}
