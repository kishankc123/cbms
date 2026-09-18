import { voidInvoice } from "./actions";

type Customer = { id: string; name: string };
type Invoice = {
  id: string;
  invoiceNumber: string;
  customerId: string;
  invoiceDate: string;
  total: string;
  status: string;
};

export function InvoicesTable({
  invoiceList,
  customerById,
}: {
  invoiceList: Invoice[];
  customerById: Record<string, Customer>;
}) {
  return (
    <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
      <thead className="bg-gray-50 text-left text-gray-500">
        <tr>
          <th className="px-4 py-2 font-medium">Invoice #</th>
          <th className="px-4 py-2 font-medium">Customer</th>
          <th className="px-4 py-2 font-medium">Date</th>
          <th className="px-4 py-2 font-medium">Total</th>
          <th className="px-4 py-2 font-medium">Status</th>
          <th className="px-4 py-2 font-medium"></th>
        </tr>
      </thead>
      <tbody>
        {invoiceList.map((inv) => (
          <tr key={inv.id} className="border-t border-gray-100">
            <td className="px-4 py-2 font-mono">{inv.invoiceNumber}</td>
            <td className="px-4 py-2">{customerById[inv.customerId]?.name ?? "—"}</td>
            <td className="px-4 py-2">{inv.invoiceDate}</td>
            <td className="px-4 py-2">
              {Number(inv.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </td>
            <td className="px-4 py-2 capitalize">{inv.status.replace("_", " ")}</td>
            <td className="px-4 py-2 text-right">
              {inv.status !== "void" && (
                <form action={voidInvoice}>
                  <input type="hidden" name="invoiceId" value={inv.id} />
                  <button type="submit" className="text-red-600 hover:underline text-xs">
                    Void
                  </button>
                </form>
              )}
            </td>
          </tr>
        ))}
        {invoiceList.length === 0 && (
          <tr>
            <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
              No invoices yet
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
