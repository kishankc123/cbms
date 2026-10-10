import { requirePlatformAdmin } from "@/lib/session";
import { AdminHeader } from "../../ui";
import { getTemplateAdminData } from "./actions";
import { TemplatesAdmin } from "./templates-admin";

export default async function AdminTemplatesPage({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  await requirePlatformAdmin();
  const { country } = await searchParams;
  const data = await getTemplateAdminData(country);
  return (
    <div className="space-y-5">
      <AdminHeader
        title="Requirement templates"
        description="What every organization in a country has to file, when it is due, and who it applies to. A change reaches every organization the next time its items are generated; items already generated keep their due dates unless you choose to move the open ones."
      />
      <TemplatesAdmin data={data} />
    </div>
  );
}
