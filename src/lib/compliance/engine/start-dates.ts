import type { IsoDate } from "@/lib/calendar";

// Where each kind of compliance item starts. Nothing is owed for a period that ended before the thing it belongs to began:
// VAT returns start with the VAT registration, excise returns with the excise permit, everything else with the company.
// Pure: no database.

export type StartDates = {
  /** The company's own registration date. */
  company: IsoDate | null;
  /** When the VAT registration takes effect ("Effective from"). */
  vat: IsoDate | null;
  /** When the TDS registration takes effect, if the company has one recorded. */
  tds: IsoDate | null;
  /** The excise permit date ("Effective from" of the excise registration). */
  excise: IsoDate | null;
};

/** The earliest date a requirement can matter for this organization; null when nothing limits it. */
export function startFloor(taxTypeKey: string | null, s: StartDates): IsoDate | null {
  switch (taxTypeKey) {
    case "vat":
      return s.vat;
    case "tds":
      return s.tds ?? s.company;
    case "excise":
      return s.excise;
    default:
      return s.company;
  }
}

/** A period is kept unless it ended before the floor. */
export function afterFloor(period: { end: IsoDate }, floor: IsoDate | null): boolean {
  return !floor || period.end >= floor;
}
