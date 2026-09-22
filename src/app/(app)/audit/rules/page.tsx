import { listRules } from "../actions";
import { RulesTable } from "./rules-table";

export default async function RulesPage() {
  const rules = await listRules();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Rules & Policies</h1>
      <RulesTable rules={rules} />
    </div>
  );
}
