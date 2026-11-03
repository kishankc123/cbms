import { guardView } from "@/components/page-guard";
import { listCalendarItems, listAssignableUsers } from "../actions";
import { CalendarTable } from "./calendar-table";

export default async function CompliancecalendarPage() {
  const denied = await guardView("compliance");
  if (denied) return denied;
  const [items, users] = await Promise.all([listCalendarItems(), listAssignableUsers()]);
  return (
    <div className="space-y-6">
      <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-ink">Compliance Calendar</h1>
      <CalendarTable items={items} users={users} />
    </div>
  );
}
