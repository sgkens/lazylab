/**
 * Built-in HTTPS support.
 *
 * LAZYLAB_TLS=on enables it. Certificate source, in order:
 *   1. LAZYLAB_TLS_CERT + LAZYLAB_TLS_KEY (PEM paths, e.g. from mkcert or your own CA)
 *   2. A self-signed certificate generated once into <data dir>/tls/, valid for 825 days,
 *      covering localhost, 127.0.0.1, this machine's hostname and LAZYLAB_TLS_SANS.
 */
import { createHash } from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import forge from 'node-forge';

export interface TlsMaterial {
  cert: string;
  key: string;
  source: string;
  fingerprint: string;
}

export const tlsEnabled = () => ['on', 'true', '1'].includes(String(process.env.LAZYLAB_TLS || '').toLowerCase());

function fingerprintOf(certPem: string): string {
  const der = Buffer.from(certPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
  return createHash('sha256').update(der).digest('hex').toUpperCase().match(/.{2}/g)!.join(':');
}

function generateSelfSigned(names: string[]): { cert: string; key: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(15));
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 825 * 24 * 60 * 60 * 1000);
  const attrs = [{ name: 'commonName', value: `lazylab (${os.hostname()})` }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    {
      name: 'subjectAltName',
      altNames: names.map((n) => (net.isIP(n) ? { type: 7, ip: n } : { type: 2, value: n }))
    }
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { cert: forge.pki.certificateToPem(cert), key: forge.pki.privateKeyToPem(keys.privateKey) };
}

export function loadTlsMaterial(dataDir: string): TlsMaterial {
  const certPath = process.env.LAZYLAB_TLS_CERT;
  const keyPath = process.env.LAZYLAB_TLS_KEY;
  if (certPath || keyPath) {
    if (!certPath || !keyPath) throw new Error('Set both LAZYLAB_TLS_CERT and LAZYLAB_TLS_KEY, or neither');
    const cert = fs.readFileSync(certPath, 'utf-8');
    return { cert, key: fs.readFileSync(keyPath, 'utf-8'), source: certPath, fingerprint: fingerprintOf(cert) };
  }

  const dir = path.join(dataDir, 'tls');
  const genCert = path.join(dir, 'cert.pem');
  const genKey = path.join(dir, 'key.pem');
  if (!fs.existsSync(genCert) || !fs.existsSync(genKey)) {
    const extra = String(process.env.LAZYLAB_TLS_SANS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const names = [...new Set(['localhost', '127.0.0.1', os.hostname(), ...extra])];
    console.log(`Generating self-signed TLS certificate for: ${names.join(', ')}`);
    const { cert, key } = generateSelfSigned(names);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(genCert, cert);
    fs.writeFileSync(genKey, key, { mode: 0o600 });
  }
  const cert = fs.readFileSync(genCert, 'utf-8');
  return { cert, key: fs.readFileSync(genKey, 'utf-8'), source: genCert, fingerprint: fingerprintOf(cert) };
}
