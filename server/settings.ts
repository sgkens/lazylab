// Non-secret server settings (sync intervals, request budget) persisted as plain JSON next to the vault.
// They are read before the vault is unlocked and hold nothing sensitive, so they live outside it.
import fs from 'fs';
import path from 'path';
import { DEFAULT_BUDGET, RequestBudget } from './requestScheduler.js';

export interface ServerSettings {
  /** Seconds between auto-fetch cycles; 0 turns auto-fetch off. */
  autoFetchIntervalSec: number;
  /** Base seconds between watch checks; older pipelines are checked less often (WATCH-10, WATCH-14). */
  watchPollSec: number;
  /** GitLab request budget for the request scheduler (GL-19). */
  requestBudget: RequestBudget;
}

export const defaultSettings = (): ServerSettings => ({
  autoFetchIntervalSec: 30,
  watchPollSec: 15,
  requestBudget: { ...DEFAULT_BUDGET }
});

const settingsPath = () =>
  path.resolve(process.env.LAZYLAB_DATA_DIR || path.join(process.cwd(), '.data'), 'settings.json');

let current: ServerSettings | null = null;

function load(): ServerSettings {
  const file = settingsPath();
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (parsed && typeof parsed === 'object') return { ...defaultSettings(), ...parsed };
    }
  } catch (err: any) {
    // A corrupt settings file must not stop the server; defaults apply and the next save replaces it.
    console.warn(`Ignoring unreadable settings file ${file}: ${err?.message ?? err}`);
  }
  return defaultSettings();
}

/** Read-only view of the settings. Use updateSettings to change them. */
export function getSettings(): Readonly<ServerSettings> {
  if (!current) current = load();
  return current;
}

/** Merges `patch` into the settings and writes them atomically. */
export function updateSettings(patch: Partial<ServerSettings>): Readonly<ServerSettings> {
  const next = { ...getSettings(), ...patch };
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  current = next;
  return current;
}

/** Test hook: forget the in-memory copy so the next read reloads from disk. */
export function resetSettingsCache() {
  current = null;
}
