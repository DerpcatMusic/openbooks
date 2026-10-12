// SHA-1 as a hex string, synchronous and dependency-free so the statement readers and uids run in the browser too
// (node:crypto is the oracle in sha1.test.ts). Used for transaction uids, not for security.
export function sha1Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const n = bytes.length;
  const w8 = new Uint8Array(((n + 9 + 63) >> 6) << 6);
  w8.set(bytes);
  w8[n] = 0x80;
  const dv = new DataView(w8.buffer);
  dv.setUint32(w8.length - 8, Math.floor((n * 8) / 2 ** 32));
  dv.setUint32(w8.length - 4, (n * 8) >>> 0);
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w: number[] = [];
  const rol = (x: number, s: number) => (x << s) | (x >>> (32 - s));
  for (let o = 0; o < w8.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rol(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    let [a, b, c, d, e] = h as [number, number, number, number, number];
    for (let i = 0; i < 80; i++) {
      const [f, k] =
        i < 20
          ? [(b & c) | (~b & d), 0x5a827999]
          : i < 40
            ? [b ^ c ^ d, 0x6ed9eba1]
            : i < 60
              ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
              : [b ^ c ^ d, 0xca62c1d6];
      const t = (rol(a, 5) + f! + e + k! + w[i]!) | 0;
      [e, d, c, b, a] = [d, c, rol(b, 30), a, t];
    }
    [a, b, c, d, e].forEach((x, i) => (h[i] = (h[i]! + x) | 0));
  }
  return h.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
}
