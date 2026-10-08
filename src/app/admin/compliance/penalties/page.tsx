import { requirePlatformAdmin } from "@/lib/session";
import { AdminHeader } from "../../ui";
import { getPenaltyAdminData } from "./actions";
import { PenaltiesAdmin } from "./penalties-admin";

export default async function AdminPenaltiesPage({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  await requirePlatformAdmin();
  const { country } = await searchParams;
  const data = await getPenaltyAdminData(country);
  return (
    <div className="space-y-5">
      <AdminHeader
        title="Fines and penalties"
        description="The late-filing and late-payment figures every organization is judged by. Each version starts on Shrawan 1 of a fiscal year, so a past period always keeps the figures that applied then. Organizations can see these, read-only."
      />
      <PenaltiesAdmin data={data} />
    </div>
  );
}
