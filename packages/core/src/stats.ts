export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

/** One-sided 95% Wilson lower bound for a success rate. */
export function wilsonLower(successes: number, n: number, z = 1.645): number {
  if (n === 0) return 0;
  const p = successes / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.max(0, (centre - margin) / (1 + z2 / n));
}

export const words = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);
