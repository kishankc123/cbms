"use client";

import { useState } from "react";
import { CompanyForm } from "./company-form";
import { TaxRatesPanel } from "./tax-rates-panel";
import { RegistrationsTable } from "../registrations/registrations-table";
import type { getCompanyDetails } from "../company-actions";
import type { listTaxRegistrations } from "../registration-actions";

type Data = Awaited<ReturnType<typeof getCompanyDetails>>;
type RegistrationsData = Awaited<ReturnType<typeof listTaxRegistrations>>;

const TABS = [
  { id: "details", label: "Details" },
  { id: "registrations", label: "Tax Registrations" },
  { id: "rates", label: "Tax Rates" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// Company Details as a switchable page: the basics, which taxes you're registered for, and their rates —
// everything that decides which compliance requirements apply, in one place.
export function CompanyTabs({ data, registrations }: { data: Data; registrations: RegistrationsData }) {
  const [tab, setTab] = useState<TabId>("details");

  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`relative inline-flex h-9 items-center whitespace-nowrap border-b-2 px-3 text-[13px] transition-colors ${tab === t.id ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "details" && <CompanyForm data={data} />}
      {tab === "registrations" && <RegistrationsTable data={registrations} />}
      {tab === "rates" && <TaxRatesPanel />}
    </div>
  );
}
