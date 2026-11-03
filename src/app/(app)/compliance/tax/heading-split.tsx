// The "deposit by heading" part of a TDS deposit, shared by the Compliance drawer and the Money out form: what is left to deposit for
// each heading, and how much of it is paid now. Pure helpers plus the small block of inputs; the owner keeps the state.

export type Breakdown = { key: string | null; name: string; withheld: number; deposited: number; remaining: number }[];
export type HeadSplit = Record<string, string>;

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });
export const headKey = (k: string | null) => k ?? "";

/** The headings that have something to deposit or have been withheld. */
export const splitHeadings = (breakdown?: Breakdown | null) => (breakdown ?? []).filter((r) => r.remaining > 0 || r.withheld > 0);

/** Every heading starts at what is left for it. */
export const startingSplit = (headings: Breakdown): HeadSplit => Object.fromEntries(headings.map((r) => [headKey(r.key), r.remaining.toFixed(2)]));

export const splitTotal = (headings: Breakdown, split: HeadSplit) => round2(headings.reduce((s, r) => s + (Number(split[headKey(r.key)]) || 0), 0));

/** Changing the total shares it across the headings in proportion to what is left for each. */
export function shareAcross(headings: Breakdown, total: number): HeadSplit {
  const left = headings.reduce((s, r) => s + r.remaining, 0);
  let given = 0;
  const next: HeadSplit = {};
  headings.forEach((r, i) => {
    const part = i === headings.length - 1 ? round2(total - given) : left > 0 ? round2((total * r.remaining) / left) : 0;
    given += part;
    next[headKey(r.key)] = Math.max(part, 0).toFixed(2);
  });
  return next;
}

export const splitAmounts = (headings: Breakdown, split: HeadSplit) => headings.map((r) => ({ key: r.key, amount: Number(split[headKey(r.key)]) || 0 }));

export function HeadSplitFields({ headings, split, onChange, inputClass }: { headings: Breakdown; split: HeadSplit; onChange: (next: HeadSplit) => void; inputClass: string }) {
  return (
    <div className="col-span-2 space-y-1.5 rounded border border-gray-200 bg-white p-3">
      <p className="text-xs text-gray-500">Deposited for each heading</p>
      {headings.map((r) => (
        <div key={headKey(r.key)} className="flex items-center justify-between gap-3 text-sm">
          <span className="text-gray-700">
            {r.name} <span className="text-xs text-gray-400">· {fmt(r.remaining)} left</span>
          </span>
          <input type="number" step="0.01" min="0" className={`${inputClass} w-32 text-right`} value={split[headKey(r.key)] ?? ""} onChange={(e) => onChange({ ...split, [headKey(r.key)]: e.target.value })} />
        </div>
      ))}
    </div>
  );
}
