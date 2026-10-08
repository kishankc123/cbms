import type { IsoDate } from "@/lib/calendar";
import type { StartDates } from "./engine/start-dates";

// The pure rules for when compliance can start (no database), so they can be unit tested.

export type ProfileGap = { key: string; label: string; /** Where it is filled in. */ where: "company" | "registrations" };

export type ProfileInput = {
  entityType: string | null;
  panVatNumber: string | null;
  companyRegistrationDate: string | null;
  registrations: { taxTypeKey: string; status: string; effectiveDate: string | null; filingFrequency: string | null }[];
};

/** What is still missing. The minimum: entity type, PAN/VAT number and company registration date; plus, when registered for VAT, its effective-from date and filing basis; plus the excise permit date when there is an excise registration. */
export function profileGaps(i: ProfileInput): ProfileGap[] {
  const gaps: ProfileGap[] = [];
  if (!i.entityType?.trim()) gaps.push({ key: "entity_type", label: "Entity type", where: "company" });
  if (!i.panVatNumber?.trim()) gaps.push({ key: "pan_vat_number", label: "PAN / VAT number", where: "company" });
  if (!i.companyRegistrationDate) gaps.push({ key: "registration_date", label: "Company registration date", where: "company" });

  const active = i.registrations.filter((r) => r.status === "active");
  const vat = active.find((r) => r.taxTypeKey === "vat");
  if (vat) {
    if (!vat.effectiveDate) gaps.push({ key: "vat_effective_from", label: "VAT effective from", where: "registrations" });
    if (!vat.filingFrequency) gaps.push({ key: "vat_filing_basis", label: "VAT filing basis (monthly or quarterly)", where: "registrations" });
  }
  const excise = active.find((r) => r.taxTypeKey === "excise");
  if (excise && !excise.effectiveDate) gaps.push({ key: "excise_permit_date", label: "Excise permit date (effective from)", where: "registrations" });
  return gaps;
}

export function startDatesOf(i: ProfileInput): StartDates {
  const active = i.registrations.filter((r) => r.status === "active");
  const at = (key: string): IsoDate | null => active.find((r) => r.taxTypeKey === key)?.effectiveDate ?? null;
  return { company: i.companyRegistrationDate, vat: at("vat"), tds: at("tds"), excise: at("excise") };
}
