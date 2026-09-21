const round2 = (n: number) => Math.round(n * 100) / 100;

/** Shares `total` out over `weights` in proportion, to the cent, so the parts add back up to exactly `total`. */
export function allocateProportional(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (weights.length === 0) return [];
  const parts = weights.map((w) => (sum > 0 ? round2((total * w) / sum) : round2(total / weights.length)));
  const drift = round2(total - parts.reduce((s, p) => s + p, 0));
  let biggest = 0;
  weights.forEach((w, i) => { if (w > weights[biggest]) biggest = i; });
  parts[biggest] = round2(parts[biggest] + drift);
  return parts;
}
