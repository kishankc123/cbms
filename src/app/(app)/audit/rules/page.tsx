import { guardView } from "@/components/page-guard";
import { listRules } from "../actions";
import { RulesTable } from "./rules-table";

export default async function RulesPage() {
  const denied = await guardView("audit");
  if (denied) return denied;
  const rules = await listRules();
  return (
    <div className="space-y-6">
      <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-ink">Rules & Policies</h1>
      <RulesTable rules={rules} />
    </div>
  );
}
