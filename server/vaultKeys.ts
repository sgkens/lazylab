/**
 * Recovery key encoding and backup file validation for the vault (see server/vault.ts and docs/src/guide/vault.md).
 *
 * Recovery key text: `LLRK-` + base32 (RFC 4648 alphabet, no padding) of 32 random bytes (52 characters)
 * + 3 checksum characters (the first 15 bits of SHA-256 over the key), grouped in fives.
 */
import { createHash } from 'crypto';

export const RECOVERY_PREFIX = 'LLRK';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const KEY_BYTES = 32;
const KEY_CHARS = 52; // ceil(256 / 5)
const CHECK_CHARS = 3;

export class RecoveryKeyFormatError extends Error {
  constructor(message = 'The recovery key has a typo: check each group against the printed key') {
    super(message);
  }
}

function base32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function unbase32(text: string, byteLength: number): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new RecoveryKeyFormatError();
    value = ((value << 5) | idx) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (out.length < byteLength) throw new RecoveryKeyFormatError();
  return Buffer.from(out.slice(0, byteLength));
}

const checksum = (key: Buffer) => base32(createHash('sha256').update(key).digest().subarray(0, 2)).slice(0, CHECK_CHARS);

export function formatRecoveryKey(key: Buffer): string {
  if (key.length !== KEY_BYTES) throw new Error('recovery key must be 32 bytes');
  const body = base32(key) + checksum(key);
  return [RECOVERY_PREFIX, ...(body.match(/.{1,5}/g) ?? [])].join('-');
}

/** Accepts any case, spaces and dashes, with or without the prefix; 0, 1 and 8 are read as O, I and B. */
export function parseRecoveryKey(text: unknown): Buffer {
  if (typeof text !== 'string') throw new RecoveryKeyFormatError('recovery key is required');
  let s = text.toUpperCase().replace(/[\s-]+/g, '');
  if (s.startsWith(RECOVERY_PREFIX)) s = s.slice(RECOVERY_PREFIX.length);
  s = s.replace(/0/g, 'O').replace(/1/g, 'I').replace(/8/g, 'B');
  if (s.length !== KEY_CHARS + CHECK_CHARS) throw new RecoveryKeyFormatError(`A recovery key has ${KEY_CHARS + CHECK_CHARS} characters after ${RECOVERY_PREFIX}; this one has ${s.length}`);
  const key = unbase32(s.slice(0, KEY_CHARS), KEY_BYTES);
  // Reject non-canonical trailing bits too, so one key has exactly one spelling.
  if (base32(key) !== s.slice(0, KEY_CHARS) || checksum(key) !== s.slice(KEY_CHARS)) throw new RecoveryKeyFormatError();
  return key;
}

// ---- backup files ----------------------------------------------------------------

export const BACKUP_FORMAT = 'lazylab-vault-backup';
export const BACKUP_FORMAT_VERSION = 1;

export class BackupFormatError extends Error {}

const isB64 = (v: unknown, size?: number) => typeof v === 'string' && v.length > 0 && Buffer.from(v, 'base64').toString('base64') === v && (size === undefined || Buffer.from(v, 'base64').length === size);
const isSealed = (v: any) => v && typeof v === 'object' && isB64(v.iv, 12) && isB64(v.tag, 16) && isB64(v.ct) && v.ct.length > 0;

/**
 * Validates the shape of a backup (or a bare vault.json) and returns the vault file inside it.
 * Only structure is checked here; the caller proves integrity by decrypting with the given credential.
 */
export function parseBackupFile<T = any>(input: unknown, vaultVersion: number): T {
  let doc: any = input;
  if (typeof doc === 'string') {
    try {
      doc = JSON.parse(doc);
    } catch {
      throw new BackupFormatError('The backup is not valid JSON');
    }
  }
  if (!doc || typeof doc !== 'object') throw new BackupFormatError('The backup is empty');
  if (doc.format !== undefined) {
    if (doc.format !== BACKUP_FORMAT) throw new BackupFormatError('This file is not a lazylab vault backup');
    if (doc.formatVersion !== BACKUP_FORMAT_VERSION) {
      throw new BackupFormatError(`Unsupported backup format version ${doc.formatVersion}; update lazylab to restore it`);
    }
    doc = doc.vault;
  }
  const v = doc;
  if (!v || typeof v !== 'object' || v.kdf === undefined) throw new BackupFormatError('This file is not a lazylab vault backup');
  if (v.version !== vaultVersion) throw new BackupFormatError(`Unsupported vault version ${v.version}; update lazylab to restore it`);
  if (typeof v.username !== 'string' || !v.username) throw new BackupFormatError('The backup has no username');
  const k = v.kdf;
  const pow2 = (n: unknown) => Number.isInteger(n) && (n as number) >= 2 ** 10 && (n as number) <= 2 ** 20 && ((n as number) & ((n as number) - 1)) === 0;
  if (!k || k.name !== 'scrypt' || !isB64(k.salt, 16) || !pow2(k.N) || !Number.isInteger(k.r) || k.r < 1 || k.r > 32 || !Number.isInteger(k.p) || k.p < 1 || k.p > 16 || k.keyLen !== 32 || 128 * k.N * k.r > 128 * 1024 * 1024) {
    throw new BackupFormatError('The backup has invalid key-derivation parameters');
  }
  if (!isSealed(v.dek) || !isSealed(v.payload)) throw new BackupFormatError('The backup is damaged: missing encrypted fields');
  if (v.recovery !== undefined && (!v.recovery || v.recovery.kdf !== 'hkdf-sha256' || !isB64(v.recovery.salt, 16) || !isSealed(v.recovery.dek))) {
    throw new BackupFormatError('The backup is damaged: invalid recovery key data');
  }
  if (v.id !== undefined && typeof v.id !== 'string') throw new BackupFormatError('The backup has an invalid vault id');
  if (v.revision !== undefined && (!Number.isInteger(v.revision) || v.revision < 0)) throw new BackupFormatError('The backup has an invalid revision');
  return v as T;
}
