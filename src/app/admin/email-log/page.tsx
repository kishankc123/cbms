import { requirePlatformAdmin } from "@/lib/session";
import { emailLog24h, listEmailLog } from "@/lib/email-log";
import { isEmailConfigured } from "@/lib/email";
import { AdminHeader } from "../ui";
import { EmailLogTable } from "./email-log-table";

type Search = { status?: string; kind?: string; q?: string; page?: string };

export default async function AdminEmailLogPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const [data, day] = await Promise.all([listEmailLog({ status: sp.status, kind: sp.kind, search: sp.q, page: Number(sp.page) || 1, pageSize: 25 }), emailLog24h()]);
  return (
    <div className="space-y-5">
      <AdminHeader title="Sent mail" description="Every email the platform tried to send, and whether it went. Only the facts are kept: never the message or its links." />
      <EmailLogTable data={data} day={day} configured={isEmailConfigured()} filters={{ status: sp.status ?? "", kind: sp.kind ?? "", q: sp.q ?? "" }} />
    </div>
  );
}
