import { getOwnership } from "../ownership-actions";
import { OwnershipWorkspace } from "./ownership-workspace";

export default async function OwnershipPage() {
  const data = await getOwnership();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Ownership &amp; Capital</h1>
        <p className="mt-0.5 text-sm text-gray-500">Who owns the company and how much capital is in. Paid-up capital comes from your books; every change is kept in the history.</p>
      </div>
      <OwnershipWorkspace data={data} />
    </div>
  );
}
