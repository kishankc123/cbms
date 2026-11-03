import { guardView } from "@/components/page-guard";
import { listCalendarItems, listAssignableUsers } from "../actions";
import { CalendarTable } from "./calendar-table";
import { PageHeader } from "@/components/ui/page-header";

export default async function CompliancecalendarPage() {
  const denied = await guardView("compliance");
  if (denied) return denied;
  const [items, users] = await Promise.all([listCalendarItems(), listAssignableUsers()]);
  return (
    <div className="space-y-6">
      <PageHeader title="Compliance Calendar" className="!mb-0" />
      <CalendarTable items={items} users={users} />
    </div>
  );
}
