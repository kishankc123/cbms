import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/session";
import { adminCard, AdminHeader } from "../ui";

export default async function AdminCompliancePage() {
  await requirePlatformAdmin();
  return (
    <div className="space-y-5">
      <AdminHeader title="Compliance Configuration" description="What the platform tells every organization about its compliance duties, versioned so past periods keep the rules that applied then." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/admin/compliance/penalties" className={`${adminCard} block p-5 transition-shadow hover:shadow-sm`}>
          <p className="font-medium text-[var(--text-primary)]">Fines and penalties</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Late filing, late payment and interest for VAT and TDS, and the late-renewal fines for the excise permit, by fiscal year.</p>
        </Link>
        <div className={`${adminCard} p-5`}>
          <p className="font-medium text-[var(--text-primary)]">Tax rates and requirement templates</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Not built yet. Publishing a tax rate change and verifying a requirement template for every organization will live here.</p>
        </div>
      </div>
    </div>
  );
}
