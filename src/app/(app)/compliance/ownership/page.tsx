import { guardView } from "@/components/page-guard";
import { getOwnership } from "../ownership-actions";
import { OwnershipWorkspace } from "./ownership-workspace";
import { PageHeader } from "@/components/ui/page-header";

export default async function OwnershipPage() {
  const denied = await guardView("compliance");
  if (denied) return denied;
  const data = await getOwnership();
  return (
    <div className="space-y-6">
      <PageHeader title="Ownership &amp; Capital" description="Who owns the company and how much capital is in. Paid-up capital comes from your books; every change is kept in the history." />
      <OwnershipWorkspace data={data} />
    </div>
  );
}
