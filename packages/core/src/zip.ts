// A tiny ZIP writer (APPNOTE 6.3.x, "stored" entries, no compression, UTF-8 names): enough to hand a few text files to the user as one
// download (the Israeli uniform-structure export). Pure: bytes in, bytes out. Not a reader.
// ponytail: stored only; add deflate (CompressionStream) if a caller ever ships large files.
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
/** CRC-32 (IEEE) of the bytes. */
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipFile {
  /** Path inside the archive, "/"-separated ("OPENFRMT/12345678.26/10291200/INI.TXT"). */
  name: string;
  data: Uint8Array;
  /** Modification time; default 2026-01-01 so the same input always gives the same bytes. */
  date?: Date;
}

const u16 = (n: number) => [n & 255, (n >>> 8) & 255];
const u32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const dosTime = (d: Date) => (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
const dosDate = (d: Date) => ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();

export function zip(files: readonly ZipFile[]): Uint8Array {
  const enc = new TextEncoder(),
    local: Uint8Array[] = [],
    central: number[][] = [];
  let at = 0;
  for (const f of files) {
    const name = enc.encode(f.name),
      d = f.date ?? new Date(Date.UTC(2026, 0, 1)),
      // version needed 2.0, flags: UTF-8 names, method 0 (stored), time, date, crc, sizes
      common = [
        ...u16(20),
        ...u16(0x0800),
        ...u16(0),
        ...u16(dosTime(d)),
        ...u16(dosDate(d)),
        ...u32(crc32(f.data)),
        ...u32(f.data.length),
        ...u32(f.data.length),
        ...u16(name.length),
      ];
    local.push(new Uint8Array([0x50, 0x4b, 3, 4, ...common, ...u16(0)]), name, f.data);
    central.push([0x50, 0x4b, 1, 2, ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(at), ...name]);
    at += 30 + name.length + f.data.length;
  }
  const dir = new Uint8Array(central.flat()),
    end = new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(dir.length), ...u32(at), 0, 0]);
  const out = new Uint8Array(at + dir.length + end.length);
  let o = 0;
  for (const p of [...local, dir, end]) (out.set(p, o), (o += p.length));
  return out;
}
