import express from 'express';
import http from 'http';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiRouter } from './server/apiRouter.js';
import { announceSetupIfNeeded, apiGuard, securityHeaders, sessionRouter } from './server/session.js';
import { loadTlsMaterial, tlsEnabled } from './server/tls.js';
import { vaultRouter } from './server/vaultRouter.js';
import { notifyRouter } from './server/notifyRouter.js';
import { createNotesRouter } from './server/notesRouter.js';
import { createMcpRouter } from './server/mcp.js';
import { getGitlabClient } from './server/apiRouter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** LAZYLAB_TRUST_PROXY: unset = off, "true", a hop count, or an express trust spec such as "loopback" or "100.64.0.0/10". */
function parseTrustProxy(raw: string | undefined): boolean | number | string {
  if (!raw) return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

const isLoopback = (host: string) => ['127.0.0.1', '::1', 'localhost'].includes(host);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || '127.0.0.1';
  const isProd = process.env.NODE_ENV === 'production';
  const dataDir = path.resolve(process.env.LAZYLAB_DATA_DIR || path.join(process.cwd(), '.data'));
  const trustProxy = parseTrustProxy(process.env.LAZYLAB_TRUST_PROXY);

  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.use(securityHeaders);
  // Project avatars travel as base64 JSON (GitLab caps them at 200 KB).
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/session', sessionRouter);
  app.use('/api', apiGuard);
  app.use('/api/vault', vaultRouter);
  app.use('/api/notify', notifyRouter);
  app.use('/api/notes', createNotesRouter(getGitlabClient));
  app.use('/api', apiRouter);
  app.use('/mcp', createMcpRouter(getGitlabClient));

  const useTls = tlsEnabled();
  let server: http.Server | https.Server;
  if (useTls) {
    const tls = loadTlsMaterial(dataDir);
    server = https.createServer({ cert: tls.cert, key: tls.key }, app);
    console.log(`TLS certificate: ${tls.source}`);
    console.log(`TLS SHA-256 fingerprint: ${tls.fingerprint}`);
  } else {
    server = http.createServer(app);
  }

  if (!isProd) {
    // Imported lazily so the production runtime does not need vite installed.
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: { server } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  server.listen(PORT, HOST, () => {
    console.log(`lazylab server running on ${useTls ? 'https' : 'http'}://${HOST}:${PORT}`);
    if (!isLoopback(HOST) && !useTls && !trustProxy) {
      console.warn(
        'WARNING: listening on a non-loopback address over plain HTTP. Passwords and session cookies are sent unencrypted.\n' +
          '         Set LAZYLAB_TLS=on, or put lazylab behind an HTTPS proxy and set LAZYLAB_TRUST_PROXY.'
      );
    }
    announceSetupIfNeeded();
  });
}

startServer();
