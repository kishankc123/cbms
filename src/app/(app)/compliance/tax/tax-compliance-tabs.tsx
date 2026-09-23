"use client";

import Link from "next/link";
import { useState } from "react";
import type { listTaxCompliance } from "../tax-actions";
import { TaxComplianceTable } from "./tax-compliance-table";
import { ReportsViewer } from "../reports/reports-viewer";
import { VatWorksheet } from "./vat-worksheet";
import type { ComplianceReportType } from "@/lib/compliance/reports";

type Data = Awaited<ReturnType<typeof listTaxCompliance>>;

// One tab per tax, so each is a self-contained workspace: what's due, and the reports that belong to it. A tax with
// no registration and no obligations still gets a tab, so its "not registered" state is visible rather than hidden.
const TAX_TABS: { key: string; label: string; reports: ComplianceReportType[]; hasWorksheet: boolean }[] = [
  { key: "vat", label: "VAT", reports: ["sales_register", "purchase_register", "vat_return"], hasWorksheet: true },
  { key: "tds", label: "TDS", reports: ["tds_report", "tds_payable"], hasWorksheet: false },
  { key: "excise", label: "Excise", reports: [], hasWorksheet: false },
];

// Within each tax, the same three sub-screens: what's due (Overview), the period-by-period payable calculation
// (Worksheet — VAT today; TDS/Excise get the same slot once their worksheets are built), and Reports.
const SECTIONS = [
  { key: "overview", label: "Overview" },
  { key: "worksheet", label: "Worksheet" },
  { key: "reports", label: "Reports" },
] as const;
type Section = (typeof SECTIONS)[number]["key"];

export function TaxComplianceTabs({ data }: { data: Data }) {
  const present = new Set(data.taxTypes.map((t) => t.key));
  const [tab, setTab] = useState<string>(TAX_TABS[0].key);
  const [section, setSection] = useState<Section>("overview");
  const active = TAX_TABS.find((t) => t.key === tab) ?? TAX_TABS[0];
  const registered = present.has(active.key);
  const sections = SECTIONS.filter((s) => s.key !== "reports" || active.reports.length > 0);

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-full bg-gray-100 p-1">
        {TAX_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key);
              setSection("overview");
            }}
            className={`rounded-full px-4 py-1.5 text-sm transition-colors ${tab === t.key ? "bg-white text-gray-900 font-medium shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {registered && (
        <>
          <div className="flex gap-1 border-b border-gray-200">
            {sections.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSection(s.key)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  section === s.key ? "border-[var(--color-primary)] text-[var(--color-primary)]" : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {section === "overview" && <TaxComplianceTable key={`table-${active.key}`} data={data} lockTaxType={active.key} />}

          {section === "worksheet" &&
            (active.hasWorksheet ? (
              <VatWorksheet key={`worksheet-${active.key}`} />
            ) : (
              <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">The {active.label} worksheet isn&apos;t built yet — Overview and Reports are available.</div>
            ))}

          {section === "reports" && active.reports.length > 0 && (
            <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
              <ReportsViewer key={`reports-${active.key}`} allowedTypes={active.reports} />
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
