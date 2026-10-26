import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/session";
import { adminCard, AdminHeader } from "../ui";

export default async function AdminSetupPage() {
  await requirePlatformAdmin();
  return (
    <div className="space-y-5">
      <AdminHeader title="Setup" description="What the platform sets up for every organization." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/admin/setup/countries" className={`${adminCard} block p-5 transition-shadow hover:shadow-sm`}>
          <p className="font-medium text-[var(--text-primary)]">Countries</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">The countries organizations can be set up in. Used at registration, in Company Details and across compliance.</p>
        </Link>
      </div>
    </div>
  );
}
