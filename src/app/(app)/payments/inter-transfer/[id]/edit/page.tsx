import { notFound, redirect } from "next/navigation";
import { requireTenantSession } from "@/lib/session";
import { getTransferFormOptions, getInterTransferDetail } from "../../actions";
import { TransferForm } from "../../transfer-form";

export default async function EditTransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireTenantSession();
  const [detail, options] = await Promise.all([getInterTransferDetail(id), getTransferFormOptions()]);
  if (!detail) notFound();
  if (detail.status === "voided") redirect(`/payments/inter-transfer/${id}`);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Edit Transfer {detail.transferNumber}</h1>
        <p className="mt-0.5 text-sm text-gray-500">The accounting entry is updated automatically.</p>
      </div>
      <TransferForm
        options={options}
        initial={{
          id: detail.id,
          transferNumber: detail.transferNumber,
          transferDate: detail.transferDate,
          fromAccountId: detail.fromAccountId,
          toAccountId: detail.toAccountId,
          amount: detail.amount,
          reference: detail.reference,
          description: detail.description,
          attachmentUrl: detail.attachmentUrl,
        }}
      />
    </div>
  );
}
