import { redirect } from "next/navigation";

// The compliance overview lives in the dashboard's Compliance tab. This address stays so old links, bookmarks and the menu still arrive there.
export default function CompliancePage() {
  redirect("/dashboard/compliance");
}
