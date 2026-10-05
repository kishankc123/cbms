// Pure asset-code rules (no database), unit-tested. The lookup of the next free code is in ./next-code.

export const buildAssetCode = (prefix: string, sequence: number) => `${prefix}${String(sequence).padStart(6, "0")}`;

/** One more than the highest number already used with this prefix (codes with another prefix or a non-number tail are ignored). */
export function nextAssetSequence(prefix: string, codes: Iterable<string>): number {
  let highest = 0;
  for (const code of codes) {
    if (!code.startsWith(prefix)) continue;
    const tail = code.slice(prefix.length);
    if (/^\d+$/.test(tail)) highest = Math.max(highest, Number(tail));
  }
  return highest + 1;
}
