// Python-compatible number formatting, so TS writes the same uids and amounts as books.py (parity on the same books.db).

/** Python round(x, n): rounds the exact binary value, half to even on true ties (0.125 → 0.12, 2.675 → 2.67, 1234.565 → 1234.57). */
export function pyRound(x: number, n = 2): number {
  // oxlint-disable-next-line number-arg-out-of-range -- ES2018+ allows 0..100 digits; the rule still says 20
  const [int, frac] = Math.abs(x).toFixed(100).split(".") as [string, string]; // toFixed(100) is the exact decimal expansion for money-sized values
  const rest = frac.slice(n),
    d = rest.charCodeAt(0) - 48,
    after = /[1-9]/.test(rest.slice(1));
  let k = BigInt(int + frac.slice(0, n));
  if (d > 5 || (d === 5 && (after || k % 2n === 1n))) k++;
  return (Math.sign(x) * Number(k)) / 10 ** n; // keeps -0 like Python: round(-0.001, 2) == -0.0
}

/**
 * str(x) as Python prints it, for the uid hash `source|date|amount|desc|key`. `isInt`: the value was a Python int
 * (an integer literal in a JSON statement, e.g. Mercury's "amount": 12) rather than a float ("12.0").
 * ponytail: plain notation only (1e-4 ≤ |x| < 1e16, i.e. any real amount); exponent forms throw so a parity bug can't hide.
 */
export function pyStr(x: number, isInt = false): string {
  if (isInt) return String(x);
  if (x !== 0 && (Math.abs(x) < 1e-4 || Math.abs(x) >= 1e16)) throw new RangeError(`pyStr: ${x} would need Python's exponent form`);
  const s = Object.is(x, -0) ? "-0" : String(x); // Python str(-0.0) == "-0.0"
  return Number.isInteger(x) ? `${s}.0` : s;
}
