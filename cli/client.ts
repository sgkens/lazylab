/**
 * Connection settings and the MCP client `lazy` talks to lazylab with. Every command is one
 * `tools/call` on lazylab's stateless MCP endpoint, authenticated with an agent token.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

export interface CliConfig {
  url: string;
  token: string;
}

export function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  return path.join(base, 'lazylab', 'cli.json');
}

/** LAZYLAB_URL and LAZYLAB_TOKEN override the file written by `lazy login`. */
export function loadConfig(): CliConfig | null {
  let file: Partial<CliConfig> = {};
  const p = configPath();
  if (existsSync(p)) {
    try {
      file = JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      throw new CliError(`${p} is not valid JSON. Run: lazy login <url>`);
    }
  }
  const url = process.env.LAZYLAB_URL || file.url;
  const token = process.env.LAZYLAB_TOKEN || file.token;
  return url && token ? { url: normalizeUrl(url), token } : null;
}

export function saveConfig(config: CliConfig): string {
  const p = configPath();
  mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  writeFileSync(p, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(p, 0o600); // the token is a credential; tighten an existing file too
  return p;
}

export const normalizeUrl = (url: string) => url.trim().replace(/\/+$/, '').replace(/\/mcp$/, '');

/** An error meant for the user: printed without a stack trace. */
export class CliError extends Error {
  constructor(message: string, readonly exitCode = 1) {
    super(message);
  }
}

let nextId = 1;

export class LazyClient {
  constructor(readonly config: CliConfig) {}

  async call<T = any>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    const body = await this.rpc('tools/call', { name: tool, arguments: args });
    const text: string = body.result?.content?.[0]?.text ?? '';
    if (body.result?.isError) throw new CliError(text || `${tool} failed`);
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  async listTools(): Promise<string[]> {
    const body = await this.rpc('tools/list', {});
    return (body.result?.tools ?? []).map((t: { name: string }) => t.name);
  }

  private async rpc(method: string, params: unknown): Promise<any> {
    const url = `${this.config.url}/mcp`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${this.config.token}`
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params })
      });
    } catch (e: any) {
      throw new CliError(`Cannot reach lazylab at ${this.config.url}: ${e?.message ?? e}`);
    }
    const body: any = await res.json().catch(() => null);
    if (res.status === 401) throw new CliError('lazylab rejected the agent token. Create one in Vault → Agent tokens and run: lazy login');
    if (res.status === 503) throw new CliError('lazylab is locked. Sign in to lazylab in a browser to unlock it.');
    if (!res.ok || !body) throw new CliError(`lazylab returned HTTP ${res.status}${body?.error?.message ? `: ${body.error.message}` : ''}`);
    if (body.error) throw new CliError(body.error.message || `${method} failed`);
    return body;
  }
}
