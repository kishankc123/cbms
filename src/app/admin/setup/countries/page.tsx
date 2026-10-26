import { requirePlatformAdmin } from "@/lib/session";
import { AdminHeader } from "../../ui";
import { getCountriesAdminData } from "./actions";
import { CountriesAdmin } from "./countries-admin";

export default async function AdminCountriesPage() {
  await requirePlatformAdmin();
  return (
    <div className="space-y-5">
      <AdminHeader title="Countries" description="The countries organizations can be set up in. This one list feeds registration, Company Details and the compliance screens." />
      <CountriesAdmin data={await getCountriesAdminData()} />
    </div>
  );
}
