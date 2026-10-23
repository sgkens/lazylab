import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'fs';
import { randomBytes } from 'crypto';
import { tmpdir } from 'os';
import path from 'path';
import { Vault, RestoreConflictError } from '../server/vault.ts';
import { formatRecoveryKey, parseRecoveryKey, parseBackupFile } from '../server/vaultKeys.ts';
const dirs: string[] = [];
const password = 'test-backup-password';
const next = 'replacement-password';
function fresh() {
  const dir = mkdtempSync(path.join(tmpdir(), 'lazylab-backup-')); dirs.push(dir);
  const file = path.join(dir, 'vault.json'); return { file, vault: new Vault(file) };
}
async function seed() { const item = fresh(); await item.vault.initialize('tester', password); const entry = item.vault.addEntry({ name: 'secret', kind: 'secret', value: 'never-plaintext-marker' }); return { ...item, entry }; }
afterAll(() => dirs.forEach(d => rmSync(d, { recursive: true, force: true })));

describe('recovery keys', () => {
  test('encoding round trips, tolerates separators/case and catches typos and trailing bits', () => {
    for (let i = 0; i < 50; i++) { const key = randomBytes(32); const text = formatRecoveryKey(key); expect(parseRecoveryKey(text)).toEqual(key); expect(parseRecoveryKey(text.toLowerCase().replaceAll('-', ' '))).toEqual(key); expect(parseRecoveryKey(text.slice(5).replaceAll('-', ''))).toEqual(key); }
    expect(() => parseRecoveryKey('LLRK-missing')).toThrow();
    const text = formatRecoveryKey(Buffer.alloc(32)); expect(() => parseRecoveryKey(text.slice(0, -1) + 'Z')).toThrow();
  });
  test('requires current password; supports reset while locked, rotation and removal', async () => {
    const { vault, file, entry } = await seed();
    expect(await vault.createRecoveryKey('wrong')).toBeNull();
    const key = (await vault.createRecoveryKey(password))!;
    expect(readFileSync(file, 'utf8')).not.toContain(key);
    expect(vault.recoveryStatus().configured).toBe(true);
    vault.lock();
    await expect(vault.resetPasswordWithRecoveryKey(formatRecoveryKey(randomBytes(32)), next)).rejects.toThrow('does not open');
    expect(vault.isUnlocked()).toBe(false);
    await expect(vault.resetPasswordWithRecoveryKey(key, 'short')).rejects.toThrow();
    expect(await vault.resetPasswordWithRecoveryKey(key, next)).toBe('tester');
    expect(vault.getEntry(entry.id).value).toBe('never-plaintext-marker');
    vault.lock(); expect(await vault.verifyAndUnlock('tester', password)).toBe(false); expect(await vault.verifyAndUnlock('tester', next)).toBe(true);
    expect(await vault.changePassword(next, password)).toBe(true);
    await vault.resetPasswordWithRecoveryKey(key, next); // password changes preserve recovery
    let locked = 0; vault.on('locked', () => locked++);
    await vault.resetPasswordWithRecoveryKey(key, next); expect(locked).toBe(1); // revoke existing sessions too
    const replacement = (await vault.createRecoveryKey(next))!;
    await expect(vault.resetPasswordWithRecoveryKey(key, password)).rejects.toThrow('does not open');
    expect(await vault.removeRecoveryKey('wrong')).toBe(false);
    expect(await vault.removeRecoveryKey(next)).toBe(true);
    await expect(vault.resetPasswordWithRecoveryKey(replacement, password)).rejects.toThrow('no recovery key');
  });
});

