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
      <div className="inline-flex rounded-full bg-gray-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-1.5 text-sm transition-colors ${tab === t.id ? "bg-white text-gray-900 font-medium shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
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
