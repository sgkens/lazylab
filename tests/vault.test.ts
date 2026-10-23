// Vault crypto: password checks, tamper detection, password change and reload from disk.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { Vault } from '../server/vault.ts';

const USER = 'tester';
const PASSWORD = 'long-enough-password';
const dirs: string[] = [];

function scratchFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'lazylab-vault-crypto-'));
  dirs.push(dir);
  return path.join(dir, 'vault.json');
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

async function seeded(): Promise<{ file: string; entryId: string }> {
  const file = scratchFile();
  const v = new Vault(file);
  await v.initialize(USER, PASSWORD);
  const entry = v.addEntry({ kind: 'secret', name: 'api', value: 'secret-value-marker' });
  v.lock();
  return { file, entryId: entry.id };
}

/** Flips one bit in a base64 field of the vault file. */
function tamper(file: string, pick: (json: any) => { obj: any; key: string }) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const { obj, key } = pick(json);
  const buf = Buffer.from(obj[key], 'base64');
  buf[buf.length - 1] ^= 0x01;
  obj[key] = buf.toString('base64');
  writeFileSync(file, JSON.stringify(json));
}

describe('vault crypto', () => {
  test('stores nothing in plaintext and unlocks in a fresh instance', async () => {
    const { file, entryId } = await seeded();
    expect(readFileSync(file, 'utf8')).not.toContain('secret-value-marker');
    const v = new Vault(file);
    expect(v.isInitialized()).toBe(true);
    expect(v.isUnlocked()).toBe(false);
    expect(await v.verifyAndUnlock(USER, PASSWORD)).toBe(true);
    expect(v.getEntry(entryId).value).toBe('secret-value-marker');
  });

  test('rejects a wrong password and a wrong username without unlocking', async () => {
    const { file } = await seeded();
    const v = new Vault(file);
    expect(await v.verifyAndUnlock(USER, 'wrong-password-123')).toBe(false);
    expect(await v.verifyAndUnlock('someone', PASSWORD)).toBe(false);
    expect(await v.verifyAndUnlock('', PASSWORD)).toBe(false);
    expect(v.isUnlocked()).toBe(false);
  });

  test('a username with the same length but more UTF-8 bytes is rejected, not thrown', async () => {
    const { file } = await seeded();
    const v = new Vault(file);
    // 'testeñ' has 6 characters like 'tester' but 7 bytes.
    expect(await v.verifyAndUnlock('testeñ', PASSWORD)).toBe(false);
    expect(v.isUnlocked()).toBe(false);
  });

  for (const field of ['ct', 'iv', 'tag'] as const) {
    test(`detects a modified wrapped-DEK ${field}`, async () => {
      const { file } = await seeded();
      tamper(file, (j) => ({ obj: j.dek, key: field }));
      const v = new Vault(file);
      expect(await v.verifyAndUnlock(USER, PASSWORD)).toBe(false);
      expect(v.isUnlocked()).toBe(false);
    });

    test(`detects a modified payload ${field} and stays locked`, async () => {
      const { file } = await seeded();
      tamper(file, (j) => ({ obj: j.payload, key: field }));
      const v = new Vault(file);
      await expect(v.verifyAndUnlock(USER, PASSWORD)).rejects.toThrow();
      // A half-open vault (key in memory, no payload) would let a second login "succeed" with no data.
      expect(v.isUnlocked()).toBe(false);
      await expect(v.verifyAndUnlock(USER, PASSWORD)).rejects.toThrow();
      expect(v.isUnlocked()).toBe(false);
    });
  }

  test('detects a modified KDF salt', async () => {
    const { file } = await seeded();
    tamper(file, (j) => ({ obj: j.kdf, key: 'salt' }));
    expect(await new Vault(file).verifyAndUnlock(USER, PASSWORD)).toBe(false);
  });

  test('changing the password keeps the data and retires the old password', async () => {
    const { file, entryId } = await seeded();
    const v = new Vault(file);
    await v.verifyAndUnlock(USER, PASSWORD);
    expect(await v.changePassword('not-the-password', 'a-new-long-password')).toBe(false);
    expect(await v.changePassword(PASSWORD, 'a-new-long-password')).toBe(true);
    expect(v.getEntry(entryId).value).toBe('secret-value-marker');

    const fresh = new Vault(file);
    expect(await fresh.verifyAndUnlock(USER, PASSWORD)).toBe(false);
    expect(await fresh.verifyAndUnlock(USER, 'a-new-long-password')).toBe(true);
    expect(fresh.getEntry(entryId).value).toBe('secret-value-marker');
  });

  test('a failed write during a password change keeps the old password working', async () => {
    const { file, entryId } = await seeded();
    const v = new Vault(file);
    await v.verifyAndUnlock(USER, PASSWORD);
    // A directory where the temp file goes makes the write fail.
    const { mkdirSync } = await import('fs');
    const blocker = `${file}.${process.pid}.tmp`;
    mkdirSync(blocker);
    await expect(v.changePassword(PASSWORD, 'a-new-long-password')).rejects.toThrow();
    rmSync(blocker, { recursive: true });
    // In memory and on disk the old password still applies.
    expect(await v.verifyAndUnlock(USER, PASSWORD)).toBe(true);
    const fresh = new Vault(file);
    expect(await fresh.verifyAndUnlock(USER, PASSWORD)).toBe(true);
    expect(fresh.getEntry(entryId).value).toBe('secret-value-marker');
  });

  test('lock wipes the key and payload', async () => {
    const { file, entryId } = await seeded();
    const v = new Vault(file);
    await v.verifyAndUnlock(USER, PASSWORD);
    v.lock();
    expect(v.isUnlocked()).toBe(false);
    expect(() => v.getEntry(entryId)).toThrow('locked');
  });

  test('each write uses a fresh payload IV', async () => {
    const { file } = await seeded();
    const v = new Vault(file);
    await v.verifyAndUnlock(USER, PASSWORD);
    const before = JSON.parse(readFileSync(file, 'utf8')).payload.iv;
    v.addEntry({ kind: 'secret', name: 'b', value: 'v' });
    expect(JSON.parse(readFileSync(file, 'utf8')).payload.iv).not.toBe(before);
  });

  test('refuses an unknown vault version', () => {
    const file = scratchFile();
    writeFileSync(file, JSON.stringify({ version: 99 }));
    expect(() => new Vault(file)).toThrow('Unsupported vault version 99');
  });
});
