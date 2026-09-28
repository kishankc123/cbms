ALTER TABLE "journal_entries" ADD COLUMN "fiscal_year_id" uuid;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Backfill: stamp every existing journal entry with the fiscal year its date already falls into, for
-- every fiscal year already on record. Entries whose date falls outside every known fiscal year are
-- left null (unknown), the same rule new postings follow (see resolveFiscalYearId in lib/fiscal.ts) —
-- this never invents a fiscal year, it only uses ones that already exist.
UPDATE "journal_entries" je
SET "fiscal_year_id" = fy.id
FROM "fiscal_years" fy
WHERE je."tenant_id" = fy."tenant_id"
  AND je."entry_date" BETWEEN fy."start_date" AND fy."end_date"
  AND je."fiscal_year_id" IS NULL;