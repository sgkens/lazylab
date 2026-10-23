/**
 * Minimal ZIP writer: stored entries only (no compression), CRC-32, UTF-8 names, no ZIP64.
 * Enough for exports of small text files without adding a dependency.
 */

export interface ZipEntry {
  /** Path inside the archive, forward slashes, no leading slash. */
  name: string;
  data: Buffer;
  modified?: Date;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time in local time, as ZIP readers expect. Clamped to the format's 1980 epoch. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

const UTF8_FLAG = 0x0800;
const MAX_ENTRIES = 0xffff;
const MAX_SIZE = 0xffffffff;

export function createZip(entries: ZipEntry[]): Buffer {
  if (entries.length > MAX_ENTRIES) throw new Error(`a ZIP without ZIP64 holds at most ${MAX_ENTRIES} entries`);
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith('/') || entry.name.includes('\\') || entry.name.split('/').includes('..')) {
      throw new Error(`invalid ZIP entry name "${entry.name}"`);
    }
    const name = Buffer.from(entry.name, 'utf8');
    const { time, date } = dosDateTime(entry.modified ?? new Date());
    const crc = crc32(entry.data);
    const size = entry.data.length;
    if (size > MAX_SIZE || offset > MAX_SIZE) throw new Error('ZIP exceeds 4 GB; ZIP64 is not supported');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, entry.data);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(0x031e, 4); // made by: Unix, spec 3.0
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(UTF8_FLAG, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(date, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(size, 20);
    header.writeUInt32LE(size, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE((0o100600 << 16) >>> 0, 38); // external attributes: regular file, mode 600
    header.writeUInt32LE(offset, 42);
    central.push(header, name);

    offset += local.length + name.length + size;
  }

  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}
