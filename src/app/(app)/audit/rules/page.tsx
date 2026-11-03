import { guardView } from "@/components/page-guard";
import { listRules } from "../actions";
import { RulesTable } from "./rules-table";
import { PageHeader } from "@/components/ui/page-header";

export default async function RulesPage() {
  const denied = await guardView("audit");
  if (denied) return denied;
  const rules = await listRules();
  return (
    <div className="space-y-6">
      <PageHeader title="Rules & Policies" className="!mb-0" />
      <RulesTable rules={rules} />
    </div>
  );
}
