import Link from "next/link";
import { requireTenantSession } from "@/lib/session";
import { listInterTransfers, getTransferFormOptions } from "./actions";
import { TransfersTable } from "./transfers-table";

export default async function InterTransferPage() {
  await requireTenantSession();
  const [rows, options] = await Promise.all([listInterTransfers({}), getTransferFormOptions()]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Inter-Transfer</h1>
          <p className="mt-0.5 text-sm text-gray-500">Transfer funds between your cash and bank accounts</p>
        </div>
        <Link href="/payments/inter-transfer/new" className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-medium px-4 py-1.5">
          + New Transfer
        </Link>
      </div>
      <TransfersTable initialRows={rows} options={options} />
    </div>
  );
}
