import { redirect } from "next/navigation";

// Settings is a group of screens (Company details, General, Fiscal years, Users, Roles) in the sidebar.
export default function SettingsPage() {
  redirect("/settings/company");
}
