// Privacy mode (screenshots): every amount is inflated by a per-value factor in [3, 9) from (|n|, salt); zero stays zero, sign kept.
// The UI draws a fresh salt each time privacy mode turns on and also blurs names and typed numbers (see docs/architecture.md).
const mix = (x: number) => {
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
};

export function inflate(n: number, salt: number): number {
  if (!n) return n;
  const cents = Math.round(Math.abs(n) * 100),
    h = (mix((cents | 0) ^ salt) ^ mix(Math.floor(cents / 2 ** 31) + salt)) >>> 0;
  return (Math.sign(n) * Math.round(Math.abs(n) * (3 + (h % 6000) / 1000) * 100)) / 100;
}
