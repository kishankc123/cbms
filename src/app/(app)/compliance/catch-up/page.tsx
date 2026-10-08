import { guardView } from "@/components/page-guard";
import { getCatchup } from "../catchup-actions";
import { ComplianceProfileNotice } from "../profile-notice";
import { CatchupChecklist } from "./catchup-checklist";

export default async function CatchupPage() {
  const denied = await guardView("compliance");
  if (denied) return denied;
  const data = await getCatchup();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Compliance Checklist</h1>
        <p className="mt-0.5 text-sm text-gray-500">What was already filed before you started using the system. Periods up to your answer are marked filed; everything after stays on your list.</p>
      </div>
      <ComplianceProfileNotice />
      <CatchupChecklist data={data} />
    </div>
  );
}
