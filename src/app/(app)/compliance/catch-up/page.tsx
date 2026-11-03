import { guardView } from "@/components/page-guard";
import { getCatchup } from "../catchup-actions";
import { ComplianceProfileNotice } from "../profile-notice";
import { CatchupChecklist } from "./catchup-checklist";
import { PageHeader } from "@/components/ui/page-header";

export default async function CatchupPage() {
  const denied = await guardView("compliance");
  if (denied) return denied;
  const data = await getCatchup();
  return (
    <div className="space-y-6">
      <PageHeader title="Compliance Checklist" description="What was already filed before you started using the system. Periods up to your answer are marked filed; everything after stays on your list." />
      <ComplianceProfileNotice />
      <CatchupChecklist data={data} />
    </div>
  );
}
