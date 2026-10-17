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

export interface AgentTokenInfo {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
}

export interface VaultSummary {
  success: boolean;
  profiles: VaultProfile[];
  entries: VaultEntry[];
  agentTokens: AgentTokenInfo[];
}

export interface DeviceSession {
  current: boolean;
  ip: string;
  userAgent: string;
  createdAt: number;
  lastSeen: number;
}
