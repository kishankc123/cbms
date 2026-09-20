import { requireTenantSession } from "@/lib/session";
import { listAccountsWithBalances, type AccountRow } from "@/lib/ledger/chart";
import { Balance, SystemBadge, TYPE_LABEL } from "../shared";

const TYPE_ORDER = ["asset", "liability", "equity", "income", "expense"] as const;

// The whole chart as one tree: each group with its sub-accounts beneath it. A
// group's balance includes everything below it; a sub-account shows its own.
export default async function ChartStructurePage() {
  const session = await requireTenantSession();
  const all = await listAccountsWithBalances(session.tenantId);

  const childrenOf = new Map<string | null, AccountRow[]>();
  for (const a of all) childrenOf.set(a.parentAccountId, [...(childrenOf.get(a.parentAccountId) ?? []), a]);

  const rows: { account: AccountRow; depth: number }[] = [];
  const walk = (parent: string | null, depth: number, type: string) => {
    for (const a of childrenOf.get(parent) ?? []) {
      if (depth === 0 && a.category !== type) continue;
      rows.push({ account: a, depth });
      walk(a.id, depth + 1, type);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Chart of Accounts — Structure</h1>
        <p className="mt-0.5 text-sm text-gray-500">Every account and where it sits. A group&apos;s balance includes its sub-groups.</p>
      </div>

      {TYPE_ORDER.map((type) => {
        rows.length = 0;
        walk(null, 0, type);
        const section = [...rows];
        if (section.length === 0) return null;
        const total = section.filter((r) => r.depth === 0).reduce((s, r) => s + r.account.total, 0);
        return (
          <section key={type} className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-gray-900">{TYPE_LABEL[type]}</h2>
              <p className="text-sm text-gray-500">
                Total <span className="font-medium text-gray-900"><Balance value={Math.round(total * 100) / 100} /></span>
              </p>
            </div>
            <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
              <tbody>
                {section.map(({ account: a, depth }) => (
                  <tr key={a.id} className={`border-t border-gray-100 first:border-t-0 ${a.isActive ? "" : "text-gray-400"}`}>
                    <td className="px-4 py-1.5 font-mono w-40" style={{ paddingLeft: 16 + depth * 20 }}>
                      {a.code}
                    </td>
                    <td className={`px-4 py-1.5 ${depth === 0 ? "font-medium text-gray-900" : ""}`}>
                      {a.name}
                      {a.system && <SystemBadge />}
                      {!a.isActive && <span className="ml-2 text-xs">(inactive)</span>}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums w-40">
                      <Balance value={depth === 0 ? a.total : a.own} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
