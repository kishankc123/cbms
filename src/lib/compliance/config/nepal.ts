import type { Condition } from "../engine/applicability";
import type { CountryConfig } from "./types";

// Nepal, as configuration. Nothing in the engine or the UI knows about Nepal:
// this is data that is loaded into the compliance_* tables.
//
// IMPORTANT: the due-date rules below are the commonly-cited filing patterns,
// NOT confirmed legal advice. Templates start `isVerified: false`, and the ones
// whose rule has not been confirmed are seeded inactive so they cannot put a
// wrong due date in front of a client. A compliance reviewer should confirm each
// rule against current Inland Revenue Department / Company Registrar rules and
// then activate it (platform admins only).
const WITHHOLDS_TAX: Condition = {
  any: [
    { fact: "registered_tax_types", op: "includes", value: "tds" },
    { fact: "has_employees", op: "eq", value: true },
    { fact: "withholds_tax", op: "eq", value: true },
  ],
};

const COMPANY_ENTITY: Condition = { fact: "entity_type", op: "in", value: ["private_limited"] };

export const NEPAL: CountryConfig = {
  country: { code: "NP", name: "Nepal", currency: "NPR", statutoryCalendar: "BS" },

  entityTypes: [
    { key: "private_limited", name: "Private Limited" },
    { key: "proprietorship", name: "Sole Proprietorship" },
    { key: "partnership", name: "Partnership" },
    { key: "non_profit", name: "Non-profit" },
  ],

  authorities: [
    { key: "ird", name: "Inland Revenue Department" },
    { key: "ocr", name: "Office of the Company Registrar" },
  ],

  taxTypes: [
    { key: "pan", name: "PAN", authorityKey: "ird", isRegistrable: true, numberSource: "company_pan_vat" },
    { key: "vat", name: "VAT", authorityKey: "ird", isRegistrable: true, numberSource: "company_pan_vat", amountSource: "vat_return", payableAccountName: "Tax Payable (Output VAT)", legacyPayableCode: "2100" },
    { key: "vat_penalty", name: "VAT Fines & Penalties", authorityKey: "ird", payableAccountName: "VAT Fines & Penalties Payable" },
    { key: "tds", name: "TDS", authorityKey: "ird", isRegistrable: true, amountSource: "tds_withheld", payableAccountName: "TDS Payable", legacyPayableCode: "2320" },
    { key: "excise", name: "Excise Duty", isRegistrable: true, payableAccountName: "Excise Duty Payable" },
    { key: "income_tax", name: "Income Tax", authorityKey: "ird", payableAccountName: "Income Tax Liability" },
  ],

  templates: [
    {
      key: "vat_return",
      name: "VAT Return",
      description: "Monthly VAT return, due by the 25th of the following month (BS).",
      categoryKey: "tax",
      taxTypeKey: "vat",
      authorityKey: "ird",
      frequency: "monthly",
      applicability: { fact: "registered_tax_types", op: "includes", value: "vat" },
      dueRule: { period: "month", monthsAfterEnd: 1, dayOfMonth: 25 },
      isActive: true,
      isVerified: false,
    },
    {
      key: "tds_deposit",
      name: "TDS Deposit",
      description: "Monthly TDS deposit, due by the 25th of the following month (BS).",
      categoryKey: "tax",
      taxTypeKey: "tds",
      authorityKey: "ird",
      frequency: "monthly",
      applicability: WITHHOLDS_TAX,
      dueRule: { period: "month", monthsAfterEnd: 1, dayOfMonth: 25 },
      isActive: true,
      isVerified: false,
    },
    {
      key: "income_tax_return",
      name: "Income Tax Return",
      description: "Annual income tax return. Due-date rule (three months after the fiscal year end) to be confirmed before activation.",
      categoryKey: "tax",
      taxTypeKey: "income_tax",
      authorityKey: "ird",
      frequency: "annual",
      applicability: null,
      dueRule: { period: "fiscal_year", monthsAfterEnd: 3, dayOfMonth: "last" },
      isActive: false,
      isVerified: false,
    },
    {
      key: "excise_return",
      name: "Excise Return",
      description: "Excise return for excise-registered organizations. Filing rule to be confirmed before activation.",
      categoryKey: "tax",
      taxTypeKey: "excise",
      frequency: "monthly",
      applicability: { fact: "registered_tax_types", op: "includes", value: "excise" },
      dueRule: { period: "month", monthsAfterEnd: 1, dayOfMonth: 25 },
      isActive: false,
      isVerified: false,
    },
    {
      key: "annual_company_filing",
      name: "Annual Company Compliance",
      description: "Annual filing with the Company Registrar. Due-date rule to be confirmed before activation.",
      categoryKey: "statutory",
      authorityKey: "ocr",
      frequency: "annual",
      applicability: COMPANY_ENTITY,
      dueRule: null,
      isActive: false,
      isVerified: false,
    },
    // Event-based: created when the event happens (shareholder and capital changes are built later).
    {
      key: "share_lagat_update",
      name: "Share Lagat Update",
      description: "Update the share register (Share Lagat) whenever shareholder information changes.",
      categoryKey: "ownership",
      authorityKey: "ocr",
      frequency: "event_based",
      applicability: COMPANY_ENTITY,
      dueRule: null,
      isActive: false,
      isVerified: false,
    },
    {
      key: "shareholder_change_filing",
      name: "Shareholder Change Filing",
      description: "Registry filing when shareholders change.",
      categoryKey: "ownership",
      authorityKey: "ocr",
      frequency: "event_based",
      applicability: COMPANY_ENTITY,
      dueRule: null,
      isActive: false,
      isVerified: false,
    },
    {
      key: "director_change_filing",
      name: "Director Change Filing",
      description: "Registry filing when directors change.",
      categoryKey: "company",
      authorityKey: "ocr",
      frequency: "event_based",
      applicability: COMPANY_ENTITY,
      dueRule: null,
      isActive: false,
      isVerified: false,
    },
    {
      key: "capital_change_filing",
      name: "Capital Change Filing",
      description: "Registry filing when authorised, issued or paid-up capital changes.",
      categoryKey: "ownership",
      authorityKey: "ocr",
      frequency: "event_based",
      applicability: COMPANY_ENTITY,
      dueRule: null,
      isActive: false,
      isVerified: false,
    },
  ],

  // Late-filing/payment penalty formulas, per the Inland Revenue Department's VAT/TDS/Excise rules. Unverified
  // until a compliance reviewer confirms these figures — the fines & penalties screen shows that status.
  penaltyRules: [
    {
      taxTypeKey: "vat",
      effectiveFrom: "2000-01-01",
      params: { filingDailyRate: 0.0005, filingFloor: 1000, latePaymentFlatRate: 0.1, interestAnnualRate: 0.15 },
      isVerified: false,
    },
    {
      taxTypeKey: "tds",
      effectiveFrom: "2000-01-01",
      params: { filingFlatPerDay: 100, filingAnnualRate: 0.025, interestAnnualRate: 0.15 },
      isVerified: false,
    },
    {
      taxTypeKey: "excise",
      effectiveFrom: "2000-01-01",
      params: { stepUpRatePer30Days: 0.05, stepUpCapRate: 0.25, interestAnnualRate: 0.15, manualOverrideCapRate: 1.0 },
      isVerified: false,
    },
  ],
};