describe('encrypted backups', () => {
  test('round trips encrypted file with password and bare vault file', async () => {
    const { vault, entry, file } = await seed();
    expect(await vault.exportBackup('wrong')).toBeNull();
    const backup = (await vault.exportBackup(password))!;
    expect(JSON.stringify(backup)).not.toContain('never-plaintext-marker');
    expect(backup.vault).toEqual(JSON.parse(readFileSync(file, 'utf8')));
    for (const input of [backup, backup.vault, JSON.stringify(backup)]) {
      const { vault: target, file: targetFile } = fresh();
      await target.restoreBackup(input, { password }, { mode: 'fresh' });
      expect(target.getEntry(entry.id).value).toBe('never-plaintext-marker');
      expect(statSync(targetFile).mode & 0o777).toBe(0o600);
      target.lock(); expect(await new Vault(targetFile).verifyAndUnlock('tester', password)).toBe(true);
    }
  });
  test('recovery-key restore changes the backup password', async () => {
    const { vault, entry } = await seed(); const key = (await vault.createRecoveryKey(password))!;
    const backup = (await vault.exportBackup(password))!; const target = fresh();
    await target.vault.restoreBackup(backup, { recoveryKey: key, newPassword: next }, { mode: 'fresh' });
    expect(target.vault.getEntry(entry.id).value).toBe('never-plaintext-marker');
    target.vault.lock(); expect(await target.vault.verifyAndUnlock('tester', password)).toBe(false); expect(await target.vault.verifyAndUnlock('tester', next)).toBe(true);
  });
  test('wrong credentials, tamper and malformed formats leave target uninitialized', async () => {
    const { vault } = await seed(); const key = (await vault.createRecoveryKey(password))!;
    const backup = (await vault.exportBackup(password))!;
    for (const credential of [{ password: 'wrong' }, { recoveryKey: formatRecoveryKey(randomBytes(32)), newPassword: next }, { recoveryKey: key }, {}]) {
      const target = fresh().vault; await expect(target.restoreBackup(backup, credential, { mode: 'fresh' })).rejects.toThrow(); expect(target.isInitialized()).toBe(false);
    }
    for (const section of ['dek', 'payload', 'recovery'] as const) {
      const altered = structuredClone(backup); const sealed = section === 'recovery' ? altered.vault.recovery!.dek : altered.vault[section];
      const bytes = Buffer.from(sealed.ct, 'base64'); bytes[0] ^= 1; sealed.ct = bytes.toString('base64');
      const target = fresh().vault; await expect(target.restoreBackup(altered, section === 'recovery' ? { recoveryKey: key, newPassword: next } : { password }, { mode: 'fresh' })).rejects.toThrow(); expect(target.isInitialized()).toBe(false);
    }
    for (const malformed of ['not json', {}, { ...backup, formatVersion: 999 }, { ...backup.vault, version: 999 }, { ...backup.vault, kdf: { ...backup.vault.kdf, N: 2 ** 30 } }, { ...backup.vault, payload: { iv: '', tag: '', ct: '' } }]) expect(() => parseBackupFile(malformed, 1)).toThrow();
  });
  test('older and different backups require confirmation and preserve the replaced file', async () => {
    const { vault, file, entry } = await seed(); const backup = (await vault.exportBackup(password))!;
    vault.addEntry({ name: 'newer', kind: 'secret', value: 'new-data' });
    const before = readFileSync(file, 'utf8');
    await expect(vault.restoreBackup(backup, { password }, { mode: 'replace' })).rejects.toBeInstanceOf(RestoreConflictError);
    expect(readFileSync(file, 'utf8')).toBe(before);
    let locked = 0; vault.on('locked', () => locked++);
    const restored = await vault.restoreBackup(backup, { password }, { mode: 'replace', replaceNewer: true });
    expect(locked).toBe(1); expect(vault.listEntries()).toHaveLength(1); expect(vault.getEntry(entry.id).value).toBe('never-plaintext-marker');
    expect(restored.meta.revision).toBeGreaterThan(JSON.parse(before).revision);
    const saved = readdirSync(path.dirname(file)).find(n => n.includes('.pre-restore-'))!;
    expect(readFileSync(path.join(path.dirname(file), saved), 'utf8')).toBe(before);
    const other = await seed(); const otherBackup = (await other.vault.exportBackup(password))!;
    await expect(vault.restoreBackup(otherBackup, { password }, { mode: 'replace' })).rejects.toThrow('different vault');
    vault.lock(); await expect(vault.restoreBackup(backup, { password }, { mode: 'replace', replaceNewer: true })).rejects.toThrow('locked');
    await expect(vault.restoreBackup(backup, { password }, { mode: 'fresh' })).rejects.toThrow('already initialized');
  });
  test('previous encrypted file is retained with private permissions', async () => {
    const { file } = await seed(); const previous = `${file}.bak`;
    expect(statSync(previous).mode & 0o777).toBe(0o600); expect(readFileSync(previous, 'utf8')).not.toContain('never-plaintext-marker');
  });
});


describe('backup mutation safety', () => {
  test('rejects resets and restores when another write occurs during key derivation', async () => {
    const { vault } = await seed();
    const key = (await vault.createRecoveryKey(password))!;
    const backup = (await vault.exportBackup(password))!;
    const reset = vault.resetPasswordWithRecoveryKey(key, next);
    vault.addEntry({ name: 'during-reset', kind: 'secret', value: 'keep-reset' });
    await expect(reset).rejects.toThrow('changed during the reset');
    expect(vault.listEntries()).toHaveLength(2);
    const restore = vault.restoreBackup(backup, { password }, { mode: 'replace', replaceNewer: true });
    vault.addEntry({ name: 'during-restore', kind: 'secret', value: 'keep-restore' });
    await expect(restore).rejects.toThrow('changed during restore');
    expect(vault.listEntries()).toHaveLength(3);
    expect(await vault.verifyAndUnlock('tester', password)).toBe(true);
  });
  test('only one simultaneous first-run restore can claim an empty vault', async () => {
    const { vault } = await seed(); const backup = (await vault.exportBackup(password))!;
    const target = fresh().vault;
    const results = await Promise.allSettled([target.restoreBackup(backup, { password }, { mode: 'fresh' }), target.restoreBackup(backup, { password }, { mode: 'fresh' })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(target.listEntries()).toHaveLength(1);
  });
  test('failed recovery-key writes leave memory and the saved vault unchanged', async () => {
    const { vault, file } = await seed();
    const before = readFileSync(file, 'utf8');
    mkdirSync(`${file}.${process.pid}.tmp`);
    await expect(vault.createRecoveryKey(password)).rejects.toThrow();
    expect(vault.recoveryStatus().configured).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(vault.isUnlocked()).toBe(true);
  });
});
