// Probe the same listener for HTTP and built-in HTTPS, including self-signed TLS.
import { tlsEnabled } from '../server/tls.js';

const bindHost = process.env.HOST || '127.0.0.1';
const probeHost = bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost === '::' ? '[::1]' : bindHost.includes(':') ? `[${bindHost}]` : bindHost;
const port = Number(process.env.PORT) || 3000;
const protocol = tlsEnabled() ? 'https' : 'http';
try {
  const response = await fetch(`${protocol}://${probeHost}:${port}/healthz`, {
    signal: AbortSignal.timeout(4000),
    // This request stays on the configured listener and carries no credentials.
    tls: { rejectUnauthorized: false },
  });
  const body = await response.json();
  process.exit(response.ok && body?.status === 'ok' ? 0 : 1);
} catch {
  process.exit(1);
}
