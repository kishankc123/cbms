import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/session";

// This screen now lives inside each country (Compliance Configuration → country → tab).
export default async function Page({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  await requirePlatformAdmin();
  const { country } = await searchParams;
  redirect(country ? `/admin/compliance/${country}?tab=tax` : "/admin/compliance");
}
