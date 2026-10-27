import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/session";
import { BackButton } from "@/components/ui/back-button";
import { AdminHeader } from "../../../../ui";
import { getSetupListData } from "../../actions";
import { SetupList } from "./setup-list";

export default async function AdminCountrySectionPage({ params }: { params: Promise<{ code: string; section: string }> }) {
  await requirePlatformAdmin();
  const { code, section } = await params;
  const data = await getSetupListData(code.toUpperCase(), section);
  if (!data) notFound();
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <BackButton href={`/admin/setup/countries/${data.countryCode}`} label={`Back to ${data.countryName}`} />
        <AdminHeader title={`${data.countryName}: ${data.title}`} description="Anything you deactivate stays on the records that already use it. It just can't be chosen for new ones." />
      </div>
      <SetupList data={data} />
    </div>
  );
}
