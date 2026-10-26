import { and, asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceCountries, tenants } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { suggestedCalendar, suggestedCurrency } from "@/lib/country-currencies";

// The one list of countries. The platform administrator chooses which are active (Setup → Countries); registration,
// Company Details and the compliance screens all read it, so a country added here shows up everywhere.

const REGIONS =
  "AF AX AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW".split(" ");

/** Every country in the world with its usual currency and calendar, for the "Add new country" picker to suggest. */
export function worldCountries() {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  return REGIONS.map((code) => ({ code, name: names.of(code) ?? code, currency: suggestedCurrency(code), calendar: suggestedCalendar(code) })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The active countries, for any screen that asks for one. */
export const activeCountries = () =>
  db.select({ code: complianceCountries.code, name: complianceCountries.name }).from(complianceCountries).where(eq(complianceCountries.isActive, true)).orderBy(asc(complianceCountries.name));

/** The countries the platform has set up, with how many organizations use each. */
export async function countriesWithUsage() {
  const [list, used] = await Promise.all([
    db.select().from(complianceCountries).orderBy(asc(complianceCountries.name)),
    db.select({ code: tenants.countryCode, n: count() }).from(tenants).groupBy(tenants.countryCode),
  ]);
  const inUse = new Map(used.map((u) => [u.code, u.n]));
  return list.map((c) => ({ ...c, organizations: inUse.get(c.code) ?? 0 }));
}

export async function addCountry(adminId: string, input: { code: string; currency: string; calendar: "AD" | "BS" }): Promise<{ ok: true } | { ok: false; error: string }> {
  const world = worldCountries().find((c) => c.code === input.code);
  if (!world) return { ok: false, error: "Choose a country from the list." };
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: "The currency is a three-letter code, like NPR or INR." };
  if (input.calendar !== "AD" && input.calendar !== "BS") return { ok: false, error: "Choose AD or BS for the calendar." };
  // Adding a country that was removed earlier turns it back on, keeping the rules already set up for it.
  await db
    .insert(complianceCountries)
    .values({ code: world.code, name: world.name, currency, statutoryCalendar: input.calendar, isActive: true })
    .onConflictDoUpdate({ target: complianceCountries.code, set: { currency, statutoryCalendar: input.calendar, isActive: true } });
  await logAuditEvent({ userId: adminId, action: "country_added", entityType: "country", entityId: world.code, after: { name: world.name, currency, calendar: input.calendar } });
  return { ok: true };
}

export async function removeCountry(adminId: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const [used] = await db.select({ n: count() }).from(tenants).where(eq(tenants.countryCode, code));
  if (used.n > 0) return { ok: false, error: `${used.n} organization${used.n === 1 ? " uses" : "s use"} this country, so it can't be removed.` };
  const [gone] = await db.update(complianceCountries).set({ isActive: false }).where(and(eq(complianceCountries.code, code), eq(complianceCountries.isActive, true))).returning({ name: complianceCountries.name });
  if (!gone) return { ok: false, error: "That country isn't active." };
  await logAuditEvent({ userId: adminId, action: "country_removed", entityType: "country", entityId: code, before: { name: gone.name } });
  return { ok: true };
}
