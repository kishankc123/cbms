import { guardView } from "@/components/page-guard";
import Link from "next/link";
import { requireTenantSession } from "@/lib/session";
import { listInterTransfers, getTransferFormOptions } from "./actions";
import { TransfersTable } from "./transfers-table";

export default async function InterTransferPage() {
  const denied = await guardView("payments");
  if (denied) return denied;
  await requireTenantSession();
  const [rows, options] = await Promise.all([listInterTransfers({}), getTransferFormOptions()]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-ink">Inter-Transfer</h1>
          <p className="mt-0.5 text-sm text-gray-500">Transfer funds between your cash and bank accounts</p>
        </div>
        <Link href="/payments/inter-transfer/new" className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-3 py-[5px] text-[13px] font-medium text-[var(--on-accent)] transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50">
          + New Transfer
        </Link>
      </div>
      <TransfersTable initialRows={rows} options={options} />
    </div>
  );
}
