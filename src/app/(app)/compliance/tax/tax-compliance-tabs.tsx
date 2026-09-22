"use client";

import Link from "next/link";
import { useState } from "react";
import type { listTaxCompliance } from "../tax-actions";
import { TaxComplianceTable } from "./tax-compliance-table";
import { ReportsViewer } from "../reports/reports-viewer";
import type { ComplianceReportType } from "@/lib/compliance/reports";

type Data = Awaited<ReturnType<typeof listTaxCompliance>>;

// One tab per tax, so each is a self-contained workspace: what's due, and the reports that belong to it. A tax with
// no registration and no obligations still gets a tab, so its "not registered" state is visible rather than hidden.
const TAX_TABS: { key: string; label: string; reports: ComplianceReportType[] }[] = [
  { key: "vat", label: "VAT", reports: ["sales_register", "purchase_register", "vat_return"] },
  { key: "tds", label: "TDS", reports: ["tds_report", "tds_payable"] },
  { key: "excise", label: "Excise", reports: [] },
];

export function TaxComplianceTabs({ data }: { data: Data }) {
  const present = new Set(data.taxTypes.map((t) => t.key));
  const [tab, setTab] = useState<string>(TAX_TABS[0].key);
  const active = TAX_TABS.find((t) => t.key === tab) ?? TAX_TABS[0];
  const registered = present.has(active.key);

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-full bg-gray-100 p-1">
        {TAX_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-full px-4 py-1.5 text-sm transition-colors ${tab === t.key ? "bg-white text-gray-900 font-medium shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {registered && (
        <>
          <TaxComplianceTable key={active.key} data={data} lockTaxType={active.key} />
          {active.reports.length > 0 && (
            <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-gray-900">Reports</h3>
              <ReportsViewer key={active.key} allowedTypes={active.reports} />
            </section>
          )}
        </>
      )}

      {!registered && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          Not registered for {active.label}.{" "}
          <Link href="/compliance/company" className="text-[var(--color-primary)] hover:underline">
            Register in Company Details → Tax Registrations
          </Link>{" "}
          to activate it here.
        </div>
      )}
    </div>
  );
}
